import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
let runtime,mf;
before(async()=>{({runtime,mf}=await localRuntime());runtime={...runtime,NEO_AGENT_URL:'http://agent',NEO_SERVICE_TOKEN:'service-token-'.repeat(4),NEO_CONFIG_ENCRYPTION_KEY:'encrypt-key-'.repeat(6),NEO_CONTROL_URL:'http://localhost'};});after(()=>mf.dispose());
async function api(path,body,{business='test-a',nature='demo',rt=runtime,origin='http://localhost'}={}){const r=await handleApi(new Request(`http://localhost/api/v1/ontology/control/${path}?businessId=${business}&dataNature=${nature}`,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
test('metadata sync uses authenticated published scoped definitions and saves only verified remote output',async()=>{
 const old=global.fetch;let sent;
 global.fetch=async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer '+runtime.NEO_SERVICE_TOKEN);sent=JSON.parse(init.body);assert.equal(sent.businessId,'test-a');assert.equal(sent.dataNature,'demo');assert.ok(sent.definition.types.some(t=>t.id==='product'));assert.ok(!('rows' in sent));return Response.json({status:'readback_verified',tables:[],termCount:sent.definition.types.length});};
 try{const r=await api('integrations/openmetadata/sync',{});assert.equal(r.status,201);assert.equal((await api('integrations/'+r.data.id)).data.status,'readback_verified');assert.equal((await api('integrations/'+r.data.id,undefined,{business:'test-b'})).status,404);assert.equal((await api('integrations/'+r.data.id,undefined,{nature:'business'})).status,404);
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await api('integrations/openmetadata/sync',{},{rt:reader})).status,403);assert.equal((await api('integrations/openmetadata/sync',{},{origin:'https://evil.example'})).status,403);
 global.fetch=async()=>Response.json({detail:'Remote readback failed'},{status:502});assert.equal((await api('integrations/openmetadata/sync',{})).status,502);const count=await runtime.DB.prepare("SELECT COUNT(*) n FROM neo_control_resources WHERE kind='catalog-sync'").first();assert.equal(count.n,1);
 }finally{global.fetch=old;}
});
test('OntoGPT validates local models, uses encrypted active credentials only in service request and leaves facts unchanged',async()=>{
 const before=await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts').first();const old=global.fetch;let forwarded;
 global.fetch=async(url,init)=>{if(url.endsWith('/health'))return Response.json({ontogpt:{localModels:['qwen2.5:3b']}});forwarded=JSON.parse(init.body);return Response.json({engine:'OntoGPT/SPIRES',status:'awaiting_review',sourceHash:'test-hash',objects:[]});};
 try{assert.equal((await api('integrations/ontogpt/extract',{text:'描述',typeId:'product',mode:'local',model:'missing'})).status,422);assert.equal((await api('integrations/ontogpt/extract',{text:'描述',typeId:'invented',mode:'local',model:'qwen2.5:3b'})).status,422);assert.equal((await api('integrations/ontogpt/extract',{text:'x'.repeat(8001),typeId:'product',mode:'local',model:'qwen2.5:3b'})).status,422);
 const r=await api('integrations/ontogpt/extract',{text:'商品描述',typeId:'product',mode:'local',model:'qwen2.5:3b'});assert.equal(r.status,201);assert.equal(forwarded.model,'ollama/qwen2.5:3b');assert.equal(forwarded.baseUrl,'http://127.0.0.1:11434');assert.equal((await api('integrations/'+r.data.id,undefined,{business:'test-b'})).status,404);
 const m=await api('models',{name:'模型',provider:'deepseek',model:'deepseek-chat',apiKey:'private-secret-never-in-history'});await api('models/'+m.data.id+'/activate',{});
 const cloud=await api('integrations/ontogpt/extract',{text:'描述',typeId:'product',mode:'active'});assert.equal(cloud.status,201);assert.equal(forwarded.apiKey,'private-secret-never-in-history');assert.equal(forwarded.model,'openai/deepseek-chat');const history=await api('integrations/'+cloud.data.id);assert.ok(!JSON.stringify(history).includes('private-secret'));assert.ok(!JSON.stringify(history).includes('商品描述'));
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n,before.n);
 }finally{global.fetch=old;}
});
