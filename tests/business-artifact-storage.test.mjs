import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {storeBusinessArtifact,loadBusinessArtifact,businessArtifactSummary} from '../server/business-artifact-storage.ts';
test('large scenario and decision artifacts retain full points, verify bytes and reject foreign scope',async()=>{
 const {mf,runtime}=await localRuntime();const ctx={businessId:'test-a',runtime};
 try{for(const kind of ['business_scenario_bundle','business_decision']){
  const points=Array.from({length:18000},(_,i)=>({date:'2026-10-01',entityId:'sku-'+i,fulfilled:i,unmet:1,revenueCents:10000}));
  const value={id:kind+'-case',businessId:'test-a',dataNature:'demo',...(kind.endsWith('bundle')?{results:[{id:'baseline',points}]}:{forecast:{id:'candidate',points}})};
  const payload=await storeBusinessArtifact(ctx,'demo',kind,value),ref=JSON.parse(payload);assert.equal(ref.storageFormat,'neo-artifact-r2-v1');assert.ok(payload.length<5000);
  assert.deepEqual(await loadBusinessArtifact(ctx,'demo',kind,payload),value);const summary=businessArtifactSummary(payload);assert.equal((summary.results?.[0]??summary.forecast).pointCount,18000);assert.equal((summary.results?.[0]??summary.forecast).points.length,0);
  await assert.rejects(()=>loadBusinessArtifact({...ctx,businessId:'test-b'},'demo',kind,payload));
  await assert.rejects(()=>loadBusinessArtifact(ctx,'real',kind,payload));
  await runtime.RAW_FILES.put(ref.objectKey,'tampered');await assert.rejects(()=>loadBusinessArtifact(ctx,'demo',kind,payload),/大小/);
 }
 const small={id:'small',businessId:'test-a',dataNature:'demo',results:[{points:[]}]};assert.deepEqual(await loadBusinessArtifact(ctx,'demo','business_scenario_bundle',await storeBusinessArtifact(ctx,'demo','business_scenario_bundle',small)),small);
 }finally{await mf.dispose();}
});
