CREATE TABLE candidate_learning_inbox (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES applications(id),
  run_id uuid NOT NULL REFERENCES application_runs(id),
  payload jsonb,
  fingerprint char(64) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(candidate_id,account_id) REFERENCES candidates(id,account_id)
);
CREATE INDEX candidate_learning_inbox_owner ON candidate_learning_inbox(candidate_id,created_at DESC);
ALTER TABLE candidate_learning_inbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE autofill_outcome_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES applications(id),
  run_id uuid NOT NULL REFERENCES application_runs(id),
  question_id uuid,
  stage text NOT NULL CHECK (stage IN ('SCAN','RESOLVE','PLAN','EXECUTE','VERIFY','LEARN')),
  code text NOT NULL CHECK (code IN ('API_TIMEOUT','API_UNAVAILABLE','NO_SAFE_OPERATION','POPUP_ASSOCIATION_UNPROVEN','CONTROL_VALIDATION_FAILED','REPRESENTATION_INVALID','STALE_PLAN','CHECKPOINT_FAILED','SCAN_INCOMPLETE')),
  release text NOT NULL CHECK (release = 'ADAPTIVE_CHECKPOINT_4'),
  fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(candidate_id,account_id) REFERENCES candidates(id,account_id)
);
CREATE INDEX autofill_outcome_group ON autofill_outcome_events(release,stage,code,run_id);
ALTER TABLE autofill_outcome_events ENABLE ROW LEVEL SECURITY;
-- Server-only, tenant-filtered repositories. No candidate/global operator grants.
