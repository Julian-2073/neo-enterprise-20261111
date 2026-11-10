import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importedPeriod} from '../server/imported-period.ts';
const row=(day,kind='orders')=>({kind,fact:{business_date:day}});
const coverage=(end='2026-09-20',start='2026-04-06')=>[{kind:'orders',coverage_start:start,coverage_end:end}];
test('full imported history uses all 24 weeks without extending to wall-clock date',()=>{
 const facts=[row('2026-04-06'),row('2026-09-19'),row('2026-09-24','inventory')];
 assert.deepEqual(importedPeriod(facts,coverage('2026-09-24'),'2026-09-24'),{start:'2026-04-06',end:'2026-09-20'});
 assert.deepEqual(importedPeriod(facts,coverage('2026-09-24'),'2026-10-08'),{start:'2026-04-06',end:'2026-09-20'});
});
test('a subsequent import extends history rather than keeping the old eight-week window',()=>{
 assert.deepEqual(importedPeriod([row('2026-04-06'),row('2026-10-07')],coverage('2026-10-11'),'2026-10-08'),{start:'2026-04-06',end:'2026-10-08'});
});
test('frozen cutoff excludes future records; partial coverage does not create zero days',()=>{
 assert.deepEqual(importedPeriod([row('2026-09-15'),row('2026-10-07')],coverage('2026-09-16'),'2026-09-17'),{start:'2026-09-15',end:'2026-09-16'});
});
test('inventory-only data cannot be promoted into sales history',()=>{
 assert.throws(()=>importedPeriod([row('2026-09-24','inventory')],coverage(),'2026-09-24'),/尚无可统计/);
});
