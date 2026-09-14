-- Phase L keeps candidate-private staging encrypted and all operational evidence value-free.

CREATE TABLE candidate_learning_run_receipts (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (run_id, application_id),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

CREATE TABLE application_execution_evidence (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  page_instance_id uuid NOT NULL,
  field_runtime_id text NOT NULL,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  answer_version_id uuid NOT NULL,
  representation_id text NOT NULL,
  execution_status text NOT NULL CHECK (execution_status IN ('VERIFIED', 'FAILED', 'SKIPPED', 'ABORTED')),
  verification_status text NOT NULL CHECK (verification_status IN (
    'VERIFIED', 'FAILED', 'AMBIGUOUS', 'STALE_FIELD', 'PAGE_TRANSITIONED', 'USER_MODIFIED', 'UNVERIFIABLE'
  )),
  failure_class text,
  strategy_id text,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  recorded_at timestamptz NOT NULL,
  UNIQUE (run_id, operation_id),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id),
  FOREIGN KEY (answer_version_id, candidate_id) REFERENCES candidate_answer_versions(id, candidate_id)
);

CREATE INDEX application_execution_evidence_field_idx
  ON application_execution_evidence (run_id, field_runtime_id, recorded_at DESC);

CREATE TABLE candidate_learning_observations (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  page_instance_id uuid NOT NULL,
  form_instance_id text NOT NULL,
  field_runtime_id text NOT NULL,
  control_fingerprint text NOT NULL,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  entity_id uuid,
  scope_id uuid NOT NULL,
  used_answer_version_id uuid,
  prior_operation_id uuid,
  origin text NOT NULL CHECK (origin IN (
    'COPILOT_EXECUTED', 'USER_ENTERED', 'USER_CORRECTED', 'USER_CONFIRMED', 'PAGE_CHANGED', 'UNKNOWN_ORIGIN'
  )),
  observation_type text NOT NULL CHECK (observation_type IN (
    'MANUAL_ANSWER', 'COPILOT_CORRECTION', 'ANSWER_CONFIRMATION'
  )),
  attribution text NOT NULL CHECK (attribution IN (
    'CANDIDATE_ANSWER_ENTRY', 'CANDIDATE_ANSWER_CORRECTION', 'CANDIDATE_ANSWER_CONFIRMATION',
    'SEMANTIC_MAPPING_SUSPECT', 'REPRESENTATION_SUSPECT', 'INTERACTION_SUSPECT',
    'AMBIGUOUS', 'NO_LEARNING'
  )),
  semantic_descriptor_fingerprint text NOT NULL CHECK (length(semantic_descriptor_fingerprint) = 64),
  semantic_confidence numeric(5,4) NOT NULL CHECK (semantic_confidence >= 0 AND semantic_confidence <= 1),
  semantic_resolver text NOT NULL,
  final_value_fingerprint text NOT NULL CHECK (length(final_value_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  expected_current_version_id uuid,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  status text NOT NULL CHECK (status IN ('RECORDED', 'CONSUMED', 'SKIPPED', 'EXPIRED')),
  checkpoint_id uuid,
  consumed_change_set_id uuid,
  recorded_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (run_id, field_runtime_id, final_value_fingerprint, observation_type),
  UNIQUE (id, candidate_id),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id),
  FOREIGN KEY (proposal_id, candidate_id) REFERENCES candidate_answer_runtime_proposals(id, candidate_id),
  FOREIGN KEY (entity_id, candidate_id) REFERENCES candidate_entities(id, candidate_id),
  FOREIGN KEY (scope_id, candidate_id) REFERENCES candidate_answer_scopes(id, candidate_id),
  FOREIGN KEY (used_answer_version_id, candidate_id) REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (expected_current_version_id, candidate_id) REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (checkpoint_id, application_id) REFERENCES application_checkpoints(id, application_id),
  FOREIGN KEY (consumed_change_set_id, candidate_id) REFERENCES candidate_answer_change_sets(id, candidate_id),
  CHECK (expires_at > recorded_at),
  CHECK (
    (status = 'RECORDED' AND checkpoint_id IS NULL AND consumed_change_set_id IS NULL AND consumed_at IS NULL)
    OR (status = 'CONSUMED' AND checkpoint_id IS NOT NULL AND consumed_change_set_id IS NOT NULL AND consumed_at IS NOT NULL)
    OR (status IN ('SKIPPED', 'EXPIRED') AND consumed_change_set_id IS NULL)
  )
);

CREATE INDEX candidate_learning_observations_pending_idx
  ON candidate_learning_observations (candidate_id, run_id, recorded_at)
  WHERE status = 'RECORDED';

CREATE TABLE candidate_learning_checkpoint_receipts (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  change_set_id uuid,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  checkpoint_status text NOT NULL CHECK (checkpoint_status IN ('VERIFIED', 'REJECTED')),
  saved_count integer NOT NULL DEFAULT 0 CHECK (saved_count >= 0),
  ask_again_count integer NOT NULL DEFAULT 0 CHECK (ask_again_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  created_at timestamptz NOT NULL,
  finalized_at timestamptz,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (run_id, checkpoint_id),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id),
  FOREIGN KEY (checkpoint_id, application_id) REFERENCES application_checkpoints(id, application_id),
  FOREIGN KEY (change_set_id, candidate_id) REFERENCES candidate_answer_change_sets(id, candidate_id)
);

CREATE TABLE candidate_learning_submit_attempts (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  page_instance_id uuid NOT NULL,
  form_instance_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  occurred_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (run_id, occurred_at),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

CREATE FUNCTION app_private.guard_candidate_learning_observation_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'RECORDED'
     OR NEW.status NOT IN ('CONSUMED', 'SKIPPED', 'EXPIRED')
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
     OR NEW.page_instance_id IS DISTINCT FROM OLD.page_instance_id
     OR NEW.form_instance_id IS DISTINCT FROM OLD.form_instance_id
     OR NEW.field_runtime_id IS DISTINCT FROM OLD.field_runtime_id
     OR NEW.control_fingerprint IS DISTINCT FROM OLD.control_fingerprint
     OR NEW.canonical_id IS DISTINCT FROM OLD.canonical_id
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
     OR NEW.used_answer_version_id IS DISTINCT FROM OLD.used_answer_version_id
     OR NEW.prior_operation_id IS DISTINCT FROM OLD.prior_operation_id
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.observation_type IS DISTINCT FROM OLD.observation_type
     OR NEW.attribution IS DISTINCT FROM OLD.attribution
     OR NEW.semantic_descriptor_fingerprint IS DISTINCT FROM OLD.semantic_descriptor_fingerprint
     OR NEW.semantic_confidence IS DISTINCT FROM OLD.semantic_confidence
     OR NEW.semantic_resolver IS DISTINCT FROM OLD.semantic_resolver
     OR NEW.final_value_fingerprint IS DISTINCT FROM OLD.final_value_fingerprint
     OR NEW.fingerprint_key_version IS DISTINCT FROM OLD.fingerprint_key_version
     OR NEW.expected_current_version_id IS DISTINCT FROM OLD.expected_current_version_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'candidate learning observations are immutable outside terminal consumption';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_learning_observation_update_guard
  BEFORE UPDATE ON candidate_learning_observations
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_candidate_learning_observation_update();

ALTER TABLE candidate_learning_run_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_execution_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_learning_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_learning_checkpoint_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_learning_submit_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_learning_run_receipts_own_account ON candidate_learning_run_receipts
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY application_execution_evidence_own_account ON application_execution_evidence
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_learning_observations_own_account ON candidate_learning_observations
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_learning_checkpoint_receipts_own_account ON candidate_learning_checkpoint_receipts
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_learning_submit_attempts_own_account ON candidate_learning_submit_attempts
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
