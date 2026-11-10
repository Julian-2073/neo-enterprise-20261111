import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
test('full-history publication, refresh and explicit historical windows remain compatible and isolated',async()=>{
 const {mf,runtime}=await localRuntime();
 const call=async(path,body)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId=test-a',{method:body?'POST':'GET',headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),runtime);const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 try{
  for(const kind of ['events','orders','inventory','expenses']){
   const form=new FormData();form.set('file',new File([await readFile('public/import-samples/demo-'+kind+'.csv','utf8')],kind+'.csv'));form.set('kind',kind);form.set('sourceName','full-source');form.set('dataNature','demo');form.set('coverageStart','2026-09-01');form.set('coverageEnd','2026-09-02');form.set('templateVersion','1');
   const {batch}=await call('ingestion-batches',form);assert.equal(batch.status,'ready');await call('ingestion-batches/'+batch.id+'/commit',{validationVersion:batch.validation_version});
  }
  const full=(await call('operating-snapshots',{dataNature:'demo',periodMode:'all_imported'})).snapshot;
  assert.equal(full.periodMode,'all_imported');assert.equal(full.periodStart,'2026-09-01');assert.equal(full.periodEnd,'2026-09-02');
  assert.equal((await call('operating-snapshots',{dataNature:'demo'})).snapshot.id,full.id);
  const manual=(await call('operating-snapshots',{dataNature:'demo',asOf:full.asOf,periodStart:'2026-09-02',periodEnd:'2026-09-02'})).snapshot;
  assert.notEqual(manual.id,full.id);assert.equal(manual.periodMode,undefined);
  assert.deepEqual((await call('operating-snapshot?dataNature=demo&snapshotId='+full.id)).snapshot,full);
  const bad=await handleApi(new Request('http://localhost/api/v1/operating-snapshots?businessId=test-a',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({dataNature:'demo',periodMode:'all_imported',periodStart:'2026-09-01'})}),runtime);assert.equal(bad.status,422);
  const other=await handleApi(new Request('http://localhost/api/v1/operating-snapshots?businessId=test-b',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({dataNature:'demo',periodMode:'all_imported'})}),runtime);assert.equal(other.status,422);
 }finally{await mf.dispose();}
});
