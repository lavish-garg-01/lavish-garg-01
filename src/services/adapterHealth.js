import crypto from "node:crypto";
import { listPortals } from "../adapters/registry.js";
import { getDb } from "../database/connection.js";
import { isAdapterKilled, listFeatureFlags } from "../repositories/featureFlagRepository.js";
import { activeMappingPackForHost, listMappingPacks } from "../repositories/mappingPackRepository.js";
import { usageSummary } from "../repositories/usageMeterRepository.js";
import { entitlementSnapshot } from "./entitlements.js";
import { cleanupStalePortalPatterns } from "../repositories/agentRepository.js";
import { listMappingProposals, promoteBlockReason, pruneNoisyMappingProposals, proposeMappingPatches, skippedMappingClusters, formAGate } from "./learnProposer.js";
import { phase1AcceptanceReport } from "./phase1Acceptance.js";

function percent(numerator, denominator) {
    return denominator ? Number(((Number(numerator || 0) / Number(denominator || 0)) * 100).toFixed(1)) : null;
}

export function adapterHealthReport() {
    const db = getDb();
    proposeMappingPatches();
    // Learning hygiene runs with the report so the promote list an operator sees
    // never contains rows that would be refused at promote time.
    const hygiene = {
        ...cleanupStalePortalPatterns(),
        ...pruneNoisyMappingProposals(),
        skippedClusters: skippedMappingClusters()
    };
    const portals = listPortals().map((portal) => {
        const evidence = db.prepare(`
            SELECT COUNT(*) AS detected,
                SUM(CASE WHEN COALESCE(fill_outcome, final_state) = 'FILLED' THEN 1 ELSE 0 END) AS filled,
                SUM(CASE WHEN COALESCE(fill_outcome, final_state) IN ('FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID') THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN COALESCE(fill_outcome, final_state) = 'LEGAL_BLOCK' THEN 1 ELSE 0 END) AS legalBlocked,
                SUM(CASE WHEN field_type = 'file' AND COALESCE(fill_outcome, final_state) IN ('FILLED','USER_CORRECTED','USER_EDITED') THEN 1 ELSE 0 END) AS uploadsFilled,
                SUM(CASE WHEN field_type = 'file' THEN 1 ELSE 0 END) AS uploads
            FROM application_field_evidence
            WHERE portal_kind = ? OR (portal_kind IS NULL AND site_host LIKE ?)
        `).get(portal.id, `%${portal.hosts[0] || portal.id}%`);
        const runs = db.prepare(`
            SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
            FROM adapter_runs WHERE adapter_kind = ? OR portal_kind = ?
        `).get(portal.id, portal.id);
        const pack = activeMappingPackForHost(portal.hosts[0] || portal.id);
        return {
            id: portal.id,
            label: portal.label,
            version: portal.version,
            killed: isAdapterKilled(portal.id) || pack.killed,
            mappingStage: pack.stage,
            mappingPackVersion: pack.version,
            fillRate: percent(evidence.filled, evidence.detected),
            detected: Number(evidence.detected || 0),
            filled: Number(evidence.filled || 0),
            failed: Number(evidence.failed || 0),
            legalBlocked: Number(evidence.legalBlocked || 0),
            uploadRate: percent(evidence.uploadsFilled, evidence.uploads),
            adapterRuns: Number(runs.total || 0),
            verifiedRuns: Number(runs.verified || 0)
        };
    });
    const incidents = db.prepare(`
        SELECT id, portal_kind AS portalKind, site_host AS siteHost, failure_class AS failureClass,
               control_kind AS controlKind, fingerprint, occurrence_count AS occurrenceCount,
               redacted_sample_json AS redactedSampleJson, status, updated_at AS updatedAt
        FROM adapter_incidents ORDER BY occurrence_count DESC, updated_at DESC LIMIT 40
    `).all().map((row) => ({
        ...row,
        redactedSample: (() => { try { return JSON.parse(row.redactedSampleJson || "{}"); } catch { return {}; } })(),
        redactedSampleJson: undefined
    }));
    return {
        generatedAt: new Date().toISOString(),
        formAGate: formAGate(),
        portals,
        packs: listMappingPacks(),
        flags: listFeatureFlags(),
        proposals: listMappingProposals().map((proposal) => ({
            ...proposal,
            promoteBlockedReason: promoteBlockReason(proposal)
        })),
        learningHygiene: hygiene,
        incidents,
        entitlements: entitlementSnapshot(),
        usage: usageSummary({ days: 30 }),
        phase1: phase1AcceptanceReport()
    };
}

export function recordAdapterIncident({ portalKind, siteHost, failureClass, controlKind, fingerprint, sample = {} }) {
    const db = getDb();
    const id = crypto.createHash("sha256").update(`${portalKind}|${controlKind}|${fingerprint}`).digest("hex").slice(0, 32);
    db.prepare(`
        INSERT INTO adapter_incidents (
            id, portal_kind, site_host, failure_class, control_kind, fingerprint, occurrence_count, redacted_sample_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'OPEN')
        ON CONFLICT(id) DO UPDATE SET
            occurrence_count = occurrence_count + 1,
            redacted_sample_json = excluded.redacted_sample_json,
            updated_at = CURRENT_TIMESTAMP
    `).run(id, portalKind, siteHost, failureClass, controlKind, fingerprint, JSON.stringify(redact(sample)));
    return db.prepare("SELECT * FROM adapter_incidents WHERE id = ?").get(id);
}

function redact(sample = {}) {
    const copy = { ...sample };
    for (const key of ["value", "application_value", "answer", "email", "phone", "resume"]) delete copy[key];
    return {
        label: String(copy.label || copy.fieldLabel || "").slice(0, 120),
        controlKind: copy.controlKind || copy.type || null,
        state: copy.fillOutcome || copy.finalState || null
    };
}
