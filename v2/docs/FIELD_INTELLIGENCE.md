# Phase J — Field Intelligence

Phase J is the single V2 authority for translating value-free browser evidence into a canonical field meaning and a value-free Candidate Truth answer reference.

```text
DOM/page
  -> scanner
  -> FieldEvidenceInput
  -> deterministic candidate generation
  -> confidence and ambiguity policy
  -> bounded AI fallback when configured
  -> FieldSemanticResolution
  -> Candidate Truth answer reference
  -> Phase K
```

The scanner discovers structure. Field Intelligence understands meaning. Candidate Truth owns candidate answers. Phase K will transform answers into representations, execute controls and verify readback. Phase J never writes a DOM field, stores a candidate answer in a semantic mapping, or treats an executor failure as semantic evidence.

## Contracts and privacy boundary

`packages/contracts/src/field-intelligence.ts` defines the strict versioned request, response and AI contracts. The default field evidence includes runtime/form identity, control type, bounded label evidence, section and neighboring labels, semantic/form context, safe locator attributes, bounded option samples and repeatable-entity evidence. It deliberately excludes field values and candidate answers.

All semantic and answer-reference outputs declare `valuePrivate: true` and `containsCandidateValue: false`. The API derives account and candidate ownership from the authenticated bearer session; caller-supplied identity cannot select another candidate. The extension stores only semantic results and Candidate Truth version/status references in session storage. Semantic telemetry is structural and value-free.

Candidate values may be read inside the Candidate Truth resolver, but `FieldIntelligenceService` immediately reduces the result to an answer reference:

- `AVAILABLE_REUSABLE`
- `AVAILABLE_REVIEW`
- `MISSING`
- `STALE`
- `CONFLICT`
- `CONTEXT_REQUIRED`
- `POLICY_BLOCKED`
- `SEMANTIC_UNRESOLVED`

No normalized candidate value crosses the Phase-J API response.

## Deterministic resolution

The authoritative ontology combines reviewed Candidate Truth canonicals with bounded alias rules. Candidate generation scores exact and overlapping normalized aliases against the field label and aria-label first. Decorative placeholders such as `Type here...` are locator evidence, not part of the primary alias signal. Safe semantic attributes, control-type compatibility, section evidence, neighboring-field evidence and stable repeatable-entity context remain secondary.

Negative patterns and canonical policy/type checks reject unsafe candidates. A lone word such as `work` does not resolve work authorization. Country-scoped work authorization remains ambiguous when country context is absent.

Candidate lists contain at most eight registered canonicals with concise descriptions. An AI response cannot introduce a new canonical or bypass Candidate Truth policy.

## Confidence and AI fallback

Confidence policy `J1-2026-09` is centralized in `FieldSemanticResolver`:

- high: confidence at least `0.88` and candidate margin at least `0.10`;
- medium: confidence at least `0.72` and candidate margin at least `0.07`;
- candidate generation floor: `0.24`;
- otherwise: explicit ambiguity or unresolved state.

The public states are `RESOLVED_HIGH`, `RESOLVED_MEDIUM`, `AMBIGUOUS`, `UNRESOLVED` and `UNSUPPORTED`. Errors remain specific, including no candidate, ambiguity, missing context, incompatible/unsupported control, invalid or unavailable AI, policy rejection and stale runtime identity.

AI is an optional `FieldCanonicalizationAiPort`, not a provider-specific dependency. The normal payload is compact: label, control type, section, previous/next labels and bounded canonical candidates. Only an inconclusive result can receive richer safe context: aria label, placeholder, attribute name, role, option samples, nearby description, page heading and ATS. Outputs are schema-validated and constrained to supplied registry candidates. Phase P will own provider selection and budgets.

The server permits at most eight AI calls per field batch. Stable value-free descriptor fingerprints cache semantic cores, and identical Candidate Truth requests are deduplicated within a batch. The 200-field performance behavior lock completes without AI for deterministic fields.

## Context, repeatables and representation

Repeated employment and education controls may share a canonical while retaining different entity evidence. Stable candidate entity IDs are strongest, followed by stable DOM keys. Ordinal position is only a non-durable hint. A normal section named “Current employment” is not treated as a repeatable entity merely because it contains the word employment.

Phase M binds stable repeat groups to existing Candidate Truth entity UUIDs after J resolves meaning. When no high-confidence stable entity is bound, Candidate Truth still fails closed rather than guessing an array position. See `REPEATABLE_ENTITY_INTELLIGENCE.md`.

Candidate Truth and form representation are distinct. For example, `56 months` may later render as `5 years`, but Phase J neither performs that conversion nor rewrites Candidate Truth. Representation selection, DOM strategy, execution and readback belong to Phase K.

Declarations such as accuracy certification, privacy acknowledgement, background-check authorization and terms acknowledgement are semantically recognized. Their reusable Candidate Truth policy blocks ordinary answer reuse; no declaration is checked or executed in Phase J.

## Runtime and API

The protected endpoint is `POST /v1/field-intelligence/resolve`. The extension batches the current scan once, calls the endpoint only when its authenticated session is ready, and stores the value-free response against the tab/frame runtime. A fresh scan invalidates the older semantic result. The UI currently shows only summary readiness counts; it does not expose internal scores or reasoning.

## Certification and limitations

Automated accuracy covers 35 representative canonical variants plus noisy, ambiguous and negative examples. Chromium certification covers Greenhouse-, Lever- and Workday-shaped forms, repeatable employment/education, radio/checkbox/declaration controls, delayed dynamic insertion and SPA route changes. It asserts that no Candidate Truth value appears in requests/storage and that the DOM remains unchanged.

Known limitations are deliberate:

- no production AI provider is bound yet; deterministic ambiguity remains explicit when the port is unavailable;
- aliases are a reviewed baseline, not a complete catalog for every ATS/custom question;
- closed shadow roots and inaccessible cross-origin frames cannot be inspected;
- ordinal repeatable hints are not promoted to durable candidate identity;
- representation conversion, control execution/readback, verified manual-answer learning and conditional form graphs are deferred to K, L/M and N respectively.

Legacy V1 semantic code is not imported or executed by V2. The external V1 tree remains frozen until the Phase Z cutover proves no remaining reads/writes and rollback safety. Execution-specific legacy behavior is retained only as future K certification reference.
