# Candidate answer recovery — checkpoint 14

This is explicit candidate review, not automatic truth promotion. Unknown notes remain private until the candidate maps the note to a supported field, previews the value and confirms it. Application-specific overrides still take precedence over these global defaults.

## Supported review mappings

- Text: FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, CURRENT_LOCATION.
- Professional links: LINKEDIN_URL, GITHUB_URL, PORTFOLIO_URL. Require a full HTTP(S) URL; embedded credentials and unsafe schemes reject.
- Salary: CURRENT_CTC, EXPECTED_CTC. Require numeric `answer`, explicit ISO `currency`, `scale` BASE/LAKH/CRORE and `period` YEAR/MONTH. Lakh/crore require INR. Exact decimal scaling preserves precision: 14 LAKH, 0.14 CRORE and 1400000 BASE become 1400000 INR with the selected period. The server does not guess units from the original note.
- Notice: NOTICE_PERIOD requires integer `answer` and `unit: DAYS`, within 0–3650. It is not converted into a joining date.
- Experience: TOTAL_EXPERIENCE requires integer `answer` and `unit: MONTHS`, within 0–1200. Preview shows both years/months and total months; no rounded years or ranges.
- Last working day: LAST_WORKING_DAY requires an explicit valid YYYY-MM-DD date. No inference from notice or offer date.

Three additional existing canonical fields now support explicit original-application review: START_DATE (valid YYYY-MM-DD, never inferred from notice), WORK_MODE_REQUIREMENT (explicit YES/NO), and HEARING_SOURCE (allowlisted source or OTHER with a reviewed label). These require `scope: APPLICATION` and `confirmedGlobalDefault: false`. LAST_WORKING_DAY can use either scope. The server derives the original application from the owned note; caller-supplied application IDs reject. These are four bounded mappings, not generic context/entity inference. Existing global profile fallback remains unchanged; an application override takes precedence.

All confirmation requests require `expectedCurrentVersionId` (UUID or null). The original thirteen mappings default to GLOBAL with `confirmedGlobalDefault: true`; scope and confirmation must agree. Consent and entity history are not supported here. No new canonical fields are activated by notes.

## Review and replay

`POST /v1/learning/inbox/:itemId/preview` uses the same strict schema and value converter as `/confirm`. It authenticates ownership and current note availability, returns a private no-store preview, and never writes Candidate Truth. The server returns the exact target scope's current value/version, derived application and normalized replacement. The UI freezes that reviewed input; changing value, units or scope invalidates preview. Confirmation rechecks ownership, note availability and expected truth version. A stale version rejects without overwriting newer truth.

Truth mutation and confirmation receipt remain in one transaction. Exact successful replay returns the original change-set link, including after note deletion; it never recreates a note or writes the answer again. A changed confirmation for the same note conflicts. Deleting or expiring raw evidence does not undo an already saved profile answer; Profile history is the undo path. Checkpoint 14 adds bounded historical HMAC verification, explicit key-version storage, immutable receipts/tombstones and wall-clock expiry checks after lock acquisition and truth writes. See [key history and operational limits](LEARNING_KEY_ROTATION.md); missing keys never authorize an overwrite.

## Pagination and retention

`GET /v1/learning/inbox?limit=50&cursor=<last-item-uuid>` returns `items` and `nextCursor` (null at the end). Limit is 1–100, default 50. Stable descending `(created_at,id)` pagination uses the database timestamp without precision loss. Cursor ownership is checked, and deleted/expired tombstones can still serve as cursors. This is not a frozen snapshot: newly saved notes appear on refresh. The Attention UI loads older pages and deduplicates IDs; access failures clear displayed private notes.

Owner list/capture activity clears expired ciphertext for that owner. Confirmed notes no longer consume the 200-pending-note allowance. Expiry and deletion preserve value-free identity/replay metadata but remove raw question/answer payloads; saved Candidate Truth is unaffected.

Idle candidates need maintenance: `npm run learning:cleanup` uses the existing protected DATABASE_URL, removes **expired ciphertext only**, and prints counts, never payloads. Each invocation runs at most ten batches of 1000 with row locks/skip-locked behavior. Run it repeatedly from trusted maintenance tooling (for example hourly) until backlog clears. **It was not run against live data or scheduled during implementation.** No new candidate-facing cleanup/admin endpoint exists. This does not purge historical backups, confirmation fingerprints or all metadata.

## Activation and remaining limits

Apply normal migrations through **0033_learning_fingerprint_versions**, then rebuild/restart the API. If upgrading from before checkpoint 13, update web and extension as well and reload application tabs. No live migration, installed-extension replacement, key rotation or profile changes were made during implementation. Configure maintenance separately.

Checkpoint 10 adds bounded diagnostic retry/drop counts and consented session-memory private-note retries across page/worker reloads; see [extension delivery](EXTENSION_DELIVERY.md). Browser shutdown recovery for private notes remains absent. Operator private grants and reviewed strategy exports were implemented in checkpoints 11/12; exports are not runtime deployment. Still pending: general entity/context mapping, historical checkpoint/HMAC reconciliation and complete field-origin/commitment receipts.

`npm run test:learning:journey` always uses fresh in-memory PGlite, never DATABASE_URL. The same corpus runs in disposable PostgreSQL via `npm run test:review:postgres`. Twenty chronological synthetic applications compare explicit confirmations after application 1 against an unchanged empty-profile control: 57 correct representations, zero wrong, 23 abstentions across 80 questions, versus zero baseline answers. Twelve fixed wordings cover CTC scale/period, experience units, notice wording and no cross-application dates. This is production repository/semantic/representation reuse evidence, not DOM completion, model training, independent held-out accuracy or employer certification.
