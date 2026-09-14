ALTER TABLE candidate_learning_note_confirmations DROP CONSTRAINT candidate_learning_note_confirmations_canonical_key_check;
ALTER TABLE candidate_learning_note_confirmations ADD CONSTRAINT candidate_learning_note_confirmations_canonical_key_check CHECK (canonical_key IN ('FIRST_NAME','LAST_NAME','FULL_NAME','EMAIL','CURRENT_LOCATION','LINKEDIN_URL','GITHUB_URL','PORTFOLIO_URL','CURRENT_CTC','EXPECTED_CTC','NOTICE_PERIOD','TOTAL_EXPERIENCE','LAST_WORKING_DAY'));
CREATE INDEX candidate_learning_inbox_page ON candidate_learning_inbox(account_id,candidate_id,created_at DESC,id DESC);
CREATE INDEX candidate_learning_inbox_expiry ON candidate_learning_inbox(expires_at,id) WHERE payload IS NOT NULL;
