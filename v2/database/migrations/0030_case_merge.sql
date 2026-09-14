ALTER TABLE autofill_review_cases ADD COLUMN merged_into uuid REFERENCES autofill_review_cases(id);
ALTER TABLE autofill_review_cases ADD CONSTRAINT review_case_not_self_merged CHECK(merged_into IS NULL OR merged_into<>id);
CREATE INDEX review_case_root ON autofill_review_cases(merged_into);
ALTER TABLE operator_review_audit DROP CONSTRAINT operator_review_audit_action_check;
ALTER TABLE operator_review_audit ADD CONSTRAINT operator_review_audit_action_check CHECK(action IN ('ACCESS_ALLOWED','ACCESS_DENIED','STATUS_CHANGED','ACTION_FAILED','CASE_EDITED','OPERATOR_PROVISIONED','CASE_ASSIGNED','CASE_RELEASED','CASE_MERGED'));
