import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
test('chunked feeds remain invisible until total reconciliation seals coverage; replay and incomplete totals are safe',async()=>{
 const {mf,runtime}=await localRuntime();
 const call=async(path,body)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime);return {status:r.status,data:await r.json()};};
 const row=(kind,key)=>({kind,recordKey:key,entityId:'sku',businessDate:'2026-09-30',...(kind==='order'?{quantity:1,amountCents:100,variableCostCents:40,entryType:'paid',orderId:key}:{amountCents:10})});
 const input=records=>({dataNature:'demo',requestId:'initial',sourceId:'erp',records,expectedRowCount:records.length,coverageKinds:['order','expense'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'});
 try{
 assert.equal((await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'分片验收',timezone:'Asia/Shanghai',region:'CN',horizonDays:3,objective:'contribution_margin',cashBudgetCents:10000,expectedSources:[{sourceId:'erp',kinds:['order','expense']}],competitors:[]}})).status,201);
 assert.equal((await call('business-inputs',input([row('order','initial'),row('expense','initial-fee')]))).status,201);
 const partial={...input([row('order','new-order')]),groupId:'daily-feed',partIndex:0,partCount:2};assert.equal((await call('business-inputs',partial)).status,201);
 const read=()=>call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30');assert.equal((await read()).data.state.metrics.netRevenueCents.value,100);
 const cutoff=new Date().toISOString();
 const seal={dataNature:'demo',groupId:'daily-feed',expectedRowCount:2,expectedTotals:{amountCents:110,quantity:1}};
 assert.equal((await call('business-inputs/seal',seal)).status,422);
 assert.equal((await call('business-inputs',{...partial,partIndex:1,records:[row('expense','new-fee')]})).status,201);
 assert.equal((await call('business-inputs/seal',{...seal,expectedTotals:{amountCents:999,quantity:1}})).status,422);
 assert.equal((await call('business-inputs/seal',seal)).status,201);assert.equal((await read()).data.state.metrics.netRevenueCents.value,200);
 assert.equal((await call('business-inputs/seal',seal)).data.reused,true);
 assert.equal((await call('business-inputs',partial)).status,409);
 assert.equal((await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30&knownAt='+encodeURIComponent(cutoff))).data.state.metrics.netRevenueCents.value,100);
 }finally{await mf.dispose();}
});
