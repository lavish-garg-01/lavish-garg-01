CREATE FUNCTION app_private.valid_import_reason_codes(value text[]) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    cardinality(value) BETWEEN 1 AND 12
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(value) AS reason(code)
      WHERE code !~ '^[A-Z][A-Z0-9_]{0,119}$'
    )
$$;

CREATE TABLE candidate_truth_import_preview_runs (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  migration_version integer NOT NULL CHECK (migration_version > 0),
  snapshot_fingerprint text NOT NULL CHECK (length(snapshot_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  status text NOT NULL CHECK (status = 'PREVIEWED'),
  source_count integer NOT NULL CHECK (source_count BETWEEN 0 AND 2000),
  eligible_count integer NOT NULL CHECK (eligible_count BETWEEN 0 AND 2000),
  review_required_count integer NOT NULL CHECK (review_required_count BETWEEN 0 AND 2000),
  skipped_count integer NOT NULL CHECK (skipped_count BETWEEN 0 AND 2000),
  conflict_count integer NOT NULL CHECK (conflict_count BETWEEN 0 AND 2000),
  invalid_count integer NOT NULL CHECK (invalid_count BETWEEN 0 AND 2000),
  already_present_count integer NOT NULL CHECK (already_present_count BETWEEN 0 AND 2000),
  created_at timestamptz NOT NULL,
  UNIQUE (id, candidate_id),
  UNIQUE (candidate_id, migration_version, snapshot_fingerprint, fingerprint_key_version),
  CHECK (
    eligible_count + review_required_count + skipped_count + conflict_count
      + invalid_count + already_present_count = source_count
  )
);

CREATE INDEX candidate_truth_import_preview_history_idx
  ON candidate_truth_import_preview_runs (candidate_id, created_at DESC, id DESC);

CREATE TABLE candidate_truth_import_preview_items (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  preview_run_id uuid NOT NULL,
  source_ordinal smallint NOT NULL CHECK (source_ordinal BETWEEN 0 AND 1999),
  source_kind text NOT NULL CHECK (source_kind IN (
    'V1_VERSIONED_TRUTH',
    'CANDIDATE_PROFILE',
    'APPROVED_FACT_MEMORY',
    'CANDIDATE_ANSWER',
    'MASTER_RESUME',
    'SHARED_FORM_MEMORY'
  )),
  source_record_fingerprint text NOT NULL CHECK (length(source_record_fingerprint) = 64),
  source_value_fingerprint text NOT NULL CHECK (length(source_value_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  source_canonical_key text NOT NULL CHECK (source_canonical_key ~ '^[A-Z][A-Z0-9_]{0,139}$'),
  target_canonical_id integer REFERENCES canonical_fields(id),
  proposed_scope_type text CHECK (
    proposed_scope_type IS NULL OR proposed_scope_type IN ('GLOBAL', 'SEARCH', 'COMPANY', 'JOB', 'APPLICATION')
  ),
  decision text NOT NULL CHECK (decision IN (
    'ELIGIBLE', 'REVIEW_REQUIRED', 'SKIPPED', 'CONFLICT', 'INVALID', 'ALREADY_PRESENT'
  )),
  reason_codes text[] NOT NULL CHECK (app_private.valid_import_reason_codes(reason_codes)),
  existing_answer_version_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE (id, candidate_id),
  UNIQUE (preview_run_id, source_ordinal),
  FOREIGN KEY (preview_run_id, candidate_id)
    REFERENCES candidate_truth_import_preview_runs(id, candidate_id),
  FOREIGN KEY (existing_answer_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id)
);

CREATE INDEX candidate_truth_import_preview_items_run_idx
  ON candidate_truth_import_preview_items (preview_run_id, source_ordinal);

CREATE INDEX candidate_truth_import_reconciliation_queue_idx
  ON candidate_truth_import_preview_items (candidate_id, decision, created_at DESC)
  WHERE decision IN ('REVIEW_REQUIRED', 'CONFLICT', 'INVALID');

CREATE TABLE candidate_truth_import_preview_receipts (
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  idempotency_key text NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 200)
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]+$'),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  preview_run_id uuid NOT NULL,
  already_previewed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (candidate_id, idempotency_key),
  FOREIGN KEY (preview_run_id, candidate_id)
    REFERENCES candidate_truth_import_preview_runs(id, candidate_id)
);

CREATE FUNCTION app_private.reject_candidate_truth_import_preview_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'candidate truth import previews are immutable';
END
$$;

CREATE TRIGGER candidate_truth_import_preview_runs_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_preview_runs
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_truth_import_preview_mutation();

CREATE TRIGGER candidate_truth_import_preview_items_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_preview_items
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_truth_import_preview_mutation();

CREATE TRIGGER candidate_truth_import_preview_receipts_mutation_guard
  BEFORE UPDATE OR DELETE ON candidate_truth_import_preview_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_candidate_truth_import_preview_mutation();

ALTER TABLE candidate_truth_import_preview_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_truth_import_preview_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_truth_import_preview_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY candidate_truth_import_preview_runs_own_account ON candidate_truth_import_preview_runs
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_truth_import_preview_items_own_account ON candidate_truth_import_preview_items
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));

CREATE POLICY candidate_truth_import_preview_receipts_own_account ON candidate_truth_import_preview_receipts
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()))
  WITH CHECK (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
