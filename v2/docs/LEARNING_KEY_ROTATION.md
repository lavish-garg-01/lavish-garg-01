# Learning replay and fingerprint-key history — checkpoint 14

This implements bounded historical verification for **learning notes, note-confirmation receipts, observation retries and pending verified-learning checkpoints**. It is not a universal key-rotation facility for the entire project. No live key, database or operator setting was changed during implementation.

## Configuration and activation

Apply normal migrations through **0033_learning_fingerprint_versions**, then rebuild/restart the API. This batch requires no web or extension protocol change. Existing installations keep version 1 and their existing secret by default.

- `CANDIDATE_VALUE_HMAC_SECRET`: active secret; at least 32 bytes. All new fingerprints use this key.
- `CANDIDATE_VALUE_HMAC_KEY_VERSION`: active positive integer, default 1.
- `CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS`: optional JSON array of `{ "keyVersion": 1, "secret": "..." }` entries, supplied through trusted secret management. At most four distinct versions, strictly below the active version, each with a distinct secret of at least 32 bytes. Do not commit real keys.

Retained keys are verification-only. They never become the signing key for a new note, receipt or learned answer. Configuration failures produce fixed validation messages rather than serializing malformed secret JSON. Keys are not configurable through candidate or operator web endpoints.

**Do not rotate the shared project secret solely because this feature exists.** The same secret still participates in AI cache fingerprints and strategy signing. Onboarding/resume/import and direct Candidate Truth idempotency paths are not all historical-key-aware. Outstanding workflows and signed artifacts need their own coordinated rotation/invalidation plan. Ciphertext encryption uses a separate key/version lifecycle; retaining an HMAC key does not restore a missing decryption key. Separation of these cryptographic domains remains follow-up work.

## Read-only readiness check

`npm run learning:keys:check` validates the API configuration and reads only aggregate key-version metadata. It prints counts grouped by note evidence/tombstones, note receipts and unexpired recorded observations. It does not select private note payloads, digests, answers, candidate identities or secrets, and does not migrate, rotate or rewrite anything.

- `KNOWN_VERSIONS_CONFIGURED`: all reported version numbers are configured. This checks availability metadata, not whether each secret is the correct historical secret or whether the wider system is rotation-ready.
- `MISSING_HISTORICAL_KEYS`: at least one recorded version is unavailable.
- `LEGACY_REVIEW_REQUIRED`: legacy records lack version metadata; coverage cannot be certified from counts alone.

Exit 0 means known versions are configured; exit 2 means missing/unversioned coverage requires review; exit 1 means configuration/query failed. This is a trusted maintenance command, not a candidate-facing API. It has not been run against the live database.

## Recovery behavior

New notes and confirmations persist their fingerprint version. Pre-0033 records remain NULL: migration does not guess the former version or relabel old hashes. Exact replay of an unversioned row checks only the configured bounded key set. Versioned rows require the exact recorded version. A changed value, changed confirmation, wrong key or missing required key does not authorize a write. Exact historical replay returns the original identity/change-set receipt without extending retention or updating its fingerprint.

Observation retry computes candidate request hashes using configured keys internally; callers cannot supply accepted historical hashes. Pending checkpoints verify the stored value with its recorded key version. If that version is missing, checkpoint processing raises a recoverable conflict **before finalization**. The production transaction rolls back checkpoint authority, truth and observation status; after restoring the correct key, the original checkpoint can be retried. A digest mismatch with an available key still fails verification and is skipped under the existing integrity policy, never promoted to truth.

Successful historical observations are saved using the active fingerprint key. Existing ownership, semantic authority, submission evidence, scope/entity and expected-current-version checks remain. Exact finalized checkpoints retain their original replay results. Already consumed/skipped observations or historical partial states created by older implementations are not automatically revived by this batch.

## Expiry, receipts and privacy

Confirmation now rechecks wall-clock availability after acquiring the note lock and again after Candidate Truth writes. If evidence expires during a wait/write, the entire transaction rolls back. Exact replay of an already committed receipt remains possible after evidence deletion; replay does not need to resurrect the note.

Database guards preserve note owner/application/run, fingerprint/version and creation identity, forbid extending expiry or resurrecting erased/replaced payloads, and retain tombstones. Deletion and shortening retention remain allowed. Confirmation receipts reject updates/deletes. These guards protect ordinary SQL mutations, not a database owner deliberately dropping triggers. Future ciphertext rotation or complete metadata erasure needs an explicit migration/retention design; do not disable guards as a routine workaround.

Candidate note reads now validate decrypted evidence and return a constant error for malformed/unreadable payloads. Parser excerpts and ciphertext errors do not escape through this repository. This is not a claim of complete correlated HTTP failure auditing.

## Evidence and remaining boundaries

Synthetic tests cover version-bound verification, malformed/duplicate/future key configuration, NULL-version legacy receipts, changed/foreign retries, missing keys, active-version new writes, immutable tombstones, expiry, receipt-write rollback, safe parse errors, aggregate readiness, observation retry after rotation, and verified learning/undo with retained old keys. Existing grouped-checkpoint crash tests run both with and without rotation; missing-key checkpoints preserve both observations for retry.

Disposable PostgreSQL tests cover expiry after a two-connection row-lock wait and expiry during a delayed truth insert, asserting no surviving answer versions; old-key note replay, active-key confirmation and post-deletion receipt replay also pass. Existing restricted review roles, positive/negative Chromium strategy evaluation and twenty-application deterministic reuse remain tested. None of this proves installed-extension coverage, general model learning, perfect extraction or live employer accuracy.
