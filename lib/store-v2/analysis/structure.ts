// DEV04: Merchandise structure analysis — core size share, style-color concentration.
// Pure functions; no LLM. Missing role treated as non-core.

import {buildMetricResult, type MetricResult} from '../contracts/metric-result.ts';
import {sumKnown} from '../contracts/money.ts';
import type {StoreInput, OrderLine, DailySku} from '../import/contract.ts';

const CONTRACT_VERSION = 'neo.metric.structure.v1';

export interface AnalysisContext {
  scopeHash: string;
  snapshotId: string;
  calculatedAt?: string;
}

function amountOf(sale: OrderLine | DailySku): number {
  return (sale as OrderLine).amount_cents ?? (sale as DailySku).settled_amount_cents;
}

function quantityOf(sale: OrderLine | DailySku): number {
  return (sale as OrderLine).quantity ?? (sale as DailySku).paid_quantity;
}

export function structureAnalysis(input: StoreInput, ctx: AnalysisContext): MetricResult[] {
  const now = ctx.calculatedAt ?? new Date().toISOString();
  const results: MetricResult[] = [];

  const skuRole = new Map(input.skus.map((s) => [s.source_sku_id, s.role ?? 'non_core']));
  const skuStyleColor = new Map(input.skus.map((s) => [s.source_sku_id, s.style_color_id]));

  let coreQty = 0;
  let totalQty = 0;
  const styleColorAmount = new Map<string, number>();
  let totalAmount = 0;

  for (const sale of input.sales) {
    const qty = quantityOf(sale);
    totalQty += qty;
    if (skuRole.get(sale.source_sku_id) === 'core') coreQty += qty;
    const sc = skuStyleColor.get(sale.source_sku_id);
    if (sc) {
      const amt = amountOf(sale);
      styleColorAmount.set(sc, (styleColorAmount.get(sc) ?? 0) + amt);
      totalAmount += amt;
    }
  }

  results.push(buildMetricResult({
    metric_id: 'core_size_quantity_share',
    metric_contract_version: CONTRACT_VERSION,
    scope_hash: ctx.scopeHash,
    snapshot_id: ctx.snapshotId,
    value: totalQty > 0 ? coreQty : null,
    unit: 'quantity',
    denominator: totalQty || null,
    availability: {status: totalQty > 0 ? 'available' : 'blocked', reason_codes: totalQty > 0 ? [] : ['NO_SALES'], coverage: totalQty > 0 ? 1 : null, missing_fields: totalQty > 0 ? [] : ['sales']},
    evidence_ids: [],
    calculated_at: now,
  }));

  for (const [sc, amt] of styleColorAmount) {
    results.push(buildMetricResult({
      metric_id: 'style_color_amount_share',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: amt,
      unit: 'CNY_cents',
      denominator: totalAmount || null,
      availability: {status: totalAmount > 0 ? 'available' : 'blocked', reason_codes: totalAmount > 0 ? [] : ['NO_SALES'], coverage: totalAmount > 0 ? 1 : null, missing_fields: []},
      evidence_ids: [sc],
      calculated_at: now,
    }));
  }

  return results;
}
