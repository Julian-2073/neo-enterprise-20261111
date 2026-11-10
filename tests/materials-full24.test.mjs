import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseFile} from '../server/csv.ts';
import {projectMaterials} from '../server/materials/projection.ts';
import {encodeInput,decodeInput} from '../server/input-storage.ts';
import {fixtureCsv} from '../scripts/materials-sim-fixture.mjs';
const parse=(kind,headers,rows)=>parseFile(new TextEncoder().encode(fixtureCsv(headers,rows)),kind,'2026-04-06','2026-09-24');

test('safety basis is explicit; omitted new columns retain legacy canonical material payload',async()=>{
 const old=await parse('supply_rules',['source_record_id','effective_from','rule_id','role_id','minimum_sellable_units','target_ratio_bps'],[['sim-r','2026-04-06','sim-rule','sim-core',5,7500]]);
 assert.equal(old.issues.length,0);for(const key of ['qualification_basis','source_known_at'])assert.equal(Object.hasOwn(old.rows[0].fact,key),false);
 const headers=['source_record_id','effective_from','rule_id','role_id','minimum_sellable_units','target_ratio_bps','qualification_basis'];
 const valid=await parse('supply_rules',headers,[['sim-r','2026-04-06','sim-rule','sim-core','',7500,'inventory_safety_units']]);assert.equal(valid.issues.length,0);assert.equal(valid.rows[0].fact.minimum_sellable_units,null);
 for(const basis of ['', 'invalid', 'minimum_sellable_units'])assert.ok((await parse('supply_rules',headers,[['sim-r','2026-04-06','sim-rule','sim-core','',7500,basis]])).issues.length);
});

test('distinct SKU safety qualification sums warehouse thresholds and does not sum historical stock',()=>{
 const master=(kind,id,fields)=>({id,kind,batch_id:'sim-batch',row_number:2,availableAt:'2026-10-04T00:00:00Z',fact:{object_id:id,effective_from:'2026-04-06',effective_to:null,...fields}});
 const masters=[master('roles','sim-core',{name:'主力品'}),master('products','sim-product',{role_id:'sim-core'}),...['sim-s1','sim-s2'].map(id=>master('skus',id,{product_id:'sim-product'})),master('supply_rules','sim-rule',{role_id:'sim-core',qualification_basis:'inventory_safety_units',minimum_sellable_units:null,target_ratio_bps:7500})];
 const row=(id,sku,wh,date,units,safety)=>({id,kind:'inventory',fact:{sku_id:sku,product_id:'sim-product',warehouse_id:wh,business_date:date,occurred_at:date+'T00:00:00Z',sellable_units:units,safety_units:safety}});
 const facts=[row('sim-old','sim-s1','sim-w1','2026-09-01',100,1),row('sim-new','sim-s1','sim-w1','2026-09-20',0,1),row('sim-other-wh','sim-s1','sim-w2','2026-09-20',3,2),row('sim-s2-stock','sim-s2','sim-w1','2026-09-20',0,0)];
 const input={dataNature:'demo',knownAt:'2026-10-04T00:00:00Z',asOf:'2026-09-24',start:'2026-09-01',end:'2026-09-24',weeks:[{start:'2026-09-01',end:'2026-09-07'},{start:'2026-09-14',end:'2026-09-20'}],customerFunnel:null,observationCovered:false};
 const project=projectMaterials(masters,facts,input),role=project.supply.roles[0];assert.equal(role.skuCount,2);assert.equal(role.observedSkuCount,2);assert.equal(role.qualifiedSkuCount,2);assert.equal(role.qualifiedRatio,1);assert.equal(project.supply.products[0].sellableUnits,3);assert.equal(role.weekly[0].qualifiedRatio,null);
 facts[1].fact.safety_units=null;const missing=projectMaterials(masters,facts,input).supply.roles[0];assert.equal(missing.qualifiedSkuCount,null);assert.equal(missing.qualifiedRatio,null);
});

test('arrival source time, overdue ETA, reschedule and partial receipt remain separate from availability',async()=>{
 const headers=['source_record_id','effective_from','arrival_id','sku_id','warehouse_id','eta','units','status','received_units','source_known_at','source_version'];
 const raw=['sim-v2','2026-09-20','sim-plan','sim-sku','sim-wh','2026-09-10',10,'partially_received',3,'2026-09-20T08:00:00+08:00',2];
 const good=await parse('arrivals',headers,[raw]);assert.equal(good.issues.length,0);assert.equal(good.rows[0].fact.eta,'2026-09-10');assert.equal(good.rows[0].fact.received_units,3);assert.equal(good.rows[0].fact.source_known_at,'2026-09-20T00:00:00.000Z');assert.equal(Object.hasOwn(good.rows[0].fact,'availableAt'),false);
 const rescheduled=[...raw];rescheduled[7]='rescheduled';rescheduled[8]=0;assert.equal((await parse('arrivals',headers,[rescheduled])).issues.length,0);
 for(const [index,value] of [[8,11],[8,0],[9,'2026-09-20T08:00:00'],[10,0],[7,'received']]){const invalid=[...raw];invalid[index]=value;assert.ok((await parse('arrivals',headers,[invalid])).issues.length);}
});

test('large frozen input is lossless and bounded; old plain cache remains compatible',async()=>{
 const old={snapshot:{id:'sim-old'},facts:[{amount_cents:null,quantity:0}],domain:{}};const plain=await encodeInput(old);assert.equal(plain,JSON.stringify(old));assert.deepEqual(await decodeInput(plain),old);
 const large={snapshot:{id:'sim-24'},facts:Array.from({length:15000},(_,i)=>({id:'sim-'+i,fact:{amount_cents:null,quantity:0,name:'来源、完整冻结记录'.repeat(10)}})),domain:{products:[{id:'sim-p',availableAt:'2026-10-04T00:00:00Z'}]}};
 assert.ok(Buffer.byteLength(JSON.stringify(large))>1900000);const packed=await encodeInput(large);assert.equal(JSON.parse(packed).storageFormat,'neo-inputs-gzip-v1');assert.ok(Buffer.byteLength(packed)<1900000);assert.deepEqual(await decodeInput(packed),large);
 for(const corrupt of [{storageFormat:'future'},{...JSON.parse(packed),rawBytes:1},{...JSON.parse(packed),payload:'broken'}])await assert.rejects(()=>decodeInput(JSON.stringify(corrupt)),e=>e.code==='INPUT_STORAGE');
 await assert.rejects(()=>encodeInput({value:'x'.repeat(16*1024*1024)}),e=>e.code==='INPUT_LIMIT');
});
