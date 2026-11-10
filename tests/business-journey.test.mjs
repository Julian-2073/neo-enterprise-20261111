import {test} from 'node:test';
import assert from 'node:assert/strict';
import {businessJourney} from '../lib/business-journey.ts';
const row=(id,stage,date,customer='c',channel='shop')=>({id,kind:stage==='A4'?'order':'event',stage,businessDate:date,customerId:customer,channelId:channel,entryType:'paid'});
const state=()=>({profile:{industry:'ecommerce',expectedSources:[{sourceId:'erp',kinds:['event','order']}]},period:{start:'2026-09-01',end:'2026-09-30'},asOf:'2026-09-30',inputs:[row('start','A3','2026-09-10'),row('too-early','A4','2026-09-09'),row('other-channel','A4','2026-09-12','c','other'),row('immature','A3','2026-09-29','d')],coverage:['event','order'].map(kind=>({kind,sourceId:'erp',start:'2026-09-01',end:'2026-09-30'}))});
const rule={conversionWindowDays:7,channelPolicy:'same_channel',cohortStage:'A3'};
test('ordered journey excludes immature cohorts, earlier purchases and foreign channels',()=>{
 const s=state();let t=businessJourney(s,rule).transitions[2];assert.equal(t.matureCustomers,1);assert.equal(t.immatureCustomers,1);assert.equal(t.metric.value,0);
 t=businessJourney(s,{...rule,channelPolicy:'any'}).transitions[2];assert.equal(t.metric.value,100);
 s.inputs.push(row('purchase','A4','2026-09-15'));t=businessJourney(s,rule).transitions[2];assert.equal(t.metric.value,100);assert.deepEqual(t.metric.evidenceIds,['start','purchase']);
});
test('identity, coverage and missing rule never become invented zero conversion',()=>{
 const s=state();assert.equal(businessJourney(s,null).transitions[2].metric.value,null);
 s.inputs[0].customerId=null;assert.equal(businessJourney(s,rule).transitions[2].metric.value,null);
 s.inputs=[];assert.equal(businessJourney(s,rule).transitions[2].metric.value,null);
 s.coverage=[];assert.equal(businessJourney(s,rule).transitions[2].metric.status,'partial');
});

test('source identities do not silently merge; enterprise rule and selected purchase cohort are frozen',()=>{
 const s=state();s.profile.expectedSources.push({sourceId:'crm',kinds:['event','order']});
 s.coverage.push(...s.coverage.map(c=>({...c,sourceId:'crm'})));
 s.inputs=[{...row('awareness','A1','2026-09-01'),sourceId:'erp'},{...row('intent','A3','2026-09-09'),sourceId:'erp'},{...row('purchase','A4','2026-09-11'),sourceId:'crm'}];
 assert.equal(businessJourney(s,rule).purchaseCohort.metric.value,null);
 for(const source of s.profile.expectedSources)source.customerIdentity={scope:'enterprise',ruleVersion:'verified-v1'};
 assert.equal(businessJourney(s,rule).purchaseCohort.metric.value,100);
 const early=businessJourney(s,{...rule,cohortStage:'A1'});assert.equal(early.purchaseCohort.metric.value,0);assert.equal(early.transitions[2].metric.value,100);
});
