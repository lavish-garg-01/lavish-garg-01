ALTER TABLE candidate_answer_change_sets
  ADD COLUMN request_fingerprint text NOT NULL,
  ADD CONSTRAINT candidate_answer_change_sets_request_fingerprint_check
    CHECK (length(request_fingerprint) = 64);

ALTER TABLE candidate_answer_versions
  ADD COLUMN date_precision text,
  ADD CONSTRAINT candidate_answer_versions_date_precision_check
    CHECK (
      (value_type = 'DATE' AND date_precision IN ('DAY', 'MONTH', 'YEAR'))
      OR (value_type <> 'DATE' AND date_precision IS NULL)
    ),
  ADD CONSTRAINT candidate_answer_versions_trusted_confirmation_check
    CHECK (trust_state <> 'TRUSTED' OR confirmed_at IS NOT NULL);
