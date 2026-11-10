import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateStoreInput} from '../lib/store-v2/import/contract.ts';

const baseSku = {
  source_sku_id: 'SKU-001',
  style_id: 'ST-001',
  style_color_id: 'ST-001-RED',
  name: '测试商品',
  category: '鞋',
  color: '红',
  size_code: '42',
  size_system: 'EU',
  unit: 'pair',
  role: 'basic',
};

const baseCoverage = {
  domain: 'sales',
  event_start: '2026-09-01T00:00:00+08:00',
  event_end: '2026-09-30T23:59:59+08:00',
  completeness: 'complete',
  declaration_ref: 'decl-001',
};

function orderLineInput(overrides = {}) {
  return {
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
    domain_coverage: [baseCoverage],
    skus: [baseSku],
    sales: [{
      source_line_id: 'L-001',
      source_order_id: 'O-001',
      source_sku_id: 'SKU-001',
      occurred_at: '2026-09-15T10:00:00+08:00',
      status: 'settled',
      quantity: 2,
      amount_cents: 59800,
      total_cost_cents: 30000,
      cost_basis_ref: 'cost-001',
      is_gift: false,
    }],
    returns: [],
    stock: [],
    campaigns: [],
    campaign_links: [],
    ...overrides,
  };
}

test('valid order_line input passes with zero errors', () => {
  const result = validateStoreInput(orderLineInput());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.counts.skus, 1);
  assert.equal(result.counts.sales, 1);
  assert.equal(result.isolatedSkus.length, 0);
});

test('unknown SKU in sales is isolated, not rejected', () => {
  const result = validateStoreInput(orderLineInput({
    sales: [{...orderLineInput().sales[0], source_sku_id: 'SKU-UNKNOWN'}],
  }));
  assert.equal(result.valid, true);
  assert.deepEqual(result.isolatedSkus, ['SKU-UNKNOWN']);
  assert.ok(result.warnings.some((w) => w.code === 'UNKNOWN_SKU'));
});

test('day_sku grain rejects returns and campaign_links', () => {
  const daySku = {
    ...orderLineInput(),
    grain: 'day_sku',
    sales: [{
      source_record_id: 'R-001',
      business_date: '2026-09-15',
      source_sku_id: 'SKU-001',
      paid_quantity: 2,
      gift_quantity: 0,
      settled_amount_cents: 59800,
      total_cost_cents: 30000,
      cost_basis_ref: 'cost-001',
      campaign_id: null,
    }],
    returns: [{source_refund_id: 'RF-001'}],
    campaign_links: [{campaign_id: 'C-001'}],
  };
  const result = validateStoreInput(daySku);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'GRAIN_REJECTS_RETURNS'));
  assert.ok(result.errors.some((e) => e.code === 'GRAIN_REJECTS_CAMPAIGN_LINKS'));
});

test('day_sku with empty returns and campaign_links is valid', () => {
  const daySku = {
    ...orderLineInput(),
    grain: 'day_sku',
    sales: [{
      source_record_id: 'R-001',
      business_date: '2026-09-15',
      source_sku_id: 'SKU-001',
      paid_quantity: 2,
      gift_quantity: 0,
      settled_amount_cents: 59800,
      total_cost_cents: 30000,
      cost_basis_ref: 'cost-001',
      campaign_id: null,
    }],
    returns: [],
    campaign_links: [],
  };
  const result = validateStoreInput(daySku);
  assert.equal(result.valid, true);
});

test('amount out of safe integer range is rejected', () => {
  const result = validateStoreInput(orderLineInput({
    sales: [{...orderLineInput().sales[0], amount_cents: Number.MAX_SAFE_INTEGER + 1}],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'MONEY_OUT_OF_RANGE'));
});

test('campaign_link referencing missing campaign is rejected', () => {
  const result = validateStoreInput(orderLineInput({
    campaigns: [],
    campaign_links: [{
      campaign_id: 'C-001',
      campaign_revision_id: 'rev-1',
      source_line_id: 'L-001',
      source_order_id: 'O-001',
      association_type: 'discount',
      allocated_discount_cents: 1000,
      allocation_policy_version: 'pol-v1',
    }],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'CAMPAIGN_NOT_FOUND'));
});

test('duplicate source_line_id within same order is rejected', () => {
  const line = orderLineInput().sales[0];
  const result = validateStoreInput(orderLineInput({
    sales: [line, {...line, amount_cents: 100}],
  }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'DUPLICATE_LINE_ID'));
});

test('missing required top-level fields are rejected', () => {
  const input = orderLineInput();
  delete input.schema_version;
  const result = validateStoreInput(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'MISSING_FIELD'));
});

test('wrong schema_version is rejected', () => {
  const result = validateStoreInput(orderLineInput({schema_version: 'neo.store-input.v1'}));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'SCHEMA_VERSION_MISMATCH'));
});

test('non-CNY currency is rejected', () => {
  const result = validateStoreInput(orderLineInput({currency: 'USD'}));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'CURRENCY_NOT_CNY'));
});
