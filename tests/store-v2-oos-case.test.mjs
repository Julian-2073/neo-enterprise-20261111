import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';

let runtime, mf;
before(async () => {
  ({mf, runtime} = await localRuntime());
});
after(async () => { await mf?.dispose(); });

function req(path, {method = 'GET', body, headers = {}, workspace = 'test-a'} = {}) {
  const q = `?businessId=${workspace}`;
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

const validInput = {
  schema_version: 'neo.store-input.v2', data_kind: 'synthetic', grain: 'order_line',
  store_id: 's1', source_system: 'pos', source_semantics_version: 'v1',
  currency: 'CNY', tax_basis: 'tax_inclusive', business_timezone: 'Asia/Shanghai',
  as_of: '2026-10-20T00:00:00Z',
  domain_coverage: [{domain: 'sales', event_start: '2026-10-01T00:00:00+08:00', event_end: '2026-10-14T23:59:59+08:00', completeness: 'complete', declaration_ref: 'd1'}],
  skus: [{source_sku_id: 'R100-40', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'}],
  sales: [], returns: [],
  stock: [{source_sku_id: 'R100-40', observed_at: '2026-10-20T00:00:00+08:00', available_quantity: 0}],
  campaigns: [], campaign_links: [],
};

test('out-of-stock detection creates a case from a zero-stock core SKU signal', async () => {
  const staged = await call('imports', {method: 'POST', body: validInput, headers: {'Idempotency-Key': 'oos-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': 'oos2-12345678'}});
  const snapshotId = confirm.data.snapshot_id;

  // Detect out-of-stock and create case.
  const detected = await call('signals/detect', {method: 'POST', body: {snapshot_id: snapshotId}, headers: {'Idempotency-Key': 'det-12345678'}});
  assert.equal(detected.status, 200, JSON.stringify(detected));
  assert.equal(detected.data.case.state, 'detected');
  assert.equal(detected.data.signal.kind, 'out_of_stock');
  assert.equal(detected.data.signal.sku_id, 'R100-40');
});

test('case transition requires matching version (CAS)', async () => {
  const staged = await call('imports', {method: 'POST', body: {...validInput, store_id: 's2'}, headers: {'Idempotency-Key': 'cas-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': 'cas2-12345678'}});
  const detected = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': 'cas3-12345678'}});
  const caseId = detected.data.case.case_id;

  // Wrong version → 409.
  const bad = await call(`cases/${caseId}/transition`, {method: 'POST', body: {to_state: 'investigating', expected_version: 99, reason: 'r'}, headers: {'Idempotency-Key': 'cas4-12345678'}});
  assert.equal(bad.status, 409);
  assert.equal(bad.data.error.code, 'VERSION_CONFLICT');

  // Correct version → state advances.
  const ok = await call(`cases/${caseId}/transition`, {method: 'POST', body: {to_state: 'investigating', expected_version: detected.data.case.version, reason: 'r'}, headers: {'Idempotency-Key': 'cas5-12345678'}});
  assert.equal(ok.status, 200);
  assert.equal(ok.data.state, 'investigating');
});

test('duplicate detection for same open_key reuses the existing case', async () => {
  const staged = await call('imports', {method: 'POST', body: {...validInput, store_id: 's3'}, headers: {'Idempotency-Key': 'dup-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': 'dup2-12345678'}});
  const first = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': 'dup3-12345678'}});
  const second = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': 'dup4-12345678'}});
  assert.equal(second.data.case.case_id, first.data.case.case_id);
});
