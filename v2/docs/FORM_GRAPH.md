# Phase N — Form Graph

Status: complete at the Phase N boundary. Runtime: Node 24.

## Purpose and ownership

Form Graph is the value-private structural layer for dynamic applications. It answers which controls, groups, sections, actions, validation gates and steps exist; how they depend on each other; which nodes are reachable now; and whether an observed action produced the expected structural transition.

The responsibility chain remains strict:

`I scanner/runtime -> N structure/reachability -> J field meaning -> M repeat entity -> Candidate Truth -> K representation/execution/verification -> L verified learning`

N never chooses a canonical, candidate answer, repeated candidate entity, representation or consent. K is the only DOM execution authority. Final Submit is never a graph action.

## Runtime model

The shared contract in `packages/contracts/src/form-graph.ts` defines:

- Nodes: `FIELD`, `FIELD_GROUP`, `REPEAT_GROUP`, `SECTION`, `ACTION`, `STEP`, `VALIDATION_GATE`.
- States: reachable, blocked, conditional, hidden, disabled, stale, completed, needs-user and unresolved.
- Edges: containment, dependency, reveal/hide, enablement, option dependency, navigation, repeat creation, validation prerequisites and execution order.
- Evidence: declared DOM relations, observed/repeated transitions, structural inference and non-authoritative AI suggestions.
- Immutable graph guards, material deltas, transition receipts, safe-frontier inputs/results and graph-specific failures.

`@job-hunter-v2/form-graph` is pure deterministic code. The extension scanner produces bounded structural observations; the package validates topology, fingerprints material state, reconciles revisions, detects cycles, records runtime-scoped observed edges and computes the safe frontier.

Candidate values, raw DOM snapshots, selectors and arbitrary JavaScript predicates are not graph data. AI-only edges are schema-invalid when executable.

## Discovery and identity

The Phase-I scanner remains the only DOM discovery pass. It now discovers hidden conditional controls for structure while excluding them from J's currently visible field batch. Visibility is ancestor-aware, including `hidden`, `aria-hidden`, display and visibility state. Password and technical hidden inputs remain excluded.

Identity uses bounded hashes of page/application, form, control, repeat-group and step evidence. A rerender with equivalent logical structure retains the same graph fingerprint/revision. Material option, requiredness, visibility, enabledness, validation, step, node or edge changes increment the graph revision and emit a typed delta.

Step identity combines normalized route, input/review state, heading, progress indicator and active-panel evidence. Application identity removes common step/page/review suffixes from both route and form action so one `applicationRunId` survives multi-step SPA navigation.

## Dependencies and observed causality

Declared deterministic evidence includes `aria-controls`, `aria-owns`, controller attributes, disabled/hidden/required state, option universes, validation markup, containment and repeat structures.

For a known Copilot or trusted candidate interaction:

`before graph + source operation + after delta -> runtime observed edge`

The correlation window is bounded. Unknown/browser mutations remain lower confidence. Observed edges contain node IDs, transition category and graph metadata only. An observed reveal that has already materialized is evidence, not a permanently unmet prerequisite.

## Planning and execution loop

The backend execution planner re-resolves private field intelligence and computes readiness from:

`N graph + J resolution + M binding/capacity + Candidate Truth policy + K capability + ownership`

Only the current safe field frontier becomes K operations. Dependencies inherited through containing sections are respected. Hidden, disabled, stale, future-step and uncreated-repeat fields cannot execute. Required reachable fields without an allowed answer become needs-user; optional unknowns are not fabricated.

Every plan, field operation and graph action carries `pageInstanceId + graphRevision + graphFingerprint`. Content checks this guard before the batch and every operation. K stops after the first structural change. The controller then rescans, reconciles, reruns J/M/Truth, and requests a new frontier.

Execution is bounded to 12 transitions with repeated-fingerprint, no-op, cycle and non-convergence stops. A stale plan never touches the DOM.

Structural automation is intentionally narrow:

- `ADD_REPEAT`: automatic only when M reports remaining candidate capacity.
- `EXPAND`: automatic only with a current, reachable, enabled graph action and valid guard.
- `NEXT`, `CONTINUE`, `SAVE`: represented as user-gesture-required actions.
- `SUBMIT`: rejected by the graph-action contract.

## Repeat groups, validation and steps

N identifies Add Another and confirms a new repeat group. M alone binds that group to a candidate entity. Remove/reorder reconciles graph identity without transferring Candidate Truth between entities.

Visible validation evidence creates a `VALIDATION_GATE`. Current required fields, unresolved dependencies, validation errors and user-owned required inputs block readiness. A Next click is not a successful transition; N requires a changed step graph. Review pages are represented as review steps and rendered summaries are not editable fields.

Background recovery persists only a bounded value-free step-visit history, last transition receipt and graph summary. It does not persist the live graph or pending actions. Service-worker recovery reconnects, rescans, reconstructs and invalidates uncertain work before proceeding.

## Failure attribution

Graph failures remain distinct from I/J/M/Candidate Truth/K/L failures. N returns typed results including stale node/revision, unresolved or ambiguous dependency, unexpected/no transition, missing reveal, validation block, options not ready, cycle, repeated state, unsupported form structure and non-convergence.

These receipts are a Phase-Q-ready evidence seam, not a strategy promotion system. Runtime observations never become site/global authority automatically.

## Verification coverage

Automated tests cover identity/revisions, typed deltas, option/visibility/requiredness changes, inherited reveal dependencies, safe frontier, cycle fail-closed, observed causality, malformed references, AI-only rejection, repeated states, stale graph guards, M-gated Add Another, multi-step visit recovery and privacy.

The unpacked-Chromium K/N suite covers static K behavior plus:

- sponsorship reveal and later hide;
- nested A -> B -> C replanning;
- country-dependent option replacement;
- automatic Add Another -> N -> M -> J -> Truth -> K;
- repeat-group reorder/removal/recreation;
- dynamic requiredness;
- validation failure without false navigation;
- multi-step SPA identity and verified step transition;
- trusted manual branching and ownership yield;
- equivalent container rerender;
- service-worker termination/recovery;
- dependency-cycle fail-closed behavior.

Phase-I recovery/static, Phase-J semantics, Phase-L verified learning and Phase-M repeatable behavior remain separate regression suites.

## Performance and privacy

The observer coalesces relevant mutations. Cosmetic equivalent observations do not create revisions or background writes. Structural fingerprints, bounded candidate/graph sizes and safe-frontier replanning avoid uncontrolled whole-form loops. J/M/Truth are rerun only at the next verified frontier, not independently by K.

Generic graph storage and telemetry are value-private by contract (`valuePrivate: true`, `containsCandidateValue: false`). They may contain opaque runtime IDs, edge/action/delta/failure categories, revisions, counts and ATS/site family. They must not contain candidate answers, field values, full labels/options, DOM HTML or documents.

## Legacy and deferred scope

No V2 Form A/Form B production branch, hardcoded question order or second graph executor remains. The frozen V1 tree is not imported by V2. Its final files/dependencies/tables remain a Phase-Z removal only after zero-read/write, rollback and soak evidence; database tables are removed last.

Deferred intentionally:

- AI provider routing and semantic dependency inference (P);
- adaptive strategy promotion/canaries and reusable template evidence (Q);
- resume/document execution (R);
- full ATS certification (U);
- automatic final submission.

Known safe limitations include closed shadow roots, inaccessible cross-origin frames, nonstandard controls without deterministic evidence, uncertain asynchronous causality, and sites whose graph cannot converge. These stop or ask the candidate instead of guessing.
