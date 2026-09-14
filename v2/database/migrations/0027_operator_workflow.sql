ALTER TABLE autofill_review_cases ADD COLUMN layer text NOT NULL DEFAULT 'UNASSIGNED' CHECK (layer IN ('UNASSIGNED','SCAN','SEMANTICS','REPRESENTATION','EXECUTION','LEARNING','AUTHORIZATION'));
ALTER TABLE autofill_review_cases ADD COLUMN reproduction text NOT NULL DEFAULT 'NONE' CHECK (reproduction IN ('NONE','ADAPTIVE_AUTOFILL','PRIVATE_NOTE','LEARNING_RECOVERY','OPERATOR_REVIEW'));
ALTER TABLE autofill_review_cases ADD COLUMN expected_behavior text NOT NULL DEFAULT 'UNSPECIFIED' CHECK (expected_behavior IN ('UNSPECIFIED','PRESERVE_CANDIDATE_EDIT','FILL_VERIFIED_VALUE','REQUIRE_CONFIRMATION','REJECT_UNAUTHORIZED_ACCESS','REPLAY_ORIGINAL_RESULT','REPORT_INCOMPLETE_SCAN'));
ALTER TABLE operator_review_audit DROP CONSTRAINT operator_review_audit_action_check;
ALTER TABLE operator_review_audit ADD CONSTRAINT operator_review_audit_action_check CHECK(action IN ('ACCESS_ALLOWED','ACCESS_DENIED','STATUS_CHANGED','ACTION_FAILED','CASE_EDITED','OPERATOR_PROVISIONED'));
ALTER TABLE operator_review_audit ADD COLUMN details jsonb;
CREATE TABLE operator_action_receipts (
  issuer text NOT NULL, subject text NOT NULL, request_id uuid NOT NULL,
  fingerprint char(64) NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(issuer,subject,request_id)
);
ALTER TABLE operator_action_receipts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER operator_action_receipts_immutable BEFORE UPDATE OR DELETE ON operator_action_receipts FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
