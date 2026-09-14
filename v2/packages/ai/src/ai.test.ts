import assert from "node:assert/strict";
import test from "node:test";
import { AiError, type AiRequest, type Provider, type Privacy } from "./contracts.js";
import { AiOrchestrator } from "./orchestrator.js";
import { RestProviderAdapter, type ProviderAdapter, type ProviderRequest, type ProviderResponse } from "./providers.js";
import { createConfiguredAi } from "./config.js";

export function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return { schemaVersion: 1, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
    scope: { accountId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: null },
    privacy: "FIELD_METADATA_ONLY", latencyPriority: "INTERACTIVE", costPriority: "ECONOMY", maxCostMicros: 100_000,
    maxOutputTokens: 700, minimumConfidence: 0.72, allowFallback: true, taskType: "CANONICALIZE_FIELD",
    payload: { field: { label: "Company", type: "TEXT" }, context: { section: "Current company", previousLabel: null, nextLabel: null },
      candidateCanonicals: [{ canonicalKey: "CURRENT_COMPANY", description: "Current company employer" }, { canonicalKey: "FIRST_NAME", description: "First given name" }],
      containsCandidateValue: false }, ...overrides } as AiRequest;
}
const good = { selectedCanonical: "CURRENT_COMPANY", confidence: 0.96, ambiguous: false,
  ranking: [{ canonicalKey: "CURRENT_COMPANY", confidence: 0.96 }], reasonCategory: "LABEL_CONTEXT" };
function fake(provider: Provider, run: (r: ProviderRequest) => Promise<ProviderResponse> = async () => ({ value: good, usage: { inputTokens: 100, outputTokens: 50 } }),
  privacy: Privacy[] = ["FIELD_METADATA_ONLY", "DOCUMENT_PRIVATE_DATA"]): ProviderAdapter {
  return { provider, model: "fixture-v1", maxInputTokens: 300_000, inputMicrosPerToken: 1, outputMicrosPerToken: 1, privacy, execute: run };
}
test("P normal tasks cannot select provider, model, prompt, or unsupported task", async () => {
  const ai = new AiOrchestrator([]);
  for (const property of ["provider", "model", "prompt"]) await assert.rejects(ai.execute({ ...request(), [property]: "injected" }), /AI_SCHEMA_INVALID/);
  await assert.rejects(ai.execute({ ...request(), taskType: "UNKNOWN" } as unknown as AiRequest), /AI_TASK_UNSUPPORTED/);
});
test("P compact success routes directly and never calls fallback or document provider", async () => {
  const calls: Provider[] = [];
  const ai = new AiOrchestrator(["GROQ", "GEMINI", "OPENAI"].map((p) => fake(p as Provider, async () => {
    calls.push(p as Provider); return { value: good, usage: { inputTokens: 100, outputTokens: 50 } };
  })));
  const result = await ai.execute(request());
  assert.equal(result.ok, true); assert.deepEqual(calls, ["GROQ"]);
  assert.equal(result.metadata.confidence, 0.9); assert.equal(result.metadata.policyVersion, "P1-2026-09");
});
test("P fallback is bounded, reason-aware and records every reserved attempt", async () => {
  const calls: string[] = [];
  const ai = new AiOrchestrator([
    fake("GROQ", async () => { calls.push("GROQ"); throw new AiError("AI_PROVIDER_UNAVAILABLE"); }),
    fake("OPENAI", async () => { calls.push("OPENAI"); return { value: good, usage: null }; })
  ]);
  const result = await ai.execute(request());
  assert.equal(result.ok, true); assert.deepEqual(calls, ["GROQ", "OPENAI"]);
  assert.equal(result.metadata.fallbackCount, 1);
  assert.equal(result.metadata.attempts[0]?.failure, "AI_PROVIDER_UNAVAILABLE");
  assert.ok(result.metadata.totalCostMicros > 0);
  const disabled = await ai.execute(request({ allowFallback: false }));
  assert.equal(disabled.ok, false);
});
test("P malformed, invented and unsupported-confidence outputs cannot enter domain state", async () => {
  for (const value of [
    { ...good, selectedCanonical: "INVENTED" },
    { ...good, ranking: [{ canonicalKey: "INVENTED", confidence: 1 }] },
    { ...good, selectedCanonical: "FIRST_NAME", confidence: 1 },
    { ...good, confidence: 2 }, { unexpected: true }
  ]) {
    const result = await new AiOrchestrator([fake("GROQ", async () => ({ value, usage: null }))]).execute(request());
    assert.equal(result.ok, false);
  }
});
test("P large-document route requires approved privacy and exact source evidence", async () => {
  const input = request({ taskType: "EXTRACT_RESUME", privacy: "DOCUMENT_PRIVATE_DATA",
    payload: { text: "Full name: Example Person", allowedFields: ["FULL_NAME"] } });
  const value = { fields: [{ itemKey: "full-name", canonicalKey: "FULL_NAME", entityType: null, entityGroupKey: null,
    value: { kind: "TEXT", value: "Example Person" }, sourceSection: "HEADER", sourceQuote: "Full name: Example Person" }] };
  let groq = 0, gemini = 0;
  const ai = new AiOrchestrator([fake("GROQ", async () => { groq++; return { value, usage: null }; }), fake("GEMINI", async () => { gemini++; return { value, usage: null }; })]);
  assert.equal((await ai.execute(input)).ok, true); assert.equal(groq, 0); assert.equal(gemini, 1);
  const blocked = await new AiOrchestrator([fake("GEMINI", undefined, ["FIELD_METADATA_ONLY"])]).execute(input);
  assert.equal(blocked.ok ? "" : blocked.error, "AI_PRIVACY_POLICY_BLOCKED");
  const invented = await new AiOrchestrator([fake("GEMINI", async () => ({ value: { fields: [{ ...value.fields[0], value: "Invented" }] }, usage: null }))]).execute(input);
  assert.equal(invented.ok, false);
});
test("P structured resume extraction preserves repeatable entities and rejects hallucinations or impossible dates", async () => {
  const text = [
    "EXPERIENCE", "Engineer, Example Labs January 2022 - present", "Built services with TypeScript",
    "PROJECTS", "Project Atlas 2023 - 2024", "TypeScript React",
    "CERTIFICATIONS", "Cloud Certificate Example Issuer 2024"
  ].join("\n");
  const input = request({ taskType: "EXTRACT_RESUME", privacy: "DOCUMENT_PRIVATE_DATA", maxOutputTokens: 8_000,
    payload: { text, allowedFields: ["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE", "EMPLOYMENT_DATE_RANGE",
      "PROJECT_NAME", "PROJECT_TECHNOLOGIES", "CERTIFICATION_NAME", "CERTIFICATION_DATE"] } });
  const fields = [
    { itemKey: "work-company", canonicalKey: "EMPLOYMENT_COMPANY", entityType: "EMPLOYMENT", entityGroupKey: "work-1",
      value: { kind: "TEXT", value: "Example Labs" }, sourceSection: "EXPERIENCE", sourceQuote: "Engineer, Example Labs January 2022 - present" },
    { itemKey: "work-title", canonicalKey: "EMPLOYMENT_TITLE", entityType: "EMPLOYMENT", entityGroupKey: "work-1",
      value: { kind: "TEXT", value: "Engineer" }, sourceSection: "EXPERIENCE", sourceQuote: "Engineer, Example Labs January 2022 - present" },
    { itemKey: "work-dates", canonicalKey: "EMPLOYMENT_DATE_RANGE", entityType: "EMPLOYMENT", entityGroupKey: "work-1",
      value: { kind: "DATE_RANGE", start: "2022-01-01", end: null, precision: "MONTH", current: true }, sourceSection: "EXPERIENCE", sourceQuote: "Engineer, Example Labs January 2022 - present" },
    { itemKey: "project-name", canonicalKey: "PROJECT_NAME", entityType: "PROJECT", entityGroupKey: "project-1",
      value: { kind: "TEXT", value: "Project Atlas" }, sourceSection: "PROJECTS", sourceQuote: "Project Atlas 2023 - 2024" },
    { itemKey: "project-tech", canonicalKey: "PROJECT_TECHNOLOGIES", entityType: "PROJECT", entityGroupKey: "project-1",
      value: { kind: "LIST", values: ["TypeScript", "React"] }, sourceSection: "PROJECTS", sourceQuote: "TypeScript React" },
    { itemKey: "certificate-name", canonicalKey: "CERTIFICATION_NAME", entityType: "CERTIFICATION", entityGroupKey: "cert-1",
      value: { kind: "TEXT", value: "Cloud Certificate" }, sourceSection: "CERTIFICATIONS", sourceQuote: "Cloud Certificate Example Issuer 2024" },
    { itemKey: "certificate-date", canonicalKey: "CERTIFICATION_DATE", entityType: "CERTIFICATION", entityGroupKey: "cert-1",
      value: { kind: "DATE", value: "2024-01-01", precision: "YEAR" }, sourceSection: "CERTIFICATIONS", sourceQuote: "Cloud Certificate Example Issuer 2024" }
  ];
  const valid = await new AiOrchestrator([fake("GEMINI", async () => ({ value: { fields }, usage: null }))]).execute(input);
  assert.equal(valid.ok, true);
  for (const invalidFields of [
    fields.map((field) => field.itemKey === "project-tech" ? { ...field, value: { kind: "LIST", values: ["InventedSkill"] } } : field),
    fields.map((field) => field.itemKey === "work-dates" ? { ...field, value: { kind: "DATE_RANGE", start: "2025-01-01", end: "2024-01-01", precision: "MONTH", current: false } } : field),
    [...fields, { ...fields[0], itemKey: "duplicate-company", canonicalKey: "EMPLOYMENT_COMPANY" }]
  ]) {
    const result = await new AiOrchestrator([fake("GEMINI", async () => ({ value: { fields: invalidFields }, usage: null }))]).execute({ ...input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
    assert.equal(result.ok, false);
  }
});
test("P routes document generation as private data and rejects unknown claims, skills and metrics", async () => {
  const truthId = crypto.randomUUID();
  const input = request({
    taskType: "TAILOR_RESUME", privacy: "DOCUMENT_PRIVATE_DATA", maxOutputTokens: 8_000,
    payload: {
      sourceDocumentId: crypto.randomUUID(), jobId: crypto.randomUUID(), applicationId: null, strength: "FOCUSED",
      candidateClaims: [{ sourceId: `truth:${truthId}`, sourceType: "CANDIDATE_TRUTH", canonicalKey: "SKILLS", text: "TypeScript and Node.js" }],
      jobClaims: [
        { sourceId: "job:title", sourceType: "JOB_INTELLIGENCE", canonicalKey: "JOB_TITLE", text: "Backend Engineer" },
        { sourceId: "job:company", sourceType: "JOB_INTELLIGENCE", canonicalKey: "COMPANY_NAME", text: "Example Labs" },
        { sourceId: "job:required-java", sourceType: "JOB_INTELLIGENCE", canonicalKey: "REQUIRED_SKILL", text: "Java" }
      ]
    }
  });
  const valid = {
    title: "Backend Engineer", titleSourceClaimIds: ["job:title"],
    blocks: [{ kind: "BULLET", text: "TypeScript and Node.js", sourceClaimIds: [`truth:${truthId}`] }]
  };
  let routed: Provider | null = null;
  const ai = new AiOrchestrator([
    fake("GROQ", async () => { routed = "GROQ"; return { value: valid, usage: null }; }),
    fake("GEMINI", async () => { routed = "GEMINI"; return { value: valid, usage: null }; })
  ]);
  assert.equal((await ai.execute(input)).ok, true);
  assert.equal(routed, "GEMINI");
  for (const invalid of [
    { ...valid, blocks: [{ kind: "BULLET", text: "TypeScript", sourceClaimIds: ["truth:00000000-0000-4000-8000-000000000099"] }] },
    { ...valid, blocks: [{ kind: "BULLET", text: "Expert Java engineer", sourceClaimIds: ["job:required-java"] }] },
    { ...valid, blocks: [{ kind: "BULLET", text: "Improved TypeScript throughput by 40%", sourceClaimIds: [`truth:${truthId}`] }] }
  ]) {
    const result = await new AiOrchestrator([fake("GEMINI", async () => ({ value: invalid, usage: null }))])
      .execute({ ...input, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
    assert.equal(result.ok, false);
  }
});
test("P caches only valid versioned scoped semantics, coalesces and rejects changed replay", async () => {
  let calls = 0;
  const ai = new AiOrchestrator([fake("GROQ", async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { value: good, usage: null }; })]);
  const first = request();
  const results = await Promise.all([ai.execute(first), ai.execute({ ...first, requestId: crypto.randomUUID() })]);
  assert.equal(calls, 1); assert.equal(results[1]?.metadata.cache, "COALESCED");
  const cached = await ai.execute({ ...first, requestId: crypto.randomUUID() });
  assert.equal(cached.metadata.cache, "HIT"); assert.equal(cached.metadata.totalCostMicros, 0);
  const changed = await ai.execute({ ...first, maxOutputTokens: 500 });
  assert.equal(changed.ok ? "" : changed.error, "AI_IDEMPOTENCY_CONFLICT");
  await ai.execute({ ...first, scope: { ...first.scope, candidateId: crypto.randomUUID() } });
  assert.equal(calls, 2);
});
test("P cache expiry, rate circuits, recovery and process concurrency are bounded", async () => {
  let now = 0, fail = true, calls = 0;
  const ai = new AiOrchestrator([fake("GROQ", async () => { calls++; if (fail) throw new AiError("AI_RATE_LIMITED"); return { value: good, usage: null }; })], { now: () => now });
  await ai.execute(request()); await ai.execute(request()); assert.equal(calls, 1);
  now = 61_000; fail = false; assert.equal((await ai.execute(request())).ok, true);
  now = 400_000; await ai.execute(request()); assert.equal(calls, 3);
  const limited = new AiOrchestrator([fake("GROQ", async () => { await new Promise((r) => setTimeout(r, 10)); return { value: good, usage: null }; })], { maxConcurrent: 1 });
  const a = request(), b = request({ scope: { ...a.scope, candidateId: crypto.randomUUID() } });
  const result = await Promise.all([limited.execute(a), limited.execute(b)]);
  assert.equal(result[1]?.ok ? "" : result[1]?.error, "AI_QUOTA_EXHAUSTED");
});
test("P budget reservations include concurrent tasks and fallback ceilings", async () => {
  let calls = 0;
  const provider = fake("GROQ", async () => { calls++; return { value: good, usage: null }; });
  const blocked = await new AiOrchestrator([provider]).execute(request({ maxCostMicros: 0 }));
  assert.equal(blocked.ok ? "" : blocked.error, "AI_BUDGET_EXCEEDED"); assert.equal(calls, 0);
  const daily = new AiOrchestrator([provider], { dailyMicros: 1 });
  assert.equal((await daily.execute(request())).ok, false); assert.equal(calls, 0);
});
test("P timeout aborts and private results/unknown provider errors never leak", async () => {
  let aborted = false;
  const ai = new AiOrchestrator([fake("GROQ", async (r) => new Promise((_resolve, reject) => {
    r.signal.addEventListener("abort", () => { aborted = true; reject(new Error("PRIVATE-KEY")); });
  }))], { timeoutScale: 0.001 });
  const result = await ai.execute(request());
  assert.equal(result.ok ? "" : result.error, "AI_TIMEOUT"); assert.equal(aborted, true);
  assert.equal(JSON.stringify(ai.snapshot()).includes("PRIVATE-KEY"), false);
  assert.equal(JSON.stringify(ai.snapshot()).includes("Company"), false);
});
test("P provider adapters normalize wire formats, usage, refusal and HTTP failures", async () => {
  for (const provider of ["GROQ", "GEMINI", "OPENAI"] as const) {
    let captured: Record<string, unknown> = {};
    const transport: typeof fetch = async (_url, options) => {
      captured = JSON.parse(String(options?.body));
      return new Response(JSON.stringify(provider === "GEMINI" ? {
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(good) }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
      } : { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(good) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    };
    const config = { provider, model: "fixture", apiKey: "private-fixture-key", privacy: ["FIELD_METADATA_ONLY"] as Privacy[], maxInputTokens: 10_000, inputMicrosPerToken: 1, outputMicrosPerToken: 1 };
    const call = { instruction: "Classify", payload: {}, schema: {}, maxOutputTokens: 100, signal: new AbortController().signal };
    const result = await new RestProviderAdapter(config, transport).execute(call);
    assert.deepEqual(result.value, good); assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
    assert.ok(provider === "GEMINI" ? captured.generationConfig : captured.response_format);
    for (const [status, code] of [[429, "AI_RATE_LIMITED"], [401, "AI_AUTH_CONFIGURATION_ERROR"], [503, "AI_PROVIDER_UNAVAILABLE"]] as const) {
      await assert.rejects(new RestProviderAdapter(config, async () => new Response("private error", { status })).execute(call), new RegExp(code));
    }
  }
});
test("P config without keys disables routes and incomplete priced config fails safely", async () => {
  assert.equal((await createConfiguredAi({}).execute(request())).ok, false);
  assert.throws(() => createConfiguredAi({ AI_GROQ_API_KEY: "private-fixture-key" }), /AI_AUTH_CONFIGURATION_ERROR/);
});

test("P entity and strategy tasks reject invented identifiers and inconsistent evidence", async () => {
  const candidateEntityId = crypto.randomUUID();
  const entityRequest = request({ taskType: "DISAMBIGUATE_ENTITY", privacy: "CANDIDATE_PRIVATE_DATA",
    payload: { entityType: "EMPLOYMENT", group: { semanticRole: "CURRENT", identityKind: "STABLE_DOM", canonicalKeys: ["EMPLOYMENT_COMPANY"] },
      candidates: [{ candidateEntityId, recencyRank: 0, canonicalCoverage: ["EMPLOYMENT_COMPANY"] }], containsCandidateValue: false }
  });
  const goodEntity = { selectedCandidateEntityId: candidateEntityId, confidence: 0.99, ambiguous: false, reasonCategory: "COVERAGE_MATCH" };
  for (const selected of [candidateEntityId, crypto.randomUUID()]) {
    const ai = new AiOrchestrator([fake("GROQ", async () => ({ value: { ...goodEntity, selectedCandidateEntityId: selected }, usage: null }), ["CANDIDATE_PRIVATE_DATA"])]);
    assert.equal((await ai.execute(entityRequest)).ok, selected === candidateEntityId);
  }
  const strategyRequest = request({ taskType: "ANALYZE_EXECUTION_FAILURE",
    payload: { failureCode: "READBACK_FAILED", strategyIds: ["NATIVE_TEXT@1"], evidence: ["READBACK_MISMATCH"] } });
  const strategy = { strategyId: "INVENTED", diagnosis: "SELECTION_NOT_COMMITTED", evidence: ["READBACK_MISMATCH"] };
  assert.equal((await new AiOrchestrator([fake("GROQ", async () => ({ value: strategy, usage: null }))]).execute(strategyRequest)).ok, false);
});
test("P private results are not cached and safety refusal cannot fall through", async () => {
  let calls = 0;
  const input = request({ taskType: "EXTRACT_RESUME", privacy: "DOCUMENT_PRIVATE_DATA",
    payload: { text: "Example Person", allowedFields: ["FULL_NAME"] } });
  const value = { fields: [{ itemKey: "full-name", canonicalKey: "FULL_NAME", entityType: null, entityGroupKey: null,
    value: { kind: "TEXT", value: "Example Person" }, sourceSection: "HEADER", sourceQuote: "Example Person" }] };
  const ai = new AiOrchestrator([fake("GEMINI", async () => { calls++; return { value, usage: null }; })]);
  await ai.execute(input); await ai.execute(input); assert.equal(calls, 2);
  let fallback = 0;
  const blocked = new AiOrchestrator([fake("GROQ", async () => { throw new AiError("AI_SAFETY_REJECTED"); }),
    fake("OPENAI", async () => { fallback++; return { value: good, usage: null }; })]);
  assert.equal((await blocked.execute(request())).ok, false); assert.equal(fallback, 0);
});
test("P route model changes invalidate semantic cache and budgets include failed fallback", async () => {
  let calls = 0;
  const adapter = fake("GROQ", async () => { calls++; return { value: good, usage: null }; });
  const ai = new AiOrchestrator([adapter]);
  await ai.execute(request());
  Object.assign(adapter, { model: "fixture-v2" });
  await ai.execute(request()); assert.equal(calls, 2);
  let fallback = 0;
  const first = await new AiOrchestrator([fake("GROQ")]).execute(request());
  const cap = first.metadata.totalCostMicros;
  const bounded = await new AiOrchestrator([fake("GROQ", async () => { throw new AiError("AI_SCHEMA_INVALID"); }),
    fake("OPENAI", async () => { fallback++; return { value: good, usage: null }; })]).execute(request({ maxCostMicros: cap }));
  assert.equal(bounded.ok ? "" : bounded.error, "AI_BUDGET_EXCEEDED"); assert.equal(fallback, 0);
});
test("P Groq JSON-mode schema and provider refusal/truncation are normalized", async () => {
  const config = { provider: "GROQ" as const, model: "fixture-llama", apiKey: "fake", privacy: ["FIELD_METADATA_ONLY"] as Privacy[],
    maxInputTokens: 10_000, inputMicrosPerToken: 0, outputMicrosPerToken: 0, jsonMode: "JSON_OBJECT" as const };
  const call = { instruction: "Classify", payload: {}, schema: { type: "object" }, maxOutputTokens: 10, signal: new AbortController().signal };
  let wire: Record<string, unknown> = {};
  const adapter = new RestProviderAdapter(config, async (_url, options) => {
    wire = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(good) } }] }));
  });
  await adapter.execute(call);
  assert.deepEqual(wire.response_format, { type: "json_object" });
  assert.match(JSON.stringify(wire.messages), /Schema:/);
  for (const finish of ["length", "content_filter"]) {
    const failure = new RestProviderAdapter(config, async () => new Response(JSON.stringify({
      choices: [{ finish_reason: finish, message: { content: "{}" } }]
    })));
    await assert.rejects(failure.execute(call), /AI_SCHEMA_INVALID|AI_SAFETY_REJECTED|AI_OUTPUT_TRUNCATED/);
  }
});
