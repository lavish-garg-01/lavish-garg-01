-- R1/R2: private, versioned document authority and explicit lifecycle evidence.
-- Candidate Truth remains the authority for reusable facts; this migration owns
-- document bytes, lineage, generation state and application-time document pins.

ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check CHECK (status IN (
    'UPLOADING', 'UPLOADED', 'EXTRACTING', 'EXTRACTED', 'RECONCILING',
    'READY', 'FAILED', 'SUPERSEDED', 'ARCHIVED', 'QUARANTINED', 'DELETED'
  )),
  ADD COLUMN document_version integer,
  ADD COLUMN source_document_id uuid REFERENCES documents(id),
  ADD COLUMN job_id uuid REFERENCES jobs(id),
  ADD COLUMN application_id uuid,
  ADD COLUMN generation_policy_version integer,
  ADD COLUMN failure_code text,
  ADD COLUMN updated_at timestamptz,
  ADD COLUMN ready_at timestamptz;

-- Old UPLOADING rows are durable uploads waiting for reconciliation. Existing
-- READY rows stay current. Old DELETED rows are intentionally not reclassified:
-- some represent rejected staged uploads whose bytes may already be gone.
UPDATE documents SET status = 'UPLOADED' WHERE status = 'UPLOADING';

WITH numbered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY candidate_id, purpose
           ORDER BY created_at, id
         )::integer AS document_version
  FROM documents
  WHERE candidate_id IS NOT NULL
)
UPDATE documents
SET document_version = numbered.document_version
FROM numbered
WHERE documents.id = numbered.id;

UPDATE documents
SET document_version = 1
WHERE document_version IS NULL;
UPDATE documents
SET updated_at = created_at
WHERE updated_at IS NULL;
UPDATE documents
SET ready_at = created_at
WHERE status = 'READY' AND ready_at IS NULL;

ALTER TABLE documents
  ALTER COLUMN document_version SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ADD CONSTRAINT documents_version_positive CHECK (document_version > 0),
  ADD CONSTRAINT documents_generation_policy_positive CHECK (
    generation_policy_version IS NULL OR generation_policy_version > 0
  ),
  ADD CONSTRAINT documents_application_candidate_fk
    FOREIGN KEY (application_id, candidate_id)
    REFERENCES applications(id, candidate_id),
  ADD CONSTRAINT documents_generated_lineage_check CHECK (
    purpose NOT IN ('TAILORED_RESUME', 'COVER_LETTER')
    OR (source_document_id IS NOT NULL AND job_id IS NOT NULL AND generation_policy_version IS NOT NULL)
  ),
  ADD CONSTRAINT documents_ready_timestamp_check CHECK (
    status <> 'READY' OR ready_at IS NOT NULL
  ),
  ADD CONSTRAINT documents_failure_code_check CHECK (
    (status = 'FAILED') = (failure_code IS NOT NULL)
  );

CREATE UNIQUE INDEX documents_candidate_purpose_version_idx
  ON documents (candidate_id, purpose, document_version)
  WHERE candidate_id IS NOT NULL;
CREATE INDEX documents_content_dedupe_idx
  ON documents (candidate_id, purpose, content_sha256, created_at DESC)
  WHERE candidate_id IS NOT NULL AND status <> 'DELETED';
CREATE INDEX documents_job_purpose_status_idx
  ON documents (candidate_id, job_id, purpose, status, document_version DESC)
  WHERE job_id IS NOT NULL;

-- R3 extends the existing Candidate Truth ontology for resume-backed repeatable
-- facts. These remain proposals until the candidate confirms them.
WITH seed(canonical_key, description, value_type, entity_type) AS (
  VALUES
    ('EMPLOYMENT_LOCATION', 'Location for one stable employment entity.', 'STRING', 'EMPLOYMENT'),
    ('EMPLOYMENT_DESCRIPTION', 'Resume-supported description for one employment entity.', 'RICH_TEXT', 'EMPLOYMENT'),
    ('EMPLOYMENT_SKILLS', 'Resume-supported technologies for one employment entity.', 'MULTI_ENUM', 'EMPLOYMENT'),
    ('EDUCATION_GRADE', 'Grade stated for one education entity.', 'STRING', 'EDUCATION'),
    ('EDUCATION_LOCATION', 'Location for one education entity.', 'STRING', 'EDUCATION'),
    ('PROJECT_NAME', 'Name for one candidate project.', 'STRING', 'PROJECT'),
    ('PROJECT_DESCRIPTION', 'Resume-supported description for one project.', 'RICH_TEXT', 'PROJECT'),
    ('PROJECT_TECHNOLOGIES', 'Technologies stated for one project.', 'MULTI_ENUM', 'PROJECT'),
    ('PROJECT_DATE_RANGE', 'Dates for one candidate project.', 'DATE_RANGE', 'PROJECT'),
    ('PROJECT_URL', 'Link stated for one candidate project.', 'URL', 'PROJECT'),
    ('CERTIFICATION_NAME', 'Name for one certification or award.', 'STRING', 'CERTIFICATION'),
    ('CERTIFICATION_ISSUER', 'Issuer for one certification or award.', 'STRING', 'CERTIFICATION'),
    ('CERTIFICATION_DATE', 'Date for one certification or award.', 'DATE', 'CERTIFICATION'),
    ('CERTIFICATION_URL', 'Verification link for one certification.', 'URL', 'CERTIFICATION'),
    ('CERTIFICATION_KIND', 'Whether the record is a certification or award.', 'ENUM', 'CERTIFICATION')
)
INSERT INTO canonical_fields (canonical_key, description, value_type, entity_type, status)
SELECT canonical_key, description, value_type, entity_type, 'ACTIVE' FROM seed
ON CONFLICT (canonical_key) DO NOTHING;

INSERT INTO canonical_answer_policies (
  id, canonical_id, policy_version, answer_class, reuse_mode, allowed_scope_types,
  scope_context_dimensions, required_context_dimensions, freshness_interval,
  risk_tier, autofill_mode, learning_mode, permanent_commit_points, review_reuse,
  derivation_policy, sensitivity, reason_code, active
)
SELECT md5('job-hunter-v2:candidate-policy:2:' || canonical_key)::uuid,
       id, 2, 'STABLE_FACT', 'AUTO', ARRAY['GLOBAL']::text[], '{}'::text[],
       '{}'::text[], NULL, 'LOW', 'AUTO', 'AUTO_VERSION',
       ARRAY['VERIFIED_SUBMISSION', 'EXPLICIT_SAVE']::text[], 'NEVER',
       'DETERMINISTIC_ONLY', 'NORMAL', 'STABLE_ENTITY_FACT', true
FROM canonical_fields
WHERE canonical_key IN (
  'EMPLOYMENT_LOCATION', 'EMPLOYMENT_DESCRIPTION', 'EMPLOYMENT_SKILLS',
  'EDUCATION_GRADE', 'EDUCATION_LOCATION', 'PROJECT_NAME', 'PROJECT_DESCRIPTION',
  'PROJECT_TECHNOLOGIES', 'PROJECT_DATE_RANGE', 'PROJECT_URL',
  'CERTIFICATION_NAME', 'CERTIFICATION_ISSUER', 'CERTIFICATION_DATE',
  'CERTIFICATION_URL', 'CERTIFICATION_KIND'
)
ON CONFLICT (canonical_id, policy_version) DO NOTHING;

ALTER TABLE resume_candidate_proposals
  ADD COLUMN source_section text NOT NULL DEFAULT 'OTHER'
    CHECK (source_section IN (
      'HEADER', 'SUMMARY', 'SKILLS', 'EXPERIENCE', 'EDUCATION',
      'PROJECTS', 'CERTIFICATIONS', 'AWARDS', 'OTHER', 'UPLOAD'
    )),
  ADD COLUMN evidence_sha256 char(64),
  ADD COLUMN extraction_schema_version integer NOT NULL DEFAULT 1
    CHECK (extraction_schema_version > 0),
  ADD COLUMN source_locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN matched_entity_id uuid;
-- The existing guard permits only a candidate review transition. Hold the
-- table lock already acquired by ALTER TABLE and recreate that same guard
-- inside the migration transaction around this provenance-only backfill.
DROP TRIGGER resume_candidate_proposals_guard ON resume_candidate_proposals;
UPDATE resume_candidate_proposals
SET evidence_sha256 = value_fingerprint
WHERE evidence_sha256 IS NULL;
CREATE TRIGGER resume_candidate_proposals_guard
  BEFORE UPDATE ON resume_candidate_proposals
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_resume_proposal_review();
ALTER TABLE resume_candidate_proposals ALTER COLUMN evidence_sha256 SET NOT NULL;
ALTER TABLE resume_candidate_proposals
  DROP CONSTRAINT resume_candidate_proposals_comparison_check,
  ADD CONSTRAINT resume_candidate_proposals_comparison_check CHECK (comparison IN (
    'NEW', 'MATCH', 'CONFLICT', 'AMBIGUOUS',
    'REPEATABLE_ENTITY_MATCH', 'REPEATABLE_ENTITY_NEW', 'UNSUPPORTED'
  )),
  ADD CONSTRAINT resume_candidate_proposals_matched_entity_fk
    FOREIGN KEY (matched_entity_id, candidate_id)
    REFERENCES candidate_entities(id, candidate_id);

-- A stable candidate entity may be rediscovered in multiple immutable resume
-- versions. Source keys are many-to-one evidence, never entity identity itself.
ALTER TABLE candidate_entity_source_keys
  DROP CONSTRAINT candidate_entity_source_keys_entity_id_candidate_id_key;
CREATE INDEX candidate_entity_source_keys_entity_idx
  ON candidate_entity_source_keys (candidate_id, entity_id);

CREATE FUNCTION app_private.guard_resume_proposal_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_section <> NEW.source_section
     OR OLD.evidence_sha256 <> NEW.evidence_sha256
     OR OLD.extraction_schema_version <> NEW.extraction_schema_version
     OR OLD.source_locator <> NEW.source_locator
     OR OLD.matched_entity_id IS DISTINCT FROM NEW.matched_entity_id
  THEN
    RAISE EXCEPTION 'resume proposal provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER resume_candidate_proposals_provenance_guard
  BEFORE UPDATE ON resume_candidate_proposals
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_resume_proposal_provenance();

CREATE TABLE document_lifecycle_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  from_status text,
  to_status text NOT NULL CHECK (to_status IN (
    'UPLOADING', 'UPLOADED', 'EXTRACTING', 'EXTRACTED', 'RECONCILING',
    'READY', 'FAILED', 'SUPERSEDED', 'ARCHIVED', 'QUARANTINED', 'DELETED'
  )),
  reason_code text NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL,
  UNIQUE (document_id, sequence),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id)
);

INSERT INTO document_lifecycle_events (
  id, account_id, candidate_id, document_id, sequence, from_status,
  to_status, reason_code, created_at
)
SELECT gen_random_uuid(), account_id, candidate_id, id, 1, NULL, status,
       'MIGRATED_EXISTING_DOCUMENT', created_at
FROM documents
WHERE candidate_id IS NOT NULL;

CREATE TABLE document_generation_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  source_document_id uuid NOT NULL REFERENCES documents(id),
  output_document_id uuid REFERENCES documents(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  application_id uuid,
  document_purpose text NOT NULL CHECK (document_purpose IN ('TAILORED_RESUME', 'COVER_LETTER')),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'REVIEW_REQUIRED', 'APPROVED', 'FAILED')),
  generator text NOT NULL CHECK (length(generator) BETWEEN 1 AND 120),
  generator_version text NOT NULL CHECK (length(generator_version) BETWEEN 1 AND 80),
  generation_policy_version integer NOT NULL CHECK (generation_policy_version > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  claim_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (output_document_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id),
  CHECK ((status = 'PROCESSING') = (completed_at IS NULL)),
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
);

CREATE INDEX document_generation_runs_job_idx
  ON document_generation_runs (candidate_id, job_id, document_purpose, created_at DESC);

CREATE TABLE document_approval_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  approved_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id)
);

CREATE TABLE application_document_selections (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  document_kind text NOT NULL CHECK (document_kind IN ('RESUME', 'COVER_LETTER')),
  document_id uuid NOT NULL REFERENCES documents(id),
  selection_source text NOT NULL CHECK (selection_source IN ('TAILORED', 'MASTER', 'APPROVED_COVER_LETTER')),
  created_at timestamptz NOT NULL,
  UNIQUE (run_id, document_kind),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (application_id, candidate_id, account_id)
    REFERENCES applications(id, candidate_id, account_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

CREATE INDEX application_document_selections_application_idx
  ON application_document_selections (candidate_id, application_id, created_at DESC);

CREATE TABLE application_document_upload_evidence (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  application_id uuid NOT NULL,
  run_id uuid NOT NULL,
  selection_id uuid NOT NULL REFERENCES application_document_selections(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  operation_id uuid NOT NULL,
  field_key text NOT NULL CHECK (length(field_key) BETWEEN 1 AND 240),
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED', 'FAILED', 'SKIPPED')),
  reason_code text NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 120),
  observed_file_count integer CHECK (observed_file_count IS NULL OR observed_file_count >= 0),
  observed_at timestamptz NOT NULL,
  request_fingerprint char(64) NOT NULL,
  UNIQUE (run_id, operation_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (application_id, candidate_id, account_id)
    REFERENCES applications(id, candidate_id, account_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

CREATE FUNCTION app_private.reject_document_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document history is append-only';
END;
$$;

CREATE TRIGGER document_lifecycle_events_no_update
  BEFORE UPDATE OR DELETE ON document_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_document_history_mutation();
CREATE TRIGGER application_document_selections_no_update
  BEFORE UPDATE OR DELETE ON application_document_selections
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_document_history_mutation();
CREATE TRIGGER application_document_upload_evidence_no_update
  BEFORE UPDATE OR DELETE ON application_document_upload_evidence
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_document_history_mutation();
CREATE TRIGGER document_approval_receipts_no_update
  BEFORE UPDATE OR DELETE ON document_approval_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_document_history_mutation();

ALTER TABLE document_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_document_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_document_upload_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_approval_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_lifecycle_events_own_account ON document_lifecycle_events
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY document_generation_runs_own_account ON document_generation_runs
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY application_document_selections_own_account ON application_document_selections
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY application_document_upload_evidence_own_account ON application_document_upload_evidence
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY document_approval_receipts_own_account ON document_approval_receipts
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
