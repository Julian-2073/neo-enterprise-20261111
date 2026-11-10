import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {localRuntime} from '../local-runtime.mjs';
import {handleApi} from '../../server/api.ts';
import {loadGeneration} from '../../server/generation-storage.ts';
const out=path.resolve('outputs/backend-closure/local-delivery');await mkdir(out,{recursive:true});const summaries=[];
{
 const {mf,runtime}=await localRuntime({persistRoot:path.join(out,'runtime')});
 const call=async(b,path,body)=>{const res=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId='+b,{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime);const value=await res.json();assert.ok(res.status<300,JSON.stringify(value));return value;};
 try{for(const industry of ['ecommerce','hotel','manufacturing'])for(const multiplier of [1,2]){
  const business='neo-sim-'+industry+'-delivery-'+multiplier,entityId='own-'+business;
  await runtime.DB.batch([runtime.DB.prepare('INSERT INTO businesses VALUES(?,?)').bind(business,business),runtime.DB.prepare('INSERT INTO business_members VALUES(?,?,?,?)').bind(business+'-owner',business,'local-owner','admin')]);
  const records=[],row=(kind,key,fields={},date='2026-09-30')=>({kind,recordKey:key,entityId,businessDate:date,...fields});
  const revenueKind=industry==='hotel'?'hotel_stay':'order';
  records.push(row(revenueKind,'paid',{quantity:30*multiplier,amountCents:300000*multiplier,variableCostCents:60000*multiplier,orderId:'paid',entryType:'paid',channelId:'own-shop',customerId:'own-customer'}));
  records.push(row('expense','spend',{amountCents:3000*multiplier}));
  if(industry==='hotel')for(const date of ['2026-10-01','2026-10-02','2026-10-03']){
   records.push(row('hotel_capacity','capacity-'+date,{quantity:multiplier},date));
   records.push(row('hotel_reservation','booking-'+date,{quantity:2*multiplier,status:'planned',channelId:'own-shop'},date));
  }else{
   records.push(row('inventory','stock',{warehouseId:'east',quantity:multiplier,reservedUnits:0,inspectionUnits:0,inventoryCostCents:2000*multiplier}));
   if(industry==='ecommerce'){
    records.push(row('fulfillment_rule','east-shop',{warehouseId:'east',channelId:'own-shop',leadDays:0,costCents:0}));
    records.push(row('inventory','unavailable-other-warehouse',{warehouseId:'west',quantity:100,inventoryCostCents:200000}));
   }else{
    records.push(row('bom','bom',{materialId:'metal',unitsPerProduct:2,workCenterId:'line'}));
    records.push(row('material_inventory','metal',{entityId:'metal',warehouseId:'east',quantity:2*multiplier}));
    for(const date of ['2026-10-01','2026-10-02','2026-10-03'])records.push(row('production_capacity','capacity-'+date,{workCenterId:'line',quantity:multiplier},date));
    records.push(row('production','planned-production',{warehouseId:'east',workCenterId:'line',quantity:3*multiplier,status:'planned',leadDays:1,costCents:0},'2026-10-01'));
   }
  }
  const kinds=[...new Set(records.map(r=>r.kind))];
  await call(business,'business-profile',{dataNature:'demo',baseVersion:null,profile:{industry,name:business,region:'CN',timezone:'Asia/Shanghai',horizonDays:3,objective:'contribution_margin',cashBudgetCents:1000000,competitors:[],expectedSources:[{sourceId:'own-erp',kinds}]}});
  const financial=records.filter(r=>[revenueKind,'expense'].includes(r.kind)),operating=records.filter(r=>![revenueKind,'expense'].includes(r.kind));
  await call(business,'business-inputs',{dataNature:'demo',requestId:'financial-case',sourceId:'own-erp',records:financial,expectedRowCount:financial.length,coverageKinds:[revenueKind,'expense'],coverageStart:'2026-09-01',coverageEnd:'2026-09-30'});
  await call(business,'business-inputs',{dataNature:'demo',requestId:'operating-case',sourceId:'own-erp',records:operating,expectedRowCount:operating.length,coverageKinds:kinds.filter(k=>![revenueKind,'expense'].includes(k)),coverageStart:'2026-09-01',coverageEnd:'2026-10-03'});
  // Explicit period is a provider declaration, not a claim of real company ROI.
  // Financial and operating coverage use separate envelopes to avoid future
  // capacity being mistaken for future historical revenue.
  const gens=await call(business,'business-generations');const latest=gens.generations[0];
  const payload=await runtime.DB.prepare('SELECT payload FROM neo_business_generations WHERE id=?').bind(latest.id).first();const g=await loadGeneration({db:runtime.DB,runtime,businessId:business},'demo',payload.payload);
  assert.equal(g.state.metrics.netRevenueCents.value,300000*multiplier);
  assert.equal(g.state.metrics.contributionMarginCents.value,237000*multiplier);
  assert.equal(g.baseline.unit,industry==='hotel'?'房晚':'件');
  assert.equal(g.state.businessId,business);assert.ok(g.state.inputs.every(r=>r.sourceId==='own-erp'));
  assert.equal(g.baseline.status,'calculated',JSON.stringify(g.baseline));
  assert.equal(g.baseline.totals.fulfilled,({hotel:3,ecommerce:1,manufacturing:2})[industry]*multiplier);
  assert.equal(g.baseline.totals.unmet,({hotel:3,ecommerce:2,manufacturing:1})[industry]*multiplier);
  assert.equal(g.baseline.totals.contributionMarginCents,({hotel:23700,ecommerce:7700,manufacturing:15700})[industry]*multiplier);
  const projection=await call(business,'business-workbench');assert.equal(projection.generation.id,g.id);assert.equal(projection.generation.state.metrics.netRevenueCents.value,g.state.metrics.netRevenueCents.value);assert.equal(projection.reviews.status,'not_generated');assert.equal(projection.journey.transitions[2].metric.value,null);
  summaries.push({businessId:business,industry,generationId:g.id,unit:g.baseline.unit,totals:g.baseline.totals,url:'/demo?businessId='+business+'&dataNature=demo'});
  const own=await call(business,'business-generations');assert.ok(own.generations.every(r=>r.state.businessId===business));
 }
 await writeFile(path.join(out,'simulation.json'),JSON.stringify({businessId:summaries[0].businessId,businessIds:summaries.map(r=>r.businessId),companies:summaries,synthetic:true},null,2),{mode:0o600});console.log(JSON.stringify(summaries,null,2));
 }finally{await mf.dispose();}
}
