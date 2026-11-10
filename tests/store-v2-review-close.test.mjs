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
  skus: [{source_sku_id: 'R1-40', style_id: 'R1', style_color_id: 'R1-BLK', name: 'R1 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'}],
  sales: [], returns: [], stock: [{source_sku_id: 'R1-40', recorded_at: '2026-10-20T00:00:00+08:00', available_quantity: 0, reserved_quantity: 0, in_transit_quantity: 0, physical_quantity: 0}],
  campaigns: [], campaign_links: [],
});

async function makeCase(storeId, ik) {
  const staged = await call('imports', {method: 'POST', body: stockInput(storeId), headers: {'Idempotency-Key': ik}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': ik + 'c'}});
  const det = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': ik + 'd'}});
  return det.data.case;
}

test('review from observing state stores candidate learnings without auto-promoting rules', async () => {
  const c = await makeCase('ws-rv1', 'rv1-12345678');
  // detected -> investigating -> decision_ready -> acting -> observing -> reviewed
  const inv = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'investigating', expected_version: c.version, reason: 'check'}, headers: {'Idempotency-Key': 'rv1i-12345678'}});
  const dr = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'decision_ready', expected_version: inv.data.version, reason: 'r'}, headers: {'Idempotency-Key': 'rv1dr-12345678'}});
  const ac = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'acting', expected_version: dr.data.version, reason: 'r'}, headers: {'Idempotency-Key': 'rv1ac-12345678'}});
  const obs = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'observing', expected_version: ac.data.version, reason: 'acting done'}, headers: {'Idempotency-Key': 'rv1o-12345678'}});
  const rev = await call(`cases/${c.case_id}/review`, {method: 'POST', body: {
    expected_version: obs.data.version, conclusion: '补货后库存恢复正常',
    candidate_learnings: ['核心码安全库存应设为 20 双'], observed_effect: '缺货 3 天，补货后 2 天售罄 10 双',
  }, headers: {'Idempotency-Key': 'rv1r-12345678'}});
  assert.equal(rev.status, 200, JSON.stringify(rev));
  assert.equal(rev.data.case.state, 'reviewed');
  assert.deepEqual(rev.data.review.candidate_learnings, ['核心码安全库存应设为 20 双']);

  const list = await call(`cases/${c.case_id}/reviews`);
  assert.equal(list.data.reviews.length, 1);
});

test('close and reopen require reasons and respect CAS', async () => {
  const c = await makeCase('ws-rv2', 'rv2-12345678');
  // Need to reach reviewed before close per state machine: detected->investigating->decision_ready->acting->observing->reviewed->closed
  const i1 = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'investigating', expected_version: 0, reason: 'r'}, headers: {'Idempotency-Key': 'rv2a-12345678'}});
  const i2 = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'decision_ready', expected_version: i1.data.version, reason: 'r'}, headers: {'Idempotency-Key': 'rv2b-12345678'}});
  const i3 = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'acting', expected_version: i2.data.version, reason: 'r'}, headers: {'Idempotency-Key': 'rv2c-12345678'}});
  const i4 = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'observing', expected_version: i3.data.version, reason: 'r'}, headers: {'Idempotency-Key': 'rv2d-12345678'}});
  const i5 = await call(`cases/${c.case_id}/transition`, {method: 'POST', body: {to_state: 'reviewed', expected_version: i4.data.version, reason: 'r'}, headers: {'Idempotency-Key': 'rv2e-12345678'}});
  const closed = await call(`cases/${c.case_id}/close`, {method: 'POST', body: {expected_version: i5.data.version, reason: '已解决'}, headers: {'Idempotency-Key': 'rv2f-12345678'}});
  assert.equal(closed.data.state, 'closed');

  const reopened = await call(`cases/${c.case_id}/reopen`, {method: 'POST', body: {expected_version: closed.data.version, reason: '问题复现'}, headers: {'Idempotency-Key': 'rv2g-12345678'}});
  assert.equal(reopened.data.state, 'investigating');

  // CAS conflict on reopen
  const bad = await call(`cases/${c.case_id}/reopen`, {method: 'POST', body: {expected_version: 0, reason: 'x'}, headers: {'Idempotency-Key': 'rv2h-12345678'}});
  assert.equal(bad.status, 409);
});
