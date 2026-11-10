-- DEV05: Case/Signal/Task persistence for the out-of-stock vertical closed loop.
-- Cases and tasks are versioned (CAS). Signals reference immutable snapshot+metric evidence.

CREATE TABLE IF NOT EXISTS neo_store_v2_cases (
  case_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  open_key TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_case_workspace ON neo_store_v2_cases(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_case_open_key ON neo_store_v2_cases(workspace_id, open_key);

CREATE TABLE IF NOT EXISTS neo_store_v2_case_signals (
  signal_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES neo_store_v2_cases(case_id),
  kind TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  metric_result_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_signal_case ON neo_store_v2_case_signals(case_id);

CREATE TABLE IF NOT EXISTS neo_store_v2_tasks (
  task_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  case_id TEXT REFERENCES neo_store_v2_cases(case_id),
  plan_revision_id TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_task_workspace ON neo_store_v2_tasks(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_task_plan ON neo_store_v2_tasks(workspace_id, plan_revision_id);
