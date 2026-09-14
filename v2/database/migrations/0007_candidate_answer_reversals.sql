ALTER TABLE candidate_answer_versions
  ADD COLUMN restores_version_id uuid,
  ADD CONSTRAINT candidate_answer_versions_restores_candidate_fk
    FOREIGN KEY (restores_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id);

ALTER TABLE candidate_answer_change_set_items
  ADD COLUMN item_key text,
  ADD CONSTRAINT candidate_answer_change_set_items_item_key_check
    CHECK (item_key IS NULL OR item_key ~ '^[A-Za-z0-9._:-]{1,80}$'),
  ADD CONSTRAINT candidate_answer_change_set_items_id_candidate_unique
    UNIQUE (id, candidate_id);

CREATE UNIQUE INDEX candidate_answer_change_set_items_group_key_idx
  ON candidate_answer_change_set_items (change_set_id, item_key)
  WHERE item_key IS NOT NULL;

CREATE TABLE candidate_answer_reversal_sets (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  operation_type text NOT NULL CHECK (operation_type IN ('UNDO_CHANGE_SET', 'RESTORE_VERSION')),
  target_change_set_id uuid,
  target_version_id uuid,
  compensating_change_set_id uuid,
  item_count smallint NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  restored_count smallint NOT NULL CHECK (restored_count BETWEEN 0 AND 50),
  forgotten_count smallint NOT NULL CHECK (forgotten_count BETWEEN 0 AND 50),
  skipped_count smallint NOT NULL CHECK (skipped_count BETWEEN 0 AND 50),
  created_at timestamptz NOT NULL,
  UNIQUE (id, candidate_id),
  FOREIGN KEY (target_change_set_id, candidate_id)
    REFERENCES candidate_answer_change_sets(id, candidate_id),
  FOREIGN KEY (target_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (compensating_change_set_id, candidate_id)
    REFERENCES candidate_answer_change_sets(id, candidate_id),
  CHECK (restored_count + forgotten_count + skipped_count = item_count),
  CHECK (
    (operation_type = 'UNDO_CHANGE_SET' AND target_change_set_id IS NOT NULL AND target_version_id IS NULL)
    OR
    (operation_type = 'RESTORE_VERSION' AND target_change_set_id IS NULL AND target_version_id IS NOT NULL)
  ),
  CHECK (
    (restored_count + forgotten_count = 0 AND compensating_change_set_id IS NULL)
    OR
    (restored_count + forgotten_count > 0 AND compensating_change_set_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX candidate_answer_reversal_one_undo_per_set_idx
  ON candidate_answer_reversal_sets (candidate_id, target_change_set_id)
  WHERE operation_type = 'UNDO_CHANGE_SET';

CREATE INDEX candidate_answer_reversal_history_idx
  ON candidate_answer_reversal_sets (candidate_id, created_at DESC, id DESC);

CREATE TABLE candidate_answer_reversal_items (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  reversal_set_id uuid NOT NULL,
  source_change_set_item_id uuid,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  scope_id uuid NOT NULL,
  expected_version_id uuid,
  observed_current_version_id uuid,
  previous_version_id uuid,
  compensating_version_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('RESTORED', 'FORGOTTEN', 'SKIPPED_NEWER_VERSION')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'PREVIOUS_SCOPED_ANSWER_RESTORED',
    'NEW_SCOPED_ANSWER_REMOVED',
    'NEWER_CANDIDATE_ANSWER_KEPT',
    'HISTORICAL_ANSWER_EXPLICITLY_RESTORED'
  )),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (reversal_set_id, candidate_id)
    REFERENCES candidate_answer_reversal_sets(id, candidate_id),
  FOREIGN KEY (source_change_set_item_id, candidate_id)
    REFERENCES candidate_answer_change_set_items(id, candidate_id),
  FOREIGN KEY (scope_id, candidate_id)
    REFERENCES candidate_answer_scopes(id, candidate_id),
  FOREIGN KEY (expected_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (observed_current_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (previous_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (compensating_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  CHECK (
    (outcome = 'RESTORED' AND previous_version_id IS NOT NULL AND compensating_version_id IS NOT NULL)
    OR
    (outcome = 'FORGOTTEN' AND previous_version_id IS NULL AND compensating_version_id IS NOT NULL)
    OR
    (outcome = 'SKIPPED_NEWER_VERSION' AND compensating_version_id IS NULL)
  )
);

CREATE INDEX candidate_answer_reversal_items_set_idx
  ON candidate_answer_reversal_items (reversal_set_id, canonical_id);

CREATE TABLE candidate_answer_reversal_receipts (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  reversal_set_id uuid NOT NULL,
  already_reversed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (candidate_id, idempotency_key),
  FOREIGN KEY (reversal_set_id, candidate_id)
    REFERENCES candidate_answer_reversal_sets(id, candidate_id)
);

CREATE FUNCTION app_private.guard_candidate_answer_change_set_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'COMMITTED'
     OR NEW.status NOT IN ('REVERSED', 'PARTIALLY_REVERSED')
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.checkpoint_id IS DISTINCT FROM OLD.checkpoint_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'candidate answer change sets are immutable outside one reversal status transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_answer_change_set_update_guard
  BEFORE UPDATE ON candidate_answer_change_sets
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_candidate_answer_change_set_update();

CREATE FUNCTION app_private.reject_candidate_answer_history_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'candidate answer history is append-only';
END
$$;

CREATE TRIGGER candidate_answer_change_set_delete_guard
  BEFORE DELETE ON candidate_answer_change_sets
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_answer_history_mutation();

CREATE TRIGGER candidate_answer_versions_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_answer_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_answer_history_mutation();

CREATE TRIGGER candidate_answer_change_set_items_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_answer_change_set_items
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_answer_history_mutation();

CREATE FUNCTION app_private.reject_candidate_answer_reversal_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'candidate answer reversal records are immutable';
END
$$;

CREATE TRIGGER candidate_answer_reversal_sets_update_guard
  BEFORE UPDATE OR DELETE ON candidate_answer_reversal_sets
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_answer_reversal_mutation();

CREATE TRIGGER candidate_answer_reversal_items_update_guard
  BEFORE UPDATE OR DELETE ON candidate_answer_reversal_items
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_answer_reversal_mutation();

CREATE TRIGGER candidate_answer_reversal_receipts_update_guard
  BEFORE UPDATE OR DELETE ON candidate_answer_reversal_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_answer_reversal_mutation();

ALTER TABLE candidate_answer_reversal_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_reversal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_reversal_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_answer_reversal_sets_own_account ON candidate_answer_reversal_sets
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_answer_reversal_items_own_account ON candidate_answer_reversal_items
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_answer_reversal_receipts_own_account ON candidate_answer_reversal_receipts
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
