# Phase K — Executor & Verifier

Phase K is the single V2 browser-mutation path:

`I scanner → J field meaning → Candidate Truth → K representation → K strategy → independent K verifier → value-free receipt`

## Authority and private-data boundary

- `POST /v1/execution/plan` is authenticated and derives account/candidate ownership exclusively from the bearer session.
- The browser submits current bounded scanner evidence plus application/page identity. The strict request rejects caller-supplied canonicals, selectors and values.
- `ExecutionPlanningService` reruns the authoritative private Field Intelligence path and Candidate Truth resolution. Candidate values exist only in the transient response and current field operation.
- Plans are never persisted in extension local/session storage. Receipts and telemetry contain identifiers, strategy/representation versions, outcomes and timings, never values.
- Only `RESOLVED_HIGH` semantics and currently resolvable Candidate Truth can become operations. Medium/ambiguous fields fail closed.
- File references, protected fields and application-gesture declarations are not executed by generic **Fill safe fields**.

## Contracts

`packages/contracts/src/execution.ts` freezes versioned contracts for:

- DOM capabilities;
- private field representations;
- execution-plan request/response;
- per-attempt and per-field receipts;
- batch receipts;
- verification states and execution failure classes.

Every operation is bound to `applicationRunId`, `pageInstanceId`, `formInstanceId`, `fieldRuntimeId`, `controlFingerprint`, canonical, Candidate Truth answer version, representation version and a bounded attempt count. Every durable result states `containsCandidateValue: false`.

## Representation

`@job-hunter-v2/execution` owns pure, versioned representation policy. It does not modify Candidate Truth. Current adapters cover text/rich text/URL, boolean/yes-no, exact enum and multi-enum options, dates/month/year, duration months or floored years, INR/year to LPA, exact money, phone, address, date ranges, entity labels and decline-to-answer. Unsupported or invalid representations are separate failures.

## Capability and strategy model

The content runtime detects live capabilities rather than choosing from the semantic type or tag alone. The deterministic registry currently includes:

- native property-setter text, email, phone, URL, number, date/month and textarea;
- lower-priority direct-property event fallback;
- native exact select and multi-select;
- native checkbox and radio group;
- contenteditable;
- ARIA/searchable combobox with bounded option discovery;
- ARIA radio groups and toggles.

Option selection is Unicode/whitespace normalized but exact. Zero matches return `OPTION_NOT_FOUND`; multiple matches return `OPTION_AMBIGUOUS`. There is no fuzzy/random selection.

## Independent verification and retries

The verifier never trusts the executor's claim. It performs bounded condition-driven rechecks and reads control-specific state for text/date, checkbox/toggle, select, radio, multiselect, combobox and contenteditable. It re-runs scanner binding once when a framework rerender replaces the node, but only accepts the same logical runtime identity and control fingerprint.

Retries are bounded by the plan (currently two), deterministic and reason-aware. A second compatible strategy is tried only after an eligible failure. Failed attempts restore their captured local control state before fallback so dirty query/selection state does not contaminate the next strategy. Ambiguity, user ownership and page transition stop immediately.

Failures remain layer-specific: stale/detached field, unsupported strategy, rejected DOM interaction, missing/ambiguous option, invalid representation, verification failure, user ownership, page transition, timeout, inaccessible frame, invalid runtime and unknown failure. K never changes semantic or Candidate Truth confidence.

## Ownership, concurrency and dynamic forms

- One in-memory lock prevents concurrent operations on the same runtime field.
- Background and content both validate application/page identity; content also validates the current field fingerprint.
- Trusted pointer, keyboard, input, change, click and paste activity transfers ownership to the candidate. Programmatic focus is not mistaken for candidate intent. A delayed strategy polls for ownership/page invalidation and yields before committing an option.
- Operations are sequential. A verified interaction that changes the form structure triggers I rescan → J resolution → one bounded K continuation. K never classifies newly inserted fields itself.
- SPA navigation invalidates the prior page operation before it can mutate the new page.

## Browser certification

Controlled Chromium fixtures cover native text/textarea/number/select/multiselect/radio/checkbox, React-like controlled rerender, exact autocomplete/custom listbox, dynamic dependent insertion and continuation, duplicate-option ambiguity, file/declaration fail-closed behavior, manual user takeover and SPA stale-operation rejection. The fixture asserts final DOM state, policy skips, no private extension storage/telemetry, and clean page/worker consoles.

The pre-existing Phase I extension browser suite and Phase J Greenhouse/Lever/Workday semantic suite remain green after K integration.

## Legacy and limitations

The Phase-I no-op executor/verifier path has been removed; only the Phase-K orchestrator can mutate V2 fields. The external V1 extension remains frozen as a behavior reference and is not imported or executed. Its deletion, dependencies and database tables remain owned by Phase Z after parity, rollback and zero-read/write soak proof.

Known explicit limitations are closed shadow roots, inaccessible cross-origin frames, authorized document upload, nonstandard widgets outside the registry, rich-text editor-specific semantics, full repeatable/conditional Form Graph planning and grouped consent authorization. Those belong to later M/N/Q/U or dedicated document/declaration boundaries. Phase L owns verified manual-answer/correction learning; K emits only the value-free evidence needed by it.
