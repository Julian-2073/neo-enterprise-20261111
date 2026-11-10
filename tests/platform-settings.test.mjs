import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {context} from '../server/auth.ts';
import {configuredAgentEnvelope} from '../server/platform-settings.ts';
import {defaultPlatformSettings} from '../lib/platform-settings.ts';
let runtime,mf;before(async()=>({runtime,mf}=await localRuntime()));after(async()=>mf.dispose());
async function api(path,body,{business='test-a',nature='demo',rt=runtime}={}){const url=`http://localhost/api/v1/${path}${path.includes('?')?'&':'?'}businessId=${business}&dataNature=${nature}`;const response=await handleApi(new Request(url,{method:body?'POST':'GET',headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),rt);return {status:response.status,data:await response.json()};}
async function save(settings,options={}){const active=await api('ontology/platform',null,options);return api('ontology/platform/drafts',{settings,baseId:active.data.id},options);}
test('draft/preview are invisible to runtime; publish is isolated and feeds new snapshots, old snapshots fixed',async()=>{
 const original=await api('ontology/platform/snapshots',{dataNature:'demo'});assert.equal(original.status,201);const old=original.data.snapshot;
 const settings=defaultPlatformSettings();settings.statisticsWeeks=4;settings.customerFunnel={cohortStage:'A2',conversionWindowDays:10,channelPolicy:'same_channel'};settings.agents.supply.instructions='优先核对到货计划';settings.agents.market.tools=[];
 const draft=await save(settings);assert.equal(draft.status,201);const preview=await api(`ontology/platform/drafts/${draft.data.id}/preview`,{});assert.equal(preview.status,200);assert.equal((await api('ontology/platform')).data.id,null);
 const published=await api(`ontology/platform/drafts/${draft.data.id}/publish`,{});assert.equal(published.status,200);assert.equal((await api('ontology/platform',null,{nature:'business'})).data.id,null);assert.equal((await api('ontology/platform',null,{business:'test-b'})).data.id,null);
 const snapshot=await api('ontology/platform/snapshots',{dataNature:'demo'});assert.equal(snapshot.status,201);assert.equal(snapshot.data.snapshot.platformConfigId,draft.data.id);assert.equal((Date.parse(snapshot.data.snapshot.periodEnd)-Date.parse(snapshot.data.snapshot.periodStart))/86400000,27);assert.equal(snapshot.data.snapshot.data.materials.customerAnalysis.rule.conversionWindowDays,10);assert.equal(snapshot.data.automaticInvestigation,'not_started');
 const reread=await api(`operating-snapshot?snapshotId=${old.id}`);assert.deepEqual(reread.data.snapshot,old);
 const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);const env=await configuredAgentEnvelope(ctx,'demo','supply',{snapshot:old});assert.equal(env.platformConfiguration.id,draft.data.id);assert.equal(env.platformConfiguration.agents.supply.instructions,'优先核对到货计划');
 const agents=await api('ontology/agents');assert.deepEqual(agents.data.items.find(a=>a.id==='market').tools,['describe_business','read_business','query_objects']);assert.equal(agents.data.items.find(a=>a.id==='supply').configurationId,draft.data.id);
});
test('publish handles repeat requests and races; stale drafts cannot replace active version',async()=>{
 const settings=defaultPlatformSettings(),a=await save(settings),b=await save({...settings,statisticsWeeks:12});
 const results=await Promise.all([api(`ontology/platform/drafts/${a.data.id}/publish`,{}),api(`ontology/platform/drafts/${b.data.id}/publish`,{})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results[0].status===200?a:b;const replay=await api(`ontology/platform/drafts/${winner.data.id}/publish`,{});assert.equal(replay.status,200);assert.equal(replay.data.reused,true);
 const duplicate=await save(settings);const repeat=await Promise.all([api(`ontology/platform/drafts/${duplicate.data.id}/publish`,{}),api(`ontology/platform/drafts/${duplicate.data.id}/publish`,{})]);assert.deepEqual(repeat.map(r=>r.status),[200,200]);
});
test('invalid rules and tool escalation rejected; reader cannot create config; disabled specialist cannot dispatch',async()=>{
 const settings=defaultPlatformSettings();assert.equal((await save({...settings,statisticsWeeks:0})).status,422);settings.agents.supply.tools=['search_market'];assert.equal((await save(settings)).status,422);settings.agents.supply.tools=[];const rt={...runtime,local:{...runtime.local,userId:'local-reader'}};assert.equal((await save(settings,{rt})).status,403);
 settings.agents.supply.enabled=false;const draft=await save(settings);await api(`ontology/platform/drafts/${draft.data.id}/publish`,{});const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);await assert.rejects(configuredAgentEnvelope(ctx,'demo','supply',{}),e=>e.code==='AGENT_DISABLED');
});
test('workbench operating input runs canonical validation→commit→frontend snapshot',async()=>{
 const f=new FormData();f.set('file',new File(['source_record_id,order_id,order_line_id,entry_type,occurred_at,channel,product_id,sku_id,quantity,amount_cents\nplatform-order,po,pl,paid,2026-09-02T10:00:00+08:00,ch,p1,s1,2,4000'],'form-orders.csv'));for(const [k,v] of Object.entries({kind:'orders',templateVersion:'1',sourceName:'workbench',dataNature:'demo',coverageStart:'2026-09-01',coverageEnd:'2026-09-02'}))f.set(k,v);
 const upload=await api('ingestion-batches',f,{business:'test-b'});assert.equal(upload.status,201);assert.equal(upload.data.batch.status,'ready');const commit=await api(`ingestion-batches/${upload.data.batch.id}/commit`,{validationVersion:upload.data.batch.validation_version},{business:'test-b'});assert.equal(commit.status,200);
 const snap=await api('ontology/platform/snapshots',{dataNature:'demo',asOf:'2026-09-07'},{business:'test-b'});assert.equal(snap.status,201);assert.equal(snap.data.snapshot.data.financial.paidOrders,1);assert.equal(snap.data.snapshot.data.financial.netRevenueCents,4000);assert.ok(snap.data.snapshot.batchIds.includes(upload.data.batch.id));
});
test('invalid form input can correct coverage and revalidate; ready and committed coverage remain immutable',async()=>{
 async function input(start){const f=new FormData();f.set('file',new File(['source_record_id,occurred_at,channel,amount_cents\nretry-fee,2026-10-03T10:00:00+08:00,ch,100'],'repair.csv'));for(const [k,v] of Object.entries({kind:'expenses',templateVersion:'1',sourceName:'coverage-retry',dataNature:'demo',coverageStart:start,coverageEnd:start}))f.set(k,v);return api('ingestion-batches',f,{business:'test-b'});}
 const invalid=await input('2026-10-06');assert.equal(invalid.data.batch.status,'invalid');
 const ready=await input('2026-10-03');assert.equal(ready.data.batch.id,invalid.data.batch.id);assert.equal(ready.data.batch.status,'ready');assert.ok(ready.data.batch.validation_version>invalid.data.batch.validation_version);
 assert.equal((await api(`ingestion-batches/${ready.data.batch.id}/commit`,{validationVersion:invalid.data.batch.validation_version},{business:'test-b'})).status,409);
 assert.equal((await api(`ingestion-batches/${ready.data.batch.id}/commit`,{validationVersion:ready.data.batch.validation_version},{business:'test-b'})).status,200);
 assert.equal((await input('2026-10-06')).status,409);
});
