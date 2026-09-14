# Part 1 — Field semantic learning execution plan

## Objective

Build the first of three independent learning engines:

> Convert an employer form control plus its local structure into one safe, stable canonical field meaning.

This part answers **what the field means**. It does not decide the candidate's answer and it does not learn how to operate the DOM control. Those remain Part 2 and Part 3.

## Locked product and architecture decisions

1. Candidate answers never enter the semantic-classification payload, mapping registry, embeddings, or shared evidence.
2. Resolution order is: exact learned mapping → ATS-scoped normalized mapping → global normalized mapping → deterministic rules → semantic retrieval → bounded AI fallback → unresolved/user confirmation.
3. AI chooses from existing canonicals first. It may propose a new concept, but it cannot activate one directly.
4. Every accepted AI mapping is persisted as a candidate mapping so the same field does not require AI again.
5. Default AI context stays compact: label, control type, section, one previous label, one next label, and the closest canonical candidates with descriptions. Richer context is a second pass only.
6. A new concept required by the current application enters the existing Attention flow immediately using the employer's original question. Other users are not proactively asked until the canonical is trusted and relevant.
7. Answer behavior is retained only as a neutral raw observation. Semantic mapping confidence changes only after explicit mapping confirmation/correction or the versioned correction classifier produces semantic evidence. A kept or overwritten answer never directly rewards or punishes field meaning.
8. No client-side Transformers.js and no K-means in the first implementation. Semantic retrieval runs behind a backend interface; clustering is a later offline/admin feature.
9. Canonicalization AI is shared platform intelligence, available for fields encountered by Free or Paid users, behind privacy, cache, rate, and daily-budget gates. It is not candidate-specific generation.
10. Answer learning and application authorization follow [ADR 0001](adr/0001-answer-learning-and-application-authorization.md). A field mapping never inherits candidate-answer consent, and a declaration never becomes reusable answer memory.

## Current implementation audit

### Already usable

- `extension/content.js` discovers most input, select, radio, checkbox, combobox, upload, date, iframe and shadow-DOM controls; extracts labels, stable attributes, options, repeatable experience/education scope, structural selectors and portal field keys.
- `src/services/fieldOntology.js` provides a finite deterministic ontology, bounded mapping alternatives and two-question Teach Mode.
- `field_mappings` and `portal_field_patterns` preserve host-scoped structural mappings.
- `canonical_fields` and `question_mappings` preserve canonical concepts and exact normalized question mappings without answer values.
- `applicationSchemaRegistry.js` publishes only completed application schemas and powers recent grouped Attention gaps.
- Live `attention_items` and grouped `attention_gaps` already exist; no second Attention subsystem is required.
- Mapping-pack promotion already has LOCAL_DRAFT → SHADOW → CANARY → DEFAULT safety stages.
- AI consent, telemetry, privacy policy, and embeddings exist for answer memory, although they are not yet a canonicalization engine.

### Partial or unsafe for this goal

- Ordinary fields do not carry a normalized section heading or neighboring labels. `sectionKind` currently helps mainly with repeated experience/education groups.
- Field semantics are resolved in multiple places with slightly different ordering and context.
- `question_mappings` has no mapping status, ATS/context dimensions, evidence score, failure count, model/version, or last validation data.
- `canonical_fields` has no proposed/validated/trusted lifecycle, semantic description, creation source, question template, or duplicate-canonical relationship.
- `applicationSchemaRegistry.canonicalForField()` tries rules before its learned question cache, while the live extension path combines ontology, field mappings, and portal patterns differently.
- The manual-input route can fall back from an unknown label to `normalizeQuestionKey(fieldLabel)`, which can create fragmented pseudo-canonicals rather than a registry-backed concept.
- Existing embeddings search candidate answer memory, not the canonical registry or semantic field examples.
- A user interaction only rescues controls that `detectFields()` can rediscover. A truly missed but interactive control needs a direct event-target descriptor fallback.
- Proactive grouped Attention is confidence-gated but cannot yet require `canonical.status = TRUSTED` because the status does not exist.

### Implementation status — completed locally and reconciled with Phase 0F

Part 1 is implemented under the Node 24 project contract. The live extension, application-schema registry and manual-input route use the same value-free canonicalization pipeline. SQLite migrations `0005` and `0006` add lifecycle/evidence storage and semantic caches. The later Phase 0 classifier and adaptive-evidence kernel now supersede the original proxy-promotion shortcut: answer behavior is neutral, explicit mapping decisions are classified, and SHADOW can recommend promotion, degradation or quarantine without mutating live mapping state. Only an operator can change a mapping lifecycle status, and only trusted concepts/mappings can influence proactive grouped Attention. The local operator page is available at `/admin/semantics`.

The application-schema registry no longer writes or reads the legacy `question_mappings` path for live decisions, verified candidate-answer promotion cannot manufacture pseudo-canonicals from raw employer labels, and the website/extension boundary returns the frozen value-free `FieldSemanticResult` contract.

Protected legal/sensitive descriptors now fail closed before semantic retrieval, embeddings, or AI; interpolated email, phone, URL, and long identifier text is removed from shared descriptors. The readiness summary uses the same trusted-canonical policy as proactive Attention, and the Admin surface always exposes the effective semantic-search, AI-fallback, and new-proposal kill switches even before an override row exists.

Parts 2 and 3 remain deliberately separate: this implementation learns what a field means, but does not merge candidate-answer confidence with semantic confidence or teach new DOM fill strategies.

## Doable implementation tasks

### P1.0 — Restore the runtime and freeze the baseline

**Changes**

- Install/use Node 24 from `.nvmrc` and run `npm ci` under Node 24 so `better-sqlite3` is rebuilt for the same ABI.
- Run the existing ontology, application-schema, privacy, learning-hygiene and extension package tests.
- Add a small semantic-learning baseline report: deterministic fixture count, unresolved count, false-positive count and repeated-mapping lookup count.

**Acceptance**

- `npm run check:runtime` passes.
- SQLite-backed tests exit normally.
- Existing fixtures establish the pre-change canonicalization results.

### P1.1 — Define one versioned field descriptor contract

**Primary files**

- Add `src/contracts/fieldSemanticDescriptor.js` using Zod.
- Update `extension/content.js` payload construction.
- Update `src/routes/extension.js` to validate and normalize descriptors at the API boundary.

**Minimum descriptor**

- `schemaVersion`
- source: raw label, normalized label, type/tag, required, option count and bounded option samples
- stable attributes: name family, aria label, placeholder, autocomplete and approved `data-*` attributes
- context: section heading/family, one previous label/canonical, one next label/canonical
- environment: portal kind, hostname and adapter version
- identity: exact fingerprint and semantic fingerprint inputs
- safety: generic-label, legal, sensitive and skip-learning flags

The default network payload must not include field values, neighboring answers, raw page HTML, full DOM trees, user identifiers, phone numbers, emails or resume content.

**Acceptance**

- Contract rejects values and oversized context.
- Options are sampled rather than sending hundreds of values.
- Equivalent descriptors normalize consistently across extension rescans.

### P1.2 — Add manual-interaction field rescue

**Changes**

- Add `descriptorFromEventTarget()` for trusted `input`, `change`, `focusout` and option-selection events.
- If `fieldFromEventTarget()` misses, inspect the interacted control directly and register it in the current field map.
- Preserve all current honeypot, CAPTCHA, legal, sensitive, hidden and generic-label exclusions.
- Deduplicate the rescued descriptor against the next mutation/rescan.

**Acceptance**

- A fixture containing a control omitted from the initial scan is discovered after trusted user interaction.
- Programmatic events cannot manufacture learning evidence.
- Protected values remain null.

### P1.3 — Upgrade the canonical registry through an append-only migration

**Primary files**

- Add `src/database/migrations/0005_field_semantic_learning.js` and register it in `src/database/migrations/index.js`.
- Update the bootstrap schema for fresh local databases without editing applied migration history.

**Canonical additions**

- `description`, `semantic_group`, `answer_type`
- `status`: `PROPOSED`, `VALIDATED`, `TRUSTED`, `REJECTED`, `MERGED`
- `created_source`, `canonical_version`
- `reuse_policy`, `autofill_policy`, `ask_policy`
- optional `merged_into_key`

**Mapping additions**

- Introduce a dedicated `field_semantic_mappings` table rather than overloading portal selector mappings.
- Store exact fingerprint, normalized label, ATS/host scope, control type, section family, semantic fingerprint, source, model/prompt version, confidence, evidence score, kept count, overwrite count, status, first/last seen and last validated.
- Add `canonical_examples` for normalized phrases and optional embedding/vector metadata.
- Add `canonical_question_catalog` for Attention wording and input shape, separate from machine semantics.
- Add append-only `semantic_mapping_evidence` rows; never put candidate values in them.

**Acceptance**

- Existing canonical and question mapping rows backfill without changing their meaning.
- Foreign keys and uniqueness prevent duplicate active mappings for the same scoped fingerprint.
- Migration verification and backup tests pass.

### P1.4 — Create one canonicalization repository and resolver

**Primary files**

- Add `src/repositories/fieldSemanticRepository.js`.
- Add `src/services/fieldCanonicalizer.js`.
- Make `fieldOntology.js` a definitions/rules dependency rather than the end-to-end resolver.
- Replace duplicated resolution in `applicationSchemaRegistry.js`, the live resolve-fields route, and manual-input handling.

**Resolver result**

- canonical key and canonical status
- confidence and decision: `RESOLVED`, `NEEDS_CONFIRMATION`, `UNRESOLVED`, `NEW_CONCEPT_PROPOSED`
- source: exact, ATS mapping, global mapping, deterministic, semantic, AI or user-confirmed
- mapping ID, fingerprints, reason codes and candidate alternatives
- safety and reuse policy

**Acceptance**

- All three entry points return the same semantic result for the same descriptor.
- Learned exact mapping runs before rules or AI.
- Generic labels never become reusable mappings.
- Manual input never invents a canonical from normalized question text.

### P1.5 — Improve deterministic scoring with local context

**Changes**

- Keep exact ontology patterns for obvious fields.
- Add weighted signals for label, stable name/aria/autocomplete, section family, control type/options, neighbor canonicals and portal-specific hints.
- Return ranked candidates and reason codes rather than only `0.98` or `0.35`.
- Put thresholds in one versioned policy module and test near-ties.

**Initial policy**

- high confidence: accept
- medium confidence: require evidence/user confirmation; do not autofill from this mapping yet
- low confidence: semantic retrieval, then AI fallback

Exact numeric thresholds should be fixtures-driven and configurable, not scattered through routes.

**Acceptance**

- `Name` in Education, References and Identity resolves differently from context.
- Technology-specific experience cannot collapse into total experience.
- An ambiguous result never silently wins because it is first in an array.

### P1.6 — Add backend semantic retrieval behind a storage interface

**Changes**

- Add `src/services/canonicalSemanticSearch.js` with `nearestCanonicals(descriptor, limit)`.
- For local SQLite, store embeddings as versioned JSON and use bounded in-process cosine search over active canonical examples; the ontology is small enough for development.
- Define the Supabase/Postgres adapter contract now so the same service later uses pgvector/HNSW without changing callers.
- Batch unresolved descriptors and cache embeddings by normalized semantic fingerprint.

**Acceptance**

- Semantic search returns only active/eligible candidate canonicals with similarity and definition.
- No candidate answer or protected text is embedded.
- Cache hit avoids a second embedding call.
- Semantic retrieval can be disabled and safely falls through to AI/user confirmation.

### P1.7 — Implement progressive, structured AI canonicalization

**Primary files**

- Add `src/services/fieldCanonicalizationAi.js`.
- Extend `src/services/openai.js` with one schema-validated operation and telemetry label.

**Pass 1 payload**

- label and control type
- section
- one previous and one next label/canonical
- top semantic candidates with canonical name and description

**Pass 2 only when uncertain**

- bounded aria label, placeholder, stable name family
- up to two previous and two next fields
- option count and samples
- page/form heading and ATS kind

**Allowed output**

- `EXISTING_CANONICAL`
- `NEW_CANONICAL_REQUIRED`
- `UNRESOLVED`

The response must be strict JSON with canonical/proposal, confidence, data type, semantic group and reason codes. AI may not return an answer value.

**Acceptance**

- Protected/generic fields never enter AI.
- A closed-vocabulary hit cannot invent a new name.
- Timeout, budget exhaustion or invalid JSON produces `UNRESOLVED`, not a guess.
- The same accepted descriptor subsequently resolves from storage without AI.

### P1.8 — Persist classified semantic evidence and SHADOW recommendations

**Changes**

- Persist AI/user-confirmed mappings as `PROPOSED` or `CANDIDATE`, never immediately trusted.
- Retain answer/fill outcomes as neutral observations; they never update semantic meaning directly.
- Only explicit `MAPPING_CONFIRMED` / `MAPPING_CORRECTED` decisions, or a later classifier result with equivalent attribution, create semantic evidence.
- Keep the append-only `+1` confirmed / `-2` corrected score as a readable audit summary, not a production state machine.
- Route classified semantic evidence into the adaptive SHADOW kernel with mapping-and-canonical version identity, independent-run counts, decay and volatility.
- Require operator approval for `VALIDATED`, `TRUSTED`, `QUARANTINED` and recovery transitions. Keep mapping-pack selector evidence separate.

**Acceptance**

- Repeated explicit confirmation increases the audit score exactly once per application/field attempt.
- Repeated rescans do not inflate evidence.
- A negative signal creates a SHADOW degrade/quarantine recommendation but does not delete history or mutate production state.
- No one user's action immediately changes DEFAULT behavior for everyone.
- A correction of one canonical followed by confirmation of another creates two distinct adaptive subjects even when the descriptor row is reused.

### P1.9 — Add safe new-canonical proposals and duplicate prevention

**Changes**

- Search existing canonical definitions/examples before accepting `NEW_CANONICAL_REQUIRED`.
- Create a `PROPOSED` canonical and candidate question definition in one transaction.
- Never let a proposed canonical autofill or become proactive global Attention.
- Provide merge/reject/validate operations; aliases point to one stable canonical key.

**Acceptance**

- `present_employer` cannot be created when `CURRENT_COMPANY` is an adequate existing concept.
- Concurrent identical proposals deduplicate.
- Merge preserves all mappings, examples and evidence.
- Legal/sensitive proposals default to never-persist/manual policy.

### P1.10 — Feed the existing Attention system, not a new one

**Current application**

- If the canonical is known/proposed but the candidate answer is unavailable, create the existing `attention_items` record.
- Use a trusted catalog question when available; otherwise use the employer's original label and actual control options.
- Include internal provenance: application, field mapping, resolution source and canonical status.

**Other users / preflight**

- Update grouped `attention_gaps` queries to require trusted canonicals and fresh verified application schemas.
- Apply `ask_policy` and relevance before creating a proactive gap.
- Keep sensitive, legal and application-only concepts out of proactive Attention.

**Acceptance**

- The current blocked user sees the question immediately.
- An unrelated user does not see a proposed canonical.
- Once trusted, only relevant users with missing answers receive one grouped Attention gap.

### P1.11 — Add admin and operational visibility

**Changes**

- Extend the existing operational Admin surface with canonical proposals, mapping candidates, duplicate suggestions, evidence score, status and source/model version.
- Add approve, merge, reject, quarantine and rollback operations.
- Show resolution counts by exact/rule/semantic/AI/user and repeated-AI-call rate.
- Add feature flags and kill switches for semantic retrieval, AI fallback and new-canonical proposals.

**Acceptance**

- An operator can understand why a mapping exists without seeing candidate values.
- A bad mapping can be quarantined immediately.
- AI/caching metrics prove whether the repeated-call reduction is real.

### P1.12 — Certification, privacy and rollout tests

**Test layers**

- Unit: normalization, descriptors, fingerprints, ranked rules, status transitions and AI schema parsing.
- Repository: migration/backfill, exact/ATS/global lookup order, deduplication and evidence idempotency.
- Extension fixtures: section/neighbor extraction, shadow/iframe controls, generic labels, option sampling and manual-discovery rescue.
- Integration: exact → rule → semantic → AI → persist → next request exact hit.
- Attention: proposed current-app immediate; proactive only trusted and relevant.
- Privacy: no values, protected text or candidate identifiers in AI, embeddings, mapping evidence or admin responses.
- Regression: existing form, learning, adapter, schema and Attention suites.

**Rollout**

- Shadow mode records decisions without altering fills.
- Canary uses validated mappings on owned fixtures and selected portals.
- Default only after accuracy, correction, latency, AI-call and privacy gates pass.

## Recommended implementation slices

1. **Foundation:** P1.0–P1.4. This removes fragmented canonical decisions before adding AI.
2. **Hybrid intelligence:** P1.5–P1.7. Deterministic scoring, semantic retrieval and bounded AI.
3. **Compounding learning:** P1.8–P1.9. Evidence, promotion and safe new concepts.
4. **Product integration:** P1.10–P1.12. Existing Attention, Admin, certification and rollout.

Do not begin Part 2 answer learning or Part 3 fill-strategy learning inside these slices. They may consume the canonical result, but they must keep separate tables, scores and privacy rules.

## Definition of done for Part 1

Given a previously unseen employer field, the system can:

1. detect it during scan or trusted manual interaction;
2. create a value-free semantic descriptor;
3. resolve it using the cheapest safe layer;
4. ask AI only when prior layers are uncertain;
5. reuse an existing canonical or create a non-active proposal without duplicates;
6. persist the accepted field-to-canonical mapping;
7. avoid AI on the next equivalent field;
8. feed a missing candidate answer into the existing Attention flow;
9. keep proposed concepts away from unrelated users until trusted;
10. expose all evidence and promotion decisions without exposing candidate answers.
