import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { normalizeControlKind } from "../adapters/controlKinds.js";
import { FILL_OUTCOMES } from "../adapters/fillOutcomes.js";
import { portalLevelPackForProposal, saveLocalDraftPack } from "../repositories/mappingPackRepository.js";
import { safeStructuralSelectors } from "../adapters/structuralSelectors.js";
import { formAGate } from "./formAGate.js";

export { formAGate };

const FAILURES = new Set([
    FILL_OUTCOMES.FILL_FAILED,
    FILL_OUTCOMES.SNAPSHOT_LIE,
    FILL_OUTCOMES.BLOCKED,
    FILL_OUTCOMES.INVALID
]);

// Keys that carry no reusable meaning: promoting them teaches the packs noise
// that can never match a different form.
const NOISY_SEMANTIC_KEYS = new Set(["CUSTOM_FIELD", "UNKNOWN", "UNLABELED", "NONE"]);

const GENERIC_CLUSTER_LABEL = /^(?:unknown field|field|question|answer|input|value|select|option|choice|text|untitled|n\/?a|\d+|field[\s_-]*\d+|application field\s+\d+)$/i;

function noisySemanticKey(semanticKey) {
    return NOISY_SEMANTIC_KEYS.has(String(semanticKey || "").trim().toUpperCase());
}

function unusableClusterLabel(fieldLabel) {
    const label = String(fieldLabel || "").trim();
    return !label || GENERIC_CLUSTER_LABEL.test(label);
}

/**
 * Reason a failure cluster must not become a mapping proposal, or null when the
 * cluster is specific enough to teach something.
 */
export function clusterHygieneReason(cluster = {}) {
    if (noisySemanticKey(cluster.semanticKey)) return "NOISY_SEMANTIC_KEY";
    if (unusableClusterLabel(cluster.fieldLabel)) return "UNLABELED_CLUSTER";
    return null;
}

function parseJson(value, fallback) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function clusterKey({ portalKind, controlKind, fingerprint }) {
    return `${portalKind}|${controlKind}|${fingerprint}`;
}

function fingerprintFor(row) {
    return String(row.field_signature || row.field_label || row.field_id || "field")
        .toLowerCase()
        .replace(/field[-_]?\d+/g, "field")
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, 120) || "field";
}

function scopedPatch(row) {
    const validation = parseJson(row.validation_json, {});
    return {
        portalKind: row.portal_kind,
        siteHost: row.site_host,
        controlKind: normalizeControlKind(row.control_kind || row.field_type),
        semanticKey: row.semantic_key || null,
        fieldLabel: row.field_label ? String(row.field_label).slice(0, 200) : null,
        selectorCandidates: safeStructuralSelectors(validation.selectorCandidates),
        stableIdPrefersLabel: normalizeControlKind(row.control_kind || row.field_type) === "choice-group",
        neverTouches: ["content.js", "other-portals", "legal-fields"]
    };
}

export function clusterFillFailures({ minOccurrences = 1 } = {}) {
    const db = getDb();
    const timeline = db.prepare(`
        SELECT portal_kind, site_host, control_kind, field_id, field_label, field_signature, semantic_key,
               observed_state, metadata_json, COUNT(*) AS occurrences
        FROM application_field_timeline
        WHERE observed_state IN ('FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID')
        GROUP BY portal_kind, control_kind, field_signature
        HAVING COUNT(*) >= ?
        ORDER BY occurrences DESC
    `).all(Math.max(1, Number(minOccurrences) || 1));
    if (timeline.length) {
        return timeline.map((row) => ({
            portalKind: row.portal_kind || "generic",
            siteHost: row.site_host || "unknown-site",
            controlKind: normalizeControlKind(row.control_kind),
            fieldLabel: row.field_label,
            fingerprint: fingerprintFor(row),
            occurrences: Number(row.occurrences || 0),
            observedState: row.observed_state,
            semanticKey: row.semantic_key,
            metadata: parseJson(row.metadata_json, {})
        }));
    }
    const evidence = db.prepare(`
        SELECT portal_kind, site_host, control_kind, field_id, field_label, field_signature, semantic_key,
               fill_outcome, validation_json, COUNT(*) AS occurrences
        FROM application_field_evidence
        WHERE COALESCE(fill_outcome, final_state) IN ('FILL_FAILED','SNAPSHOT_LIE','BLOCKED','INVALID')
        GROUP BY COALESCE(portal_kind, site_host), COALESCE(control_kind, field_type), field_signature
        HAVING COUNT(*) >= ?
        ORDER BY occurrences DESC
    `).all(Math.max(1, Number(minOccurrences) || 1));
    return evidence.map((row) => ({
        portalKind: row.portal_kind || "generic",
        siteHost: row.site_host || "unknown-site",
        controlKind: normalizeControlKind(row.control_kind || row.field_type),
        fieldLabel: row.field_label,
        fingerprint: fingerprintFor(row),
        occurrences: Number(row.occurrences || 0),
        observedState: row.fill_outcome,
        semanticKey: row.semantic_key,
        metadata: parseJson(row.validation_json, {})
    }));
}

export function upsertMappingProposal(cluster) {
    const key = clusterKey(cluster);
    const id = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
    const patch = scopedPatch({
        portal_kind: cluster.portalKind,
        site_host: cluster.siteHost,
        control_kind: cluster.controlKind,
        field_id: cluster.fingerprint,
        field_label: cluster.fieldLabel,
        semantic_key: cluster.semanticKey,
        validation_json: JSON.stringify(cluster.metadata || {})
    });
    const gate = formAGate({ portalKind: cluster.portalKind });
    getDb().prepare(`
        INSERT INTO mapping_proposals (
            id, portal_kind, site_host, control_kind, field_fingerprint, cluster_key,
            proposed_patch_json, form_a_gate, status, occurrence_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?)
        ON CONFLICT(id) DO UPDATE SET
            occurrence_count = excluded.occurrence_count,
            proposed_patch_json = excluded.proposed_patch_json,
            form_a_gate = excluded.form_a_gate,
            updated_at = CURRENT_TIMESTAMP
    `).run(id, cluster.portalKind, cluster.siteHost, cluster.controlKind, cluster.fingerprint, key,
        JSON.stringify(patch), gate.status, Number(cluster.occurrences) || 1);
    return getDb().prepare("SELECT * FROM mapping_proposals WHERE id = ?").get(id);
}

export function proposeMappingPatches() {
    const clusters = clusterFillFailures();
    return clusters.filter((cluster) => FAILURES.has(String(cluster.observedState || "").toUpperCase()) || cluster.occurrences)
        .filter((cluster) => !clusterHygieneReason(cluster))
        .map(upsertMappingProposal)
        .map(publicProposal);
}

/**
 * Clusters that keep failing but can never teach a pack. They stay visible as
 * skipped work so an operator can see why nothing was proposed.
 */
export function skippedMappingClusters() {
    return clusterFillFailures()
        .map((cluster) => ({ ...cluster, skipReason: clusterHygieneReason(cluster) }))
        .filter((cluster) => cluster.skipReason)
        .map((cluster) => ({
            portalKind: cluster.portalKind,
            siteHost: cluster.siteHost,
            controlKind: cluster.controlKind,
            fieldLabel: cluster.fieldLabel || null,
            semanticKey: cluster.semanticKey || null,
            occurrences: cluster.occurrences,
            skipReason: cluster.skipReason
        }));
}

/**
 * Retires proposals whose cluster can never teach a pack, including ones
 * created by earlier builds before the hygiene gates existed. A proposal that
 * only lacks selectors is left alone, because later evidence can supply them.
 */
export function pruneNoisyMappingProposals() {
    let rejected = 0;
    for (const proposal of listMappingProposals()) {
        if (!["PROPOSED", "SHADOW"].includes(String(proposal.status || "").toUpperCase())) continue;
        if (promoteBlockReason(proposal) !== "NOISY_SEMANTIC_KEY") continue;
        getDb().prepare(`
            UPDATE mapping_proposals SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(proposal.id);
        rejected += 1;
    }
    return { rejected };
}

function publicProposal(row) {
    if (!row) return null;
    return {
        id: row.id,
        portalKind: row.portal_kind,
        siteHost: row.site_host,
        controlKind: row.control_kind,
        fingerprint: row.field_fingerprint,
        clusterKey: row.cluster_key,
        patch: parseJson(row.proposed_patch_json, {}),
        formAGate: row.form_a_gate,
        status: row.status,
        occurrenceCount: Number(row.occurrence_count || 0),
        shadowWouldFill: Number(row.shadow_would_fill || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export function listMappingProposals() {
    return getDb().prepare("SELECT * FROM mapping_proposals ORDER BY occurrence_count DESC, updated_at DESC")
        .all().map(publicProposal);
}

export function getMappingProposal(id) {
    return publicProposal(getDb().prepare("SELECT * FROM mapping_proposals WHERE id = ?").get(id));
}

export function dismissMappingProposal(id) {
    const result = getDb().prepare("UPDATE mapping_proposals SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    if (!result.changes) throw new Error("Proposal not found.");
    return getMappingProposal(id);
}

/**
 * Reason a stored proposal can never be promoted into a pack, or null when it
 * carries a replayable structural patch.
 */
export function promoteBlockReason(proposal) {
    if (!proposal) return "MISSING";
    if (proposal.formAGate === "FAIL") return "FORM_A_FAILED";
    if (String(proposal.status || "").toUpperCase() === "REJECTED") return "REJECTED";
    const patch = proposal.patch || {};
    if (noisySemanticKey(patch.semanticKey)) return "NOISY_SEMANTIC_KEY";
    if (!safeStructuralSelectors(patch.selectorCandidates).length) return "NO_STRUCTURAL_SELECTOR";
    return null;
}

const PROMOTE_BLOCK_MESSAGES = {
    MISSING: "Proposal not found.",
    FORM_A_FAILED: "Form A failed; this patch cannot be promoted.",
    REJECTED: "This proposal was dismissed, so it stays out of the mapping packs.",
    NOISY_SEMANTIC_KEY: "This cluster has no reusable semantic key, so promoting it would teach noise.",
    NO_STRUCTURAL_SELECTOR: "This cluster has no structural selector to replay, so there is nothing to promote."
};

export function promoteMappingProposal(id) {
    const proposal = getMappingProposal(id);
    if (!proposal) throw new Error(PROMOTE_BLOCK_MESSAGES.MISSING);
    const blocked = promoteBlockReason(proposal);
    if (blocked) throw new Error(PROMOTE_BLOCK_MESSAGES[blocked] || "This patch cannot be promoted.");
    const current = portalLevelPackForProposal(proposal.portalKind);
    const base = current?.pack || { portalKind: proposal.portalKind, version: 1, skipSelectors: [] };
    const selectors = [...new Set([...(base.skipSelectors || []), ...safeStructuralSelectors(proposal.patch.selectorCandidates)])];
    const next = {
        ...base,
        portalKind: proposal.portalKind,
        overlays: { ...(base.overlays || {}), ...(proposal.patch.stableIdPrefersLabel ? { stableIdPrefersLabelForChoiceGroup: true } : {}) },
        skipSelectors: selectors
    };
    const draft = saveLocalDraftPack({
        portalKind: proposal.portalKind,
        siteHost: proposal.siteHost,
        pack: next
    });
    getDb().prepare(`
        UPDATE mapping_proposals SET status = 'SHADOW', shadow_would_fill = shadow_would_fill + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(id);
    const gate = formAGate(next);
    getDb().prepare("UPDATE mapping_proposals SET form_a_gate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(gate.status, id);
    return { proposal: getMappingProposal(id), mappingPack: draft, formAGate: gate };
}

export function recordShadowWouldFill(id) {
    getDb().prepare("UPDATE mapping_proposals SET shadow_would_fill = shadow_would_fill + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('SHADOW','PROPOSED')").run(id);
    return getMappingProposal(id);
}
