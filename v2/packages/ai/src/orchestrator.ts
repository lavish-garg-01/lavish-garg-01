import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { AI_POLICY_VERSION, AiError, AiRequestSchema, type AiFailure, type AiMetadata, type AiPort, type AiRequest, type AiResult, type Attempt, type Provider } from "./contracts.js";
import { TASKS, validateResult } from "./registry.js";
import type { ProviderAdapter } from "./providers.js";
import type { AiLedger } from "./ledger.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",") + "}";
  return JSON.stringify(value);
}
export interface AiEvent {
  requestId: string; taskType: AiRequest["taskType"]; taskVersion: number; schemaVersion: number;
  policyVersion: string; status: "ACCEPTED" | "REJECTED"; error: AiFailure | null;
  confidence: number; cache: AiMetadata["cache"]; attempts: Attempt[];
}
export interface AiOptions {
  ledger?: AiLedger; fingerprintSecret?: string;
  maxConcurrent?: number; dailyMicros?: number; candidateDailyMicros?: number; applicationDailyMicros?: number;
  requestsPerMinute?: number; providerRequestsPerMinute?: number;
  maxEntries?: number; now?: () => number; timeoutScale?: number;
  onEvent?: (event: AiEvent) => void;
}
interface Health { failures: number; until: number; inFlight: number; minute: number; requests: number }
interface Spend { day: number; amount: number }

export class AiOrchestrator implements AiPort {
  private readonly secret: Buffer;
  private readonly cache = new Map<string, { expires: number; result: AiResult }>();
  private readonly inFlight = new Map<string, Promise<AiResult>>();
  private readonly idempotency = new Map<string, { fingerprint: string; result?: AiResult; expires: number }>();
  private readonly spend = new Map<string, Spend>();
  private readonly rate = new Map<string, { minute: number; count: number }>();
  private readonly health = new Map<Provider, Health>();
  private readonly providers: Map<Provider, ProviderAdapter>;
  private active = 0;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly recentEvents: AiEvent[] = [];
  constructor(adapters: readonly ProviderAdapter[], private readonly options: AiOptions = {}) {
    this.secret = options.fingerprintSecret ? Buffer.from(options.fingerprintSecret) : randomBytes(32);
    this.providers = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
    if (this.providers.size !== adapters.length) throw new AiError("AI_AUTH_CONFIGURATION_ERROR");
    this.now = options.now ?? Date.now; this.maxEntries = options.maxEntries ?? 2_000;
  }
  private hash(value: unknown): string { return createHmac("sha256", this.secret).update(stable(value)).digest("hex"); }
  private metadata(request: AiRequest): AiMetadata {
    return { taskType: request.taskType, requestId: request.requestId, policyVersion: AI_POLICY_VERSION, taskVersion: TASKS[request.taskType].version,
      schemaVersion: 1, confidence: 0, cache: "MISS", attempts: [], totalCostMicros: 0, fallbackCount: 0 };
  }
  private reject(request: AiRequest, error: AiFailure): AiResult { return { ok: false, error, metadata: this.metadata(request) }; }
  private emit(result: AiResult): AiResult {
    const m = result.metadata;
    const event: AiEvent = { requestId: m.requestId, taskType: m.taskType, taskVersion: m.taskVersion, schemaVersion: m.schemaVersion,
      policyVersion: m.policyVersion, status: result.ok ? "ACCEPTED" : "REJECTED", error: result.ok ? null : result.error,
      confidence: m.confidence, cache: m.cache, attempts: structuredClone(m.attempts) };
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxEntries) this.recentEvents.shift();
    try { this.options.onEvent?.(structuredClone(event)); } catch { /* telemetry cannot change task success */ }
    return structuredClone(result);
  }
  /** Safe future admin/evaluation port; no payload, scope identity or credential is included. */
  snapshot() {
    return { active: this.active, health: [...this.health.entries()].map(([provider, state]) => ({ provider, ...state })),
      events: structuredClone(this.recentEvents), processLocal: true };
  }
  private prune(): void {
    const now = this.now(), day = Math.floor(now / 86_400_000), minute = Math.floor(now / 60_000);
    for (const [key, item] of this.cache) if (item.expires <= now) this.cache.delete(key);
    for (const [key, item] of this.idempotency) if (item.expires <= now && item.result) this.idempotency.delete(key);
    // Never evict a current budget/rate bucket; capacity pressure fails closed.
    if (this.active === 0) for (const [key, item] of this.spend) if (item.day !== day) this.spend.delete(key);
    for (const [key, item] of this.rate) if (item.minute !== minute) this.rate.delete(key);
  }
  async execute(raw: AiRequest): Promise<AiResult> {
    const parsed = AiRequestSchema.safeParse(raw);
    if (!parsed.success) throw new AiError(raw && !Object.hasOwn(TASKS, raw.taskType) ? "AI_TASK_UNSUPPORTED" : "AI_SCHEMA_INVALID");
    const request = parsed.data;
    this.prune();
    const policy = TASKS[request.taskType];
    if (request.privacy !== policy.privacy) return this.emit(this.reject(request, "AI_PRIVACY_POLICY_BLOCKED"));
    if (Buffer.byteLength(JSON.stringify(request.payload)) > policy.maxInputBytes) return this.emit(this.reject(request, "AI_CONTEXT_TOO_LARGE"));
    const scopeKey = this.hash(request.scope);
    const rateKey = this.hash({ account: request.scope.accountId, candidate: request.scope.candidateId });
    const minute = Math.floor(this.now() / 60_000);
    const rate = this.rate.get(rateKey) ?? { minute, count: 0 };
    if (rate.count >= (this.options.requestsPerMinute ?? 60) || (!this.rate.has(rateKey) && this.rate.size >= this.maxEntries)) return this.emit(this.reject(request, "AI_RATE_LIMITED"));
    rate.count++; this.rate.set(rateKey, rate);
    const semanticRequest = { ...request, requestId: undefined, idempotencyKey: undefined };
    const fingerprint = this.hash({ policy: AI_POLICY_VERSION, taskVersion: policy.version, request: semanticRequest,
      routes: [...this.providers.values()].map((p) => [p.provider, p.model, p.privacy, p.inputMicrosPerToken, p.outputMicrosPerToken]) });
    const idKey = this.hash([scopeKey, request.taskType, request.idempotencyKey]);
    const prior = this.idempotency.get(idKey);
    if (prior && prior.fingerprint !== fingerprint) return this.emit(this.reject(request, "AI_IDEMPOTENCY_CONFLICT"));
    const reuse = (result: AiResult, cache: AiMetadata["cache"]): AiResult => this.emit({
      ...structuredClone(result), metadata: { ...structuredClone(result.metadata), requestId: request.requestId, cache, attempts: [], totalCostMicros: 0, fallbackCount: 0 }
    });
    if (prior?.result) return reuse(prior.result, "HIT");
    const cached = this.cache.get(fingerprint);
    if (cached) return reuse(cached.result, "HIT");
    const pending = this.inFlight.get(fingerprint);
    if (pending) return reuse(await pending, "COALESCED");
    if (this.active >= (this.options.maxConcurrent ?? 4) || this.idempotency.size >= this.maxEntries) return this.emit(this.reject(request, "AI_QUOTA_EXHAUSTED"));
    this.idempotency.set(idKey, { fingerprint, expires: this.now() + 300_000 });
    this.active++;
    const promise = this.run(request);
    this.inFlight.set(fingerprint, promise);
    try {
      const result = await promise;
      if (this.options.ledger) {
        const m = result.metadata;
        try { await this.options.ledger.record(request.scope, { requestId: m.requestId, taskType: m.taskType,
          policyVersion: m.policyVersion, taskVersion: m.taskVersion, schemaVersion: m.schemaVersion,
          status: result.ok ? "ACCEPTED" : "REJECTED", error: result.ok ? null : result.error,
          confidence: m.confidence, cache: m.cache, attempts: m.attempts }); }
        catch { /* reservation remains durable even if diagnostic recording fails */ }
      }
      const record = this.idempotency.get(idKey);
      // Private tasks retain no private results beyond the active coalesced call.
      if (policy.cacheTtlMs > 0) {
        if (record) record.result = structuredClone(result);
        if (result.ok) {
          this.cache.set(fingerprint, { expires: this.now() + policy.cacheTtlMs, result: structuredClone(result) });
          if (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
        }
      } else this.idempotency.delete(idKey);
      return this.emit(result);
    } finally { this.active--; this.inFlight.delete(fingerprint); }
  }
  private reserve(request: AiRequest, amount: number): (() => void) | null {
    const day = Math.floor(this.now() / 86_400_000);
    const keys: [string, number][] = [
      ["global", this.options.dailyMicros ?? 1_000_000],
      [this.hash([request.scope.accountId, request.scope.candidateId]), this.options.candidateDailyMicros ?? 100_000]
    ];
    if (request.scope.applicationId) keys.push([this.hash([request.scope.accountId, request.scope.candidateId, request.scope.applicationId]), this.options.applicationDailyMicros ?? 50_000]);
    if (this.spend.size + keys.filter(([key]) => !this.spend.has(key)).length > this.maxEntries) return null;
    if (keys.some(([key, cap]) => (this.spend.get(key)?.day === day ? this.spend.get(key)!.amount : 0) + amount > cap)) return null;
    for (const [key] of keys) {
      const item = this.spend.get(key);
      this.spend.set(key, { day, amount: (item?.day === day ? item.amount : 0) + amount });
    }
    // Reservations are deliberately retained at the conservative ceiling even
    // on timeout/invalid output: a remotely executed request may still be billed.
    return () => undefined;
  }
  private async run(request: AiRequest): Promise<AiResult> {
    const policy = TASKS[request.taskType], metadata = this.metadata(request);
    const routes = request.allowFallback ? policy.providers : policy.providers.slice(0, 1);
    let last: AiFailure = "AI_ROUTE_UNAVAILABLE";
    for (const provider of routes) {
      const adapter = this.providers.get(provider);
      if (!adapter) continue;
      if (!adapter.privacy.includes(request.privacy)) { last = "AI_PRIVACY_POLICY_BLOCKED"; continue; }
      const minute = Math.floor(this.now() / 60_000);
      const health = this.health.get(provider) ?? { failures: 0, until: 0, inFlight: 0, minute, requests: 0 };
      if (health.minute !== minute) { health.minute = minute; health.requests = 0; }
      this.health.set(provider, health);
      if (health.until > this.now() || (health.failures >= 3 && health.inFlight > 0)) { last = "AI_PROVIDER_UNAVAILABLE"; continue; }
      if (health.requests >= (this.options.providerRequestsPerMinute ?? 30)) { last = "AI_RATE_LIMITED"; continue; }
      const schema = z.toJSONSchema(policy.output, { target: "draft-7" });
      delete schema.$schema;
      // Byte count is a deliberately conservative upper estimate for text token
      // budgeting; include the output schema and instructions sent to providers.
      const inputTokens = Buffer.byteLength(JSON.stringify(request.payload)) + Buffer.byteLength(JSON.stringify(schema)) + Buffer.byteLength(policy.instruction) + 256;
      if (inputTokens > adapter.maxInputTokens) { last = "AI_CONTEXT_TOO_LARGE"; continue; }
      const outputTokens = Math.min(policy.maxOutputTokens, request.maxOutputTokens);
      const ceiling = Math.ceil(inputTokens * adapter.inputMicrosPerToken + outputTokens * adapter.outputMicrosPerToken);
      if (metadata.totalCostMicros + ceiling > request.maxCostMicros || !this.reserve(request, ceiling)) { last = "AI_BUDGET_EXCEEDED"; continue; }
      if (this.options.ledger) {
        try {
          const reserved = await this.options.ledger.reserve({
            key: this.hash([request.scope, request.taskType, request.idempotencyKey, provider]),
            fingerprint: this.hash({ payload: request.payload, privacy: request.privacy, policy: AI_POLICY_VERSION, model: adapter.model }),
            ...request.scope, provider, model: adapter.model, taskType: request.taskType, amountMicros: ceiling,
            dailyLimitMicros: this.options.dailyMicros ?? 1_000_000,
            candidateLimitMicros: this.options.candidateDailyMicros ?? 100_000,
            applicationLimitMicros: this.options.applicationDailyMicros ?? 50_000
          });
          if (reserved !== "RESERVED") {
            last = reserved === "BUDGET_EXCEEDED" ? "AI_BUDGET_EXCEEDED" : reserved === "CONFLICT" ? "AI_IDEMPOTENCY_CONFLICT" : "AI_QUOTA_EXHAUSTED";
            break; // Ambiguous prior execution is never replayed on a new provider.
          }
        } catch { last = "AI_QUOTA_EXHAUSTED"; break; }
      }
      health.inFlight++; health.requests++;
      const started = this.now(), controller = new AbortController();
      const attempt: Attempt = { provider, model: adapter.model, latencyMs: 0, usage: null, chargedMicros: ceiling, usageEstimated: true, failure: null };
      metadata.attempts.push(attempt); metadata.totalCostMicros += ceiling;
      metadata.fallbackCount = Math.max(0, metadata.attempts.length - 1);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          adapter.execute({ instruction: policy.instruction, payload: request.payload, schema, maxOutputTokens: outputTokens, signal: controller.signal }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new AiError("AI_TIMEOUT")); }, policy.timeoutMs * (this.options.timeoutScale ?? 1));
          })
        ]);
        attempt.usage = response.usage;
        attempt.usageEstimated = response.usage === null;
        if (response.usage && (response.usage.inputTokens > inputTokens || response.usage.outputTokens > outputTokens)) throw new AiError("AI_CONTEXT_TOO_LARGE");
        const validated = validateResult(request, response.value);
        metadata.confidence = validated.confidence;
        if (validated.confidence < Math.max(policy.minimumConfidence, request.minimumConfidence)) throw new AiError("AI_CONFIDENCE_INSUFFICIENT");
        health.failures = 0; health.until = 0;
        return { ok: true, value: validated.value, metadata };
      } catch (error) {
        last = error instanceof AiError ? error.code : "AI_PROVIDER_UNAVAILABLE";
        attempt.failure = last;
        if (["AI_PROVIDER_UNAVAILABLE", "AI_TIMEOUT", "AI_RATE_LIMITED", "AI_AUTH_CONFIGURATION_ERROR"].includes(last)) {
          health.failures++;
          if (last === "AI_RATE_LIMITED" || last === "AI_AUTH_CONFIGURATION_ERROR" || health.failures >= 3) health.until = this.now() + 60_000;
        }
        if (last === "AI_SAFETY_REJECTED" || last === "AI_PRIVACY_POLICY_BLOCKED") break;
      } finally {
        if (timer) clearTimeout(timer);
        attempt.latencyMs = Math.max(0, this.now() - started); health.inFlight--;
      }
    }
    return { ok: false, error: last, metadata };
  }
}
