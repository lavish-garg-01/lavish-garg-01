ALTER TABLE canonical_fields
  ADD COLUMN entity_type text;

ALTER TABLE canonical_fields
  ADD CONSTRAINT canonical_fields_key_check
    CHECK (canonical_key ~ '^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$'),
  ADD CONSTRAINT canonical_fields_value_type_check
    CHECK (value_type IN (
      'STRING', 'BOOLEAN', 'INTEGER', 'DECIMAL', 'DATE', 'DATE_RANGE', 'DURATION',
      'MONEY', 'PHONE', 'URL', 'ADDRESS', 'ENUM', 'MULTI_ENUM', 'ENTITY_REF',
      'FILE_REF', 'RICH_TEXT', 'DECLINE_TO_ANSWER'
    )),
  ADD CONSTRAINT canonical_fields_entity_type_check
    CHECK (entity_type IS NULL OR entity_type IN ('EMPLOYMENT', 'EDUCATION', 'PROJECT', 'CERTIFICATION', 'LANGUAGE'));

ALTER TABLE canonical_answer_policies
  DROP CONSTRAINT canonical_answer_policies_answer_class_check;

ALTER TABLE canonical_answer_policies
  ADD CONSTRAINT canonical_answer_policies_answer_class_check
    CHECK (answer_class IN ('STABLE_FACT', 'MUTABLE_FACT', 'PREFERENCE', 'CONTEXTUAL', 'LEGAL_FACT', 'CONSENT', 'PROTECTED')),
  ADD COLUMN required_context_dimensions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN autofill_mode text NOT NULL DEFAULT 'FORBIDDEN',
  ADD COLUMN learning_mode text NOT NULL DEFAULT 'NEVER_LEARN',
  ADD COLUMN permanent_commit_points text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN review_reuse text NOT NULL DEFAULT 'NEVER',
  ADD COLUMN derivation_policy text NOT NULL DEFAULT 'NEVER_INFER',
  ADD COLUMN sensitivity text NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN reason_code text NOT NULL DEFAULT 'UNREVIEWED_CANONICAL_FAILS_CLOSED',
  ADD CONSTRAINT canonical_answer_policies_required_context_check
    CHECK (required_context_dimensions <@ ARRAY['COUNTRY', 'ROLE_FAMILY', 'COMPANY', 'JOB', 'APPLICATION']::text[]),
  ADD CONSTRAINT canonical_answer_policies_autofill_check
    CHECK (autofill_mode IN ('AUTO', 'REVIEW', 'APPLICATION_GESTURE', 'FORBIDDEN')),
  ADD CONSTRAINT canonical_answer_policies_learning_check
    CHECK (learning_mode IN ('AUTO_VERSION', 'REVIEW_TO_SAVE', 'APPLICATION_ONLY', 'APPLICATION_AUTHORIZATION', 'NEVER_LEARN')),
  ADD CONSTRAINT canonical_answer_policies_commit_points_check
    CHECK (permanent_commit_points <@ ARRAY['VERIFIED_SUBMISSION', 'EXPLICIT_SAVE']::text[]),
  ADD CONSTRAINT canonical_answer_policies_review_reuse_check
    CHECK (review_reuse IN ('NEVER', 'EXACT_SCOPE_TRIAL')),
  ADD CONSTRAINT canonical_answer_policies_derivation_check
    CHECK (derivation_policy IN ('DETERMINISTIC_ONLY', 'NEVER_INFER', 'GROUNDED_GENERATION')),
  ADD CONSTRAINT canonical_answer_policies_sensitivity_check
    CHECK (sensitivity IN ('NORMAL', 'PERSONAL', 'LEGAL', 'SENSITIVE')),
  ADD CONSTRAINT canonical_answer_policies_reason_code_check
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]*$'),
  ADD CONSTRAINT canonical_answer_policies_learning_boundary_check
    CHECK (
      (learning_mode IN ('AUTO_VERSION', 'REVIEW_TO_SAVE') AND cardinality(permanent_commit_points) > 0)
      OR (learning_mode NOT IN ('AUTO_VERSION', 'REVIEW_TO_SAVE') AND cardinality(permanent_commit_points) = 0)
    ),
  ADD CONSTRAINT canonical_answer_policies_protected_check
    CHECK (
      answer_class <> 'PROTECTED'
      OR (reuse_mode = 'NEVER' AND autofill_mode = 'FORBIDDEN' AND learning_mode = 'NEVER_LEARN')
    ),
  ADD CONSTRAINT canonical_answer_policies_consent_check
    CHECK (
      answer_class <> 'CONSENT'
      OR ('APPLICATION' = ANY(allowed_scope_types)
          AND autofill_mode = 'APPLICATION_GESTURE'
          AND learning_mode = 'APPLICATION_AUTHORIZATION')
    ),
  ADD CONSTRAINT canonical_answer_policies_legal_inference_check
    CHECK (answer_class <> 'LEGAL_FACT' OR derivation_policy = 'NEVER_INFER');

WITH seed(canonical_key, description, value_type, entity_type) AS (
  VALUES
    ('LEGAL_FIRST_NAME', 'Candidate-verified legal given name.', 'STRING', null),
    ('LEGAL_MIDDLE_NAME', 'Candidate-verified legal middle name.', 'STRING', null),
    ('LEGAL_LAST_NAME', 'Candidate-verified legal family name.', 'STRING', null),
    ('PREFERRED_FIRST_NAME', 'Preferred given name.', 'STRING', null),
    ('PREFERRED_LAST_NAME', 'Preferred family name.', 'STRING', null),
    ('FIRST_NAME', 'Standard given name used for applications.', 'STRING', null),
    ('LAST_NAME', 'Standard family name used for applications.', 'STRING', null),
    ('FULL_NAME', 'Complete candidate name.', 'STRING', null),
    ('EMAIL', 'Application contact email.', 'STRING', null),
    ('PHONE', 'Application contact phone number.', 'PHONE', null),
    ('CURRENT_ADDRESS', 'Candidate current postal address.', 'ADDRESS', null),
    ('CURRENT_LOCATION', 'Candidate current city or locality.', 'STRING', null),
    ('LINKEDIN_URL', 'Candidate LinkedIn profile.', 'URL', null),
    ('GITHUB_URL', 'Candidate GitHub profile.', 'URL', null),
    ('PORTFOLIO_URL', 'Candidate portfolio or professional website.', 'URL', null),
    ('CURRENT_COMPANY', 'Candidate current or most recent employer.', 'STRING', null),
    ('CURRENT_JOB_TITLE', 'Candidate current or most recent job title.', 'STRING', null),
    ('CURRENT_CTC', 'Candidate current compensation.', 'MONEY', null),
    ('NOTICE_PERIOD', 'Candidate current notice period in days.', 'INTEGER', null),
    ('TOTAL_EXPERIENCE', 'Candidate total professional experience.', 'DURATION', null),
    ('SKILLS', 'Candidate-verified professional skills.', 'MULTI_ENUM', null),
    ('PERSONAL_SUMMARY', 'Candidate-verified professional summary.', 'RICH_TEXT', null),
    ('RESUME', 'Candidate-selected master or application resume.', 'FILE_REF', null),
    ('WORK_AUTHORIZATION', 'Whether the candidate may work in a specific country.', 'BOOLEAN', null),
    ('SPONSORSHIP_REQUIRED', 'Whether the candidate requires sponsorship in a specific country.', 'BOOLEAN', null),
    ('AGE_OVER_18', 'Whether the candidate is at least 18 years old.', 'BOOLEAN', null),
    ('GOVERNMENT_EMPLOYEE', 'Whether the candidate is currently a government employee.', 'BOOLEAN', null),
    ('NON_COMPETE', 'Whether the candidate is subject to a non-compete obligation.', 'BOOLEAN', null),
    ('PREVIOUSLY_EMPLOYED_BY_COMPANY', 'Whether the candidate previously worked for the hiring company.', 'BOOLEAN', null),
    ('RELATIVE_AT_COMPANY', 'Whether the candidate has a relative at the hiring company.', 'BOOLEAN', null),
    ('EXPECTED_CTC', 'Candidate expected compensation for a context.', 'MONEY', null),
    ('RELOCATION', 'Candidate relocation preference for a context.', 'BOOLEAN', null),
    ('PREFERRED_LOCATIONS', 'Candidate preferred work locations.', 'MULTI_ENUM', null),
    ('START_DATE', 'Candidate available start date for one application.', 'DATE', null),
    ('WORK_MODE_REQUIREMENT', 'Candidate response to a job-specific work-mode requirement.', 'BOOLEAN', null),
    ('HEARING_SOURCE', 'How the candidate learned about one role.', 'ENUM', null),
    ('COVER_LETTER', 'Job-grounded cover letter draft.', 'RICH_TEXT', null),
    ('EMPLOYMENT_COMPANY', 'Employer for one stable employment entity.', 'STRING', 'EMPLOYMENT'),
    ('EMPLOYMENT_TITLE', 'Job title for one stable employment entity.', 'STRING', 'EMPLOYMENT'),
    ('EMPLOYMENT_DATE_RANGE', 'Dates for one stable employment entity.', 'DATE_RANGE', 'EMPLOYMENT'),
    ('EDUCATION_INSTITUTION', 'Institution for one stable education entity.', 'STRING', 'EDUCATION'),
    ('EDUCATION_DEGREE', 'Degree for one stable education entity.', 'STRING', 'EDUCATION'),
    ('EDUCATION_FIELD_OF_STUDY', 'Field of study for one stable education entity.', 'STRING', 'EDUCATION'),
    ('EDUCATION_DATE_RANGE', 'Dates for one stable education entity.', 'DATE_RANGE', 'EDUCATION'),
    ('CERTIFY_INFORMATION_ACCURATE', 'Application-specific accuracy certification.', 'BOOLEAN', null),
    ('PRIVACY_ACKNOWLEDGEMENT', 'Application-specific privacy notice acknowledgement.', 'BOOLEAN', null),
    ('BACKGROUND_CHECK_AUTHORIZATION', 'Application-specific background-check authorization.', 'BOOLEAN', null),
    ('TERMS_ACKNOWLEDGEMENT', 'Application-specific terms acknowledgement.', 'BOOLEAN', null),
    ('EEO_GENDER', 'Voluntary demographic gender disclosure.', 'ENUM', null),
    ('EEO_RACE', 'Voluntary demographic race or ethnicity disclosure.', 'ENUM', null),
    ('EEO_VETERAN', 'Voluntary veteran-status disclosure.', 'ENUM', null),
    ('EEO_DISABILITY', 'Voluntary disability-status disclosure.', 'ENUM', null)
)
INSERT INTO canonical_fields (canonical_key, description, value_type, entity_type, status)
SELECT canonical_key, description, value_type, entity_type, 'ACTIVE'
FROM seed
ON CONFLICT (canonical_key) DO UPDATE SET
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  entity_type = EXCLUDED.entity_type,
  status = EXCLUDED.status;

WITH classified AS (
  SELECT
    canonical.id AS canonical_id,
    canonical.canonical_key,
    CASE
      WHEN canonical.canonical_key IN ('EEO_GENDER', 'EEO_RACE', 'EEO_VETERAN', 'EEO_DISABILITY') THEN 'PROTECTED'
      WHEN canonical.canonical_key IN ('CERTIFY_INFORMATION_ACCURATE', 'PRIVACY_ACKNOWLEDGEMENT', 'BACKGROUND_CHECK_AUTHORIZATION', 'TERMS_ACKNOWLEDGEMENT') THEN 'CONSENT'
      WHEN canonical.canonical_key IN ('WORK_AUTHORIZATION', 'SPONSORSHIP_REQUIRED', 'AGE_OVER_18', 'GOVERNMENT_EMPLOYEE', 'NON_COMPETE', 'PREVIOUSLY_EMPLOYED_BY_COMPANY', 'RELATIVE_AT_COMPANY') THEN 'LEGAL_FACT'
      WHEN canonical.canonical_key IN ('EXPECTED_CTC', 'RELOCATION', 'PREFERRED_LOCATIONS') THEN 'PREFERENCE'
      WHEN canonical.canonical_key IN ('CURRENT_COMPANY', 'CURRENT_JOB_TITLE', 'CURRENT_CTC', 'NOTICE_PERIOD') THEN 'MUTABLE_FACT'
      WHEN canonical.canonical_key IN ('START_DATE', 'WORK_MODE_REQUIREMENT', 'HEARING_SOURCE', 'COVER_LETTER') THEN 'CONTEXTUAL'
      ELSE 'STABLE_FACT'
    END AS answer_class
  FROM canonical_fields canonical
  WHERE canonical.status = 'ACTIVE'
), policy AS (
  SELECT
    classified.*,
    CASE
      WHEN answer_class IN ('PROTECTED', 'CONSENT') THEN 'NEVER'
      WHEN answer_class = 'CONTEXTUAL' AND canonical_key = 'COVER_LETTER' THEN 'DRAFT'
      WHEN answer_class = 'CONTEXTUAL' THEN 'ASK'
      WHEN answer_class = 'LEGAL_FACT' THEN 'REVIEW'
      ELSE 'AUTO'
    END AS reuse_mode,
    CASE
      WHEN canonical_key = 'RESUME' THEN ARRAY['GLOBAL', 'JOB']::text[]
      WHEN canonical_key IN ('WORK_AUTHORIZATION', 'SPONSORSHIP_REQUIRED') THEN ARRAY['SEARCH']::text[]
      WHEN canonical_key IN ('PREVIOUSLY_EMPLOYED_BY_COMPANY', 'RELATIVE_AT_COMPANY') THEN ARRAY['COMPANY']::text[]
      WHEN answer_class = 'PREFERENCE' THEN ARRAY['GLOBAL', 'SEARCH', 'COMPANY', 'JOB']::text[]
      WHEN answer_class IN ('CONTEXTUAL', 'CONSENT', 'PROTECTED') THEN ARRAY['APPLICATION']::text[]
      ELSE ARRAY['GLOBAL']::text[]
    END AS allowed_scope_types,
    CASE
      WHEN canonical_key IN ('WORK_AUTHORIZATION', 'SPONSORSHIP_REQUIRED') THEN ARRAY['COUNTRY']::text[]
      WHEN canonical_key IN ('PREVIOUSLY_EMPLOYED_BY_COMPANY', 'RELATIVE_AT_COMPANY') THEN ARRAY['COMPANY']::text[]
      WHEN answer_class IN ('CONTEXTUAL', 'CONSENT') THEN ARRAY['APPLICATION']::text[]
      ELSE '{}'::text[]
    END AS required_context_dimensions,
    CASE
      WHEN canonical_key = 'NOTICE_PERIOD' THEN interval '30 days'
      WHEN canonical_key = 'EXPECTED_CTC' THEN interval '90 days'
      WHEN canonical_key = 'AGE_OVER_18' THEN interval '365 days'
      WHEN answer_class IN ('MUTABLE_FACT', 'LEGAL_FACT') THEN interval '180 days'
      ELSE null
    END AS freshness_interval,
    CASE
      WHEN answer_class = 'PROTECTED' THEN 'PROTECTED'
      WHEN answer_class IN ('LEGAL_FACT', 'CONSENT') OR canonical_key IN ('CURRENT_CTC', 'EXPECTED_CTC') THEN 'HIGH'
      WHEN canonical_key = 'RESUME' OR answer_class IN ('MUTABLE_FACT', 'PREFERENCE', 'CONTEXTUAL') THEN 'MEDIUM'
      ELSE 'LOW'
    END AS risk_tier,
    CASE
      WHEN answer_class = 'PROTECTED' OR (answer_class = 'CONTEXTUAL' AND canonical_key <> 'COVER_LETTER') THEN 'FORBIDDEN'
      WHEN answer_class = 'CONSENT' THEN 'APPLICATION_GESTURE'
      WHEN answer_class = 'LEGAL_FACT' OR canonical_key = 'COVER_LETTER' THEN 'REVIEW'
      ELSE 'AUTO'
    END AS autofill_mode,
    CASE
      WHEN answer_class = 'PROTECTED' THEN 'NEVER_LEARN'
      WHEN answer_class = 'CONSENT' THEN 'APPLICATION_AUTHORIZATION'
      WHEN answer_class = 'CONTEXTUAL' THEN 'APPLICATION_ONLY'
      WHEN canonical_key IN ('CURRENT_COMPANY', 'CURRENT_JOB_TITLE') THEN 'AUTO_VERSION'
      WHEN answer_class = 'STABLE_FACT' AND canonical_key <> 'RESUME' THEN 'AUTO_VERSION'
      ELSE 'REVIEW_TO_SAVE'
    END AS learning_mode,
    CASE
      WHEN answer_class IN ('PROTECTED', 'CONSENT', 'CONTEXTUAL') THEN '{}'::text[]
      ELSE ARRAY['VERIFIED_SUBMISSION', 'EXPLICIT_SAVE']::text[]
    END AS permanent_commit_points,
    CASE WHEN answer_class IN ('LEGAL_FACT', 'PREFERENCE') THEN 'EXACT_SCOPE_TRIAL' ELSE 'NEVER' END AS review_reuse,
    CASE
      WHEN canonical_key = 'COVER_LETTER' THEN 'GROUNDED_GENERATION'
      WHEN canonical_key IN ('CURRENT_COMPANY', 'CURRENT_JOB_TITLE') THEN 'DETERMINISTIC_ONLY'
      WHEN answer_class = 'STABLE_FACT' AND canonical_key <> 'RESUME' THEN 'DETERMINISTIC_ONLY'
      ELSE 'NEVER_INFER'
    END AS derivation_policy,
    CASE
      WHEN answer_class = 'PROTECTED' THEN 'SENSITIVE'
      WHEN answer_class IN ('LEGAL_FACT', 'CONSENT') THEN 'LEGAL'
      WHEN canonical_key ~ 'LEGAL_|EMAIL|PHONE|ADDRESS' OR canonical_key IN ('CURRENT_CTC', 'EXPECTED_CTC', 'RESUME') THEN 'PERSONAL'
      ELSE 'NORMAL'
    END AS sensitivity,
    CASE
      WHEN answer_class = 'PROTECTED' THEN 'PROTECTED_OR_VOLUNTARY_VALUE'
      WHEN answer_class = 'CONSENT' THEN 'APPLICATION_DECLARATION_REQUIRES_GESTURE'
      WHEN canonical_key IN ('WORK_AUTHORIZATION', 'SPONSORSHIP_REQUIRED') THEN 'JURISDICTION_SCOPED_LEGAL_FACT'
      WHEN canonical_key IN ('PREVIOUSLY_EMPLOYED_BY_COMPANY', 'RELATIVE_AT_COMPANY') THEN 'EXACT_COMPANY_SCOPE_REQUIRED'
      WHEN answer_class = 'LEGAL_FACT' THEN 'CANDIDATE_CONFIRMED_LEGAL_FACT'
      WHEN answer_class = 'PREFERENCE' THEN 'CONTEXTUAL_PREFERENCE_WITH_GLOBAL_DEFAULT'
      WHEN canonical_key = 'CURRENT_CTC' THEN 'FRESH_COMPENSATION_FACT'
      WHEN canonical_key = 'NOTICE_PERIOD' THEN 'FRESH_AVAILABILITY_FACT'
      WHEN answer_class = 'MUTABLE_FACT' THEN 'FRESH_MUTABLE_EMPLOYMENT_FACT'
      WHEN canonical_key = 'RESUME' THEN 'CANDIDATE_SELECTED_DOCUMENT'
      WHEN canonical_key = 'COVER_LETTER' THEN 'JOB_GROUNDED_WRITING'
      WHEN answer_class = 'CONTEXTUAL' THEN 'UNREVIEWED_CANONICAL_FAILS_CLOSED'
      WHEN canonical_key LIKE 'EMPLOYMENT_%' OR canonical_key LIKE 'EDUCATION_%' THEN 'STABLE_ENTITY_FACT'
      ELSE 'STABLE_CANDIDATE_FACT'
    END AS reason_code
  FROM classified
)
INSERT INTO canonical_answer_policies (
  id,
  canonical_id,
  policy_version,
  answer_class,
  reuse_mode,
  allowed_scope_types,
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
  md5('job-hunter-v2:candidate-policy:1:' || canonical_key)::uuid,
  canonical_id,
  1,
  answer_class,
  reuse_mode,
  allowed_scope_types,
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
  true
FROM policy
ON CONFLICT (canonical_id, policy_version) DO UPDATE SET
  answer_class = EXCLUDED.answer_class,
  reuse_mode = EXCLUDED.reuse_mode,
  allowed_scope_types = EXCLUDED.allowed_scope_types,
  required_context_dimensions = EXCLUDED.required_context_dimensions,
  freshness_interval = EXCLUDED.freshness_interval,
  risk_tier = EXCLUDED.risk_tier,
  autofill_mode = EXCLUDED.autofill_mode,
  learning_mode = EXCLUDED.learning_mode,
  permanent_commit_points = EXCLUDED.permanent_commit_points,
  review_reuse = EXCLUDED.review_reuse,
  derivation_policy = EXCLUDED.derivation_policy,
  sensitivity = EXCLUDED.sensitivity,
  reason_code = EXCLUDED.reason_code,
  active = EXCLUDED.active;
