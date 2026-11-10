// DEV04: Campaign analysis — deduplicated order count, allocated discount, net result.
// Order-level metrics require order_line grain + campaign_links; never fabricate from day_sku.

import {buildMetricResult, type MetricResult} from '../contracts/metric-result.ts';
import {sumKnown} from '../contracts/money.ts';
import type {StoreInput, OrderLine, CampaignLink} from '../import/contract.ts';

const CONTRACT_VERSION = 'neo.metric.campaign.v1';

export interface AnalysisContext {
  scopeHash: string;
  snapshotId: string;
  calculatedAt?: string;
}

export function campaignAnalysis(input: StoreInput, ctx: AnalysisContext): MetricResult[] {
  const now = ctx.calculatedAt ?? new Date().toISOString();
  const results: MetricResult[] = [];

  const hasLinks = input.campaign_links.length > 0;

  if (!hasLinks) {
    for (const metricId of ['campaign_dedup_order_count', 'campaign_allocated_discount', 'campaign_net_result']) {
      results.push(buildMetricResult({
        metric_id: metricId,
        metric_contract_version: CONTRACT_VERSION,
        scope_hash: ctx.scopeHash,
        snapshot_id: ctx.snapshotId,
        value: null,
        unit: metricId === 'campaign_dedup_order_count' ? 'count' : 'CNY_cents',
        denominator: null,
        availability: {status: 'blocked', reason_codes: ['NO_CAMPAIGN_LINKS'], coverage: null, missing_fields: ['campaign_links']},
        evidence_ids: [],
        calculated_at: now,
      }));
    }
    return results;
  }

  // Map source_line_id → sales line for amount/cost lookup.
  const lineByKey = new Map<string, OrderLine>();
  for (const sale of input.sales) {
    const ol = sale as OrderLine;
    lineByKey.set(`${ol.source_order_id}:${ol.source_line_id}`, ol);
  }

  const linkedOrders = new Set<string>();
  let totalDiscount = 0;
  let linkedSalesAmount = 0;
  let linkedCost = 0;

  for (const link of input.campaign_links) {
    linkedOrders.add(link.source_order_id);
    totalDiscount += link.allocated_discount_cents;
    const line = lineByKey.get(`${link.source_order_id}:${link.source_line_id}`);
    if (line) {
      linkedSalesAmount += line.amount_cents;
      if (line.total_cost_cents != null) linkedCost += line.total_cost_cents;
    }
  }

  results.push(buildMetricResult({
    metric_id: 'campaign_dedup_order_count',
    metric_contract_version: CONTRACT_VERSION,
    scope_hash: ctx.scopeHash,
    snapshot_id: ctx.snapshotId,
    value: linkedOrders.size,
    unit: 'count',
    denominator: linkedOrders.size,
    availability: {status: 'available', reason_codes: [], coverage: 1, missing_fields: []},
    evidence_ids: input.campaigns.map((c) => c.campaign_id),
    calculated_at: now,
  }));

  results.push(buildMetricResult({
    metric_id: 'campaign_allocated_discount',
    metric_contract_version: CONTRACT_VERSION,
    scope_hash: ctx.scopeHash,
    snapshot_id: ctx.snapshotId,
    value: totalDiscount,
    unit: 'CNY_cents',
    denominator: linkedSalesAmount || null,
    availability: {status: 'available', reason_codes: [], coverage: 1, missing_fields: []},
    evidence_ids: [],
    calculated_at: now,
  }));

  // Net result = linked sales - allocated discount - linked cost.
  // If cost is missing for any linked line, net is partial (cost excluded → blocked).
  const costComplete = input.campaign_links.every((link) => {
    const line = lineByKey.get(`${link.source_order_id}:${link.source_line_id}`);
    return line?.total_cost_cents != null;
  });

  if (costComplete) {
    results.push(buildMetricResult({
      metric_id: 'campaign_net_result',
      metric_contract_version: CONTRACT_VERSION,
      scope_hash: ctx.scopeHash,
      snapshot_id: ctx.snapshotId,
      value: linkedSalesAmount - totalDiscount - linkedCost,
      unit: 'CNY_cents',
      denominator: linkedSalesAmount || null,
      availability: {status: 'available', reason_codes: [], coverage: 1, missing_fields: []},
      evidence_ids: [],
      calculated_at: now,
    }));
  } else {
    results.push(buildMetricResult({
      metric_id: 'campaign_net_result',
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

  return results;
}
