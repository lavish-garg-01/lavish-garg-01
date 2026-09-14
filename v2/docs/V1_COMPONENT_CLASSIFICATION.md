# V1 component classification

## Port behavior and tests

- canonical ontology, normalized-value and shared contract behavior;
- deterministic matching, hard filters, reason/gap/unknown output and lifecycle tests;
- answer policy, scope, freshness and anomaly rules;
- append-only candidate versions, ACID change sets, REVIEW→TRUSTED, Undo/Restore and idempotency semantics;
- neutral correction events and five independent learning layers;
- launch authorization, logical identity, value-free delivery and replay protection;
- independent verification, candidate-wins ownership and final-submit boundary;
- feature flags, kill switches, privacy invariants and golden fixtures.

Port means preserve the invariant in a clean V2 TypeScript owner. It does not imply copying the JavaScript file.

## Reference only

- Express/EJS routers and the existing Next/Sites state provider;
- SQLite connection, schema shape and migrations `0000`–`0020`;
- V1 `content.js`, `background.js`, scanner/executor recipes and server-side Playwright runner;
- V1 candidate-answer repositories that mix policy and SQL;
- current admin screens and draft Supabase SQL until tested against V2;
- current ingestion monolith and process-local operational state.

## Superseded

- `local-user` authentication and hard-coded FREE entitlements;
- browser-local product state as a silent backend fallback;
- a universal learning-rate/scoring mechanism;
- pgvector as the default field-understanding path;
- Form A/Form B runtime branching;
- permanent dual authority or a permanent V1→V2 runtime bridge;
- server-side application automation as a second production path;
- arbitrary remote or AI-generated executable browser behavior;
- automatic final submission.

## Legacy remove only after cutover

- `candidate_answers`, `candidate_fact_memory`, `form_answers` and correction-proposal tables;
- legacy answer authority in `questionResolver.js` and flat answer methods in `copilotRepository.js`;
- `question_mappings`, early `field_mappings` and `application_field_timeline` runtime reads;
- V1 extension/background/content runtime, compatibility adapters, shadow authority and obsolete flags;
- Express/EJS, `better-sqlite3`, legacy local storage and obsolete dependencies after their owning surfaces move.

Database tables are deleted last, after import receipts, zero-read/write telemetry, backup/restore verification and production soak. V1 migration history and test fixtures remain retained artifacts.
