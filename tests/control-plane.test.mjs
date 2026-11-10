import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {configuredAgentEnvelope} from '../server/platform-settings.ts';
import {context} from '../server/auth.ts';
let mf,runtime;before(async()=>{({mf,runtime}=await localRuntime());runtime={...runtime,NEO_CONFIG_ENCRYPTION_KEY:'local-test-encryption-key-'.repeat(3),NEO_CONTROL_URL:'http://localhost',NEO_SERVICE_TOKEN:'test-service-token-'.repeat(3)};});after(async()=>mf.dispose());
async function api(path,body,{business='test-a',nature='demo',rt=runtime,headers={}}={}){const r=await handleApi(new Request(`http://localhost/api/v1/ontology/control/${path}?businessId=${business}&dataNature=${nature}`,{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined}),rt);return {status:r.status,data:await r.json()};}
let modelId;
test('credential encryption, browser redaction, service authentication and enterprise scope',async()=>{
 const input={name:'验收模型',provider:'deepseek',model:'deepseek-chat',apiKey:'test-credential-never-returned'};
 assert.equal((await api('models',input,{rt:{...runtime,NEO_CONFIG_ENCRYPTION_KEY:undefined}})).status,503);
 assert.equal((await api('models',{...input,provider:'custom-private-url'})).status,422);
 const saved=await api('models',input);assert.equal(saved.status,201);modelId=saved.data.id;
 const row=await runtime.DB.prepare('SELECT * FROM neo_control_resources WHERE id=?').bind(modelId).first();assert.ok(row.secret);assert.ok(!row.secret.includes(input.apiKey));assert.ok(!row.payload.includes(input.apiKey));
 const publicConfig=await api('');assert.equal(publicConfig.data.models[0].hasKey,true);assert.ok(!JSON.stringify(publicConfig).includes(input.apiKey));assert.ok(!JSON.stringify(publicConfig).includes('"secret"'));
 assert.equal((await api('models/'+modelId+'/activate',{})).status,200);
 assert.equal((await api('models/'+modelId+'/activate',{},{business:'test-b'})).status,404);
 assert.equal((await api('models/'+modelId+'/activate',{},{nature:'business'})).status,404);
 assert.equal((await api('resolve/'+modelId)).status,401);
 const service={headers:{authorization:'Bearer '+runtime.NEO_SERVICE_TOKEN}};
 assert.equal((await api('resolve/'+modelId,undefined,service)).data.apiKey,input.apiKey);
 assert.equal((await api('resolve/'+modelId,undefined,{...service,business:'test-b'})).status,404);
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);const env=await configuredAgentEnvelope(ctx,'demo','supply',{});assert.equal(env.modelProfileRef.id,modelId);assert.ok(!JSON.stringify(env).includes(input.apiKey));
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await api('models',input,{rt:reader})).status,403);
 assert.equal((await api('models',input,{headers:{origin:'https://example.com'}})).status,403);
});
test('workflow versions reject stale saves, require review and isolate nature',async()=>{
 const flow={baseId:null,name:'企业治理流程',agentEnabled:false,instructions:'核对商品编号'};
 const saved=await api('workflow',flow);assert.equal(saved.status,201);assert.equal((await api('workflow',flow)).status,409);
 assert.equal((await api('',undefined,{nature:'business'})).data.workflow.id,null);
 assert.equal((await api('workflow',{...flow,baseId:saved.data.id,agentEnabled:true})).status,201);
});
test('governance profiles actual rows, records gaps and never imports facts; invalid model output cannot write mappings',async()=>{
 const before=await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts').first();const input={typeId:'product',csv:'id,name,price\np1,商品,10\np1,商品,10\np2,,20',useAgent:false};
 const report=await api('governance',input);assert.equal(report.status,201);assert.equal(report.data.rowCount,3);assert.equal(report.data.duplicateRows,1);assert.equal(report.data.profile.find(p=>p.column==='name').missing,1);assert.equal(report.data.trace[3].status,'waiting');assert.equal(report.data.trace[5].status,'not_started');assert.equal((await api('governance/'+report.data.id)).data.rowCount,3);assert.equal((await api('governance/'+report.data.id,undefined,{business:'test-b'})).status,404);assert.equal((await api('governance/'+report.data.id,undefined,{nature:'business'})).status,404);
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n,before.n);assert.equal((await api('governance',{...input,csv:'id,name\na,b,c'})).status,422);
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({mappings:[{source:'id',target:'invented_property',reason:'虚构'}]})}}]});
 try{assert.equal((await api('governance',{...input,useAgent:true})).status,502);}finally{globalThis.fetch=original;}
 const records=await runtime.DB.prepare("SELECT payload FROM neo_control_resources WHERE kind='governance'").all();assert.equal(records.results.length,1);assert.ok(!records.results[0].payload.includes('商品'));
});
