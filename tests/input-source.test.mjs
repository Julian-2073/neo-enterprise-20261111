import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {context} from '../server/auth.ts';
import {envelope} from '../server/agents.ts';
import {encodeInput} from '../server/input-storage.ts';
import {fixtureCsv} from '../scripts/materials-sim-fixture.mjs';
let mf,runtime,s,env,ctx,other;
before(async()=>{({mf,runtime}=await localRuntime());ctx=await context(new Request('http://localhost/?businessId=test-a'),runtime);});
after(async()=>{await mf?.dispose();});
async function api(route,method='GET',body,bid='test-a'){const r=await handleApi(new Request('http://localhost/api/v1/'+route+(route.includes('?')?'&':'?')+'businessId='+bid,{method,headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);return {status:r.status,...await r.json()};}
async function paid(id,order,line,amount,source,bid='test-a',nature='demo'){
 const csv=fixtureCsv(['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents'],[[id,order,line,'paid','2026-09-02T10:00:00+08:00','sim-channel','sim-p','sim-s',1,amount,amount/2]]);
 const f=new FormData();for(const [k,v] of Object.entries({kind:'orders',templateVersion:'1',dataNature:nature,sourceName:source,coverageStart:'2026-09-01',coverageEnd:'2026-09-24'}))f.set(k,v);f.set('file',new File([csv],id+'.csv'));const u=await api('ingestion-batches','POST',f,bid);assert.equal(u.batch.status,'ready');assert.equal((await api(`ingestion-batches/${u.batch.id}/commit`,'POST',{validationVersion:u.batch.validation_version},bid)).status,200);
}
const input={dataNature:'demo',asOf:'2026-09-24',periodStart:'2026-09-01',periodEnd:'2026-09-24'};
async function snapshot(bid='test-a',extra={}){const r=await api('operating-snapshots','POST',{...input,...extra},bid);assert.equal(r.status,201);return r.snapshot;}
async function cache(value){await runtime.DB.prepare('UPDATE neo_inputs SET payload=? WHERE business_id=? AND snapshot_id=?').bind(await encodeInput(value),'test-a',s.id).run();}

test('new frozen facts keep real sourceId; cross-source same order is two, same-source new batch remains one',async()=>{
 await paid('sim-paid-A','sim-shared','sim-l1',10000,'SIM-A');await paid('sim-paid-B','sim-shared','sim-l1',20000,'SIM-B');s=await snapshot();env=await envelope(ctx,s);assert.equal(s.data.financial.paidOrders,2);assert.equal(s.data.financial.netRevenueCents,30000);
 const rows=(await runtime.DB.prepare('SELECT id,source_id FROM business_facts WHERE business_id=?').bind('test-a').all()).results;assert.ok(env.facts.every(f=>f.sourceId===rows.find(r=>r.id===f.id).source_id));assert.equal(new Set(env.facts.map(f=>f.sourceId)).size,2);
 await paid('sim-paid-A-next','sim-shared','sim-l2',3000,'SIM-A');const next=await snapshot(),nextEnv=await envelope(ctx,next);assert.equal(next.data.financial.paidOrders,2);assert.equal(nextEnv.facts.filter(f=>f.sourceId===env.facts.find(f=>f.fact.source_record_id==='sim-paid-A').sourceId).length,2);assert.deepEqual(await envelope(ctx,s),env);
});

test('old JSON and gzip cache enrich only frozen IDs without rewriting stored payload',async()=>{
 const old=structuredClone(env);for(const f of old.facts){delete f.sourceId;delete f.availableAt;}
 for(const value of [old,{...old,cachePadding:'legacy-padding'.repeat(160000)}]){await cache(value);const bytes=(await runtime.DB.prepare('SELECT payload FROM neo_inputs WHERE snapshot_id=?').bind(s.id).first()).payload;const read=await envelope(ctx,s);assert.deepEqual(read.facts,env.facts);assert.equal(read.facts.length,2);assert.equal((await runtime.DB.prepare('SELECT payload FROM neo_inputs WHERE snapshot_id=?').bind(s.id).first()).payload,bytes);if(value.cachePadding)assert.equal(JSON.parse(bytes).storageFormat,'neo-inputs-gzip-v1');}
 await cache(env);
});

test('tenant, nature, snapshot membership and conflicting provenance cannot cross the cache boundary',async()=>{
 await paid('sim-paid-other','sim-other','sim-l1',10000,'SIM-OTHER','test-b');const b=await snapshot('test-b');other=await envelope(await context(new Request('http://localhost/?businessId=test-b'),runtime),b);
 await assert.rejects(()=>envelope(ctx,b),e=>e.status===404);await assert.rejects(()=>envelope(ctx,{...s,dataNature:'business'}),e=>e.status===404);
 for(const mutation of [x=>{x.snapshot.businessId='test-b';},x=>{x.snapshot.dataNature='business';},x=>{x.snapshot.id='sim-another-snapshot';},x=>{x.snapshot.productId='sim-outside';},x=>{x.snapshot.periodEnd='2026-09-25';},x=>{x.facts[0]=other.facts[0];},x=>{x.facts[0].sourceId='sim-forged-source';},x=>{x.facts[0].availableAt='2026-04-06T00:00:00Z';}]){const bad=structuredClone(env);mutation(bad);await cache(bad);await assert.rejects(()=>envelope(ctx,s),e=>['INPUT_SCOPE','INPUT_PROVENANCE'].includes(e.code));}
 const newer=await envelope(ctx,await snapshot()),later=newer.facts.find(f=>f.fact.source_record_id==='sim-paid-A-next');await cache({...env,facts:[...env.facts,later]});await assert.rejects(()=>envelope(ctx,s),e=>e.code==='INPUT_PROVENANCE');await cache(env);
});

test('legacy source_id spelling is checked, never inferred from batches or IDs',async()=>{
 const legacy=structuredClone(env);for(const f of legacy.facts){f.source_id=f.sourceId;delete f.sourceId;}await cache(legacy);const read=await envelope(ctx,s);assert.ok(read.facts.every(f=>f.source_id===f.sourceId));legacy.facts[0].source_id='sim-wrong';await cache(legacy);await assert.rejects(()=>envelope(ctx,s),e=>e.code==='INPUT_PROVENANCE');await cache(env);
});
