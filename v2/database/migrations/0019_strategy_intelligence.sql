-- Q extends the existing strategy definition authority. Legacy status is seed metadata;
-- pattern-specific active lifecycle/order lives only in strategy_policy_clusters.
ALTER TABLE strategy_versions ADD COLUMN q_definition jsonb;
CREATE TABLE strategy_policy_clusters (
  cluster text PRIMARY KEY CHECK (cluster ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE strategy_policy_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cluster text NOT NULL REFERENCES strategy_policy_clusters(cluster),
  idempotency_key text NOT NULL,
  command_fingerprint text NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  revision integer NOT NULL,
  state jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster, idempotency_key), UNIQUE(cluster, revision)
);
-- Server-bound plan metadata authenticates scope, version and assignment before receipt ingestion.
CREATE TABLE strategy_execution_bindings (
  operation_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id), candidate_id uuid NOT NULL REFERENCES candidates(id),
  run_id uuid NOT NULL REFERENCES application_runs(id),
  cluster text NOT NULL REFERENCES strategy_policy_clusters(cluster),
  binding jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE strategy_performance_evidence (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-f0-9]{64}$'),
  operation_id uuid NOT NULL REFERENCES strategy_execution_bindings(operation_id),
  account_id uuid NOT NULL REFERENCES accounts(id), candidate_id uuid NOT NULL REFERENCES candidates(id),
  cluster text NOT NULL REFERENCES strategy_policy_clusters(cluster),
  strategy_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  evidence jsonb NOT NULL
);
CREATE INDEX strategy_evidence_cluster_time ON strategy_performance_evidence(cluster, occurred_at);
CREATE FUNCTION reject_q_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Q strategy history is append-only'; END;
$$;
CREATE TRIGGER q_definitions_immutable BEFORE UPDATE OR DELETE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION reject_q_history_mutation();
CREATE TRIGGER q_transitions_immutable BEFORE UPDATE OR DELETE ON strategy_policy_transitions
  FOR EACH ROW EXECUTE FUNCTION reject_q_history_mutation();
CREATE TRIGGER q_bindings_immutable BEFORE UPDATE OR DELETE ON strategy_execution_bindings
  FOR EACH ROW EXECUTE FUNCTION reject_q_history_mutation();
CREATE TRIGGER q_evidence_immutable BEFORE UPDATE OR DELETE ON strategy_performance_evidence
  FOR EACH ROW EXECUTE FUNCTION reject_q_history_mutation();
-- Global policy/definitions are service-only (no direct client RLS policy).
ALTER TABLE strategy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_policy_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_policy_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_execution_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_performance_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY q_bindings_account ON strategy_execution_bindings
  USING (account_id = app_private.current_account_id()) WITH CHECK (account_id = app_private.current_account_id());
CREATE POLICY q_evidence_account ON strategy_performance_evidence
  USING (account_id = app_private.current_account_id()) WITH CHECK (account_id = app_private.current_account_id());
