import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {plusDays} from '../lib/business-metrics.ts';
test('published forecast survives readback; mature actuals are durable and cannot cross tenants',async()=>{
 const {mf,runtime}=await localRuntime();
 const call=async(path,body,business='test-a',rt=runtime)=>{const res=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId='+business,{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),rt);return {status:res.status,data:await res.json()};};
 try{
  const kinds=['order','expense','inventory','fulfillment_rule'];
  let reply=await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'支付预测隔离合成测试',timezone:'Asia/Shanghai',region:'CN',horizonDays:28,objective:'contribution_margin',cashBudgetCents:10000,expectedSources:[{sourceId:'erp',kinds}],competitors:[]}});assert.equal(reply.status,201);
  const start='2026-01-01',end=plusDays(start,223),orders=Array.from({length:224},(_,i)=>({recordKey:'o-'+i,kind:'order',entryType:'paid',orderId:'o-'+i,entityId:'sku',channelId:'shop',quantity:10,amountCents:10000,variableCostCents:2000,businessDate:plusDays(start,i)}));
  const records=[...orders,{recordKey:'refund',kind:'order',entryType:'refund',orderId:'o-223',entityId:'sku',channelId:'shop',quantity:5,amountCents:5000,variableCostCents:1000,businessDate:end},{recordKey:'stock',kind:'inventory',entityId:'sku',warehouseId:'east',quantity:1000,businessDate:end},{recordKey:'rule',kind:'fulfillment_rule',entityId:'sku',channelId:'shop',warehouseId:'east',leadDays:0,costCents:0,businessDate:end},{recordKey:'expense',kind:'expense',entityId:'spend',amountCents:0,businessDate:end}];
  reply=await call('business-inputs',{dataNature:'demo',requestId:'history',sourceId:'erp',records,expectedRowCount:records.length,coverageKinds:kinds,coverageStart:start,coverageEnd:end});assert.equal(reply.status,201,JSON.stringify(reply.data));
  const g=(await call('business-generations?dataNature=demo')).data.generations[0];assert.equal(g.salesForecast.totalUnits,280);assert.equal(g.salesForecast.points.length,0,'summary does not duplicate daily data');assert.equal(g.salesForecast.evaluation.status,'no_paid_series');
  const query=new URLSearchParams({snapshotId:g.id,dataNature:'demo'}).toString();
  const forecasts=(await call('forecasts?'+query)).data.items;assert.equal(forecasts.length,1);assert.equal(forecasts[0].operatingModel.targetUnit,'paid_units');assert.equal(forecasts[0].totals.units,280);assert.equal(forecasts[0].salesForecast.totalUnits,280);
  const work=(await call('decision-workbench?'+query)).data;assert.equal(work.forecastQuality.totalUnits,280);assert.equal(work.forecastBasisState,'current');
  const before=JSON.stringify(g.salesForecast);
  const actualEnd=plusDays(end,28),actual=Array.from({length:28},(_,i)=>({...orders[0],recordKey:'a-'+i,orderId:'a-'+i,businessDate:plusDays(end,i+1)}));
  reply=await call('business-inputs',{dataNature:'demo',requestId:'actual',sourceId:'erp',records:actual,expectedRowCount:actual.length,coverageKinds:['order','expense'],coverageStart:plusDays(end,1),coverageEnd:actualEnd});assert.equal(reply.status,201,JSON.stringify(reply.data));
  const next=(await call('business-generations?dataNature=demo')).data.generations[0];
  const body={dataNature:'demo',generationId:g.id,actualGenerationId:next.id};
  const scored=await call('business-forecast-evaluations',body);assert.equal(scored.status,201,JSON.stringify(scored.data));assert.equal(scored.data.evaluation.status,'evaluated');assert.equal(scored.data.evaluation.domain,'retrospective');assert.equal(scored.data.evaluation.metrics.wape,0);
  const duplicate=await call('business-forecast-evaluations',body);assert.equal(duplicate.data.id,scored.data.id);
  const saved=(await call('business-forecast-evaluations?dataNature=demo&generationId='+g.id)).data;assert.equal(saved.evaluations[0].id,scored.data.id);
  assert.equal((await call('business-forecast-evaluations',body,'test-b')).status,404);
  assert.equal((await call('business-forecast-evaluations',body,'test-a',{...runtime,local:{...runtime.local,userId:'local-reader'}})).status,403);
  const historical=(await call('decision-workbench?'+query)).data;assert.equal(historical.forecastBasisState,'historical');
  const frozen=(await call('business-generations/'+g.id+'?dataNature=demo')).data.generations[0];assert.equal(JSON.stringify(frozen.salesForecast),before);
 }finally{await mf.dispose();}
});
