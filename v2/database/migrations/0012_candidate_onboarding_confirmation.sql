CREATE TABLE candidate_entity_source_keys (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 240),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('EMPLOYMENT', 'EDUCATION', 'PROJECT', 'CERTIFICATION', 'LANGUAGE')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (candidate_id, source_key),
  UNIQUE (entity_id, candidate_id),
  FOREIGN KEY (entity_id, candidate_id) REFERENCES candidate_entities(id, candidate_id)
);

CREATE TABLE candidate_onboarding_confirmation_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  extraction_id uuid,
  change_set_id uuid,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  accepted_count smallint NOT NULL CHECK (accepted_count BETWEEN 0 AND 50),
  corrected_count smallint NOT NULL CHECK (corrected_count BETWEEN 0 AND 50),
  removed_count smallint NOT NULL CHECK (removed_count BETWEEN 0 AND 50),
  skipped_count smallint NOT NULL CHECK (skipped_count BETWEEN 0 AND 50),
  unchanged_match_count smallint NOT NULL CHECK (unchanged_match_count BETWEEN 0 AND 50),
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (extraction_id, candidate_id) REFERENCES resume_extraction_runs(id, candidate_id),
  FOREIGN KEY (change_set_id, candidate_id) REFERENCES candidate_answer_change_sets(id, candidate_id)
);

ALTER TABLE candidate_entity_source_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_onboarding_confirmation_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_entity_source_keys_own_candidate ON candidate_entity_source_keys
  USING (
    EXISTS (
      SELECT 1 FROM candidates
      WHERE candidates.id = candidate_entity_source_keys.candidate_id
        AND candidates.account_id = app_private.current_account_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM candidates
      WHERE candidates.id = candidate_entity_source_keys.candidate_id
        AND candidates.account_id = app_private.current_account_id()
    )
  );

CREATE POLICY candidate_onboarding_confirmation_receipts_own_account
  ON candidate_onboarding_confirmation_receipts
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());

CREATE TRIGGER candidate_entity_source_keys_no_update
  BEFORE UPDATE OR DELETE ON candidate_entity_source_keys
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_resume_immutable_mutation();

CREATE TRIGGER candidate_onboarding_confirmation_receipts_no_update
  BEFORE UPDATE OR DELETE ON candidate_onboarding_confirmation_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_resume_immutable_mutation();
