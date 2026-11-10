import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {seedSimIdentity} from './materials-sim-fixture.mjs';
import {adapt,BID} from './materials-full24/adapt.mjs';
import {independentOracle} from './materials-full24/oracle.mjs';
import {handleApi} from '../server/api.ts';
const root=process.cwd(),out=path.join(root,'outputs/stable-local'),seed=path.join(out,'simulation.json');await mkdir(out,{recursive:true});
const {mf,runtime}=await localRuntime({persistRoot:path.join(out,'runtime')});
async function req(route,body){const r=await handleApi(new Request('http://localhost/api/v1/'+route+(route.includes('?')?'&':'?')+'businessId='+BID,{method:body?'POST':'GET',headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);const data=await r.json();assert.ok(r.status<400,JSON.stringify(data));return data;}
try{
 const existing=await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts').first();
 if(existing.n){const saved=JSON.parse(await readFile(seed));const r=await req('operating-snapshot?dataNature=demo&snapshotId='+saved.snapshotId);assert.equal(r.snapshot.id,saved.snapshotId);console.log('隔离模拟资料已存在，保留当前数据。');}
 else{
  await seedSimIdentity(runtime.DB);const map=await adapt(out);
  for(const meta of map.batches){const f=new FormData();for(const [k,v]of Object.entries({kind:meta.kind,templateVersion:meta.templateVersion,sourceName:meta.sourceName,dataNature:'demo',coverageStart:meta.coverageStart,coverageEnd:meta.coverageEnd}))f.set(k,v);f.set('file',new File([await readFile(path.join(out,meta.file))],path.basename(meta.file)));const u=await req('ingestion-batches',f);assert.equal(u.batch.status,'ready');const committed=await req('ingestion-batches/'+u.batch.id+'/commit',{validationVersion:u.batch.validation_version});assert.equal(committed.batch.status,'committed');}
  const oracle=await independentOracle(),p=oracle.periods.full24;
  const {snapshot:s}=await req('operating-snapshots',{dataNature:'demo',asOf:p.asOf,periodStart:p.start,periodEnd:p.end,customerFunnel:{cohortStage:'A3',conversionWindowDays:7,channelPolicy:'same_channel'}});
  assert.deepEqual(s.data.financial,p.financial);assert.equal(s.data.inventoryCostCents,p.inventoryCostCents);
  await writeFile(seed,JSON.stringify({version:'neo-main-stable-20261005',dataLabel:'SYNTHETIC_DEMO',businessId:BID,snapshotId:s.id,sourceSha256:map.sourceSha256,facts:existing.n+map.expectedCoreFacts+map.expectedMaterialFacts,batches:map.batches.length,originalEnterpriseDatabaseTouched:false},null,2)+'\n');
  console.log('隔离模拟资料正式导入完成：'+map.batches.length+' 批；原企业数据库未写入。');
 }
}finally{await mf.dispose();}
