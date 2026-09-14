import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "../database/connection.js";
import { getApplicationByJobId, getJobForApplication } from "../repositories/applicationRepository.js";
import { LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { ensureApplicationAttempt } from "../repositories/learningRepository.js";
import { resolveApplicationUrl } from "../utils/applicationUrl.js";

export const EXTENSION_PROTOCOL_VERSION = 1;
export const EXTENSION_LAUNCH_TTL_MS = 60_000;
export const EXTENSION_RUN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const WEBSITE_EXTENSION_STATES = Object.freeze([
    "NOT_INSTALLED", "DISCONNECTED", "CONNECTED", "PERMISSION_REQUIRED", "VERSION_INCOMPATIBLE", "READY_TO_LAUNCH"
]);

const webOriginSchema = z.string().url().transform((value, context) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "A canonical web origin is required." });
        return z.NEVER;
    }
    return url.origin;
});

const launchIssueSchema = z.object({
    jobId: z.string().min(1).max(160),
    websiteOrigin: webOriginSchema,
    targetUrl: z.string().url().max(4096),
    protocolVersion: z.literal(EXTENSION_PROTOCOL_VERSION),
    clientNonce: z.string().min(16).max(160)
}).strict();

const launchConsumeSchema = launchIssueSchema.extend({
    authorizationId: z.string().min(1).max(160),
    launchToken: z.string().min(32).max(256),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(160),
    documentLifecycle: z.enum(["ACTIVE", "PRERENDER", "BF_CACHE", "DISCARDED", "UNKNOWN"]),
    extensionVersion: z.string().min(1).max(40)
}).strict();

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const token = () => crypto.randomBytes(32).toString("base64url");

function canonicalTarget(rawUrl) {
    const parsed = new URL(resolveApplicationUrl(rawUrl).url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only web application URLs can be authorized.");
    parsed.hash = "";
    return { url: parsed.href, origin: parsed.origin };
}

function assertPreparedJob(jobId) {
    const job = getJobForApplication(jobId);
    const application = getApplicationByJobId(jobId);
    if (!job || !application || application.adapter !== "EXTENSION" || application.status === "SUCCESS") {
        throw new Error("Prepare this application in Job Hunter before launching Copilot.");
    }
    if (application.user_id !== LOCAL_USER_ID) throw new Error("This application belongs to another candidate.");
    return { job, application };
}

export function issueExtensionLaunch(input, { nowMs = Date.now() } = {}) {
    const parsed = launchIssueSchema.parse(input);
    const { job, application } = assertPreparedJob(parsed.jobId);
    const requested = canonicalTarget(parsed.targetUrl);
    const expected = canonicalTarget(job.url);
    if (requested.origin !== expected.origin || hash(requested.url) !== hash(expected.url)) {
        throw new Error("The requested application URL does not match the prepared job.");
    }
    const attempt = ensureApplicationAttempt(application.id, requested.url);
    const authorizationId = crypto.randomUUID();
    const launchToken = token();
    const expiresAtMs = nowMs + EXTENSION_LAUNCH_TTL_MS;
    getDb().prepare(`INSERT INTO extension_launch_authorizations
        (id, token_hash, candidate_id, job_id, application_id, attempt_id, website_origin,
         target_origin, target_url_hash, protocol_version, client_nonce_hash, expires_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(authorizationId, hash(launchToken), LOCAL_USER_ID, job.id, application.id, attempt.id,
            parsed.websiteOrigin, requested.origin, hash(requested.url), parsed.protocolVersion,
            hash(parsed.clientNonce), expiresAtMs);
    return {
        schemaVersion: 1,
        protocolVersion: EXTENSION_PROTOCOL_VERSION,
        authorizationId,
        launchToken,
        runId: attempt.id,
        applicationId: application.id,
        jobId: job.id,
        targetOrigin: requested.origin,
        expiresAtMs
    };
}

export function consumeExtensionLaunch(input, { nowMs = Date.now() } = {}) {
    const parsed = launchConsumeSchema.parse(input);
    const requested = canonicalTarget(parsed.targetUrl);
    const db = getDb();
    const consume = db.transaction(() => {
        const row = db.prepare("SELECT * FROM extension_launch_authorizations WHERE id = ? AND token_hash = ?")
            .get(parsed.authorizationId, hash(parsed.launchToken));
        if (!row) throw new Error("The Copilot launch authorization is invalid.");
        if (row.consumed_at_ms != null) throw new Error("The Copilot launch authorization was already used.");
        if (row.expires_at_ms < nowMs) throw new Error("The Copilot launch authorization expired. Try Apply with Copilot again.");
        if (row.candidate_id !== LOCAL_USER_ID || row.job_id !== parsed.jobId
            || row.website_origin !== parsed.websiteOrigin || row.target_origin !== requested.origin
            || row.target_url_hash !== hash(requested.url) || row.protocol_version !== parsed.protocolVersion
            || row.client_nonce_hash !== hash(parsed.clientNonce)) {
            throw new Error("The Copilot launch authorization does not match this request.");
        }
        const changed = db.prepare(`UPDATE extension_launch_authorizations
            SET consumed_at_ms = ?, consumed_tab_id = ?, consumed_frame_id = ?, consumed_document_id = ?
            WHERE id = ? AND consumed_at_ms IS NULL`).run(nowMs, parsed.tabId, parsed.frameId, parsed.documentId, row.id);
        if (changed.changes !== 1) throw new Error("The Copilot launch authorization was already used.");
        db.prepare("UPDATE extension_run_bindings SET state = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP WHERE run_id = ? AND state = 'ACTIVE'")
            .run(row.attempt_id);
        const sessionToken = token();
        const bindingId = crypto.randomUUID();
        const expiresAtMs = nowMs + EXTENSION_RUN_TTL_MS;
        db.prepare(`INSERT INTO extension_run_bindings
            (id, run_id, application_id, candidate_id, launch_authorization_id, session_token_hash,
             protocol_version, extension_version, website_origin, target_origin, tab_id, frame_id,
             document_id, document_lifecycle, expires_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(bindingId, row.attempt_id, row.application_id, row.candidate_id, row.id, hash(sessionToken),
                row.protocol_version, parsed.extensionVersion, row.website_origin, row.target_origin,
                parsed.tabId, parsed.frameId, parsed.documentId, parsed.documentLifecycle, expiresAtMs);
        return { bindingId, runId: row.attempt_id, applicationId: row.application_id, sessionToken, expiresAtMs };
    });
    return consume();
}

export function authorizeExtensionRun({ runId, sessionToken, targetOrigin = null, nowMs = Date.now() }) {
    if (!runId || !sessionToken) throw new Error("A bound Copilot run session is required.");
    const row = getDb().prepare(`SELECT * FROM extension_run_bindings
        WHERE run_id = ? AND session_token_hash = ? AND state = 'ACTIVE'
        ORDER BY created_at DESC LIMIT 1`).get(String(runId), hash(sessionToken));
    if (!row || row.candidate_id !== LOCAL_USER_ID) throw new Error("The Copilot run session is invalid.");
    if (row.expires_at_ms < nowMs) throw new Error("The Copilot run session expired.");
    if (targetOrigin && row.target_origin !== targetOrigin) throw new Error("The Copilot run is bound to another employer origin.");
    return row;
}

export function recordProtocolMessage({ messageId, runId = null, nonce, messageType, sourceOrigin, sentAtMs }, { nowMs = Date.now() } = {}) {
    if (!messageId || !nonce || !messageType || !sourceOrigin) throw new Error("Incomplete protocol message.");
    if (Math.abs(nowMs - Number(sentAtMs || 0)) > 60_000) throw new Error("The protocol message is stale.");
    try {
        getDb().prepare(`INSERT INTO extension_protocol_replays
            (message_id, run_id, nonce_hash, message_type, source_origin, received_at_ms, expires_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(String(messageId), runId ? String(runId) : null, hash(nonce), String(messageType), String(sourceOrigin), nowMs, nowMs + 5 * 60_000);
    } catch (error) {
        if (/UNIQUE constraint failed/.test(String(error?.message || ""))) throw new Error("The protocol message was already processed.");
        throw error;
    }
    return { accepted: true };
}

export function updateRunGeneration(binding, { pageGeneration, formGeneration, fields = [] }, { nowMs = Date.now() } = {}) {
    const page = Math.max(0, Number(pageGeneration) || 0);
    const form = Math.max(0, Number(formGeneration) || 0);
    if (page < binding.last_page_generation || (page === binding.last_page_generation && form < binding.last_form_generation)) {
        throw new Error("The form generation is stale for this Copilot run.");
    }
    const db = getDb();
    const changed = [];
    const update = db.transaction(() => {
        for (const field of fields.slice(0, 80)) {
            const fingerprint = String(field.logicalFieldFingerprint || "");
            const descriptorHash = String(field.descriptorHash || "");
            if (!/^[a-f0-9]{64}$/.test(fingerprint) || !/^[a-f0-9]{64}$/.test(descriptorHash)) continue;
            const previous = db.prepare("SELECT descriptor_hash, status FROM extension_run_field_cache WHERE run_id = ? AND logical_field_fingerprint = ?")
                .get(binding.run_id, fingerprint);
            if (!previous || previous.descriptor_hash !== descriptorHash || previous.status !== "RESOLVED") changed.push(fingerprint);
            db.prepare(`INSERT INTO extension_run_field_cache
                (run_id, logical_field_fingerprint, descriptor_hash, page_generation, form_generation, status, last_resolved_at_ms)
                VALUES (?, ?, ?, ?, ?, 'PENDING', 0)
                ON CONFLICT(run_id, logical_field_fingerprint) DO UPDATE SET
                    status = CASE WHEN extension_run_field_cache.descriptor_hash <> excluded.descriptor_hash
                        THEN 'PENDING' ELSE extension_run_field_cache.status END,
                    descriptor_hash = excluded.descriptor_hash,
                    page_generation = excluded.page_generation,
                    form_generation = excluded.form_generation`)
                .run(binding.run_id, fingerprint, descriptorHash, page, form);
        }
        db.prepare(`UPDATE extension_run_bindings SET last_page_generation = ?, last_form_generation = ?,
            version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(page, form, binding.id);
    });
    update();
    return { pageGeneration: page, formGeneration: form, changedLogicalFieldFingerprints: changed };
}

export function commitResolvedRunFields(binding, fingerprints = [], { nowMs = Date.now() } = {}) {
    const valid = [...new Set(fingerprints.map(String).filter((value) => /^[a-f0-9]{64}$/.test(value)))].slice(0, 80);
    const db = getDb();
    const update = db.prepare(`UPDATE extension_run_field_cache SET status = 'RESOLVED', last_resolved_at_ms = ?
        WHERE run_id = ? AND logical_field_fingerprint = ?`);
    const commit = db.transaction(() => valid.reduce((count, fingerprint) =>
        count + update.run(nowMs, binding.run_id, fingerprint).changes, 0));
    return { committed: commit(), logicalFieldFingerprints: valid };
}

export function rebindExtensionRun(binding, input = {}) {
    const tabId = Number(input.tabId);
    const frameId = Number(input.frameId || 0);
    const documentId = String(input.documentId || "").slice(0, 160);
    const lifecycle = String(input.documentLifecycle || "UNKNOWN").toUpperCase();
    const target = canonicalTarget(input.currentUrl || binding.target_origin);
    if (!Number.isSafeInteger(tabId) || tabId !== binding.tab_id) throw new Error("The Copilot run belongs to another browser tab.");
    if (!Number.isSafeInteger(frameId) || frameId < 0) throw new Error("Invalid browser frame identity.");
    if (!documentId) throw new Error("A browser document identity is required.");
    if (!["ACTIVE", "PRERENDER", "BF_CACHE", "DISCARDED", "UNKNOWN"].includes(lifecycle)) throw new Error("Invalid document lifecycle.");
    if (target.origin !== binding.target_origin) throw new Error("This navigation requires a new employer-origin authorization.");
    getDb().prepare(`UPDATE extension_run_bindings
        SET frame_id = ?, document_id = ?, document_lifecycle = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND state = 'ACTIVE'`).run(frameId, documentId, lifecycle, binding.id);
    return {
        runId: binding.run_id,
        tabId,
        frameId,
        documentId,
        documentLifecycle: lifecycle,
        targetOrigin: target.origin
    };
}

export function authorizeExtensionRunOrigin(binding, rawUrl) {
    const target = canonicalTarget(rawUrl);
    getDb().prepare(`UPDATE extension_run_bindings
        SET target_origin = ?, document_lifecycle = 'UNKNOWN', version = version + 1,
            updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'ACTIVE'`)
        .run(target.origin, binding.id);
    return { runId: binding.run_id, targetOrigin: target.origin, version: binding.version + 1 };
}

export function extensionProtocolDiagnostics(runId) {
    const db = getDb();
    return {
        bindings: db.prepare(`SELECT id, run_id, application_id, protocol_version, extension_version,
            website_origin, target_origin, tab_id, frame_id, document_id, document_lifecycle, state,
            last_page_generation, last_form_generation, last_sequence, version, expires_at_ms, created_at, updated_at
            FROM extension_run_bindings WHERE run_id = ? ORDER BY created_at`).all(runId),
        launches: db.prepare(`SELECT id, job_id, application_id, attempt_id, website_origin, target_origin,
            protocol_version, expires_at_ms, consumed_at_ms, consumed_tab_id, consumed_frame_id, created_at
            FROM extension_launch_authorizations WHERE attempt_id = ? ORDER BY created_at`).all(runId)
    };
}
