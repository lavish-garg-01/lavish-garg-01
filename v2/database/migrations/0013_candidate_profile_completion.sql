CREATE TABLE candidate_onboarding_completion_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  onboarding_version integer NOT NULL CHECK (onboarding_version > 0),
  completed_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id)
);

ALTER TABLE candidate_onboarding_completion_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_onboarding_completion_receipts_own_account
  ON candidate_onboarding_completion_receipts
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());

CREATE TRIGGER candidate_onboarding_completion_receipts_no_update
  BEFORE UPDATE OR DELETE ON candidate_onboarding_completion_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_resume_immutable_mutation();
