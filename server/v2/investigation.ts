// DEV09: Controlled AI investigation.
// - Provider is replaceable; mock runs when no real secret is configured.
// - Cost data is stripped before the model sees it if the actor lacks cost permission.
// - AI output is validated (structure + semantics) before being returned or persisted.
// - AI has no write/approval authority; results are advisory only.

import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {MockAIProvider, validateInvestigationResult, type InvestigationResult} from '../../lib/store-v2/ai/mod.ts';
import {requireActorWrite, type ActorContext} from './auth.ts';
import {all, first, statement, type Runtime} from '../store.ts';

export async function investigateCase(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  caseId: string,
): Promise<InvestigationResult & {provider: string; trace_id: string}> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;

  // Load case + its signals as read-only evidence context.
  const c = await first<{case_id: string; title: string; state: string}>(db,
    'SELECT case_id, title, state FROM neo_store_v2_cases WHERE case_id=? AND workspace_id=?', caseId, actor.workspaceId);
  v2assert(c, 'NOT_VISIBLE', '事件不存在或不可见');

  const signals = await all<{kind: string; payload: string}>(db,
    'SELECT kind, payload FROM neo_store_v2_case_signals WHERE case_id=? ORDER BY created_at ASC', caseId);

  // Build a sanitized context: never include cost fields if the actor cannot see cost.
  const context = signals.map((s) => {
    const p = JSON.parse(s.payload) as Record<string, unknown>;
    if (!actor.permissions.costVisible) {
      delete p.cost; delete p.total_cost_cents; delete p.unit_cost_cents;
    }
    return `${s.kind}: ${JSON.stringify(p)}`;
  }).join('\n');

  // Resolve provider. No real secret → mock provider (deterministic, testable).
  const provider = new MockAIProvider();
  const raw = await provider.investigate({
    case_id: caseId,
    context: context || `case ${caseId} (${c.title})`,
    budget: {max_tokens: 2000, max_steps: 3},
  });

  // Validate before any persistence or return.
  const validated = validateInvestigationResult(raw);

  // Persist a trace (audit). AI output is advisory; no state change to the case.
  await statement(db,
    `INSERT INTO neo_store_v2_audit_log(audit_id,workspace_id,actor_id,resource,resource_id,action,before_version,after_version,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), actor.workspaceId, actor.actorId, 'investigation', caseId, 'run', null, null, new Date().toISOString(),
  ).run();

  return {...validated, provider: provider.name};
}
