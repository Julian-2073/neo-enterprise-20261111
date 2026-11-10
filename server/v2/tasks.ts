// DEV08: Task lifecycle bound to an approved plan revision.
// Every command is versioned (CAS) and validated against the state machine.
// Completion requires evidence_ids (non-empty) per the audit contract.

import {StoreV2Error, v2assert} from '../../lib/store-v2/contracts/errors.ts';
import {validateTaskCommand, type TaskCommand, type TaskState} from '../../lib/store-v2/contracts/commands.ts';
import {requireActorWrite, type ActorContext} from './auth.ts';
import {all, first, statement, type Runtime} from '../store.ts';

export interface TaskRow {
  task_id: string;
  workspace_id: string;
  case_id: string;
  plan_revision_id: string;
  state: string;
  version: number;
  previous_state: string | null;
  title: string;
  action_type: string;
  created_at: string;
  updated_at: string;
  actor_id: string;
}

export async function createTask(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  planRevisionId: string,
  title: string,
  actionType: string,
): Promise<TaskRow> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;
  v2assert(typeof title === 'string' && title.trim(), 'INVALID_COMMAND', 'title 不能为空');
  v2assert(typeof actionType === 'string' && actionType.trim(), 'INVALID_COMMAND', 'action_type 不能为空');

  // Task can only be created from an approved plan revision in this workspace.
  const plan = await first<{plan_revision_id: string; case_id: string; state: string}>(db,
    'SELECT plan_revision_id, case_id, state FROM neo_store_v2_plan_revisions WHERE plan_revision_id=? AND workspace_id=?',
    planRevisionId, actor.workspaceId);
  v2assert(plan, 'NOT_VISIBLE', '方案不存在或不可见');
  v2assert(plan.state === 'approved', 'INVALID_COMMAND', '只能从已审批的方案创建任务', {state: plan.state});

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  await statement(db,
    `INSERT INTO neo_store_v2_tasks(task_id,workspace_id,case_id,plan_revision_id,state,version,previous_state,title,action_type,payload,created_at,updated_at,actor_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    taskId, actor.workspaceId, plan.case_id, planRevisionId, 'pending_confirmation', 0, null, title, actionType, '{}', now, now, actor.actorId,
  ).run();
  return (await first<TaskRow>(db, 'SELECT * FROM neo_store_v2_tasks WHERE task_id=?', taskId))!;
}

export async function transitionTask(
  request: Request,
  runtime: Runtime,
  actor: ActorContext,
  taskId: string,
  rawCommand: unknown,
): Promise<TaskRow> {
  requireActorWrite(request, actor);
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  const db = runtime.DB;

  const task = await first<TaskRow>(db,
    'SELECT * FROM neo_store_v2_tasks WHERE task_id=? AND workspace_id=?', taskId, actor.workspaceId);
  v2assert(task, 'NOT_VISIBLE', '任务不存在或不可见');

  const cmd: TaskCommand & {next_state: TaskState} = validateTaskCommand(rawCommand, {
    from: task.state,
    previousState: task.previous_state as TaskState | undefined,
  });

  // Completion (verify) requires evidence.
  if (cmd.command === 'verify') {
    v2assert(cmd.evidence_ids.length > 0, 'INVALID_COMMAND', '验收完成须至少提供一个证据 ID');
  }

  // CAS: update only if version matches expected.
  const now = new Date().toISOString();
  const nextState = cmd.next_state;
  const previousState = nextState === 'blocked' ? task.state : task.previous_state;

  const res = await statement(db,
    `UPDATE neo_store_v2_tasks SET state=?, version=version+1, previous_state=?, updated_at=?
     WHERE task_id=? AND workspace_id=? AND version=?`,
    nextState, previousState, now, taskId, actor.workspaceId, cmd.expected_version,
  ).run();
  v2assert(res.meta.changes === 1, 'VERSION_CONFLICT', '任务版本已变化，请回读后重试', {
    expected: cmd.expected_version, actual: task.version,
  });

  // Record the event (audit trail).
  await statement(db,
    `INSERT INTO neo_store_v2_task_events(event_id,task_id,command,from_state,to_state,reason,evidence_ids,actor_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    crypto.randomUUID(), taskId, cmd.command, task.state, nextState, cmd.reason,
    JSON.stringify(cmd.evidence_ids), actor.actorId, now,
  ).run();

  return (await first<TaskRow>(db, 'SELECT * FROM neo_store_v2_tasks WHERE task_id=?', taskId))!;
}

export async function listTasks(runtime: Runtime, actor: ActorContext, caseId?: string): Promise<TaskRow[]> {
  v2assert(runtime.DB, 'STORAGE_UNAVAILABLE', 'D1 数据库不可用');
  if (caseId) {
    return all<TaskRow>(runtime.DB,
      'SELECT * FROM neo_store_v2_tasks WHERE workspace_id=? AND case_id=? ORDER BY updated_at DESC', actor.workspaceId, caseId);
  }
  return all<TaskRow>(runtime.DB,
    'SELECT * FROM neo_store_v2_tasks WHERE workspace_id=? ORDER BY updated_at DESC', actor.workspaceId);
}
