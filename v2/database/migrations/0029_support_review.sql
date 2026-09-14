CREATE TABLE support_review_grants (
  id uuid PRIMARY KEY, request_id uuid NOT NULL, case_id uuid NOT NULL REFERENCES autofill_review_cases(id),
  issuer text NOT NULL, subject text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('DEBUG_AUTOFILL','DEBUG_REPRESENTATION','DEBUG_LEARNING')),
  requested_at timestamptz NOT NULL DEFAULT now(), request_expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  account_id uuid, candidate_id uuid, note_id uuid REFERENCES candidate_learning_inbox(id),
  approved_at timestamptz, expires_at timestamptz, duration_minutes integer CHECK(duration_minutes IN (15,60)), revoked_at timestamptz,
  UNIQUE(issuer,subject,request_id), FOREIGN KEY(issuer,subject) REFERENCES platform_operators(issuer,subject),
  FOREIGN KEY(candidate_id,account_id) REFERENCES candidates(id,account_id),
  CHECK ((approved_at IS NULL AND note_id IS NULL AND account_id IS NULL AND candidate_id IS NULL AND expires_at IS NULL AND duration_minutes IS NULL)
    OR (approved_at IS NOT NULL AND note_id IS NOT NULL AND account_id IS NOT NULL AND candidate_id IS NOT NULL AND expires_at IS NOT NULL AND duration_minutes IS NOT NULL AND expires_at <= approved_at + interval '60 minutes'))
);
CREATE INDEX support_review_note ON support_review_grants(candidate_id,note_id,requested_at DESC);
CREATE TABLE support_review_audit (
  id uuid PRIMARY KEY, grant_id uuid REFERENCES support_review_grants(id),
  actor_kind text NOT NULL CHECK(actor_kind IN ('OPERATOR','CANDIDATE')),
  issuer text, subject text, candidate_id uuid,
  action text NOT NULL CHECK(action IN ('REQUESTED','PREVIEWED','APPROVED','REVOKED','READ','LISTED','DENIED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_kind = 'OPERATOR' AND issuer IS NOT NULL AND subject IS NOT NULL AND candidate_id IS NULL)
    OR (actor_kind = 'CANDIDATE' AND issuer IS NULL AND subject IS NULL AND candidate_id IS NOT NULL))
);
ALTER TABLE support_review_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_review_audit ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER support_review_audit_immutable BEFORE UPDATE OR DELETE ON support_review_audit FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
-- Server-only. HTTP ownership checks remain mandatory; no private payload copies here.
ALTER TABLE autofill_review_cases ADD COLUMN assignee_issuer text;
ALTER TABLE autofill_review_cases ADD COLUMN assignee_subject text;
ALTER TABLE autofill_review_cases ADD CONSTRAINT case_assignee_complete CHECK ((assignee_issuer IS NULL)=(assignee_subject IS NULL));
ALTER TABLE autofill_review_cases ADD CONSTRAINT case_assignee_operator FOREIGN KEY(assignee_issuer,assignee_subject) REFERENCES platform_operators(issuer,subject);
ALTER TABLE operator_review_audit DROP CONSTRAINT operator_review_audit_action_check;
ALTER TABLE operator_review_audit ADD CONSTRAINT operator_review_audit_action_check CHECK(action IN ('ACCESS_ALLOWED','ACCESS_DENIED','STATUS_CHANGED','ACTION_FAILED','CASE_EDITED','OPERATOR_PROVISIONED','CASE_ASSIGNED','CASE_RELEASED'));
