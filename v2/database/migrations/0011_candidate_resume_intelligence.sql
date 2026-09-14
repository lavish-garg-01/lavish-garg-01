ALTER TABLE documents
  ADD COLUMN candidate_id uuid,
  ADD COLUMN original_file_name text,
  ADD CONSTRAINT documents_candidate_account_fk
    FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  ADD CONSTRAINT documents_master_resume_candidate_required
    CHECK (purpose <> 'MASTER_RESUME' OR candidate_id IS NOT NULL),
  ADD CONSTRAINT documents_original_file_name_safe
    CHECK (
      original_file_name IS NULL
      OR (
        length(original_file_name) BETWEEN 1 AND 240
        AND original_file_name !~ '[\\/\x00]'
      )
    );

CREATE INDEX documents_candidate_status_idx
  ON documents (candidate_id, purpose, status, created_at DESC)
  WHERE candidate_id IS NOT NULL;

CREATE UNIQUE INDEX documents_one_active_master_resume_idx
  ON documents (candidate_id)
  WHERE purpose = 'MASTER_RESUME' AND status = 'READY';

CREATE TABLE resume_upload_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id)
);

CREATE TABLE resume_extraction_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  attempt integer NOT NULL CHECK (attempt > 0),
  extractor text NOT NULL CHECK (length(extractor) BETWEEN 1 AND 120),
  extractor_version text NOT NULL CHECK (length(extractor_version) BETWEEN 1 AND 80),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  text_sha256 char(64),
  invalid_item_count integer NOT NULL DEFAULT 0 CHECK (invalid_item_count >= 0),
  error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (id, candidate_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  CHECK ((status = 'PROCESSING') = (completed_at IS NULL)),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
);

CREATE INDEX resume_extraction_runs_document_idx
  ON resume_extraction_runs (candidate_id, document_id, started_at DESC);

CREATE TABLE resume_candidate_proposals (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id),
  extraction_id uuid NOT NULL,
  item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 120),
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  entity_type text CHECK (entity_type IN ('EMPLOYMENT', 'EDUCATION', 'PROJECT', 'CERTIFICATION', 'LANGUAGE')),
  entity_group_key text CHECK (entity_group_key IS NULL OR length(entity_group_key) BETWEEN 1 AND 120),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  comparison text NOT NULL CHECK (comparison IN ('NEW', 'MATCH', 'CONFLICT', 'UNSUPPORTED')),
  decision text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'ACCEPTED', 'CORRECTED', 'REMOVED', 'SKIPPED')),
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  existing_answer_version_id uuid,
  value_fingerprint char(64) NOT NULL,
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  payload_key_version smallint NOT NULL CHECK (payload_key_version > 0),
  payload_iv bytea NOT NULL CHECK (octet_length(payload_iv) = 12),
  payload_auth_tag bytea NOT NULL CHECK (octet_length(payload_auth_tag) = 16),
  encrypted_payload bytea NOT NULL CHECK (octet_length(encrypted_payload) > 0),
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  UNIQUE (extraction_id, item_key),
  UNIQUE (id, candidate_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (extraction_id, candidate_id) REFERENCES resume_extraction_runs(id, candidate_id),
  FOREIGN KEY (existing_answer_version_id, candidate_id)
    REFERENCES candidate_answer_versions(id, candidate_id),
  CHECK ((entity_type IS NULL) = (entity_group_key IS NULL))
);

CREATE INDEX resume_candidate_proposals_review_idx
  ON resume_candidate_proposals (candidate_id, extraction_id, decision, item_key);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_own_account ON documents;
CREATE POLICY documents_own_account ON documents
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());

ALTER TABLE resume_upload_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_candidate_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY resume_upload_receipts_own_account ON resume_upload_receipts
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY resume_extraction_runs_own_account ON resume_extraction_runs
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY resume_candidate_proposals_own_account ON resume_candidate_proposals
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());

CREATE FUNCTION app_private.reject_resume_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable resume record cannot be updated or deleted';
END;
$$;

CREATE TRIGGER resume_upload_receipts_no_update
  BEFORE UPDATE OR DELETE ON resume_upload_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_resume_immutable_mutation();

CREATE FUNCTION app_private.guard_resume_proposal_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.account_id <> NEW.account_id
     OR OLD.candidate_id <> NEW.candidate_id
     OR OLD.document_id <> NEW.document_id
     OR OLD.extraction_id <> NEW.extraction_id
     OR OLD.item_key <> NEW.item_key
     OR OLD.canonical_id <> NEW.canonical_id
     OR OLD.entity_type IS DISTINCT FROM NEW.entity_type
     OR OLD.entity_group_key IS DISTINCT FROM NEW.entity_group_key
     OR OLD.confidence <> NEW.confidence
     OR OLD.comparison <> NEW.comparison
     OR OLD.reason_codes <> NEW.reason_codes
     OR OLD.existing_answer_version_id IS DISTINCT FROM NEW.existing_answer_version_id
     OR OLD.value_fingerprint <> NEW.value_fingerprint
     OR OLD.fingerprint_key_version <> NEW.fingerprint_key_version
     OR OLD.payload_key_version <> NEW.payload_key_version
     OR OLD.payload_iv <> NEW.payload_iv
     OR OLD.payload_auth_tag <> NEW.payload_auth_tag
     OR OLD.encrypted_payload <> NEW.encrypted_payload
     OR OLD.created_at <> NEW.created_at
     OR OLD.decision <> 'PENDING'
     OR NEW.decision = 'PENDING'
     OR NEW.reviewed_at IS NULL
  THEN
    RAISE EXCEPTION 'resume proposal mutation is not allowed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resume_candidate_proposals_guard
  BEFORE UPDATE ON resume_candidate_proposals
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_resume_proposal_review();

CREATE TRIGGER resume_candidate_proposals_no_delete
  BEFORE DELETE ON resume_candidate_proposals
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_resume_immutable_mutation();
