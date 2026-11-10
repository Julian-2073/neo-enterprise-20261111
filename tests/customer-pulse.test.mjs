import assert from 'node:assert/strict';
import {test} from 'node:test';
import {customerPulse} from '../server/customer-pulse.ts';
import {scopedEvidence} from '../server/scoped-evidence.ts';
const plus=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const snapshot=(extra={})=>({id:'fixed',businessId:'tenant-a',dataNature:'demo',periodStart:'2026-07-27',periodEnd:'2026-09-20',asOf:'2026-09-24',productId:null,channel:null,evidenceIds:{},limitations:[],coverage:['events','orders'].map(kind=>({kind,sourceId:kind,start:'2026-07-27',end:'2026-09-24'})),data:{weeks:Array.from({length:8},(_,i)=>({start:plus('2026-07-27',i*7),end:plus('2026-07-27',i*7+6)})),materials:{customerLinks:[],customerAnalysis:{rule:{cohortStage:'A3',conversionWindowDays:7,channelPolicy:'same_channel'}}}},...extra});
const row=(id,customer,stage,date,extra={})=>({id,sourceId:stage==='A4'?'orders':'events',kind:stage==='A4'?'orders':'events',fact:{business_date:date,occurred_at:date+'T10:00:00Z',channel:'douyin',product_id:'p',quantity:100,resolved_customer_id:customer,...(stage==='A4'?{entry_type:'paid',order_id:id}:{event_type:{A1:'impression',A2:'click',A3:'inquiry'}[stage]}),...extra}});
const env=(s,facts)=>({snapshot:s,facts,domain:{products:[],skus:[],roles:[],arrivals:[]}});
const changedRows=()=>[
 ...['c1','c2'].map(c=>row('prior-view-'+c,c,'A1','2026-09-07')),
 row('prior-click','c1','A2','2026-09-07'),row('prior-intent','c1','A3','2026-09-07'),row('prior-paid1','c1','A4','2026-09-08'),row('prior-paid2','c2','A4','2026-09-08'),
 ...['c1','c2','c3'].map(c=>row('view-'+c,c,'A1','2026-09-14')),
 ...['c1','c2'].flatMap(c=>[row('click-'+c,c,'A2','2026-09-14'),row('intent-'+c,c,'A3','2026-09-14')]),row('paid','c1','A4','2026-09-15'),row('repeat-line','c1','A4','2026-09-15'),row('refund','c2','A4','2026-09-16',{entry_type:'refund'})
];
test('clicked week analyzes distinct customers and the adjacent week, not raw event quantities or all-period totals',()=>{
 const s=snapshot(),facts=changedRows(),{pulse,rows}=customerPulse(s,facts,'2026-09-14');
 assert.deepEqual(pulse.stages.map(x=>x.customers),[3,2,2,1]);assert.deepEqual(pulse.stages.map(x=>x.difference),[1,1,1,-1]);assert.match(pulse.judgment.title,/意向客户增加，购买客户减少/);assert.match(pulse.judgment.summary,/购买客户 2 人 → 1 人/);assert.ok(!rows.some(r=>r.id==='refund'));
 assert.equal(pulse.conversion.start,'2026-08-24');assert.equal(pulse.conversion.previousStart,'2026-07-27');assert.equal(pulse.conversion.transitions[2].convertedCustomers,1);
 const view=scopedEvidence(env(s,facts),'fixed:view:customer-pulse:2026-09-14');assert.deepEqual(view.evidence.value,pulse);assert.equal(view.evidence.periodStart,'2026-09-14');assert.equal(view.evidence.periodEnd,'2026-09-20');
});
test('a selected historical point does not use later weeks in its change or mature conversion judgment',()=>{
 const s=snapshot(),initial=[row('anchor','c1','A3','2026-08-17'),row('payment','c1','A4','2026-08-18'),row('immature','c2','A3','2026-09-01')];
 const before=customerPulse(s,initial,'2026-08-31');assert.equal(before.pulse.conversion.end,'2026-09-06');assert.equal(before.pulse.conversion.transitions[2].rate,1);assert.equal(before.pulse.conversion.transitions[2].immatureCustomers,1);
 const late=row('later-payment','c2','A4','2026-09-08');const after=customerPulse(s,[...initial,late,...changedRows()],'2026-08-31');assert.deepEqual(after.pulse,before.pulse);assert.ok(!after.rows.some(r=>r.id==='later-payment'));assert.ok(after.rows.every(r=>r.fact.business_date<='2026-09-06'));
});
test('the explanation names the same declining stages as the conclusion even when another stage changes more',()=>{
 const facts=['2026-09-07','2026-09-14'].flatMap((date,i)=>[
  ...Array.from({length:i?1:5},(_,j)=>row(`click-${i}-${j}`,`c${j}`,'A2',date)),
  ...Array.from({length:i?1:2},(_,j)=>row(`intent-${i}-${j}`,`c${j}`,'A3',date)),
  ...Array.from({length:i?1:2},(_,j)=>row(`paid-${i}-${j}`,`c${j}`,'A4',date))
 ]);
 const p=customerPulse(snapshot(),facts,'2026-09-14').pulse;
 assert.equal(p.judgment.title,'意向与购买客户同步减少');
 assert.match(p.judgment.summary,/意向客户 2 人 → 1 人/);
 assert.match(p.judgment.summary,/购买客户 2 人 → 1 人/);
});
test('missing identities, source coverage and observations stay unknown rather than false stable or zero',()=>{
 const s=snapshot(),facts=changedRows();s.data.materials.customerLinks=[{factId:'paid',customerId:null}];
 const missing=customerPulse(s,facts,'2026-09-14').pulse;assert.equal(missing.stages[3].customers,null);assert.match(missing.judgment.title,/资料不足/);assert.equal(missing.conversion.transitions[2].rate,null);
 const noPrior=snapshot();noPrior.coverage[0].start='2026-09-14';const p=customerPulse(noPrior,facts,'2026-09-14').pulse;assert.match(p.judgment.title,/上周部分阶段资料不足/);assert.equal(p.stages[0].difference,null);assert.ok(!p.observations.some(x=>x.includes('没有可显示')));
 const noRule=snapshot();noRule.data.materials.customerAnalysis.rule=null;assert.equal(customerPulse(noRule,facts,'2026-09-14').pulse.conversion.transitions[2].rate,null);
});
test('no adjacent week is not a decline; index with a zero baseline remains unavailable',()=>{
 const s=snapshot(),p=customerPulse(s,[row('one','c1','A1','2026-07-27')],'2026-07-27').pulse;assert.match(p.judgment.title,/缺少上周对照/);assert.equal(p.conversion,null);assert.equal(p.stages[0].difference,null);assert.equal(p.stages[1].index,null);
 const zero=customerPulse(s,[],'2026-09-14').pulse;assert.equal(zero.stages[3].customers,0);assert.match(zero.judgment.title,/相同/);assert.equal(zero.stages[3].index,null);
});
test('frozen product and channel scope, invalid weeks and stage selectors cannot leak other records',()=>{
 const s=snapshot({productId:'p',channel:'douyin'}),facts=changedRows();facts.push(row('other-product','outsider','A1','2026-09-14',{product_id:'q'}),row('other-channel','outsider','A1','2026-09-14',{channel:'tmall'}));
 const {pulse,rows}=customerPulse(s,facts,'2026-09-14','A3');assert.equal(pulse.stages[0].customers,3);assert.equal(pulse.focus,'A3');assert.ok(!rows.some(r=>r.id.startsWith('other-')));
 for(const id of ['fixed:view:customer-pulse:2027-01-01','fixed:view:customer-pulse:2026-09-14:A5','fixed:view:customer-pulse:2026-09-14:A1:extra','foreign:view:customer-pulse:2026-09-14'])assert.throws(()=>scopedEvidence(env(s,facts),id),e=>e.status===404);
});
