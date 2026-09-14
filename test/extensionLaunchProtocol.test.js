import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("single-use launch authorization binds run, origin, tab and incremental field generations", async () => {
    const testId = crypto.randomUUID();
    const jobId = `job-launch-protocol:${testId}`;
    const applicationId = `app-launch-protocol:${testId}`;
    const messageId = `message:launch:${testId}`;
    const telemetryId = `telemetry:launch:${testId}`;
    const idempotencyKey = `outbox:event:${testId}`;
    const { getDb } = await import("../src/database/connection.js");
    const {
        authorizeExtensionRun,
        commitResolvedRunFields,
        consumeExtensionLaunch,
        extensionProtocolDiagnostics,
        issueExtensionLaunch,
        rebindExtensionRun,
        recordProtocolMessage,
        updateRunGeneration
    } = await import("../src/services/extensionLaunchProtocol.js");
    const { persistTelemetryBatch, runIdempotentExtensionMutation } = await import("../src/services/extensionDeliveryService.js");
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO candidate_profiles (user_id, name, email) VALUES ('local-user', 'Candidate', 'candidate@example.com')").run();
    db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES (?, 'Engineer', '', ?, 'test')")
        .run(jobId, "https://ats.example.test/apply/123");
    db.prepare("INSERT INTO applications (id, job_id, user_id, adapter, status) VALUES (?, ?, 'local-user', 'EXTENSION', 'QUEUED')")
        .run(applicationId, jobId);

    const nowMs = 1_788_070_000_000;
    const clientNonce = testId.replaceAll("-", "");
    recordProtocolMessage({
        messageId,
        nonce: clientNonce,
        messageType: "JOB_HUNTER_LAUNCH_REQUEST",
        sourceOrigin: "http://localhost:3000",
        sentAtMs: nowMs
    }, { nowMs });
    assert.throws(() => recordProtocolMessage({
        messageId,
        nonce: clientNonce,
        messageType: "JOB_HUNTER_LAUNCH_REQUEST",
        sourceOrigin: "http://localhost:3000",
        sentAtMs: nowMs
    }, { nowMs }), /already processed/);

    const authorization = issueExtensionLaunch({
        jobId,
        websiteOrigin: "http://localhost:3000",
        targetUrl: "https://ats.example.test/apply/123",
        protocolVersion: 1,
        clientNonce
    }, { nowMs });
    assert.equal(authorization.targetOrigin, "https://ats.example.test");
    assert.throws(() => consumeExtensionLaunch({
        authorizationId: authorization.authorizationId,
        launchToken: authorization.launchToken,
        jobId: authorization.jobId,
        clientNonce,
        protocolVersion: 1,
        websiteOrigin: "http://localhost:3000",
        targetUrl: "https://other.example.test/apply/123",
        tabId: 7,
        frameId: 0,
        documentId: "document-01",
        documentLifecycle: "ACTIVE",
        extensionVersion: "1.16.0"
    }, { nowMs }), /does not match/);

    const bound = consumeExtensionLaunch({
        authorizationId: authorization.authorizationId,
        launchToken: authorization.launchToken,
        jobId: authorization.jobId,
        clientNonce,
        protocolVersion: 1,
        websiteOrigin: "http://localhost:3000",
        targetUrl: "https://ats.example.test/apply/123",
        tabId: 7,
        frameId: 0,
        documentId: "document-01",
        documentLifecycle: "ACTIVE",
        extensionVersion: "1.16.0"
    }, { nowMs });
    assert.throws(() => consumeExtensionLaunch({
        authorizationId: authorization.authorizationId,
        launchToken: authorization.launchToken,
        jobId: authorization.jobId,
        clientNonce,
        protocolVersion: 1,
        websiteOrigin: "http://localhost:3000",
        targetUrl: "https://ats.example.test/apply/123",
        tabId: 7,
        frameId: 0,
        documentId: "document-01",
        documentLifecycle: "ACTIVE",
        extensionVersion: "1.16.0"
    }, { nowMs }), /already used/);

    let binding = authorizeExtensionRun({
        runId: bound.runId,
        sessionToken: bound.sessionToken,
        targetOrigin: "https://ats.example.test",
        nowMs
    });
    assert.equal(binding.tab_id, 7);
    assert.throws(() => rebindExtensionRun(binding, {
        tabId: 8,
        frameId: 0,
        documentId: "document-02",
        documentLifecycle: "ACTIVE",
        currentUrl: "https://ats.example.test/apply/123"
    }), /another browser tab/);
    assert.equal(rebindExtensionRun(binding, {
        tabId: 7,
        frameId: 0,
        documentId: "document-02",
        documentLifecycle: "ACTIVE",
        currentUrl: "https://ats.example.test/apply/123?page=2"
    }).documentId, "document-02");

    const delta = updateRunGeneration(binding, {
        pageGeneration: 1,
        formGeneration: 1,
        fields: [
            { logicalFieldFingerprint: HASH_A, descriptorHash: HASH_A },
            { logicalFieldFingerprint: HASH_B, descriptorHash: HASH_B }
        ]
    }, { nowMs });
    assert.deepEqual(delta.changedLogicalFieldFingerprints, [HASH_A, HASH_B]);
    assert.equal(commitResolvedRunFields(binding, [HASH_A, HASH_B], { nowMs }).committed, 2);
    binding = authorizeExtensionRun({ runId: bound.runId, sessionToken: bound.sessionToken, nowMs });
    assert.deepEqual(updateRunGeneration(binding, {
        pageGeneration: 1,
        formGeneration: 1,
        fields: [{ logicalFieldFingerprint: HASH_A, descriptorHash: HASH_A }]
    }, { nowMs }).changedLogicalFieldFingerprints, []);
    assert.throws(() => updateRunGeneration(authorizeExtensionRun({ runId: bound.runId, sessionToken: bound.sessionToken, nowMs }), {
        pageGeneration: 0,
        formGeneration: 0,
        fields: []
    }), /generation is stale/);

    const telemetry = {
        schemaVersion: 1,
        telemetryId,
        runId: bound.runId,
        sequence: 1,
        occurredAtMs: nowMs,
        dimensions: {
            ats: null,
            portalKind: "test",
            eventType: "RUN_BOOTSTRAPPED",
            outcome: "READY",
            strategyId: null,
            adapterVersion: "1",
            reasonCode: null,
            checkpointType: null,
            fieldType: null
        },
        measures: { durationMs: 10, count: 1 },
        logicalFieldFingerprint: null,
        operationHash: null,
        valueFree: true,
        containsProtectedValue: false
    };
    assert.deepEqual(persistTelemetryBatch(binding, [telemetry]), { accepted: 1, duplicates: 0, received: 1 });
    assert.deepEqual(persistTelemetryBatch(binding, [telemetry]), { accepted: 0, duplicates: 1, received: 1 });

    const diagnostics = extensionProtocolDiagnostics(bound.runId);
    assert.equal(diagnostics.bindings.length, 1);
    assert.equal(diagnostics.launches.length, 1);
    assert.equal(JSON.stringify(diagnostics).includes(authorization.launchToken), false);
    assert.equal(JSON.stringify(diagnostics).includes(bound.sessionToken), false);

    let mutations = 0;
    const first = runIdempotentExtensionMutation({
        idempotencyKey,
        runId: bound.runId,
        request: { schemaVersion: 1, event: "CHECKPOINT" },
        eventType: "TEST_MUTATION"
    }, () => ({ saved: ++mutations }));
    const replay = runIdempotentExtensionMutation({
        idempotencyKey,
        runId: bound.runId,
        request: { schemaVersion: 1, event: "CHECKPOINT" },
        eventType: "TEST_MUTATION"
    }, () => ({ saved: ++mutations }));
    assert.equal(first.cached, false);
    assert.equal(replay.cached, true);
    assert.deepEqual(replay.result, { saved: 1 });
    assert.equal(mutations, 1);
    assert.throws(() => runIdempotentExtensionMutation({
        idempotencyKey,
        runId: bound.runId,
        request: { schemaVersion: 1, event: "DIFFERENT" }
    }, () => ({ saved: ++mutations })), /different request/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM extension_backend_outbox WHERE aggregate_id = ?")
        .get(idempotencyKey).count, 1);
});

test("website bridge exposes install, version and exact-origin permission states", () => {
    const jobs = fs.readFileSync("web/app/app/jobs/page.tsx", "utf8");
    const content = fs.readFileSync("extension/content.js", "utf8");
    const background = fs.readFileSync("extension/background.js", "utf8");
    const panel = fs.readFileSync("extension/sidepanel.js", "utf8");
    for (const state of ["NOT_INSTALLED", "DISCONNECTED", "PERMISSION_REQUIRED", "VERSION_INCOMPATIBLE", "READY_TO_LAUNCH"]) {
        assert.match(`${jobs}\n${background}`, new RegExp(state));
    }
    assert.match(content, /job-hunter-extension-request/);
    assert.match(content, /JOB_HUNTER_LAUNCH_REQUEST/);
    assert.match(background, /launches\/issue/);
    assert.match(background, /launches\/consume/);
    assert.match(panel, /data-grant-origin/);
    assert.match(panel, /chrome\.permissions\.request\(\{ origins: \[originPattern\] \}\)/);
    assert.doesNotMatch(panel, /Enable autofill on all job sites/);
});
