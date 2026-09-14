CREATE TABLE reviewed_artifacts (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES autofill_review_cases(id),
  issuer text NOT NULL, subject text NOT NULL, strategy_key text NOT NULL,
  definition_hash char(64) NOT NULL, artifact_hash char(64) NOT NULL,
  api_protocol integer NOT NULL CHECK(api_protocol=1), extension_protocol integer NOT NULL CHECK(extension_protocol=1),
  created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(issuer,subject) REFERENCES platform_operators(issuer,subject)
);
CREATE TABLE reviewed_evaluations (
  id uuid PRIMARY KEY, artifact_id uuid NOT NULL REFERENCES reviewed_artifacts(id),
  artifact_hash char(64) NOT NULL, suite_hash char(64) NOT NULL, result_hash char(64) NOT NULL,
  passed boolean NOT NULL, evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
  outcome text NOT NULL CHECK(outcome IN ('PASSED','FAILED_OR_UNSUPPORTED'))
);
CREATE TABLE reviewed_approvals (
  id uuid PRIMARY KEY, artifact_id uuid NOT NULL REFERENCES reviewed_artifacts(id),
  evaluation_id uuid NOT NULL REFERENCES reviewed_evaluations(id), artifact_hash char(64) NOT NULL,
  issuer text NOT NULL, subject text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(issuer,subject) REFERENCES platform_operators(issuer,subject)
);
CREATE TABLE reviewed_exports (
  id uuid PRIMARY KEY, artifact_id uuid NOT NULL REFERENCES reviewed_artifacts(id), evaluation_id uuid NOT NULL REFERENCES reviewed_evaluations(id),
  approval_id uuid NOT NULL REFERENCES reviewed_approvals(id), previous_id uuid REFERENCES reviewed_exports(id),
  issuer text NOT NULL, subject text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(issuer,subject) REFERENCES platform_operators(issuer,subject)
);
CREATE TABLE reviewed_export_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), revision integer NOT NULL DEFAULT 1,
  current_id uuid REFERENCES reviewed_exports(id), disabled boolean NOT NULL DEFAULT true
);
INSERT INTO reviewed_export_state(singleton) VALUES(true);
ALTER TABLE reviewed_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewed_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewed_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewed_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewed_export_state ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER reviewed_artifact_immutable BEFORE UPDATE OR DELETE ON reviewed_artifacts FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
CREATE TRIGGER reviewed_evaluation_immutable BEFORE UPDATE OR DELETE ON reviewed_evaluations FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
CREATE TRIGGER reviewed_approval_immutable BEFORE UPDATE OR DELETE ON reviewed_approvals FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
CREATE TRIGGER reviewed_export_immutable BEFORE UPDATE OR DELETE ON reviewed_exports FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
ALTER TABLE operator_review_audit DROP CONSTRAINT operator_review_audit_action_check;
ALTER TABLE operator_review_audit ADD CONSTRAINT operator_review_audit_action_check CHECK(action IN ('ACCESS_ALLOWED','ACCESS_DENIED','STATUS_CHANGED','ACTION_FAILED','CASE_EDITED','OPERATOR_PROVISIONED','CASE_ASSIGNED','CASE_RELEASED','CASE_MERGED','ARTIFACT_PROPOSED','ARTIFACT_APPROVED','EXPORT_PREPARED','EXPORT_DISABLED','EXPORT_ROLLED_BACK'));
