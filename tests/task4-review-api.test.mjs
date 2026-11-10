import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {knowledgeFreshness} from '../server/knowledge.ts';
import {hash} from '../server/csv.ts';
import {storedObservation} from '../server/agent-state.ts';
import {caseFixture,frozenCases,conversationGenerationV2} from '../scripts/frozen-case-fixtures.mjs';
import {validateBusinessInput} from '../lib/business-state.ts';

test('model result candidate persists exact scoped origin; review by saved ID registers source dependency, invalidates at newer source, reader cannot review',async()=>{
 const {mf,runtime}=await localRuntime();const db=runtime.DB;
 async function req(path,body,rt=runtime){const r=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},...(body?{body:JSON.stringify({dataNature:'demo',requestId:crypto.randomUUID(),...body})}:{})}),rt);return {status:r.status,...await r.json()};}
 try{
 const snapshot={id:'candidate-input',businessId:'test-a',dataNature:'demo',periodStart:'2026-09-01',periodEnd:'2026-09-30',evidenceIds:{sellableUnits:'evidence-one'}};
 await db.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snapshot.id,'test-a','demo','2026-10-08T00:00:00Z',JSON.stringify(snapshot)).run();
 await db.prepare('INSERT INTO neo_sessions(id,business_id,data_nature,snapshot_id,actor_id,created_at) VALUES(?,?,?,?,?,?)').bind('session-candidate','test-a','demo',snapshot.id,'local-owner','2026-10-08').run();
 const payload={question:'SKU-R1抖音库存',envelope:{snapshot,conversation:{active:{entityId:'P1',skuId:'SKU-R1',channelId:'douyin',period:{start:'2026-09-03',end:'2026-09-30'}}},modelVersion:'fixture-model-v1'}};
 const result={finding:{conclusion:'先核对库存条件',evidenceIds:['evidence-one']},specialists:{}};
 await db.prepare('INSERT INTO neo_runs(id,business_id,data_nature,snapshot_id,session_id,request_id,request_hash,payload,status,steps,result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('origin-run','test-a','demo',snapshot.id,'session-candidate','origin','hash',JSON.stringify(payload),'completed','[]',JSON.stringify(storedObservation(result,{})),'2026-10-08','2026-10-08').run();
 const proposed=await req('agent-memory',{statement:'先核对规格的可售条件',scope:{},provenance:{kind:'model_result',runId:'origin-run',inputId:snapshot.id,evidenceIds:['evidence-one']}});assert.equal(proposed.status,201,JSON.stringify(proposed));
 assert.deepEqual(proposed.item.scope,{entities:['SKU-R1'],channels:['douyin'],period:{start:'2026-09-03',end:'2026-09-30'}});assert.equal(proposed.item.provenance.runId,'origin-run');assert.equal(proposed.item.provenance.model,'fixture-model-v1');
 const saved=(await req('agent-memory')).items.find(m=>m.id===proposed.item.id);assert.equal(saved.state,'candidate');assert.equal(saved.payload.references[0].version,await hash(JSON.stringify(snapshot)));
 const reader={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await req('agent-memory/'+saved.id+'/confirm',{note:'reader'},reader)).status,403);
 assert.equal((await req('agent-memory/'+saved.id+'/confirm',{note:'按原资料范围核验'})).item.state,'active');
 const dependencies=await db.prepare('SELECT * FROM neo_knowledge_dependencies WHERE consumer_id=?').bind(saved.id).all();assert.equal(dependencies.results[0].dependency_id,'snapshot:'+snapshot.id);
 const ctx={db,runtime,businessId:'test-a',role:'owner',userId:'local-owner'};assert.equal((await knowledgeFreshness(ctx,'demo',saved.id)).status,'current');
 await db.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind('candidate-input-v2','test-a','demo','2026-10-08T01:00:00Z',JSON.stringify({...snapshot,id:'candidate-input-v2'})).run();assert.equal((await knowledgeFreshness(ctx,'demo',saved.id)).status,'stale');
 const audits=await db.prepare('SELECT action,actor_id FROM neo_knowledge_audit WHERE resource_id=?').bind(saved.id).all();assert.deepEqual(audits.results.map(x=>x.action),['propose','confirm']);
 const rejected=await req('agent-memory',{statement:'独立人工声明',scope:{entities:['SKU-S2'],period:{start:'2026-09-01',end:'2026-09-30'}}});assert.equal(rejected.item.provenance.kind,'human_assertion');assert.equal((await req('agent-memory/'+rejected.item.id+'/reject',{})).item.state,'rejected');assert.equal((await req('agent-memory/'+rejected.item.id+'/confirm',{confirmationMode:'human_attestation',note:'不能改终态'})).status,409);
 }finally{await mf.dispose();}
});

test('frozen case typed condition inputs are validated and all native condition oracles pass; V2 recomputes distinct source data',async()=>{
 const {data}=await frozenCases();for(const [i,c] of data.cases.entries())if(c.category==='diagnosis'){
 const f=caseFixture(c,i);assert.equal(f.fixtureComplete,true,c.id);for(const [name,passed] of Object.entries(f.oracles))assert.equal(passed,true,c.id+'/'+name);
 for(const {id,revision,knownAt,sourceId,...record} of f.generation.state.inputs)assert.doesNotThrow(()=>validateBusinessInput(record,f.config.industry),c.id);
 }
 const c=data.cases.find(c=>c.id==='dialogue-version_change'),f=caseFixture(c,0),next=conversationGenerationV2(f);assert.notEqual(next.id,f.generation.id);assert.notEqual(next.state.knownAt,f.generation.state.knownAt);assert.notEqual(next.state.metrics.netRevenueCents.value,f.generation.state.metrics.netRevenueCents.value);assert.equal(f.generation.state.inputs.length+1,next.state.inputs.length);
});


test('four real knowledge settings routes resolve together and reload persisted candidate',async()=>{
 const {mf,runtime}=await localRuntime();
 const req=async(path,body)=>{const response=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},...(body?{body:JSON.stringify({dataNature:'demo',requestId:crypto.randomUUID(),...body})}:{})}),runtime);assert.ok(response.ok,path+' '+response.status);return response.json();};
 try{
 const candidate=await req('agent-memory',{statement:'设置读取回归候选',scope:{entities:['SKU-settings']}});
 const paths=['knowledge-sources','monitor','agent-memory','knowledge-items'];
 const [sources,monitor,memory,knowledge]=await Promise.all(paths.map(p=>req(p)));
 assert.ok(Array.isArray(sources.items));assert.ok(Array.isArray(monitor.items));assert.ok(Array.isArray(knowledge.items));assert.equal(memory.items.find(x=>x.id===candidate.item.id).payload.statement,'设置读取回归候选');
 const missing=await handleApi(new Request('http://localhost/api/v1/knowledge?businessId=test-a&dataNature=demo'),runtime);assert.equal(missing.status,404);
 }finally{await mf.dispose();}
});

test('declared hotel service rows require full future coverage even when observed rows remain',async()=>{
 const {calculateScenario}=await import('../lib/business-scenarios.ts');const {data}=await frozenCases();const c=data.cases.find(x=>x.id==='hotel-checkin_limit'),f=caseFixture(c,0),state=f.generation.state;
 assert.ok(state.inputs.filter(x=>x.kind==='hotel_service_capacity').length===2);assert.equal(f.generation.baseline.status,'calculated');
 for(const coverage of [state.coverage.filter(x=>x.kind!=='hotel_service_capacity'),state.coverage.map(x=>x.kind==='hotel_service_capacity'?{...x,end:state.asOf}:x)]){
 const r=calculateScenario({...state,coverage},{id:'baseline',name:'原约束',demandBps:10000,actions:[]});assert.equal(r.status,'insufficient');assert.equal(r.totals.fulfilled,null);assert.equal(r.points.length,0);assert.match(r.feasibility.reasons.join(' '),/hotel_service_capacity.*覆盖/);
 }
});

test('weekly evidence candidate derives actual product/channel and unqualified evidence retains immutable snapshot scope',async()=>{
 const {mf,runtime}=await localRuntime();const {encodeInput}=await import('../server/input-storage.ts');
 const snapshot={id:'weekly-origin',businessId:'test-a',dataNature:'demo',asOf:'2026-09-20',periodStart:'2026-09-07',periodEnd:'2026-09-20',productId:'P1',channel:'dy',evidenceIds:{paidUnits:'weekly-direct'},coverage:[{kind:'orders',sourceId:'erp',start:'2026-09-07',end:'2026-09-20'}],limitations:[],data:{inventory:[],weeks:[{start:'2026-09-14',end:'2026-09-20'}],channels:[{channel:'dy'}]}};
 const facts=[{id:'weekly-order',sourceId:'erp',kind:'orders',fact:{business_date:'2026-09-15',occurred_at:'2026-09-15',product_id:'P1',channel:'dy',order_id:'order',entry_type:'paid',quantity:2,amount_cents:20000,variable_cost_cents:10000}}];
 try{
 await runtime.DB.prepare('INSERT INTO operating_snapshots VALUES(?,?,?,?,?)').bind(snapshot.id,'test-a','demo','2026-10-08',JSON.stringify(snapshot)).run();
 await runtime.DB.prepare('INSERT INTO neo_inputs VALUES(?,?,?,?,?)').bind('input-weekly','test-a',snapshot.id,await encodeInput({snapshot,facts,domain:{products:[{id:'P1'}],roles:[],skus:[],arrivals:[]}}),'2026-10-08').run();
 for(const evidenceIds of [[snapshot.id+':view:week:2026-09-14:paidUnits:P1:dy'],['weekly-direct']]){
 const response=await handleApi(new Request('http://localhost/api/v1/agent-memory?businessId=test-a',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({dataNature:'demo',requestId:crypto.randomUUID(),statement:'该商品该渠道的陈述',scope:{entities:['P2'],channels:['other'],period:{start:'2026-09-14',end:'2026-09-20'}},provenance:{kind:'evidence_analysis',inputId:snapshot.id,evidenceIds}})}),runtime),body=await response.json();assert.equal(response.status,201,JSON.stringify(body));assert.deepEqual(body.item.scope.entities,['P1']);assert.deepEqual(body.item.scope.channels,['dy']);assert.equal(body.item.references[0].id,'snapshot:'+snapshot.id);
 }
 }finally{await mf.dispose();}
});
