# V2 Plan 1–3 reconciliation ledger

This ledger prevents historical work from disappearing during the V2 rebuild. Dispositions are `PORT`, `REIMPLEMENT`, `COMPLETE_IN_V2`, `TEST_ONLY`, `DEFER`, `SUPERSEDED`, or `LEGACY_REMOVE`.

Locks: `BASE` baseline/build; `SEM` semantics; `CAT` candidate truth; `TIM` timeline/classifier; `PROTO` launch/outbox; `EXT` extension/browser; `MATCH` jobs/matching; `APP` application; `DOC` documents; `PRIV` privacy; `OPS` operations.

Deletion: `Z-platform`, `Z-candidate`, `Z-extension`, and `Z-jobs` mean only after the corresponding V2 authority, zero V1 reads/writes, migration receipts and soak. `retain` means keep as a fixture, ADR, test, or migration artifact.

## Cross-cutting Phase 0 and Part 1 semantics

| Original | Task / current owner | Current status | V2 disposition | Phase | Lock | Deletion |
| --- | --- | --- | --- | --- | --- | --- |
| F0.0 | Node 24 baseline and behavior freeze | Complete | TEST_ONLY | A | BASE | retain |
| F0A | Neutral correction and authorization policy | Complete | PORT | B/E/P | CAT/PRIV | retain ADR |
| F0B | Eight shared contract families | Complete V1 | PORT | B/J | SEM/CAT | old JS after parity |
| F0C | Neutral events and five-layer classifier | SHADOW complete | PORT | M/R | TIM | Z-extension |
| F0D | Launch handshake, versioning, logical identity | Local complete | REIMPLEMENT | I | PROTO | Z-extension |
| F0E | Value-free outbox, ACK, retry, idempotency | Local complete | REIMPLEMENT | C/I | PROTO/PRIV | Z-extension |
| F0F | Adaptive evidence kernel | SHADOW complete | DEFER | R | TIM | retain replays |
| F0G | V1 extension seams | Behavior-locked | REIMPLEMENT | I/L | EXT | Z-extension |
| S1.0 | Semantic baseline | Complete | TEST_ONLY | A | SEM | retain |
| S1.1 | Value-free FieldDescriptor | Complete V1 | PORT | J | SEM/PRIV | after J parity |
| S1.2 | Manual-interaction semantic rescue | Coupled V1 | REIMPLEMENT | I/J | EXT/SEM | Z-extension |
| S1.3 | Canonical registry/lifecycle/evidence | Complete V1 | PORT | C/E/J | SEM | V1 migrations retain |
| S1.4 | Single canonical resolver | Complete V1 | PORT | J | SEM | after J parity |
| S1.5 | Context-aware deterministic candidates | Complete V1 | PORT | J | SEM | after J parity |
| S1.6 | Semantic retrieval seam | Implemented | DEFER | Q if measured | SEM | Z-platform |
| S1.7 | Progressive structured AI fallback | Implemented V1 | PORT | J/Q | SEM/PRIV | old provider path after Q |
| S1.8 | Layer-specific semantic evidence | SHADOW complete | PORT | J/R | SEM/TIM | Z-platform |
| S1.9 | Canonical proposals/deduplication | Implemented V1 | PORT | J/U | SEM/OPS | old admin after U |
| S1.10 | Attention integration | Implemented V1 | PORT | G/J/M | APP | old runtime after cutover |
| S1.11 | Semantic admin/operations | Local prototype | REIMPLEMENT | U | SEM/OPS | Z-platform |
| S1.12 | Certification/privacy corpus | Complete | TEST_ONLY | A/J/V | SEM/EXT/PRIV | retain |

## Plan 1 — production foundation

| Original | Task / current owner | Current status | V2 disposition | Phase | Lock | Deletion |
| --- | --- | --- | --- | --- | --- | --- |
| P1.1 | Domain separation | Structurally partial | REIMPLEMENT | B | BASE | Z-platform |
| P1.2 | Backend shell and route boundaries | Functional Express legacy | REIMPLEMENT | B | BASE/APP | Z-platform |
| P1.3 | Database migration guarantees | Strong V1, legacy schema | REIMPLEMENT | C | BASE | retain V1 migration history |
| P1.4 | Supabase/Postgres portability | Contract only | REIMPLEMENT | C/D/W | PRIV | Z-platform |
| P1.5 | RLS/private data | Draft, not live verified | COMPLETE_IN_V2 | C/D/W | PRIV | live verification required |
| P1.6 | Accounts/auth/memberships | Local-user stub | REIMPLEMENT | D | PRIV | Z-platform |
| P1.7 | Resume/document storage | Local files/SQLite | REIMPLEMENT | G/S | DOC/PRIV | after object migration |
| P1.8 | Candidate profile authority | Competing V1 reads | REIMPLEMENT | E/G | CAT | Z-candidate |
| P1.9 | Job ingestion/catalog | Partial useful V1 | REIMPLEMENT | H | MATCH | Z-jobs |
| P1.10 | Deterministic matching policy | Substantially complete | PORT | H | MATCH | Z-jobs |
| P1.11 | Durable application state | Partial V1 | REIMPLEMENT | C/I/M/O | APP/PROTO | Z-extension |
| P1.12 | Website-extension handshake | Local complete | REIMPLEMENT | I | PROTO | Z-extension |
| P1.13 | Billing/entitlements | Prototype/hard-coded | REIMPLEMENT | D/T | OPS | replace at T |
| P1.14 | Product analytics | Partial | REIMPLEMENT | B/U/X | PRIV/OPS | after U |
| P1.15 | Structured observability | Partial admin health | REIMPLEMENT | B/U/W | OPS | after U/W |
| P1.16 | Flags and kill switches | Useful concept | PORT | B/U | OPS | Z-platform |
| P1.17 | Launch security/privacy | Production incomplete | COMPLETE_IN_V2 | B/C/D/W | PRIV/PROTO | Phase W required |
| P1.18 | Environment separation | Pending production | REIMPLEMENT | B/W | BASE | Z-platform |
| P1.19 | CI/engineering quality | Strong tests, incomplete lint/types | PORT | A/B/W | BASE | retain corpus |

## Plan 2 — candidate-answer intelligence

| Original | Task / current owner | Current status | V2 disposition | Phase | Lock | Deletion |
| --- | --- | --- | --- | --- | --- | --- |
| P2.1 | Candidate truth vs application truth | Foundation implemented | PORT | E/M/P | CAT | Z-candidate |
| P2.2 | Answer classes/policy axes | Partial coverage | PORT | E | CAT | Z-candidate |
| P2.3 | Canonical ontology | Implemented | PORT | E/J | SEM | after import |
| P2.4 | Compact progressive AI context | Implemented V1 | PORT | J/Q | SEM/PRIV | after Q |
| P2.5 | FieldAnswerContract | SHADOW foundation | PORT | J | CAT/SEM | Z-candidate |
| P2.6 | Option-discovery handshake | Partial | COMPLETE_IN_V2 | J/K | EXT | Z-extension |
| P2.7 | Normalized value contract | Implemented | PORT | E/J | CAT | after parity |
| P2.8 | Scope precedence/conflicts | Foundation implemented | PORT | E | CAT | Z-candidate |
| P2.9 | Append-only answer versions | Implemented V1 | PORT | E | CAT | Z-candidate |
| P2.10 | Maintained current projection | Missing in V1 | REIMPLEMENT | C/E | CAT | old latest-row reads after E |
| P2.11 | Atomic change sets | Implemented | PORT | E/M | CAT | Z-candidate |
| P2.12 | Undo | Implemented | PORT | E/G/M | CAT | Z-candidate |
| P2.13 | Restore | Implemented | PORT | E/G | CAT | Z-candidate |
| P2.14 | Scoped REVIEW→TRUSTED | Implemented | PORT | E/M | CAT | Z-candidate |
| P2.15 | Runtime answer proposals | Implemented local | PORT | M | CAT/TIM | Z-candidate |
| P2.16 | Verified/explicit commit boundary | Policy implemented | PORT | M | TIM/CAT | Z-candidate |
| P2.17 | Updated-for-next-time summary | Local UI | PORT | G/M | CAT/EXT | old UI after M |
| P2.18 | Consequential grouped review | Partial | COMPLETE_IN_V2 | G/M | CAT/PRIV | old review after M |
| P2.19 | Runtime legacy migration bridge | Superseded by complete one-time F1–F4 importer; no runtime bridge | SUPERSEDED | F importer complete | CAT | remove at Z-candidate |
| P2.20 | +1/-2 evidence | Diagnostic only | PORT | E/R | TIM | direct scoring removed |
| P2.21 | Independent evidence layers | SHADOW complete | PORT | E/K/L/R | TIM | Z-candidate/extension |
| P2.22 | One global learning rate | Rejected | SUPERSEDED | R per-layer | TIM | no V2 equivalent |
| P2.23 | Freshness | Implemented/partial | PORT | E | CAT | Z-candidate |
| P2.24 | Anomaly detection | Implemented/partial | PORT | E/M | CAT | Z-candidate |
| P2.25 | Representation learning | Pending | REIMPLEMENT | K | new properties | n/a |
| P2.26 | Repeatable stable entity binding | Pending | REIMPLEMENT | N | EXT/CAT | old recipes after N/V |
| P2.27 | Revision/edit timelines | Partial foundation | REIMPLEMENT | M | TIM | old timeline after M |
| P2.28 | Declaration authorization | Contract only | REIMPLEMENT | P | PRIV/EXT | old protected path after P |
| P2.29 | pgvector-first retrieval | Not required | DEFER | measured need | SEM | no initial table |

## Plan 3 — application, extension and strategy intelligence

| Original | Task / current owner | Current status | V2 disposition | Phase | Lock | Deletion |
| --- | --- | --- | --- | --- | --- | --- |
| P3.1 | Durable application state machine | Partial | REIMPLEMENT | I/M/O | APP | Z-extension |
| P3.2 | Scanner | Working coupled V1 | REIMPLEMENT | I | EXT | Z-extension |
| P3.3 | Executor | Working coupled V1 | REIMPLEMENT | L | EXT | Z-extension |
| P3.4 | Independent verifier | Strong foundation | PORT | L | EXT | Z-extension |
| P3.5 | Value-free durable outbox | Local implemented | REIMPLEMENT | C/I | PROTO/PRIV | Z-extension |
| P3.6 | Session persistence/recovery | Partial | REIMPLEMENT | I/O | APP/PROTO | Z-extension |
| P3.7 | Candidate-learning bridge | Part 2C local | PORT | M | CAT/TIM | Z-extension/candidate |
| P3.8 | One production pipeline | Decided, V2 pending | REIMPLEMENT | I–M | BASE/EXT | Z-extension |
| P3.9 | Form A/Form B distinction | Runtime superseded | TEST_ONLY | A/V | EXT | retain fixtures |
| P3.10 | Candidate ownership/takeover | Partial | REIMPLEMENT | I/L | EXT | Z-extension |
| P3.11 | Dynamic scanning/mutation control | Working but coupled | REIMPLEMENT | I | EXT | Z-extension |
| P3.12 | General form graph | Pending | REIMPLEMENT | O | APP/EXT | old branches after O |
| P3.13 | Verification stages | Foundation | PORT | L | EXT | Z-extension |
| P3.14 | Versioned strategy registry | Pending | REIMPLEMENT | R | OPS/EXT | old packs after R/V |
| P3.15 | Human-observed proposals | Partial incident concepts | REIMPLEMENT | R | PRIV/EXT | old proposer after R |
| P3.16 | MV3-safe packaged delivery | Policy partial | REIMPLEMENT | L/R | EXT/PRIV | Z-extension |
| P3.17 | Strategy rollout | Partial precedent | REIMPLEMENT | R | OPS | old rollout after R |
| P3.18 | Shared value-free learning | Semantics only | REIMPLEMENT | R | PRIV/TIM | Z-platform |
| P3.19 | ATS coverage | Partial V1 corpus | REIMPLEMENT | I/L/V | EXT | retain fixtures |
| P3.20 | Real-site certification | Ongoing/manual | COMPLETE_IN_V2 | V | EXT/OPS | retain evidence |
| P3.21 | Monitoring/quick-fix loop | Partial | REIMPLEMENT | R/U/V | OPS | old admin after U/R |

## Immediate dependency chain

`A audit/freeze → B skeleton → C clean schema → D identity/entitlements → E Candidate Truth → F one-time V1 import → G onboarding/profile`.

No legacy removal starts before the matching `Z` gate. Database tables are always last.
