import assert from 'node:assert/strict';
import {test} from 'node:test';
import {campaignAnalysis} from '../lib/store-v2/analysis/campaign.ts';

const SCOPE_HASH = 'a'.repeat(64);
const SNAPSHOT = 'snap-1';

function makeInput(sales, campaigns, campaignLinks) {
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
      {source_sku_id: 'C-MAIN', style_id: 'C-MAIN', style_color_id: 'C-MAIN', name: '主品', category: '服装', color: '黑', size_code: 'M', size_system: 'CN', unit: 'piece', role: 'basic'},
      {source_sku_id: 'C-ACC', style_id: 'C-ACC', style_color_id: 'C-ACC', name: '配饰', category: '配饰', color: '白', size_code: 'M', size_system: 'CN', unit: 'piece', role: 'basic'},
    ],
    sales,
    returns: [],
    stock: [],
    campaigns,
    campaign_links: campaignLinks,
  };
}

test('campaign analysis deduplicates orders and allocates discount', () => {
  // 2 orders, each with 2 lines (main 35000 + acc 15000 = 50000). Discount 1000 per order.
  const sales = [
    {source_line_id: 'L1', source_order_id: 'O1', source_sku_id: 'C-MAIN', occurred_at: '2026-10-10T12:00:00+08:00', status: 'settled', quantity: 1, amount_cents: 35000, total_cost_cents: 20000, is_gift: false},
    {source_line_id: 'L2', source_order_id: 'O1', source_sku_id: 'C-ACC', occurred_at: '2026-10-10T12:00:00+08:00', status: 'settled', quantity: 1, amount_cents: 15000, total_cost_cents: 10000, is_gift: false},
    {source_line_id: 'L3', source_order_id: 'O2', source_sku_id: 'C-MAIN', occurred_at: '2026-10-10T13:00:00+08:00', status: 'settled', quantity: 1, amount_cents: 35000, total_cost_cents: 20000, is_gift: false},
    {source_line_id: 'L4', source_order_id: 'O2', source_sku_id: 'C-ACC', occurred_at: '2026-10-10T13:00:00+08:00', status: 'settled', quantity: 1, amount_cents: 15000, total_cost_cents: 10000, is_gift: false},
  ];
  const campaigns = [{campaign_id: 'C1', revision_id: 'rev1', name: '双十', start_at: '2026-10-01T00:00:00+08:00', end_at: '2026-10-31T23:59:59+08:00'}];
  const links = [
    {campaign_id: 'C1', campaign_revision_id: 'rev1', source_line_id: 'L1', source_order_id: 'O1', association_type: 'discount', allocated_discount_cents: 500, allocation_policy_version: 'pol-v1'},
    {campaign_id: 'C1', campaign_revision_id: 'rev1', source_line_id: 'L2', source_order_id: 'O1', association_type: 'discount', allocated_discount_cents: 500, allocation_policy_version: 'pol-v1'},
    {campaign_id: 'C1', campaign_revision_id: 'rev1', source_line_id: 'L3', source_order_id: 'O2', association_type: 'discount', allocated_discount_cents: 500, allocation_policy_version: 'pol-v1'},
    {campaign_id: 'C1', campaign_revision_id: 'rev1', source_line_id: 'L4', source_order_id: 'O2', association_type: 'discount', allocated_discount_cents: 500, allocation_policy_version: 'pol-v1'},
  ];
  const results = campaignAnalysis(makeInput(sales, campaigns, links), {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const orderCount = results.find((r) => r.metric_id === 'campaign_dedup_order_count');
  assert.equal(orderCount?.value, 2, 'two distinct orders');
  const discount = results.find((r) => r.metric_id === 'campaign_allocated_discount');
  assert.equal(discount?.value, 2000, 'total allocated discount');
  const net = results.find((r) => r.metric_id === 'campaign_net_result');
  // net = sales(100000) - discount(2000) - cost(60000) = 38000
  assert.equal(net?.value, 38000);
});

test('campaign analysis with no links returns blocked metrics', () => {
  const sales = [{source_line_id: 'L1', source_order_id: 'O1', source_sku_id: 'C-MAIN', occurred_at: '2026-10-10T12:00:00+08:00', status: 'settled', quantity: 1, amount_cents: 35000, total_cost_cents: 20000, is_gift: false}];
  const results = campaignAnalysis(makeInput(sales, [], []), {scopeHash: SCOPE_HASH, snapshotId: SNAPSHOT});
  const orderCount = results.find((r) => r.metric_id === 'campaign_dedup_order_count');
  assert.equal(orderCount?.value, null);
  assert.equal(orderCount?.availability.status, 'blocked');
});
