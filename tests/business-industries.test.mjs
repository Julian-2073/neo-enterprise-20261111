import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {loadGeneration} from '../server/generation-storage.ts';
test('six separate enterprises import different full constraints and automatically calculate industry units',async()=>{
 const {mf,runtime}=await localRuntime();
 const call=async(b,path,body)=>{const res=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId='+b,{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),runtime);const value=await res.json();assert.ok(res.status<300,JSON.stringify(value));return value;};
 try{for(const industry of ['ecommerce','hotel','manufacturing'])for(const multiplier of [1,2]){
  const business=industry+'-delivery-'+multiplier,entityId='own-'+business;
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
  const existing=async(path,body,gen=g.id)=>{const separator=path.includes('?')?'&':'?';const res=await handleApi(new Request('http://localhost/api/v1/'+path+separator+new URLSearchParams({businessId:business,dataNature:'demo',snapshotId:gen}),{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify({...body,snapshotId:gen,dataNature:'demo'}):undefined}),runtime);const v=await res.json();assert.ok(res.status<300,JSON.stringify(v));return v;};
  const snapshot=(await existing('operating-snapshot')).snapshot;
  assert.equal(snapshot.id,g.id);assert.equal(snapshot.operating.industry,industry);assert.equal(snapshot.data.financial.netRevenueCents,g.state.metrics.netRevenueCents.value);assert.equal(snapshot.data.customerJourney.period.transitions[2].rate,null);
  const current=(await existing('forecasts')).items[0];assert.equal(current.totals.units,g.baseline.totals.fulfilled);assert.equal(current.unit,g.baseline.unit);
  const sections=await existing('home-sections');assert.equal(sections.snapshotId,g.id);assert.equal(sections.goods.metrics.sellableUnits,g.state.metrics.sellableUnits?.value??null);assert.ok(sections.market.roles.every(x=>x.id==='unassigned'));assert.equal(sections.people.metrics.conversionRate,null);
  const workbench=await existing('decision-workbench');assert.equal(workbench.operating.industry,industry);assert.equal(workbench.baseline.id,current.id);assert.deepEqual(workbench.history.map(x=>x.units),snapshot.data.weeks.map(x=>x.fulfilledUnits));assert.equal(workbench.joint.review,null);
  const evidence=await existing('evidence/'+encodeURIComponent(snapshot.evidenceIds.netRevenueCents));assert.equal(evidence.analysis.metrics[0].value,g.state.metrics.netRevenueCents.value);assert.ok(evidence.sources.every(x=>x.downloadUrl===null));
  const questionBefore=await runtime.DB.prepare('SELECT count(*) AS n FROM neo_runs').first();await existing('agent-runs');await existing('home-decision');await existing('growth-reviews');await existing('market-workbench');await existing('supply-overview');await existing('policy-briefing');assert.equal((await runtime.DB.prepare('SELECT count(*) AS n FROM neo_runs').first()).n,questionBefore.n,'GET cannot create model tasks');
  const scenario=await existing('scenarios',{requestId:'existing-workbench-'+industry+'-'+multiplier,baselineId:current.id,title:'现有组件的对照方案',assumptions:{operating:{id:'keep',name:'保持现状',demandBps:10000,actions:[]}}});assert.equal(scenario.parentId,current.id);assert.equal(scenario.totals.units,current.totals.units);assert.equal(scenario.assumptions.operating.demandBps,10000);
  if(scenario.feasibility.status==='feasible'){
  const choice=await existing('decisions',{requestId:'existing-choice-'+industry+'-'+multiplier,scenarioId:scenario.id,title:'已核对条件',reason:'核对已登记的行业供给条件',plan:{owner:null,dueDate:null,steps:['核对资料'],observationMetrics:['实际履约']}});const choices=await existing('decisions');assert.equal(choices.items[0].id,choice.id);assert.equal(choices.items[0].reason,'核对已登记的行业供给条件');
  const stored=await existing('business-decisions/'+choice.id);assert.equal(stored.generationId,g.id);assert.equal(stored.scenario.id,'keep');const outcome=await existing('business-outcomes/'+choice.id);assert.equal(outcome.decisionId,choice.id);
  }else{const rejected=await handleApi(new Request('http://localhost/api/v1/decisions?'+new URLSearchParams({businessId:business,dataNature:'demo',snapshotId:g.id}),{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({dataNature:'demo',snapshotId:g.id,requestId:'unconfirmed-choice',scenarioId:scenario.id,reason:'未确认'})}),runtime);assert.equal(rejected.status,409);}
  const another=(await handleApi(new Request('http://localhost/api/v1/operating-snapshot?'+new URLSearchParams({businessId:business==='hotel-delivery-1'?'test-b':'test-a',dataNature:'demo',snapshotId:g.id})),runtime));assert.equal(another.status,404,'frozen generation must not cross tenants');
  const own=await call(business,'business-generations');assert.ok(own.generations.every(r=>r.state.businessId===business));
 }}finally{await mf.dispose();}
});
