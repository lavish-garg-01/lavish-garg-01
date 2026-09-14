CREATE TABLE candidate_truth_import_apply_runs (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  preview_run_id uuid NOT NULL,
  source_snapshot_fingerprint text NOT NULL CHECK (length(source_snapshot_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  apply_plan_fingerprint text NOT NULL CHECK (length(apply_plan_fingerprint) = 64),
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  examined_count integer NOT NULL CHECK (examined_count BETWEEN 0 AND 2000),
  batch_count integer NOT NULL CHECK (batch_count BETWEEN 0 AND 40),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count BETWEEN 0 AND 2000),
  already_imported_count integer NOT NULL DEFAULT 0 CHECK (already_imported_count BETWEEN 0 AND 2000),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count BETWEEN 0 AND 2000),
  review_required_count integer NOT NULL DEFAULT 0 CHECK (review_required_count BETWEEN 0 AND 2000),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count BETWEEN 0 AND 2000),
  invalid_count integer NOT NULL DEFAULT 0 CHECK (invalid_count BETWEEN 0 AND 2000),
  unmappable_count integer NOT NULL DEFAULT 0 CHECK (unmappable_count BETWEEN 0 AND 2000),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (id, candidate_id),
  UNIQUE (candidate_id, preview_run_id),
  FOREIGN KEY (preview_run_id, candidate_id)
    REFERENCES candidate_truth_import_preview_runs(id, candidate_id),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (
    status <> 'COMPLETED'
    OR imported_count + already_imported_count + skipped_count
      + review_required_count + conflict_count + invalid_count + unmappable_count = examined_count
  )
);

CREATE INDEX candidate_truth_import_apply_history_idx
  ON candidate_truth_import_apply_runs (candidate_id, started_at DESC, id DESC);

CREATE TABLE candidate_truth_import_apply_batches (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  apply_run_id uuid NOT NULL,
  batch_index smallint NOT NULL CHECK (batch_index BETWEEN 0 AND 39),
  batch_fingerprint text NOT NULL CHECK (length(batch_fingerprint) = 64),
  item_count smallint NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (id, candidate_id),
  UNIQUE (apply_run_id, batch_index),
  FOREIGN KEY (apply_run_id, candidate_id)
    REFERENCES candidate_truth_import_apply_runs(id, candidate_id),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);

CREATE TABLE candidate_truth_import_apply_batch_items (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  apply_batch_id uuid NOT NULL,
  preview_item_id uuid NOT NULL,
  batch_ordinal smallint NOT NULL CHECK (batch_ordinal BETWEEN 0 AND 49),
  PRIMARY KEY (apply_batch_id, preview_item_id),
  UNIQUE (apply_batch_id, batch_ordinal),
  FOREIGN KEY (apply_batch_id, candidate_id)
    REFERENCES candidate_truth_import_apply_batches(id, candidate_id),
  FOREIGN KEY (preview_item_id, candidate_id)
    REFERENCES candidate_truth_import_preview_items(id, candidate_id)
);

CREATE TABLE candidate_truth_import_reconciliations (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  apply_run_id uuid NOT NULL,
  preview_item_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'IMPORTED', 'ALREADY_IMPORTED', 'SKIPPED', 'REVIEW_REQUIRED',
    'CONFLICT', 'INVALID', 'UNMAPPABLE'
  )),
  reason_codes text[] NOT NULL CHECK (app_private.valid_import_reason_codes(reason_codes)),
  answer_version_id uuid,
  candidate_change_set_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (id, candidate_id),
  UNIQUE (apply_run_id, preview_item_id),
  FOREIGN KEY (apply_run_id, candidate_id)
    REFERENCES candidate_truth_import_apply_runs(id, candidate_id),
  FOREIGN KEY (preview_item_id, candidate_id)
    REFERENCES candidate_truth_import_preview_items(id, candidate_id),
  FOREIGN KEY (answer_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (candidate_change_set_id, candidate_id)
    REFERENCES candidate_answer_change_sets(id, candidate_id),
  CHECK (
    (outcome = 'IMPORTED' AND answer_version_id IS NOT NULL AND candidate_change_set_id IS NOT NULL)
    OR (outcome <> 'IMPORTED' AND answer_version_id IS NULL AND candidate_change_set_id IS NULL)
  )
);

CREATE INDEX candidate_truth_import_reconciliation_outcome_idx
  ON candidate_truth_import_reconciliations (candidate_id, outcome, created_at DESC);

CREATE TABLE candidate_truth_import_apply_receipts (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  idempotency_key text NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 200)
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  apply_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (candidate_id, idempotency_key),
  FOREIGN KEY (apply_run_id, candidate_id)
    REFERENCES candidate_truth_import_apply_runs(id, candidate_id)
);

CREATE FUNCTION app_private.guard_candidate_truth_import_apply_run_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candidate truth import apply runs cannot be deleted';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status <> 'COMPLETED'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.preview_run_id IS DISTINCT FROM OLD.preview_run_id
     OR NEW.source_snapshot_fingerprint IS DISTINCT FROM OLD.source_snapshot_fingerprint
     OR NEW.fingerprint_key_version IS DISTINCT FROM OLD.fingerprint_key_version
     OR NEW.apply_plan_fingerprint IS DISTINCT FROM OLD.apply_plan_fingerprint
     OR NEW.examined_count IS DISTINCT FROM OLD.examined_count
     OR NEW.batch_count IS DISTINCT FROM OLD.batch_count
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'invalid candidate truth import apply-run transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION app_private.guard_candidate_truth_import_batch_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'candidate truth import batches cannot be deleted';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status <> 'COMPLETED'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.apply_run_id IS DISTINCT FROM OLD.apply_run_id
     OR NEW.batch_index IS DISTINCT FROM OLD.batch_index
     OR NEW.batch_fingerprint IS DISTINCT FROM OLD.batch_fingerprint
     OR NEW.item_count IS DISTINCT FROM OLD.item_count
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'invalid candidate truth import batch transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_truth_import_apply_runs_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_apply_runs
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_candidate_truth_import_apply_run_mutation();

CREATE TRIGGER candidate_truth_import_apply_batches_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_apply_batches
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_candidate_truth_import_batch_mutation();

CREATE TRIGGER candidate_truth_import_apply_batch_items_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_apply_batch_items
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_truth_import_preview_mutation();

CREATE TRIGGER candidate_truth_import_reconciliations_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_reconciliations
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_truth_import_preview_mutation();

CREATE TRIGGER candidate_truth_import_apply_receipts_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_apply_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_truth_import_preview_mutation();

ALTER TABLE candidate_truth_import_apply_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_truth_import_apply_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_truth_import_apply_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_truth_import_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_truth_import_apply_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_truth_import_apply_runs_own_account ON candidate_truth_import_apply_runs
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_truth_import_apply_batches_own_account ON candidate_truth_import_apply_batches
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_truth_import_apply_batch_items_own_account ON candidate_truth_import_apply_batch_items
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_truth_import_reconciliations_own_account ON candidate_truth_import_reconciliations
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_truth_import_apply_receipts_own_account ON candidate_truth_import_apply_receipts
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
