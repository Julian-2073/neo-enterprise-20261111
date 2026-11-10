import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {localRuntime} from '../scripts/local-runtime.mjs';
import {handleStoreV2} from '../server/v2/router.ts';

let runtime, mf, readerRuntime, readerMf;
before(async () => {
  ({mf, runtime} = await localRuntime());
  ({mf: readerMf, runtime: readerRuntime} = await localRuntime({userId: 'local-reader'}));
});
after(async () => { await mf?.dispose(); await readerMf?.dispose(); });

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
  skus: [{source_sku_id: 'X1-40', style_id: 'X1', style_color_id: 'X1-BLK', name: 'X1 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'}],
  sales: [], returns: [], stock: [{source_sku_id: 'X1-40', recorded_at: '2026-10-20T00:00:00+08:00', available_quantity: 0, reserved_quantity: 0, in_transit_quantity: 0, physical_quantity: 0}],
  campaigns: [], campaign_links: [],
});

test('cross-workspace isolation: workspace B cannot see workspace A case', async () => {
  // Workspace A creates a case
  const staged = await call('imports', {method: 'POST', body: stockInput('ws-iso-a'), workspace: 'test-a', headers: {'Idempotency-Key': 'ia1-12345678'}});
  const confirm = await call(`imports/${staged.data.import_id}/confirm`, {method: 'POST', body: {validation_revision: staged.data.validation_revision}, workspace: 'test-a', headers: {'Idempotency-Key': 'ia1c-12345678'}});
  const det = await call('signals/detect', {method: 'POST', body: {snapshot_id: confirm.data.snapshot_id}, workspace: 'test-a', headers: {'Idempotency-Key': 'ia1d-12345678'}});
  const caseId = det.data.case.case_id;

  // Workspace B lists cases — must not include A's case
  const listB = await call('cases', {workspace: 'test-b'});
  assert.equal(listB.status, 200);
  assert.ok(!listB.data.cases.some((c) => c.case_id === caseId), 'workspace B must not see workspace A case');

  // Workspace B tries to read A's case detail — 404
  const detailB = await call(`cases/${caseId}`, {workspace: 'test-b'});
  assert.equal(detailB.status, 404);
});

test('reader role cannot write (POST returns 403)', async () => {
  const r = await handleStoreV2(req('imports', {method: 'POST', body: {}, headers: {'Idempotency-Key': 'rdr-12345678'}}), readerRuntime);
  assert.equal(r.status, 403);
});

test('missing Idempotency-Key on write returns 422', async () => {
  const res = await call('signals/detect', {method: 'POST', body: {snapshot_id: 'x'}, workspace: 'test-a', headers: {'Idempotency-Key': ''}});
  assert.equal(res.status, 422);
});
