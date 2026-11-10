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
  skus: [{source_sku_id: 'AI1-40', style_id: 'AI1', style_color_id: 'AI1-BLK', name: 'AI1 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'}],
  sales: [], returns: [], stock: [{source_sku_id: 'AI1-40', recorded_at: '2026-10-20T00:00:00+08:00', available_quantity: 0, reserved_quantity: 0, in_transit_quantity: 0, physical_quantity: 0}],
  campaigns: [], campaign_links: [],
});

test('investigate endpoint runs mock provider and returns validated hypotheses', async () => {
  const staged = await call('imports', {method: 'POST', body: stockInput('ws-ai1'), headers: {'Idempotency-Key': 'ai1-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, headers: {'Idempotency-Key': 'ai1c-12345678'}});
  const det = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, headers: {'Idempotency-Key': 'ai1d-12345678'}});

  const res = await call(`cases/${det.data.case.case_id}/investigate`, {method: 'POST', headers: {'Idempotency-Key': 'ai1i-12345678'}});
  assert.equal(res.status, 200, JSON.stringify(res));
  assert.equal(res.data.provider, 'mock');
  assert.ok(res.data.hypotheses.length > 0);
  assert.ok(res.data.hypotheses[0].evidence_refs.length > 0);
  // Case state must NOT change — AI has no write authority.
  const detail = await call(`cases/${det.data.case.case_id}`);
  assert.equal(detail.data.case.state, 'detected');
});
