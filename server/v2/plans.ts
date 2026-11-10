// DEV08: Plan revisions and approvals. A plan revision is frozen once approved;
// subsequent edits create a new revision with an incremented version.
// Approvals bind to plan_revision_id + plan_hash (immutable content fingerprint).

import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {assertPlanTransition, assertApprovalDecision, type PlanState} from '../../lib/store-v2/contracts/commands.ts';
import {requireActorWrite, type ActorContext} from './auth.ts';
import {hash} from '../csv.ts';
import {all, first, statement, type Runtime} from '../store.ts';

export interface PlanRow {
  plan_revision_id: string;
  workspace_id: string;
  case_id: string;
  version: number;
  state: string;
  plan_hash: string;
  title: string;
  payload: string;
  created_at: string;
  updated_at: string;
  actor_id: string;
}

export async function createPlanRevision(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
  title: string,
  payload: unknown,
): Promise<PlanRow> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  v2assert(typeof title === 'string' && title.trim(), 'INVALID_COMMAND', 'title 不能为空');
  v2assert(payload !== null && typeof payload === 'object', 'INVALID_COMMAND', 'payload 须为对象');

  // Verify the case exists in this workspace.
  const c = await first<{case_id: string}>(db,
    'SELECT case_id FROM neo_store_v2_cases WHERE case_id=? AND workspace_id=?', caseId, actor.workspaceId);
  v2assert(c, 'NOT_VISIBLE', '事件不存在或不可见');

  // Next version = max(version) + 1 for this case.
  const maxRow = await first<{v: number}>(db,
    'SELECT MAX(version) AS v FROM neo_store_v2_plan_revisions WHERE workspace_id=? AND case_id=?', actor.workspaceId, caseId);
  const version = (maxRow?.v ?? -1) + 1;

  const planRevisionId = crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);
  const planHash = await hash(payloadStr);
  const now = new Date().toISOString();

  await statement(db,
    `INSERT INTO neo_store_v2_plan_revisions(plan_revision_id,workspace_id,case_id,version,state,plan_hash,title,payload,created_at,updated_at,actor_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    planRevisionId, actor.workspaceId, caseId, version, 'draft', planHash, title, payloadStr, now, now, actor.actorId,
  ).run();

  await writeAudit(db, actor.workspaceId, actor.actorId, 'plan_revision', planRevisionId, 'create', null, 0);
  return (await first<PlanRow>(db, 'SELECT * FROM neo_store_v2_plan_revisions WHERE plan_revision_id=?', planRevisionId))!;
}

export async function submitPlan(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  planRevisionId: string,
  expectedVersion: number,
): Promise<PlanRow> {
  requireActorWrite(request, actor);
  return transitionPlan(runtime, actor, planRevisionId, expectedVersion, 'submitted', '提交审批');
}

export async function decidePlan(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  input: unknown,
): Promise<PlanRow> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;

  // Load current revision for CAS + content binding.
  const raw = input as Record<string, unknown>;
  const planRevisionId = String(raw.plan_revision_id ?? '');
  const plan = await first<PlanRow>(db,
    'SELECT * FROM neo_store_v2_plan_revisions WHERE plan_revision_id=? AND workspace_id=?', planRevisionId, actor.workspaceId);
  v2assert(plan, 'NOT_VISIBLE', '方案不存在或不可见');

  const decision = assertApprovalDecision(input, {
    version: plan.version,
    plan_revision_id: plan.plan_revision_id,
    plan_hash: plan.plan_hash,
  });

  const target: PlanState = decision.decision === 'approve' ? 'approved' : 'rejected';
  assertPlanTransition(plan.state as PlanState, target);

  const now = new Date().toISOString();
  const approvalId = crypto.randomUUID();
  const res = await statement(db,
    `UPDATE neo_store_v2_plan_revisions SET state=?, updated_at=? WHERE plan_revision_id=? AND workspace_id=? AND version=?`,
    target, now, planRevisionId, actor.workspaceId, decision.expected_version,
  ).run();
  v2assert(res.meta.changes === 1, 'VERSION_CONFLICT', '方案版本已变化，请回读后重试');

  await statement(db,
    `INSERT INTO neo_store_v2_approvals(approval_id,workspace_id,plan_revision_id,decision,reason,approver_id,created_at)
     VALUES (?,?,?,?,?,?,?)`,
    approvalId, actor.workspaceId, planRevisionId, decision.decision, decision.reason, actor.actorId, now,
  ).run();
  await writeAudit(db, actor.workspaceId, actor.actorId, 'plan_revision', planRevisionId, decision.decision, decision.expected_version, decision.expected_version);

  return (await first<PlanRow>(db, 'SELECT * FROM neo_store_v2_plan_revisions WHERE plan_revision_id=?', planRevisionId))!;
}

async function transitionPlan(
  runtime: Runtime, actor: ActorContext, planRevisionId: string, expectedVersion: number, target: PlanState, action: string,
): Promise<PlanRow> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  const plan = await first<PlanRow>(db,
    'SELECT * FROM neo_store_v2_plan_revisions WHERE plan_revision_id=? AND workspace_id=?', planRevisionId, actor.workspaceId);
  v2assert(plan, 'NOT_VISIBLE', '方案不存在或不可见');
  assertPlanTransition(plan.state as PlanState, target);
  v2assert(plan.version === expectedVersion, 'VERSION_CONFLICT', '方案版本已变化', {expected: expectedVersion, actual: plan.version});

  const now = new Date().toISOString();
  const res = await statement(db,
    `UPDATE neo_store_v2_plan_revisions SET state=?, updated_at=? WHERE plan_revision_id=? AND workspace_id=? AND version=?`,
    target, now, planRevisionId, actor.workspaceId, expectedVersion,
  ).run();
  v2assert(res.meta.changes === 1, 'VERSION_CONFLICT', '方案版本已变化，请回读后重试');
  await writeAudit(db, actor.workspaceId, actor.actorId, 'plan_revision', planRevisionId, action, expectedVersion, expectedVersion);
  return (await first<PlanRow>(db, 'SELECT * FROM neo_store_v2_plan_revisions WHERE plan_revision_id=?', planRevisionId))!;
}

async function writeAudit(
  db: NonNullable<Runtime['DB']>, workspaceId: string, actorId: string,
  resource: string, resourceId: string, action: string, before: number | null, after: number,
): Promise<void> {
  await statement(db,
    `INSERT INTO neo_store_v2_audit_log(audit_id,workspace_id,actor_id,resource,resource_id,action,before_version,after_version,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), workspaceId, actorId, resource, resourceId, action, before, after, new Date().toISOString(),
  ).run();
}

export async function listPlans(runtime: Runtime, actor: ActorContext, caseId: string): Promise<PlanRow[]> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  return all<PlanRow>(runtime.DB,
    'SELECT * FROM neo_store_v2_plan_revisions WHERE workspace_id=? AND case_id=? ORDER BY version DESC', actor.workspaceId, caseId);
}
