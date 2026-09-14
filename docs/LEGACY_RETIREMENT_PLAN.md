# Legacy retirement plan

This plan prevents a refactor or data cleanup from becoming an accidental production cutover. “Legacy” here means the compatibility answer/memory and early field-learning paths that the Parts 1–3 architecture replaces. It does **not** mean SQLite, Express, EJS, Playwright, OpenAI, or the current local dashboard as a whole.

## Current rule

Phase 0G is behavior-preserving. It modularizes the Chrome runtime and locks its behavior; it does not delete a production fallback, dependency, migration, or table.

The candidate-answer resolver remains in `SHADOW_COMPARE`. The versioned path may compare value-free hashes and build candidate-private proposals, but the legacy result remains authoritative until the release gates below pass.

## Inventory and replacement owner

| Legacy item | Current use | Replacement | Retirement point |
| --- | --- | --- | --- |
| `candidate_answers` | flat reusable answers and Profile CRUD | `candidate_answer_versions` plus change/reversal sets | after versioned-primary soak and zero fallback reads |
| `candidate_fact_memory` | flat semantic facts and freshness | scoped/versioned candidate truth | after all safe rows have a terminal migration receipt |
| `form_answers` | embedding-backed reusable question/answer memory | canonical meaning + scoped candidate truth + representation rules | stop writes at CANARY; drop after primary soak |
| `candidate_fact_correction_proposals` | old correction proposal path | neutral observations + runtime proposals + verified change sets | after classifier/change-set parity is locked |
| legacy answer portions of `questionResolver.js` | profile/flat-memory answer authority | `fieldAnswerContractService` + `candidateAnswerResolver` | after `VERSIONED_PRIMARY`; retain only extracted normalization/AI-writing helpers that still have an owner |
| candidate-answer methods in `copilotRepository.js` | list/save/delete flat answers | versioned Profile/history services | after frontend/API callers use versioned endpoints |
| `question_mappings` | migration source for Part 1 | `field_semantic_mappings` | freeze now; remove after no runtime reads and migration verification |
| `field_mappings` / `agentRepository` field-map methods | early per-site field mapping | field semantic registry + mapping packs | after Phase 3D packaged-strategy cutover |
| `application_field_timeline` | older learning/reliability timeline | field revisions, edit sessions, checkpoints, operation receipts | after Phase 3B consumers and reports move to the new timeline |

`candidate_profiles` is **not scheduled for deletion**. It remains the onboarding/product-profile read model while `candidate_answer_versions` owns reusable scoped truth. It may later become a projection, but deleting it during Parts 1–3 would mix an API redesign into the learning cutover.

Ordered migration files and migration receipts are history. They remain in source even after their runtime bridge is removed, so a fresh or old database can still migrate forward deterministically.

## Release gates and sequence

### R0 — SHADOW compatibility (current)

- Phase 0G behavior locks pass under Node 24.
- Legacy writes remain available only where the product still depends on them.
- Versioned output cannot silently replace a legacy answer.
- Add counters for legacy read, write, fallback, mismatch, and migration-skip reasons before CANARY.

### R1 — Complete the new answer path

Required work: Phase 2D representation resolution and the verified browser-outcome gate in Phase 3B.

- Candidate truth, representation, browser interaction, and acceptance are attributed independently.
- Unsupported/ambiguous representations fail to user review.
- The existing CANARY gate passes: at least 100 shadow comparisons, at least 98% agreement, zero value mismatches, and zero unsafe versioned selections.

Only then may the operator move from `SHADOW_COMPARE` to `CANARY`.

### R2 — CANARY and stop dual writing

- Roll through 1%, 5%, then 10% of deterministic low-risk selections.
- Any protected-control mutation, cross-scope reuse, unexplained overwrite, or critical mismatch immediately returns the resolver to SHADOW.
- Once CANARY is stable, stop new writes to `form_answers` and other replaced flat-memory paths. Keep read fallback and migration diagnostics.
- Require at least 500 verified versioned selections before requesting `VERSIONED_PRIMARY`.

### R3 — VERSIONED_PRIMARY with read-only fallback

- Versioned candidate truth becomes authoritative.
- Legacy tables are read-only and used only by an instrumented emergency fallback.
- Run at least two release cycles and 14 production days with zero critical mismatch, zero unsafe selection, and zero unexplained fallback. Before real production traffic exists, two complete owned-fixture/certification cycles substitute for time, but deletion still waits for production soak.

### R4 — Remove runtime code and direct dependencies

- Remove flat-memory reads/writes from `questionResolver.js`, routes, `applicationEngine.js`, and `copilotRepository.js`.
- Remove obsolete correction/field-map repository methods only after their caller count is zero.
- Keep `better-sqlite3`: it is the active local persistence engine, not a legacy dependency. Remove it only after a separate, verified Supabase/Postgres deployment migration.
- Keep `openai`: paid writing/canonicalization still uses it. Free matching remains deterministic.
- Keep EJS until the old dashboard/API surface is explicitly retired; the extension behavior-lock harness currently exercises it.
- Keep Playwright and `pdfjs-dist` for browser fixtures and document verification.

### R5 — Remove tables safely

Create a forward-only cleanup migration after R4:

1. verify every eligible legacy row has a terminal migration receipt (`MIGRATED`, `SKIPPED_WITH_REASON`, or `SUPERSEDED`);
2. verify runtime read/write/fallback counters are zero;
3. create an encrypted rollback backup and record its checksum;
4. remove sensitive duplicate tables from the live database after the 30-day rollback window (earlier on explicit candidate deletion);
5. retain only value-free migration/parity audit data according to the product retention policy;
6. run fresh-database, upgraded-database, rollback, privacy, and full acceptance tests.

The first tables expected to drop are `form_answers`, `candidate_answers`, and `candidate_fact_memory`. `candidate_fact_correction_proposals`, `question_mappings`, `field_mappings`, and `application_field_timeline` follow only when their later-phase consumers have moved.

## Hard deletion blockers

Do not remove a path or table while any of these are true:

- `candidateAnswerResolverReleaseGates` still reports `VERIFIED_BROWSER_OUTCOME_GATE_NOT_IMPLEMENTED`;
- a production route imports the legacy repository/service;
- a migration item has no terminal result;
- CANARY or primary diagnostics contain a value mismatch or unsafe selection;
- the emergency fallback counter is non-zero during the soak window;
- the backup/restore drill has not passed;
- Supabase/Postgres RLS is being assumed rather than tested against a real deployment.

## Immediate next coding phase

With Phase 0G complete, implement Phase 2D. Do not delete legacy answer code during Phase 2D. The first deletion change belongs after Phase 3B supplies verified browser outcomes and the staged resolver has passed SHADOW → CANARY → VERSIONED_PRIMARY.
