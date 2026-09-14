ALTER TABLE candidate_answer_change_set_items
  ADD COLUMN transition_kind text NOT NULL DEFAULT 'LEGACY_MUTATION',
  ADD CONSTRAINT candidate_answer_change_set_items_transition_kind_check
    CHECK (transition_kind IN (
      'CREATE_TRUSTED',
      'CREATE_REVIEW',
      'REPLACE_TRUSTED',
      'REPLACE_REVIEW',
      'PROMOTE_TRUSTED',
      'CORRECT_REVIEW',
      'REMOVE_OVERRIDE',
      'UNDO_FORGET',
      'UNDO_RESTORE',
      'RESTORE',
      'LEGACY_MUTATION'
    ));

ALTER TABLE jobs
  ADD COLUMN role_family text,
  ADD CONSTRAINT jobs_role_family_check
    CHECK (role_family IS NULL OR role_family ~ '^[A-Z][A-Z0-9_]*$');

-- Value-free receipt captured during the active application run. It binds the
-- exact REVIEW version and scope to a final field actor/outcome before submit.
CREATE TABLE candidate_answer_usage_proofs (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  answer_version_id uuid NOT NULL,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  entity_id uuid,
  scope_id uuid NOT NULL,
  scope_fingerprint text NOT NULL CHECK (length(scope_fingerprint) = 64),
  outcome text NOT NULL CHECK (outcome IN ('CONFIRMED_UNCHANGED', 'USER_CORRECTED')),
  final_actor text NOT NULL CHECK (final_actor IN ('COPILOT', 'USER')),
  final_value_fingerprint text NOT NULL CHECK (length(final_value_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  status text NOT NULL CHECK (status IN ('RECORDED', 'CONSUMED')),
  checkpoint_id uuid,
  consumed_change_set_id uuid,
  recorded_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (run_id, operation_id),
  UNIQUE (run_id, sequence),
  UNIQUE (id, candidate_id),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id),
  FOREIGN KEY (checkpoint_id, application_id) REFERENCES application_checkpoints(id, application_id),
  FOREIGN KEY (answer_version_id, candidate_id) REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (entity_id, candidate_id) REFERENCES candidate_entities(id, candidate_id),
  FOREIGN KEY (scope_id, candidate_id) REFERENCES candidate_answer_scopes(id, candidate_id),
  FOREIGN KEY (consumed_change_set_id, candidate_id) REFERENCES candidate_answer_change_sets(id, candidate_id),
  CHECK (outcome <> 'USER_CORRECTED' OR final_actor = 'USER'),
  CHECK (
    (status = 'RECORDED' AND checkpoint_id IS NULL AND consumed_change_set_id IS NULL AND consumed_at IS NULL)
    OR (
      status = 'CONSUMED'
      AND checkpoint_id IS NOT NULL
      AND consumed_change_set_id IS NOT NULL
      AND consumed_at IS NOT NULL
    )
  )
);

CREATE INDEX candidate_answer_usage_proofs_pending_idx
  ON candidate_answer_usage_proofs (candidate_id, recorded_at)
  WHERE status = 'RECORDED';

CREATE FUNCTION app_private.assert_candidate_answer_usage_proof_consistency() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM candidate_answer_versions version
    JOIN candidate_answers_current current_answer
      ON current_answer.answer_version_id = version.id
     AND current_answer.candidate_id = version.candidate_id
     AND current_answer.canonical_id = version.canonical_id
     AND current_answer.entity_id IS NOT DISTINCT FROM version.entity_id
     AND current_answer.scope_id = version.scope_id
    JOIN canonical_fields canonical
      ON canonical.id = version.canonical_id
     AND canonical.status = 'ACTIVE'
    JOIN canonical_answer_policies policy
      ON policy.id = version.policy_id
     AND policy.canonical_id = version.canonical_id
     AND policy.active
    JOIN candidate_answer_scopes answer_scope
      ON answer_scope.id = version.scope_id
     AND answer_scope.candidate_id = version.candidate_id
    JOIN applications application
      ON application.id = NEW.application_id
     AND application.candidate_id = version.candidate_id
     AND application.status IN ('IN_PROGRESS', 'REVIEW')
    JOIN application_runs run
      ON run.id = NEW.run_id
     AND run.application_id = application.id
     AND run.status = 'ACTIVE'
     AND run.last_sequence = NEW.sequence
    LEFT JOIN jobs job ON job.id = application.job_id
    WHERE version.id = NEW.answer_version_id
      AND version.candidate_id = NEW.candidate_id
      AND version.canonical_id = NEW.canonical_id
      AND version.entity_id IS NOT DISTINCT FROM NEW.entity_id
      AND version.scope_id = NEW.scope_id
      AND version.trust_state = 'REVIEW'
      AND version.source IN ('USER_MANUAL', 'USER_CORRECTION')
      AND policy.learning_mode = 'REVIEW_TO_SAVE'
      AND policy.review_reuse = 'EXACT_SCOPE_TRIAL'
      AND answer_scope.scope_type = ANY(policy.allowed_scope_types)
      AND answer_scope.scope_fingerprint = NEW.scope_fingerprint
      AND (answer_scope.application_id IS NULL OR answer_scope.application_id = application.id)
      AND (answer_scope.job_id IS NULL OR answer_scope.job_id = application.job_id)
      AND (answer_scope.company_id IS NULL OR answer_scope.company_id = job.company_id)
      AND (answer_scope.country_code IS NULL OR answer_scope.country_code = job.country_code)
      AND (answer_scope.role_family IS NULL OR answer_scope.role_family = job.role_family)
  ) THEN
    RAISE EXCEPTION 'candidate answer usage receipt lacks exact active-run REVIEW authority';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_answer_usage_proof_consistency_trigger
  BEFORE INSERT ON candidate_answer_usage_proofs
  FOR EACH ROW EXECUTE FUNCTION app_private.assert_candidate_answer_usage_proof_consistency();

CREATE FUNCTION app_private.guard_candidate_answer_usage_proof_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'RECORDED'
     OR NEW.status <> 'CONSUMED'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.sequence IS DISTINCT FROM OLD.sequence
     OR NEW.answer_version_id IS DISTINCT FROM OLD.answer_version_id
     OR NEW.canonical_id IS DISTINCT FROM OLD.canonical_id
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
     OR NEW.scope_fingerprint IS DISTINCT FROM OLD.scope_fingerprint
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.final_actor IS DISTINCT FROM OLD.final_actor
     OR NEW.final_value_fingerprint IS DISTINCT FROM OLD.final_value_fingerprint
     OR NEW.fingerprint_key_version IS DISTINCT FROM OLD.fingerprint_key_version
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.checkpoint_id IS NULL
     OR NEW.consumed_change_set_id IS NULL
     OR NEW.consumed_at IS NULL
  THEN
    RAISE EXCEPTION 'candidate answer usage receipts are immutable outside verified consumption';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_answer_usage_proof_update_guard
  BEFORE UPDATE ON candidate_answer_usage_proofs
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_candidate_answer_usage_proof_update();

CREATE FUNCTION app_private.guard_candidate_answer_scope_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
     OR NEW.scope_fingerprint IS DISTINCT FROM OLD.scope_fingerprint
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.role_family IS DISTINCT FROM OLD.role_family
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'candidate answer scopes are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_answer_scope_update_guard
  BEFORE UPDATE ON candidate_answer_scopes
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_candidate_answer_scope_update();

ALTER TABLE candidate_answer_usage_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_answer_usage_proofs_own_account ON candidate_answer_usage_proofs
  USING (
    candidate_id IN (
      SELECT id FROM candidates WHERE account_id = app_private.current_account_id()
    )
  )
  WITH CHECK (
    candidate_id IN (
      SELECT id FROM candidates WHERE account_id = app_private.current_account_id()
    )
  );
