import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import Papa from 'papaparse';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {parseFile,parseTime,businessDate} from '../server/csv.ts';
import {defaultPeriod} from '../server/snapshots.ts';
let mf,runtime;
before(async()=>{({mf,runtime}=await localRuntime());});
after(async()=>{await mf?.dispose();});
function req(path,method='GET',body,headers={},rt=runtime){return handleApi(new Request(`http://localhost/api/v1/${path}`,{method,headers:{...(method==='POST'?{origin:'http://localhost'}:{}),...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),rt);}
async function upload(kind,csv,{business='test-a',source='test-source',nature='demo',start='2026-09-01',end='2026-09-02',rt=runtime}={}){const form=new FormData();form.set('file',new File([csv],'test.csv'));form.set('kind',kind);form.set('sourceName',source);form.set('dataNature',nature);form.set('coverageStart',start);form.set('coverageEnd',end);form.set('templateVersion','1');const res=await req(`ingestion-batches?businessId=${business}`,'POST',form,{},rt);return{status:res.status,data:await res.json()};}
async function sample(kind){return readFile(`public/import-samples/demo-${kind}.csv`,'utf8');}
async function commit(batch,business='test-a'){const res=await req(`ingestion-batches/${batch.id}/commit?businessId=${business}`,'POST',{validationVersion:batch.validation_version});return{status:res.status,data:await res.json()};}
async function snapshot(input={},business='test-a'){const res=await req(`operating-snapshots?businessId=${business}`,'POST',{dataNature:'demo',asOf:'2026-09-02',periodStart:'2026-09-01',periodEnd:'2026-09-02',...input});return{status:res.status,data:await res.json()};}
const csv=(headers,rows)=>Papa.unparse([headers,...rows]);
test('CSV accepts BOM, quoting, embedded newline and zero, preserves missing values',async()=>{
 const bytes=new TextEncoder().encode('\uFEFFsource_record_id,occurred_at,warehouse_id,product_id,sku_id,sellable_units,inventory_cost_cents\r\ns1,2026-09-01,"仓库,\n东",P1,S1,0,\r\n');
 const d=await parseFile(bytes,'inventory','2026-09-01','2026-09-02');assert.equal(d.issues.length,0);assert.equal(d.rows[0].fact.sellable_units,0);assert.equal(d.rows[0].fact.inventory_cost_cents,null);assert.equal(d.rows[0].fact.warehouse_id,'仓库,\n东');
 const minimum=await parseFile(new TextEncoder().encode('occurred_at,warehouse_id,product_id,sku_id,sellable_units\n2026-09-01,W1,P1,S1,0'),'inventory','2026-09-01','2026-09-02');assert.equal(minimum.issues.length,0);assert.equal(minimum.rows[0].fact.sellable_units,0);assert.ok(minimum.rows[0].fact.source_record_id);
});
test('CSV rejects duplicate headers, unknown columns, missing columns, unsafe integer and invalid dates',async()=>{
 for(const value of ['source_record_id,source_record_id\nx,x','source_record_id,unknown\nx,1','source_record_id,occurred_at,event_type,channel,quantity\nx,2026-02-30,inquiry,抖音,1','source_record_id,occurred_at,event_type,channel,quantity\nx,2026-09-01,inquiry,抖音,9007199254740992']){const d=await parseFile(new TextEncoder().encode(value),'events','2026-09-01','2026-09-02');assert.ok(d.issues.length);}
 for(const date of ['2026-02-29','2026-09-01T24:00:00','2026-09-01T12:00:00+15:00'])assert.throws(()=>parseTime(date));assert.equal(businessDate(parseTime('2026-09-01T18:00:00Z')),'2026-09-02');
 assert.deepEqual(defaultPeriod('2026-09-07'),{start:'2026-07-13',end:'2026-09-06'});
});
test('CSV rejects file size, row limit and non UTF-8',async()=>{
 await assert.rejects(()=>parseFile(new Uint8Array(1024*1024+1),'events','2026-09-01','2026-09-02'),e=>e.status===413);
 await assert.rejects(()=>parseFile(new TextEncoder().encode('source_record_id,occurred_at,event_type,channel,quantity\n'+Array.from({length:1001},(_,i)=>`e${i},2026-09-01,inquiry,抖音,1`).join('\n')),'events','2026-09-01','2026-09-02'),e=>e.status===413);
 await assert.rejects(()=>parseFile(new Uint8Array([255,254]),'events','2026-09-01','2026-09-02'),e=>e.status===422);
});
test('identity, membership, read-only, same-origin, production guard and fake headers',async()=>{
 assert.equal((await req('businesses/current','GET',undefined,{'oai-authenticated-user-id':'local-owner','oai-authenticated-user-email':'fake@example.com'},{...runtime,local:undefined})).status,401);
 assert.equal((await req('businesses/current?businessId=test-a','GET',undefined,{}, {...runtime,local:{...runtime.local,userId:'local-b-only'}})).status,403);
 assert.equal((await req('operating-snapshots?businessId=test-a','POST',{dataNature:'demo'}, {},{...runtime,local:{...runtime.local,userId:'local-reader'}})).status,403);
 assert.equal((await req('operating-snapshots','POST',{dataNature:'demo'},{origin:'https://other.invalid'})).status,403);
 assert.equal((await req('businesses/current','GET',undefined,{}, {...runtime,local:{...runtime.local,development:false}})).status,503);
 const r=await req('businesses/current');assert.equal(r.headers.get('cache-control'),'private, no-store');const current=await r.json();assert.equal(current.businesses.length,2);assert.equal(current.identity.userId,'local-owner');
});
test('four template uploads, staging, transactional commits and R2 byte-for-byte readback',async()=>{
 for(const kind of ['events','orders','inventory','expenses']){
  const raw=await sample(kind);const u=await upload(kind,raw);assert.equal(u.status,201,JSON.stringify(u));assert.equal(u.data.batch.status,'ready');
  const before=await runtime.DB.prepare('SELECT COUNT(*) AS n FROM business_facts WHERE batch_id=?').bind(u.data.batch.id).first();assert.equal(before.n,0);
  const r=await req(`ingestion-batches/${u.data.batch.id}/file?businessId=test-a`);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new TextEncoder().encode(raw));
  const c=await commit(u.data.batch);assert.equal(c.status,200,JSON.stringify(c));assert.equal(c.data.batch.status,'committed');
  const again=await commit(u.data.batch);assert.equal(again.status,200);assert.equal(again.data.batch.imported_count,c.data.batch.imported_count);
 }
});
test('snapshot arithmetic: multi-line order counted once, refunds, stock latest per warehouse, evidence and weeks',async()=>{
 const r=await snapshot();assert.equal(r.status,201,JSON.stringify(r));const s=r.data.snapshot;
 assert.deepEqual(s.data.financial,{paidOrders:1,netRevenueCents:20000,spendCents:2000,variableCostCents:10000,contributionMarginCents:8000});
 assert.equal(s.data.inventory.length,2);assert.equal(s.data.inventory.reduce((a,r)=>a+r.sellable_units,0),4);assert.equal(s.data.inventory.find(r=>r.warehouse_id==='W1').sellable_units,0);
 assert.equal(s.data.events.A1,100);assert.equal(s.data.events.A2,null);assert.equal(s.data.events.A3,10);assert.equal(s.data.channels[0].netRevenueCents,20000);
 const e=await req(`evidence/${encodeURIComponent(s.evidenceIds.netRevenueCents)}?businessId=test-a&limit=1`);const ev=await e.json();assert.equal(ev.records.length,1);assert.equal(ev.nextCursor,1);assert.equal(ev.evidence.sourceCount,3);
 assert.equal((await req(`evidence/${encodeURIComponent(s.evidenceIds.netRevenueCents)}?businessId=test-a&dataNature=business`)).status,404);
 assert.equal((await req(`evidence/${encodeURIComponent(s.evidenceIds.netRevenueCents)}?businessId=test-a&snapshotId=another-snapshot`)).status,404);
 assert.equal((await req(`evidence/${encodeURIComponent(s.evidenceIds.netRevenueCents)}?businessId=test-b`)).status,404);
 assert.equal((await req('evidence/missing?businessId=test-a')).status,404);
 assert.equal((await req(`operating-snapshot?snapshotId=${s.id}&businessId=test-b&dataNature=demo`)).status,404);
 assert.equal((await snapshot()).data.snapshot.id,s.id);
});
test('inventory cost headline has complete latest-stock coverage and its own evidence',async()=>{
 const s=(await snapshot()).data.snapshot;
 assert.equal(s.data.inventoryCostCents,20000);
 const res=await req(`evidence/${encodeURIComponent(s.evidenceIds.inventoryCostCents)}?businessId=test-a`);
 assert.equal(res.status,200);const e=await res.json();
 assert.equal(e.evidence.value,20000);assert.equal(e.evidence.sourceCount,2);
 assert.equal(e.evidence.unit,'人民币分');
 assert.deepEqual(e.records.map(r=>r.row_number).sort(),[3,4]);
 assert.equal((await req(`evidence/${encodeURIComponent(s.evidenceIds.inventoryCostCents)}?businessId=test-b`)).status,404);
});
test('re-upload, overlap, content conflict, nature and enterprise isolation',async()=>{
 const raw=await sample('events');const repeat=await upload('events',raw);assert.equal(repeat.status,200);assert.equal(repeat.data.reused,true);
 const conflictMetadata=await upload('events',raw,{end:'2026-09-03'});assert.equal(conflictMetadata.status,409);
 const overlap=await upload('events',raw.trim()+'\r\nev3,2026-09-02,inquiry,抖音,2,P1,\r\n');assert.equal(overlap.data.batch.duplicate_count,2);assert.equal((await commit(overlap.data.batch)).data.batch.imported_count,1);
 const conflict=await upload('events',raw.replace(',100,',',101,'));assert.equal(conflict.data.batch.status,'invalid');assert.equal((await commit(conflict.data.batch)).status,409);
 const other=await upload('events',raw,{business:'test-b'});assert.equal((await commit(other.data.batch,'test-b')).status,200);
 const distinct=await upload('events',raw,{nature:'business'});assert.equal(distinct.status,201);assert.equal((await commit(distinct.data.batch)).status,200);
 const businessHistory=await(await req('ingestion-batches?businessId=test-a&dataNature=business')).json();assert.equal(businessHistory.items.length,1);assert.equal(businessHistory.items[0].id,distinct.data.batch.id);
 const demoHistory=await(await req('ingestion-batches?businessId=test-a&dataNature=demo')).json();assert.ok(demoHistory.items.every(b=>b.data_nature==='demo'));
 assert.equal((await req('operating-snapshot?businessId=test-a&dataNature=business')).status,200);assert.equal((await req('operating-snapshot?businessId=test-a&dataNature=business')).headers.get('cache-control'),'private, no-store');
});
test('refund validation rejects absent payment, excessive quantities, mismatched SKU and cost reversal',async()=>{
 const heads=['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents'];
 for(const row of [['bad1','missing','L1','refund','2026-09-02','抖音','P1','SKU1',1,1,0],['bad2','O1','L1','refund','2026-09-02','抖音','P1','SKU1',2,10000,0],['bad3','O1','L1','refund','2026-09-02','抖音','P1','other',1,1,0],['bad4','O1','L1','refund','2026-09-02','抖音','P1','SKU1',1,1,9000]]){const u=await upload('orders',csv(heads,[row]));assert.equal(u.data.batch.status,'invalid',JSON.stringify(u));}
});
test('concurrent commits cannot over-refund and rollback leaves no success audit',async()=>{
 const heads=['source_record_id','order_id','order_line_id','entry_type','occurred_at','channel','product_id','sku_id','quantity','amount_cents','variable_cost_cents'];
 const a=await upload('orders',csv(heads,[['race1','O1','L1','refund','2026-09-02','抖音','P1','SKU1',1,6000,3000]]));
 const b=await upload('orders',csv(heads,[['race2','O1','L1','refund','2026-09-02','抖音','P1','SKU1',1,6000,3000]]));assert.equal(a.data.batch.status,'ready');assert.equal(b.data.batch.status,'ready');
 const results=await Promise.all([commit(a.data.batch),commit(b.data.batch)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const failed=results[0].status===409?a.data.batch:b.data.batch;assert.equal((await runtime.DB.prepare('SELECT COUNT(*) AS n FROM business_facts WHERE batch_id=?').bind(failed.id).first()).n,0);assert.equal((await runtime.DB.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE resource_id=?').bind(failed.id).first()).n,0);
});
test('concurrent exact overlaps and duplicate rows are idempotent',async()=>{
 const h=['source_record_id','occurred_at','event_type','channel','quantity'];
 const a=await upload('events',csv(h,[['concurrent1','2026-09-01','like','抖音',1],['concurrent1','2026-09-01','like','抖音',1]]));
 const b=await upload('events',csv(h,[['concurrent1','2026-09-01','like','抖音',1]]));
 assert.equal(a.data.batch.duplicate_count,1);const result=await Promise.all([commit(a.data.batch),commit(b.data.batch)]);assert.ok(result.every(r=>r.status===200),JSON.stringify(result));assert.equal(result.reduce((s,r)=>s+r.data.batch.imported_count,0),1);
});
test('bad rows block valid rows, failed storage is recoverable, staged rows never affect snapshots',async()=>{
 const invalid=await upload('events','source_record_id,occurred_at,event_type,channel,quantity\nnew-good,2026-09-01,inquiry,抖音,1\nnew-bad,2026-02-30,inquiry,抖音,1');assert.equal(invalid.data.batch.status,'invalid');assert.equal((await commit(invalid.data.batch)).status,409);
 const raw='source_record_id,occurred_at,event_type,channel,quantity\nrecover1,2026-09-01,inquiry,抖音,3';
 const failure=await upload('events',raw,{rt:{...runtime,RAW_FILES:{get:runtime.RAW_FILES.get.bind(runtime.RAW_FILES),put:async()=>{throw new Error('Injected R2 failure');}}}});assert.equal(failure.status,503);
 const failed=await runtime.DB.prepare("SELECT * FROM ingestion_batches WHERE status='failed'").first();assert.ok(failed);const again=await upload('events',raw);assert.equal(again.data.batch.id,failed.id);assert.equal(again.data.batch.status,'ready');assert.equal(again.data.batch.validation_version,2);
 const before=(await snapshot()).data.snapshot;assert.ok(!before.batchIds.includes(again.data.batch.id));assert.equal((await commit(again.data.batch)).status,200);
});
test('missing costs suppress margin, partial coverage is explicit, old snapshots immutable',async()=>{
 const old=(await snapshot()).data.snapshot;
 const raw='source_record_id,order_id,order_line_id,entry_type,occurred_at,channel,product_id,sku_id,quantity,amount_cents,variable_cost_cents\nno-cost,O2,L1,paid,2026-09-01,抖音,P1,SKU1,1,5000,';
 const u=await upload('orders',raw);assert.equal((await commit(u.data.batch)).status,200);const fresh=(await snapshot()).data.snapshot;assert.notEqual(fresh.id,old.id);assert.equal(fresh.data.financial.contributionMarginCents,null);
 const historical=await req(`operating-snapshot?businessId=test-a&dataNature=demo&snapshotId=${old.id}`);assert.deepEqual((await historical.json()).snapshot,old);
 const partial=(await snapshot({periodStart:'2026-08-31'})).data.snapshot;assert.ok(partial.limitations.some(x=>x.includes('未完整覆盖')));
 const noData=(await snapshot({dataNature:'business'},'test-b')).data.snapshot;assert.equal(noData.data.financial.netRevenueCents,null);assert.deepEqual(noData.data.inventory,[]);
});
test('conflicting concurrent content cannot overwrite, version mismatch and stable source checks',async()=>{
 const raw='source_record_id,occurred_at,event_type,channel,quantity\nunique-race,2026-09-01,inquiry,抖音,1';const a=await upload('events',raw);const b=await upload('events',raw.replace(',1',',2'));
 const invalidVersion=await req(`ingestion-batches/${a.data.batch.id}/commit?businessId=test-a`,'POST',{validationVersion:99});assert.equal(invalidVersion.status,409);
 const result=await Promise.all([commit(a.data.batch),commit(b.data.batch)]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 const importer={...runtime,local:{...runtime.local,userId:'local-importer'}};assert.equal((await req('businesses/current?businessId=test-a','GET',undefined,{},importer)).status,200);
});
test('D1 commit failure preserves ready batch, snapshot failure preserves committed facts and is independently retryable',async()=>{
 const u=await upload('events','source_record_id,occurred_at,event_type,channel,quantity\nd1-fault,2026-09-01,inquiry,抖音,1');
 const faulty={...runtime,DB:{prepare:runtime.DB.prepare.bind(runtime.DB),batch:async()=>{throw new Error('Injected D1 transaction failure');}}};
 const failed=await req(`ingestion-batches/${u.data.batch.id}/commit?businessId=test-a`,'POST',{validationVersion:1},{},faulty);assert.equal(failed.status,503);
 const readback=await req(`ingestion-batches/${u.data.batch.id}?businessId=test-a`);assert.equal((await readback.json()).batch.status,'ready');assert.equal((await commit(u.data.batch)).status,200);
 const s=await req('operating-snapshots?businessId=test-a','POST',{dataNature:'demo',asOf:'2026-09-02',periodStart:'2026-09-02',periodEnd:'2026-09-02'},{},faulty);assert.equal(s.status,503);
 assert.equal((await req(`ingestion-batches/${u.data.batch.id}?businessId=test-a`)).status,200);assert.equal((await snapshot({periodStart:'2026-09-02',periodEnd:'2026-09-02'})).status,201);
});
test('interrupted validation expires safely and revalidates the original file',async()=>{
 const raw='source_record_id,occurred_at,event_type,channel,quantity\ninterrupted,2026-09-01,inquiry,抖音,1';const u=await upload('events',raw);
 await runtime.DB.prepare("UPDATE ingestion_batches SET status='validating',validation_started_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(u.data.batch.id).run();
 const retry=await upload('events',raw);assert.equal(retry.data.batch.id,u.data.batch.id);assert.equal(retry.data.batch.status,'ready');assert.equal(retry.data.batch.validation_version,2);
});
test('inventory conflicts across sources are rejected and older snapshots do not accumulate',async()=>{
 const raw=await sample('inventory');const duplicate=await upload('inventory',raw,{source:'another-inventory-source'});assert.equal(duplicate.data.batch.status,'ready');assert.equal((await commit(duplicate.data.batch)).data.batch.imported_count,0);
 const conflict=await upload('inventory',raw.replace('stock3,','changed-stock,').replace(',4,20000,',',5,20000,'),{source:'another-inventory-source'});assert.equal(conflict.data.batch.status,'invalid');
 const s=(await snapshot()).data.snapshot;assert.equal(s.data.inventory.reduce((n,r)=>n+r.sellable_units,0),4);
});
test('different partial sources cannot falsely establish complete cost coverage',async()=>{
 const {calculate}=await import('../server/snapshots.ts');
 const partial=[{kind:'orders',source_id:'o',coverage_start:'2026-09-01',coverage_end:'2026-09-02'},{kind:'expenses',source_id:'a',coverage_start:'2026-09-01',coverage_end:'2026-09-01'},{kind:'expenses',source_id:'b',coverage_start:'2026-09-02',coverage_end:'2026-09-02'}];
 assert.equal(calculate([],partial,'2026-09-01','2026-09-02').financial.contributionMarginCents,null);
});
test('malformed quotes produce row errors and error-report formula payloads are escaped',async()=>{
 const d=await parseFile(new TextEncoder().encode('source_record_id,occurred_at,event_type,channel,quantity\nx,2026-09-01,inquiry,"unfinished,1'),'events','2026-09-01','2026-09-02');assert.ok(d.issues.length);
 const u=await upload('events','source_record_id,occurred_at,event_type,channel,quantity,=SUM(A1)\nx,2026-09-01,inquiry,抖音,1,1');assert.equal(u.data.batch.status,'invalid');
 const r=await req(`ingestion-batches/${u.data.batch.id}/issues?businessId=test-a&format=csv`);const report=await r.text();assert.match(report,/'=SUM/);
});
test('inventory headline distinguishes missing and zero cost, guards sum overflow and traces pulse units',async()=>{
 const raw='source_record_id,occurred_at,warehouse_id,product_id,sku_id,sellable_units,inventory_cost_cents\nzero-cost,2026-09-02,W0,P0,S0,0,0\nmissing-cost,2026-09-02,W1,P2,S2,4,\nover-1,2026-09-02,W1,P3,S3,1,9007199254740991\nover-2,2026-09-02,W2,P3,S3,1,1';
 const u=await upload('inventory',raw,{business:'test-b',nature:'business',source:'inventory-headline-cases'});assert.equal(u.data.batch.status,'ready');assert.equal((await commit(u.data.batch,'test-b')).status,200);
 const zero=(await snapshot({dataNature:'business',productId:'P0'},'test-b')).data.snapshot;assert.equal(zero.data.inventoryCostCents,0);
 const missing=(await snapshot({dataNature:'business',productId:'P2'},'test-b')).data.snapshot;assert.equal(missing.data.inventoryCostCents,null);
 const overflow=await snapshot({dataNature:'business',productId:'P3'},'test-b');assert.equal(overflow.status,422);assert.equal(overflow.data.error.code,'TOTAL_OVERFLOW');
 const s=(await snapshot()).data.snapshot;const r=await req(`evidence/${encodeURIComponent(s.evidenceIds.operatingPulse)}?businessId=test-a`);const d=await r.json();assert.equal(r.status,200);assert.equal(d.evidence.unit,'次/笔');assert.deepEqual(d.evidence.value,{events:s.data.events,paidOrders:s.data.financial.paidOrders});assert.ok(d.records.every(r=>['events','orders'].includes(r.kind)));
});
