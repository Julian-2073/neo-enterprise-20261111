// Isolated synthetic enterprise, real HTTP handlers and canonical generation.
import {mkdir,writeFile} from 'node:fs/promises';
import {localRuntime} from '../local-runtime.mjs';
import {handleApi} from '../../server/api.ts';
import {operatingReviewBasis} from '../../server/business-review-basis.ts';
import {loadGeneration} from '../../server/generation-storage.ts';
const {mf,runtime}=await localRuntime();
try{
 const call=async(path,body)=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId=test-a',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime);const v=await r.json();if(r.status>=300)throw Error(JSON.stringify(v));return v;};
 await call('business-profile',{dataNature:'demo',baseVersion:null,profile:{industry:'ecommerce',name:'隔离模型验收企业',timezone:'Asia/Shanghai',region:'中国',horizonDays:3,objective:'contribution_margin',cashBudgetCents:100000,expectedSources:[{sourceId:'erp',kinds:['order','expense','inventory','fulfillment_rule']}],competitors:[]}});
 const records=[{kind:'order',recordKey:'paid',quantity:30,amountCents:300000,variableCostCents:60000,orderId:'paid',entryType:'paid',channelId:'shop',customerId:'person'},{kind:'expense',recordKey:'spend',amountCents:3000},{kind:'inventory',recordKey:'stock',quantity:1,inventoryCostCents:2000,warehouseId:'east'},{kind:'fulfillment_rule',recordKey:'rule',channelId:'shop',warehouseId:'east',leadDays:0,costCents:0}].map(r=>({...r,entityId:'sku',businessDate:'2026-09-30'}));
 await call('business-inputs',{dataNature:'demo',requestId:'online',sourceId:'erp',records,expectedRowCount:records.length,coverageKinds:['order','expense','inventory','fulfillment_rule'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'});
 const list=await call('business-generations');const row=await runtime.DB.prepare('SELECT payload FROM neo_business_generations WHERE id=?').bind(list.generations[0].id).first();const g=await loadGeneration({runtime,db:runtime.DB,businessId:'test-a'},'demo',row.payload);
 const basis=operatingReviewBasis(g,'');
 const dir='outputs/backend-closure/online';await mkdir(dir,{recursive:true});await writeFile(dir+'/frozen-basis.json',JSON.stringify(basis,null,2),{mode:0o600});await writeFile(dir+'/frozen-generation.json',JSON.stringify(g,null,2),{mode:0o600});console.log('已保存隔离合成案例的真实后端代次；未调用模型。');
}finally{await mf.dispose();}
