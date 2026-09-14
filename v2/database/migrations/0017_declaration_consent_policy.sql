-- Phase O declaration evidence is application-specific, value-free, and append-only.
-- Raw declaration wording, DOM values, and candidate profile answers are deliberately absent.
CREATE TABLE application_declaration_evidence (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  evidence_event_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 170),
  request_fingerprint char(64) NOT NULL,
  page_instance_id uuid NOT NULL,
  form_instance_id text NOT NULL CHECK (length(form_instance_id) BETWEEN 8 AND 100),
  field_runtime_id text NOT NULL CHECK (length(field_runtime_id) BETWEEN 8 AND 100),
  control_fingerprint text NOT NULL CHECK (length(control_fingerprint) BETWEEN 8 AND 80),
  descriptor_fingerprint char(64) NOT NULL,
  graph_revision integer NOT NULL CHECK (graph_revision > 0),
  graph_fingerprint char(64) NOT NULL,
  declaration_type text NOT NULL CHECK (declaration_type IN (
    'ACCURACY_CERTIFICATION', 'PRIVACY_ACKNOWLEDGEMENT', 'TERMS_ACKNOWLEDGEMENT',
    'BACKGROUND_CHECK_CONSENT', 'DATA_PROCESSING_CONSENT', 'APPLICANT_CERTIFICATION',
    'EEO_ACKNOWLEDGEMENT', 'APPLICATION_SPECIFIC_ACKNOWLEDGEMENT', 'UNKNOWN_DECLARATION'
  )),
  semantic_confidence numeric(5,4) NOT NULL CHECK (semantic_confidence BETWEEN 0 AND 1),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 60),
  policy_decision text NOT NULL CHECK (policy_decision IN (
    'AUTO_ALLOWED', 'PREPARE_FOR_REVIEW', 'REQUIRES_EXPLICIT_USER_ACTION', 'BLOCKED', 'UNRESOLVED'
  )),
  decision_fingerprint char(64) NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'POLICY_DECIDED', 'AUTO_INTERACTED', 'PREPARED', 'CANDIDATE_ACTION_OBSERVED',
    'CANDIDATE_MODIFIED', 'EXECUTION_FAILED', 'VERIFICATION_FAILED',
    'REVIEW_PRESENTED', 'SUBMISSION_VERIFIED'
  )),
  action_origin text NOT NULL CHECK (action_origin IN ('POLICY_ENGINE', 'COPILOT', 'CANDIDATE', 'SYSTEM')),
  operation_id uuid,
  execution_status text CHECK (execution_status IS NULL OR execution_status IN ('VERIFIED', 'FAILED', 'SKIPPED', 'ABORTED')),
  verification_status text CHECK (verification_status IS NULL OR verification_status IN (
    'VERIFIED', 'FAILED', 'AMBIGUOUS', 'STALE_FIELD', 'PAGE_TRANSITIONED',
    'USER_MODIFIED', 'UNVERIFIABLE'
  )),
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'DECLARATION_UNRESOLVED', 'DECLARATION_POLICY_BLOCKED', 'DECLARATION_USER_ACTION_REQUIRED',
    'DECLARATION_TEXT_UNAVAILABLE', 'DECLARATION_POLICY_AMBIGUOUS', 'DECLARATION_EXECUTION_FAILED',
    'DECLARATION_VERIFICATION_FAILED', 'DECLARATION_MODIFIED_BY_USER', 'DECLARATION_STALE',
    'DECLARATION_CONTEXT_CHANGED', 'POLICY_AUTHORIZATION_REQUIRED'
  )),
  required boolean NOT NULL,
  candidate_modified boolean NOT NULL,
  final_review_state text NOT NULL CHECK (final_review_state IN ('NOT_PRESENTED', 'PRESENTED', 'SUBMISSION_VERIFIED')),
  checkpoint_id uuid,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (candidate_id, evidence_event_id),
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (application_id, candidate_id, account_id) REFERENCES applications(id, candidate_id, account_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

CREATE INDEX application_declaration_evidence_run_timeline_idx
  ON application_declaration_evidence (run_id, occurred_at, id);
CREATE INDEX application_declaration_evidence_policy_aggregate_idx
  ON application_declaration_evidence (policy_version, declaration_type, policy_decision, event_type, occurred_at DESC);
CREATE INDEX application_declaration_evidence_attention_idx
  ON application_declaration_evidence (account_id, event_type, failure_code, occurred_at DESC)
  WHERE failure_code IS NOT NULL OR event_type IN ('CANDIDATE_MODIFIED', 'EXECUTION_FAILED', 'VERIFICATION_FAILED');

ALTER TABLE application_declaration_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_declaration_evidence_own_account ON application_declaration_evidence
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());

CREATE FUNCTION app_private.reject_application_declaration_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'application declaration evidence is append-only'; END $$;

CREATE TRIGGER application_declaration_evidence_no_update
  BEFORE UPDATE OR DELETE ON application_declaration_evidence
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_application_declaration_evidence_mutation();
