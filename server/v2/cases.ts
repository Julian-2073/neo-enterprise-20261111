// DEV05: Case lifecycle for the out-of-stock vertical closed loop.
// Cases are versioned (CAS). Signals reference immutable snapshot evidence.
// open_key deduplicates: detecting the same (snapshot, sku) reuses the existing case.

import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {assertCaseTransition, type CaseState} from '../../lib/store-v2/contracts/commands.ts';
import {detectOutOfStock} from '../../lib/store-v2/analysis/oos-detect.ts';
import {requireActorWrite, type ActorContext} from './auth.ts';
import {first, all, statement, type Runtime} from '../store.ts';
import type {StoreInput} from '../../lib/store-v2/import/contract.ts';

export interface CaseRow {
  case_id: string;
  workspace_id: string;
  snapshot_id: string;
  open_key: string;
  state: string;
  version: number;
  title: string;
  created_at: string;
  updated_at: string;
  actor_id: string;
}

export async function detectAndCreateCase(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  snapshotId: string,
): Promise<{case: CaseRow; signal: {kind: string; sku_id: string}}> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;

  const snapshot = await first<{import_id: string; manifest: string}>(db,
    'SELECT import_id, manifest FROM neo_store_v2_snapshots WHERE snapshot_id=? AND workspace_id=?', snapshotId, actor.workspaceId);
  v2assert(snapshot, 'NOT_VISIBLE', '快照不存在或不可见');

  const imp = await first<{payload: string}>(db,
    'SELECT payload FROM neo_store_v2_imports WHERE import_id=? AND workspace_id=?', snapshot.import_id, actor.workspaceId);
  v2assert(imp, 'NOT_VISIBLE', '导入批次不存在或不可见');

  const input = JSON.parse(imp.payload) as StoreInput;
  const signals = detectOutOfStock(input);
  v2assert(signals.length > 0, 'NOT_FOUND', '当前快照无缺码信号');

  const sig = signals[0];
  const openKey = `oos:${snapshotId}:${sig.sku_id}`;

  // Idempotent: same open_key reuses the existing case.
  const existing = await first<CaseRow>(db,
    'SELECT * FROM neo_store_v2_cases WHERE workspace_id=? AND open_key=?', actor.workspaceId, openKey);
  if (existing) {
    return {case: existing, signal: {kind: sig.kind, sku_id: sig.sku_id}};
  }

  const caseId = crypto.randomUUID();
  const now = new Date().toISOString();
  const signalId = crypto.randomUUID();
  const title = `缺码：${sig.style_color_id} ${sig.sku_id}`;

  await db.batch([
    statement(db, `INSERT INTO neo_store_v2_cases(case_id,workspace_id,snapshot_id,open_key,state,version,title,created_at,updated_at,actor_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      caseId, actor.workspaceId, snapshotId, openKey, 'detected', 0, title, now, now, actor.actorId),
    statement(db, `INSERT INTO neo_store_v2_case_signals(signal_id,case_id,kind,snapshot_id,metric_result_id,payload,created_at)
       VALUES (?,?,?,?,?,?,?)`,
      signalId, caseId, sig.kind, snapshotId, null, JSON.stringify(sig), now),
  ]);

  const created = await first<CaseRow>(db, 'SELECT * FROM neo_store_v2_cases WHERE case_id=?', caseId);
  return {case: created!, signal: {kind: sig.kind, sku_id: sig.sku_id}};
}

export async function transitionCase(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
  toState: string,
  expectedVersion: number,
  reason: string,
): Promise<CaseRow> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  const target = toState as CaseState;

  const c = await first<CaseRow>(db,
    'SELECT * FROM neo_store_v2_cases WHERE case_id=? AND workspace_id=?', caseId, actor.workspaceId);
  v2assert(c, 'NOT_VISIBLE', '事件不存在或不可见');
  assertCaseTransition(c.state as CaseState, target);
  v2assert(c.version === expectedVersion, 'VERSION_CONFLICT', '事件版本已变化，请回读后重试', {expected: expectedVersion, actual: c.version});
  v2assert(typeof reason === 'string' && reason.trim().length > 0, 'INVALID_COMMAND', 'reason 不能为空');

  const now = new Date().toISOString();
  const res = await statement(db,
    `UPDATE neo_store_v2_cases SET state=?, version=version+1, updated_at=? WHERE case_id=? AND workspace_id=? AND version=?`,
    target, now, caseId, actor.workspaceId, expectedVersion,
  ).run();
  v2assert(res.meta.changes === 1, 'VERSION_CONFLICT', '事件版本已变化，请回读后重试');

  return (await first<CaseRow>(db, 'SELECT * FROM neo_store_v2_cases WHERE case_id=?', caseId))!;
}

// DEV07: versioned priority ranking, no LLM scores.
// Active (non-closed) cases first, ordered by state urgency then recency.
// Urgency: detected < decision_ready < acting < observing < investigating < reviewed < closed
// (detected/decision_ready need immediate human attention; acting is in progress; observing waits.)
const STATE_URGENCY: Record<string, number> = {
  detected: 0,
  decision_ready: 1,
  acting: 2,
  observing: 3,
  investigating: 4,
  reviewed: 5,
  closed: 6,
};

export function rankCases(cases: CaseRow[]): CaseRow[] {
  return [...cases].sort((a, b) => {
    const ua = STATE_URGENCY[a.state] ?? 9;
    const ub = STATE_URGENCY[b.state] ?? 9;
    if (ua !== ub) return ua - ub;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export async function listCases(
  runtime: Runtime,
  actor: ActorContext,
  opts: {state?: string; limit?: number},
): Promise<CaseRow[]> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  let rows: CaseRow[];
  if (opts.state) {
    rows = await all<CaseRow>(db,
      'SELECT * FROM neo_store_v2_cases WHERE workspace_id=? AND state=? ORDER BY updated_at DESC', actor.workspaceId, opts.state);
  } else {
    rows = await all<CaseRow>(db,
      'SELECT * FROM neo_store_v2_cases WHERE workspace_id=? ORDER BY updated_at DESC', actor.workspaceId);
  }
  const ranked = rankCases(rows);
  if (opts.limit && opts.limit > 0) return ranked.slice(0, opts.limit);
  return ranked;
}

export async function getCaseDetail(
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
): Promise<{case: CaseRow; signals: Array<{signal_id: string; kind: string; snapshot_id: string; payload: unknown}>}> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  const c = await first<CaseRow>(db,
    'SELECT * FROM neo_store_v2_cases WHERE case_id=? AND workspace_id=?', caseId, actor.workspaceId);
  v2assert(c, 'NOT_VISIBLE', '事件不存在或不可见');
  const signals = await all<{signal_id: string; kind: string; snapshot_id: string; payload: string}>(db,
    'SELECT signal_id, kind, snapshot_id, payload FROM neo_store_v2_case_signals WHERE case_id=? ORDER BY created_at ASC', caseId);
  return {
    case: c,
    signals: signals.map((s) => ({signal_id: s.signal_id, kind: s.kind, snapshot_id: s.snapshot_id, payload: JSON.parse(s.payload)})),
  };
}

// DEV10: Review stores candidate learnings only — never auto-promotes to global rules.
export interface ReviewRecord {
  review_id: string;
  case_id: string;
  conclusion: string;
  candidate_learnings: string[];
  observed_effect: string | null;
  created_at: string;
}

export async function reviewCase(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
  expectedVersion: number,
  conclusion: string,
  candidateLearnings: string[],
  observedEffect: string | null,
): Promise<{case: CaseRow; review: ReviewRecord}> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  v2assert(typeof conclusion === 'string' && conclusion.trim(), 'INVALID_COMMAND', 'conclusion 不能为空');
  v2assert(Array.isArray(candidateLearnings) && candidateLearnings.every((l) => typeof l === 'string'), 'INVALID_COMMAND', 'candidate_learnings 须为字符串数组');

  const c = await first<CaseRow>(db,
    'SELECT * FROM neo_store_v2_cases WHERE case_id=? AND workspace_id=?', caseId, actor.workspaceId);
  v2assert(c, 'NOT_VISIBLE', '事件不存在或不可见');
  // Review requires the case to be in observing or reviewed state.
  assertCaseTransition(c.state as CaseState, 'reviewed');

  const now = new Date().toISOString();
  const reviewId = crypto.randomUUID();
  const learningsJson = JSON.stringify(candidateLearnings);

  await db.batch([
    statement(db,
      `UPDATE neo_store_v2_cases SET state='reviewed', version=version+1, updated_at=? WHERE case_id=? AND workspace_id=? AND version=?`,
      now, caseId, actor.workspaceId, expectedVersion),
    statement(db,
      `INSERT INTO neo_store_v2_case_reviews(review_id,workspace_id,case_id,case_version,conclusion,candidate_learnings,observed_effect,created_at,actor_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      reviewId, actor.workspaceId, caseId, expectedVersion, conclusion, learningsJson, observedEffect, now, actor.actorId),
  ]);

  const updated = await first<CaseRow>(db, 'SELECT * FROM neo_store_v2_cases WHERE case_id=?', caseId);
  v2assert(updated && updated.version === expectedVersion + 1, 'VERSION_CONFLICT', '事件版本已变化，请回读后重试');

  return {
    case: updated!,
    review: {
      review_id: reviewId, case_id: caseId, conclusion,
      candidate_learnings: candidateLearnings, observed_effect: observedEffect, created_at: now,
    },
  };
}

export async function closeCase(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
  expectedVersion: number,
  reason: string,
): Promise<CaseRow> {
  requireActorWrite(request, actor);
  return transitionCase(request, runtime, actor, caseId, 'closed', expectedVersion, reason);
}

export async function reopenCase(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
  expectedVersion: number,
  reason: string,
): Promise<CaseRow> {
  requireActorWrite(request, actor);
  // closed → investigating
  return transitionCase(request, runtime, actor, caseId, 'investigating', expectedVersion, reason);
}

export async function listReviews(
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
): Promise<ReviewRecord[]> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const rows = await all<{review_id: string; case_id: string; conclusion: string; candidate_learnings: string; observed_effect: string | null; created_at: string}>(runtime.DB,
    'SELECT review_id, case_id, conclusion, candidate_learnings, observed_effect, created_at FROM neo_store_v2_case_reviews WHERE workspace_id=? AND case_id=? ORDER BY created_at DESC',
    actor.workspaceId, caseId);
  return rows.map((r) => ({
    review_id: r.review_id, case_id: r.case_id, conclusion: r.conclusion,
    candidate_learnings: JSON.parse(r.candidate_learnings), observed_effect: r.observed_effect, created_at: r.created_at,
  }));
}


