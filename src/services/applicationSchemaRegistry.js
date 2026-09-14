import crypto from "node:crypto";
import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { getCandidateProfile, listCandidateAnswers, LOCAL_USER_ID, saveCandidateAnswer, saveCandidateProfile } from "../repositories/copilotRepository.js";
import { EMPLOYER_FIELD_ONTOLOGY, semanticDefinition } from "./fieldOntology.js";
import { canonicalizeFieldSync } from "./fieldCanonicalizer.js";
import { buildFieldSemanticDescriptor } from "../contracts/fieldSemanticDescriptor.js";
import {
    ensureCanonicalDefinitions,
    getCanonicalDefinition,
    saveSemanticMapping
} from "../repositories/fieldSemanticRepository.js";

const FRESH_WINDOW_DAYS = env.applicationSchema.freshDays;
const DEFAULT_FRESH_DAYS = env.applicationSchema.expiryDays;
const MAX_RELEVANT_JOBS = 50;
const MIN_GAP_CONFIDENCE = 0.72;
const NEVER_PREDICT = new Set([
    "CUSTOM_FIELD", "RESUME", "COVER_LETTER", "EEO_GENDER", "EEO_RACE",
    "EEO_VETERAN", "EEO_DISABILITY", "WORK_AUTHORIZATION", "SPONSORSHIP"
]);

function hash(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeJson(value, fallback = []) {
    try { return JSON.parse(value || "") ?? fallback; } catch { return fallback; }
}

function ensureApplicationOnlyFallback() {
    getDb().prepare(`INSERT OR IGNORE INTO canonical_fields
        (key, label, description, category, semantic_group, data_type, answer_type,
         scope, sensitivity, status, created_source, reuse_policy, autofill_policy, ask_policy)
        VALUES ('CUSTOM_FIELD', 'Application-specific field', 'Unresolved application-only field',
         'APPLICATION', 'application', 'TEXT', 'TEXT', 'APPLICATION_ONLY', 'STANDARD',
         'TRUSTED', 'SYSTEM', 'NEVER', 'NEVER', 'NEVER')`).run();
    return "CUSTOM_FIELD";
}

function compatibilityDescriptor(question, { inputType = "text", contextKey = "", atsType = "generic" } = {}) {
    return buildFieldSemanticDescriptor({
        label: question,
        type: inputType,
        portalFieldKey: contextKey
    }, { ats: atsType });
}

export function rememberCanonicalMapping(question, canonicalKey, {
    confidence = 0.95, source = "RULE", inputType = "text", contextKey = "", atsType = "generic"
} = {}) {
    ensureCanonicalDefinitions(EMPLOYER_FIELD_ONTOLOGY);
    const canonical = getCanonicalDefinition(canonicalKey);
    if (!canonical || !["VALIDATED", "TRUSTED"].includes(canonical.status)) return null;
    const descriptor = compatibilityDescriptor(question, { inputType, contextKey, atsType });
    const mapping = saveSemanticMapping({ descriptor, canonicalFieldKey: canonical.key,
        confidence, source, status: "CANDIDATE" });
    return mapping ? {
        normalizedQuestion: descriptor.source.normalizedLabel,
        canonicalFieldKey: mapping.canonicalFieldKey,
        confidence: mapping.confidence,
        resolutionSource: mapping.source,
        observationCount: mapping.observationCount,
        lastSeenAt: mapping.lastSeenAt,
        status: mapping.status,
        mappingId: mapping.id
    } : null;
}

export function findCanonicalMapping(question, { inputType = "text", contextKey = "" } = {}) {
    const descriptor = compatibilityDescriptor(question, { inputType, contextKey });
    return getDb().prepare(`SELECT normalized_label AS normalizedQuestion,
        canonical_field_key AS canonicalFieldKey, confidence, source AS resolutionSource,
        observation_count AS observationCount, last_seen_at AS lastSeenAt,
        status, id AS mappingId
        FROM field_semantic_mappings
        WHERE normalized_label = ? AND control_type = ?
          AND status IN ('CANDIDATE','VALIDATED','TRUSTED')
        ORDER BY CASE status WHEN 'TRUSTED' THEN 0 WHEN 'VALIDATED' THEN 1 ELSE 2 END,
          confidence DESC, updated_at DESC LIMIT 1`)
        .get(descriptor.source.normalizedLabel, descriptor.source.controlType) || null;
}

function canonicalForField(field = {}, { publishMapping = false, atsType = "generic" } = {}) {
    ensureCanonicalDefinitions(EMPLOYER_FIELD_ONTOLOGY);
    const contextKey = field.field_signature || "";
    const supplied = String(field.semantic_key || "").toUpperCase();
    const suppliedCanonical = supplied && supplied !== "CUSTOM_FIELD" ? getCanonicalDefinition(supplied) : null;
    if (suppliedCanonical && !["REJECTED", "MERGED"].includes(suppliedCanonical.status)) {
        const canonicalized = canonicalizeFieldSync({
            label: field.field_label,
            type: field.field_type,
            required: Boolean(field.required),
            legal: Boolean(field.is_legal),
            sensitive: Boolean(field.is_sensitive),
            portalFieldKey: contextKey
        }, { ats: atsType, knownSemanticKey: supplied });
        if (publishMapping && !canonicalized.mapping) saveSemanticMapping({ descriptor: canonicalized.descriptor,
            canonicalFieldKey: supplied, confidence: 0.99, source: "VERIFIED_COMPLETION", status: "CANDIDATE" });
        return { key: supplied, confidence: Math.max(0.72, canonicalized.confidence),
            source: canonicalized.source || "OBSERVED_RESOLUTION" };
    }
    const canonicalized = canonicalizeFieldSync({
        label: field.field_label,
        type: field.field_type,
        required: Boolean(field.required),
        legal: Boolean(field.is_legal),
        sensitive: Boolean(field.is_sensitive),
        portalFieldKey: contextKey
    }, { ats: atsType });
    if (canonicalized.canonicalKey && canonicalized.confidence >= MIN_GAP_CONFIDENCE) {
        return { key: canonicalized.canonicalKey, confidence: canonicalized.confidence, source: canonicalized.source };
    }
    return { key: ensureApplicationOnlyFallback(), confidence: 0.35, source: "UNRESOLVED" };
}

function latestAttemptPages(attemptId) {
    return getDb().prepare(`
        SELECT id, page_url, portal_kind, created_at, rowid AS insertion_order
        FROM application_page_snapshots
        WHERE attempt_id = ?
        ORDER BY rowid ASC
    `).all(attemptId);
}

export function registerCurrentApplicationSchema(applicationId, { freshDays = DEFAULT_FRESH_DAYS } = {}) {
    const db = getDb();
    const application = db.prepare(`SELECT a.id, a.job_id, a.status, j.source, c.ats_type
        FROM applications a JOIN jobs j ON j.id = a.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE a.id = ?`).get(applicationId);
    if (!application) return null;
    const isComplete = application.status === "SUCCESS";
    const attempt = db.prepare(`SELECT id FROM application_attempts
        WHERE application_id = ? ORDER BY started_at DESC LIMIT 1`).get(applicationId);
    if (!attempt) return null;
    const pages = latestAttemptPages(attempt.id);
    if (!pages.length) return null;

    const observationsBySignature = new Map();
    const meaningfulPages = new Set();
    pages.forEach((page, pageIndex) => {
        const fields = db.prepare(`SELECT field_signature, field_label, semantic_key, field_type,
            required, is_legal, is_sensitive FROM application_field_snapshots
            WHERE page_snapshot_id = ? AND visible = 1 ORDER BY field_id`).all(page.id);
        for (const field of fields) {
            const canonical = canonicalForField(field, { publishMapping: isComplete,
                atsType: application.ats_type || application.source || page.portal_kind || "generic" });
            const signature = field.field_signature || hash(`${field.field_label}|${field.field_type}`);
            const existing = observationsBySignature.get(signature);
            if (!existing) meaningfulPages.add(pageIndex);
            observationsBySignature.set(signature, {
                ...field,
                field_signature: signature,
                pageIndex: existing?.pageIndex ?? pageIndex,
                canonicalKey: canonical.key,
                confidence: canonical.confidence
            });
        }
    });
    const observations = [...observationsBySignature.values()];
    if (!observations.length) return null;

    const structural = observations.map((field) => ({
        key: field.canonicalKey, signature: field.field_signature, page: field.pageIndex,
        required: Boolean(field.required), type: field.field_type
    })).sort((a, b) => `${a.page}|${a.signature}`.localeCompare(`${b.page}|${b.signature}`));
    const formHash = hash(JSON.stringify(structural));
    let schema = db.prepare("SELECT * FROM application_schemas WHERE job_id = ? AND form_hash = ?").get(application.job_id, formHash);
    const isNewSchema = !schema;
    if (!schema) {
        const version = Number(db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM application_schemas WHERE job_id = ?").get(application.job_id).version) + 1;
        const id = hash(`${application.job_id}|${formHash}`).slice(0, 32);
        db.prepare(`INSERT INTO application_schemas
            (id, job_id, ats_type, form_hash, version, confidence, observation_count, status, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now', '+' || ? || ' days'))`)
            .run(id, application.job_id, application.ats_type || application.source || "generic", formHash, version,
                observations.reduce((sum, field) => sum + field.confidence, 0) / observations.length,
                isComplete ? "FRESH" : "DRAFT", freshDays);
        schema = db.prepare("SELECT * FROM application_schemas WHERE id = ?").get(id);
    }
    const wasFresh = schema.status === "FRESH";
    const observed = isComplete && db.prepare(`INSERT OR IGNORE INTO application_schema_observations
        (schema_id, attempt_id, application_id) VALUES (?, ?, ?)`).run(schema.id, attempt.id, applicationId).changes > 0;
    if (isComplete && observed) {
        db.prepare(`UPDATE application_schemas SET observation_count = observation_count + 1,
            confidence = MIN(0.99, confidence + 0.02), status = 'FRESH', last_seen_at = CURRENT_TIMESTAMP,
            expires_at = datetime('now', '+' || ? || ' days'), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(freshDays, schema.id);
    } else if (isComplete) {
        db.prepare(`UPDATE application_schemas SET status = 'FRESH', last_seen_at = CURRENT_TIMESTAMP,
            expires_at = datetime('now', '+' || ? || ' days'), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(freshDays, schema.id);
    } else if (!wasFresh) {
        db.prepare(`UPDATE application_schemas SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(schema.id);
    }
    const insertField = db.prepare(`INSERT INTO application_schema_fields
        (schema_id, field_signature, canonical_field_key, raw_label, page_index, input_type,
         required, conditional, confidence, observation_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(schema_id, field_signature) DO UPDATE SET
            canonical_field_key = excluded.canonical_field_key,
            raw_label = excluded.raw_label, page_index = excluded.page_index,
            input_type = excluded.input_type, required = excluded.required,
            confidence = MAX(application_schema_fields.confidence, excluded.confidence),
            observation_count = application_schema_fields.observation_count + excluded.observation_count`);
    const write = db.transaction(() => {
        if (isComplete || !wasFresh) {
            for (const field of observations) {
                if (!getCanonicalDefinition(field.canonicalKey)) field.canonicalKey = ensureApplicationOnlyFallback();
                insertField.run(schema.id, field.field_signature, field.canonicalKey, field.field_label,
                    field.pageIndex, field.field_type || "text", field.required ? 1 : 0, field.confidence, observed ? 1 : 0);
            }
        }
        if (isComplete) db.prepare(`INSERT INTO current_application_schemas (job_id, schema_id)
            VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET
                schema_id = excluded.schema_id, refreshed_at = CURRENT_TIMESTAMP`).run(application.job_id, schema.id);
        db.prepare("UPDATE application_schemas SET status = 'STALE' WHERE job_id = ? AND id <> ? AND expires_at <= CURRENT_TIMESTAMP")
            .run(application.job_id, schema.id);
        if (isComplete) db.prepare(`UPDATE attention_gaps SET calculated_at = datetime('now', '-1 day')
            WHERE user_id IN (SELECT DISTINCT user_id FROM candidate_profiles)`).run();
    });
    write();
    const refreshed = db.prepare("SELECT * FROM application_schemas WHERE id = ?").get(schema.id);
    return { ...refreshed, complete: isComplete, isNewSchema, pageCount: meaningfulPages.size, fieldCount: observations.length };
}

function candidateKnownFields(userId = LOCAL_USER_ID) {
    const profile = getCandidateProfile();
    const known = new Set();
    const add = (key, value, acceptFalse = false) => {
        if (value !== undefined && value !== null && (acceptFalse || String(value).trim() !== "")) known.add(key);
    };
    if (!/^local user$/i.test(String(profile.name || "").trim())) add("FULL_NAME", profile.name);
    if (!/^local@example\.com$/i.test(String(profile.email || "").trim())) add("EMAIL", profile.email);
    add("PHONE", profile.phone);
    add("CURRENT_LOCATION", profile.currentLocation); add("COUNTRY", profile.country);
    add("LINKEDIN_URL", profile.linkedinUrl); add("GITHUB_URL", profile.githubUrl); add("PORTFOLIO_URL", profile.portfolioUrl);
    add("CURRENT_COMPANY", profile.currentCompany); add("CURRENT_INDUSTRY", profile.currentIndustry);
    add("TOTAL_EXPERIENCE", profile.totalExperienceYears); add("SKILLS", profile.skills?.length ? profile.skills : null);
    add("CURRENT_CTC", profile.currentCTC); add("EXPECTED_CTC", profile.expectedCTC);
    if (Number(profile.noticePeriodDays) > 0) known.add("NOTICE_PERIOD");
    add("LAST_WORKING_DATE", profile.lastWorkingDate); add("WORK_AUTHORIZATION", profile.workAuthorization);
    add("SPONSORSHIP", profile.sponsorshipRequired);
    for (const answer of listCandidateAnswers()) add(String(answer.questionKey || "").toUpperCase(), answer.answer, true);
    const approvedFacts = getDb().prepare(`SELECT semantic_key FROM candidate_fact_memory
        WHERE user_id = ? AND candidate_approved = 1
          AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP)`).all(userId);
    for (const fact of approvedFacts) known.add(fact.semantic_key);
    return known;
}

function publicGap(row) {
    const schemaIds = safeJson(row.source_schema_ids_json).map(String).filter(Boolean);
    const placeholders = schemaIds.map(() => "?").join(",");
    const lastSeenAt = schemaIds.length
        ? getDb().prepare(`SELECT MAX(last_seen_at) AS last_seen_at FROM application_schemas WHERE id IN (${placeholders})`).get(...schemaIds)?.last_seen_at
        : null;
    const lastSeenMs = lastSeenAt ? new Date(`${String(lastSeenAt).replace(" ", "T")}Z`).getTime() : NaN;
    const ageDays = Number.isFinite(lastSeenMs) ? (Date.now() - lastSeenMs) / 86400000 : 0;
    return {
        id: row.id,
        canonicalFieldKey: row.canonical_field_key,
        label: row.label,
        affectedJobCount: Number(row.affected_job_count || 0),
        affectedJobs: safeJson(row.affected_jobs_json),
        impactScore: Number(row.impact_score || 0),
        status: row.status,
        freshness: ageDays >= FRESH_WINDOW_DAYS ? "RECENT" : "FRESH",
        observedAt: lastSeenAt || null,
        expiresAt: row.expires_at,
        calculatedAt: row.calculated_at
    };
}

export function rebuildAttentionGaps(userId = LOCAL_USER_ID, { freshDays = DEFAULT_FRESH_DAYS } = {}) {
    const db = getDb();
    const known = candidateKnownFields(userId);
    const rows = db.prepare(`
        SELECT s.id AS schema_id, s.confidence AS schema_confidence, s.last_seen_at,
               j.id AS job_id, j.title, c.name AS company_name,
               f.canonical_field_key, f.raw_label, f.confidence AS field_confidence
        FROM current_application_schemas current
        JOIN application_schemas s ON s.id = current.schema_id
        JOIN jobs j ON j.id = current.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        JOIN application_schema_fields f ON f.schema_id = s.id
        JOIN canonical_fields cf ON cf.key = f.canonical_field_key
        WHERE s.expires_at > CURRENT_TIMESTAMP AND s.status = 'FRESH'
          AND f.required = 1
          AND cf.status = 'TRUSTED'
          AND cf.sensitivity = 'STANDARD'
          AND cf.scope IN ('CANDIDATE_PROFILE', 'REUSABLE_ANSWER_LIBRARY')
          AND cf.ask_policy != 'NEVER'
          AND j.status IN ('MATCHED', 'CLOSE', 'APPROVED', 'PENDING', 'APPLIED')
          AND NOT EXISTS (SELECT 1 FROM applications own_application
              WHERE own_application.job_id = j.id AND own_application.user_id = ?
                AND own_application.status = 'SUCCESS')
          AND NOT EXISTS (SELECT 1 FROM job_user_states candidate_state
              WHERE candidate_state.job_id = j.id AND candidate_state.user_id = ?
                AND candidate_state.dismissed = 1)
          AND COALESCE(j.last_seen_at, j.created_at) >= datetime('now', '-' || ? || ' days')
        ORDER BY COALESCE(j.match_score, j.pre_score, 0) DESC, s.last_seen_at DESC
        LIMIT ?
    `).all(userId, userId, freshDays, MAX_RELEVANT_JOBS * 30);
    const groups = new Map();
    for (const row of rows) {
        const key = String(row.canonical_field_key || "").toUpperCase();
        if (!key || key.startsWith("CUSTOM_") || NEVER_PREDICT.has(key) || known.has(key)) continue;
        const confidence = Math.min(Number(row.schema_confidence || 0), Number(row.field_confidence || 0));
        if (confidence < MIN_GAP_CONFIDENCE) continue;
        const group = groups.get(key) || {
            key, label: semanticDefinition(key).label || row.raw_label, jobs: new Map(), schemaIds: new Set(), confidence: 0
        };
        group.jobs.set(row.job_id, { id: row.job_id, company: row.company_name || "Company", role: row.title });
        group.schemaIds.add(row.schema_id);
        group.confidence = Math.max(group.confidence, confidence);
        groups.set(key, group);
    }
    const activeKeys = [...groups.keys()];
    const write = db.transaction(() => {
        db.prepare("UPDATE attention_gaps SET status = 'EXPIRED' WHERE user_id = ? AND status = 'OPEN'").run(userId);
        const upsert = db.prepare(`INSERT INTO attention_gaps
            (id, user_id, canonical_field_key, label, affected_job_count, affected_jobs_json,
             impact_score, status, source_schema_ids_json, expires_at, calculated_at, resolved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, datetime('now', '+' || ? || ' days'), CURRENT_TIMESTAMP, NULL)
            ON CONFLICT(user_id, canonical_field_key) DO UPDATE SET
                label = excluded.label, affected_job_count = excluded.affected_job_count,
                affected_jobs_json = excluded.affected_jobs_json, impact_score = excluded.impact_score,
                status = 'OPEN', source_schema_ids_json = excluded.source_schema_ids_json,
                expires_at = excluded.expires_at, calculated_at = CURRENT_TIMESTAMP, resolved_at = NULL`);
        for (const group of groups.values()) {
            const jobs = [...group.jobs.values()];
            const impact = Number((jobs.length * group.confidence).toFixed(3));
            upsert.run(hash(`${userId}|${group.key}`).slice(0, 32), userId, group.key, group.label,
                jobs.length, JSON.stringify(jobs.slice(0, 3)), impact, JSON.stringify([...group.schemaIds].slice(0, 20)), freshDays);
        }
    });
    write();
    return listAttentionGaps(userId, { rebuildIfStale: false, activeKeys });
}

export function listAttentionGaps(userId = LOCAL_USER_ID, { rebuildIfStale = true } = {}) {
    const db = getDb();
    if (rebuildIfStale) {
        const latest = db.prepare("SELECT MAX(calculated_at) AS calculated_at FROM attention_gaps WHERE user_id = ?").get(userId)?.calculated_at;
        if (!latest || new Date(`${String(latest).replace(" ", "T")}Z`).getTime() < Date.now() - 15 * 60 * 1000) {
            return rebuildAttentionGaps(userId);
        }
    }
    return db.prepare(`SELECT * FROM attention_gaps WHERE user_id = ? AND status = 'OPEN'
        AND expires_at > CURRENT_TIMESTAMP ORDER BY impact_score DESC, label ASC`).all(userId).map(publicGap);
}

export function applicationReadinessSummary(userId = LOCAL_USER_ID) {
    const rows = getDb().prepare(`SELECT DISTINCT f.canonical_field_key, cf.label
        FROM current_application_schemas current
        JOIN application_schemas s ON s.id = current.schema_id
        JOIN application_schema_fields f ON f.schema_id = s.id
        JOIN canonical_fields cf ON cf.key = f.canonical_field_key
        JOIN jobs j ON j.id = current.job_id
        WHERE s.status = 'FRESH' AND s.expires_at > CURRENT_TIMESTAMP
          AND f.required = 1 AND f.confidence >= ?
          AND cf.status = 'TRUSTED'
          AND cf.sensitivity = 'STANDARD' AND cf.scope <> 'APPLICATION_ONLY'
          AND cf.ask_policy != 'NEVER'
          AND j.status IN ('MATCHED', 'CLOSE', 'APPROVED', 'PENDING', 'APPLIED')
          AND NOT EXISTS (SELECT 1 FROM applications own_application
              WHERE own_application.job_id = j.id AND own_application.user_id = ?
                AND own_application.status = 'SUCCESS')
          AND NOT EXISTS (SELECT 1 FROM job_user_states candidate_state
              WHERE candidate_state.job_id = j.id AND candidate_state.user_id = ?
                AND candidate_state.dismissed = 1)`).all(MIN_GAP_CONFIDENCE, userId, userId);
    const repeatable = rows.filter((row) => !row.canonical_field_key.startsWith("CUSTOM_") && !NEVER_PREDICT.has(row.canonical_field_key));
    const known = candidateKnownFields(userId);
    const knownRows = repeatable.filter((row) => known.has(row.canonical_field_key));
    const missing = repeatable.filter((row) => !known.has(row.canonical_field_key));
    if (repeatable.length < 5) {
        return {
            credible: false,
            label: "Profile foundation ready",
            percent: null,
            knownFieldCount: known.size,
            requiredFieldCount: null,
            missing: []
        };
    }
    return {
        credible: true,
        label: `${knownRows.length} of ${repeatable.length} repeatable fields known`,
        percent: Math.round((knownRows.length / repeatable.length) * 100),
        knownFieldCount: knownRows.length,
        requiredFieldCount: repeatable.length,
        missing: missing.slice(0, 6).map((row) => ({ key: row.canonical_field_key, label: row.label }))
    };
}

export function resolveAttentionGap(canonicalFieldKey, value, userId = LOCAL_USER_ID) {
    const key = String(canonicalFieldKey || "").toUpperCase();
    if (!key || value === undefined || value === null || String(value).trim() === "") throw new Error("An answer is required.");
    const gap = getDb().prepare(`SELECT id FROM attention_gaps
        WHERE user_id = ? AND canonical_field_key = ? AND status = 'OPEN'
          AND expires_at > CURRENT_TIMESTAMP`).get(userId, key);
    if (!gap) throw new Error("This readiness question is no longer active.");
    const profileProperties = {
        CURRENT_CTC: "currentCTC", EXPECTED_CTC: "expectedCTC", NOTICE_PERIOD: "noticePeriodDays",
        LAST_WORKING_DATE: "lastWorkingDate", CURRENT_LOCATION: "currentLocation",
        WORK_AUTHORIZATION: "workAuthorization", SPONSORSHIP: "sponsorshipRequired"
    };
    if (profileProperties[key]) saveCandidateProfile({ [profileProperties[key]]: value });
    else saveCandidateAnswer({ questionKey: key, originalQuestion: semanticDefinition(key).label, answer: value,
        confidence: 1, source: "ATTENTION_GAP", evidence: "Candidate answered a recent application-readiness gap." });
    getDb().prepare(`UPDATE attention_gaps SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND canonical_field_key = ?`).run(userId, key);
    return { resolved: true, canonicalFieldKey: key, remaining: rebuildAttentionGaps(userId) };
}

export function seedCanonicalFieldCatalog() {
    ensureCanonicalDefinitions(EMPLOYER_FIELD_ONTOLOGY);
    ensureApplicationOnlyFallback();
    return getDb().prepare("SELECT COUNT(*) AS count FROM canonical_fields").get().count;
}
