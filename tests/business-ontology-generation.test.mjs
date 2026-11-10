import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleApi} from '../server/api.ts';
import {context} from '../server/auth.ts';
import {capture,createBuild} from '../server/ontology/store.ts';
import {querySql} from '../server/ontology/query.ts';
import {neoOperatingDefinition,validateDefinition} from '../server/ontology/model.ts';

test('generation ObjectSet freezes revisions, units and knowledge without copying a third ledger',async()=>{
 const {mf,runtime}=await localRuntime();
 const call=async(path,body,business='test-a')=>{const r=await handleApi(new Request('http://localhost/api/v1/'+path+'?businessId='+business+'&dataNature=demo',{method:body?'POST':'GET',headers:{origin:'http://localhost','content-type':'application/json'},body:body?JSON.stringify({dataNature:'demo',...body}):undefined}),runtime);return {status:r.status,data:await r.json()};};
 try{
  validateDefinition(neoOperatingDefinition());
  const kinds=['order','expense','inventory','arrival','bom','material_inventory','production','production_capacity'];
  assert.equal((await call('business-profile',{baseVersion:null,profile:{industry:'manufacturing',name:'冻结对象验收',region:'CN',timezone:'Asia/Shanghai',horizonDays:3,objective:'contribution_margin',cashBudgetCents:100000,competitors:[],expectedSources:[{sourceId:'erp',kinds}]}})).status,201);
  const records=[{kind:'order',recordKey:'pay',orderId:'o',entryType:'paid',quantity:3,amountCents:3000,variableCostCents:600},{kind:'inventory',recordKey:'stock',warehouseId:'w',quantity:5},{kind:'bom',recordKey:'bom',materialId:'steel',workCenterId:'c',unitsPerProduct:2},{kind:'arrival',recordKey:'arrive',warehouseId:'w',quantity:2,status:'planned',leadDays:0,costCents:0,businessDate:'2026-10-01'}].map(r=>({entityId:'sku',businessDate:'2026-09-30',...r}));
  const upload={requestId:'initial',sourceId:'erp',records,expectedRowCount:4,coverageKinds:kinds,coverageStart:'2026-09-01',coverageEnd:'2026-10-03'};
  assert.equal((await call('business-inputs',upload)).status,201);
  const g=(await call('business-generations')).data.generations[0];
  const ctx=await context(new Request('http://localhost?businessId=test-a'),runtime);
  const built=await createBuild(ctx,{dataNature:'demo',generationId:g.id});assert.equal(built.status,'ready');assert.equal(built.definitionId,'neo-operating-v1');
  const q=async(buildId,typeId,property)=>querySql(ctx,{dataNature:'demo',buildId,query:{typeId,aggregate:{op:'sum',property}}});
  assert.equal((await q(built.id,'operating_order','amountCents')).aggregate.value,3000);
  assert.equal((await q(built.id,'operating_bom','unitsPerProduct')).aggregate.unit,'物料单位/件');
  const arrivals=await q(built.id,'operating_arrival','quantity');assert.equal(arrivals.aggregate.value,2);assert.equal(arrivals.items[0].provenance[0].availableAt,g.state.knownAt);
  await assert.rejects(()=>capture(ctx,{dataNature:'demo',generationId:g.id,knownAt:'2000-01-01T00:00:00Z'}),e=>e.status===409);
  await assert.rejects(()=>capture(ctx,{dataNature:'business',generationId:g.id}),e=>e.status===404);
  const foreign=await context(new Request('http://localhost?businessId=test-b'),runtime);await assert.rejects(()=>capture(foreign,{dataNature:'demo',generationId:g.id}),e=>e.status===404);
  const pay=(await q(built.id,'operating_order','quantity')).items[0];
  assert.equal((await call('business-inputs',{...upload,requestId:'correction',expectedRowCount:1,records:[{...records[0],quantity:4,amountCents:4000,variableCostCents:800,supersedesId:pay.id}]})).status,201);
  const next=(await call('business-generations')).data.generations[0],nextBuild=await createBuild(ctx,{dataNature:'demo',generationId:next.id});
  assert.equal((await q(nextBuild.id,'operating_order','amountCents')).aggregate.value,4000);assert.equal((await q(built.id,'operating_order','amountCents')).aggregate.value,3000);
  const custom=await createBuild(ctx,{dataNature:'demo',generationId:g.id,definitionId:'neo-default-v2'});assert.equal(custom.status,'partial');assert.ok(custom.issues.some(i=>i.code==='OPERATING_TYPE_UNMAPPED'));
  assert.equal((await runtime.DB.prepare('SELECT COUNT(*) n FROM business_facts').first()).n,0);
  const gate=await call('ontology/functions/forecast/runs',{buildId:built.id,requestId:'incorrect-legacy-model'});assert.equal(gate.status,409);assert.equal(gate.data.error.code,'OPERATING_CALCULATION_SCOPE');
 }finally{await mf.dispose();}
});
