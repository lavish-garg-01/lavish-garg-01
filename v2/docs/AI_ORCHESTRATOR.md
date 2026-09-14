# AI orchestration — Phase P

One server-side owner lives in packages/ai. Features request semantic tasks; only provider adapters know credentials, endpoints and wire formats. The API composition root constructs one orchestrator and bridges existing J/M/G ports. There is no generic public prompt/model endpoint.

## Task registry and routing

Policy version is P1-2026-09; every task/schema version is 1.

- CANONICALIZE_FIELD: compact field metadata; Groq then optional OpenAI; 8-second attempts, 12 KB input payload, 700 output tokens, 0.72 evidence threshold, five-minute semantic cache.
- DISAMBIGUATE_ENTITY: bounded UUID/coverage metadata, classified candidate-private; Groq then optional OpenAI; 8 seconds, 16 KB, 400 tokens, 0.9 threshold; no result cache.
- EXTRACT_RESUME: document text and allowed contact fields; Gemini then optional OpenAI; 45 seconds, 240 KB, 2,000 tokens, 0.9 threshold; no result cache. P provides the large-document route, while G still parses PDFs locally. Binary PDF/OCR and richer document intelligence belong to R.
- ANALYZE_EXECUTION_FAILURE: bounded failure enums and supplied strategy IDs; Groq then optional OpenAI; 10 seconds, 8 KB, 500 tokens, 0.8 threshold, one-minute cache. It returns an analysis proposal, never executable code or authorization. Q owns strategy generation/evaluation/execution.

Workload/capability, privacy, timeout, limits and route preference belong to this typed registry. Caller latency/cost priorities are explicit metadata; they do not override the registry or weaken safety. This first version uses fixed economical routes rather than dynamic model auctions.

## Validation and confidence

Every provider response is parsed and schema-validated; truncated or refused responses are rejected. Canonical/entity/strategy IDs must belong to the supplied set. Candidate rankings cannot contain duplicate or invented IDs.

Model confidence is capped by deterministic evidence. Canonical confidence requires vocabulary/context separation; entity confidence requires unique coverage and non-ordinal identity; document fields require exact source/value quotes, permitted fields and format checks; diagnosis must match observed failure categories.

J still owns semantic confidence and O retains all declaration authority. AI results never directly update Candidate Truth. G's optional contact extraction only adds encrypted proposals for candidate review; it does not replace existing parser proposals or create entity IDs.

## Provider contracts and setup

Model IDs and prices are deliberately not hardcoded as current product truth. Configure AI_GROQ_*, AI_GEMINI_* and AI_OPENAI_* server variables from the examples in .env.example. Each enabled route requires a key, model ID, input context limit and nonnegative conservative input/output tariff in USD millionths per token. Missing route keys disable that route; incomplete configured routes fail startup with a sanitized configuration error.

Groq/OpenAI use chat completions; Gemini uses generateContent. Groq supports a JSON_OBJECT mode for Llama models lacking strict schema support; the full schema is then part of the instruction and local validation remains mandatory. No fallback provider is called when primary validation/evidence succeed.

Implementation formats were checked against [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Groq structured outputs](https://console.groq.com/docs/structured-outputs) and [Gemini generateContent structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Account availability, quotas, live model compatibility and negotiated pricing must be checked at provisioning; fake-provider tests do not certify those.

Production configuration requires the existing PostgreSQL ledger and stable server fingerprint secret. Apply migration 0018 before enabling keys. Keys never enter browser/extension bundles. The user's credential owner preference is recorded in CONTEXT_INDEX.md; no credentials were needed for fake-provider implementation tests.

Private candidate/document routes require per-provider AI_<PROVIDER>_ALLOW_PRIVATE=true. Resume extraction additionally requires AI_RESUME_ENABLED=true, and R document generation requires AI_DOCUMENT_GENERATION_ENABLED=true. All default off; document contents are not sent merely because a key is present.

## Budgets, idempotency and resilience

Before each dispatch, P reserves a conservative ceiling covering serialized payload, schema/instructions and bounded output. UTF-8 byte count is used as a conservative text-token estimate. The request cap includes all attempts. Unknown usage, timeouts and invalid output retain the reservation because remote work may still cost money. This is technical cost governance, not customer billing.

PostgreSQL ai_request_reservations serializes admission under a global advisory lock. Global/candidate/application daily totals survive restarts; authority and fingerprint checks reject foreign scope and changed replays. Duplicate uncertain dispatches stop safely; they are not replayed against another provider. Budgets use UTC dates.

Defaults: global 1 USD/day, candidate 0.10 USD/day, application 0.05 USD/day, four concurrent calls, 60 requests/candidate/minute and 30 requests/provider/minute. Operator global limit uses AI_DAILY_MICROS. The constructor exposes other limits for deployment composition.

At most two provider attempts occur for each capability request. J may separately enrich a compact payload with bounded field context; that is domain evidence enrichment, not provider selection. Provider auth/rate failures open a 60-second cooldown; three transient failures open the circuit; recovery is probed after cooldown. Timeout aborts fetch and bounds caller wait. Safety refusal stops fallback.

Caches and coalescing are scoped by account/candidate/application and task/policy/model/config/request limits. HMAC fingerprints contain no raw payload. Only safe successful semantic results enter the TTL cache; private result caching is disabled. Private completed requests keep only durable reservations, so restart/retry returns a safe duplicate refusal rather than retaining private results.

Short-lived circuits, rate counters and in-flight coalescing are process-local. Durable daily ceilings and dispatch keys remain shared across workers. A distributed minute-rate limiter or distributed result cache is deferred; deployments must account for per-process minute-rate capacity.

## Observability and ownership

Existing ai_usage_events now records task/schema/route version, request correlation, provider/model, usage, reserved micro-cost, confidence, cache status, latency and typed failure. Rows and reservations are append-only with account RLS. No prompt, response, raw document or candidate answer is stored there.

The bounded snapshot port includes provider health and recent value-private events, including cache/rejection states. Durable usage rows record actual attempts; cache-only and pre-dispatch rejections remain in the process event stream. A diagnostic write failure cannot undo a durable reservation or leak content; metrics delivery is best effort. Future T may expose these interfaces.

V2 inventory after migration: J's optional canonicalization port, M's optional entity port and G's optional contact proposal extraction enter P through apps/api/src/ai-bridges.ts. H and O remain deterministic. L learns verified domain facts and gains no provider dependency. Frozen V1 provider callers remain reference-only. Architecture checks block provider SDKs and direct provider endpoints outside packages/ai.

## Verification and limitations

Automated providers are fakes: no standard test needs a paid API or key. Tests cover route success/fallback, invalid IDs/schema/evidence, privacy, timeout, rate/circuit recovery, cache/coalescing/isolation, budgets, config and durable PostgreSQL reservation/evidence behavior. The Phase P browser mode reuses J's unpacked extension fixtures and injects invalid primary/fallback output to prove graceful degradation.

No live provider account/key, model quota or paid call is certified by these tests. Private extraction currently augments only grounded contact fields; PHONE proposals remain with G's existing country-aware parser. Full R document intelligence, Q strategy generation, S billing, T UI and U broad ATS certification remain outside P.
