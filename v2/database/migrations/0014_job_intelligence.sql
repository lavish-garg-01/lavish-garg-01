-- Phase H owns shared job truth. Candidate-specific eligibility and ranking are derived, never ingested here.

ALTER TABLE job_sources
  ADD COLUMN source_identifier text,
  ADD COLUMN ingestion_version text,
  ADD COLUMN last_observed_at timestamptz,
  ADD COLUMN etag text,
  ADD COLUMN last_modified text;

CREATE UNIQUE INDEX job_sources_identifier_idx
  ON job_sources (source_type, source_identifier)
  WHERE source_identifier IS NOT NULL;

ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('ACTIVE', 'STALE', 'CLOSED', 'EXPIRED', 'REMOVED'));
ALTER TABLE jobs DROP CONSTRAINT jobs_check1;
ALTER TABLE jobs ADD CONSTRAINT jobs_terminal_timestamp_check
  CHECK ((status IN ('CLOSED', 'EXPIRED', 'REMOVED')) = (closed_at IS NOT NULL));

ALTER TABLE jobs
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN seniority text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (seniority IN ('INTERN', 'ENTRY', 'MID', 'SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL', 'MANAGER', 'DIRECTOR', 'UNKNOWN')),
  ADD COLUMN country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN remote_country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN employment_type text
    CHECK (employment_type IS NULL OR employment_type IN ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY')),
  ADD COLUMN ats text,
  ADD COLUMN application_url text,
  ADD COLUMN material_version integer NOT NULL DEFAULT 1 CHECK (material_version > 0),
  ADD COLUMN last_verified_at timestamptz,
  ADD COLUMN expires_at timestamptz;

-- Phase E introduced the nullable, open-ended role_family column for scoped
-- candidate answers. Phase H makes the same column authoritative job truth,
-- so upgrade it instead of attempting to add it again. IF NOT EXISTS keeps
-- this migration independently executable in isolated catalog tests.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS role_family text;
UPDATE jobs SET role_family = 'OTHER' WHERE role_family IS NULL;
ALTER TABLE jobs
  ALTER COLUMN role_family SET DEFAULT 'OTHER',
  ALTER COLUMN role_family SET NOT NULL,
  DROP CONSTRAINT IF EXISTS jobs_role_family_check,
  ADD CONSTRAINT jobs_role_family_check CHECK (role_family IN (
    'BACKEND', 'FRONTEND', 'FULLSTACK', 'MOBILE', 'DEVOPS', 'DATA', 'ML_AI',
    'QA', 'SECURITY', 'EMBEDDED', 'PRODUCT', 'DESIGN', 'ENGINEERING_MANAGEMENT', 'OTHER'
  ));

CREATE INDEX jobs_discovery_cursor_idx
  ON jobs (status, last_verified_at DESC, id)
  WHERE status IN ('ACTIVE', 'STALE');
CREATE INDEX jobs_role_country_idx
  ON jobs (role_family, country_code, work_mode, status);
CREATE INDEX jobs_search_idx
  ON jobs USING gin (to_tsvector('english', canonical_title || ' ' || description));

ALTER TABLE job_source_snapshots
  ADD COLUMN source_identity_key char(64),
  ADD COLUMN raw_source_fingerprint char(64),
  ADD COLUMN material_fingerprint char(64),
  ADD COLUMN ingestion_version text,
  ADD COLUMN raw_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN material_version integer CHECK (material_version IS NULL OR material_version > 0);

ALTER TABLE job_facets
  ADD COLUMN work_authorization_country_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN education_requirement text;

CREATE TABLE job_source_job_states (
  job_source_id uuid NOT NULL REFERENCES job_sources(id),
  source_identity_key char(64) NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id),
  external_job_id text,
  application_url text NOT NULL,
  latest_snapshot_id uuid REFERENCES job_source_snapshots(id),
  latest_raw_fingerprint char(64) NOT NULL,
  missing_observation_count integer NOT NULL DEFAULT 0 CHECK (missing_observation_count >= 0),
  last_observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (job_source_id, source_identity_key),
  UNIQUE (job_source_id, job_id)
);

CREATE INDEX job_source_job_states_job_idx ON job_source_job_states (job_id, last_observed_at DESC);

CREATE TABLE job_dedupe_keys (
  dedupe_key text PRIMARY KEY CHECK (length(dedupe_key) BETWEEN 1 AND 2200),
  job_id uuid NOT NULL REFERENCES jobs(id),
  confidence text NOT NULL CHECK (confidence IN ('STRONG')),
  created_at timestamptz NOT NULL,
  UNIQUE (dedupe_key, job_id)
);

CREATE TABLE job_fact_provenance (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  material_version integer NOT NULL CHECK (material_version > 0),
  fact_key text NOT NULL CHECK (length(fact_key) BETWEEN 1 AND 160),
  origin text NOT NULL CHECK (origin IN ('EXPLICIT_SOURCE_FACT', 'DETERMINISTIC_DERIVATION', 'AI_DERIVED')),
  evidence_path text NOT NULL CHECK (length(evidence_path) BETWEEN 1 AND 240),
  evidence_hash char(64) NOT NULL,
  derived_by text,
  derived_version text,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL,
  UNIQUE (job_id, material_version, fact_key)
);

CREATE INDEX job_fact_provenance_job_idx ON job_fact_provenance (job_id, material_version, fact_key);

CREATE TABLE job_lifecycle_events (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  from_status text CHECK (from_status IS NULL OR from_status IN ('ACTIVE', 'STALE', 'CLOSED', 'EXPIRED', 'REMOVED')),
  to_status text NOT NULL CHECK (to_status IN ('ACTIVE', 'STALE', 'CLOSED', 'EXPIRED', 'REMOVED')),
  reason_code text NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 160),
  source_snapshot_id uuid REFERENCES job_source_snapshots(id),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX job_lifecycle_events_job_idx ON job_lifecycle_events (job_id, observed_at DESC, id DESC);

CREATE TABLE job_ingestion_receipts (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  job_id uuid NOT NULL REFERENCES jobs(id),
  job_source_id uuid NOT NULL REFERENCES job_sources(id),
  snapshot_id uuid REFERENCES job_source_snapshots(id),
  material_version integer NOT NULL CHECK (material_version > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'STALE', 'CLOSED', 'EXPIRED', 'REMOVED')),
  created boolean NOT NULL,
  changed boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE job_source_scan_receipts (
  id uuid PRIMARY KEY,
  job_source_id uuid NOT NULL REFERENCES job_sources(id),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  scan_complete boolean NOT NULL,
  observed_identity_count integer NOT NULL CHECK (observed_identity_count >= 0),
  missing_incremented_count integer NOT NULL CHECK (missing_incremented_count >= 0),
  stale_transition_count integer NOT NULL CHECK (stale_transition_count >= 0),
  expired_transition_count integer NOT NULL CHECK (expired_transition_count >= 0),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE candidate_search_profile_versions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL,
  account_id uuid NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  preferences jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, profile_version),
  UNIQUE (id, candidate_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id)
);

CREATE TABLE candidate_search_profiles (
  candidate_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  profile_version_id uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (candidate_id, account_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (profile_version_id, candidate_id)
    REFERENCES candidate_search_profile_versions(id, candidate_id)
);

CREATE TABLE candidate_search_profile_receipts (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL,
  account_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint char(64) NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  profile_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, idempotency_key),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id),
  FOREIGN KEY (profile_version_id, candidate_id)
    REFERENCES candidate_search_profile_versions(id, candidate_id)
);

ALTER TABLE candidate_search_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_search_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_search_profile_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_search_profile_versions_own_account ON candidate_search_profile_versions
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY candidate_search_profiles_own_account ON candidate_search_profiles
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY candidate_search_profile_receipts_own_account ON candidate_search_profile_receipts
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());

CREATE FUNCTION app_private.reject_job_intelligence_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable job intelligence record cannot be updated or deleted';
END;
$$;

CREATE TRIGGER job_source_snapshots_no_update
  BEFORE UPDATE OR DELETE ON job_source_snapshots
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
CREATE TRIGGER job_fact_provenance_no_update
  BEFORE UPDATE OR DELETE ON job_fact_provenance
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
CREATE TRIGGER job_lifecycle_events_no_update
  BEFORE UPDATE OR DELETE ON job_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
CREATE TRIGGER job_ingestion_receipts_no_update
  BEFORE UPDATE OR DELETE ON job_ingestion_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
CREATE TRIGGER job_source_scan_receipts_no_update
  BEFORE UPDATE OR DELETE ON job_source_scan_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
CREATE TRIGGER candidate_search_profile_versions_no_update
  BEFORE UPDATE OR DELETE ON candidate_search_profile_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
CREATE TRIGGER candidate_search_profile_receipts_no_update
  BEFORE UPDATE OR DELETE ON candidate_search_profile_receipts
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_job_intelligence_immutable_mutation();
