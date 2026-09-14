ALTER TABLE candidate_entities
  ADD COLUMN entity_version integer NOT NULL DEFAULT 1 CHECK (entity_version > 0),
  ADD COLUMN display_order integer CHECK (display_order IS NULL OR display_order >= 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN removed_at timestamptz;

UPDATE candidate_entities
SET removed_at = COALESCE(updated_at, created_at, now())
WHERE status = 'REMOVED' AND removed_at IS NULL;

ALTER TABLE candidate_entities ADD CONSTRAINT candidate_entities_status_time_check CHECK (
  (status = 'ACTIVE' AND removed_at IS NULL) OR (status = 'REMOVED' AND removed_at IS NOT NULL)
);

CREATE INDEX candidate_entities_active_type_order_idx
  ON candidate_entities (candidate_id, entity_type, display_order, created_at) WHERE status = 'ACTIVE';

CREATE TABLE application_entity_bindings (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_run_id uuid NOT NULL REFERENCES application_runs(id),
  page_instance_id uuid NOT NULL,
  form_instance_id text NOT NULL CHECK (length(form_instance_id) BETWEEN 8 AND 100),
  form_repeat_group_id text NOT NULL CHECK (length(form_repeat_group_id) BETWEEN 8 AND 120),
  structural_fingerprint char(64) NOT NULL,
  identity_kind text NOT NULL CHECK (identity_kind IN ('STABLE_DOM', 'SESSION_ELEMENT', 'ORDINAL_ONLY')),
  entity_type text CHECK (entity_type IS NULL OR entity_type IN ('EMPLOYMENT', 'EDUCATION', 'PROJECT', 'CERTIFICATION', 'LANGUAGE')),
  binding_state text NOT NULL CHECK (binding_state IN ('BOUND_HIGH', 'BOUND_MEDIUM', 'AMBIGUOUS', 'UNBOUND', 'UNSUPPORTED')),
  candidate_entity_id uuid,
  candidate_entity_version integer CHECK (candidate_entity_version IS NULL OR candidate_entity_version > 0),
  candidate_entity_revision char(64),
  binding_version integer NOT NULL CHECK (binding_version > 0),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confidence_bucket text NOT NULL CHECK (confidence_bucket IN ('HIGH', 'MEDIUM', 'LOW', 'NONE')),
  evidence_categories text[] NOT NULL DEFAULT '{}'::text[],
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  error_codes text[] NOT NULL DEFAULT '{}'::text[],
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (application_run_id, page_instance_id, form_repeat_group_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (candidate_entity_id, candidate_id) REFERENCES candidate_entities(id, candidate_id),
  CHECK (
    (binding_state IN ('BOUND_HIGH', 'BOUND_MEDIUM') AND candidate_entity_id IS NOT NULL AND candidate_entity_version IS NOT NULL AND candidate_entity_revision IS NOT NULL)
    OR (binding_state NOT IN ('BOUND_HIGH', 'BOUND_MEDIUM') AND candidate_entity_id IS NULL AND candidate_entity_version IS NULL AND candidate_entity_revision IS NULL)
  )
);

CREATE INDEX application_entity_bindings_candidate_run_idx
  ON application_entity_bindings (candidate_id, application_run_id, updated_at DESC);

ALTER TABLE candidate_learning_observations
  ADD COLUMN expected_entity_version integer CHECK (expected_entity_version IS NULL OR expected_entity_version > 0),
  ADD COLUMN entity_binding_revision char(64);

ALTER TABLE candidate_learning_observations ADD CONSTRAINT candidate_learning_observations_entity_binding_check CHECK (
  (entity_id IS NULL AND expected_entity_version IS NULL AND entity_binding_revision IS NULL)
  OR (entity_id IS NOT NULL AND expected_entity_version IS NOT NULL AND entity_binding_revision IS NOT NULL)
);

CREATE OR REPLACE FUNCTION app_private.guard_candidate_learning_observation_update() RETURNS trigger
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
     OR NEW.expected_entity_version IS DISTINCT FROM OLD.expected_entity_version
     OR NEW.entity_binding_revision IS DISTINCT FROM OLD.entity_binding_revision
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
  THEN RAISE EXCEPTION 'candidate learning observations are immutable outside terminal consumption';
  END IF;
  RETURN NEW;
END
$$;

CREATE TABLE candidate_entity_operation_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 170),
  request_fingerprint char(64) NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('REMOVE', 'RESTORE', 'REORDER')),
  entity_type text NOT NULL CHECK (entity_type IN ('EMPLOYMENT', 'EDUCATION', 'PROJECT', 'CERTIFICATION', 'LANGUAGE')),
  candidate_entity_id uuid,
  ordered_entity_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  result_entity_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_status text,
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (candidate_entity_id, candidate_id) REFERENCES candidate_entities(id, candidate_id),
  CHECK (
    (operation_type IN ('REMOVE', 'RESTORE') AND candidate_entity_id IS NOT NULL AND cardinality(ordered_entity_ids) = 0)
    OR (operation_type = 'REORDER' AND candidate_entity_id IS NULL AND cardinality(ordered_entity_ids) > 0)
  )
);

ALTER TABLE application_entity_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_entity_operation_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_entity_bindings_own_account ON application_entity_bindings
  USING (account_id = app_private.current_account_id()) WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY candidate_entity_operation_receipts_own_account ON candidate_entity_operation_receipts
  USING (account_id = app_private.current_account_id()) WITH CHECK (account_id = app_private.current_account_id());

CREATE FUNCTION app_private.reject_candidate_entity_operation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'candidate entity operation receipts are immutable'; END $$;

CREATE TRIGGER candidate_entity_operation_receipts_no_update
  BEFORE UPDATE OR DELETE ON candidate_entity_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_entity_operation_mutation();
