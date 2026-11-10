import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localRuntime} from './local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {plusDays} from '../lib/business-metrics.ts';

const out=path.resolve(process.env.NEO_LOCAL_OUTPUT||'outputs/forecast-enterprise/preview');
if(!out.startsWith(path.resolve('outputs')+path.sep))throw Error('预测验收资料须在本checkout的outputs内');
const {mf,runtime}=await localRuntime({persistRoot:path.join(out,'runtime')});
try{
 const prior=await runtime.DB.prepare("SELECT COUNT(*) n FROM neo_business_profiles WHERE business_id='test-a'").first();if(prior.n)throw Error('该验收目录已有资料，请选择新的NEO_LOCAL_OUTPUT；不覆盖旧资料');
 const call=async(resource,body)=>{const res=await handleApi(new Request('http://localhost/api/v1/'+resource+'?businessId=test-a&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime),value=await res.json();if(res.status>=300)throw Error(JSON.stringify(value));return value;};
 const end='2026-10-07',start=plusDays(end,-223),kinds=['order','expense','inventory','fulfillment_rule'];
 await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'预测验收 · 合成零售企业',timezone:'Asia/Shanghai',region:'CN',horizonDays:28,objective:'contribution_margin',cashBudgetCents:100000,expectedSources:[{sourceId:'synthetic-forecast-erp',kinds}],competitors:[]}});
 const records=[];for(let i=0;i<224;i++)for(const [sku,channel,quantity,price,cost] of [['SKU-TEE','直营',12+i%7,9900,4200],['SKU-MUG','平台',20+(i%7)*3,3900,1400]])records.push({recordKey:sku+'-'+i,kind:'order',entityId:sku,channelId:channel,entryType:'paid',orderId:sku+'-'+i,quantity,amountCents:quantity*price,variableCostCents:quantity*cost,businessDate:plusDays(start,i)});
 records.push({recordKey:'refund',kind:'order',entityId:'SKU-TEE',channelId:'直营',entryType:'refund',orderId:'SKU-TEE-223',quantity:3,amountCents:29700,variableCostCents:12600,businessDate:end});
 for(const [sku,channel,stock] of [['SKU-TEE','直营',240],['SKU-MUG','平台',1000]])records.push({recordKey:'stock-'+sku,kind:'inventory',entityId:sku,warehouseId:'east',quantity:stock,businessDate:end},{recordKey:'rule-'+sku,kind:'fulfillment_rule',entityId:sku,channelId:channel,warehouseId:'east',leadDays:0,costCents:0,businessDate:end});
 records.push({recordKey:'new-stock',kind:'inventory',entityId:'SKU-NEW',warehouseId:'east',quantity:20,businessDate:end},{recordKey:'spend',kind:'expense',entityId:'marketing',amountCents:56000,businessDate:end});
 await call('business-inputs',{dataNature:'demo',requestId:'synthetic-forecast-history',sourceId:'synthetic-forecast-erp',records,expectedRowCount:records.length,coverageKinds:kinds,coverageStart:start,coverageEnd:end});
 const g=(await call('business-generations')).generations[0];await mkdir(out,{recursive:true});await writeFile(path.join(out,'simulation.json'),JSON.stringify({businessId:'test-a',businessIds:['test-a'],snapshotId:g.id,dataNature:'demo',dataStatus:'SYNTHETIC_DEMO',generatedAt:new Date().toISOString()},null,2)+'\n');
 console.log(JSON.stringify({output:out,generationId:g.id,dataNature:'demo',salesSignal:g.salesForecast.totalUnits,evaluation:g.salesForecast.evaluation.status,originalDatabaseTouched:false}));
}finally{await mf.dispose();}
