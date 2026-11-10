import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';

let ownerRuntime, ownerMf;

before(async () => {
  ({mf: ownerMf, runtime: ownerRuntime} = await localRuntime());
});
after(async () => {
  await ownerMf?.dispose();
});

function request(path, {method = 'GET', body, headers = {}, workspace} = {}) {
  const query = workspace ? `${path.includes('?') ? '&' : '?'}businessId=${workspace}` : '';
  return new Request(`http://localhost/api/v2/store/${path}${query}`, {
    method,
    headers: {
      origin: 'http://localhost',
      ...(body ? {'Content-Type': 'application/json', 'Idempotency-Key': 'key-12345678'} : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(path, options) {
  const response = await handleStoreV2(request(path, options), ownerRuntime);
  return {status: response.status, data: await response.json()};
}

const validInput = {
  schema_version: 'neo.store-input.v2',
  data_kind: 'synthetic',
  grain: 'order_line',
  store_id: 'store-01',
  source_system: 'pos',
  source_semantics_version: 'pos-v1',
  currency: 'CNY',
  tax_basis: 'tax_inclusive',
  business_timezone: 'Asia/Shanghai',
  as_of: '2026-10-01T00:00:00Z',
  domain_coverage: [{domain: 'sales', event_start: '2026-09-01T00:00:00+08:00', event_end: '2026-09-30T23:59:59+08:00', completeness: 'complete', declaration_ref: 'decl-001'}],
  skus: [{source_sku_id: 'SKU-001', style_id: 'ST-001', style_color_id: 'ST-001-RED', name: '测试', category: '鞋', color: '红', size_code: '42', size_system: 'EU', unit: 'pair', role: 'basic'}],
  sales: [{source_line_id: 'L-001', source_order_id: 'O-001', source_sku_id: 'SKU-001', occurred_at: '2026-09-15T10:00:00+08:00', status: 'settled', quantity: 2, amount_cents: 59800, total_cost_cents: 30000, cost_basis_ref: 'cost-001', is_gift: false}],
  returns: [],
  stock: [],
  campaigns: [],
  campaign_links: [],
};

test('stage valid input returns ready preview with capability summary', async () => {
  const res = await call('imports', {method: 'POST', body: validInput, workspace: 'test-a'});
  assert.equal(res.status, 200, JSON.stringify(res));
  assert.equal(res.data.status, 'ready');
  assert.equal(res.data.validation_revision, 1);
  assert.equal(res.data.reused, false);
  assert.equal(res.data.capability_preview.sales_amount.status, 'available');
  assert.equal(res.data.capability_preview.order_count.status, 'available');
  assert.equal(res.data.counts.sales, 1);
});

test('duplicate upload reuses the existing import and does not count twice', async () => {
  const unique = {...validInput, store_id: 'store-dup'};
  const first = await call('imports', {method: 'POST', body: unique, workspace: 'test-a', headers: {'Idempotency-Key': 'dup-12345678'}});
  assert.equal(first.data.reused, false);
  const second = await call('imports', {method: 'POST', body: unique, workspace: 'test-a', headers: {'Idempotency-Key': 'dup2-12345678'}});
  assert.equal(second.data.import_id, first.data.import_id);
  assert.equal(second.data.reused, true);
});

test('invalid input is staged as failed and not publishable', async () => {
  const bad = {...validInput, schema_version: 'neo.store-input.v1'};
  const res = await call('imports', {method: 'POST', body: bad, workspace: 'test-a', headers: {'Idempotency-Key': 'bad-12345678'}});
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'failed');
  assert.ok(res.data.errors.some((e) => e.code === 'SCHEMA_VERSION_MISMATCH'));
});

test('confirm with correct validation_revision publishes an immutable snapshot', async () => {
  const unique = {...validInput, store_id: 'store-confirm'};
  const staged = await call('imports', {method: 'POST', body: unique, workspace: 'test-a', headers: {'Idempotency-Key': 'cf-12345678'}});
  assert.equal(staged.data.status, 'ready');
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, workspace: 'test-a', headers: {'Idempotency-Key': 'cf2-12345678'}});
  assert.equal(confirm.status, 200, JSON.stringify(confirm));
  assert.ok(confirm.data.snapshot_id);

  // Re-confirming same revision must be idempotent-safe (status no longer ready).
  const again = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, workspace: 'test-a', headers: {'Idempotency-Key': 'cf3-12345678'}});
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'ILLEGAL_TRANSITION');
});

test('confirm with stale validation_revision is rejected with VERSION_CONFLICT', async () => {
  const unique = {...validInput, store_id: 'store-stale'};
  const staged = await call('imports', {method: 'POST', body: unique, workspace: 'test-a', headers: {'Idempotency-Key': 'stale-1234567'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision + 99}, workspace: 'test-a', headers: {'Idempotency-Key': 'stale2-1234567'}});
  assert.equal(confirm.status, 409);
  assert.equal(confirm.data.error.code, 'VERSION_CONFLICT');
});

test('re-staging a failed import bumps revision and invalidates stale confirmation', async () => {
  const bad = {...validInput, currency: 'USD'};
  const first = await call('imports', {method: 'POST', body: bad, workspace: 'test-a', headers: {'Idempotency-Key': 'rebad-1234567'}});
  assert.equal(first.data.status, 'failed');
  // Re-uploading the same failed file resumes the import and bumps validation_revision.
  const second = await call('imports', {method: 'POST', body: bad, workspace: 'test-a', headers: {'Idempotency-Key': 'rebad2-1234567'}});
  assert.equal(second.data.import_id, first.data.import_id, 'same file hash reuses import');
  assert.equal(second.data.status, 'failed');
  assert.equal(second.data.validation_revision, first.data.validation_revision + 1, 're-staging bumps revision');

  // A failed import cannot be confirmed regardless of revision.
  const staleConfirm = await call(`imports/${second.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: first.data.validation_revision}, workspace: 'test-a', headers: {'Idempotency-Key': 'reconf-1234567'}});
  assert.equal(staleConfirm.status, 409);
  assert.equal(staleConfirm.data.error.code, 'ILLEGAL_TRANSITION');
});
