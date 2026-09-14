UPDATE plans SET is_default = false WHERE is_default AND code <> 'FREE';

INSERT INTO plans (code, name, active, is_default)
VALUES
  ('FREE', 'Free', true, true),
  ('PRO', 'Pro', true, false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  active = EXCLUDED.active,
  is_default = EXCLUDED.is_default;

INSERT INTO features (feature_key, description, meter_key)
VALUES
  ('profile.manage', 'Manage candidate truth and profile.', null),
  ('jobs.search', 'Search and match jobs deterministically.', null),
  ('applications.autofill', 'Use deterministic extension autofill.', 'applications'),
  ('candidate.learning', 'Learn verified candidate answers for future applications.', null),
  ('candidate.ai_match_explanations', 'Candidate-specific AI match explanations.', 'ai_match_explanations'),
  ('candidate.ai_application_answers', 'Candidate-specific generated application answers.', 'ai_application_answers'),
  ('documents.resume_tailoring', 'Generate a job-specific resume presentation.', 'resume_tailoring')
ON CONFLICT (feature_key) DO UPDATE SET
  description = EXCLUDED.description,
  meter_key = EXCLUDED.meter_key;

INSERT INTO plan_entitlements (plan_id, feature_id, enabled, usage_limit, period)
SELECT p.id, f.id, rules.enabled, rules.usage_limit, rules.period
FROM (
  VALUES
    ('FREE', 'profile.manage', true, null::bigint, null::text),
    ('FREE', 'jobs.search', true, null::bigint, null::text),
    ('FREE', 'applications.autofill', true, null::bigint, 'MONTH'),
    ('FREE', 'candidate.learning', true, null::bigint, null::text),
    ('FREE', 'candidate.ai_match_explanations', false, 0::bigint, 'MONTH'),
    ('FREE', 'candidate.ai_application_answers', false, 0::bigint, 'MONTH'),
    ('FREE', 'documents.resume_tailoring', false, 0::bigint, 'MONTH'),
    ('PRO', 'profile.manage', true, null::bigint, null::text),
    ('PRO', 'jobs.search', true, null::bigint, null::text),
    ('PRO', 'applications.autofill', true, null::bigint, 'MONTH'),
    ('PRO', 'candidate.learning', true, null::bigint, null::text),
    ('PRO', 'candidate.ai_match_explanations', true, null::bigint, 'MONTH'),
    ('PRO', 'candidate.ai_application_answers', true, null::bigint, 'MONTH'),
    ('PRO', 'documents.resume_tailoring', true, null::bigint, 'MONTH')
) AS rules(plan_code, feature_key, enabled, usage_limit, period)
JOIN plans p ON p.code = rules.plan_code
JOIN features f ON f.feature_key = rules.feature_key
ON CONFLICT (plan_id, feature_id) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  usage_limit = EXCLUDED.usage_limit,
  period = EXCLUDED.period,
  updated_at = now();
