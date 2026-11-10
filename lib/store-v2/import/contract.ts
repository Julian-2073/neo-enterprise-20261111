// neo.store-input.v2 contract validator.
// Validates structure, type safety, references, grain rules, and money bounds.
// Unknown SKUs are isolated (warning), not rejected.

import {assertCents} from '../contracts/money.ts';
import {StoreV2Error} from '../contracts/errors.ts';

export type DataKind = 'synthetic' | 'authorized_real';
export type Grain = 'order_line' | 'day_sku';

export interface StoreSku {
  source_sku_id: string;
  style_id: string;
  style_color_id: string;
  name: string;
  category: string;
  color: string;
  size_code: string;
  size_system: string;
  unit?: string;
  role?: string;
}

export interface OrderLine {
  source_line_id: string;
  source_order_id: string;
  source_sku_id: string;
  occurred_at: string;
  status: string;
  quantity: number;
  amount_cents: number;
  total_cost_cents: number | null;
  cost_basis_ref?: string | null;
  is_gift?: boolean;
}

export interface DailySku {
  source_record_id: string;
  business_date: string;
  source_sku_id: string;
  paid_quantity: number;
  gift_quantity: number;
  settled_amount_cents: number;
  total_cost_cents: number | null;
  cost_basis_ref?: string | null;
  campaign_id?: string | null;
}

export interface ReturnLine {
  source_refund_id: string;
  source_order_id?: string | null;
  source_line_id?: string | null;
  occurred_at: string;
  quantity: number;
  amount_cents: number;
}

export interface StockRow {
  source_sku_id: string;
  observed_at: string;
  available_quantity: number;
}

export interface Campaign {
  campaign_id: string;
  revision_id: string;
  name: string;
  start_at: string;
  end_at: string;
}

export interface CampaignLink {
  campaign_id: string;
  campaign_revision_id: string;
  source_line_id: string;
  source_order_id: string;
  association_type: string;
  allocated_discount_cents: number;
  allocation_policy_version: string;
}

export interface DomainCoverage {
  domain: string;
  event_start: string;
  event_end: string;
  completeness: 'complete' | 'partial' | 'unknown';
  declaration_ref: string;
}

export interface StoreInput {
  schema_version: string;
  data_kind: DataKind;
  grain: Grain;
  store_id: string;
  source_system: string;
  source_semantics_version: string;
  currency: string;
  tax_basis: string;
  business_timezone: string;
  as_of: string;
  domain_coverage: DomainCoverage[];
  skus: StoreSku[];
  sales: OrderLine[] | DailySku[];
  returns: ReturnLine[];
  stock: StockRow[];
  campaigns: Campaign[];
  campaign_links: CampaignLink[];
}

export interface InputIssue {
  code: string;
  path: string;
  message: string;
}

export interface InputValidationResult {
  valid: boolean;
  errors: InputIssue[];
  warnings: InputIssue[];
  isolatedSkus: string[];
  counts: {
    skus: number;
    sales: number;
    returns: number;
    stock: number;
    campaigns: number;
    campaign_links: number;
  };
}

const REQUIRED_TOP = [
  'schema_version', 'data_kind', 'grain', 'store_id', 'source_system',
  'source_semantics_version', 'currency', 'tax_basis', 'business_timezone',
  'as_of', 'domain_coverage', 'skus', 'sales', 'returns', 'stock',
  'campaigns', 'campaign_links',
];

function checkCents(value: unknown, path: string, errors: InputIssue[]): void {
  if (value == null) return;
  try {
    assertCents(value);
  } catch (e) {
    if (e instanceof StoreV2Error) {
      errors.push({code: e.code, path, message: e.message});
    } else {
      throw e;
    }
  }
}

export function validateStoreInput(raw: unknown): InputValidationResult {
  const errors: InputIssue[] = [];
  const warnings: InputIssue[] = [];
  const isolatedSkus: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return {
      valid: false,
      errors: [{code: 'INVALID_INPUT', path: '$', message: '输入须为 JSON 对象'}],
      warnings,
      isolatedSkus,
      counts: {skus: 0, sales: 0, returns: 0, stock: 0, campaigns: 0, campaign_links: 0},
    };
  }

  const input = raw as Record<string, unknown>;

  for (const field of REQUIRED_TOP) {
    if (!(field in input)) {
      errors.push({code: 'MISSING_FIELD', path: `$.${field}`, message: `缺少必填字段 ${field}`});
    }
  }
  if (errors.some((e) => e.code === 'MISSING_FIELD')) {
    return {
      valid: false, errors, warnings, isolatedSkus,
      counts: {skus: 0, sales: 0, returns: 0, stock: 0, campaigns: 0, campaign_links: 0},
    };
  }

  if (input.schema_version !== 'neo.store-input.v2') {
    errors.push({code: 'SCHEMA_VERSION_MISMATCH', path: '$.schema_version', message: 'schema_version 必须为 neo.store-input.v2'});
  }
  if (input.currency !== 'CNY') {
    errors.push({code: 'CURRENCY_NOT_CNY', path: '$.currency', message: 'P0 仅支持 CNY 币种'});
  }
  if (!['synthetic', 'authorized_real'].includes(input.data_kind as string)) {
    errors.push({code: 'INVALID_DATA_KIND', path: '$.data_kind', message: 'data_kind 须为 synthetic 或 authorized_real'});
  }
  if (!['order_line', 'day_sku'].includes(input.grain as string)) {
    errors.push({code: 'INVALID_GRAIN', path: '$.grain', message: 'grain 须为 order_line 或 day_sku'});
    return {valid: false, errors, warnings, isolatedSkus, counts: {skus: 0, sales: 0, returns: 0, stock: 0, campaigns: 0, campaign_links: 0}};
  }

  const grain = input.grain as Grain;
  const skus = Array.isArray(input.skus) ? input.skus : [];
  const sales = Array.isArray(input.sales) ? input.sales : [];
  const returns = Array.isArray(input.returns) ? input.returns : [];
  const campaigns = Array.isArray(input.campaigns) ? input.campaigns : [];
  const campaignLinks = Array.isArray(input.campaign_links) ? input.campaign_links : [];

  const skuIds = new Set<string>();
  for (const [i, s] of skus.entries()) {
    const sku = s as Record<string, unknown>;
    if (typeof sku.source_sku_id !== 'string' || !sku.source_sku_id) {
      errors.push({code: 'INVALID_SKU', path: `$.skus[${i}].source_sku_id`, message: 'SKU 须有非空 source_sku_id'});
    } else if (skuIds.has(sku.source_sku_id)) {
      errors.push({code: 'DUPLICATE_SKU', path: `$.skus[${i}].source_sku_id`, message: `重复 SKU: ${sku.source_sku_id}`});
    } else {
      skuIds.add(sku.source_sku_id);
    }
  }

  if (grain === 'day_sku') {
    if (returns.length > 0) {
      errors.push({code: 'GRAIN_REJECTS_RETURNS', path: '$.returns', message: 'day_sku 粒度不支持退款明细'});
    }
    if (campaignLinks.length > 0) {
      errors.push({code: 'GRAIN_REJECTS_CAMPAIGN_LINKS', path: '$.campaign_links', message: 'day_sku 粒度不支持活动订单关联'});
    }
  }

  const lineKeys = new Set<string>();
  for (const [i, item] of sales.entries()) {
    const row = item as Record<string, unknown>;
    const skuId = typeof row.source_sku_id === 'string' ? row.source_sku_id : null;
    if (!skuId) {
      errors.push({code: 'MISSING_SKU', path: `$.sales[${i}].source_sku_id`, message: '销售行须有 source_sku_id'});
    } else if (!skuIds.has(skuId)) {
      if (!isolatedSkus.includes(skuId)) isolatedSkus.push(skuId);
      warnings.push({code: 'UNKNOWN_SKU', path: `$.sales[${i}].source_sku_id`, message: `未知 SKU 将被隔离: ${skuId}`});
    }
    if (grain === 'order_line') {
      const key = `${row.source_order_id}:${row.source_line_id}`;
      if (lineKeys.has(key)) {
        errors.push({code: 'DUPLICATE_LINE_ID', path: `$.sales[${i}]`, message: `重复订单行: ${key}`});
      } else {
        lineKeys.add(key);
      }
      const amount = row.amount_cents;
      checkCents(amount, `$.sales[${i}].amount_cents`, errors);
    } else {
      checkCents(row.settled_amount_cents, `$.sales[${i}].settled_amount_cents`, errors);
    }
  }

  const campaignIds = new Set<string>();
  for (const c of campaigns) {
    const camp = c as Record<string, unknown>;
    if (typeof camp.campaign_id === 'string') campaignIds.add(camp.campaign_id);
  }
  for (const [i, link] of campaignLinks.entries()) {
    const l = link as Record<string, unknown>;
    if (typeof l.campaign_id !== 'string' || !campaignIds.has(l.campaign_id)) {
      errors.push({code: 'CAMPAIGN_NOT_FOUND', path: `$.campaign_links[${i}].campaign_id`, message: `活动引用不存在: ${l.campaign_id}`});
    }
    checkCents(l.allocated_discount_cents, `$.campaign_links[${i}].allocated_discount_cents`, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    isolatedSkus,
    counts: {
      skus: skus.length,
      sales: sales.length,
      returns: returns.length,
      stock: Array.isArray(input.stock) ? input.stock.length : 0,
      campaigns: campaigns.length,
      campaign_links: campaignLinks.length,
    },
  };
}
