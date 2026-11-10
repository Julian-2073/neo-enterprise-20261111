import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
const base='http://127.0.0.1:3102';
const checks=[];
async function request(path,method='GET',body,status=200){const r=await fetch(`${base}/api/v1/${path}`,{method,headers:method==='POST'?{origin:base,'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();checks.push({method,path,status:r.status,cache:r.headers.get('cache-control')});assert.equal(r.status,status,JSON.stringify(d));return d;}
const before='snap-45feb84a552351cde56d2a00899df97b57dd18309a5b9b990ae1d17730021630';
const after='snap-a963bdd2df6b0548d1113bae19f6da96525ee4031261b12274c47c496e74f631';
const old100='snap-aa67f4067707d090685b3f0101a48d74e86791dda86d6a281bbfc35297ed74c8';
const p='businessId=test-a&dataNature=demo';
const read=async id=>(await request(`operating-snapshot?${p}&snapshotId=${id}`)).snapshot;
const a=await read(before),b=await read(after),historical=await read(old100);
assert.equal(a.calculationVersion,'ingestion-v1.2');assert.equal(a.data.events.A1,107);assert.equal(a.data.inventoryCostCents,20000);assert.equal(historical.data.events.A1,100);
const expected=JSON.parse(await readFile(new URL('./group2/expected.json',import.meta.url),'utf8')).after;
assert.equal(b.data.events.A1,expected.A1);
for(const k of ['paidOrders','netRevenueCents','spendCents','variableCostCents','contributionMarginCents'])assert.equal(b.data.financial[k],expected[k]);
assert.equal(b.data.inventoryCostCents,expected.inventoryCostCents);assert.equal(b.data.inventory.reduce((n,r)=>n+r.sellable_units,0),expected.sellable);
assert.equal(b.data.weeks[0].events.A1,114);assert.equal(b.data.weeks[0].netRevenueCents,30000);
assert.deepEqual(b.data.channels[0],{channel:'抖音',paidOrders:2,netRevenueCents:30000,spendCents:3000,evidenceId:b.data.channels[0].evidenceId});
const a1=await request(`evidence/${encodeURIComponent(b.evidenceIds.A1)}?${p}`);assert.equal(a1.evidence.value,114);assert.equal(a1.evidence.sourceCount,3);assert.deepEqual(a1.records.map(r=>JSON.parse(r.payload).quantity).sort((x,y)=>x-y),[7,7,100]);
const stock=await request(`evidence/${encodeURIComponent(b.evidenceIds.inventoryCostCents)}?${p}`);assert.equal(stock.evidence.value,30000);assert.equal(stock.evidence.sourceCount,2);
const week=await request(`evidence/${encodeURIComponent(b.evidenceIds['week:2026-09-01'])}?${p}`);assert.equal(week.evidence.value.events.A1,114);
const unknown=await request(`evidence/unknown?${p}`,'GET',undefined,404);assert.ok(unknown.error);
for(const resource of [`evidence/${encodeURIComponent(b.evidenceIds.A1)}`,`ingestion-batches/d86f8823-ed68-4978-81a2-7961637254fb`,`ingestion-batches/d86f8823-ed68-4978-81a2-7961637254fb/file`,`operating-snapshot?snapshotId=${after}`])await request(`${resource}${resource.includes('?')?'&':'?'}businessId=test-b&dataNature=demo`,'GET',undefined,404);
assert.equal((await request('operating-snapshot?businessId=test-b&dataNature=demo')).snapshot,null);
assert.equal((await request('operating-snapshot?businessId=test-a&dataNature=business')).snapshot,null);
const list=(await request(`ingestion-batches?${p}&limit=100`)).items;
assert.equal(list.filter(x=>x.status==='committed').length,9);
for(const id of ['d86f8823-ed68-4978-81a2-7961637254fb','314f51b4-0b7a-4f90-a13e-b6036c9bb920','acbfa545-44be-4b4b-ac84-4506fe989b6c','ef5015ab-4f92-4354-b7e0-f5e8681f26b2']){const d=await request(`ingestion-batches/${id}/commit?${p}`,'POST',{validationVersion:1});assert.equal(d.batch.status,'committed');assert.equal(d.batch.imported_count,1);}
assert.equal((await read(after)).data.events.A1,114);
for(const [id,name] of [['d86f8823-ed68-4978-81a2-7961637254fb','events'],['314f51b4-0b7a-4f90-a13e-b6036c9bb920','orders'],['acbfa545-44be-4b4b-ac84-4506fe989b6c','inventory'],['ef5015ab-4f92-4354-b7e0-f5e8681f26b2','expenses']]){const r=await fetch(`${base}/api/v1/ingestion-batches/${id}/file?${p}`);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),await readFile(new URL(`./group2/${name}.csv`,import.meta.url)));}
assert.ok(checks.every(c=>c.cache?.includes('no-store')));
await writeFile(new URL('./saved-results.json',import.meta.url),JSON.stringify({time:new Date().toISOString(),base,before:a,after:b,historical,checks,batches:list},null,2));
console.log(`PASS: ${checks.length} JSON readbacks, four byte-exact R2 files; 9 committed batches; 107 → 114, ¥200 → ¥300, cost ¥100 → ¥140, spend ¥20 → ¥30, margin ¥80 → ¥130, stock value ¥200 → ¥300. Historical 100 unchanged. No enterprise/business-mode leakage.`);
