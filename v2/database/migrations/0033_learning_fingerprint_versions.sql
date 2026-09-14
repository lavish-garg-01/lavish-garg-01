-- Legacy rows have no trustworthy version metadata. Do not guess/backfill a key version.
ALTER TABLE candidate_learning_inbox ADD COLUMN fingerprint_key_version integer CHECK (fingerprint_key_version > 0);
ALTER TABLE candidate_learning_note_confirmations ADD COLUMN fingerprint_key_version integer CHECK (fingerprint_key_version > 0);

CREATE FUNCTION guard_learning_note_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Learning note identity must be retained as a tombstone'; END IF;
  IF ROW(NEW.id,NEW.account_id,NEW.candidate_id,NEW.application_id,NEW.run_id,NEW.fingerprint,NEW.fingerprint_key_version,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.account_id,OLD.candidate_id,OLD.application_id,OLD.run_id,OLD.fingerprint,OLD.fingerprint_key_version,OLD.created_at)
     OR NEW.expires_at > OLD.expires_at
     OR (OLD.status = 'DELETED' AND NEW.status <> 'DELETED')
     OR (NEW.status = 'DELETED' AND NEW.payload IS NOT NULL)
     OR (NEW.payload IS NOT NULL AND NEW.payload IS DISTINCT FROM OLD.payload)
  THEN RAISE EXCEPTION 'Learning note identity is immutable; only deletion or retention shortening is allowed'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER learning_note_identity_guard BEFORE UPDATE OR DELETE ON candidate_learning_inbox FOR EACH ROW EXECUTE FUNCTION guard_learning_note_identity();

CREATE FUNCTION guard_learning_note_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Learning note confirmation is append-only'; END;
$$;
CREATE TRIGGER learning_note_confirmation_guard BEFORE UPDATE OR DELETE ON candidate_learning_note_confirmations FOR EACH ROW EXECUTE FUNCTION guard_learning_note_confirmation();
