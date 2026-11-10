-- DEV10: Case reviews (candidate learnings) and close/reopen audit.
-- Reviews store candidate learnings only; they never become global rules automatically.
-- Close/reopen always require a reason and are version-gated.

CREATE TABLE IF NOT EXISTS neo_store_v2_case_reviews (
  review_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_version INTEGER NOT NULL,
  conclusion TEXT NOT NULL,
  candidate_learnings TEXT NOT NULL DEFAULT '[]',
  observed_effect TEXT,
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES neo_store_v2_cases(case_id)
);
CREATE INDEX IF NOT EXISTS idx_case_reviews_case ON neo_store_v2_case_reviews(case_id);
