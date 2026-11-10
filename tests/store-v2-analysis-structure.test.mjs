import assert from 'node:assert/strict';
import {test} from 'node:test';
import {structureAnalysis} from '../lib/store-v2/analysis/structure.ts';

const SCOPE_HASH = 'a'.repeat(64);
const SNAPSHOT = 'snap-1';

function makeInput(skus, sales) {
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
    skus,
    sales,
    returns: [],
    stock: [],
    campaigns: [],
    campaign_links: [],
  };
}

test('core size coverage reports share of core-role SKU quantity', () => {
  // 2 core SKUs sold 2 each = 4; 1 basic SKU sold 4; total 8 → core 50%
  const skus = [
    {source_sku_id: 'R100-40', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair', role: 'core'},
    {source_sku_id: 'R100-41', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 41', category: '鞋', color: '黑', size_code: '41', size_system: 'EU', unit: 'pair', role: 'core'},
    {source_sku_id: 'R200-40', style_id: 'R200', style_color_id: 'R200-WHT', name: 'R200 40', category: '鞋', color: '白', size_code: '40', size_system: 'EU', unit: 'pair', role: 'basic'},
  ];
  const sales = [
    {source_line_id: 'L1', source_order_id: 'O1', source_sku_id: 'R100-40', occurred_at: '2026-10-15T10:00:00+08:00', status: 'settled', quantity: 2, amount_cents: 120000, total_cost_cents: null, is_gift: false},
    {source_line_id: 'L2', source_order_id: 'O2', source_sku_id: 'R100-41', occurred_at: '2026-10-15T11:00:00+08:00', status: 'settled', quantity: 2, amount_cents: 120000, total_cost_cents: null, is_gift: false},
    {source_line_id: 'L3', source_order_id: 'O3', source_sku_id: 'R200-40', occurred_at: '2026-10-15T12:00:00+08:00', status: 'settled', quantity: 4, amount_cents: 160000, total_cost_cents: null, is_gift: false},
  ];
  const results = structureAnalysis(makeInput(skus, sales), {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const coreShare = results.find((r) => r.metric_id === 'core_size_quantity_share');
  assert.equal(coreShare?.value, 4);
  assert.equal(coreShare?.denominator, 8);
});

test('sku without role does not crash; style color concentration computed', () => {
  const skus = [
    {source_sku_id: 'R100-40', style_id: 'R100', style_color_id: 'R100-BLK', name: 'R100 40', category: '鞋', color: '黑', size_code: '40', size_system: 'EU', unit: 'pair'},
  ];
  const sales = [
    {source_line_id: 'L1', source_order_id: 'O1', source_sku_id: 'R100-40', occurred_at: '2026-10-15T10:00:00+08:00', status: 'settled', quantity: 3, amount_cents: 180000, total_cost_cents: null, is_gift: false},
  ];
  const results = structureAnalysis(makeInput(skus, sales), {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const styleAmount = results.find((r) => r.metric_id === 'style_color_amount_share');
  assert.equal(styleAmount?.value, 180000);
  assert.equal(styleAmount?.denominator, 180000);
});
