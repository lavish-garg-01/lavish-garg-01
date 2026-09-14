CREATE TABLE admin_configuration (
  kind text NOT NULL CHECK (kind IN ('CANONICAL','REPRESENTATION','PROPOSAL')),
  key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(kind,key)
);
CREATE TABLE admin_workspace_audit (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  reason text NOT NULL,
  revision integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_workspace_audit_recent ON admin_workspace_audit(created_at DESC);
ALTER TABLE admin_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_workspace_audit ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER admin_workspace_audit_immutable BEFORE UPDATE OR DELETE ON admin_workspace_audit
  FOR EACH ROW EXECUTE FUNCTION app_private.reject_operator_audit_mutation();
