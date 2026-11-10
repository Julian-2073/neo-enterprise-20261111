import assert from 'node:assert/strict';
import {test} from 'node:test';
import {salesChangeAnalysis} from '../lib/store-v2/analysis/sales-change.ts';

const SCOPE_HASH = 'a'.repeat(64);
const SNAPSHOT = 'snap-1';

function makeInput(overrides = {}) {
  return {
    schema_version: 'neo.store-input.v2',
    data_kind: 'synthetic',
    grain: 'order_line',
    store_id: 's1',
    source_system: 'pos',
    source_semantics_version: 'v1',
    currency: 'CNY',
    tax_basis: 'tax_inclusive',
    business_timezone: 'Asia/Shanghai',
    as_of: '2026-10-20T00:00:00Z',
    domain_coverage: [{domain: 'sales', event_start: '2026-10-01T00:00:00+08:00', event_end: '2026-10-14T23:59:59+08:00', completeness: 'complete', declaration_ref: 'd1'}],
    skus: [
      {source_sku_id: 'R100-40', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'},
      {source_sku_id: 'R100-41', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 41', category: '鞋', color: '黑', size_code: '41', size_system: 'EU', unit: 'pair', role: 'core'},
      {source_sku_id: 'R200-40', style_id: 'R200', style_color_id: 'R200-WHT', name: 'R200 40', category: '鞋', color: '白', size_code: '40', size_system: 'EU', unit: 'pair', role: 'basic'},
    ],
    sales: [],
    returns: [],
    stock: [],
    campaigns: [],
    campaign_links: [],
    ...overrides,
  };
}

function line(orderId, lineId, skuId, amount, qty = 1, cost = null) {
  return {source_line_id: lineId, source_order_id: orderId, source_sku_id: skuId, occurred_at: '2026-10-15T10:00:00+08:00', status: 'settled', quantity: qty, amount_cents: amount, total_cost_cents: cost, is_gift: false};
}

test('sales change reports whole-store delta and per-style contribution', () => {
  // Baseline: R100 2单 @600 = 120000 cents; R200 1单 @400 = 40000 → total 160000
  const baseline = makeInput({sales: [
    line('B1', 'L1', 'R100-40', 60000),
    line('B2', 'L2', 'R100-41', 60000),
    line('B3', 'L3', 'R200-40', 40000),
  ]});
  // Current: R100 1单 @600 = 60000; R200 1单 @400 = 40000 → total 100000. Delta = -60000 (-37.5%)
  const current = makeInput({sales: [
    line('C1', 'L1', 'R100-40', 60000),
    line('C2', 'L2', 'R200-40', 40000),
  ]});
  const results = salesChangeAnalysis(current, baseline, {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const total = results.find((r) => r.metric_id === 'sales_amount_total_change');
  assert.equal(total?.value, -60000);
  assert.equal(total?.availability.status, 'available');
  // R100 contribution delta: 60000 - 120000 = -60000 (R100 drove the decline)
  const r100 = results.find((r) => r.metric_id === 'sales_amount_style_change' && r.evidence_ids.includes('R100'));
  assert.equal(r100?.value, -60000);
});

test('null cost does not block sales amount; gross margin is partial', () => {
  const baseline = makeInput({sales: [line('B1', 'L1', 'R100-40', 60000, 1, null)]});
  const current = makeInput({sales: [line('C1', 'L1', 'R100-40', 50000, 1, null)]});
  const results = salesChangeAnalysis(current, baseline, {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const total = results.find((r) => r.metric_id === 'sales_amount_total_change');
  assert.equal(total?.value, -10000);
  const gm = results.find((r) => r.metric_id === 'gross_margin_change');
  assert.equal(gm?.value, null);
  assert.equal(gm?.availability.status, 'blocked');
});

test('zero baseline produces blocked ratio, not division-by-zero', () => {
  const baseline = makeInput({sales: []});
  const current = makeInput({sales: [line('C1', 'L1', 'R100-40', 60000)]});
  const results = salesChangeAnalysis(current, baseline, {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const ratio = results.find((r) => r.metric_id === 'sales_amount_total_change_ratio');
  assert.equal(ratio?.value, null);
  assert.equal(ratio?.availability.status, 'blocked');
  assert.ok(ratio?.availability.reason_codes.includes('ZERO_BASELINE'));
});

test('day_sku grain blocks order count and atv', () => {
  const baseline = makeInput({grain: 'day_sku', sales: [{source_record_id: 'R1', business_date: '2026-10-15', source_sku_id: 'R100-40', paid_quantity: 1, gift_quantity: 0, settled_amount_cents: 60000, total_cost_cents: null, campaign_id: null}]});
  const current = makeInput({grain: 'day_sku', sales: [{source_record_id: 'R2', business_date: '2026-10-16', source_sku_id: 'R100-40', paid_quantity: 1, gift_quantity: 0, settled_amount_cents: 50000, total_cost_cents: null, campaign_id: null}]});
  const results = salesChangeAnalysis(current, baseline, {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const orderCount = results.find((r) => r.metric_id === 'order_count_change');
  assert.equal(orderCount?.value, null);
  assert.equal(orderCount?.availability.status, 'not_supported');
});
