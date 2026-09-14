-- Job Hunter V2 clean PostgreSQL baseline.
-- This file intentionally does not recreate the V1 SQLite schema.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA app_private;

CREATE FUNCTION app_private.current_account_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.current_account_id', true), '')::uuid
$$;

-- Identity owns accounts, users, external identities and memberships.
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  account_type text NOT NULL CHECK (account_type IN ('NORMAL', 'TEST', 'INTERNAL')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  contributes_to_global_learning boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (account_type <> 'TEST' OR contributes_to_global_learning = false)
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  personal_account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  primary_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_memberships (
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);

ALTER TABLE users
  ADD CONSTRAINT users_personal_account_membership_fk
  FOREIGN KEY (personal_account_id, id)
  REFERENCES account_memberships(account_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE external_auth_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  provider_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

-- Entitlements owns product capability. Account type remains independent.
CREATE TABLE plans (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX plans_one_default_idx ON plans (is_default) WHERE is_default;

CREATE TABLE features (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feature_key text NOT NULL UNIQUE CHECK (feature_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  description text NOT NULL,
  meter_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_entitlements (
  plan_id integer NOT NULL REFERENCES plans(id),
  feature_id integer NOT NULL REFERENCES features(id),
  enabled boolean NOT NULL,
  usage_limit bigint CHECK (usage_limit IS NULL OR usage_limit >= 0),
  period text CHECK (period IS NULL OR period IN ('DAY', 'WEEK', 'MONTH', 'LIFETIME')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, feature_id),
  CHECK (usage_limit IS NULL OR period IS NOT NULL)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  plan_id integer NOT NULL REFERENCES plans(id),
  provider text,
  provider_subscription_id text,
  status text NOT NULL CHECK (status IN ('FREE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  starts_at timestamptz NOT NULL,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'TRIALING' OR trial_ends_at IS NOT NULL)
);

CREATE UNIQUE INDEX subscriptions_provider_reference_idx
  ON subscriptions (provider, provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX subscriptions_one_current_idx
  ON subscriptions (account_id)
  WHERE status IN ('FREE', 'TRIALING', 'ACTIVE', 'PAST_DUE');

CREATE TABLE entitlement_overrides (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  feature_id integer NOT NULL REFERENCES features(id),
  effect text NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  usage_limit bigint CHECK (usage_limit IS NULL OR usage_limit >= 0),
  reason_code text NOT NULL,
  expires_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entitlement_overrides_active_idx
  ON entitlement_overrides (account_id, feature_id)
  WHERE expires_at IS NULL;

CREATE TABLE usage_counters (
  account_id uuid NOT NULL REFERENCES accounts(id),
  feature_id integer NOT NULL REFERENCES features(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, feature_id, period_start),
  CHECK (period_end > period_start)
);

-- Documents owns private object metadata; bytes remain in ObjectStoragePort.
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  object_key text NOT NULL UNIQUE,
  content_sha256 text NOT NULL CHECK (length(content_sha256) = 64),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  mime_type text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('MASTER_RESUME', 'TAILORED_RESUME', 'COVER_LETTER', 'APPLICATION_ATTACHMENT', 'DIAGNOSTIC')),
  status text NOT NULL CHECK (status IN ('UPLOADING', 'READY', 'QUARANTINED', 'DELETED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX documents_account_status_idx ON documents (account_id, status);

-- Job Intelligence owns global catalog truth and material source snapshots.
CREATE TABLE companies (
  id uuid PRIMARY KEY,
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  website_domain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (normalized_name, website_domain)
);

CREATE TABLE job_sources (
  id uuid PRIMARY KEY,
  company_id uuid REFERENCES companies(id),
  source_type text NOT NULL,
  source_url text NOT NULL,
  external_requisition_id text,
  active boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_url)
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id),
  canonical_title text NOT NULL,
  normalized_title text NOT NULL,
  country_code char(2),
  location_text text,
  work_mode text CHECK (work_mode IS NULL OR work_mode IN ('ONSITE', 'HYBRID', 'REMOTE')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'STALE', 'CLOSED', 'EXPIRED')),
  material_fingerprint text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CHECK (first_seen_at <= last_seen_at),
  CHECK ((status IN ('CLOSED', 'EXPIRED')) = (closed_at IS NOT NULL))
);

CREATE INDEX jobs_active_country_published_idx
  ON jobs (country_code, published_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE job_source_snapshots (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id),
  job_source_id uuid NOT NULL REFERENCES job_sources(id),
  content_hash text NOT NULL,
  object_key text,
  extracted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  UNIQUE (job_source_id, content_hash)
);

CREATE TABLE job_facets (
  job_id uuid PRIMARY KEY REFERENCES jobs(id),
  min_experience_months integer CHECK (min_experience_months IS NULL OR min_experience_months >= 0),
  max_experience_months integer CHECK (max_experience_months IS NULL OR max_experience_months >= 0),
  min_compensation_minor bigint,
  max_compensation_minor bigint,
  currency_code char(3),
  compensation_period text,
  requires_sponsorship boolean,
  sponsorship_available boolean,
  night_shift_required boolean,
  relocation_required boolean,
  heavy_travel_required boolean,
  employment_bond_required boolean,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (min_experience_months IS NULL OR max_experience_months IS NULL OR min_experience_months <= max_experience_months),
  CHECK (min_compensation_minor IS NULL OR min_compensation_minor >= 0),
  CHECK (max_compensation_minor IS NULL OR max_compensation_minor >= 0),
  CHECK (min_compensation_minor IS NULL OR max_compensation_minor IS NULL OR min_compensation_minor <= max_compensation_minor),
  CHECK ((min_compensation_minor IS NULL AND max_compensation_minor IS NULL) OR currency_code IS NOT NULL),
  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$')
);

CREATE TABLE skills (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_name text NOT NULL UNIQUE
);

CREATE TABLE job_skills (
  job_id uuid NOT NULL REFERENCES jobs(id),
  skill_id integer NOT NULL REFERENCES skills(id),
  requirement text NOT NULL CHECK (requirement IN ('REQUIRED', 'PREFERRED', 'ALTERNATIVE')),
  PRIMARY KEY (job_id, skill_id, requirement)
);

-- Candidate Truth is the only authoritative reusable candidate-answer store.
CREATE TABLE candidates (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, account_id)
);

CREATE TABLE canonical_fields (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_key text NOT NULL UNIQUE,
  description text NOT NULL,
  value_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DEPRECATED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE canonical_answer_policies (
  id uuid PRIMARY KEY,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  answer_class text NOT NULL CHECK (answer_class IN ('STABLE_FACT', 'MUTABLE_FACT', 'PREFERENCE', 'CONTEXTUAL', 'LEGAL_FACT', 'CONSENT')),
  reuse_mode text NOT NULL CHECK (reuse_mode IN ('AUTO', 'REVIEW', 'DRAFT', 'ASK', 'NEVER')),
  allowed_scope_types text[] NOT NULL,
  freshness_interval interval,
  risk_tier text NOT NULL CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'PROTECTED')),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_id, policy_version),
  UNIQUE (id, canonical_id),
  CHECK (cardinality(allowed_scope_types) > 0),
  CHECK (allowed_scope_types <@ ARRAY['GLOBAL', 'SEARCH', 'COMPANY', 'JOB', 'APPLICATION']::text[]),
  CHECK (freshness_interval IS NULL OR freshness_interval > interval '0 seconds')
);

CREATE UNIQUE INDEX canonical_answer_policies_one_active_idx
  ON canonical_answer_policies (canonical_id)
  WHERE active;

CREATE TABLE candidate_entities (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  entity_type text NOT NULL CHECK (entity_type IN ('EMPLOYMENT', 'EDUCATION', 'PROJECT', 'CERTIFICATION', 'LANGUAGE')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REMOVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, candidate_id)
);

CREATE TABLE candidate_entity_versions (
  id uuid PRIMARY KEY,
  entity_id uuid NOT NULL REFERENCES candidate_entities(id),
  version integer NOT NULL CHECK (version > 0),
  attributes jsonb NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_version_id uuid REFERENCES candidate_entity_versions(id),
  UNIQUE (entity_id, version)
);

CREATE TABLE candidate_answer_scopes (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  scope_type text NOT NULL CHECK (scope_type IN ('GLOBAL', 'SEARCH', 'COMPANY', 'JOB', 'APPLICATION')),
  scope_fingerprint text NOT NULL,
  company_id uuid REFERENCES companies(id),
  job_id uuid REFERENCES jobs(id),
  country_code char(2),
  role_family text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, scope_type, scope_fingerprint),
  UNIQUE (id, candidate_id)
);

CREATE TABLE candidate_answer_change_sets (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  source text NOT NULL,
  application_id uuid,
  checkpoint_id uuid,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('COMMITTED', 'REVERSED', 'PARTIALLY_REVERSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, idempotency_key),
  UNIQUE (id, candidate_id),
  CHECK (checkpoint_id IS NULL OR application_id IS NOT NULL)
);

CREATE TABLE candidate_answer_versions (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  entity_id uuid,
  scope_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  value_type text NOT NULL CHECK (value_type IN (
    'STRING', 'BOOLEAN', 'INTEGER', 'DECIMAL', 'DATE', 'DATE_RANGE', 'DURATION',
    'MONEY', 'PHONE', 'URL', 'ADDRESS', 'ENUM', 'MULTI_ENUM', 'ENTITY_REF',
    'FILE_REF', 'RICH_TEXT', 'DECLINE_TO_ANSWER'
  )),
  text_value text,
  integer_value bigint,
  decimal_value numeric,
  boolean_value boolean,
  date_value date,
  structured_value jsonb,
  value_fingerprint text NOT NULL CHECK (length(value_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  source text NOT NULL,
  trust_state text NOT NULL CHECK (trust_state IN ('REVIEW', 'TRUSTED', 'REMOVED')),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_version_id uuid REFERENCES candidate_answer_versions(id),
  change_set_id uuid,
  CHECK (num_nonnulls(text_value, integer_value, decimal_value, boolean_value, date_value, structured_value) = 1),
  CHECK (
    (value_type IN ('STRING', 'URL', 'ENUM', 'RICH_TEXT') AND text_value IS NOT NULL)
    OR (value_type = 'BOOLEAN' AND boolean_value IS NOT NULL)
    OR (value_type = 'INTEGER' AND integer_value IS NOT NULL)
    OR (value_type = 'DECIMAL' AND decimal_value IS NOT NULL)
    OR (value_type = 'DATE' AND date_value IS NOT NULL)
    OR (value_type IN ('DATE_RANGE', 'DURATION', 'MONEY', 'PHONE', 'ADDRESS', 'MULTI_ENUM', 'ENTITY_REF', 'FILE_REF', 'DECLINE_TO_ANSWER') AND structured_value IS NOT NULL)
  ),
  FOREIGN KEY (entity_id, candidate_id) REFERENCES candidate_entities(id, candidate_id),
  FOREIGN KEY (scope_id, candidate_id) REFERENCES candidate_answer_scopes(id, candidate_id),
  FOREIGN KEY (policy_id, canonical_id) REFERENCES canonical_answer_policies(id, canonical_id),
  FOREIGN KEY (change_set_id, candidate_id) REFERENCES candidate_answer_change_sets(id, candidate_id),
  UNIQUE (id, candidate_id)
);

CREATE INDEX candidate_answer_versions_history_idx
  ON candidate_answer_versions (candidate_id, canonical_id, created_at DESC);

CREATE TABLE candidate_answers_current (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  entity_id uuid REFERENCES candidate_entities(id),
  scope_id uuid NOT NULL REFERENCES candidate_answer_scopes(id),
  answer_version_id uuid NOT NULL UNIQUE REFERENCES candidate_answer_versions(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION app_private.assert_candidate_answer_current_consistency() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM candidate_answer_versions answer
    WHERE answer.id = NEW.answer_version_id
      AND answer.candidate_id = NEW.candidate_id
      AND answer.canonical_id = NEW.canonical_id
      AND answer.entity_id IS NOT DISTINCT FROM NEW.entity_id
      AND answer.scope_id = NEW.scope_id
  ) THEN
    RAISE EXCEPTION 'candidate_answers_current does not match answer version';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER candidate_answers_current_consistency_trigger
  BEFORE INSERT OR UPDATE ON candidate_answers_current
  FOR EACH ROW EXECUTE FUNCTION app_private.assert_candidate_answer_current_consistency();

CREATE UNIQUE INDEX candidate_answers_current_logical_idx
  ON candidate_answers_current (
    candidate_id,
    canonical_id,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    scope_id
  );

CREATE INDEX candidate_answers_current_lookup_idx
  ON candidate_answers_current (candidate_id, canonical_id, scope_id);

CREATE TABLE candidate_answer_change_set_items (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  change_set_id uuid NOT NULL,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  scope_id uuid NOT NULL,
  previous_version_id uuid,
  new_version_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('CREATED', 'REPLACED', 'REMOVED', 'RESTORED', 'SKIPPED_NEWER_VERSION', 'HELD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (change_set_id, candidate_id) REFERENCES candidate_answer_change_sets(id, candidate_id),
  FOREIGN KEY (scope_id, candidate_id) REFERENCES candidate_answer_scopes(id, candidate_id),
  FOREIGN KEY (previous_version_id, candidate_id) REFERENCES candidate_answer_versions(id, candidate_id),
  FOREIGN KEY (new_version_id, candidate_id) REFERENCES candidate_answer_versions(id, candidate_id)
);

CREATE INDEX candidate_answer_change_set_items_set_idx
  ON candidate_answer_change_set_items (change_set_id);

CREATE TABLE candidate_answer_runtime_proposals (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid,
  canonical_id integer NOT NULL REFERENCES canonical_fields(id),
  scope_id uuid NOT NULL,
  value_fingerprint text NOT NULL CHECK (length(value_fingerprint) = 64),
  fingerprint_key_version smallint NOT NULL CHECK (fingerprint_key_version > 0),
  normalized_value_encrypted bytea NOT NULL,
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm IN ('AES_256_GCM')),
  encryption_key_version smallint NOT NULL CHECK (encryption_key_version > 0),
  encryption_nonce bytea NOT NULL CHECK (octet_length(encryption_nonce) = 12),
  source_revision_id uuid,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMMITTED', 'HELD', 'DISCARDED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, candidate_id),
  FOREIGN KEY (scope_id, candidate_id) REFERENCES candidate_answer_scopes(id, candidate_id)
);

CREATE INDEX candidate_answer_runtime_proposals_pending_idx
  ON candidate_answer_runtime_proposals (candidate_id, expires_at)
  WHERE status = 'PENDING';

CREATE TABLE candidate_answer_reviews (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  proposal_id uuid,
  reason_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'KEPT_APPLICATION_ONLY', 'REJECTED')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (proposal_id, candidate_id) REFERENCES candidate_answer_runtime_proposals(id, candidate_id)
);

-- Application Intelligence persists cross-page state; final submission remains candidate-controlled.
CREATE TABLE applications (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  job_id uuid REFERENCES jobs(id),
  target_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'ATTENTION_PENDING', 'REVIEW', 'SUBMITTED', 'ABANDONED', 'FAILED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE (id, candidate_id),
  UNIQUE (id, candidate_id, account_id),
  FOREIGN KEY (candidate_id, account_id) REFERENCES candidates(id, account_id)
);

ALTER TABLE candidate_answer_scopes
  ADD COLUMN application_id uuid;

ALTER TABLE candidate_answer_scopes
  ADD CONSTRAINT candidate_answer_scopes_application_fk
  FOREIGN KEY (application_id, candidate_id)
  REFERENCES applications(id, candidate_id);

ALTER TABLE candidate_answer_scopes
  ADD CONSTRAINT candidate_answer_scopes_shape_check CHECK (
    (scope_type = 'GLOBAL' AND company_id IS NULL AND job_id IS NULL AND application_id IS NULL AND country_code IS NULL AND role_family IS NULL)
    OR (scope_type = 'SEARCH' AND company_id IS NULL AND job_id IS NULL AND application_id IS NULL AND (country_code IS NOT NULL OR role_family IS NOT NULL))
    OR (scope_type = 'COMPANY' AND company_id IS NOT NULL AND job_id IS NULL AND application_id IS NULL)
    OR (scope_type = 'JOB' AND job_id IS NOT NULL AND application_id IS NULL)
    OR (scope_type = 'APPLICATION' AND application_id IS NOT NULL)
  );

CREATE INDEX applications_candidate_updated_idx ON applications (candidate_id, updated_at DESC);

CREATE TABLE application_runs (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id),
  protocol_version integer NOT NULL,
  extension_version text,
  status text NOT NULL CHECK (status IN ('AUTHORIZED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ABORTED', 'EXPIRED')),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (id, application_id)
);

CREATE INDEX application_runs_application_started_idx
  ON application_runs (application_id, started_at DESC);

CREATE TABLE application_checkpoints (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id),
  run_id uuid NOT NULL,
  checkpoint_type text NOT NULL CHECK (checkpoint_type IN ('PAGE_ACCEPTED', 'REVIEW_REACHED', 'SUBMISSION', 'EXPLICIT_SAVE')),
  status text NOT NULL CHECK (status IN ('OBSERVED', 'VERIFIED', 'REJECTED')),
  evidence_hash text NOT NULL CHECK (length(evidence_hash) = 64),
  observed_at timestamptz NOT NULL,
  UNIQUE (run_id, evidence_hash),
  UNIQUE (id, application_id),
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

ALTER TABLE candidate_answer_change_sets
  ADD CONSTRAINT candidate_answer_change_sets_application_fk
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id);

ALTER TABLE candidate_answer_change_sets
  ADD CONSTRAINT candidate_answer_change_sets_checkpoint_fk
  FOREIGN KEY (checkpoint_id, application_id) REFERENCES application_checkpoints(id, application_id);

ALTER TABLE candidate_answer_runtime_proposals
  ADD CONSTRAINT candidate_answer_runtime_proposals_application_fk
  FOREIGN KEY (application_id, candidate_id) REFERENCES applications(id, candidate_id);

CREATE TABLE application_events (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id),
  run_id uuid,
  sequence bigint,
  event_type text NOT NULL,
  reason_code text,
  structural_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (run_id, application_id) REFERENCES application_runs(id, application_id)
);

CREATE INDEX application_events_application_occurred_idx
  ON application_events (application_id, occurred_at DESC);

CREATE UNIQUE INDEX application_events_run_sequence_idx
  ON application_events (run_id, sequence)
  WHERE run_id IS NOT NULL AND sequence IS NOT NULL;

-- Strategy Intelligence stores declarative, MV3-safe plans and value-free aggregates.
CREATE TABLE ats_families (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL
);

CREATE TABLE strategy_versions (
  id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  ats_family_id integer REFERENCES ats_families(id),
  supported_widget text NOT NULL,
  capability_version integer NOT NULL,
  declarative_plan jsonb NOT NULL,
  verification_plan jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('CANDIDATE', 'SHADOW', 'CANARY', 'ACTIVE', 'QUARANTINED', 'RETIRED')),
  rollout_percent smallint NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (strategy_key, version)
);

CREATE TABLE strategy_observation_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observation_date date NOT NULL,
  ats_family_id integer REFERENCES ats_families(id),
  canonical_id integer REFERENCES canonical_fields(id),
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(id),
  population text NOT NULL CHECK (population IN ('DIRECT', 'RESCUE', 'PROVISIONAL_DIRECT')),
  attempts bigint NOT NULL DEFAULT 0,
  verified bigint NOT NULL DEFAULT 0,
  failed bigint NOT NULL DEFAULT 0,
  timeouts bigint NOT NULL DEFAULT 0,
  user_corrections bigint NOT NULL DEFAULT 0,
  CHECK (attempts >= 0 AND verified >= 0 AND failed >= 0 AND timeouts >= 0 AND user_corrections >= 0),
  CHECK (verified + failed + timeouts <= attempts)
);

CREATE UNIQUE INDEX strategy_observation_daily_dimensions_idx
  ON strategy_observation_daily (
    observation_date,
    coalesce(ats_family_id, 0),
    coalesce(canonical_id, 0),
    strategy_version_id,
    population
  );

-- AI usage stores metering only; prompts and candidate answers are not telemetry.
CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  task_type text NOT NULL,
  provider text NOT NULL,
  model_profile text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_minor bigint NOT NULL DEFAULT 0 CHECK (estimated_cost_minor >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  accepted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_events_account_created_idx ON ai_usage_events (account_id, created_at DESC);

-- Operations owns idempotency, outbox and the initial PostgreSQL job queue.
CREATE TABLE idempotency_records (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  response_status integer,
  response_reference jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload_reference jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'DEAD')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX outbox_events_pending_idx
  ON outbox_events (available_at, created_at)
  WHERE status = 'PENDING';

CREATE INDEX outbox_events_expired_lease_idx
  ON outbox_events (lease_expires_at)
  WHERE status = 'PROCESSING';

CREATE TABLE worker_jobs (
  id uuid PRIMARY KEY,
  job_type text NOT NULL,
  payload_reference jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'DEAD')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX worker_jobs_available_idx
  ON worker_jobs (available_at, created_at)
  WHERE status = 'PENDING';

CREATE INDEX worker_jobs_expired_lease_idx
  ON worker_jobs (lease_expires_at)
  WHERE status = 'PROCESSING';

CREATE TABLE feature_flags (
  flag_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent smallint NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  kill_switch boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES accounts(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Defense-in-depth account isolation. Global dictionary/intelligence tables remain shared.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_entity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answers_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_change_set_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_runtime_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_answer_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_own_account ON accounts
  USING (id = app_private.current_account_id());
CREATE POLICY users_current_membership ON users
  USING (id IN (
    SELECT user_id FROM account_memberships
    WHERE account_id = app_private.current_account_id()
  ));
CREATE POLICY memberships_own_account ON account_memberships
  USING (account_id = app_private.current_account_id());
CREATE POLICY external_auth_identities_current_membership ON external_auth_identities
  USING (user_id IN (
    SELECT user_id FROM account_memberships
    WHERE account_id = app_private.current_account_id()
  ));
CREATE POLICY subscriptions_own_account ON subscriptions
  USING (account_id = app_private.current_account_id());
CREATE POLICY entitlement_overrides_own_account ON entitlement_overrides
  USING (account_id = app_private.current_account_id());
CREATE POLICY usage_counters_own_account ON usage_counters
  USING (account_id = app_private.current_account_id());
CREATE POLICY documents_own_account ON documents
  USING (account_id = app_private.current_account_id());
CREATE POLICY candidates_own_account ON candidates
  USING (account_id = app_private.current_account_id());
CREATE POLICY candidate_entities_own_account ON candidate_entities
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_entity_versions_own_account ON candidate_entity_versions
  USING (entity_id IN (
    SELECT ce.id FROM candidate_entities ce
    JOIN candidates c ON c.id = ce.candidate_id
    WHERE c.account_id = app_private.current_account_id()
  ));
CREATE POLICY candidate_answer_scopes_own_account ON candidate_answer_scopes
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_answer_change_sets_own_account ON candidate_answer_change_sets
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_answer_versions_own_account ON candidate_answer_versions
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_answers_current_own_account ON candidate_answers_current
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_answer_change_set_items_own_account ON candidate_answer_change_set_items
  USING (change_set_id IN (
    SELECT cs.id FROM candidate_answer_change_sets cs
    JOIN candidates c ON c.id = cs.candidate_id
    WHERE c.account_id = app_private.current_account_id()
  ));
CREATE POLICY candidate_answer_runtime_proposals_own_account ON candidate_answer_runtime_proposals
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY candidate_answer_reviews_own_account ON candidate_answer_reviews
  USING (candidate_id IN (SELECT id FROM candidates WHERE account_id = app_private.current_account_id()));
CREATE POLICY applications_own_account ON applications
  USING (account_id = app_private.current_account_id());
CREATE POLICY application_runs_own_account ON application_runs
  USING (application_id IN (SELECT id FROM applications WHERE account_id = app_private.current_account_id()));
CREATE POLICY application_checkpoints_own_account ON application_checkpoints
  USING (application_id IN (SELECT id FROM applications WHERE account_id = app_private.current_account_id()));
CREATE POLICY application_events_own_account ON application_events
  USING (application_id IN (SELECT id FROM applications WHERE account_id = app_private.current_account_id()));
CREATE POLICY ai_usage_own_account ON ai_usage_events
  USING (account_id = app_private.current_account_id());
