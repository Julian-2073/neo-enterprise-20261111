import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {localRuntime} from '../local-runtime.mjs';
import {handleApi} from '../../server/api.ts';
const {mf,runtime}=await localRuntime(),started=Date.now();
const call=async(path,body)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime);const v=await r.json();assert.ok(r.status<300,JSON.stringify(v));return v;};
try{
 await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'十万条HTTP接入验收',timezone:'Asia/Shanghai',region:'CN',horizonDays:28,objective:'contribution_margin',cashBudgetCents:1000000,expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory','fulfillment_rule']}],competitors:[]}});
 const records=[{kind:'expense',recordKey:'spend',amountCents:0},{kind:'inventory',recordKey:'stock',warehouseId:'east',quantity:50000,inventoryCostCents:1000000},{kind:'fulfillment_rule',recordKey:'rule',warehouseId:'east',channelId:'shop',leadDays:0,costCents:0}].map(r=>({...r,entityId:'sku',businessDate:'2026-09-30'}));
 await call('business-inputs',{dataNature:'demo',requestId:'constraints',sourceId:'erp',records,expectedRowCount:3,coverageKinds:['expense','inventory','fulfillment_rule'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'});
 for(let partIndex=0;partIndex<100;partIndex++){
  const records=Array.from({length:1000},(_,i)=>{const key='paid-'+(partIndex*1000+i);return {kind:'order',recordKey:key,entityId:'sku',businessDate:'2026-09-30',quantity:1,amountCents:1000,variableCostCents:200,entryType:'paid',orderId:key,channelId:'shop',customerId:'own-customer'};});
  await call('business-inputs',{dataNature:'demo',groupId:'large-http',partIndex,partCount:100,sourceId:'erp',records,expectedRowCount:1000,coverageKinds:['order'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'});
  if((partIndex+1)%20===0)console.log('已接收分片 '+(partIndex+1)+'/100；尚未封存完整覆盖');
 }
 const before=await call('business-workbench');assert.equal(before.generation.state.metrics.netRevenueCents.value,null);
 await call('business-inputs/seal',{dataNature:'demo',groupId:'large-http',expectedRowCount:100000,expectedTotals:{amountCents:100000000,quantity:100000}});
 const w=await call('business-workbench');assert.equal(w.generation.state.metrics.netRevenueCents.value,100000000);assert.equal(w.generation.state.metrics.paidOrders.value,100000);assert.equal(w.generation.baseline.totals.fulfilled,50000);assert.equal(w.generation.state.inputCount,100003);
 const result={status:'passed',records:100000,chunks:100,elapsedMs:Date.now()-started,generationId:w.generation.id,metrics:w.generation.state.metrics,baseline:w.generation.baseline.totals,originalDatabaseTouched:false,modelCalled:false};await mkdir('outputs/backend-closure/verification',{recursive:true});await writeFile('outputs/backend-closure/verification/large-http.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,records:100000,elapsedMs:result.elapsedMs}));
}finally{await mf.dispose();}
