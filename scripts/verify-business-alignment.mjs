import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {viewEvidenceId} from '../lib/evidence-refs.ts';
const base=process.argv[2]||'http://127.0.0.1:3000';
const businessId='neo-live-demo',dataNature='demo',snapshotId='snap-6afc0c7e4d17584c3588811dc9ca1d26712800a198db16221db1c30e51e5d6a0';
const query=new URLSearchParams({businessId,dataNature,snapshotId});
async function read(path,q=query){const r=await fetch(`${base}/api/v1/${path}?${q}`);const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const s=(await read('operating-snapshot')).snapshot;
await read('agent-domain');
const report=await read('reports/weekly');
assert.ok(report.decisions.some(d=>d.ontologyRef));assert.ok(report.decisions.some(d=>!d.ontologyRef));
assert.ok(report.decisions.every(d=>d.resultStatus==='ready'&&d.selectedScenario?.totals));
const evidence=[];
for(const p of [...new Set(s.data.inventory.map(x=>x.product_id))]){
 const v=await read('evidence/'+encodeURIComponent(viewEvidenceId(s.id,'inventory',p)));
 const stocks=s.data.inventory.filter(x=>x.product_id===p);
 const cents=stocks.every(x=>x.inventory_cost_cents!=null)?stocks.reduce((n,x)=>n+x.inventory_cost_cents,0):null;
 assert.equal(v.evidence.value.inventory_cost_cents,cents);assert.equal(v.evidence.sourceCount,stocks.length);
 assert.ok(v.records.every(r=>JSON.parse(r.payload).product_id===p));
 evidence.push({productId:p,value:v.evidence.value,sourceCount:v.evidence.sourceCount,sourceProducts:[...new Set(v.records.map(r=>JSON.parse(r.payload).product_id))]});
}
const week=s.data.weeks[0];const v=await read('evidence/'+encodeURIComponent(viewEvidenceId(s.id,'week',week.start,'A3')));
assert.equal(v.evidence.value,week.events.A3);assert.ok(v.records.every(r=>{const f=JSON.parse(r.payload);return f.business_date>=week.start&&f.business_date<=week.end&&r.kind==='events';}));
assert.ok(v.evidence.scopeLabel.endsWith(`${week.start} 至 ${week.end}`));
const forecasts=(await read('forecasts')).items,scenarios=(await read('scenarios')).items;
for(const d of report.decisions){assert.ok(forecasts.some(f=>f.id===d.selectedScenario.parentId));assert.ok(scenarios.some(v=>v.id===d.scenarioId));}
const denied=await fetch(`${base}/api/v1/evidence/${encodeURIComponent(s.evidenceIds.netRevenueCents)}?${new URLSearchParams({businessId,dataNature:'business',snapshotId})}`);assert.equal(denied.status,404);
const summary={checkedAt:new Date().toISOString(),businessId,dataNature,snapshotId,scope:{productId:s.productId,channel:s.channel,periodStart:s.periodStart,periodEnd:s.periodEnd,asOf:s.asOf},globalInventoryCostCents:s.data.inventoryCostCents,evidence,week:{start:week.start,end:week.end,metric:'A3',value:v.evidence.value,sourceCount:v.evidence.sourceCount,title:v.evidence.title,scopeLabel:v.evidence.scopeLabel},versions:forecasts.map(f=>({id:f.id,createdAt:f.createdAt,ontologyRef:f.ontologyRef,scenarioCount:scenarios.filter(v=>v.parentId===f.id).length})),decisions:report.decisions.map(d=>({id:d.id,scenarioId:d.scenarioId,baselineId:d.selectedScenario.parentId,resultStatus:d.resultStatus,ontologyRef:d.ontologyRef,reason:d.reason,totals:d.selectedScenario.totals})),crossNatureEvidence:'404',limitations:['Only existing synthetic demo inputs are verified. No model quality or business effectiveness claim.']};
await mkdir('outputs/business-alignment-2026-10-04',{recursive:true});await writeFile('outputs/business-alignment-2026-10-04/api-readback.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({products:evidence.length,M1:evidence.find(v=>v.productId==='M1'),forecasts:forecasts.length,scenarios:scenarios.length,decisions:report.decisions.length,crossNature:denied.status},null,2));
