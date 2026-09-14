import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("extension outbox survives retry, preserves per-run order and ACK-compacts delivery", async () => {
    const source = fs.readFileSync("extension/durable-outbox.js", "utf8");
    const storage = {};
    const chrome = {
        storage: { local: {
            async get(key) { return { [key]: storage[key] }; },
            async set(values) { Object.assign(storage, structuredClone(values)); }
        } }
    };
    const context = { chrome, crypto: crypto.webcrypto, TextEncoder, structuredClone, console };
    context.globalThis = context;
    vm.runInNewContext(source, context, { filename: "durable-outbox.js" });
    const outbox = context.JobHunterDurableOutbox;
    const ownership = { tabId: 7, frameId: 0, documentId: "document-01" };
    const [first, second] = await Promise.all([
        outbox.enqueue({ runId: "run:01", operationId: "op:01", kind: "FIELD_REVISION", ownership,
            request: { path: "/first", method: "POST", body: { valueFree: true } } }),
        outbox.enqueue({ runId: "run:01", operationId: "op:02", kind: "CHECKPOINT_RECEIPT", ownership,
            request: { path: "/second", method: "POST", body: { valueFree: true } } })
    ]);
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    let attempts = 0;
    const unavailable = new Error("offline");
    unavailable.retryable = true;
    unavailable.reasonCode = "NETWORK_UNAVAILABLE";
    const failed = await outbox.flush(async () => { attempts += 1; throw unavailable; });
    assert.equal(attempts, 1);
    assert.equal(failed.pending, 2);
    const paths = [];
    const delivered = await outbox.flush(async (envelope) => {
        paths.push(envelope.request.path);
        return { accepted: envelope.sequence };
    });
    assert.deepEqual(paths, ["/first", "/second"]);
    assert.equal(delivered.pending, 0);
    assert.equal((await outbox.status()).acknowledgedSequenceByRun["run:01"], 2);
    await assert.rejects(() => outbox.enqueue({ runId: "run:01", kind: "CONTROL_CLICK", ownership,
        request: { path: "/unsafe", method: "POST", body: {} } }), /OUTBOX_EVENT_NOT_ALLOWED/);
});

test("Supabase seam enables own-row RLS and exact private storage paths", () => {
    const sql = fs.readFileSync("supabase/phase0_extension_rls.sql", "utf8");
    for (const table of ["extension_launch_authorizations", "extension_run_bindings", "extension_idempotency_requests",
        "extension_telemetry_events", "extension_backend_outbox", "extension_protocol_audit_events",
        "adaptive_evidence_shadow_events", "adaptive_evidence_shadow_rollups", "adaptive_evidence_shadow_recommendations"]) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
    }
    for (const operation of ["select", "insert", "update", "delete"]) {
        assert.match(sql, new RegExp(`job_hunter_private_storage_${operation}`));
    }
    assert.match(sql, /candidate_id = auth\.uid\(\)::text/);
    assert.match(sql, /storage\.foldername\(name\)/);
});
