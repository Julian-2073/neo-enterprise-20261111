import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';

let runtime, mf;
before(async () => { ({mf, runtime} = await localRuntime()); });
after(async () => { await mf?.dispose(); });

function req(path, {method = 'GET', body, headers = {}, workspace = 'test-a', qs = ''} = {}) {
  const q = `?businessId=${workspace}${qs ? '&' + qs : ''}`;
  return new Request(`http://localhost/api/v2/store/${path}${q}`, {
    method,
    headers: {origin: 'http://localhost', ...(body ? {'Content-Type': 'application/json', 'Idempotency-Key': 'key-12345678'} : {}), ...headers},
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function call(path, opt) {
  const r = await handleStoreV2(req(path, opt), runtime);
  return {status: r.status, data: await r.json()};
}

const stockInput = (storeId) => ({
  schema_version: 'neo.store-input.v2', data_kind: 'synthetic', grain: 'order_line',
  store_id: storeId, source_system: 'pos', source_semantics_version: 'v1',
  currency: 'CNY', tax_basis: 'tax_inclusive', business_timezone: 'Asia/Shanghai',
  as_of: '2026-10-20T00:00:00Z',
  domain_coverage: [{domain: 'stock', event_start: '2026-10-20T00:00:00+08:00', event_end: '2026-10-20T23:59:59+08:00', completeness: 'complete', declaration_ref: 'd1'}],
  skus: [
    {source_sku_id: 'A1-40', style_id: 'A1', style_color_id: 'A1-BLK', name: 'A1 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'},
  ],
  sales: [], returns: [], stock: [{source_sku_id: 'A1-40', recorded_at: '2026-10-20T00:00:00+08:00', available_quantity: 0, reserved_quantity: 0, in_transit_quantity: 0, physical_quantity: 0}],
  campaigns: [], campaign_links: [],
});

async function makeOosCase(storeId, ik) {
  const staged = await call('imports', {method: 'POST', body: stockInput(storeId), headers: {'Idempotency-Key': ik}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': ik + 'c'}});
  const det = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': ik + 'd'}});
  return det.data.case;
}

test('cases are ranked by state urgency then recency', async () => {
  const c1 = await makeOosCase('ws-p1', 'pk1-12345678');
  const c2 = await makeOosCase('ws-p2', 'pk2-12345678');
  // transition c1 to investigating (lower urgency than detected)
  await call(`cases/${c1.case_id}/transition`, {method: 'POST', body: {to_state: 'investigating', expected_version: c1.version, reason: 'check'}, headers: {'Idempotency-Key': 't1-12345678'}});

  const res = await call('cases', {qs: 'limit=10'});
  assert.equal(res.status, 200);
  assert.ok(res.data.cases.length >= 2);
  // detected (c2) should rank before investigating (c1)
  const firstId = res.data.cases[0].case_id;
  assert.equal(firstId, c2.case_id, 'detected ranks before investigating');
});

test('today priority caps at most 3 active items', async () => {
  const c3 = await makeOosCase('ws-p3', 'pk3-12345678');
  const c4 = await makeOosCase('ws-p4', 'pk4-12345678');
  const c5 = await makeOosCase('ws-p5', 'pk5-12345678');
  const res = await call('cases', {qs: 'limit=3'});
  assert.equal(res.data.cases.length, 3, 'cap to 3');
});

test('case detail returns bound signals with immutable snapshot evidence', async () => {
  const c = await makeOosCase('ws-p6', 'pk6-12345678');
  const res = await call(`cases/${c.case_id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.case.case_id, c.case_id);
  assert.ok(res.data.signals.length >= 1);
  assert.equal(res.data.signals[0].kind, 'out_of_stock');
  assert.ok(res.data.signals[0].snapshot_id, 'signal references immutable snapshot');
});
