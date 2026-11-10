// DEV04: Sales change analysis — pure functions over v2 input facts.
// No LLM, no causal claims from contribution. day_sku never fabricates order count / ATV.

import {buildMetricResult, type MetricResult} from '../contracts/metric-result.ts';
import {totalCents, sumKnown} from '../contracts/money.ts';
import type {StoreInput, OrderLine, DailySku} from '../import/contract.ts';

const CONTRACT_VERSION = 'neo.metric.sales-change.v1';

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

function costOf(sale: OrderLine | DailySku): number | null {
  return (sale as {total_cost_cents?: number | null}).total_cost_cents ?? null;
}

function styleOf(sale: OrderLine | DailySku, skus: StoreInput['skus']): string | null {
  const sku = skus.find((s) => s.source_sku_id === sale.source_sku_id);
  return sku?.style_id ?? null;
}

export function salesChangeAnalysis(current: StoreInput, baseline: StoreInput, ctx: AnalysisContext): MetricResult[] {
  const now = ctx.calculatedAt ?? new Date().toISOString();
  const results: MetricResult[] = [];

  const curAmounts = current.sales.map(amountOf);
  const baseAmounts = baseline.sales.map(amountOf);
  const curTotal = sumKnown(curAmounts) ?? 0;
  const baseTotal = sumKnown(baseAmounts) ?? 0;
  const deltaAmount = curTotal - baseTotal;

  results.push(buildMetricResult({
    metric_id: 'sales_amount_total_change',
    metric_contract_version: CONTRACT_VERSION,
    scope_hash: ctx.scopeHash,
    snapshot_id: ctx.snapshotId,
    value: deltaAmount,
    unit: 'CNY_cents',
    denominator: baseTotal || null,
    availability: {status: 'available', reason_codes: [], coverage: 1, missing_fields: []},
    evidence_ids: current.sales.map((_, i) => `sales:${i}`),
    calculated_at: now,
  }));

  // Ratio: blocked when baseline is zero (no proven zero baseline → cannot compute).
  if (baseTotal === 0) {
    results.push(buildMetricResult({
      metric_id: 'sales_amount_total_change_ratio',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: null,
      unit: 'ratio_numerator',
      denominator: null,
      availability: {status: 'blocked', reason_codes: ['ZERO_BASELINE'], coverage: null, missing_fields: ['baseline_amount']},
      evidence_ids: [],
      calculated_at: now,
    }));
  } else {
    results.push(buildMetricResult({
      metric_id: 'sales_amount_total_change_ratio',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: deltaAmount,
      unit: 'ratio_numerator',
      denominator: baseTotal,
      availability: {status: 'available', reason_codes: [], coverage: 1, missing_fields: []},
      evidence_ids: [],
      calculated_at: now,
    }));
  }

  // Quantity change.
  const curQty = current.sales.reduce((s, l) => s + quantityOf(l), 0);
  const baseQty = baseline.sales.reduce((s, l) => s + quantityOf(l), 0);
  results.push(buildMetricResult({
    metric_id: 'sales_quantity_total_change',
    metric_contract_version: CONTRACT_VERSION,
    scope_hash: ctx.scopeHash,
    snapshot_id: ctx.snapshotId,
    value: curQty - baseQty,
    unit: 'quantity',
    denominator: baseQty || null,
    availability: {status: 'available', reason_codes: baseQty === 0 ? ['ZERO_BASELINE_RATIO_UNDEFINED'] : [], coverage: 1, missing_fields: []},
    evidence_ids: [],
    calculated_at: now,
  }));

  // Gross margin change: blocked if any cost is null in either period.
  const curCosts = current.sales.map(costOf);
  const baseCosts = baseline.sales.map(costOf);
  const curCostKnown = curCosts.every((c) => c != null);
  const baseCostKnown = baseCosts.every((c) => c != null);
  if (curCostKnown && baseCostKnown) {
    const curMargin = (sumKnown(curAmounts) ?? 0) - (sumKnown(curCosts) ?? 0);
    const baseMargin = (sumKnown(baseAmounts) ?? 0) - (sumKnown(baseCosts) ?? 0);
    results.push(buildMetricResult({
      metric_id: 'gross_margin_change',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: curMargin - baseMargin,
      unit: 'CNY_cents',
      denominator: baseMargin || null,
      availability: {status: 'available', reason_codes: baseMargin === 0 ? ['ZERO_BASELINE_RATIO_UNDEFINED'] : [], coverage: 1, missing_fields: []},
      evidence_ids: [],
      calculated_at: now,
    }));
  } else {
    results.push(buildMetricResult({
      metric_id: 'gross_margin_change',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: null,
      unit: 'CNY_cents',
      denominator: null,
      availability: {status: 'blocked', reason_codes: ['COST_PARTIAL'], coverage: null, missing_fields: ['total_cost_cents']},
      evidence_ids: [],
      calculated_at: now,
    }));
  }

  // Per-style sales amount delta (contribution, not causation).
  const styleGroups = new Map<string, {cur: number; base: number}>();
  for (const sale of current.sales) {
    const style = styleOf(sale, current.skus);
    if (!style) continue;
    const g = styleGroups.get(style) ?? {cur: 0, base: 0};
    g.cur += amountOf(sale);
    styleGroups.set(style, g);
  }
  for (const sale of baseline.sales) {
    const style = styleOf(sale, baseline.skus);
    if (!style) continue;
    const g = styleGroups.get(style) ?? {cur: 0, base: 0};
    g.base += amountOf(sale);
    styleGroups.set(style, g);
  }
  for (const [style, g] of styleGroups) {
    results.push(buildMetricResult({
      metric_id: 'sales_amount_style_change',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: g.cur - g.base,
      unit: 'CNY_cents',
      denominator: g.base || null,
      availability: {status: 'available', reason_codes: g.base === 0 ? ['ZERO_BASELINE_RATIO_UNDEFINED'] : [], coverage: 1, missing_fields: []},
      evidence_ids: [style],
      calculated_at: now,
    }));
  }

  // Order count change: only order_line grain.
  if (current.grain === 'order_line' && baseline.grain === 'order_line') {
    const curOrders = new Set(current.sales.map((s) => (s as OrderLine).source_order_id)).size;
    const baseOrders = new Set(baseline.sales.map((s) => (s as OrderLine).source_order_id)).size;
    results.push(buildMetricResult({
      metric_id: 'order_count_change',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: curOrders - baseOrders,
      unit: 'count',
      denominator: baseOrders || null,
      availability: {status: 'available', reason_codes: baseOrders === 0 ? ['ZERO_BASELINE_RATIO_UNDEFINED'] : [], coverage: 1, missing_fields: []},
      evidence_ids: [],
      calculated_at: now,
    }));
  } else {
    results.push(buildMetricResult({
      metric_id: 'order_count_change',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: null,
      unit: 'count',
      denominator: null,
      availability: {status: 'not_supported', reason_codes: ['GRAIN_NOT_SUPPORTED'], coverage: null, missing_fields: []},
      evidence_ids: [],
      calculated_at: now,
    }));
  }

  return results;
}
