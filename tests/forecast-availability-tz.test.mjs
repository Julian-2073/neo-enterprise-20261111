import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {forecastAvailability} from '../lib/forecast-availability.ts';
const env=(availableAt)=>({snapshot:{asOf:'2026-09-24'},facts:[{kind:'orders',availableAt,fact:{entry_type:'paid'}}]});
for(const [time,count,status] of [
 ['2026-09-24T23:59:59.999+08:00',1,'historical_availability_unverified'],
 ['2026-09-24T15:59:59.999Z',1,'historical_availability_unverified'],
 ['2026-09-25T00:59:59.999+09:00',1,'historical_availability_unverified'],
 ['2026-09-24T11:59:59.999-04:00',1,'historical_availability_unverified'],
 ['2026-09-25T00:00:00+08:00',0,'no_paid_series'],
 ['2026-09-24T16:00:00Z',0,'no_paid_series'],
 ['2026-09-25T00:01:00+08:00',0,'no_paid_series'],
 ['2026-09-24T16:01:00Z',0,'no_paid_series'],
 ['2026-09-25T00:01:00+0800',0,'no_paid_series'],
 ['2026-09-24T23:59+08:00',1,'historical_availability_unverified'],
 ['2026-09-24T23:59:59.999999+08:00',1,'historical_availability_unverified'],
 ])test('Shanghai business-day cutoff: '+time,()=>{const input=env(time),before=JSON.stringify(input);const result=forecastAvailability(input);assert.equal(result.availableByForecastDate,count);assert.equal(result.status,status);assert.equal(result.missingAvailability,0);assert.equal(JSON.stringify(input),before);});
for(const time of [undefined,null,'','2026-09-24','2026-09-24T12:00:00','2026-09-24T12:00:00.001','invalid','2026-02-30T12:00:00+08:00','2026-09-24T24:00:00+08:00','2026-09-24T23:60:00+08:00','2026-09-24T23:59:60+08:00','2026-09-24T12:00:00+25:00'])test('missing/ambiguous/invalid availability stays unknown: '+String(time),()=>{const result=forecastAvailability(env(time));assert.equal(result.availableByForecastDate,0);assert.equal(result.missingAvailability,1);assert.equal(result.status,'historical_availability_unverified');});
test('late known rows plus unknown rows cannot claim no available historical series',()=>{const input=env('2026-09-25T00:01:00+08:00');input.facts.push({kind:'orders',fact:{entry_type:'paid'}});const result=forecastAvailability(input);assert.equal(result.availableByForecastDate,0);assert.equal(result.missingAvailability,1);assert.equal(result.status,'historical_availability_unverified');});
test('non-paid facts do not create known paid availability',()=>{const input=env('2026-09-25T00:01:00+08:00');input.facts.push({kind:'orders',availableAt:'2026-09-24T08:00:00+08:00',fact:{entry_type:'refund'}});input.facts.push({kind:'inventory',availableAt:'2026-09-24T08:00:00+08:00',fact:{entry_type:'paid'}});assert.equal(forecastAvailability(input).paidRecords,1);assert.equal(forecastAvailability(input).status,'no_paid_series');});
test('invalid business date and empty paid input never claim historical availability',()=>{const input=env('2026-09-24T08:00:00+08:00');for(const asOf of ['2026-02-30','invalid']){const result=forecastAvailability({...input,snapshot:{asOf}});assert.equal(result.availableByForecastDate,0);assert.equal(result.status,'historical_availability_unverified');}assert.equal(forecastAvailability({...input,facts:[]}).status,'historical_availability_unverified');});
test('replay supervisor original counterexample with unchanged input and expectations',async()=>{const bytes=await readFile('tests/fixtures/availability-boundary.json');assert.equal(createHash('sha256').update(bytes).digest('hex'),'bc7eaae15b15a7990f7834a81d4511824c38a97f7afbf1edea6e61a27b179913');const original=JSON.parse(bytes),before=JSON.stringify(original.input),actual=forecastAvailability(original.input);assert.equal(actual.status,original.expected.status);assert.equal(actual.availableByForecastDate,original.expected.availableByForecastDate);assert.equal(JSON.stringify(original.input),before);});
