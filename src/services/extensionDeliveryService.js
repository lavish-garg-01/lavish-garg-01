import crypto from "node:crypto";
import { canonicalContractJson, stableContractHash } from "../contracts/contractPrimitives.js";
import { parseSharedContract } from "../contracts/sharedContracts.js";
import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "../repositories/copilotRepository.js";

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function requestHash(value) {
    return stableContractHash(value);
}

export function runIdempotentExtensionMutation({
    idempotencyKey,
    runId = null,
    candidateId = LOCAL_USER_ID,
    request,
    nowMs = Date.now(),
    eventType = "EXTENSION_MUTATION"
}, mutate) {
    if (!idempotencyKey) return { cached: false, result: mutate() };
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(String(idempotencyKey))) {
        throw new Error("Invalid idempotency key.");
    }
    if (candidateId !== LOCAL_USER_ID) throw new Error("Cross-candidate extension mutation denied.");
    const hash = requestHash(request);
    const db = getDb();
    const execute = db.transaction(() => {
        const existing = db.prepare("SELECT * FROM extension_idempotency_requests WHERE idempotency_key = ?")
            .get(String(idempotencyKey));
        if (existing) {
            if (existing.candidate_id !== candidateId || existing.request_hash !== hash) {
                throw new Error("An idempotency key cannot be reused with a different request.");
            }
            if (existing.state !== "COMPLETED") throw new Error("The idempotent request is still being processed.");
            return { cached: true, result: JSON.parse(existing.response_json || "null") };
        }
        db.prepare(`INSERT INTO extension_idempotency_requests
            (idempotency_key, candidate_id, run_id, request_hash, state, expires_at_ms)
            VALUES (?, ?, ?, ?, 'PROCESSING', ?)`)
            .run(String(idempotencyKey), candidateId, runId, hash, nowMs + IDEMPOTENCY_TTL_MS);
        const result = mutate();
        const responseJson = canonicalContractJson(result ?? null);
        db.prepare(`UPDATE extension_idempotency_requests SET state = 'COMPLETED', response_status = 200,
            response_json = ?, updated_at = CURRENT_TIMESTAMP WHERE idempotency_key = ?`)
            .run(responseJson, String(idempotencyKey));
        db.prepare(`INSERT INTO extension_backend_outbox
            (id, candidate_id, run_id, event_type, aggregate_id, payload_json, available_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), candidateId, runId, eventType, String(idempotencyKey),
                canonicalContractJson({ idempotencyKey: String(idempotencyKey), requestHash: hash }), nowMs);
        return { cached: false, result };
    });
    return execute();
}

export function persistTelemetryBatch(binding, envelopes = []) {
    const parsed = envelopes.slice(0, 200).map((envelope) => {
        const result = parseSharedContract("TelemetryEnvelope", envelope);
        if (!result.success) throw new Error(`TelemetryEnvelope rejected: ${result.reasonCode}.`);
        if (result.data.runId !== binding.run_id) throw new Error("Telemetry belongs to another Copilot run.");
        return result.data;
    });
    const db = getDb();
    const insert = db.prepare(`INSERT OR IGNORE INTO extension_telemetry_events
        (telemetry_id, candidate_id, run_id, sequence, occurred_at_ms, event_type, envelope_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const save = db.transaction(() => parsed.reduce((count, envelope) => count + insert.run(
        envelope.telemetryId,
        binding.candidate_id,
        binding.run_id,
        envelope.sequence,
        envelope.occurredAtMs,
        envelope.dimensions.eventType,
        canonicalContractJson(envelope)
    ).changes, 0));
    const accepted = save();
    return { accepted, duplicates: parsed.length - accepted, received: parsed.length };
}

export function recordExtensionProtocolAudit({ runId = null, eventType, reasonCode = null, metadata = {} }) {
    const safeMetadata = Object.fromEntries(Object.entries(metadata)
        .filter(([key]) => !/(?:value|answer|password|token|nonce|url)/i.test(key))
        .map(([key, value]) => [String(key).slice(0, 80), String(value).slice(0, 240)]));
    getDb().prepare(`INSERT INTO extension_protocol_audit_events
        (id, candidate_id, run_id, event_type, reason_code, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), LOCAL_USER_ID, runId, String(eventType).slice(0, 120),
            reasonCode ? String(reasonCode).slice(0, 120) : null, canonicalContractJson(safeMetadata));
}

export function extensionDeliveryDiagnostics(runId) {
    const db = getDb();
    return {
        idempotency: db.prepare(`SELECT idempotency_key, run_id, request_hash, state, response_status,
            expires_at_ms, created_at, updated_at FROM extension_idempotency_requests
            WHERE candidate_id = ? AND run_id = ? ORDER BY created_at`).all(LOCAL_USER_ID, runId),
        telemetry: db.prepare(`SELECT telemetry_id, run_id, sequence, occurred_at_ms, event_type, created_at
            FROM extension_telemetry_events WHERE candidate_id = ? AND run_id = ? ORDER BY sequence`).all(LOCAL_USER_ID, runId),
        outbox: db.prepare(`SELECT id, run_id, event_type, aggregate_id, status, attempts, available_at_ms,
            created_at, delivered_at FROM extension_backend_outbox WHERE candidate_id = ? AND run_id = ? ORDER BY created_at`)
            .all(LOCAL_USER_ID, runId),
        audit: db.prepare(`SELECT id, run_id, event_type, reason_code, metadata_json, created_at
            FROM extension_protocol_audit_events WHERE candidate_id = ? AND run_id = ? ORDER BY created_at`)
            .all(LOCAL_USER_ID, runId).map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json || "{}"), metadata_json: undefined }))
    };
}
