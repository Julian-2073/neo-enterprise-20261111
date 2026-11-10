import assert from 'node:assert/strict';
import {test} from 'node:test';
import {customerJourney} from '../server/customer-journey.ts';
const day=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function snapshot(overrides={}){return {id:'fixed',businessId:'tenant-a',dataNature:'demo',periodStart:'2026-07-27',periodEnd:'2026-09-20',asOf:'2026-09-24',productId:null,channel:null,evidenceIds:{customerAnalysis:'ev'},coverage:['events','orders'].map(kind=>({kind,sourceId:kind,start:'2026-07-27',end:'2026-09-24'})),data:{weeks:Array.from({length:8},(_,i)=>({start:day('2026-07-27',i*7),end:day('2026-07-27',i*7+6)})),materials:{customerLinks:[],customerAnalysis:{rule:{cohortStage:'A3',conversionWindowDays:7,channelPolicy:'same_channel'}}}},...overrides};}
const eventTypes={A1:'impression',A2:'click',A3:'inquiry'};
function row(id,customer,stage,date,extra={}){return {id,kind:stage==='A4'?'orders':'events',sourceId:stage==='A4'?'orders':'events',fact:{business_date:date,occurred_at:date+'T10:00:00Z',channel:'douyin',product_id:'p',resolved_customer_id:customer,event_type:eventTypes[stage],...(stage==='A4'?{entry_type:'paid',order_id:id}:{}),...extra}};}
test('identity deduplication and ordered adjacent journeys never divide events or orders',()=>{
 const xs=[row('one','c1','A1','2026-08-24'),row('repeat','c1','A1','2026-08-25'),row('two','c1','A2','2026-08-26'),row('three','c1','A3','2026-08-27'),row('four','c1','A4','2026-08-28'),row('other-order','c1','A4','2026-08-28'),row('view-only','c2','A1','2026-08-24')];
 const j=customerJourney(snapshot(),xs);assert.deepEqual(j.recent.counts,{A1:2,A2:1,A3:1,A4:1});assert.deepEqual(j.recent.transitions.map(t=>t.rate),[.5,1,1]);assert.equal(j.period.transitions[2].convertedCustomers,1);
});
test('before-anchor, outside-window, cross-channel, refund and A5 records cannot turn into conversions',()=>{
 const xs=[row('anchor','c1','A3','2026-08-24'),row('old','c1','A4','2026-08-23'),row('late','c1','A4','2026-09-02'),row('cross','c1','A4','2026-08-25',{channel:'tmall'}),row('refund','c1','A4','2026-08-26',{entry_type:'refund'}),row('a5','c1','A2','2026-08-25',{event_type:'repeat_purchase'})];
 const j=customerJourney(snapshot(),xs);assert.equal(j.recent.transitions[2].rate,0);assert.equal(j.recent.counts.A2,0);assert.equal(j.recent.counts.A4,1);
 const s=snapshot();s.data.materials.customerAnalysis.rule.channelPolicy='any';assert.equal(customerJourney(s,xs).recent.transitions[2].rate,1);
});
test('period end is the observation deadline; immature customers are excluded and not failed conversions',()=>{
 const j=customerJourney(snapshot(),[row('early','c1','A3','2026-09-01'),row('paid','c1','A4','2026-09-02'),row('late','c2','A3','2026-09-18'),row('after-end','c2','A4','2026-09-22')]);
 const t=j.recent.transitions[2];assert.equal(t.customers,2);assert.equal(t.matureCustomers,1);assert.equal(t.immatureCustomers,1);assert.equal(t.rate,1);assert.equal(j.recent.counts.A4,1);
});
test('previous window cannot get extra observation time from a later window',()=>{
 const j=customerJourney(snapshot(),[row('late-old','c1','A3','2026-08-21'),row('next-window','c1','A4','2026-08-25'),row('old-mature','c2','A3','2026-08-01')]);
 assert.equal(j.previous.transitions[2].matureCustomers,1);assert.equal(j.previous.transitions[2].immatureCustomers,1);assert.equal(j.previous.transitions[2].rate,0);
});
test('unlinked identity, unknown channel, missing rule and coverage gaps are unavailable, never zero',()=>{
 const xs=[row('a','c1','A3','2026-08-24'),row('p',null,'A4','2026-08-25')];assert.equal(customerJourney(snapshot(),xs).recent.transitions[2].rate,null);
 const unknown=[row('a','c1','A3','2026-08-24',{channel:null}),row('p','c1','A4','2026-08-25',{channel:null})];assert.match(customerJourney(snapshot(),unknown).recent.transitions[2].reason,/渠道/);
 const noRule=snapshot();noRule.data.materials.customerAnalysis.rule=null;assert.equal(customerJourney(noRule,xs).recent.transitions[2].rate,null);
 const missing=snapshot({coverage:[{kind:'events',sourceId:'events',start:'2026-07-27',end:'2026-09-24'}]});assert.equal(customerJourney(missing,xs).recent.counts.A4,null);assert.equal(customerJourney(missing,xs).recent.transitions[2].rate,null);
 const gap=snapshot();gap.coverage=[{kind:'events',sourceId:'events',start:'2026-07-27',end:'2026-08-28'},{kind:'events',sourceId:'events',start:'2026-08-30',end:'2026-09-24'},gap.coverage[1]];assert.equal(customerJourney(gap,xs).recent.transitions[2].rate,null);
});
test('snapshot identity links override raw identity claims, and product/channel scope is respected',()=>{
 const s=snapshot({productId:'p',channel:'douyin'});s.data.materials.customerLinks=[{factId:'a',customerId:null}];const xs=[row('a','unverified','A1','2026-08-24'),row('b','c2','A1','2026-08-24',{product_id:'other'}),row('c','c3','A1','2026-08-24',{channel:'tmall'})];assert.equal(customerJourney(s,xs).recent.counts.A1,null);
 const absentTarget=customerJourney(snapshot({productId:'p'}),[row('intent','c1','A3','2026-08-24')]);assert.equal(absentTarget.recent.counts.A4,null);assert.equal(absentTarget.recent.transitions[2].rate,null);
});
test('explicit source coverage allows observed zero; short or partial weeks cannot invent a prior comparison',()=>{
 const j=customerJourney(snapshot(),[]);assert.deepEqual(j.recent.counts,{A1:0,A2:0,A3:0,A4:0});assert.equal(j.recent.transitions[0].rate,null);assert.equal(j.changes[0].change,null);
 const s=snapshot();s.data.weeks=s.data.weeks.slice(-4);assert.equal(customerJourney(s,[]).recent,null);assert.equal(customerJourney(s,[]).previous,null);
});
