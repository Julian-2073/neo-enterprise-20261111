import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';

let runtime, mf;
before(async () => {
  ({mf, runtime} = await localRuntime());
});
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

const input = {
  schema_version: 'neo.store-input.v2', data_kind: 'synthetic', grain: 'order_line',
  store_id: 'ws1', source_system: 'pos', source_semantics_version: 'v1',
  currency: 'CNY', tax_basis: 'tax_inclusive', business_timezone: 'Asia/Shanghai',
  as_of: '2026-10-20T00:00:00Z',
  domain_coverage: [{domain: 'sales', event_start: '2026-10-01T00:00:00+08:00', event_end: '2026-10-14T23:59:59+08:00', completeness: 'complete', declaration_ref: 'd1'}],
  skus: [
    {source_sku_id: 'R100-40', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'},
    {source_sku_id: 'R200-40', style_id: 'R200', style_color_id: 'R200-WHT', name: 'R200 40', category: '鞋', color: '白', size_code: '40', size_system: 'EU', unit: 'pair', role: 'basic'},
  ],
  sales: [
    {source_line_id: 'L1', source_order_id: 'O1', source_sku_id: 'R100-40', occurred_at: '2026-10-15T10:00:00+08:00', status: 'settled', quantity: 2, amount_cents: 120000, total_cost_cents: 60000, is_gift: false},
    {source_line_id: 'L2', source_order_id: 'O2', source_sku_id: 'R200-40', occurred_at: '2026-10-15T11:00:00+08:00', status: 'settled', quantity: 1, amount_cents: 40000, total_cost_cents: 20000, is_gift: false},
  ],
  returns: [], stock: [], campaigns: [], campaign_links: [],
};

test('structure workspace returns style-color and core-size metrics from a snapshot', async () => {
  const staged = await call('imports', {method: 'POST', body: input, headers: {'Idempotency-Key': 'wsa-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': 'wsa2-12345678'}});
  const snap = confirm.data.snapshot_id;

  const res = await call('analysis/structure', {qs: `snapshot_id=${snap}`});
  assert.equal(res.status, 200, JSON.stringify(res));
  assert.equal(res.data.workspace, 'structure');
  const styles = res.data.results.filter((r) => r.metric_id === 'style_color_amount_share');
  assert.ok(styles.length >= 2, 'one metric per style-color');
  const core = res.data.results.find((r) => r.metric_id === 'core_size_quantity_share');
  assert.equal(core?.availability.status, 'available');
});

test('sales-change workspace computes delta against an empty baseline', async () => {
  const staged = await call('imports', {method: 'POST', body: {...input, store_id: 'ws2'}, headers: {'Idempotency-Key': 'wsb-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': 'wsb2-12345678'}});
  const snap = confirm.data.snapshot_id;

  const res = await call('analysis/sales-change', {qs: `snapshot_id=${snap}`});
  assert.equal(res.status, 200);
  const total = res.data.results.find((r) => r.metric_id === 'sales_amount_total_change');
  assert.equal(total?.value, 160000, '120000 + 40000 vs empty baseline');
});

test('unknown workspace returns 404', async () => {
  const res = await call('analysis/nope', {qs: 'snapshot_id=any'});
  assert.equal(res.status, 404);
});
