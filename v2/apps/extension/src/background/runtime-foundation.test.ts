import assert from "node:assert/strict";
import test from "node:test";
import { MessageReceiptStore } from "./message-receipts.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { MemoryStorageArea } from "./storage.js";
import type { ScanResult } from "../shared/contracts.js";
import { failure } from "../shared/errors.js";

function graphScan(pageInstanceId: string, applicationRunId: string, logicalFingerprint: string, review = false): ScanResult {
  const graphNodeId = `graph:step:${logicalFingerprint.slice(0, 8)}`;
  return {
    schemaVersion: 2,
    reason: "SPA_NAVIGATION",
    pageInstanceId,
    formInstanceIds: [],
    pageContext: { host: "apply.example", ats: "GENERIC", pageHeading: null },
    fields: [],
    graph: {
      schemaVersion: 1, applicationRunId, pageInstanceId, graphRevision: 1,
      graphFingerprint: logicalFingerprint, routeFingerprint: "f".repeat(64), observedAt: new Date().toISOString(), stable: true,
      nodes: [{
        graphNodeId, nodeType: "STEP", pageInstanceId, formInstanceId: null, logicalFingerprint,
        parentGraphNodeId: null, fieldRuntimeId: null, controlFingerprint: null, formRepeatGroupId: null,
        actionKind: null, semanticRole: review ? "REVIEW" : "INPUT", state: "REACHABLE", visible: true,
        enabled: true, required: false, currentStep: true, technical: false, optionFingerprint: null,
        optionCount: 0, validationState: "NONE", validationErrorCount: 0, declaredTargetKeys: [],
        evidence: ["STRUCTURAL_INFERENCE"], confidence: 1, valuePrivate: true, containsCandidateValue: false
      }],
      edges: [], failures: [],
      summary: { nodeCount: 1, edgeCount: 0, reachableFieldCount: 0, blockingFieldCount: 0, stepCount: 1, validationErrorCount: 0 },
      valuePrivate: true, containsCandidateValue: false
    },
    graphDelta: {
      fromRevision: 0, toRevision: 1, material: true, items: [], affectedGraphNodeIds: [],
      valuePrivate: true, containsCandidateValue: false
    },
    stepTransition: null,
    inaccessibleFrameCount: 0,
    durationMs: 1
  };
}

test("runtime identities remain isolated across tabs and reconnect within one application", async () => {
  const storage = new MemoryStorageArea();
  const registry = new RuntimeRegistry(storage);
  const applicationKey = "app:12345678";
  await registry.prepareLaunch(11, crypto.randomUUID(), "https://jobs.example", crypto.randomUUID(), crypto.randomUUID());
  await registry.prepareLaunch(12, crypto.randomUUID(), "https://jobs.example", crypto.randomUUID(), crypto.randomUUID());
  const first = await registry.register({ tabId: 11, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey, origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test" });
  const reconnected = await registry.register({ tabId: 11, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey, origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test" });
  const duplicateTab = await registry.register({ tabId: 12, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey, origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test" });
  assert.equal(first.identity.applicationRunId, reconnected.identity.applicationRunId);
  assert.equal(first.contentVersion, "test");
  assert.notEqual(first.identity.tabSessionId, duplicateTab.identity.tabSessionId);
  assert.notEqual(first.identity.applicationRunId, duplicateTab.identity.applicationRunId);
});

test("manual applications retain submission identity on confirmation but not on a different application", async () => {
  const registry = new RuntimeRegistry(new MemoryStorageArea());
  const input = { tabId: 84, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey: "app:12345678", origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test" };
  await registry.register(input);
  const applicationId = crypto.randomUUID(); const runId = crypto.randomUUID();
  await registry.bindRun(84, 0, input.pageInstanceId, applicationId, runId);
  await registry.recordSubmitAttempt(84, 0, new Date().toISOString());
  const confirmation = await registry.register({ ...input, pageInstanceId: crypto.randomUUID(), applicationKey: null });
  assert.equal(confirmation.identity.applicationId, applicationId);
  assert.equal(confirmation.identity.applicationRunId, runId);
  assert.ok(confirmation.pendingSubmitAt);
  const next = await registry.register({ ...input, pageInstanceId: crypto.randomUUID(), applicationKey: "app:87654321" });
  assert.equal(next.identity.applicationId, null);
  assert.equal(next.pendingSubmitAt, null);
  assert.equal(next.lastLearning, null);
});

test("journey hints follow a clicked destination, remain value-free and never transfer application authority", async () => {
  const registry = new RuntimeRegistry(new MemoryStorageArea());
  const input = { tabId: 85, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey: null, origin: "https://careers.example", pathHash: "12345678", contentVersion: "test" };
  await registry.register(input);
  const updated = await registry.recordJourney(85, 0, input.pageInstanceId, { stage: "JOB_DETAIL", method: "UNKNOWN", confidence: .85, canFill: false, reasons: ["JOB_WITH_APPLY_ACTION"] }, "APPLY", "https://ats.example");
  const redirected = await registry.register({ ...input, pageInstanceId: crypto.randomUUID(), origin: "https://ats.example" });
  assert.equal(redirected.journey?.sessionId, updated.journey?.sessionId);
  assert.equal(redirected.identity.applicationId, null);
  assert.equal(redirected.identity.applicationRunId, null);
  await assert.rejects(registry.recordJourney(85, 0, input.pageInstanceId, updated.journey!.evidence, "INSPECT", null), /STALE/);
  const unrelated = await registry.register({ ...input, pageInstanceId: crypto.randomUUID(), origin: "https://unrelated.example" });
  assert.equal(unrelated.journey, null);
});

test("failed scans recover and stale progress/intelligence cannot replace a new page", async () => {
  const registry = new RuntimeRegistry(new MemoryStorageArea());
  const pageInstanceId = crypto.randomUUID();
  const input = { tabId: 81, frameId: 0, pageInstanceId, applicationKey: "app:12345678", origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test" };
  const record = await registry.register(input);
  await registry.recordFailure(81, 0, failure("API_UNAVAILABLE", "Temporarily unavailable"));
  await registry.recordScan(81, 0, graphScan(pageInstanceId, record.identity.applicationRunId!, "a".repeat(64)));
  const intelligence = { schemaVersion: 1 as const, requestId: crypto.randomUUID(), items: [], summary: { resolvedHigh: 0, resolvedMedium: 0, ambiguous: 0, unresolved: 0, unsupported: 0, answerAvailable: 0, aiRequests: 0, cacheHits: 0, durationMs: 0 }, valuePrivate: true as const, containsCandidateValue: false as const };
  await registry.recordIntelligence(81, 0, intelligence, pageInstanceId);
  assert.equal((await registry.record(81, 0))?.lastFailure, null);
  await registry.register({ ...input, pageInstanceId: crypto.randomUUID() });
  await assert.rejects(registry.recordIntelligence(81, 0, intelligence, pageInstanceId), /STALE_FIELD_RUNTIME/);
  await assert.rejects(registry.bindRun(81, 0, pageInstanceId, crypto.randomUUID(), crypto.randomUUID()), /STALE/);
  await assert.rejects(registry.recordProgress(81, 0, { pageInstanceId, phase: "REVIEW", fields: [], containsCandidateValue: false }), /STALE/);
  assert.equal((await registry.record(81, 0))?.autofill, null);
});

test("child frames inherit the launched job and application run without merging frame identity", async () => {
  const registry = new RuntimeRegistry(new MemoryStorageArea());
  const jobId = crypto.randomUUID();
  const applicationId = crypto.randomUUID();
  const applicationRunId = crypto.randomUUID();
  await registry.prepareLaunch(13, jobId, "https://jobs.example", applicationId, applicationRunId);
  const top = await registry.register({
    tabId: 13, frameId: 0, pageInstanceId: crypto.randomUUID(), applicationKey: "app:top-frame",
    origin: "https://jobs.example", pathHash: "12345678", contentVersion: "test"
  });
  const child = await registry.register({
    tabId: 13, frameId: 7, pageInstanceId: crypto.randomUUID(), applicationKey: "app:child-frame",
    origin: "https://jobs.example", pathHash: "87654321", contentVersion: "test"
  });
  assert.equal(child.identity.applicationId, applicationId);
  assert.equal(child.identity.applicationRunId, applicationRunId);
  assert.equal(child.pendingJobId, jobId);
  assert.equal(child.identity.tabSessionId, top.identity.tabSessionId);
  assert.notEqual(child.identity.pageInstanceId, top.identity.pageInstanceId);
  assert.deepEqual((await registry.recordsForTab(13)).map((record) => record.identity.frameId).sort(), [0, 7]);
});

test("message receipt claims are idempotent under concurrency", async () => {
  const receipts = new MessageReceiptStore(new MemoryStorageArea());
  const messageId = crypto.randomUUID();
  const claims = await Promise.all([receipts.claim(messageId), receipts.claim(messageId), receipts.claim(messageId)]);
  assert.deepEqual(claims.sort(), [false, false, true]);
});

test("runtime recovery drops stale metadata without retaining application values", async () => {
  const storage = new MemoryStorageArea();
  const registry = new RuntimeRegistry(storage);
  await registry.prepareLaunch(19, crypto.randomUUID(), "https://apply.example", crypto.randomUUID(), crypto.randomUUID());
  const state = storage.values["jobHunter.extension.runtimes.v1"] as Record<string, Record<string, unknown>>;
  const record = state["19:0"];
  assert.ok(record);
  record.updatedAt = new Date(0).toISOString();
  const remaining = await registry.recover();
  assert.equal(remaining, 0);
});

test("status preserves the active employer origin before a content runtime exists", () => {
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>;
  const originalVersion = runtimeGlobals.__JH_EXTENSION_VERSION__;
  runtimeGlobals.__JH_EXTENSION_VERSION__ = "test";
  try {
    const registry = new RuntimeRegistry(new MemoryStorageArea());
    const status = registry.status(null, "READY", "REQUIRED", "https://jobs.example");
    assert.equal(status.activeOrigin, "https://jobs.example");
    assert.equal(status.siteAccess, "REQUIRED");
    assert.equal(status.identity, null);
  } finally {
    if (originalVersion === undefined) delete runtimeGlobals.__JH_EXTENSION_VERSION__;
    else runtimeGlobals.__JH_EXTENSION_VERSION__ = originalVersion;
  }
});

test("runtime stores only value-free semantic references and removes them with the tab", async () => {
  const storage = new MemoryStorageArea();
  const registry = new RuntimeRegistry(storage);
  await registry.prepareLaunch(23, crypto.randomUUID(), "https://apply.example", crypto.randomUUID(), crypto.randomUUID());
  const requestId = crypto.randomUUID();
  await registry.recordIntelligence(23, 0, {
    schemaVersion: 1, requestId, items: [],
    summary: { resolvedHigh: 0, resolvedMedium: 0, ambiguous: 0, unresolved: 0, unsupported: 0, answerAvailable: 0, aiRequests: 0, cacheHits: 0, durationMs: 0 },
    valuePrivate: true, containsCandidateValue: false
  });
  assert.equal(JSON.stringify(storage.values).includes("normalizedValue"), false);
  assert.equal(JSON.stringify(storage.values).includes("candidateAnswer"), false);
  await registry.removeTab(23);
  assert.equal(JSON.stringify(storage.values).includes(requestId), false);
});

test("multi-step reconnect preserves one application run and bounded step visits", async () => {
  const storage = new MemoryStorageArea();
  const registry = new RuntimeRegistry(storage);
  const applicationRunId = crypto.randomUUID();
  await registry.prepareLaunch(29, crypto.randomUUID(), "https://apply.example", crypto.randomUUID(), applicationRunId);
  const applicationKey = "app:87654321";
  const firstPage = crypto.randomUUID();
  const first = await registry.register({ tabId: 29, frameId: 0, pageInstanceId: firstPage, applicationKey, origin: "https://apply.example", pathHash: "11111111", contentVersion: "test" });
  await registry.recordScan(29, 0, graphScan(firstPage, applicationRunId, "1".repeat(64)));
  const secondPage = crypto.randomUUID();
  const second = await registry.register({ tabId: 29, frameId: 0, pageInstanceId: secondPage, applicationKey, origin: "https://apply.example", pathHash: "22222222", contentVersion: "test" });
  assert.equal(second.lastScan, null);
  assert.equal(second.lastGraph, null);
  assert.equal(second.stepHistory.length, 1);
  const secondRecord = await registry.recordScan(29, 0, graphScan(secondPage, applicationRunId, "2".repeat(64), true));
  assert.equal(first.identity.applicationRunId, applicationRunId);
  assert.equal(second.identity.applicationRunId, applicationRunId);
  assert.equal(secondRecord.stepHistory.length, 2);
  assert.equal(secondRecord.stepHistory.at(-1)?.review, true);
  const revisitPage = crypto.randomUUID();
  await registry.register({ tabId: 29, frameId: 0, pageInstanceId: revisitPage, applicationKey, origin: "https://apply.example", pathHash: "11111111", contentVersion: "test" });
  const revisited = await registry.recordScan(29, 0, graphScan(revisitPage, applicationRunId, "1".repeat(64)));
  assert.equal(revisited.stepHistory.length, 2);
  assert.equal(revisited.stepHistory.find((visit) => visit.logicalFingerprint === "1".repeat(64))?.visitCount, 2);
  assert.equal(JSON.stringify(storage.values).includes("candidateValue"), false);
});

test("a known application with no fields yet stays detected instead of unsupported", async () => {
  const storage = new MemoryStorageArea();
  const registry = new RuntimeRegistry(storage);
  const pageInstanceId = crypto.randomUUID();
  const applicationKey = "app:ashby001";
  await registry.register({ tabId: 41, frameId: 0, pageInstanceId, applicationKey, origin: "https://jobs.ashbyhq.com", pathHash: "abcd1234", contentVersion: "test" });
  const scanned = await registry.recordScan(41, 0, graphScan(pageInstanceId, crypto.randomUUID(), "a".repeat(64)));
  assert.equal(scanned.state, "APPLICATION_DETECTED");
  assert.equal(scanned.lastScan?.fieldCount, 0);
  assert.ok(scanned.identity.applicationRunId);
});

test("runtime failure remains visible until an explicit retry clears it", async () => {
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>;
  const originalVersion = runtimeGlobals.__JH_EXTENSION_VERSION__;
  runtimeGlobals.__JH_EXTENSION_VERSION__ = "test";
  try {
    const storage = new MemoryStorageArea();
    const registry = new RuntimeRegistry(storage);
    await registry.prepareLaunch(51, crypto.randomUUID(), "https://apply.example", crypto.randomUUID(), crypto.randomUUID());
    const currentFailure = failure("FIELD_STALE", "The application changed before it could be filled.", {
      category: "STALE",
      retryable: true,
      correlationId: crypto.randomUUID()
    });
    const failed = await registry.recordFailure(51, 0, currentFailure);
    assert.equal(failed.state, "FAILED");
    assert.equal(registry.status(failed, "READY", "GRANTED").lastFailure?.failure.code, "FIELD_STALE");

    const reread = await registry.record(51, 0);
    assert.equal(registry.status(reread, "READY", "GRANTED").lastFailure?.failure.message, currentFailure.message);

    const retrying = await registry.clearFailure(51, 0);
    assert.equal(retrying?.state, "RECOVERING");
    assert.equal(registry.status(retrying, "READY", "GRANTED").lastFailure, null);
  } finally {
    if (originalVersion === undefined) delete runtimeGlobals.__JH_EXTENSION_VERSION__;
    else runtimeGlobals.__JH_EXTENSION_VERSION__ = originalVersion;
  }
});
