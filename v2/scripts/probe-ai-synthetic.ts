/** Opt-in, bounded live smoke test. Sends synthetic data only; never reads a résumé.
 * Run: npm run node -- --env-file=.env --import tsx scripts/probe-ai-synthetic.ts */
import { AiOrchestrator } from "../packages/ai/src/orchestrator.js";
import { RestProviderAdapter } from "../packages/ai/src/providers.js";
import type { AiRequest } from "../packages/ai/src/contracts.js";

for (const provider of ["GEMINI", "OPENAI"] as const) {
  const prefix = `AI_${provider}_`;
  const apiKey = process.env[`${prefix}API_KEY`];
  const model = process.env[`${prefix}MODEL`];
  if (!apiKey || !model) { console.log(JSON.stringify({ provider, status: "NOT_CONFIGURED" })); continue; }
  const adapter = new RestProviderAdapter({ provider, model, apiKey, privacy: ["FIELD_METADATA_ONLY", "DOCUMENT_PRIVATE_DATA"],
    maxInputTokens: Number(process.env[`${prefix}MAX_INPUT_TOKENS`]),
    inputMicrosPerToken: Number(process.env[`${prefix}INPUT_MICROS_PER_TOKEN`]), outputMicrosPerToken: Number(process.env[`${prefix}OUTPUT_MICROS_PER_TOKEN`]),
    jsonMode: process.env[`${prefix}JSON_MODE`] === "JSON_OBJECT" ? "JSON_OBJECT" : "STRICT_SCHEMA" }, async (url, options) => {
      const response = await fetch(url, options);
      if (!response.ok) { const body = await response.clone().json().catch(() => ({})) as { error?: { message?: string } };
        console.log(JSON.stringify({ provider, httpStatus: response.status, diagnostic: body.error?.message?.replaceAll(apiKey, "[redacted]").slice(0, 2500) })); }
      if (response.ok && provider === "GEMINI" && process.env.AI_PROBE_DIAGNOSTICS === "true") {
        const body = await response.clone().json() as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        console.log(JSON.stringify({ provider, syntheticResponse: body.candidates?.map((candidate) => ({ finishReason: candidate.finishReason,
          text: candidate.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") })) }));
      }
      return response;
    });
  const ai = new AiOrchestrator([adapter], { dailyMicros: 100_000, candidateDailyMicros: 100_000 });
  const base = { schemaVersion: 1 as const, scope: { accountId: "10000000-0000-4000-8000-000000000001", candidateId: "20000000-0000-4000-8000-000000000001", applicationId: null },
    privacy: "DOCUMENT_PRIVATE_DATA" as const, latencyPriority: "BACKGROUND" as const, costPriority: "QUALITY" as const,
    maxCostMicros: 30_000, maxOutputTokens: 1800, minimumConfidence: 0.9, allowFallback: true };
  const cases = [
    { taskType: "EXTRACT_RESUME", payload: { text: "Asha Example\nasha@example.com\nSkills: TypeScript, PostgreSQL", allowedFields: ["FULL_NAME", "EMAIL", "SKILLS"] } },
    { taskType: "TAILOR_RESUME", payload: { sourceDocumentId: "30000000-0000-4000-8000-000000000001", jobId: "40000000-0000-4000-8000-000000000001", applicationId: null, strength: "LIGHT",
      candidateClaims: [{ sourceId: "truth:10000000-0000-4000-8000-000000000001", sourceType: "CANDIDATE_TRUTH", canonicalKey: "FULL_NAME", text: "Asha Example" }, { sourceId: "truth:10000000-0000-4000-8000-000000000002", sourceType: "CANDIDATE_TRUTH", canonicalKey: "SKILLS", text: "TypeScript, PostgreSQL" }],
      jobClaims: [{ sourceId: "job:title", sourceType: "JOB_INTELLIGENCE", canonicalKey: "JOB_TITLE", text: "Backend Engineer" }, { sourceId: "job:company", sourceType: "JOB_INTELLIGENCE", canonicalKey: "COMPANY_NAME", text: "Example Company" }] } }
  ];
  for (const item of cases) {
    const result = await ai.execute({ ...base, ...item, requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() } as AiRequest);
    console.log(JSON.stringify({ provider, model, task: item.taskType, ok: result.ok, error: result.ok ? null : result.error,
      confidence: result.metadata.confidence, attempts: result.metadata.attempts.map((attempt) => ({ failure: attempt.failure, durationMs: attempt.durationMs })) }));
  }
}
