CREATE TABLE candidate_onboarding_states (
  candidate_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('WELCOME', 'RESUME', 'REVIEW', 'PROFILE', 'READY')),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (candidate_id, account_id),
  UNIQUE (account_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR stage = 'READY')
);

CREATE INDEX candidate_onboarding_states_status_idx
  ON candidate_onboarding_states (account_id, status, last_seen_at DESC);

ALTER TABLE candidate_onboarding_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_onboarding_states_own_account ON candidate_onboarding_states
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
