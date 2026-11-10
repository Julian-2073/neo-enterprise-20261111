import assert from 'node:assert/strict';
import {test} from 'node:test';
import {marketWorkbench,marketCell,marketPeriods} from '../server/market-workbench.ts';
import {modelMarketPresentation,marketModelBasis,marketDisplayMetrics} from '../server/market-review.ts';
const plus=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const snapshot=()=>({id:'frozen',businessId:'b',dataNature:'demo',periodStart:'2026-07-27',periodEnd:'2026-09-20',asOf:'2026-09-24',productId:null,channel:null,evidenceIds:{paidOrders:'orders-proof'},coverage:['events','orders','expenses'].map(kind=>({kind,sourceId:kind,start:'2026-07-27',end:'2026-09-20'})),data:{financial:{spendCents:5000},channels:[{channel:'shop',spendCents:5000,evidenceId:'channel-proof'}],weeks:Array.from({length:8},(_,i)=>({start:plus('2026-07-27',i*7),end:plus('2026-07-27',i*7+6)}))}});
const domain={products:[{id:'p',name:'跑步机',roleId:'core'}],skus:[],roles:[{id:'core',name:'主力品'}],channels:[{id:'shop',name:'抖音'}]};
const row=(id,kind,day,extra={})=>({id,sourceId:kind,kind,fact:{source_record_id:id,occurred_at:day+'T10:00:00Z',business_date:day,channel:'shop',product_id:'p',event_type:'inquiry',quantity:1,entry_type:'paid',order_id:id,amount_cents:10000,variable_cost_cents:5000,...extra}});
const facts=[row('intent-old','events','2026-08-01',{quantity:10}),row('intent-new','events','2026-09-01',{quantity:20}),row('o-old1','orders','2026-08-01'),row('o-old2','orders','2026-08-01'),row('o-new','orders','2026-09-01'),row('o-new-line','orders','2026-09-01',{order_id:'o-new'}),row('refund','orders','2026-09-02',{entry_type:'refund',amount_cents:5000}),row('fee-old','expenses','2026-08-01',{amount_cents:1000}),row('fee-new','expenses','2026-09-01',{amount_cents:2000}),row('unallocated-role','expenses','2026-09-01',{amount_cents:2000,product_id:null}),row('alien','orders','2026-09-01',{channel:'other',product_id:'other'})];
test('backend compares adjacent complete weeks, deduplicates order lines, subtracts refunds and never allocates channel fees to roles',()=>{
 const s=snapshot(),c=marketCell(s,facts,domain,'shop','core');
 assert.deepEqual(c.periods.current,{start:'2026-08-24',end:'2026-09-20'});assert.equal(c.current.intent,20);assert.equal(c.previous.intent,10);assert.equal(c.current.paidOrders,1);assert.equal(c.previous.paidOrders,2);assert.equal(c.current.netRevenueCents,15000);assert.equal(c.current.spendCents,2000);assert.equal(c.current.costPerOrderCents,2000);assert.equal(c.changes.intent,1);assert.equal(c.changes.paidOrders,-.5);
 assert.equal(marketCell(s,facts,domain,'shop').current.spendCents,4000);assert.ok(!c.factIds.includes('alien'));assert.ok(!c.factIds.includes('unallocated-role'));
});
test('coverage gaps, zero baseline and discontinuous weeks cannot produce invented comparisons',()=>{
 const s=snapshot();s.coverage=s.coverage.filter(c=>c.kind!=='expenses');assert.equal(marketCell(s,facts,domain,'shop','core').current.costPerOrderCents,null);
 s.data.weeks.splice(3,1);assert.equal(marketPeriods(s).previous,null);
 const empty=marketCell(snapshot(),[],domain,'shop','core');assert.equal(empty.current.paidOrders,null);assert.equal(empty.changes.paidOrders,null);
});
test('new inputs recalculate, old frozen input stays unchanged, and UI copy/source selection comes only from model result',()=>{
 const s=snapshot(),before=JSON.stringify(facts),base=marketWorkbench(s,facts,domain,[]),again=marketWorkbench(s,[...facts,row('new-order','orders','2026-09-02')],domain,[]);
 assert.equal(base.cells.find(c=>c.channel==='shop').current.paidOrders,1);assert.equal(again.cells.find(c=>c.channel==='shop').current.paidOrders,2);assert.equal(JSON.stringify(facts),before);
 const waiting=modelMarketPresentation(base,null,[]);assert.equal(waiting.cells[0].headline,'等待 AI 分析');assert.equal(waiting.sources.length,0);
 const review={judgment:{title:'MODEL_OUTPUT',summary:'模型整体判断',evidenceIds:['orders-proof']},signals:base.signals.map(s=>({id:s.id,title:'MODEL_SIGNAL',summary:'模型短解释',evidenceIds:['orders-proof']})),cells:base.cells.map(c=>({channel:c.channel,role:c.role,headline:'MODEL_CELL',summary:'模型货盘判断',status:'needs_check',evidenceIds:[c.evidenceId]})),sources:[],nextStep:'模型建议核对供给'};
 const rendered=modelMarketPresentation(base,review,[]);assert.equal(rendered.judgment.title,'MODEL_OUTPUT');assert.equal(rendered.cells[0].headline,'MODEL_CELL');const basis=marketModelBasis(base,[],s);assert.ok(basis.evidenceIds.includes(base.cells[0].evidenceId));assert.equal(basis.signals.find(x=>x.id==='demand').delta,base.signals.find(x=>x.id==='demand').delta);assert.equal(basis.signalEvidenceIds.demand,'frozen:view:market-demand');assert.equal(basis.unallocatedRoleSpendCents.find(x=>x.channel==='shop').amountCents,2000);
});

test('display metrics keep units, comparisons and missing values tied to each new input',()=>{
 const s=snapshot(),base=marketWorkbench(s,facts,domain,[]),again=marketWorkbench(s,[...facts,row('new-order','orders','2026-09-02')],domain,[]);
 const before=modelMarketPresentation(base,null,[]).cells.find(c=>c.channel==='shop').displayMetrics;
 const after=modelMarketPresentation(again,null,[]).cells.find(c=>c.channel==='shop').displayMetrics;
 assert.deepEqual(before.find(m=>m.id==='paidOrders'),{id:'paidOrders',label:'支付订单',unit:'笔',value:'1',previousValue:'2',change:'−50.0%',delta:-.5,direction:'negative'});
 assert.equal(after.find(m=>m.id==='paidOrders').value,'2');assert.equal(after.find(m=>m.id==='paidOrders').change,'持平');
 assert.equal(before.find(m=>m.id==='netRevenue').value,'150');assert.equal(before.find(m=>m.id==='netRevenue').unit,'元');assert.equal(before.find(m=>m.id==='intent').unit,'次');
 assert.equal(before.find(m=>m.id==='costPerOrder').direction,'negative');
 s.coverage=s.coverage.filter(c=>c.kind!=='expenses');const missing=marketDisplayMetrics(marketCell(s,facts,domain,'shop','core')).find(m=>m.id==='costPerOrder');
 assert.equal(missing.value,'—');assert.equal(missing.change,'无对照');assert.equal(missing.direction,'neutral');
 const zero=marketDisplayMetrics({current:{paidOrders:2},previous:{paidOrders:0},changes:{paidOrders:null}})[0];assert.equal(zero.value,'2');assert.equal(zero.previousValue,'0');assert.equal(zero.change,'无对照');
});
