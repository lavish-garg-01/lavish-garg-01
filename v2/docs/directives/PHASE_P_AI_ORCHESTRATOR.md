Phase **O — Declaration & Consent Policy is complete**.

The next implementation boundary is:

# Phase P — AI Orchestrator

Implement Phase P end-to-end according to the existing V2 master architecture, current repository state, Phase J Field Intelligence, Phase L Verified Learning, Phase O policy layer, existing AI integrations, and `docs/IMPLEMENTATION_CHECKPOINT.md`.

The purpose of Phase P is to create **one authoritative AI orchestration layer** for Job Hunter.

No business subsystem should directly own provider/model selection.

The target architecture is:

`business/domain feature`
→ `AI task request`
→ `P orchestrator`
→ `task classification`
→ `provider/model routing`
→ `quota/cost/privacy policy`
→ `execution`
→ `schema validation`
→ `confidence evaluation`
→ optional fallback/escalation
→ `typed result`

The core rule is:

**Features ask for AI capabilities. P decides which provider/model executes them.**

Do NOT allow permanent architecture such as:

`J → Gemini directly`

`Q → Groq directly`

`R → OpenAI directly`

Instead:

`J → CANONICALIZE_FIELD`

`Q → ANALYZE_EXECUTION_FAILURE`

`R → EXTRACT_RESUME`

and P handles provider/model choice.

Implement:

- **P1 — AI task/domain contracts**
- **P2 — Provider adapters**
- **P3 — Routing & specialization policy**
- **P4 — Confidence, fallback & escalation**
- **P5 — Cost/quota/token controls**
- **P6 — Privacy, caching, idempotency & resilience**
- **P7 — Observability, evaluation & admin foundation**
- **P8 — Integration migration, hardening & Phase P closure**

---

# Token-budget / checkpoint protocol

My Codex token/context budget is limited.

Maintain:

`docs/IMPLEMENTATION_CHECKPOINT.md`

as the authoritative recovery source throughout Phase P.

Use:

`audit once`
→ `implement coherent P subphase`
→ `focused tests`
→ `integration verification`
→ `checkpoint`
→ `continue`

Checkpoint at meaningful boundaries, at minimum after:

- initial AI integration audit;
- P1/P2;
- P3/P4;
- P5;
- P6;
- P7;
- P8/final verification.

If context becomes low:

1. do not start another large subphase;
2. stabilize/typecheck/build where practical;
3. update the checkpoint BEFORE stopping;
4. clearly mark P incomplete;
5. record the exact next action.

Checkpoint must contain:

- completed P subphases;
- unfinished work;
- task registry;
- provider adapters;
- routing policy;
- model/provider assignments;
- fallback rules;
- confidence rules;
- cost/quota policies;
- caching/idempotency rules;
- privacy/redaction rules;
- integrations migrated;
- files/config changed;
- tests/results;
- exact next action;
- what must NOT be re-audited.

Never store API keys, secrets, prompts containing candidate private data, resume contents, or candidate answers in the checkpoint.

---

# Before coding — audit all existing AI usage

Search the repository for every direct AI/provider integration.

Inspect:

- OpenAI SDK/API usage;
- Gemini/Google AI usage;
- Groq usage;
- Anthropic/other provider usage if present;
- direct HTTP model calls;
- model names hardcoded in business code;
- field canonicalization AI;
- resume extraction;
- job normalization/intelligence AI;
- declaration classification;
- future/partial strategy-generation code;
- prompt builders;
- retry logic;
- schema validation;
- timeout behavior;
- token accounting;
- caching;
- logging;
- fallback logic;
- environment variables.

Create an inventory before modifying architecture.

Classify existing calls by AI task.

Do not blindly wrap provider calls while leaving business logic coupled to provider-specific response formats.

The goal is one coherent orchestration layer.

---

# P1 — AI Task & Domain Contracts

Define explicit AI task types.

Do not expose generic:

`runPrompt(prompt: string)`

as the primary domain API.

Features should request semantic capabilities.

Examples may include:

- `CANONICALIZE_FIELD`
- `DISAMBIGUATE_FIELD_CONTEXT`
- `CLASSIFY_DECLARATION`
- `EXTRACT_RESUME`
- `NORMALIZE_JOB`
- `CLASSIFY_JOB_REQUIREMENTS`
- `ANALYZE_EXECUTION_FAILURE`
- `GENERATE_STRATEGY_CANDIDATE`
- `COMPARE_STRATEGIES`
- `EXPLAIN_FORM_BEHAVIOR`

Only add tasks currently needed or clearly required by upcoming Q/R architecture.

Do not overbuild an enormous generic AI platform.

---

# AI request contract

Every task request should carry structured metadata such as:

- taskType;
- schemaVersion;
- workload/payload class;
- privacy classification;
- latency priority;
- cost priority;
- required capability;
- maximum acceptable cost/tokens;
- confidence requirement;
- idempotency/correlation ID;
- candidate/application scope where appropriate;
- fallback permission.

Business code should NOT specify a provider directly under normal operation.

Provider override may exist only for controlled testing/admin/debug situations if needed.

---

# AI response contract

Return a typed result.

Conceptually:

`AIResult<T>`

with metadata such as:

- validated result;
- taskType;
- provider;
- model;
- route/policy version;
- confidence/evaluation status;
- latency;
- token usage;
- estimated/actual cost where available;
- fallback/escalation count;
- cache status;
- failure class.

Do not make business code parse raw provider response bodies.

---

# Structured outputs

Every task that should return structured data must use:

- explicit schema;
- runtime validation;
- rejection of malformed outputs;
- safe retry/fallback policy.

Never trust model JSON simply because it parses.

Validate:

- enum membership;
- canonical IDs;
- entity IDs;
- strategy IDs;
- confidence bounds;
- expected arrays/objects;
- domain-specific invariants.

AI must not invent identifiers outside allowed candidate sets.

---

# P2 — Provider Adapter Layer

Implement provider-neutral adapters.

Examples may include:

- Gemini adapter;
- Groq adapter;
- OpenAI adapter.

Only include providers actually configured/intended by the current project.

Provider adapters own:

- request translation;
- authentication/config;
- provider-specific model naming;
- provider timeout;
- response normalization;
- usage extraction;
- provider error mapping;
- provider-specific structured-output mechanics.

Business/domain packages must not import provider SDKs directly after migration.

---

# Provider-specific failures

Normalize failures into common classes such as:

- `PROVIDER_UNAVAILABLE`
- `RATE_LIMITED`
- `TIMEOUT`
- `INVALID_RESPONSE`
- `SCHEMA_VALIDATION_FAILED`
- `CONTEXT_LIMIT`
- `AUTH_CONFIGURATION_ERROR`
- `SAFETY_REJECTED`
- `QUOTA_EXHAUSTED`
- `UNKNOWN_PROVIDER_FAILURE`

Do not make callers handle Gemini/Groq/OpenAI-specific error structures.

---

# P3 — Routing & Specialization Policy

Implement centralized routing.

Use the established architecture direction:

## Path A — Gemini-oriented workloads

Prefer Gemini where its capabilities/cost profile are appropriate for workloads such as:

- large files;
- PDFs/documents;
- very large context;
- long code/doc analysis;
- resume/document extraction where appropriate;
- large structured source material.

## Path B — Groq/Llama-oriented workloads

Prefer Groq for compact, low-latency structured tasks where appropriate, such as:

- small JSON decisions;
- compact canonicalization;
- classification;
- short reasoning tasks;
- high-volume low-cost calls.

## Fallback insurance — OpenAI mini/appropriate OpenAI model

Use OpenAI as fallback/escalation where:

- free/primary provider quota unavailable;
- confidence insufficient;
- schema repeatedly invalid;
- provider unavailable;
- task requires capability not reliably handled by current primary route.

Do NOT execute all free providers sequentially by default.

Route directly based on workload.

---

# Important routing invariant

The business subsystem should ask:

`execute task X`

P decides:

`provider/model Y`.

Q/J/R should not know:

- API key;
- provider quota;
- model IDs;
- fallback order;
- timeout details.

---

# Route policy versioning

Make routing policy identifiable/versionable.

Example conceptually:

`routePolicyVersion = P1`

This allows later evaluation of:

- quality;
- latency;
- cost;
- provider changes.

Do not scatter route decisions across switch statements in many packages.

---

# Task specialization registry

Create a central registry/config mapping:

`task`
→ required capabilities
→ preferred routes
→ acceptable fallbacks
→ timeout
→ confidence requirement
→ token/input limits
→ privacy policy
→ cache policy.

Keep it typed and testable.

Avoid a massive dynamic rules engine unless needed.

---

# P4 — Confidence, Fallback & Escalation

Do not treat model-reported confidence as authoritative.

Confidence should consider task-specific evidence.

Examples:

## Field canonicalization

Potential evidence:

- deterministic candidates;
- model choice among supplied IDs;
- candidate separation;
- schema validity;
- contextual consistency.

## Resume extraction

Potential evidence:

- schema completeness;
- field consistency;
- date validity;
- duplicated entities;
- parser evidence.

## Strategy analysis

Potential evidence:

- available execution traces;
- reproduction evidence;
- constraints satisfied.

---

# Escalation flow

Conceptually:

`primary route`
→ valid + sufficient confidence
→ return

otherwise:

`fallback/escalation route`
→ validate again

Do not loop indefinitely.

Use bounded attempts.

---

# Example

`CANONICALIZE_FIELD`

→ deterministic system already produced a small candidate set

→ Groq task

If:
- schema valid;
- selected canonical allowed;
- confidence sufficient;

return.

If not:

→ escalate to OpenAI fallback.

Do not invoke Gemini merely because it exists.

---

# Fallback constraints

Fallback should respect:

- privacy classification;
- cost ceiling;
- task urgency;
- provider capability;
- candidate/application context;
- maximum number of attempts.

Do not allow uncontrolled fallback chains.

---

# AI unavailable behavior

AI outage must not break deterministic product paths unnecessarily.

Examples:

Field canonicalization:
- deterministic high-confidence match should still work.

Job discovery:
- already normalized jobs should remain usable.

Extension:
- unresolved field should become `NEEDS_USER` rather than crashing application runtime.

Resume extraction:
- provide explicit retry/error state.

Graceful degradation is required.

---

# P5 — Cost, Quota & Token Controls

Implement centralized cost governance.

Track at least:

- task type;
- provider;
- model;
- input usage;
- output usage;
- latency;
- estimated/actual cost where available;
- cache hit;
- fallback/escalation.

Do not expose candidate private content in metrics.

---

# Cost budgets

Support appropriate limits such as:

- per task;
- per request;
- per candidate/user;
- per application;
- daily/monthly operational budgets where architecture supports it.

Do NOT implement full Phase S billing here.

P owns technical AI consumption controls.

S will later own customer plan/entitlement/billing behavior.

Keep boundaries clean.

---

# Token limits

Tasks should explicitly control:

- max input/context where possible;
- max output;
- prompt/context expansion;
- fallback context.

Do not send unnecessary context.

Examples:

Field canonicalization:
use compact default payload first.

Resume extraction:
large document path may legitimately use much larger context.

---

# Cost-aware routing

Routing may consider cost, but quality/safety requirements come first.

Do not choose a cheap model when the task requires a stronger capability and failure would create unsafe learning.

Likewise, do not use premium models for trivial deterministic classification when a cheaper path meets quality.

---

# Quotas

Handle provider:

- free quotas;
- per-minute limits;
- daily limits;
- rate limits;
- temporary exhaustion.

Do not let every concurrent request independently discover quota failure and hammer the same provider.

Add appropriate short-lived circuit/quota state.

---

# P6 — Privacy, Caching, Idempotency & Resilience

# Privacy classification

Every AI task should have an explicit privacy class.

Examples conceptually:

- `PUBLIC_JOB_DATA`
- `FIELD_METADATA_ONLY`
- `CANDIDATE_PRIVATE_DATA`
- `DOCUMENT_PRIVATE_DATA`
- `SENSITIVE_APPLICATION_DATA`

Use actual architecture terminology if similar classes already exist.

Routing/privacy policy should determine which providers/tasks are allowed.

Do not send private candidate data to a provider merely because it is the cheapest.

---

# Data minimization

Send only data required for the task.

Examples:

Field canonicalization:
do not send candidate answers.

Entity disambiguation:
send only minimal distinguishing descriptors.

Resume extraction:
document contents are legitimately required, but avoid unrelated candidate/application data.

Strategy analysis:
prefer value-private execution evidence.

---

# Prompt/log privacy

Do not log full AI prompts/responses containing candidate data into generic logs.

Use:

- task IDs;
- hashed/fingerprinted request metadata;
- token counts;
- provider/model;
- status;
- safe error summaries.

If private prompt debugging is ever necessary, isolate behind explicit development-only safeguards.

---

# Caching

Add caching only where semantically safe.

Good candidates may include:

- identical public job classification;
- field semantic evidence;
- stable declaration classification;
- other value-private deterministic AI tasks.

Be careful caching:

- candidate-specific answers;
- resume extractions;
- application-specific sensitive data.

Cache keys must include relevant schema/policy/model/task versions.

Do not reuse stale AI results after canonical registry/policy changes.

---

# Idempotency / deduplication

Concurrent identical AI requests should not unnecessarily create multiple expensive calls where safe.

Support request coalescing/deduplication for suitable tasks.

Do not merge requests across candidate/privacy boundaries incorrectly.

---

# Timeouts

Define task-specific timeouts.

Do not use one global timeout for:

- tiny classification;
- large resume parsing;
- strategy analysis.

---

# Retries

Retries should be bounded and reason-aware.

Example:

network transient
→ retry same provider once if safe.

schema invalid
→ perhaps one repair/retry or fallback.

auth configuration error
→ do not repeatedly retry.

rate limit
→ route/fallback or fail according to policy.

---

# Circuit breaker / provider health

Implement lightweight provider health protection.

If a provider is repeatedly failing:

temporarily stop routing eligible tasks there.

Do not create an unnecessarily complex distributed system.

A simple bounded circuit mechanism is enough if architecture warrants it.

---

# P7 — Observability, Evaluation & Admin Foundation

Create value-private AI observability.

Metrics should support:

- requests by task;
- provider/model distribution;
- success rate;
- schema failure;
- fallback frequency;
- escalation frequency;
- latency;
- token usage;
- estimated cost;
- cache hit rate;
- provider failure;
- confidence rejection.

Do not emit private prompts/responses.

---

# Task-level evaluation

Measure quality per task rather than one global AI success score.

Examples:

`CANONICALIZE_FIELD`
→ accepted mapping / later correction signal.

`EXTRACT_RESUME`
→ schema validity / user corrections / extraction completeness.

`ANALYZE_EXECUTION_FAILURE`
→ admin acceptance / strategy usefulness later.

Do not prematurely build Q's strategy-learning engine.

P should provide the execution/evaluation metadata Q will need.

---

# Traceability

An AI result should be traceable to:

- task type;
- task version;
- route policy version;
- provider;
- model;
- prompt/schema version;
- operation/application correlation where allowed.

This enables later debugging without storing sensitive prompt content.

---

# Admin foundation

Create only enough interfaces/data so future Phase T can inspect:

- provider health;
- usage;
- costs;
- fallback rates;
- task failures.

Do NOT build the full Admin/Ops UI here.

---

# P8 — Migrate Existing AI Integrations

Once orchestrator is ready, migrate existing AI callers.

At minimum inspect and migrate AI usage in applicable completed phases such as:

- H Job Intelligence;
- J Field Intelligence;
- O Declaration classification if AI is used;
- resume extraction currently existing from G/current system;
- other current V2 AI calls.

Do NOT leave direct provider calls scattered across V2.

---

# Migration rule

Before:

`FieldIntelligenceService`
→ Gemini/Groq/OpenAI SDK

After:

`FieldIntelligenceService`
→ `AIOrchestrator.execute(CANONICALIZE_FIELD, ...)`

Provider-specific response handling belongs inside P.

---

# Do not break existing task-specific semantics

Migration must preserve:

- existing compact J payload;
- deterministic-first behavior;
- schema validation;
- Candidate Truth privacy;
- declaration policy authority;
- job intelligence provenance.

Do not make business logic more generic at the expense of correctness.

---

# Resume/document integration boundary

Phase R will later expand Resume & Document Intelligence.

Phase P should provide the AI task infrastructure R can consume.

Do NOT prematurely build the entire R feature set.

But ensure large-document/PDF task routing is possible.

---

# Q integration boundary

Phase Q will need AI capabilities such as:

- execution failure analysis;
- candidate strategy generation;
- strategy comparison;
- maybe test-case generation.

Q should call P via task contracts.

Do NOT build Q yet.

Create clean P task interfaces where required.

---

# Deterministic-first principle

P is not permission to use AI everywhere.

Business layers should continue using deterministic logic first where appropriate.

Example:

J:

`deterministic canonical match`
→ success
→ no P call.

Only low-confidence path goes to P.

Likewise:

O deterministic policy must remain authoritative.

AI can classify declaration text.

AI cannot override O's policy.

---

# Security

Provider API keys must remain server-side/appropriate secure runtime.

Do not expose provider credentials in:

- frontend;
- extension;
- browser bundle;
- logs;
- checkpoint.

Extension/browser should call backend-controlled AI endpoints where architecture requires it.

Do not let arbitrary client input select any model/provider and create unrestricted spend.

---

# Rate abuse protection

Protect AI endpoints against:

- unauthorized candidate;
- arbitrary task type;
- oversized payload;
- repeated spam;
- invalid schema;
- candidate-crossing cache misuse.

Use auth/ownership/request validation.

---

# Error model

Create explicit orchestrator-level errors such as:

- `AI_TASK_UNSUPPORTED`
- `AI_ROUTE_UNAVAILABLE`
- `AI_BUDGET_EXCEEDED`
- `AI_QUOTA_EXHAUSTED`
- `AI_PROVIDER_UNAVAILABLE`
- `AI_RATE_LIMITED`
- `AI_TIMEOUT`
- `AI_SCHEMA_INVALID`
- `AI_CONFIDENCE_INSUFFICIENT`
- `AI_PRIVACY_POLICY_BLOCKED`
- `AI_CONTEXT_TOO_LARGE`
- `AI_FALLBACK_EXHAUSTED`

Do not return opaque provider error strings to domain code.

---

# Concurrency

Handle many concurrent AI tasks safely.

Avoid:

- duplicate identical requests;
- rate-limit storms;
- shared mutable provider state corruption;
- candidate-crossing caches;
- unbounded parallel fallback calls.

Use bounded concurrency where appropriate.

---

# Testing requirements

Add comprehensive tests for:

- task registry;
- unsupported task;
- provider adapter normalization;
- provider errors;
- primary route selection;
- workload-based routing;
- large document route;
- compact JSON route;
- route policy versioning;
- fallback;
- escalation;
- insufficient confidence;
- malformed structured response;
- invalid canonical/entity IDs;
- timeout;
- rate limit;
- quota exhaustion;
- budget exceeded;
- privacy-policy rejection;
- caching;
- cache version invalidation;
- request deduplication;
- candidate isolation;
- retry bounds;
- circuit breaker/provider health;
- provider recovery;
- cost accounting;
- usage accounting;
- direct provider-call migration;
- deterministic path avoiding unnecessary AI.

Use mocks/fakes for provider APIs in automated tests.

Do not make standard tests depend on live paid API calls.

---

# Integration tests

Add tests proving business layers use P correctly.

Examples:

## J deterministic high confidence

No AI call.

## J low confidence

Calls P with `CANONICALIZE_FIELD`.

P selects route.

Validated result returns.

## Primary provider failure

P falls back according to policy.

J should not know fallback happened except through optional metadata.

## O classification

AI may classify declaration but O retains policy authority.

## Resume extraction

Large-document route selected appropriately.

---

# Browser/product regression

Phase P is primarily backend/infrastructure, but integration must not break:

- onboarding;
- master resume;
- job discovery;
- extension;
- Field Intelligence;
- declaration handling.

Use browser checks for representative AI-dependent flows.

Inspect:

- network;
- AI endpoint failures;
- CORS/auth;
- duplicate requests;
- loading states;
- graceful fallback.

Do not expose provider names/internal errors unnecessarily to candidates.

---

# Performance

Measure obvious overhead from orchestration.

The orchestrator itself should not add large latency.

Avoid:

- unnecessary serialization;
- repeated token estimation;
- sequential providers by default;
- excessive logging;
- excessive database writes per AI request.

Prefer one direct chosen route with bounded fallback only when needed.

---

# Legacy AI cleanup

Search again after migration.

There should not remain silent direct provider calls in V2 business layers unless explicitly documented and justified.

Look for:

- OpenAI client construction;
- Google AI SDK;
- Groq SDK;
- raw model endpoint URLs;
- hardcoded model names.

Provider-specific code should live inside P/provider adapters.

Remove obsolete duplicated retry/cost/fallback logic.

Record any intentionally deferred integration.

---

# Architecture invariants

Preserve:

`J/H/O/R/Q etc.`
→ request AI capability

`P`
→ provider/model routing + privacy + cost + fallback

`provider adapter`
→ provider-specific execution.

Do NOT allow:

- provider selection inside business domain code;
- extension to hold provider secrets;
- AI to bypass O policy;
- AI to mutate Candidate Truth directly;
- AI response to bypass schema/domain validation;
- Q later to call providers directly;
- cache reuse across unsafe privacy boundaries.

---

# Do not overbuild future phases

Do NOT fully implement:

- **Q — Strategy Intelligence**
- **R — Resume & Document Intelligence**
- **S — Billing**
- **T — Admin/Ops**
- **U — ATS Certification**

Build only P infrastructure/interfaces they need.

---

# Efficient execution requirement

Because context is limited:

- inventory existing AI usage once;
- document it in the checkpoint;
- build P core;
- migrate integrations systematically;
- use focused tests;
- avoid repeatedly rereading the entire repository;
- run live/provider tests only where necessary and authorized;
- never expose credentials;
- checkpoint before context pressure becomes critical.

Prioritize:

1. one authoritative AI boundary;
2. typed task contracts;
3. correct routing;
4. privacy;
5. bounded fallback;
6. cost/quota control;
7. migration of direct callers;
8. tests/observability.

---

# Mandatory behavior locks

Add tests proving:

**Business code cannot require a specific provider for normal production tasks.**

**J deterministic high-confidence mappings do not call AI.**

**Compact tasks do not unnecessarily take the expensive/large-context route.**

**Large-document tasks can use the appropriate large-context route.**

**Primary provider failure falls back only according to bounded policy.**

**Malformed AI output never enters domain state.**

**AI cannot invent canonical/entity/strategy IDs.**

**Privacy policy can block a provider/route.**

**Candidate-private cache entries cannot leak across candidates.**

**OpenAI fallback is not invoked when the primary result is already valid and sufficient.**

---

# Final Phase P verification

Before declaring Phase P complete:

1. run architecture checks;
2. run lint;
3. run typecheck;
4. run build;
5. run complete automated tests;
6. inspect all direct AI provider calls;
7. verify provider adapters are centralized;
8. verify task registry;
9. verify routing policies;
10. test primary provider success;
11. test provider failure/fallback;
12. test insufficient confidence escalation;
13. test malformed schema;
14. test quota/rate limits;
15. test budget blocking;
16. test privacy route blocking;
17. test caching/deduplication;
18. verify usage/cost metrics;
19. verify J integration;
20. verify current resume extraction integration;
21. verify H/O integrations where AI is used;
22. run representative browser/product flows;
23. verify secrets are not present in frontend/extension bundles;
24. rerun search for direct provider SDK usage;
25. update `docs/IMPLEMENTATION_CHECKPOINT.md`.

The final checkpoint must document:

- P1–P8 status;
- task registry;
- provider adapters;
- routing policy;
- provider/model specialization;
- fallback/escalation;
- confidence policy;
- cost/token controls;
- quota behavior;
- privacy classifications;
- caching/idempotency;
- provider-health behavior;
- observability;
- migrated integrations;
- remaining intentional direct-provider code, if any;
- tests/counts/results;
- genuine limitations.

Only mark:

**Phase P — AI Orchestrator: COMPLETE**

when one authoritative production AI orchestration path is established and existing V2 AI consumers are migrated to it.

Set the next exact boundary to:

**Phase Q — Strategy Intelligence**

Do not perform Git commit, push, remote deployment, hosting, release, or production credential changes unless explicitly requested.
