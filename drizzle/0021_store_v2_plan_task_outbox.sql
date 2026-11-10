-- DEV08: Plan revisions, approvals, task events, outbox, and audit log.
-- 0020 already created neo_store_v2_tasks with a minimal schema; this migration
-- extends it for the full task state machine (previous_state, action_type) and
-- drops the plan-unique constraint so one approved plan can spawn many tasks.

CREATE TABLE IF NOT EXISTS neo_store_v2_plan_revisions (
  plan_revision_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  plan_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES neo_store_v2_cases(case_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_ws_case ON neo_store_v2_plan_revisions(workspace_id, case_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_plan_revision_ws_case_ver ON neo_store_v2_plan_revisions(workspace_id, case_id, version);

CREATE TABLE IF NOT EXISTS neo_store_v2_approvals (
  approval_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  plan_revision_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  approver_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_revision_id) REFERENCES neo_store_v2_plan_revisions(plan_revision_id)
);
CREATE INDEX IF NOT EXISTS idx_approvals_revision ON neo_store_v2_approvals(plan_revision_id);

-- Extend the 0020 tasks table for the state machine.
ALTER TABLE neo_store_v2_tasks ADD COLUMN previous_state TEXT;
ALTER TABLE neo_store_v2_tasks ADD COLUMN action_type TEXT;
-- 0020 enforced one task per plan; DEV08 allows multiple tasks per approved plan.
DROP INDEX IF EXISTS uq_v2_task_plan;
CREATE INDEX IF NOT EXISTS idx_tasks_ws_case ON neo_store_v2_tasks(workspace_id, case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_plan_revision ON neo_store_v2_tasks(plan_revision_id);

CREATE TABLE IF NOT EXISTS neo_store_v2_task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  command TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES neo_store_v2_tasks(task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON neo_store_v2_task_events(task_id);

CREATE TABLE IF NOT EXISTS neo_store_v2_outbox (
  outbox_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  dispatched_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outbox_idempotency ON neo_store_v2_outbox(workspace_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON neo_store_v2_outbox(status);

CREATE TABLE IF NOT EXISTS neo_store_v2_audit_log (
  audit_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_version INTEGER,
  after_version INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ws_resource ON neo_store_v2_audit_log(workspace_id, resource, resource_id);
