CREATE TABLE platform_operators (
  issuer text NOT NULL, subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('REVIEWER','ADMIN')),
  active boolean NOT NULL DEFAULT false,
  PRIMARY KEY(issuer,subject)
);
CREATE TABLE autofill_review_cases (
  id uuid PRIMARY KEY,
  release text NOT NULL, stage text NOT NULL, code text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED','DISMISSED')),
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(release,stage,code)
);
CREATE TABLE operator_review_audit (
  id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  action text NOT NULL CHECK (action IN ('ACCESS_ALLOWED','ACCESS_DENIED','STATUS_CHANGED')),
  case_id uuid REFERENCES autofill_review_cases(id),
  request_id uuid, from_revision integer, to_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issuer,subject,request_id)
);
ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_review_audit ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION app_private.reject_operator_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operator audit is append-only'; END;
$$;
CREATE TRIGGER operator_audit_immutable BEFORE UPDATE OR DELETE ON operator_review_audit FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
-- Explicit server-only provisioning; zero default operators and zero candidate grants.
