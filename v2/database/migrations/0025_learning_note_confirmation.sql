CREATE TABLE candidate_learning_note_confirmations (
  item_id uuid PRIMARY KEY REFERENCES candidate_learning_inbox(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  request_fingerprint char(64) NOT NULL,
  change_set_id uuid NOT NULL REFERENCES candidate_answer_change_sets(id),
  canonical_key text NOT NULL CHECK (canonical_key IN ('FIRST_NAME','LAST_NAME','FULL_NAME','EMAIL','CURRENT_LOCATION')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE candidate_learning_note_confirmations ENABLE ROW LEVEL SECURITY;
-- Server-owned receipts; no candidate or operator direct access.
