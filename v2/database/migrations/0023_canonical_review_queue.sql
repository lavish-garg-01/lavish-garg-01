CREATE TABLE canonical_review_queue (
  account_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  descriptor_fingerprint char(64) NOT NULL CHECK (descriptor_fingerprint ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (reason IN ('NEW_CANONICAL_REVIEW','ALIAS_REVIEW')),
  candidate_keys text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','RESOLVED','REJECTED')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(candidate_id,descriptor_fingerprint),
  FOREIGN KEY(candidate_id,account_id) REFERENCES candidates(id,account_id)
);
ALTER TABLE canonical_review_queue ENABLE ROW LEVEL SECURITY;
-- Server-only, explicitly tenant-filtered access. Never candidate values/labels.
