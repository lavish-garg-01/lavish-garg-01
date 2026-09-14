import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { normalizeSemanticText } from "../contracts/fieldSemanticDescriptor.js";
import { semanticCacheDiagnostics } from "./canonicalSemanticCacheRepository.js";

const REUSABLE_MAPPING_STATUSES = ["CANDIDATE", "VALIDATED", "TRUSTED"];
const GLOBAL_MAPPING_STATUSES = ["VALIDATED", "TRUSTED"];
const APPLICATION_ONLY_CANONICALS = new Set([
    "CURRENT_EMPLOYEE", "PREVIOUS_EMPLOYEE", "PREVIOUS_EMPLOYMENT_TYPE",
    "WORK_MODE_REQUIREMENT", "START_DATE", "RESUME", "COVER_LETTER",
    "EEO_GENDER", "EEO_RACE", "EEO_VETERAN", "EEO_DISABILITY"
]);

function id(prefix, value) {
    return `${prefix}:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 28)}`;
}

function placeholders(values) {
    return values.map(() => "?").join(",");
}

function publicCanonical(row) {
    if (!row) return null;
    return {
        key: row.key,
        label: row.label,
        description: row.description || row.label,
        semanticGroup: row.semantic_group || row.category,
        dataType: row.data_type,
        answerType: row.answer_type || row.data_type,
        scope: row.scope,
        sensitivity: row.sensitivity,
        status: row.status,
        createdSource: row.created_source,
        reusePolicy: row.reuse_policy,
        autofillPolicy: row.autofill_policy,
        askPolicy: row.ask_policy,
        mergedIntoKey: row.merged_into_key || null
    };
}

function publicMapping(row) {
    if (!row) return null;
    return {
        id: row.id,
        canonicalFieldKey: row.canonical_field_key,
        exactFingerprint: row.exact_fingerprint,
        semanticFingerprint: row.semantic_fingerprint,
        normalizedLabel: row.normalized_label,
        atsType: row.ats_type,
        siteHost: row.site_host,
        controlType: row.control_type,
        sectionFamily: row.section_family,
        source: row.source,
        confidence: Number(row.confidence || 0),
        evidenceScore: Number(row.evidence_score || 0),
        keptCount: Number(row.kept_count || 0),
        overwriteCount: Number(row.overwrite_count || 0),
        confirmedCount: Number(row.kept_count || 0),
        correctedCount: Number(row.overwrite_count || 0),
        observationCount: Number(row.observation_count || 0),
        status: row.status,
        aiModel: row.ai_model || null,
        promptVersion: row.prompt_version || null,
        lastSeenAt: row.last_seen_at,
        lastValidatedAt: row.last_validated_at || null
    };
}

export function ensureCanonicalDefinitions(definitions = []) {
    const db = getDb();
    const upsert = db.prepare(`
        INSERT INTO canonical_fields
            (key, label, description, category, semantic_group, data_type, answer_type,
             scope, sensitivity, status, created_source, reuse_policy, autofill_policy, ask_policy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRUSTED', 'ONTOLOGY', ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            label = CASE WHEN canonical_fields.created_source = 'AI_PROPOSAL' THEN canonical_fields.label ELSE excluded.label END,
            description = COALESCE(NULLIF(canonical_fields.description, ''), excluded.description),
            semantic_group = COALESCE(NULLIF(canonical_fields.semantic_group, ''), excluded.semantic_group),
            answer_type = excluded.answer_type,
            scope = excluded.scope,
            sensitivity = excluded.sensitivity,
            reuse_policy = excluded.reuse_policy,
            autofill_policy = excluded.autofill_policy,
            ask_policy = excluded.ask_policy,
            updated_at = CURRENT_TIMESTAMP
    `);
    const example = db.prepare(`INSERT OR IGNORE INTO canonical_examples
        (id, canonical_field_key, example_text, normalized_text, source, status)
        VALUES (?, ?, ?, ?, 'ONTOLOGY', 'ACTIVE')`);
    const question = db.prepare(`INSERT OR IGNORE INTO canonical_question_catalog
        (canonical_field_key, display_question, answer_type, options_json, attention_type,
         ask_policy, status, created_source)
        VALUES (?, ?, ?, ?, 'FACT_REQUIRED', ?, 'TRUSTED', 'ONTOLOGY')`);
    const write = db.transaction(() => {
        for (const definition of definitions) {
            const key = String(definition.key || "").toUpperCase();
            if (!key || key === "CUSTOM_FIELD") continue;
            const sensitivity = /^(?:EEO_)|SPONSORSHIP|WORK_AUTHORIZATION/.test(key) ? "SENSITIVE" : "STANDARD";
            const category = String(definition.category || key.split("_")[0] || "APPLICATION").toUpperCase();
            const semanticGroup = String(definition.semanticGroup || category).toLowerCase();
            const dataType = Array.isArray(definition.options) && definition.options.length ? "ENUM" : "TEXT";
            const applicationOnly = sensitivity === "SENSITIVE" || APPLICATION_ONLY_CANONICALS.has(key);
            const scope = applicationOnly ? "APPLICATION_ONLY" : "CANDIDATE_PROFILE";
            const askPolicy = applicationOnly ? "CURRENT_APPLICATION_ONLY" : "WHEN_RELEVANT";
            upsert.run(key, definition.label || key, definition.description || definition.label || key,
                category, semanticGroup, dataType, dataType, scope, sensitivity,
                applicationOnly ? "NEVER" : "WHEN_RELEVANT",
                sensitivity === "SENSITIVE" ? "NEVER" : "POLICY_CONTROLLED", askPolicy);
            const normalized = normalizeSemanticText(definition.label || key);
            if (normalized) example.run(id("ontology", `${key}|${normalized}`), key, definition.label || key, normalized);
            question.run(key, definition.label || key, dataType, JSON.stringify(definition.options || []), askPolicy);
        }
    });
    write();
}

export function getCanonicalDefinition(key) {
    return publicCanonical(getDb().prepare("SELECT * FROM canonical_fields WHERE key = ?").get(String(key || "").toUpperCase()));
}

export function listCanonicalDefinitions({ includeProposed = false } = {}) {
    const statuses = includeProposed ? ["PROPOSED", "VALIDATED", "TRUSTED"] : ["VALIDATED", "TRUSTED"];
    return getDb().prepare(`SELECT * FROM canonical_fields
        WHERE status IN (${placeholders(statuses)}) AND merged_into_key IS NULL
        ORDER BY key`).all(...statuses).map(publicCanonical);
}

export function listCanonicalExamples({ statuses = ["ACTIVE"] } = {}) {
    return getDb().prepare(`SELECT e.*, c.description, c.label, c.status AS canonical_status
        FROM canonical_examples e JOIN canonical_fields c ON c.key = e.canonical_field_key
        WHERE e.status IN (${placeholders(statuses)}) AND c.status IN ('VALIDATED','TRUSTED')
          AND c.merged_into_key IS NULL
        ORDER BY e.updated_at DESC`).all(...statuses);
}

export function saveCanonicalExample({ canonicalFieldKey, text, embedding = null, embeddingModel = null, source = "LEARNED", status = "CANDIDATE" }) {
    const normalized = normalizeSemanticText(text);
    if (!canonicalFieldKey || !normalized) return null;
    const exampleId = id("example", `${canonicalFieldKey}|${normalized}`);
    getDb().prepare(`INSERT INTO canonical_examples
        (id, canonical_field_key, example_text, normalized_text, embedding_json, embedding_model, source, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_field_key, normalized_text) DO UPDATE SET
            embedding_json = COALESCE(excluded.embedding_json, canonical_examples.embedding_json),
            embedding_model = COALESCE(excluded.embedding_model, canonical_examples.embedding_model),
            status = CASE WHEN canonical_examples.status = 'ACTIVE' THEN 'ACTIVE' ELSE excluded.status END,
            updated_at = CURRENT_TIMESTAMP`)
        .run(exampleId, canonicalFieldKey, String(text).slice(0, 500), normalized,
            embedding ? JSON.stringify(embedding) : null, embeddingModel, String(source).slice(0, 40), status);
    return getDb().prepare("SELECT * FROM canonical_examples WHERE canonical_field_key = ? AND normalized_text = ?")
        .get(canonicalFieldKey, normalized);
}

export function saveCanonicalExampleEmbedding(exampleId, embedding, model) {
    if (!exampleId || !Array.isArray(embedding) || !embedding.length) return false;
    return getDb().prepare(`UPDATE canonical_examples SET embedding_json = ?, embedding_model = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(JSON.stringify(embedding), model, exampleId).changes > 0;
}

export function findSemanticMapping(descriptor) {
    const db = getDb();
    const reusable = placeholders(REUSABLE_MAPPING_STATUSES);
    const exact = db.prepare(`SELECT * FROM field_semantic_mappings
        WHERE exact_fingerprint = ? AND status IN (${reusable}) LIMIT 1`)
        .get(descriptor.fingerprints.exact, ...REUSABLE_MAPPING_STATUSES);
    if (exact) return { ...publicMapping(exact), lookupSource: "EXACT_MAPPING" };

    const global = placeholders(GLOBAL_MAPPING_STATUSES);
    const scoped = db.prepare(`SELECT * FROM field_semantic_mappings
        WHERE normalized_label = ? AND control_type = ? AND status IN (${global})
          AND (section_family = ? OR section_family = '')
          AND ((site_host != '' AND site_host = ?) OR (site_host = '' AND ats_type != '' AND ats_type = ?))
        ORDER BY CASE WHEN site_host = ? THEN 0 ELSE 1 END, confidence DESC, evidence_score DESC LIMIT 1`)
        .get(descriptor.source.normalizedLabel, descriptor.source.controlType, ...GLOBAL_MAPPING_STATUSES,
            descriptor.context.sectionFamily, descriptor.environment.host, descriptor.environment.ats, descriptor.environment.host);
    if (scoped) return { ...publicMapping(scoped), lookupSource: scoped.site_host ? "HOST_NORMALIZED_MAPPING" : "ATS_NORMALIZED_MAPPING" };

    const globalRow = db.prepare(`SELECT * FROM field_semantic_mappings
        WHERE normalized_label = ? AND control_type = ? AND status = 'TRUSTED'
          AND (section_family = ? OR section_family = '')
        ORDER BY confidence DESC, evidence_score DESC LIMIT 1`)
        .get(descriptor.source.normalizedLabel, descriptor.source.controlType, descriptor.context.sectionFamily);
    if (globalRow) return { ...publicMapping(globalRow), lookupSource: "GLOBAL_NORMALIZED_MAPPING" };
    return null;
}

export function saveSemanticMapping({ descriptor, canonicalFieldKey, source = "RULE", confidence = 0.8,
    status = "CANDIDATE", aiModel = null, promptVersion = null } = {}) {
    if (!descriptor || !canonicalFieldKey || descriptor.flags.skipLearning) return null;
    const db = getDb();
    const canonical = getCanonicalDefinition(canonicalFieldKey);
    if (!canonical || ["REJECTED", "MERGED"].includes(canonical.status)) return null;
    const existing = db.prepare("SELECT * FROM field_semantic_mappings WHERE exact_fingerprint = ?")
        .get(descriptor.fingerprints.exact);
    if (existing && existing.canonical_field_key !== canonicalFieldKey && existing.status === "TRUSTED") {
        return { ...publicMapping(existing), conflict: true, suggestedCanonicalFieldKey: canonicalFieldKey };
    }
    const mappingId = existing?.id || id("mapping", descriptor.fingerprints.exact);
    db.prepare(`INSERT INTO field_semantic_mappings
        (id, canonical_field_key, exact_fingerprint, semantic_fingerprint, normalized_label,
         ats_type, site_host, control_type, section_family, source, confidence, status, ai_model, prompt_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(exact_fingerprint) DO UPDATE SET
            canonical_field_key = CASE WHEN field_semantic_mappings.status = 'TRUSTED'
                THEN field_semantic_mappings.canonical_field_key ELSE excluded.canonical_field_key END,
            semantic_fingerprint = excluded.semantic_fingerprint,
            normalized_label = excluded.normalized_label,
            ats_type = excluded.ats_type, site_host = excluded.site_host,
            control_type = excluded.control_type, section_family = excluded.section_family,
            source = CASE WHEN field_semantic_mappings.status = 'TRUSTED' THEN field_semantic_mappings.source ELSE excluded.source END,
            confidence = MAX(field_semantic_mappings.confidence, excluded.confidence),
            status = CASE WHEN field_semantic_mappings.status IN ('VALIDATED','TRUSTED')
                THEN field_semantic_mappings.status ELSE excluded.status END,
            ai_model = COALESCE(excluded.ai_model, field_semantic_mappings.ai_model),
            prompt_version = COALESCE(excluded.prompt_version, field_semantic_mappings.prompt_version),
            observation_count = field_semantic_mappings.observation_count + 1,
            last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`)
        .run(mappingId, canonicalFieldKey, descriptor.fingerprints.exact, descriptor.fingerprints.semantic,
            descriptor.source.normalizedLabel, descriptor.environment.ats, descriptor.environment.host,
            descriptor.source.controlType, descriptor.context.sectionFamily, String(source).slice(0, 40),
            Math.max(0, Math.min(1, Number(confidence) || 0)), status, aiModel, promptVersion);
    const row = db.prepare("SELECT * FROM field_semantic_mappings WHERE exact_fingerprint = ?")
        .get(descriptor.fingerprints.exact);
    saveCanonicalExample({ canonicalFieldKey: row.canonical_field_key, text: descriptor.source.label,
        source, status: row.status === "TRUSTED" || row.status === "VALIDATED" ? "ACTIVE" : "CANDIDATE" });
    return publicMapping(row);
}

export function recordSemanticMappingEvidence({ mappingId, applicationId = null, attemptId = null,
    fieldSignature = "", eventType, metadata = {} } = {}) {
    if (!mappingId || !eventType) return null;
    // Only explicit semantic confirmation/correction can change semantic
    // confidence. Answer behavior is retained as a zero-weight raw event for
    // replay but cannot train field meaning.
    const delta = ["MAPPING_CONFIRMED", "SEMANTIC_CONFIRMED"].includes(eventType) ? 1
        : ["MAPPING_CORRECTED", "SEMANTIC_CORRECTED"].includes(eventType) ? -2 : 0;
    const evidenceKey = id("evidence", [mappingId, applicationId || "", attemptId || "", fieldSignature, eventType].join("|"));
    const db = getDb();
    const mappingAtObservation = db.prepare("SELECT canonical_field_key FROM field_semantic_mappings WHERE id = ?").get(mappingId);
    if (!mappingAtObservation) return null;
    const safeMetadata = {
        canonicalFieldKey: mappingAtObservation.canonical_field_key,
        correctedTo: metadata.correctedTo
            ? String(metadata.correctedTo).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 140) : null,
        classifierVersion: metadata.classifierVersion ? String(metadata.classifierVersion).slice(0, 40) : null,
        reasonCodes: Array.isArray(metadata.reasonCodes)
            ? metadata.reasonCodes.map((value) => String(value).slice(0, 100)).slice(0, 8) : []
    };
    const inserted = db.prepare(`INSERT OR IGNORE INTO semantic_mapping_evidence
        (id, evidence_key, mapping_id, application_id, attempt_id, field_signature, event_type, score_delta, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), evidenceKey, mappingId, applicationId, attemptId, String(fieldSignature || "").slice(0, 500),
            eventType, delta, JSON.stringify(safeMetadata)).changes > 0;
    if (!inserted) return publicMapping(db.prepare("SELECT * FROM field_semantic_mappings WHERE id = ?").get(mappingId));
    db.prepare(`UPDATE field_semantic_mappings SET
        evidence_score = evidence_score + ?,
        kept_count = kept_count + ?, overwrite_count = overwrite_count + ?,
        last_validated_at = CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE last_validated_at END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(delta, delta > 0 ? 1 : 0, delta < 0 ? 1 : 0, delta, mappingId);
    // This legacy score remains a human-readable audit summary only. Live
    // status transitions are deliberately admin-controlled; classified,
    // weighted recommendations are produced by adaptive evidence in SHADOW.
    return publicMapping(db.prepare("SELECT * FROM field_semantic_mappings WHERE id = ?").get(mappingId));
}

function proposalKey(value = "") {
    return normalizeSemanticText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 120);
}

function comparableCanonicalText(value = "") {
    return normalizeSemanticText(value)
        .replace(/\bemployer\b|\borganization\b/g, "company")
        .replace(/\bcompensation\b|\bctc\b/g, "salary")
        .replace(/\bmobile\b|\btelephone\b/g, "phone");
}

function canonicalConceptSimilarity(left, right) {
    const a = new Set(comparableCanonicalText(left).split(/\s+/).filter(Boolean));
    const b = new Set(comparableCanonicalText(right).split(/\s+/).filter(Boolean));
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    for (const token of a) if (b.has(token)) overlap += 1;
    return overlap / Math.min(a.size, b.size);
}

export function proposeCanonical({ canonicalName, label, description, semanticGroup = "application",
    dataType = "TEXT", answerType = null, sensitivity = "STANDARD", question = null,
    options = [], askPolicy = "CURRENT_APPLICATION_ONLY", createdSource = "AI_PROPOSAL" } = {}) {
    const key = proposalKey(canonicalName || label);
    if (!key || key === "CUSTOM_FIELD") return null;
    const db = getDb();
    const exact = getCanonicalDefinition(key);
    if (exact) return { canonical: exact, created: false };
    const proposalText = `${canonicalName || ""} ${label || ""}`;
    const semanticDuplicate = db.prepare(`SELECT * FROM canonical_fields
        WHERE merged_into_key IS NULL AND status IN ('PROPOSED','VALIDATED','TRUSTED')`).all()
        .map(publicCanonical)
        .map((canonical) => ({ canonical, similarity: Math.max(
            canonicalConceptSimilarity(proposalText, `${canonical.key} ${canonical.label}`),
            canonicalConceptSimilarity(description, canonical.description)
        ) }))
        .filter((entry) => entry.similarity >= 0.8)
        .sort((left, right) => right.similarity - left.similarity)[0];
    if (semanticDuplicate) return { canonical: semanticDuplicate.canonical, created: false,
        duplicate: true, similarity: semanticDuplicate.similarity };
    const normalizedDescription = normalizeSemanticText(description || label);
    const duplicate = db.prepare(`SELECT * FROM canonical_fields WHERE merged_into_key IS NULL
        AND (LOWER(label) = LOWER(?) OR LOWER(description) = LOWER(?))
        AND status IN ('PROPOSED','VALIDATED','TRUSTED') LIMIT 1`)
        .get(String(label || key), String(description || label || key));
    if (duplicate) return { canonical: publicCanonical(duplicate), created: false, duplicate: true };
    const write = db.transaction(() => {
        db.prepare(`INSERT INTO canonical_fields
            (key, label, description, category, semantic_group, data_type, answer_type, scope,
             sensitivity, status, created_source, reuse_policy, autofill_policy, ask_policy)
            VALUES (?, ?, ?, 'APPLICATION', ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?)`)
            .run(key, String(label || key).slice(0, 200), String(description || label || key).slice(0, 600),
                String(semanticGroup || "application").slice(0, 100), String(dataType || "TEXT").toUpperCase(),
                String(answerType || dataType || "TEXT").toUpperCase(),
                sensitivity === "STANDARD" ? "REUSABLE_ANSWER_LIBRARY" : "APPLICATION_ONLY",
                sensitivity, createdSource,
                sensitivity === "STANDARD" ? "WHEN_RELEVANT" : "NEVER",
                sensitivity === "STANDARD" ? "POLICY_CONTROLLED" : "NEVER", askPolicy);
        db.prepare(`INSERT INTO canonical_question_catalog
            (canonical_field_key, display_question, answer_type, options_json, attention_type,
             ask_policy, status, created_source) VALUES (?, ?, ?, ?, 'FACT_REQUIRED', ?, 'PROPOSED', ?)`)
            .run(key, String(question || label || description || key).slice(0, 500),
                String(answerType || dataType || "TEXT").toUpperCase(), JSON.stringify(options || []), askPolicy, createdSource);
        if (normalizedDescription) saveCanonicalExample({ canonicalFieldKey: key, text: description || label,
            source: createdSource, status: "CANDIDATE" });
    });
    write();
    return { canonical: getCanonicalDefinition(key), created: true };
}

export function setCanonicalStatus(key, status) {
    const allowed = new Set(["PROPOSED", "VALIDATED", "TRUSTED", "REJECTED"]);
    if (!allowed.has(status)) throw new Error("Invalid canonical status.");
    const result = getDb().prepare(`UPDATE canonical_fields SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE key = ? AND merged_into_key IS NULL`).run(status, String(key || "").toUpperCase());
    if (!result.changes) throw new Error("Canonical field not found.");
    getDb().prepare("UPDATE canonical_question_catalog SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_field_key = ?")
        .run(status, String(key || "").toUpperCase());
    if (status === "REJECTED") {
        getDb().prepare("UPDATE field_semantic_mappings SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE canonical_field_key = ?")
            .run(String(key || "").toUpperCase());
    }
    return getCanonicalDefinition(key);
}

export function setSemanticMappingStatus(mappingId, status) {
    const allowed = new Set(["CANDIDATE", "VALIDATED", "TRUSTED", "QUARANTINED", "REJECTED"]);
    if (!allowed.has(status)) throw new Error("Invalid semantic mapping status.");
    const db = getDb();
    const mapping = db.prepare("SELECT * FROM field_semantic_mappings WHERE id = ?").get(mappingId);
    if (!mapping) throw new Error("Semantic mapping not found.");
    const canonical = getCanonicalDefinition(mapping.canonical_field_key);
    if (["VALIDATED", "TRUSTED"].includes(status) && !["VALIDATED", "TRUSTED"].includes(canonical?.status)) {
        throw new Error("Approve the proposed canonical before validating its mappings.");
    }
    db.prepare(`UPDATE field_semantic_mappings SET status = ?,
        last_validated_at = CASE WHEN ? IN ('VALIDATED','TRUSTED') THEN CURRENT_TIMESTAMP ELSE last_validated_at END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, status, mappingId);
    return publicMapping(db.prepare("SELECT * FROM field_semantic_mappings WHERE id = ?").get(mappingId));
}

export function remapSemanticMapping(mappingId, canonicalFieldKey) {
    const targetKey = String(canonicalFieldKey || "").trim().toUpperCase();
    const db = getDb();
    const mapping = db.prepare("SELECT * FROM field_semantic_mappings WHERE id = ?").get(mappingId);
    if (!mapping) throw new Error("Semantic mapping not found.");
    const canonical = getCanonicalDefinition(targetKey);
    if (!canonical || !["VALIDATED", "TRUSTED"].includes(canonical.status)) {
        throw new Error("Validate the target canonical before applying this correction.");
    }
    if (mapping.canonical_field_key === targetKey) return publicMapping(mapping);
    const write = db.transaction(() => {
        recordSemanticMappingEvidence({
            mappingId,
            eventType: "ADMIN_REMAP_APPROVED",
            metadata: { correctedTo: targetKey, reasonCodes: ["ADMIN_APPROVED_SEMANTIC_REMAP"] }
        });
        db.prepare(`UPDATE field_semantic_mappings SET canonical_field_key = ?, status = 'CANDIDATE',
            confidence = MIN(confidence, 0.95), last_validated_at = NULL,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(targetKey, mappingId);
        db.prepare(`UPDATE attention_gaps SET status = 'EXPIRED', resolved_at = CURRENT_TIMESTAMP
            WHERE status = 'OPEN' AND canonical_field_key = ?`).run(mapping.canonical_field_key);
        db.prepare(`UPDATE attention_gaps SET calculated_at = datetime('now', '-1 day')
            WHERE status = 'OPEN'`).run();
    });
    write();
    return publicMapping(db.prepare("SELECT * FROM field_semantic_mappings WHERE id = ?").get(mappingId));
}

export function mergeCanonical(sourceKey, targetKey) {
    const source = String(sourceKey || "").toUpperCase();
    const target = String(targetKey || "").toUpperCase();
    if (!source || !target || source === target) throw new Error("Two different canonical keys are required.");
    if (!getCanonicalDefinition(source) || !getCanonicalDefinition(target)) throw new Error("Canonical field not found.");
    const db = getDb();
    const write = db.transaction(() => {
        const examples = db.prepare("SELECT * FROM canonical_examples WHERE canonical_field_key = ?").all(source);
        for (const example of examples) saveCanonicalExample({ canonicalFieldKey: target, text: example.example_text,
            embedding: example.embedding_json ? JSON.parse(example.embedding_json) : null,
            embeddingModel: example.embedding_model, source: "CANONICAL_MERGE", status: example.status });
        db.prepare("DELETE FROM canonical_examples WHERE canonical_field_key = ?").run(source);
        db.prepare("UPDATE field_semantic_mappings SET canonical_field_key = ?, updated_at = CURRENT_TIMESTAMP WHERE canonical_field_key = ?")
            .run(target, source);
        db.prepare("UPDATE application_schema_fields SET canonical_field_key = ? WHERE canonical_field_key = ?").run(target, source);
        db.prepare("UPDATE attention_items SET semantic_key = ? WHERE semantic_key = ?").run(target, source);
        db.prepare("UPDATE attention_gaps SET status = 'EXPIRED' WHERE canonical_field_key = ? AND status = 'OPEN'").run(source);
        db.prepare("DELETE FROM canonical_question_catalog WHERE canonical_field_key = ?").run(source);
        db.prepare(`UPDATE canonical_fields SET status = 'MERGED', merged_into_key = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`)
            .run(target, source);
    });
    write();
    return { source: getCanonicalDefinition(source), target: getCanonicalDefinition(target) };
}

export function questionForCanonical(key) {
    const row = getDb().prepare("SELECT * FROM canonical_question_catalog WHERE canonical_field_key = ?")
        .get(String(key || "").toUpperCase());
    if (!row) return null;
    let options = [];
    try { options = JSON.parse(row.options_json || "[]"); } catch { options = []; }
    return {
        canonicalFieldKey: row.canonical_field_key,
        displayQuestion: row.display_question,
        answerType: row.answer_type,
        options,
        attentionType: row.attention_type,
        askPolicy: row.ask_policy,
        status: row.status
    };
}

export function semanticLearningDiagnostics() {
    const db = getDb();
    const byStatus = db.prepare("SELECT status, COUNT(*) AS count FROM field_semantic_mappings GROUP BY status ORDER BY status").all();
    const bySource = db.prepare("SELECT source, COUNT(*) AS count FROM field_semantic_mappings GROUP BY source ORDER BY count DESC").all();
    const canonicals = db.prepare("SELECT status, COUNT(*) AS count FROM canonical_fields GROUP BY status ORDER BY status").all();
    const adaptiveColumns = `,
        (SELECT r.state FROM adaptive_evidence_shadow_rollups r
            WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
            ORDER BY r.updated_at DESC LIMIT 1) AS adaptiveState,
        COALESCE((SELECT r.lifetime_positive FROM adaptive_evidence_shadow_rollups r
            WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
            ORDER BY r.updated_at DESC LIMIT 1), 0) AS adaptivePositive,
        COALESCE((SELECT r.lifetime_negative FROM adaptive_evidence_shadow_rollups r
            WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
            ORDER BY r.updated_at DESC LIMIT 1), 0) AS adaptiveNegative,
        COALESCE((SELECT r.independent_run_count FROM adaptive_evidence_shadow_rollups r
            WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
            ORDER BY r.updated_at DESC LIMIT 1), 0) AS adaptiveRuns,
        COALESCE((SELECT r.independent_candidate_count FROM adaptive_evidence_shadow_rollups r
            WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
            ORDER BY r.updated_at DESC LIMIT 1), 0) AS adaptiveCandidates,
        COALESCE((SELECT r.volatile FROM adaptive_evidence_shadow_rollups r
            WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
            ORDER BY r.updated_at DESC LIMIT 1), 0) AS adaptiveVolatile,
        (SELECT json_extract(e.metadata_json, '$.correctedTo') FROM semantic_mapping_evidence e
            WHERE e.mapping_id = m.id AND e.event_type IN ('MAPPING_CORRECTED','MAPPING_ALTERNATIVE_CONFIRMED')
              AND json_extract(e.metadata_json, '$.correctedTo') IS NOT NULL
            ORDER BY e.created_at DESC LIMIT 1) AS suggestedCanonicalFieldKey`;
    const recent = db.prepare(`SELECT m.id, m.canonical_field_key AS canonicalFieldKey, m.normalized_label AS normalizedLabel,
        m.source, m.confidence, m.evidence_score AS evidenceScore, m.status, m.last_seen_at AS lastSeenAt
        ${adaptiveColumns}
        FROM field_semantic_mappings m ORDER BY m.updated_at DESC LIMIT 100`).all();
    const proposedCanonicals = listCanonicalDefinitions({ includeProposed: true })
        .filter((canonical) => canonical.status === "PROPOSED");
    const canonicalReviewQueue = listCanonicalDefinitions({ includeProposed: true })
        .filter((canonical) => canonical.status === "PROPOSED"
            || (canonical.status === "VALIDATED" && canonical.createdSource !== "ONTOLOGY"));
    const reviewQueue = db.prepare(`SELECT m.id, m.canonical_field_key AS canonicalFieldKey,
        c.label AS canonicalLabel, c.status AS canonicalStatus, m.normalized_label AS normalizedLabel,
        m.ats_type AS atsType, m.site_host AS siteHost, m.control_type AS controlType,
        m.section_family AS sectionFamily, m.source, m.confidence, m.evidence_score AS evidenceScore,
        m.kept_count AS confirmedCount, m.overwrite_count AS correctedCount, m.ai_model AS aiModel,
        m.prompt_version AS promptVersion, m.status
        ${adaptiveColumns},
        m.last_seen_at AS lastSeenAt
        FROM field_semantic_mappings m JOIN canonical_fields c ON c.key = m.canonical_field_key
        WHERE m.status IN ('CANDIDATE','VALIDATED','QUARANTINED') OR c.status = 'PROPOSED'
           OR EXISTS (SELECT 1 FROM adaptive_evidence_shadow_rollups r
               WHERE r.layer = 'SEMANTIC_MAPPING' AND r.subject_key IN (m.id, m.id || ':' || m.canonical_field_key)
                 AND r.state IN ('SHADOW_VOLATILE','SHADOW_DEGRADE_RECOMMENDED','SHADOW_QUARANTINE_RECOMMENDED'))
        ORDER BY CASE WHEN m.status = 'QUARANTINED' THEN 0 WHEN c.status = 'PROPOSED' THEN 1
                      WHEN m.status = 'VALIDATED' THEN 2 ELSE 3 END,
                 m.updated_at DESC LIMIT 200`).all();
    return { mappingsByStatus: byStatus, mappingsBySource: bySource, canonicalsByStatus: canonicals,
        cache: semanticCacheDiagnostics(),
        proposedCanonicals, canonicalReviewQueue, reviewQueue, recentMappings: recent };
}
