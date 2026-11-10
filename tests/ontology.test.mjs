import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {neoDefinition,validateDefinition,queryObjects} from '../server/ontology/model.ts';
import {project} from '../server/ontology/project.ts';
import {envelopeForBuild} from '../server/ontology/store.ts';
import {context} from '../server/auth.ts';
import {gunzipSync} from 'node:zlib';
let mf,runtime,defId,buildId,snapshotId,forecastId,scenarioId;
before(async()=>{({mf,runtime}=await localRuntime());});
after(async()=>{await mf?.dispose();});
async function request(path,method='GET',body,opts={}){const response=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId='+(opts.business??'test-a'),{method,headers:{origin:opts.origin??'http://localhost',...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),opts.runtime??runtime);const data=await response.json();return {status:response.status,data};}
async function ok(path,method='GET',body,opts){const r=await request(path,method,body,opts);assert.ok(r.status<300,JSON.stringify(r));return r.data;}
const scoped=(path)=>`ontology/${path}${path.includes('?')?'&':'?'}dataNature=demo`;
async function action(input,reqId=crypto.randomUUID()){return ok(scoped('actions/submit'),'POST',{dataNature:'demo',requestId:reqId,...input});}
async function upload(typeId,csv){const form=new FormData();for(const [k,v] of Object.entries({typeId,definitionId:defId,dataNature:'demo',sourceName:'test-master'}))form.set(k,v);form.set('file',new File([csv],'master.csv'));return ok(scoped('imports'),'POST',form);}
async function committed(type,csv){const r=await upload(type,csv);assert.equal(r.batch.status,'ready',JSON.stringify(r));await action({action:'commit_import',batchId:r.batch.id});return r.batch;}
test('core rejects invalid mappings and supports declared many-to-many association objects',()=>{
 const d=neoDefinition();d.types.push({id:'tag',name:'Tag',primaryKey:'key',title:'key',properties:{key:{type:'string',required:true}}},{id:'assignment',name:'Assignment',primaryKey:'id',title:'id',properties:{id:{type:'string'},skuId:{type:'string'},tagId:{type:'string'}}});d.links.push({id:'sku_tag',name:'SKU tags',from:'sku',to:'tag',property:'',cardinality:'many-to-many',through:{typeId:'assignment',fromProperty:'skuId',toProperty:'tagId'}});validateDefinition(d);
 const input={facts:[],domain:[],artifacts:[],edits:[],imports:[{id:'i',availableAt:'2026-10-01T00:00:00Z',typeId:'sku',rows:[{id:'s',productId:'p'}]},{id:'j',availableAt:'2026-10-01T00:00:00Z',typeId:'tag',rows:[{key:'t'}]},{id:'k',availableAt:'2026-10-01T00:00:00Z',typeId:'assignment',rows:[{id:'a',skuId:'s',tagId:'t'}]}]};
 const p=project(input,d,'2026-10-01');assert.equal(queryObjects(p.objects,p.links,d,{typeId:'sku',traverse:{linkId:'sku_tag',direction:'out'}}).items[0].id,'t');
 const oldDomain=project({...input,imports:[],domain:[{id:'domain',kind:'skus',availableAt:'2026-10-01T00:00:00Z',payload:{id:'old-sku',product_id:'old-product',role_id:'lead'}}]},neoDefinition(),'2026-10-01');assert.equal(oldDomain.issues.some(i=>i.severity==='error'),false);assert.ok(oldDomain.links.find(l=>l.linkId==='sku_product'));assert.ok(oldDomain.links.find(l=>l.linkId==='sku_role'));
 d.types[0].mapping={id:{field:'id',scale:NaN}};assert.throws(()=>validateDefinition(d));
});
test('definitions are virtual until explicitly published; optimistic publication and no GET mutations',async()=>{
 const d=await ok(scoped('definitions'));assert.equal(d.definition.version,'neo-default-v2');assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_definitions').first()).n,0);
 d.definition.types.push({id:'vendor',name:'供应商',primaryKey:'code',title:'name',properties:{code:{type:'string',required:true},name:{type:'string'},rating:{type:'number'},groupId:{type:'string'},date:{type:'date'}},effectiveField:'date'},{id:'vendor_group',name:'供应商组',primaryKey:'code',title:'code',properties:{code:{type:'string',required:true}}});
 d.definition.links.push({id:'vendor_group',name:'所属组',from:'vendor',to:'vendor_group',property:'groupId',cardinality:'many-to-one'});
 const product=d.definition.types.find(t=>t.id==='product');product.mapping={id:{field:'商品编号'},name:{field:'商品名称'}};
 const a=await ok(scoped('definitions'),'POST',{baseId:'neo-default-v2',definition:d.definition});const b=await ok(scoped('definitions'),'POST',{baseId:'neo-default-v2',definition:d.definition});
 await action({action:'publish_definition',draftId:a.id});defId=a.id;assert.equal((await request(scoped('actions/submit'),'POST',{dataNature:'demo',requestId:'stale-def',action:'publish_definition',draftId:b.id})).status,409);
});
test('CSV stage, R2 readback, duplicate import, invalid primary key and real custom type import',async()=>{
 const raw='code,name,rating,groupId,date\nv1,厂家甲,2,g1,2026-09-01\nv2,厂家乙,5,g1,2026-09-02\nv3,未来,9,g1,2026-12-01';const batch=await committed('vendor',raw);const replay=await upload('vendor',raw);assert.equal(replay.reused,true);assert.equal(replay.batch.id,batch.id);
 const file=await handleApi(new Request('http://localhost/api/v1/ontology/imports/'+batch.id+'/file?businessId=test-a&dataNature=demo'),runtime);assert.equal(await file.text(),raw);
 assert.equal((await upload('vendor','code,name\nv1,a\nv1,b')).batch.status,'invalid');
 await committed('vendor_group','code\ng1');await committed('product','商品编号,商品名称\nP1,商品甲');
 const r=await action({action:'build_projection',asOf:'2026-10-01',definitionId:defId});buildId=r.result.id;assert.ok(['partial','ready'].includes(r.result.status));
 const vendors=await ok(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'vendor',filters:[{property:'rating',op:'gte',value:3}]}});assert.equal(vendors.total,1);assert.equal(vendors.items[0].id,'v2');
 const linked=await ok(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'vendor',traverse:{linkId:'vendor_group',direction:'out'}}});assert.equal(linked.total,1);assert.equal(linked.items[0].id,'g1');
 const fn=await ok(scoped('functions/sum/runs'),'POST',{dataNature:'demo',buildId,requestId:'vendor-sum',query:{typeId:'vendor'},property:'rating'});assert.equal(fn.result.aggregate.value,7);
});
test('historical availability, two enterprises and data nature are isolated including empty builds',async()=>{
 const empty=await action({action:'build_projection',asOf:'2026-10-01',knownAt:'2026-09-30T00:00:00Z'});assert.equal(empty.result.counts.objects,0);
 const b=await ok(scoped('builds'),'POST',{dataNature:'demo',requestId:'empty-b',asOf:'2026-10-01',knownAt:'2026-09-30T00:00:00Z'},{business:'test-b'});assert.notEqual(b.result.id,empty.result.id);
 assert.equal((await request(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'vendor'}},{business:'test-b'})).status,404);
 assert.equal((await request(scoped('objects/query'),'POST',{dataNature:'business',buildId,query:{typeId:'vendor'}})).status,404);
});
test('query, save/reopen ObjectSet, version immutability and auth checks',async()=>{
 const s=await ok(scoped('object-sets'),'POST',{dataNature:'demo',buildId,name:'高评分供应商',query:{typeId:'vendor',filters:[{property:'rating',op:'gte',value:3}]}});assert.equal((await ok(scoped('object-sets/'+s.id))).result.total,1);
 const rt={...runtime,local:{...runtime.local,userId:'local-reader'}};
 assert.equal((await request(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'vendor'}},{runtime:rt})).status,200);
 assert.equal((await request(scoped('builds'),'POST',{dataNature:'demo',requestId:'reader',asOf:'2026-10-01'},{runtime:rt})).status,403);
 assert.equal((await request(scoped('definitions'),'POST',{baseId:defId,definition:neoDefinition()},{origin:'https://other.test'})).status,403);
 const before=await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_runs').first();await ok(scoped('resources')+'&buildId='+buildId);await ok(scoped('graph')+'&buildId='+buildId);await ok(scoped('runs'));const after=await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_runs').first();assert.equal(before.n,after.n);
});
test('four existing immutable fact sources connect to Ontology and snapshot-backed computation',async()=>{
 for(const kind of ['orders','events','inventory','expenses']){const f=new FormData();f.set('file',new File([await readFile(`public/import-samples/demo-${kind}.csv`)],'facts.csv'));for(const [k,v] of Object.entries({kind,dataNature:'demo',sourceName:'facts',coverageStart:'2026-09-01',coverageEnd:'2026-09-02',templateVersion:'1'}))f.set(k,v);const r=await ok('ingestion-batches','POST',f);await ok('ingestion-batches/'+r.batch.id+'/commit','POST',{validationVersion:r.batch.validation_version});}
 const s=await ok('operating-snapshots','POST',{dataNature:'demo',asOf:'2026-09-02',periodStart:'2026-09-01',periodEnd:'2026-09-02'});snapshotId=s.snapshot.id;assert.equal((await ok(scoped('snapshots'))).items[0].as_of,'2026-09-02');
 const b=await action({action:'build_projection',snapshotId,definitionId:defId});buildId=b.result.id;assert.ok(b.result.counts.types.order_line);assert.equal(JSON.parse((await runtime.DB.prepare('SELECT input FROM ontology_builds WHERE id=?').bind(buildId).first()).input).definition.version,defId);assert.ok(b.result.counts.links);
 const q=await ok(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'sku',traverse:{linkId:'sku_product',direction:'out'}}});assert.ok(q.items.some(o=>o.id==='P1'));assert.equal(q.items.find(o=>o.id==='P1').title,'商品甲');
 const fn=await ok(scoped('functions/metrics/runs'),'POST',{dataNature:'demo',buildId,requestId:'metrics'});assert.equal(fn.result.data.financial.netRevenueCents,20000);
});
test('forecast/scenario/choice adapter saves a pinned result and replay never dispatches twice',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url,options)=>{calls++;const b=JSON.parse(options.body);assert.equal(b.envelope.ontologyRef.buildId,buildId);assert.equal(b.envelope.snapshot.id,snapshotId);assert.ok(b.envelope.facts.length);return Response.json({snapshotId,calculationVersion:'TEST_CALCULATION_ADAPTER',inputHash:'TEST_FROZEN_INPUT',totals:{units:10,netRevenueCents:20000},evidenceIds:Object.values(b.envelope.snapshot.evidenceIds),limitations:['TEST_CALCULATION_ADAPTER']});};
 const rt={...runtime,NEO_AGENT_URL:'http://test-service',NEO_SERVICE_TOKEN:'test-token'};
 try{const input={dataNature:'demo',buildId,requestId:'forecast'};const f=await ok(scoped('functions/forecast/runs'),'POST',input,{runtime:rt});forecastId=f.result.id;assert.equal((await ok(scoped('functions/forecast/runs'),'POST',input,{runtime:rt})).id,f.id);assert.equal(calls,1);
 assert.equal((await request(scoped('functions/forecast/runs'),'POST',{...input,requestId:'subset',query:{typeId:'sku'}},{runtime:rt})).status,422);assert.equal(calls,1);
 const s=await ok(scoped('functions/scenario/runs'),'POST',{dataNature:'demo',buildId,requestId:'scenario',baselineId:forecastId,assumptions:{}},{runtime:rt});scenarioId=s.result.id;
 const d=await action({action:'save_decision',buildId,scenarioId,reason:'先核对库存'});assert.equal(d.result.ontologyRef.buildId,buildId);assert.equal(JSON.parse((await runtime.DB.prepare('SELECT payload FROM neo_artifacts WHERE id=?').bind(d.result.id).first()).payload).reason,'先核对库存');
 const old=JSON.parse((await runtime.DB.prepare('SELECT payload FROM neo_artifacts WHERE id=?').bind(forecastId).first()).payload);
 for(const [name,change] of [['version',{calculationVersion:'different'}],['input',{inputHash:'different'}],['missing',{calculationVersion:null}]]){
  await runtime.DB.prepare('UPDATE neo_artifacts SET payload=? WHERE id=?').bind(JSON.stringify({...old,...change}),forecastId).run();
  const failed=await request(scoped('functions/scenario/runs'),'POST',{dataNature:'demo',buildId,requestId:'reject-'+name,baselineId:forecastId,assumptions:{}},{runtime:rt});assert.equal(failed.status,409);assert.equal(failed.data.error.code,'CALCULATION_CONFLICT');
 }
 await runtime.DB.prepare('UPDATE neo_artifacts SET payload=? WHERE id=?').bind(JSON.stringify(old),forecastId).run();
 }finally{globalThis.fetch=original;}
});
test('controlled editing retains facts, returns conflict, and replays exact committed requests',async()=>{
 const before=(await ok(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'product'}})).items.find(o=>o.id==='P1');const input={action:'edit_property',buildId,typeId:'product',objectId:'P1',property:'roleId',value:null};
 const r=await action(input,'edit-once');assert.notEqual(r.result.id,buildId);assert.equal((await action(input,'edit-once')).id,r.id);
 assert.equal((await request(scoped('actions/submit'),'POST',{...input,dataNature:'demo',requestId:'edit-stale'})).status,409);
 assert.equal((await ok(scoped('objects/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'product'}})).items.find(o=>o.id==='P1').title,before.title);
 const edits=await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_edits').first();assert.equal(edits.n,1);
 const impossible=await request(scoped('actions/preview'),'POST',{...input,dataNature:'demo',buildId:r.result.id,property:'name',value:'override'});assert.equal(impossible.status,422);
});

test('interrupted computation recovers an already saved result before any retry',async()=>{
 const r=(await ok(scoped('runs'))).items.find(r=>r.operation==='forecast'&&r.status==='completed');assert.ok(r);await runtime.DB.prepare("UPDATE ontology_runs SET status='running',result=NULL,created_at='2026-01-01T00:00:00Z' WHERE id=?").bind(r.id).run();const recovered=await ok(scoped('runs/'+r.id+'/recover'),'POST',{});assert.equal(recovered.status,'completed');assert.equal(recovered.result.id,forecastId);
});

test('Agent adapter pins object scope, filters later context, reads saved GET state and explicitly refreshes',async()=>{
 const original=globalThis.fetch;let count=0;let job;globalThis.fetch=async(url,options)=>{count++;if(options.method==='POST'){job=JSON.parse(options.body);assert.equal(job.envelope.ontologyRef.buildId,buildId);assert.equal(job.envelope.decisionContext.forecasts.length,0);assert.equal(job.autoRepeat,false);return Response.json({id:job.id,status:'queued'});}return Response.json({id:job.id,status:'completed',steps:[{message:'对象集读取成功'}],result:{finding:{conclusion:'TEST_ADAPTER',evidenceIds:[],alternatives:[],gaps:[],candidates:[],followups:[]},specialists:{},marketEvidence:[],toolReads:[{tool:'query_objects',status:'completed',ontologyRef:job.envelope.ontologyRef}],ontologyRef:job.envelope.ontologyRef}});};
 const rt={...runtime,NEO_AGENT_URL:'http://test-service',NEO_SERVICE_TOKEN:'test-token'};try{const input={dataNature:'demo',buildId,requestId:'agent-test',mode:'conversion',question:'核查对象',query:{typeId:'product'}};const r=await ok(scoped('agents/runs'),'POST',input,{runtime:rt});assert.equal(r.status,'dispatched');assert.ok(r.result.agentRunId);const before=count;assert.equal((await ok(scoped('runs/'+r.id),'GET',undefined,{runtime:rt})).status,'dispatched');assert.equal(before,count);const updated=await ok(scoped('runs/'+r.id+'/refresh'),'POST',{}, {runtime:rt});assert.equal(updated.status,'completed');const graph=await ok(scoped('graph?view=trace&runId='+r.id));assert.ok(graph.nodes.find(n=>n.name==='query_objects'));}finally{globalThis.fetch=original;}
});

test('large object views are transported losslessly within the existing service body budget',async()=>{
 for(let chunk=0;chunk<2;chunk++){const rows=Array.from({length:500},(_,i)=>`large-${chunk*500+i},${'a'.repeat(1950)},1,,`).join('\n');await committed('vendor','code,name,rating,groupId,date\n'+rows);}
 const s=await ok('operating-snapshots','POST',{dataNature:'demo',asOf:'2026-09-03',periodStart:'2026-09-01',periodEnd:'2026-09-02'});const b=await action({action:'build_projection',snapshotId:s.snapshot.id,definitionId:defId});
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);const env=await envelopeForBuild(ctx,b.result.id);assert.equal(env.ontologyPacked.codec,'gzip-base64');assert.ok(new TextEncoder().encode(JSON.stringify(env)).length<1900000);const decoded=JSON.parse(gunzipSync(Buffer.from(env.ontologyPacked.payload,'base64')));assert.equal(decoded.objects.filter(o=>o.typeId==='vendor').length,1002);assert.equal(decoded.ref.buildId,b.result.id);assert.equal(decoded.links.length,b.result.counts.links);
});

test('lineage uses fact mappings and health probes are explicit saved operations',async()=>{
 const lineage=await ok(scoped('graph?view=lineage')+'&buildId='+buildId);assert.ok(lineage.nodes.some(n=>n.category==='mapping'));assert.ok(lineage.nodes.some(n=>n.category==='fact'));assert.ok(lineage.edges.length);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({status:'ok',ontologyVersion:'objectset-v1'});};
 const rt={...runtime,NEO_AGENT_URL:'http://test-service',NEO_SERVICE_TOKEN:'test-token'};
 try{await ok(scoped('health'),'GET',undefined,{runtime:rt});assert.equal(calls,0);const p=await ok(scoped('health/probe'),'POST',{dataNature:'demo',requestId:'health-test'},{runtime:rt});assert.equal(p.result.ontologyReady,true);assert.equal(calls,1);const stored=await ok(scoped('health'),'GET',undefined,{runtime:rt});assert.equal(stored.lastProbe.result.ontologyReady,true);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('results are separate from fixed input, scoped, linked and available only after result time',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({calculationVersion:'TEST_CALCULATION_ADAPTER',inputHash:'TEST_FROZEN_INPUT',modelVersion:'four-week-mean',totals:{units:2},forecastLines:[{skuId:'S1',channelId:'c1',weekStart:'2026-09-03',weekEnd:'2026-09-09',salesBaselineUnits:4,fulfillableUnits:2}],featureSnapshots:[{skuId:'S1',channelId:'c1',asOf:'2026-09-02',lag1Units:4,lag4MeanUnits:4,sourceIds:['f']}],backtest:{status:'insufficient_history'}});
 const rt={...runtime,NEO_AGENT_URL:'http://test-service',NEO_SERVICE_TOKEN:'test-token'};
 try{
 const before=(await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_objects WHERE build_id=?').bind(buildId).first()).n;
 const f=await ok(scoped('functions/forecast/runs'),'POST',{dataNature:'demo',buildId,requestId:'forecast-lines'},{runtime:rt});
 await ok(scoped('functions/scenario/runs'),'POST',{dataNature:'demo',buildId,requestId:'scenario-detail-isolation',baselineId:f.result.id,assumptions:{}},{runtime:rt});
 const q=await ok(scoped('results/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'forecast_line',filters:[{property:'skuId',op:'eq',value:'S1'}]}});assert.equal(q.total,1);assert.equal(q.items[0].properties.baselineUnits,4);assert.equal(q.inputDefinitionId,defId);
 const linked=await ok(scoped('results/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'forecast_line',traverse:{linkId:'line_feature',direction:'out'}}});assert.equal(linked.items[0].typeId,'feature_snapshot');
 assert.equal((await ok(scoped('results/query'),'POST',{dataNature:'demo',buildId,resultAsOf:'2020-01-01T00:00:00Z',query:{typeId:'forecast_line'}})).total,0);
 assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM ontology_objects WHERE build_id=?').bind(buildId).first()).n,before);
 assert.equal((await request(scoped('results/'+f.result.id)+'&buildId='+buildId,'GET',undefined,{business:'test-b'})).status,404);
 const evaluation=await ok(scoped('functions/forecast_evaluate/runs'),'POST',{dataNature:'demo',buildId,actualBuildId:buildId,baselineId:f.result.id,requestId:'evaluation-lines'},{runtime:rt});assert.equal(evaluation.result.kind,'forecast_evaluation');
 assert.equal((await ok(scoped('results/query'),'POST',{dataNature:'demo',buildId,query:{typeId:'forecast_evaluation'}})).total,1);
 }finally{globalThis.fetch=original;}
});
