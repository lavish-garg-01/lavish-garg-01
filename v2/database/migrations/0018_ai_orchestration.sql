-- P budgets are technical USD-micro reservations, separate from S billing.
CREATE TABLE ai_request_reservations (
  reservation_key text PRIMARY KEY CHECK (length(reservation_key) = 64),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  account_id uuid NOT NULL REFERENCES accounts(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  application_id uuid REFERENCES applications(id),
  provider text NOT NULL CHECK (provider IN ('GROQ', 'GEMINI', 'OPENAI')),
  model_profile text NOT NULL,
  task_type text NOT NULL,
  reserved_micros bigint NOT NULL CHECK (reserved_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reservations_daily ON ai_request_reservations (created_at, candidate_id, application_id);
ALTER TABLE ai_request_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_reservations_own_account ON ai_request_reservations
  USING (account_id = app_private.current_account_id())
  WITH CHECK (account_id = app_private.current_account_id());
CREATE FUNCTION reject_ai_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI evidence is append-only'; END;
$$;
CREATE TRIGGER ai_reservations_immutable BEFORE UPDATE OR DELETE ON ai_request_reservations
  FOR EACH ROW EXECUTE FUNCTION reject_ai_evidence_mutation();
ALTER TABLE ai_usage_events ADD COLUMN request_id uuid;
ALTER TABLE ai_usage_events ADD COLUMN candidate_id uuid REFERENCES candidates(id);
ALTER TABLE ai_usage_events ADD COLUMN application_id uuid REFERENCES applications(id);
ALTER TABLE ai_usage_events ADD COLUMN route_policy_version text;
ALTER TABLE ai_usage_events ADD COLUMN task_version integer;
ALTER TABLE ai_usage_events ADD COLUMN schema_version integer;
ALTER TABLE ai_usage_events ADD COLUMN failure_code text;
ALTER TABLE ai_usage_events ADD COLUMN confidence numeric(5,4);
ALTER TABLE ai_usage_events ADD COLUMN cache_status text;
ALTER TABLE ai_usage_events ADD COLUMN reserved_micros bigint CHECK (reserved_micros >= 0);
ALTER TABLE ai_usage_events ADD COLUMN usage_estimated boolean;
ALTER TABLE ai_usage_events ADD COLUMN attempt_index integer;
CREATE UNIQUE INDEX ai_usage_request_attempt ON ai_usage_events (account_id, request_id, attempt_index);
CREATE INDEX ai_usage_task_policy ON ai_usage_events (task_type, route_policy_version, created_at);
CREATE TRIGGER ai_usage_immutable BEFORE UPDATE OR DELETE ON ai_usage_events
  FOR EACH ROW EXECUTE FUNCTION reject_ai_evidence_mutation();
