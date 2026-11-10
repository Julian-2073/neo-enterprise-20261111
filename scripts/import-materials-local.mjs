// Local verification only. Does not start the web app or dispatch agent tasks.
import assert from 'node:assert/strict';
import {mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localRuntime} from './local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {materialFixtures,seedSimIdentity,SIM_BUSINESS,simSnapshotInput} from './materials-sim-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.equal(await realpath(process.cwd()),await realpath(root),'Run from the isolated data-ingestion checkout');
assert.ok(root.endsWith('/并行优化/2026-10-04/data-ingestion'),'Refuse another checkout');
const persist=process.argv.includes('--persist');
const reportDir=path.join(root,'outputs/optimization-handoff');await mkdir(reportDir,{recursive:true});
const events=[],batchIds=[];
let mf,runtime,snapshot;
async function request(route,method='GET',body){const r=await handleApi(new Request(`http://localhost/api/v1/${route}${route.includes('?')?'&':'?'}businessId=${SIM_BUSINESS}`,{method,headers:{...(method==='POST'?{origin:'http://localhost'}:{}),...(body&&!(body instanceof FormData)?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);events.push({route,method,status:r.status});assert.ok(r.ok,await r.clone().text());return r;}
try{
 ({mf,runtime}=await localRuntime({persist}));await seedSimIdentity(runtime.DB);
 const source='NEO_SIM_SMALL_20261004';
 const existing=await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts WHERE business_id=? AND source_id NOT IN(SELECT id FROM data_sources WHERE business_id=? AND name=?)').bind(SIM_BUSINESS,SIM_BUSINESS,source).first();assert.equal(existing.n,0,'Other data present: use an empty isolated runtime');
 const fixtureDir=path.join(reportDir,'synthetic-small-inputs');await mkdir(fixtureDir,{recursive:true});
 for(const [kind,csv] of Object.entries(materialFixtures)){
  await writeFile(path.join(fixtureDir,`${kind}.csv`),csv);
  const f=new FormData();for(const [k,v] of Object.entries({kind,sourceName:source,dataNature:'demo',templateVersion:'2',coverageStart:'2026-04-06',coverageEnd:'2026-09-24'}))f.set(k,v);f.set('file',new File([csv],`sim-${kind}.csv`));
  const a=await(await request('ingestion-batches','POST',f)).json();assert.ok(['ready','committed'].includes(a.batch.status),JSON.stringify(a));
  const saved=await(await request(`ingestion-batches/${a.batch.id}/commit`,'POST',{validationVersion:a.batch.validation_version})).json();batchIds.push(saved.batch.id);
  const again=await(await request('ingestion-batches','POST',f)).json();assert.equal(again.batch.id,a.batch.id);assert.equal(again.reused,true);
  const bytes=new Uint8Array(await(await request(`ingestion-batches/${a.batch.id}/file`)).arrayBuffer());assert.deepEqual(bytes,new TextEncoder().encode(csv));
 }
 snapshot=(await(await request('operating-snapshots','POST',simSnapshotInput)).json()).snapshot;
 assert.equal(snapshot.data.financial.contributionMarginCents,8000);assert.equal(snapshot.data.materials.customerAnalysis.conversionRate,0.5);assert.equal(snapshot.data.materials.supply.products.find(p=>p.productId==='sim-r1').sellableUnits,7);
 await writeFile(path.join(reportDir,'saved-snapshot.json'),JSON.stringify(snapshot,null,2)+'\n');
 const ev=await(await request(`evidence/${encodeURIComponent(snapshot.evidenceIds.customerAnalysis)}?limit=100`)).json();assert.ok(ev.records.some(r=>r.kind==='customer_identities'));await writeFile(path.join(reportDir,'saved-customer-evidence.json'),JSON.stringify(ev,null,2)+'\n');
 const facts=(await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts WHERE business_id=?').bind(SIM_BUSINESS).first()).n;
 const untouched=await runtime.DB.prepare("SELECT COUNT(*) n FROM business_facts WHERE business_id IN ('test-a','test-b','neo-live-demo')").first();assert.equal(untouched.n,0);
 await mf.dispose();mf=undefined;
 if(persist){({mf,runtime}=await localRuntime({persist:true}));const s=(await(await request(`operating-snapshot?dataNature=demo&snapshotId=${snapshot.id}`)).json()).snapshot;assert.deepEqual(s,snapshot);const d=await(await request(`agent-domain?dataNature=demo&snapshotId=${snapshot.id}`)).json();assert.equal(d.products.length,2);const bytes=new Uint8Array(await(await request(`ingestion-batches/${batchIds[0]}/file`)).arrayBuffer());assert.deepEqual(bytes,new TextEncoder().encode(materialFixtures.roles));}
 const result={status:'local_backend_verified',persisted:persist,verification:'actual handleApi + D1/R2; reopen process runtime, not browser sessions',businessId:SIM_BUSINESS,provenance:'SYNTHETIC_DEMO',snapshotId:snapshot.id,facts,batchIds,untouchedBusinessFacts:untouched.n,events,createdAt:new Date().toISOString()};
 await writeFile(path.join(reportDir,'local-import-readback.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,snapshotId:result.snapshotId,facts,batches:batchIds.length,persisted:persist,requests:events.length}));
}catch(e){await writeFile(path.join(reportDir,'local-import-failure.json'),JSON.stringify({message:String(e),events},null,2));throw e;}finally{await mf?.dispose();}
