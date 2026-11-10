-- DEV03: neo.store-input.v2 staging, immutable snapshots and isolated facts.
-- v2 facts never mix with v1 business_facts; snapshots pin a published revision set.

CREATE TABLE IF NOT EXISTS neo_store_v2_imports (
  import_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  grain TEXT NOT NULL,
  data_kind TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  source_semantics_version TEXT NOT NULL,
  status TEXT NOT NULL,
  validation_revision INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  counts TEXT NOT NULL,
  isolated_skus TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  errors TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  actor_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_import_workspace ON neo_store_v2_imports(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_import_hash ON neo_store_v2_imports(workspace_id, file_hash);

CREATE TABLE IF NOT EXISTS neo_store_v2_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  import_id TEXT NOT NULL REFERENCES neo_store_v2_imports(import_id),
  scope_hash TEXT NOT NULL,
  grain TEXT NOT NULL,
  manifest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_snapshot_workspace ON neo_store_v2_snapshots(workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v2_snapshot_import ON neo_store_v2_snapshots(import_id);

CREATE TABLE IF NOT EXISTS neo_store_v2_facts (
  fact_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES neo_store_v2_snapshots(snapshot_id),
  kind TEXT NOT NULL,
  grain TEXT NOT NULL,
  business_date TEXT,
  source_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_facts_snapshot ON neo_store_v2_facts(snapshot_id, kind);
CREATE INDEX IF NOT EXISTS idx_v2_facts_workspace ON neo_store_v2_facts(workspace_id, kind, business_date);
