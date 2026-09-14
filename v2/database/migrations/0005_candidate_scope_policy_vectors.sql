ALTER TABLE canonical_answer_policies
  ADD COLUMN scope_context_dimensions text[] NOT NULL DEFAULT '{}'::text[],
  ADD CONSTRAINT canonical_answer_policies_scope_context_dimensions_check
    CHECK (scope_context_dimensions <@ ARRAY['COUNTRY', 'ROLE_FAMILY', 'COMPANY', 'JOB', 'APPLICATION']::text[]);

ALTER TABLE candidate_answer_scopes
  ADD CONSTRAINT candidate_answer_scopes_fingerprint_length_check
    CHECK (length(scope_fingerprint) = 64);

UPDATE canonical_answer_policies policy
SET scope_context_dimensions = CASE
  WHEN canonical.canonical_key = 'RESUME' THEN ARRAY['JOB']::text[]
  WHEN canonical.canonical_key IN ('WORK_AUTHORIZATION', 'SPONSORSHIP_REQUIRED')
    THEN ARRAY['COUNTRY']::text[]
  WHEN canonical.canonical_key IN ('PREVIOUSLY_EMPLOYED_BY_COMPANY', 'RELATIVE_AT_COMPANY')
    THEN ARRAY['COMPANY']::text[]
  WHEN policy.answer_class = 'PREFERENCE'
    THEN ARRAY['COUNTRY', 'ROLE_FAMILY', 'COMPANY', 'JOB']::text[]
  WHEN 'APPLICATION' = ANY(policy.allowed_scope_types)
    THEN ARRAY['APPLICATION']::text[]
  ELSE '{}'::text[]
END
FROM canonical_fields canonical
WHERE canonical.id = policy.canonical_id;

ALTER TABLE canonical_answer_policies
  ADD CONSTRAINT canonical_answer_policies_required_scope_vector_check
    CHECK (required_context_dimensions <@ scope_context_dimensions),
  ADD CONSTRAINT canonical_answer_policies_scope_identity_vector_check
    CHECK (
      (NOT ('SEARCH' = ANY(allowed_scope_types))
        OR 'COUNTRY' = ANY(scope_context_dimensions)
        OR 'ROLE_FAMILY' = ANY(scope_context_dimensions))
      AND (NOT ('COMPANY' = ANY(allowed_scope_types)) OR 'COMPANY' = ANY(scope_context_dimensions))
      AND (NOT ('JOB' = ANY(allowed_scope_types)) OR 'JOB' = ANY(scope_context_dimensions))
      AND (NOT ('APPLICATION' = ANY(allowed_scope_types)) OR 'APPLICATION' = ANY(scope_context_dimensions))
    );

UPDATE canonical_answer_policies SET active = false WHERE active;

INSERT INTO canonical_answer_policies (
  id,
  canonical_id,
  policy_version,
  answer_class,
  reuse_mode,
  allowed_scope_types,
  scope_context_dimensions,
  required_context_dimensions,
  freshness_interval,
  risk_tier,
  autofill_mode,
  learning_mode,
  permanent_commit_points,
  review_reuse,
  derivation_policy,
  sensitivity,
  reason_code,
  active
)
SELECT
  md5('job-hunter-v2:candidate-policy:2:' || canonical.canonical_key)::uuid,
  policy.canonical_id,
  2,
  policy.answer_class,
  policy.reuse_mode,
  policy.allowed_scope_types,
  policy.scope_context_dimensions,
  policy.required_context_dimensions,
  policy.freshness_interval,
  policy.risk_tier,
  policy.autofill_mode,
  policy.learning_mode,
  policy.permanent_commit_points,
  policy.review_reuse,
  policy.derivation_policy,
  policy.sensitivity,
  policy.reason_code,
  true
FROM canonical_answer_policies policy
JOIN canonical_fields canonical ON canonical.id = policy.canonical_id
WHERE policy.policy_version = 1;
