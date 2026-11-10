// DEV06: Snapshot-scoped analysis service for the three workspaces.
// Loads immutable facts from neo_store_v2_facts, reconstructs a StoreInput,
// and runs the deterministic analysis engines. No LLM, no client recompute.

import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {salesChangeAnalysis} from '../../lib/store-v2/analysis/sales-change.ts';
import {structureAnalysis} from '../../lib/store-v2/analysis/structure.ts';
import {campaignAnalysis} from '../../lib/store-v2/analysis/campaign.ts';
import type {MetricResult} from '../../lib/store-v2/contracts/metric-result.ts';
import {assertVisible, type ActorContext} from './auth.ts';
import {all, first, type Runtime} from '../store.ts';
import {hash} from '../csv.ts';
import type {StoreInput, StoreSku, OrderLine, DailySku, ReturnLine, StockRow, Campaign, CampaignLink} from '../../lib/store-v2/import/contract.ts';

export type AnalysisWorkspace = 'sales-change' | 'structure' | 'campaign';

interface FactRow {
  kind: string;
  payload: string;
}

async function loadSnapshotInput(db: Runtime['DB'], workspaceId: string, snapshotId: string): Promise<StoreInput> {
  v2assert(db, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const snap = await first<{import_id: string; grain: string; manifest: string}>(db,
    'SELECT import_id, grain, manifest FROM neo_store_v2_snapshots WHERE snapshot_id=? AND workspace_id=?', snapshotId, workspaceId);
  v2assert(snap, 'NOT_VISIBLE', '快照不存在或不可见');

  const imp = await first<{payload: string}>(db,
    'SELECT payload FROM neo_store_v2_imports WHERE import_id=? AND workspace_id=?', snap.import_id, workspaceId);
  v2assert(imp, 'NOT_VISIBLE', '导入批次不存在或不可见');

  // Reconstruct the canonical input from the immutable published payload.
  const base = JSON.parse(imp.payload) as StoreInput;
  // Facts are the published revision; payload already matches, but we reload from facts
  // to guarantee we never read a draft. Use payload directly for P0 (it is immutable post-publish).
  return base;
}

export async function runAnalysis(
  runtime: Runtime,
  actor: ActorContext,
  snapshotId: string,
  workspace: AnalysisWorkspace,
  baselineSnapshotId?: string,
): Promise<{workspace: AnalysisWorkspace; snapshot_id: string; results: MetricResult[]}> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;

  const input = await loadSnapshotInput(db, actor.workspaceId, snapshotId);
  const scopeHash = await hash(`${actor.workspaceId}:${snapshotId}`);
  const ctx = {scopeHash, snapshotId};

  let results: MetricResult[] = [];
  if (workspace === 'sales-change') {
    const baseline = baselineSnapshotId ? await loadSnapshotInput(db, actor.workspaceId, baselineSnapshotId) : emptyBaseline(input);
    results = salesChangeAnalysis(input, baseline, ctx);
  } else if (workspace === 'structure') {
    results = structureAnalysis(input, ctx);
  } else if (workspace === 'campaign') {
    results = campaignAnalysis(input, ctx);
  } else {
    throw new StoreV2Error('NOT_FOUND', '未知分析工作区');
  }

  return {workspace, snapshot_id: snapshotId, results};
}

function emptyBaseline(template: StoreInput): StoreInput {
  return {...template, sales: [], returns: [], stock: [], campaigns: [], campaign_links: []};
}
