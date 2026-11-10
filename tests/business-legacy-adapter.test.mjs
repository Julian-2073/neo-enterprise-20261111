import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {startBusinessUpdatePump} from '../server/business-update-pump.ts';
test('registered existing CSV feed updates canonical state while preserving commit-time knowledge and old snapshots',async()=>{
 const {mf,runtime}=await localRuntime();const pump=startBusinessUpdatePump(runtime,60000);
 const call=async(path,body)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+(path.includes('?')?'&':'?')+'businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost',...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),runtime);const v=await r.json();assert.ok(r.status<300,JSON.stringify(v));return v;};
 try{
 const f=new FormData();f.set('file',new File(['source_record_id,order_id,order_line_id,entry_type,occurred_at,channel,product_id,sku_id,quantity,amount_cents,variable_cost_cents,contact_id\nrow-1,o-1,line-1,paid,2026-09-02T10:00:00+08:00,shop,p,s,2,4000,1000,customer-1'],'old.csv'));for(const [k,v] of Object.entries({kind:'orders',templateVersion:'1',sourceName:'existing-erp',dataNature:'demo',coverageStart:'2026-09-01',coverageEnd:'2026-09-30'}))f.set(k,v);
 const upload=await call('ingestion-batches',f),sourceId=upload.batch.source_id;
 await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'旧入口接入验收',timezone:'Asia/Shanghai',region:'CN',horizonDays:3,objective:'contribution_margin',cashBudgetCents:10000,expectedSources:[{sourceId,kinds:['order']}],competitors:[]}});
 const cutoff=new Date().toISOString();await new Promise(r=>setTimeout(r,5));
 await call('ingestion-batches/'+upload.batch.id+'/commit',{validationVersion:upload.batch.validation_version});
 await pump.tick();const projection=await call('business-workbench');assert.equal(projection.generation.state.metrics.netRevenueCents.value,4000);assert.equal(projection.generation.state.metrics.contributionMarginCents.value,null);assert.equal(projection.generation.state.period.end,'2026-09-30');
 const old=await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30&knownAt='+encodeURIComponent(cutoff));assert.equal(old.state.metrics.netRevenueCents.value,null);
 const state=await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30');assert.equal(state.state.metrics.fulfilledUnits.value,2);assert.equal(state.state.metrics.A4Customers.value,null);assert.ok(state.state.inputs.every(r=>r.knownAt>cutoff));
 assert.equal((await call('ingestion-batches/'+upload.batch.id+'/commit',{validationVersion:upload.batch.validation_version})).batch?.status??'committed','committed');
 const previousGeneration=(await call('business-generations')).generations[0].id;const identityCutoff=new Date().toISOString();await new Promise(r=>setTimeout(r,5));
 const customers=new FormData();customers.set('file',new File(['source_record_id,effective_from,customer_id\nc-1,2026-09-01,customer-1'],'customers.csv'));for(const [k,v] of Object.entries({kind:'customers',templateVersion:'2',sourceName:'existing-erp',dataNature:'demo',coverageStart:'2026-09-01',coverageEnd:'2026-09-30'}))customers.set(k,v);
 const customerBatch=await call('ingestion-batches',customers);await call('ingestion-batches/'+customerBatch.batch.id+'/commit',{validationVersion:customerBatch.batch.validation_version});
 await pump.tick();const refreshed=(await call('business-workbench')).generation;assert.notEqual(refreshed.id,previousGeneration);assert.equal(refreshed.state.metrics.A4Customers.value,1);
 const identified=await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30');assert.equal(identified.state.metrics.A4Customers.value,1);assert.equal(identified.state.inputs[0].customerId,'customer-1');assert.equal(identified.state.inputs[0].identityEvidenceIds.length,1);
 const identityHistory=await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30&knownAt='+encodeURIComponent(identityCutoff));assert.equal(identityHistory.state.metrics.A4Customers.value,null);
 const previous=state.state.inputs.find(r=>r.kind==='order'),beforeCorrection=new Date().toISOString();await new Promise(r=>setTimeout(r,5));
 await call('business-inputs',{dataNature:'demo',requestId:'correct-legacy',sourceId,coverageKinds:['order'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30',expectedRowCount:1,records:[{kind:'order',recordKey:previous.recordKey,supersedesId:previous.id,entityId:previous.entityId,businessDate:previous.businessDate,channelId:previous.channelId,orderId:previous.orderId,orderLineId:previous.orderLineId,quantity:3,amountCents:6000,variableCostCents:1500,entryType:'paid'}]});
 const revised=await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30');assert.equal(revised.state.metrics.netRevenueCents.value,6000);assert.equal(revised.state.inputs.filter(r=>r.kind==='order').length,1);assert.equal(revised.state.inputs.find(r=>r.kind==='order').revision,2);
 const historical=await call('business-state?asOf=2026-09-30&start=2026-09-01&end=2026-09-30&knownAt='+encodeURIComponent(beforeCorrection));assert.equal(historical.state.metrics.netRevenueCents.value,4000);
 const paidCurrent=revised.state.inputs.find(r=>r.kind==='order');
 await call('business-inputs',{dataNature:'demo',requestId:'canonical-refund',sourceId,coverageKinds:['order'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30',expectedRowCount:1,records:[{kind:'order',recordKey:'canonical-refund',entityId:paidCurrent.entityId,businessDate:'2026-09-03',channelId:paidCurrent.channelId,orderId:paidCurrent.orderId,orderLineId:paidCurrent.orderLineId,quantity:2,amountCents:4000,variableCostCents:500,entryType:'refund'}]});
 const refundFile=new FormData();refundFile.set('file',new File(['source_record_id,order_id,order_line_id,entry_type,occurred_at,channel,product_id,sku_id,quantity,amount_cents,variable_cost_cents,contact_id\nlegacy-refund,o-1,line-1,refund,2026-09-03T10:00:00+08:00,shop,p,s,2,4000,500,customer-1'],'refund.csv'));
 for(const [k,v] of Object.entries({kind:'orders',templateVersion:'1',sourceName:'existing-erp',dataNature:'demo',coverageStart:'2026-09-01',coverageEnd:'2026-09-30'}))refundFile.set(k,v);
 const stagedRefund=await call('ingestion-batches',refundFile);assert.equal(stagedRefund.batch.status,'ready');
 const rejected=await handleApi(new Request('http://localhost/api/v1/ingestion-batches/'+stagedRefund.batch.id+'/commit?businessId=test-a',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({validationVersion:stagedRefund.batch.validation_version})}),runtime);
 assert.equal(rejected.status,422);assert.equal((await rejected.json()).error.code,'BUSINESS_LEDGER');
 assert.equal((await call('ingestion-batches/'+stagedRefund.batch.id)).batch.status,'ready');
 }finally{await pump.stop();await mf.dispose();}
});
