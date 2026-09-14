-- Explicit DBA provisioning, AFTER migrations through 0031. Not a startup migration.
-- Creates NOLOGIN permission groups only. Provision separate login credentials outside this file.
BEGIN;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['job_hunter_review_runtime','job_hunter_review_evaluator'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',role_name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN
      RAISE EXCEPTION 'Unsafe existing review permission group';
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public,app_private TO job_hunter_review_runtime,job_hunter_review_evaluator;
GRANT SELECT,INSERT,UPDATE ON platform_operators,autofill_review_cases,support_review_grants TO job_hunter_review_runtime;
GRANT SELECT,INSERT ON operator_review_audit,operator_action_receipts,support_review_audit,reviewed_artifacts,reviewed_approvals,reviewed_exports TO job_hunter_review_runtime;
GRANT SELECT,UPDATE ON reviewed_export_state TO job_hunter_review_runtime;
GRANT SELECT ON autofill_outcome_events,reviewed_evaluations TO job_hunter_review_runtime;
GRANT SELECT(strategy_key,version,q_definition) ON strategy_versions TO job_hunter_review_runtime,job_hunter_review_evaluator;
GRANT SELECT ON reviewed_artifacts,reviewed_evaluations TO job_hunter_review_evaluator;
GRANT INSERT ON reviewed_evaluations TO job_hunter_review_evaluator;
-- Support service reads encrypted notes; authenticated exact-note consent remains repository-enforced.
-- It cannot read resumes, normalized profile values, or mutate the underlying candidate data.
GRANT SELECT(id,status) ON accounts TO job_hunter_review_runtime;
GRANT SELECT(id,account_id,status) ON candidates TO job_hunter_review_runtime;
GRANT SELECT(id,account_id,candidate_id) ON applications TO job_hunter_review_runtime;
GRANT SELECT(id,application_id) ON application_runs TO job_hunter_review_runtime;
GRANT SELECT(id,account_id,candidate_id,application_id,run_id,payload,status,expires_at) ON candidate_learning_inbox TO job_hunter_review_runtime;
-- PostgreSQL requires UPDATE privilege for FOR SHARE locks. Restrictive policies below
-- forbid actual writes even if a caller forges the older tenant session setting.
GRANT UPDATE(id) ON accounts,candidates,applications,application_runs,candidate_learning_inbox TO job_hunter_review_runtime;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['platform_operators','autofill_review_cases','support_review_grants','operator_review_audit','operator_action_receipts','support_review_audit','reviewed_artifacts','reviewed_approvals','reviewed_exports','reviewed_export_state','autofill_outcome_events','reviewed_evaluations','strategy_versions','accounts','candidates','applications','application_runs','candidate_learning_inbox'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS review_runtime_read ON %I',table_name);
    EXECUTE format('CREATE POLICY review_runtime_read ON %I FOR SELECT TO job_hunter_review_runtime USING(true)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['platform_operators','autofill_review_cases','support_review_grants','operator_review_audit','operator_action_receipts','support_review_audit','reviewed_artifacts','reviewed_approvals','reviewed_exports'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS review_runtime_insert ON %I',table_name);
    EXECUTE format('CREATE POLICY review_runtime_insert ON %I FOR INSERT TO job_hunter_review_runtime WITH CHECK(true)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['platform_operators','autofill_review_cases','support_review_grants','reviewed_export_state'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS review_runtime_update ON %I',table_name);
    EXECUTE format('CREATE POLICY review_runtime_update ON %I FOR UPDATE TO job_hunter_review_runtime USING(true) WITH CHECK(true)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['accounts','candidates','applications','application_runs','candidate_learning_inbox'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS review_runtime_no_mutation ON %I',table_name);
    EXECUTE format('CREATE POLICY review_runtime_no_mutation ON %I AS RESTRICTIVE FOR UPDATE TO job_hunter_review_runtime USING(true) WITH CHECK(false)',table_name);
    EXECUTE format('DROP POLICY IF EXISTS review_runtime_lock ON %I',table_name);
    EXECUTE format('CREATE POLICY review_runtime_lock ON %I FOR UPDATE TO job_hunter_review_runtime USING(true) WITH CHECK(true)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['reviewed_artifacts','reviewed_evaluations','strategy_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS review_evaluator_read ON %I',table_name);
    EXECUTE format('CREATE POLICY review_evaluator_read ON %I FOR SELECT TO job_hunter_review_evaluator USING(true)',table_name);
  END LOOP;
END $$;
DROP POLICY IF EXISTS review_evaluator_insert ON reviewed_evaluations;
CREATE POLICY review_evaluator_insert ON reviewed_evaluations FOR INSERT TO job_hunter_review_evaluator WITH CHECK(true);
COMMIT;
