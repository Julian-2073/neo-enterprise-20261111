import assert from 'node:assert/strict';
import {test} from 'node:test';
import {operatingTimeline} from '../server/operating-timeline.ts';
const plus=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
const weeks=Array.from({length:10},(_,i)=>({start:plus('2026-07-13',i*7),end:plus('2026-07-13',i*7+6)}));
const snapshot={id:'frozen-a',businessId:'a',dataNature:'demo',periodStart:'2026-07-13',periodEnd:'2026-09-20',asOf:'2026-09-24',data:{weeks,materials:{supply:{ruleStatus:'configured'}}}};
const source=(id,publishedAt,retrievedAt,timing='historical')=>({id,evidenceId:`frozen-a:source:${id}`,summary:'AI 筛选的相关经营观察',publisher:'official.example',publishedAt,retrievedAt,timing});
const sections={people:{weeks,series:[{id:'A3',name:'意向',values:[80,90,95,100,105,110,115,120,130,140]},{id:'A4',name:'购买',values:[80,90,95,100,105,110,115,120,110,100]}]},goods:{weeks:weeks.slice().reverse(),series:[{id:'tenant-specific-role',name:'主力品',values:[50,75,100,100,100,100,100,100,100,100]}]},market:{sources:[source('same','2026-09-12','2026-09-13'),source('later','2026-09-12','2026-10-06'),source('unknown',null,'2026-10-06'),source('outside','2026-04-20','2026-04-21'),source('bad-date','2026-02-30','2026-03-02')]}};
test('last eight complete weeks share dates; different series order aligns by date, not array position',()=>{
 const t=operatingTimeline(snapshot,sections);
 assert.equal(t.weeks.length,8);assert.equal(t.weeks[0].start,'2026-07-27');assert.equal(t.weeks.at(-1).end,'2026-09-20');
 assert.equal(t.people[0].values[0],95);assert.deepEqual(t.supply[0].values.slice(-2),[75,50]);
 assert.deepEqual(t.signals.map(x=>x.domain),['people','goods']);assert.ok(t.highlightLastTwo);assert.equal(t.signals.find(x=>x.domain==='goods').seriesId,'tenant-specific-role');
 assert.equal(t.weeks.at(-1).peopleEvidenceId,'frozen-a:view:customer-pulse:2026-09-14');
});
test('only previously available verified-period sources land on historical weeks; late and unknown dates remain separate',()=>{
 const t=operatingTimeline(snapshot,sections);
 assert.deepEqual(t.events.map(x=>[x.id,x.weekIndex]),[['same',6]]);
 assert.equal(t.events[0].evidenceId,'frozen-a:source:same');
 assert.equal(t.observations.find(x=>x.id==='later').reason,'期间发布，后续读取');
 assert.equal(t.observations.find(x=>x.id==='unknown').date,null);assert.match(t.observations.find(x=>x.id==='unknown').dateLabel,/读取/);
 assert.equal(t.observations.find(x=>x.id==='bad-date').date,null);assert.equal(t.observations.length,4);
});
test('missing weeks, incomplete periods and unconfirmed rules do not manufacture zeros or sustained anomalies',()=>{
 const removed={...sections,people:{...sections.people,weeks:weeks.slice(0,-1)},goods:{...sections.goods,weeks:weeks.slice(0,-1)}};
 const t=operatingTimeline({...snapshot,data:{...snapshot.data,materials:{supply:{ruleStatus:'missing'}}}},removed);
 assert.equal(t.people[0].values.at(-1),null);assert.equal(t.supply[0].values.at(-1),null);assert.equal(t.signals.length,0);
 const gap=operatingTimeline({...snapshot,data:{...snapshot.data,weeks:weeks.filter((_,i)=>i!==8)}},sections);assert.equal(gap.signals.length,0);
 const clipped=operatingTimeline({...snapshot,asOf:'2026-09-17'},sections);assert.equal(clipped.weeks.at(-1).end,'2026-09-13');assert.equal(clipped.highlightLastTwo,false);
 assert.equal(operatingTimeline({...snapshot,data:{weeks:[]}},sections).weeks.length,0);
});
test('a new snapshot rolls the eight-week axis and evidence identity without changing frozen prior results',()=>{
 const old=operatingTimeline(snapshot,sections),newWeek={start:'2026-09-21',end:'2026-09-27'};
 const next={...snapshot,id:'frozen-b',periodEnd:newWeek.end,asOf:'2026-09-28',data:{...snapshot.data,weeks:[...weeks,newWeek]}};
 const updated={...sections,people:{weeks:[...weeks,newWeek],series:sections.people.series.map(r=>({...r,values:[...r.values,null]}))},goods:{weeks:[...weeks,newWeek],series:[{id:'core',values:Array(11).fill(null)}]}};
 const t=operatingTimeline(next,updated);assert.equal(t.weeks[0].start,'2026-08-03');assert.equal(t.weeks.at(-1).peopleEvidenceId,'frozen-b:view:customer-pulse:2026-09-21');assert.equal(t.people[0].values.at(-1),null);
 assert.equal(old.weeks[0].start,'2026-07-27');assert.equal(old.weeks.at(-1).end,'2026-09-20');assert.equal(old.weeks.at(-1).peopleEvidenceId,'frozen-a:view:customer-pulse:2026-09-14');
});
