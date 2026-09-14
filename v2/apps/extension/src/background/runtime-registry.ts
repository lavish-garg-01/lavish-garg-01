import { z } from "zod";
import { JourneySessionSchema, type JourneyEvidence } from "../shared/application-journey.js";
import { AutofillProgressSchema, type AutofillProgress } from "../shared/contracts.js";
import { ExecutionPlanResponseSchema, type ExecutionBatchReceipt, type ExecutionPlanResponse, type RuntimeStatus, type ScanResult } from "../shared/contracts.js";
import type { ExtensionFailure } from "../shared/errors.js";
import { ExtensionFailureSchema } from "../shared/errors.js";
import { RuntimeIdentitySchema } from "../shared/identity.js";
import { RuntimeStateSchema } from "../shared/runtime-state.js";
import { RuntimeStateMachine } from "../shared/runtime-state.js";
import type { StorageArea } from "./storage.js";
import {
  DeclarationReviewItemSchema,
  FormGraphTransitionReceiptSchema,
  ResolveFieldIntelligenceResponseSchema,
  type ResolveFieldIntelligenceResponse,
  type VerifyLearningCheckpointResponse
} from "@job-hunter-v2/contracts";

const storageKey = "jobHunter.extension.runtimes.v1";
const intelligenceStorageKey = "jobHunter.extension.fieldIntelligence.v1";
const IntelligenceSummarySchema = z.object({
  resolvedHigh: z.number().int().nonnegative(), resolvedMedium: z.number().int().nonnegative(),
  ambiguous: z.number().int().nonnegative(), unresolved: z.number().int().nonnegative(),
  unsupported: z.number().int().nonnegative(), answerAvailable: z.number().int().nonnegative(),
  declarationCount: z.number().int().nonnegative().default(0),
  at: z.iso.datetime()
}).strict();
const StepVisitSchema = z.object({
  logicalFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
  lastPageInstanceId: z.uuid(),
  visitCount: z.number().int().positive(),
  review: z.boolean(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime()
}).strict();
const RecordSchema = z.object({
  journey: JourneySessionSchema.nullable().default(null),
  autofill: AutofillProgressSchema.nullable().default(null),
  planSkips: ExecutionPlanResponseSchema.shape.skipped.default([]),
  identity: RuntimeIdentitySchema,
  contentVersion: z.string().min(1).max(40).default("unknown"),
  state: RuntimeStateSchema,
  origin: z.string().url().max(300),
  pathHash: z.string().length(8),
  lastScan: z.object({ fieldCount: z.number().int().nonnegative(), formCount: z.number().int().nonnegative(), at: z.iso.datetime() }).strict().nullable(),
  lastGraph: z.object({
    graphRevision: z.number().int().positive(), graphFingerprint: z.string().length(64).regex(/^[a-f0-9]+$/),
    nodeCount: z.number().int().nonnegative(), edgeCount: z.number().int().nonnegative(), stable: z.boolean(), at: z.iso.datetime()
  }).strict().nullable().default(null),
  stepHistory: z.array(StepVisitSchema).max(50).default([]),
  lastStepTransition: FormGraphTransitionReceiptSchema.nullable().default(null),
  lastIntelligence: IntelligenceSummarySchema.nullable().default(null),
  lastExecution: z.object({
    verified: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(), at: z.iso.datetime()
  }).strict().nullable().default(null),
  lastFailure: z.object({ failure: ExtensionFailureSchema, at: z.iso.datetime() }).strict().nullable().default(null),
  declarations: z.array(DeclarationReviewItemSchema).max(500).default([]),
  pendingSubmitAt: z.iso.datetime().nullable().default(null),
  lastLearning: z.object({
    changeSetId: z.uuid().nullable(), saved: z.number().int().nonnegative(),
    askAgain: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(), message: z.enum([
      "UPDATED_FOR_NEXT_TIME", "SOME_UPDATES_SAVED", "ASK_AGAIN_NEXT_TIME",
      "NO_REUSABLE_UPDATES", "COULD_NOT_SAVE_UPDATE", "UPDATES_UNDONE",
      "UPDATES_PARTIALLY_UNDONE", "NOTHING_TO_UNDO"
    ]), at: z.iso.datetime()
  }).strict().nullable().default(null),
  updatedAt: z.iso.datetime(),
  pendingJobId: z.uuid().nullable()
}).strict();
export type RuntimeRecord = z.infer<typeof RecordSchema>;
const StateSchema = z.record(z.string(), RecordSchema);

export class RuntimeRegistry {
  private queue = Promise.resolve();
  constructor(private readonly storage: StorageArea) {}

  async allRecords(): Promise<RuntimeRecord[]> { return Object.values(await this.read()); }

  recordJourney(tabId: number, frameId: number, pageInstanceId: string, evidence: JourneyEvidence, action: "OBSERVE" | "INSPECT" | "APPLY", targetOrigin: string | null): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read(); const key = this.key(tabId, frameId); const record = state[key];
      if (!record || record.identity.pageInstanceId !== pageInstanceId) throw new Error("STALE_FIELD_RUNTIME");
      const now = Date.now(); const previous = record.journey;
      const journey = evidence.stage === "UNRELATED" ? null : JourneySessionSchema.parse({
        sessionId: previous?.sessionId ?? crypto.randomUUID(), startedAt: previous?.startedAt ?? now, updatedAt: now,
        origin: record.origin, pathHash: record.pathHash, evidence,
        targetOrigin: action === "APPLY" ? targetOrigin : previous?.targetOrigin ?? null,
        userInitiated: action !== "OBSERVE" || previous?.userInitiated === true,
        manualPathHash: action === "INSPECT" ? record.pathHash : previous?.manualPathHash ?? null
      });
      const updated = RecordSchema.parse({ ...record, journey }); state[key] = updated; await this.write(state); return updated;
    });
  }

  bindRun(tabId: number, frameId: number, pageInstanceId: string, applicationId: string, applicationRunId: string): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read(); const key = this.key(tabId, frameId); const record = state[key];
      if (!record || record.identity.pageInstanceId !== pageInstanceId) throw new Error("STALE_FIELD_RUNTIME");
      const updated = RecordSchema.parse({ ...record, identity: { ...record.identity, applicationId, applicationRunId } });
      state[key] = updated; await this.write(state); return updated;
    });
  }

  recordProgress(tabId: number, frameId: number, progress: AutofillProgress): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read(); const key = this.key(tabId, frameId); const record = state[key];
      if (!record || record.identity.pageInstanceId !== progress.pageInstanceId) throw new Error("STALE_FIELD_RUNTIME");
      const updated = RecordSchema.parse({ ...record, autofill: progress, updatedAt: new Date().toISOString() });
      state[key] = updated; await this.write(state); return updated;
    });
  }

  private key(tabId: number, frameId: number): string { return `${tabId}:${frameId}`; }
  private async read(): Promise<Record<string, RuntimeRecord>> {
    const parsed = StateSchema.safeParse((await this.storage.get(storageKey))[storageKey]);
    return parsed.success ? parsed.data : {};
  }
  private async write(state: Record<string, RuntimeRecord>): Promise<void> { await this.storage.set({ [storageKey]: state }); }
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  register(input: { tabId: number; frameId: number; pageInstanceId: string; applicationKey: string | null; origin: string; pathHash: string; contentVersion: string }): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(input.tabId, input.frameId);
      const existing = state[runtimeKey];
      const tabRecord = state[this.key(input.tabId, 0)]
        ?? Object.values(state).find((record) => record.identity.tabId === input.tabId);
      const sameApplication = existing?.identity.applicationKey && existing.identity.applicationKey === input.applicationKey;
      const samePage = Boolean(sameApplication && existing?.identity.pageInstanceId === input.pageInstanceId);
      const confirmation = !input.applicationKey && existing?.origin === input.origin && (existing.pendingSubmitAt || existing.lastLearning);
      const pending = confirmation ? existing : existing?.pendingJobId
        ? existing
        : tabRecord?.pendingJobId && tabRecord.identity.applicationRunId
          ? tabRecord
          : null;
      const machine = new RuntimeStateMachine("IDLE");
      machine.transition("PAGE_DETECTED", existing ? "content-reconnected" : "content-registered");
      if (input.applicationKey) machine.transition("APPLICATION_DETECTED", "application-key-present");
      const record = RecordSchema.parse({
        journey: existing?.journey && Date.now() - existing.journey.updatedAt < 30 * 60_000
          && (existing.origin === input.origin || (existing.journey.userInitiated && existing.journey.targetOrigin === input.origin))
          ? existing.journey : null,
        identity: {
          tabSessionId: tabRecord?.identity.tabSessionId ?? crypto.randomUUID(),
          tabId: input.tabId,
          frameId: input.frameId,
          pageInstanceId: input.pageInstanceId,
          applicationId: sameApplication ? existing?.identity.applicationId : pending?.identity.applicationId ?? null,
          applicationRunId: sameApplication ? existing?.identity.applicationRunId : pending?.identity.applicationRunId ?? (input.applicationKey ? crypto.randomUUID() : null),
          formInstanceIds: [],
          applicationKey: input.applicationKey
        },
        contentVersion: input.contentVersion,
        state: machine.state,
        origin: input.origin,
        pathHash: input.pathHash,
        lastScan: samePage ? existing?.lastScan ?? null : null,
        lastGraph: samePage ? existing?.lastGraph ?? null : null,
        stepHistory: sameApplication ? existing?.stepHistory ?? [] : [],
        lastStepTransition: samePage ? existing?.lastStepTransition ?? null : null,
        lastIntelligence: samePage ? existing?.lastIntelligence ?? null : null,
        lastExecution: sameApplication ? existing?.lastExecution ?? null : null,
        lastFailure: samePage ? existing?.lastFailure ?? null : null,
        declarations: samePage ? existing?.declarations ?? [] : [],
        pendingSubmitAt: sameApplication || confirmation ? existing?.pendingSubmitAt ?? null : null,
        lastLearning: sameApplication || confirmation ? existing?.lastLearning ?? null : null,
        updatedAt: new Date().toISOString(),
        pendingJobId: pending?.pendingJobId ?? null
      });
      state[runtimeKey] = record;
      if (samePage) {
        await this.write(state);
      } else {
        const raw = (await this.storage.get(intelligenceStorageKey))[intelligenceStorageKey];
        const parsed = z.record(z.string(), ResolveFieldIntelligenceResponseSchema).safeParse(raw);
        const intelligence = parsed.success ? parsed.data : {};
        delete intelligence[runtimeKey];
        await this.storage.set({ [storageKey]: state, [intelligenceStorageKey]: intelligence });
      }
      return record;
    });
  }

  recordScan(tabId: number, frameId: number, result: ScanResult): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing || existing.identity.pageInstanceId !== result.pageInstanceId) throw new Error("STALE_PAGE_INSTANCE");
      const machine = new RuntimeStateMachine(existing.state);
      if (machine.state === "FAILED") machine.transition("RECOVERING", "scan-retry");
      if (machine.state !== "SCANNING") machine.transition("SCANNING", "scan-result-received");
      machine.transition(
        result.fields.length ? "READY" : existing.identity.applicationKey ? "APPLICATION_DETECTED" : "UNSUPPORTED",
        result.fields.length ? "fields-discovered" : existing.identity.applicationKey ? "application-fields-pending" : "no-fields"
      );
      const now = new Date().toISOString();
      const step = result.graph.nodes.find((node) => node.nodeType === "STEP" && node.currentStep) ?? null;
      const stepHistory = [...existing.stepHistory];
      if (step) {
        const existingIndex = stepHistory.findIndex((visit) => visit.logicalFingerprint === step.logicalFingerprint);
        const previous = existingIndex >= 0 ? stepHistory[existingIndex] : null;
        const visit = StepVisitSchema.parse({
          logicalFingerprint: step.logicalFingerprint,
          lastPageInstanceId: result.pageInstanceId,
          visitCount: (previous?.visitCount ?? 0) + (previous?.lastPageInstanceId === result.pageInstanceId ? 0 : 1),
          review: step.semanticRole === "REVIEW",
          firstSeenAt: previous?.firstSeenAt ?? now,
          lastSeenAt: now
        });
        if (existingIndex >= 0) stepHistory.splice(existingIndex, 1);
        stepHistory.push(visit);
        if (stepHistory.length > 50) stepHistory.splice(0, stepHistory.length - 50);
      }
      const record = RecordSchema.parse({ ...existing,
        identity: { ...existing.identity, formInstanceIds: result.formInstanceIds },
        state: machine.state,
        lastScan: { fieldCount: result.fields.length, formCount: result.formInstanceIds.length, at: now },
        lastGraph: {
          graphRevision: result.graph.graphRevision, graphFingerprint: result.graph.graphFingerprint,
          nodeCount: result.graph.summary.nodeCount, edgeCount: result.graph.summary.edgeCount,
          stable: result.graph.stable, at: now
        },
        stepHistory,
        lastStepTransition: result.stepTransition,
        lastIntelligence: null,
        declarations: [],
        updatedAt: now
      });
      state[runtimeKey] = record;
      const raw = (await this.storage.get(intelligenceStorageKey))[intelligenceStorageKey];
      const parsed = z.record(z.string(), ResolveFieldIntelligenceResponseSchema).safeParse(raw);
      const intelligence = parsed.success ? parsed.data : {};
      delete intelligence[runtimeKey];
      await this.storage.set({ [storageKey]: state, [intelligenceStorageKey]: intelligence });
      return record;
    });
  }

  recordIntelligence(tabId: number, frameId: number, result: ResolveFieldIntelligenceResponse, pageInstanceId?: string): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const parsed = ResolveFieldIntelligenceResponseSchema.parse(result);
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing) throw new Error("STALE_FIELD_RUNTIME");
      const at = new Date().toISOString();
      if (pageInstanceId && existing.identity.pageInstanceId !== pageInstanceId) throw new Error("STALE_FIELD_RUNTIME");
      const record = RecordSchema.parse({ ...existing, lastFailure: null, lastIntelligence: {
        resolvedHigh: parsed.summary.resolvedHigh, resolvedMedium: parsed.summary.resolvedMedium,
        ambiguous: parsed.summary.ambiguous, unresolved: parsed.summary.unresolved,
        unsupported: parsed.summary.unsupported, answerAvailable: parsed.summary.answerAvailable,
        declarationCount: parsed.items.filter((item) => item.semantic.declarationHint.state !== "NOT_DECLARATION").length, at
      }, updatedAt: at });
      state[runtimeKey] = record;
      const intelligence = (await this.storage.get(intelligenceStorageKey))[intelligenceStorageKey];
      const parsedStore = z.record(z.string(), ResolveFieldIntelligenceResponseSchema).safeParse(intelligence);
      const results = parsedStore.success ? parsedStore.data : {};
      results[runtimeKey] = parsed;
      await this.storage.set({ [storageKey]: state, [intelligenceStorageKey]: results });
      return record;
    });
  }

  recordExecution(tabId: number, frameId: number, result: ExecutionBatchReceipt): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing || existing.identity.pageInstanceId !== result.pageInstanceId || existing.identity.applicationRunId !== result.applicationRunId) {
        throw new Error("STALE_EXECUTION_RESULT");
      }
      const at = new Date().toISOString();
      const machine = new RuntimeStateMachine(existing.state);
      if (machine.state === "RECOVERING") machine.transition("READY", "execution-retry-completed");
      const declarationReceiptByFingerprint = new Map(result.receipts
        .filter((receipt) => receipt.declaration)
        .map((receipt) => [receipt.declaration!.decisionFingerprint, receipt]));
      const declarations = existing.declarations.map((item) => {
        const receipt = declarationReceiptByFingerprint.get(item.decisionFingerprint);
        if (!receipt) return item;
        if (receipt.verificationStatus === "USER_MODIFIED") {
          return { ...item, status: "CANDIDATE_MODIFIED" as const, failureCode: "DECLARATION_MODIFIED_BY_USER" as const };
        }
        if (receipt.status === "VERIFIED") return { ...item, status: "PREPARED_BY_COPILOT" as const, failureCode: null };
        const failureCode = receipt.failureClass?.startsWith("DECLARATION_")
          ? receipt.failureClass
          : "DECLARATION_EXECUTION_FAILED";
        return { ...item, status: "BLOCKED" as const, failureCode };
      });
      const record = RecordSchema.parse({
        ...existing,
        state: machine.state,
        declarations,
        lastExecution: {
          verified: result.receipts.filter((receipt) => receipt.status === "VERIFIED").length
            + result.actionReceipts.filter((receipt) => receipt.status === "VERIFIED_TRANSITION").length,
          failed: result.receipts.filter((receipt) => receipt.status === "FAILED" || receipt.status === "ABORTED").length
            + result.actionReceipts.filter((receipt) => receipt.status === "FAILED" || receipt.status === "ABORTED").length,
          skipped: result.skippedCount,
          at
        },
        lastFailure: null,
        updatedAt: at
      });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  recordDeclarationPlan(tabId: number, frameId: number, plan: ExecutionPlanResponse): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing || existing.identity.pageInstanceId !== plan.pageInstanceId || existing.identity.applicationRunId !== plan.applicationRunId) {
        throw new Error("STALE_DECLARATION_PLAN");
      }
      const record = RecordSchema.parse({ ...existing, declarations: plan.declarations, planSkips: plan.skipped, updatedAt: new Date().toISOString() });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  recordDeclarationCandidateAction(tabId: number, frameId: number, decisionFingerprint: string, candidateModified: boolean): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing) throw new Error("STALE_DECLARATION_ACTION");
      const declarations = existing.declarations.map((item) => item.decisionFingerprint === decisionFingerprint
        ? {
            ...item,
            status: candidateModified ? "CANDIDATE_MODIFIED" as const : "REVIEW_BEFORE_SUBMIT" as const,
            failureCode: candidateModified ? "DECLARATION_MODIFIED_BY_USER" as const : null
          }
        : item);
      const record = RecordSchema.parse({ ...existing, declarations, updatedAt: new Date().toISOString() });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  prepareLaunch(tabId: number, jobId: string, origin: string, applicationId: string, applicationRunId: string): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, 0);
      const record = RecordSchema.parse({
        identity: { tabSessionId: crypto.randomUUID(), tabId, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationId, applicationRunId, formInstanceIds: [], applicationKey: null },
        contentVersion: "unknown",
        state: "IDLE", origin, pathHash: "00000000", lastScan: null, lastGraph: null, stepHistory: [], lastStepTransition: null, lastIntelligence: null,
        lastExecution: null, lastFailure: null, declarations: [], pendingSubmitAt: null, lastLearning: null,
        updatedAt: new Date().toISOString(), pendingJobId: jobId
      });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  recordSubmitAttempt(tabId: number, frameId: number, occurredAt: string): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing?.identity.applicationId) throw new Error("APPLICATION_NOT_FOUND");
      const record = RecordSchema.parse({ ...existing, pendingSubmitAt: occurredAt, updatedAt: new Date().toISOString() });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  recordLearning(tabId: number, frameId: number, result: VerifyLearningCheckpointResponse): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing) throw new Error("APPLICATION_NOT_FOUND");
      const record = RecordSchema.parse({
        ...existing,
        pendingSubmitAt: null,
        lastLearning: { ...result.result, at: new Date().toISOString() },
        updatedAt: new Date().toISOString()
      });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  recordLearningUndo(tabId: number, frameId: number, result: { changeSetId: string; restored: number; forgotten: number; keptNewer: number; message: "UPDATES_UNDONE" | "UPDATES_PARTIALLY_UNDONE" | "NOTHING_TO_UNDO" }): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing) throw new Error("APPLICATION_NOT_FOUND");
      const record = RecordSchema.parse({
        ...existing,
        lastLearning: {
          changeSetId: result.changeSetId, saved: result.restored + result.forgotten,
          askAgain: 0, skipped: result.keptNewer, conflicts: 0, message: result.message,
          at: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  async record(tabId: number, frameId = 0): Promise<RuntimeRecord | null> { return (await this.read())[this.key(tabId, frameId)] ?? null; }

  async recordsForTab(tabId: number): Promise<readonly RuntimeRecord[]> {
    return Object.values(await this.read()).filter((record) => record.identity.tabId === tabId);
  }

  removeFrame(tabId: number, frameId: number): Promise<void> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      if (!state[runtimeKey]) return;
      delete state[runtimeKey];
      const raw = (await this.storage.get(intelligenceStorageKey))[intelligenceStorageKey];
      const parsed = z.record(z.string(), ResolveFieldIntelligenceResponseSchema).safeParse(raw);
      const intelligence = parsed.success ? parsed.data : {};
      delete intelligence[runtimeKey];
      await this.storage.set({ [storageKey]: state, [intelligenceStorageKey]: intelligence });
    });
  }

  recordFailure(tabId: number, frameId: number, currentFailure: ExtensionFailure): Promise<RuntimeRecord> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing) throw new Error("APPLICATION_NOT_FOUND");
      const machine = new RuntimeStateMachine(existing.state);
      if (machine.canTransition("FAILED")) machine.transition("FAILED", currentFailure.code.toLowerCase());
      const at = new Date().toISOString();
      const record = RecordSchema.parse({
        ...existing,
        state: machine.state,
        lastFailure: { failure: ExtensionFailureSchema.parse(currentFailure), at },
        updatedAt: at
      });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  clearFailure(tabId: number, frameId: number): Promise<RuntimeRecord | null> {
    return this.serialized(async () => {
      const state = await this.read();
      const runtimeKey = this.key(tabId, frameId);
      const existing = state[runtimeKey];
      if (!existing) return null;
      const machine = new RuntimeStateMachine(existing.state);
      if (machine.state === "FAILED") machine.transition("RECOVERING", "candidate-retry");
      const record = RecordSchema.parse({
        ...existing,
        state: machine.state,
        lastFailure: null,
        updatedAt: new Date().toISOString()
      });
      state[runtimeKey] = record;
      await this.write(state);
      return record;
    });
  }

  async removeTab(tabId: number): Promise<void> {
    const state = await this.read();
    const removed: string[] = [];
    for (const [key, value] of Object.entries(state)) if (value.identity.tabId === tabId) { delete state[key]; removed.push(key); }
    const raw = (await this.storage.get(intelligenceStorageKey))[intelligenceStorageKey];
    const parsed = z.record(z.string(), ResolveFieldIntelligenceResponseSchema).safeParse(raw);
    const intelligence = parsed.success ? parsed.data : {};
    for (const key of removed) delete intelligence[key];
    await this.storage.set({ [storageKey]: state, [intelligenceStorageKey]: intelligence });
  }
  async recover(): Promise<number> {
    const state = await this.read();
    const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
    let removed = 0;
    for (const [key, value] of Object.entries(state)) if (Date.parse(value.updatedAt) < cutoff) { delete state[key]; removed += 1; }
    if (removed) {
      const raw = (await this.storage.get(intelligenceStorageKey))[intelligenceStorageKey];
      const parsed = z.record(z.string(), ResolveFieldIntelligenceResponseSchema).safeParse(raw);
      const intelligence = parsed.success ? parsed.data : {};
      for (const key of Object.keys(intelligence)) if (!state[key]) delete intelligence[key];
      await this.storage.set({ [storageKey]: state, [intelligenceStorageKey]: intelligence });
    }
    return Object.keys(state).length;
  }

  status(record: RuntimeRecord | null, authState: RuntimeStatus["authState"], siteAccess: RuntimeStatus["siteAccess"], activeOrigin: string | null = record?.origin ?? null): RuntimeStatus {
    const lastStep = record?.stepHistory.at(-1) ?? null;
    return {
      extensionVersion: __JH_EXTENSION_VERSION__, protocolVersion: 1, authState,
      runtimeState: record?.state ?? null, identity: record?.identity ?? null, lastScan: record?.lastScan ?? null,
      lastGraph: record?.lastGraph ?? null,
      lastStep: lastStep ? {
        logicalFingerprint: lastStep.logicalFingerprint,
        visitCount: lastStep.visitCount,
        review: lastStep.review,
        transitionExpected: record?.lastStepTransition?.expected ?? null,
        transitionFailure: record?.lastStepTransition?.failureCode ?? null,
        at: lastStep.lastSeenAt
      } : null,
      lastIntelligence: record?.lastIntelligence ?? null,
      lastExecution: record?.lastExecution ?? null,
      planSkips: record?.planSkips ?? [],
      autofill: record?.autofill ?? null,
      journey: record?.journey ?? null,
      lastFailure: record?.lastFailure ?? null,
      declarations: record?.declarations ?? [],
      pendingSubmitAt: record?.pendingSubmitAt ?? null,
      lastLearning: record?.lastLearning ?? null,
      activeOrigin, siteAccess, recoverable: Boolean(record)
    };
  }
}
