# Repeatable Entity Intelligence

Phase M inserts one authority between field meaning and Candidate Truth:

`I scanner -> J canonical meaning -> M entity binding -> Candidate Truth -> K execution -> L verified learning`

M answers only: **which stable candidate entity does this repeated form group represent?** It does not choose a canonical, convert a value, operate the DOM, or decide what can be learned.

## Identity model

A candidate entity is an existing Candidate Truth aggregate in `candidate_entities`. Its UUID survives edits and display reordering. Versions and current entity-scoped answers remain append-only/history-backed through the existing Candidate Truth repositories.

A form repeat group is application/runtime structure. `formRepeatGroupId` is derived from page instance, form instance and a stable application-side group key when one exists. It is never a candidate entity UUID. A DOM ordinal is retained only as non-authoritative diagnostic evidence.

The scanner no longer accepts a page-owned `data-candidate-entity-id` as Candidate Truth authority. It recognizes bounded employment, education, project, certification and language group structure. Stable `data-repeatable-item`, `data-item-id`, automation/test IDs or container IDs survive ordinary rerenders; groups with ordinal evidence alone fail closed when more than one entity can match.

## Deterministic binding

The database repository loads all candidate entities needed by one resolve batch in one value-private projection. Each descriptor contains UUID, type, lifecycle/version, semantic recency rank, display order, canonical coverage and private value fingerprints. Raw company, institution, title and date values never leave this boundary.

Evidence is additive and auditable:

- exact prior binding with unchanged entity revision: `0.96`;
- only active entity of that type: `0.90`;
- current/most-recent semantic role to semantic recency rank 0: `0.88`;
- previous semantic role to semantic recency rank 1: `0.84`;
- stable form-group identity: `0.04`.

`BOUND_HIGH` requires confidence at least `0.88`, a `0.12` lead over the next candidate, and non-ordinal authority unless there is only one active entity. `BOUND_MEDIUM` begins at `0.72` but is not passed into Candidate Truth or K. All other outcomes are `AMBIGUOUS`, `UNBOUND` or `UNSUPPORTED`.

Display order is deliberately separate from semantic recency. Reordering the profile therefore cannot make “current employment” resolve to a different UUID.

## Optional AI boundary

AI is optional and provider-neutral. It runs only after deterministic evidence remains ambiguous and the group has non-ordinal identity. Its compact, value-free payload contains the group role/type/canonical coverage and a bounded list of candidate UUIDs. Schema validation rejects invented IDs and low-confidence or ambiguous output. Production currently has no provider attached, so uncertainty fails closed. Phase P owns provider routing.

## Persistence and staleness

`application_entity_bindings` stores value-free, run/page/group-scoped receipts. A bound receipt includes the exact candidate entity version and revision used by J, Candidate Truth, K and L. The revision hashes entity UUID, aggregate version, canonical coverage and private current-answer fingerprints—not answer values.

Material group changes supersede the receipt with `FORM_GROUP_STALE`. Candidate edits/removal supersede or invalidate it with entity-specific failures. Existing obsolete bindings are never replayed merely because their row already exists. Binding persistence re-checks the current entity revision in the transaction.

L requires `BOUND_HIGH` and records the same entity UUID, version and revision. The learning repository recomputes that revision before accepting an observation. A profile edit or removal therefore cannot be silently overwritten by an older open application. Grouped Candidate Truth change sets and existing partial-safe Undo remain authoritative.

## Lifecycle and concurrency

Profile entity remove, restore and reorder endpoints derive account/candidate ownership from the bearer session. Mutations require an idempotency key, use optimistic entity versions, candidate-scoped advisory locks and immutable operation receipts.

- add: Phase G/Candidate Truth creates a new UUID from a stable client/source key;
- edit: current Candidate Truth answer versions advance while the entity UUID stays fixed;
- remove: entity becomes ineligible and active form bindings are invalidated; history remains;
- restore: the same UUID returns with a new lifecycle version;
- reorder: display order changes, not UUID identity or semantic recency.

Form-side removal invalidates only the runtime group; it never deletes the profile entity. Dynamic Add Another is `K action -> I rescan -> J -> M -> Candidate Truth -> K`. Phase N owns the dependency graph behind that action.

## Failure taxonomy and privacy

M failures remain distinct from J semantic, Candidate Truth value, K execution and L attribution failures: unknown type, no candidate, ambiguous/stale binding, stale group, removed/version-conflicting entity, policy rejection, ordinal-only refusal and invalid/unavailable AI.

Binding contracts, persistence, generic telemetry and checkpoints may contain entity/form IDs, states, reason codes, confidence buckets and operation IDs. They must not contain company or institution names, titles, dates, resumes or candidate values. Candidate-private values remain encrypted or transient inside existing Candidate Truth/K/L boundaries.

## Validation coverage

Automated behavior locks cover unique/multiple/no-candidate binding, explicit current/previous roles, order independence, ordinal refusal, ambiguity, constrained AI IDs, persisted binding reuse/supersession, lifecycle OCC/idempotency, removed-entity migration, candidate-owned APIs, exact Candidate Truth entity resolution and stale-learning rejection. The final Node 24.8.0 gate passes 213 tests with no failures or skips, plus architecture, lint, typecheck and production builds.

Chromium coverage proves:

- reversed current/previous employment form order;
- the same employer twice with different titles without merging;
- separate education institution and degree;
- stable group identity across delete, dynamic Add Another and rerender;
- entity-specific K execution with no cross-fill;
- manual correction of the previous employment while current employment remains unchanged;
- verified L learning against that exact UUID;
- Undo of that entity correction without changing the other entity;
- value-free extension storage/telemetry and clean page/service-worker consoles.

Greenhouse, Lever and Workday remain covered by the Phase J field-intelligence fixtures. Phase U owns broad live ATS certification.

## Removed legacy paths and limitations

Removed/rejected production paths include page-supplied candidate UUID authority, array/DOM-index entity selection, Form A/Form B runtime branching and a second repeatable-answer store. The frozen V1 tree remains unused; Phase Z owns its eventual deletion after soak and rollback proof.

Current genuine limitations:

- blank duplicate groups without a stable key, semantic role, prior binding or unique candidate remain ambiguous;
- private prefilled-value matching is not yet used as an authoritative cross-form signal;
- projects, certifications and languages have contracts/lifecycle support but are not broadly browser-certified;
- closed shadow roots and inaccessible cross-origin frames retain their earlier explicit unsupported behavior;
- conditional group dependencies and complex nested repeat graphs belong to Phase N.
