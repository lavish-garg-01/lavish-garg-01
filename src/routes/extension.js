import crypto from "crypto";
import fs from "fs";
import { Router } from "express";
import { getDb } from "../database/connection.js";
import {
    getApplicationByJobId,
    getJobForApplication,
    invalidateContaminatedApplicationQuestions,
    listApplicationQuestions,
    addApplicationEvent,
    invalidateApplicationQuestion,
    savePendingQuestion,
    saveResolvedQuestion,
    updateApplicationStatus
} from "../repositories/applicationRepository.js";
import { getCandidateProfile, saveCandidateAnswer, LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { extractMinimumExperienceYears } from "../services/experienceEligibility.js";
import { evaluateMatchingPolicy, MATCH_EXCLUSION_CODES } from "../services/matchingPolicy.js";
import { currentCandidateMatchingProfile } from "../services/currentCandidateMatching.js";
import { generateCoverLetterPdf } from "../services/pdfGenerator.js";
import { aiGenerationEligible, normalizeQuestionKey, resolveQuestion, saveFormAnswer } from "../services/questionResolver.js";
import { loadResume } from "../services/resumeStore.js";
import {
    AGENT_STATES,
    classifyAgentField,
    manualActionPrompt,
    readinessStatus
} from "../services/applicationAgent.js";
import {
    answerAgentQuestion,
    countMappingQuestions,
    dismissPendingAgentQuestion,
    dismissPendingMappingQuestion,
    findFieldMapping,
    findPortalFieldPattern,
    getOrCreateAgentSession,
    hasSkippedAgentQuestion,
    queueAgentQuestion,
    recordPortalFieldPatternOutcome,
    rejectStaleFieldMapping,
    saveLocalDraftMapping,
    savePortalFieldPattern,
    skipAgentQuestion,
    transitionAgent
} from "../repositories/agentRepository.js";
import { candidateValuePrompt, contextualMappingPrompt, mappingChoices, semanticDefinition, shouldAskMappingQuestion } from "../services/fieldOntology.js";
import { buildApplicationPlan } from "../services/applicationPlanner.js";
import { validateResolvedValue } from "../services/applicationValueValidation.js";
import {
    attentionCount,
    getLatestApplicationPlan,
    listAttentionGroups,
    listAttentionItems,
    recordLearningEvent,
    resolveAbsentAttentionItems,
    resolveAttentionBatch,
    resolveAttentionItem,
    saveApplicationPlan,
    upsertAttentionItem
} from "../repositories/attentionRepository.js";
import {
    completeApplicationAttempt,
    ensureApplicationAttempt,
    listAttemptTimeline,
    recordFieldEvidence,
    reusableAnswerConsent,
    setApplicationLearningDisabled,
    setReusableAnswerConsent
} from "../repositories/learningRepository.js";
import { adapterHealthReport, recordAdapterIncident } from "../services/adapterHealth.js";
import { mappingOutcomeFromFill } from "../adapters/fillOutcomes.js";
import { allowAiForSemanticKey } from "../adapters/hotPath.js";
import { jobPlatform } from "../services/jobPlatform.js";
import { applySupportForJob, buildAssistCards, resolveAssistSession } from "../services/applySupport.js";
import { canUseAiApplicationAnswers } from "../services/privacyPolicy.js";
import { answerSidePanelQuestion } from "../services/sidePanelAssistant.js";
import { activeMappingPackForHost } from "../repositories/mappingPackRepository.js";
import { recordUsageEvent } from "../repositories/usageMeterRepository.js";
import { proposeMappingPatches } from "../services/learnProposer.js";
import { autofillPolicyMap, getAutofillPolicies, saveAutofillPolicy } from "../repositories/autofillPolicyRepository.js";
import { reconcileResumeProfile } from "../services/resumeProfileReconciliation.js";
import { recoverExtensionSession } from "../services/sessionRecovery.js";
import { RESUME_TEMPLATES } from "../services/resumeRenderer.js";
import { createFreshDashboardResumeVariant, selectDashboardApplicationResume, selectDashboardResumeVariant } from "./dashboard.js";
import { seedResumeVariantsFromJobs } from "../repositories/resumeVariantRepository.js";
import {
    capturePageSnapshot,
    completeAdapterRun,
    recordApplicationOutcome,
    recordFieldResolution
} from "../repositories/applicationIntelligenceRepository.js";
import { registerCurrentApplicationSchema } from "../services/applicationSchemaRegistry.js";
import { canonicalizeField, canonicalizeFieldSync, toSharedFieldSemanticResult } from "../services/fieldCanonicalizer.js";
import { buildFieldSemanticDescriptor } from "../contracts/fieldSemanticDescriptor.js";
import { buildFieldInteractionObservation } from "../contracts/fieldInteractionObservation.js";
import { classifyFieldInteraction } from "../services/fieldLearningClassifier.js";
import {
    classifyAttemptAtCheckpoint,
    fieldRevisionDiagnostics,
    recordCheckpointReceipt,
    recordEditSessionSnapshot,
    recordFieldRevision,
    recordNeutralObservation
} from "../services/fieldRevisionService.js";
import { getFeatureFlag } from "../repositories/featureFlagRepository.js";
import {
    authorizeExtensionRun,
    authorizeExtensionRunOrigin,
    commitResolvedRunFields,
    consumeExtensionLaunch,
    extensionProtocolDiagnostics,
    issueExtensionLaunch,
    rebindExtensionRun,
    recordProtocolMessage,
    updateRunGeneration
} from "../services/extensionLaunchProtocol.js";
import {
    extensionDeliveryDiagnostics,
    persistTelemetryBatch,
    runIdempotentExtensionMutation
} from "../services/extensionDeliveryService.js";
import {
    findSemanticMapping,
    questionForCanonical,
    getCanonicalDefinition,
    saveSemanticMapping
} from "../repositories/fieldSemanticRepository.js";
import { recordExplicitSemanticDecision } from "../services/semanticMappingEvidenceService.js";
import { buildFieldAnswerContracts, FIELD_ANSWER_CONTRACT_MODE } from "../services/fieldAnswerContractService.js";
import {
    candidateAnswerResolverConfig,
    persistCandidateAnswerResolutionParityBatch,
    routeCandidateAnswerResolution
} from "../services/candidateAnswerResolver.js";
import {
    finalizeRuntimeCandidateAnswerProposals,
    stageManualCandidateAnswerProposal,
    stageVersionedCandidateAnswerProposal
} from "../services/candidateAnswerRuntimeProposalService.js";
import { undoCandidateAnswerChangeSet } from "../services/candidateAnswerReversalService.js";

const router = Router();

function genericFieldLabel(value) {
    const token = String(value || "").trim();
    if (/^(?:field|input|select|react-select)[-_]?\d+$/i.test(token)) return true;
    if (/^[A-Za-z0-9_-]{6,}$/.test(token) && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token)) return true;
    return /^(?:select|search|textbox|input|choose|drop or select(?:\s*\([^)]*\))?|field(?:[\s_-]*\d+)?|application field(?:\s+\d+)?)$/i.test(token);
}

function normalizedUrl(raw = "") {
    try {
        const url = new URL(raw);
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
            if (/^(?:utm_|trk|tracking|ref|source)/i.test(key)) url.searchParams.delete(key);
        }
        return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`;
    } catch {
        return "";
    }
}

function findJobByUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/extension-diagnostic") {
            const jobId = String(url.searchParams.get("jobId") || "").trim();
            if (jobId) {
                const job = getDb().prepare("SELECT id, url FROM jobs WHERE id = ? AND status != 'ARCHIVED'").get(jobId);
                if (job) return job;
            }
        }
    } catch {
        // Fall through to regular employer URL matching.
    }
    const target = normalizedUrl(rawUrl);
    if (!target) return null;
    const direct = getDb().prepare(`
        SELECT j.id, j.url FROM jobs j
        WHERE j.status != 'ARCHIVED'
        ORDER BY j.created_at DESC LIMIT 1000
    `).all().find((job) => normalizedUrl(job.url) === target) || null;
    if (direct) return direct;
    return getDb().prepare(`
        SELECT j.id, j.url, aa.started_url, aa.current_url
        FROM application_attempts aa
        JOIN applications a ON a.id = aa.application_id
        JOIN jobs j ON j.id = a.job_id
        WHERE j.status != 'ARCHIVED'
        ORDER BY aa.started_at DESC LIMIT 1000
    `).all().find((row) => [row.started_url, row.current_url].some((url) => normalizedUrl(url) === target)) || null;
}

router.get("/extension-diagnostic", (req, res) => {
    const job = getJobForApplication(String(req.query.jobId || ""));
    if (!job) return res.status(404).send("Job not found.");
    res.render("extensionDiagnostic", { job });
});

function publicJob(job) {
    if (!job) return null;
    return {
        id: job.id,
        title: job.title,
        company: job.company_name,
        url: job.url,
        status: job.status,
        matchScore: job.match_score,
        yoeMin: job.yoe_min,
        hasResume: Boolean(job.generated_resume_path && fs.existsSync(job.generated_resume_path)),
        source: job.source || null,
        platform: jobPlatform(job),
        applySupport: applySupportForJob(job)
    };
}

function publicApplication(application) {
    if (!application) return null;
    return {
        id: application.id,
        adapter: application.adapter,
        status: application.status,
        failureReason: application.failure_reason || null,
        updatedAt: application.updated_at
    };
}

function siteHost(pageUrl = "") {
    try { return new URL(pageUrl).hostname.toLowerCase(); } catch { return "unknown-site"; }
}

function evidenceContext(req, pageUrl = "") {
    const pack = activeMappingPackForHost(pageUrl || req.body?.pageUrl || "");
    return {
        portalKind: req.body?.portalKind || pack.portalKind,
        extensionVersion: req.body?.extensionVersion || null,
        adapterKind: req.body?.adapterKind || pack.portalKind,
        adapterVersion: req.body?.adapterVersion || pack.adapterVersion,
        mappingPackId: req.body?.mappingPackId || pack.mappingPackId,
        mappingPackVersion: req.body?.mappingPackVersion ?? pack.version,
        mappingStage: req.body?.mappingStage || pack.stage,
        pageFingerprint: req.body?.pageFingerprint || null
    };
}

function fieldSignature(field = {}) {
    const rawName = String(field.name || "");
    const durableName = /^(?:field|input|select|react-select)-?\d+(?:-|$)/i.test(rawName) ? "" : rawName;
    return `${String(durableName || field.portalFieldKey || field.id || "field").toLowerCase()}|${String(field.type || "text").toLowerCase()}|${String(field.label || "").toLowerCase().replace(/\s+/g, " ").trim()}`.slice(0, 500);
}

export function structuralMappingInput(body = {}, questionRow = {}, applicationQuestion = null) {
    return {
        siteHost: String(body.siteHost || siteHost(body.pageUrl) || "unknown-site"),
        fieldSignature: String(body.fieldSignature || `field-id|${questionRow.field_id || "unknown"}`),
        fieldLabel: String(body.fieldLabel || applicationQuestion?.question || questionRow.prompt || questionRow.field_id || "Unknown field")
    };
}

const progressStates = {
    OPENING: AGENT_STATES.PAGE_DETECTED,
    FORM_DETECTED: AGENT_STATES.FORM_UNDERSTOOD,
    FIELDS_ANALYZED: AGENT_STATES.FORM_UNDERSTOOD,
    PLAN_READY: AGENT_STATES.PLAN_READY,
    FILLING: AGENT_STATES.FILLING_VERIFIED_FIELDS,
    WAITING_FOR_USER: AGENT_STATES.ASKING_CANDIDATE_QUESTION,
    READY_TO_SUBMIT: AGENT_STATES.READY_FOR_REVIEW,
    USER_ACTION_REQUIRED: AGENT_STATES.USER_ACTION_REQUIRED,
    UNKNOWN_FIELD: AGENT_STATES.UNKNOWN_FIELD,
    LOGIN_REQUIRED: AGENT_STATES.LOGIN_REQUIRED,
    CAPTCHA_REQUIRED: AGENT_STATES.CAPTCHA_REQUIRED,
    PORTAL_CHANGED: AGENT_STATES.PORTAL_CHANGED
};

function attentionTypeFor(item, answer = {}) {
    if (item.reason === "existing_value_conflict") return "DATA_CONFLICT";
    if (item.reason === "upload_required") return "UPLOAD_REQUIRED";
    if (item.reason === "ai_draft_review") return "OPEN_ENDED_REVIEW";
    if (answer.classification?.kind === "legal") return "LEGAL_CONFIRMATION";
    if (answer.classification?.kind === "sensitive") return "SENSITIVE_QUESTION";
    if (/RELOCAT|TRAVEL|SHIFT|WEEKEND|WORK_MODE|ONSITE|REMOTE|HYBRID/i.test(answer.normalizedKey || "")) return "PREFERENCE_REQUIRED";
    return "FACT_REQUIRED";
}

function persistedPlanSummary(plan) {
    const safe = (item) => ({
        fieldId: item.fieldId, label: item.label, reason: item.reason || null,
        provenance: item.provenance || null, group: item.group || null
    });
    return {
        version: plan.version, counts: plan.summary,
        ready: plan.actions.map(safe), review: plan.review.map(safe),
        conflicts: plan.conflicts.map(safe), completed: plan.completed.map(safe),
        submits: false
    };
}

function applicationSessionSummary(applicationId, pageUrl = "") {
    const attempts = listAttemptTimeline(applicationId);
    const attempt = attempts.at(-1);
    if (!attempt) return null;
    const pages = [...new Set((attempt.events || []).map((event) => event.metadata?.pageUrl)
        .concat((attempt.fields || []).map((field) => field.page_url)).filter(Boolean))];
    const allFields = attempt.fields || [];
    const fallbackPage = allFields.at(-1)?.page_url || "";
    const activePage = pageUrl || attempt.current_url || fallbackPage;
    const fields = activePage ? allFields.filter((field) => field.page_url === activePage) : allFields;
    const counts = fields.reduce((result, field) => {
        const state = String(field.final_state || "DETECTED").toUpperCase();
        let validation = {};
        try { validation = JSON.parse(field.validation_json || "{}"); } catch { validation = {}; }
        const valid = validation.valid !== false && String(field.fill_outcome || "").toUpperCase() !== "INVALID";
        result.detected += 1;
        if (["FILLED", "USER_EDITED"].includes(state) && valid) result.filled += 1;
        if (["BLOCKED", "INVALID"].includes(state) || !valid) result.needsHelp += 1;
        if (String(field.field_type || "").toLowerCase() === "file") {
            result.documents += 1;
            if (["FILLED", "USER_EDITED"].includes(state) && valid) result.documentsAttached += 1;
        }
        return result;
    }, { detected: 0, filled: 0, needsHelp: 0, documents: 0, documentsAttached: 0 });
    const lastEvent = (attempt.events || []).at(-1);
    return {
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.started_at,
        updatedAt: lastEvent?.created_at || attempt.started_at,
        currentUrl: attempt.current_url || null,
        pageCount: Math.max(pages.length, attempt.current_url ? 1 : 0),
        counts,
        fields: fields.slice(0, 120).map((field) => ({
            fieldId: field.field_id,
            label: field.field_label,
            type: field.field_type,
            state: field.final_state,
            fillOutcome: field.fill_outcome,
            valid: (() => { try { return JSON.parse(field.validation_json || "{}").valid !== false; } catch { return true; } })()
        })),
        lastMessage: lastEvent?.message || null
    };
}

function assistantApplicationContext(application) {
    if (!application?.id) return null;
    const db = getDb();
    const attempt = db.prepare(`SELECT id, status, current_url FROM application_attempts
        WHERE application_id = ? ORDER BY started_at DESC LIMIT 1`).get(application.id);
    if (!attempt) return { status: application.status, pageHost: "", fields: [], failures: [] };
    const fields = db.prepare(`SELECT field_label, semantic_key, field_type, required,
        is_legal, is_sensitive, final_state
        FROM application_field_evidence WHERE attempt_id = ? ORDER BY updated_at DESC LIMIT 120`).all(attempt.id)
        .map((field) => ({
            label: field.field_label,
            semanticKey: field.semantic_key || null,
            type: field.field_type,
            required: Boolean(field.required),
            sensitive: Boolean(field.is_sensitive || field.is_legal),
            state: field.final_state
        }));
    const failures = db.prepare(`SELECT phase, error_code, metadata_json
        FROM application_operation_events
        WHERE attempt_id = ? AND status = 'FAILED'
        ORDER BY client_time_ms DESC LIMIT 20`).all(attempt.id).map((row) => {
            let metadata = {};
            try { metadata = JSON.parse(row.metadata_json || "{}"); } catch { metadata = {}; }
            return {
                phase: row.phase,
                errorCode: row.error_code || null,
                reason: String(metadata.reason || "").slice(0, 160)
            };
        });
    return {
        status: application.status || attempt.status,
        pageHost: siteHost(attempt.current_url || ""),
        fields,
        failures
    };
}

function extensionProgress(jobId, status, message, metadata = {}) {
    const application = getApplicationByJobId(jobId);
    if (!application || application.adapter !== "EXTENSION") return null;
    const updated = updateApplicationStatus(application.id, status, message, { metadata });
    if (progressStates[status]) transitionAgent(application.id, progressStates[status], message, metadata);
    return updated;
}

function rejectExperienceMismatch(jobId, eligibility, pageUrl) {
    const db = getDb();
    const job = getJobForApplication(jobId);
    const analysis = (() => {
        try { return JSON.parse(job.ai_analysis || "{}"); } catch { return {}; }
    })();
    const explanation = `${eligibility.reason} Requirement confirmed on the employer application page.`;
    db.prepare(`
        UPDATE jobs SET
            yoe_min = ?, match_score = MIN(COALESCE(match_score, 35), 35),
            status = CASE WHEN status IN ('APPLIED','ARCHIVED') THEN status ELSE 'REJECTED' END,
            ai_analysis = ?
        WHERE id = ?
    `).run(
        eligibility.requiredYears,
        JSON.stringify({
            ...analysis,
            matchScore: Math.min(Number(analysis.matchScore ?? job.match_score ?? 35), 35),
            recommendation: "skip",
            explanation,
            minimumExperienceYears: eligibility.requiredYears,
            candidateExperienceYears: eligibility.candidateYears,
            experienceCompatible: false,
            eligibilitySource: pageUrl || "employer application page"
        }),
        jobId
    );
    const applications = db.prepare("SELECT id FROM applications WHERE job_id = ? AND status NOT IN ('SUCCESS','BLOCKED')").all(jobId);
    db.prepare(`
        UPDATE applications SET status = 'BLOCKED', failure_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ? AND status != 'SUCCESS'
    `).run(eligibility.reason, jobId);
    const event = db.prepare(`
        INSERT INTO application_events (application_id, event_type, message, metadata)
        VALUES (?, 'BLOCKED', ?, ?)
    `);
    for (const application of applications) {
        event.run(application.id, eligibility.reason, JSON.stringify({ pageUrl: pageUrl || "", requiredYears: eligibility.requiredYears }));
    }
}

export function analyzeExtensionPage(jobId, { pageText = "", pageUrl = "" } = {}) {
    const job = getJobForApplication(jobId);
    if (!job) throw new Error("Job not found.");
    const detected = extractMinimumExperienceYears(pageText);
    const enriched = { ...job, yoe_min: detected ?? job.yoe_min, description: `${job.description || ""}\n${String(pageText).slice(0, 30000)}` };
    const decision = evaluateMatchingPolicy(enriched, loadResume(), currentCandidateMatchingProfile(LOCAL_USER_ID), {
        context: "APPLICATION", saved: true
    });
    const experienceExclusion = decision.eligibility.exclusions.find((item) => item.code === MATCH_EXCLUSION_CODES.EXPERIENCE_GAP_TOO_LARGE);
    const eligibility = {
        allowed: !experienceExclusion,
        known: decision.minimumExperienceYears != null && decision.candidateExperienceYears != null,
        requiredYears: decision.minimumExperienceYears,
        candidateYears: decision.candidateExperienceYears,
        reason: experienceExclusion?.label || (decision.minimumExperienceYears == null
            ? "No explicit minimum experience requirement was found."
            : decision.candidateExperienceYears == null
                ? "Candidate experience is not yet confirmed; no hard conflict was inferred."
                : "Experience is inside the configured tolerance."),
        decision
    };
    if (detected !== null) getDb().prepare("UPDATE jobs SET yoe_min = ? WHERE id = ?").run(detected, jobId);
    if (!eligibility.allowed) rejectExperienceMismatch(jobId, eligibility, pageUrl);
    return { detectedExperienceYears: detected, eligibility, job: publicJob(getJobForApplication(jobId)) };
}

export function promoteVerifiedApplicationAnswers(applicationId, jobId, attemptId = null, { persistVector = true } = {}) {
    if (!reusableAnswerConsent(applicationId).allowed) return { promoted: 0, keys: [] };
    const db = getDb();
    const attempt = attemptId
        ? db.prepare("SELECT id FROM application_attempts WHERE id = ? AND application_id = ?").get(attemptId, applicationId)
        : db.prepare("SELECT id FROM application_attempts WHERE application_id = ? ORDER BY started_at DESC LIMIT 1").get(applicationId);
    if (!attempt) return { promoted: 0, keys: [] };
    const rows = db.prepare(`
        SELECT e.*, q.question_key
        FROM application_field_evidence e
        LEFT JOIN application_questions q ON q.application_id = e.application_id AND q.field_id = e.field_id
            AND q.status != 'INVALIDATED'
        WHERE e.attempt_id = ? AND e.final_state = 'USER_EDITED'
          AND e.is_legal = 0 AND e.is_sensitive = 0
          AND e.application_value IS NOT NULL AND e.application_value != ''
        ORDER BY e.updated_at ASC
    `).all(attempt.id);
    const approved = new Map();
    for (const row of rows) {
        if (genericFieldLabel(row.field_label)) continue;
        const mapping = findFieldMapping(row.site_host, row.field_signature);
        // Only registry-backed meaning can unlock reusable candidate memory.
        // Raw employer labels must never be converted into pseudo-canonicals.
        const semanticKey = [row.question_key, mapping?.semanticKey]
            .map((value) => String(value || "").trim().toUpperCase())
            .find((value) => {
                if (!value || value === "CUSTOM_FIELD") return false;
                const canonical = getCanonicalDefinition(value);
                return canonical && ["VALIDATED", "TRUSTED"].includes(canonical.status);
            }) || null;
        if (!semanticKey) continue;
        const field = { label: row.field_label, type: row.field_type };
        if (!validateResolvedValue(field, { normalizedKey: semanticKey, answer: row.application_value }).valid) continue;
        const classification = classifyAgentField(field, semanticKey);
        if (classification.scope !== "REUSABLE_ANSWER_LIBRARY" || !classification.autoFill) continue;
        approved.set(semanticKey, { row, field, semanticKey, classification });
    }
    for (const { row, field, semanticKey, classification } of approved.values()) {
        saveCandidateAnswer({
            questionKey: semanticKey,
            originalQuestion: row.field_label,
            answer: row.application_value,
            confidence: 1,
            source: "VERIFIED_APPLICATION_INPUT",
            evidence: "Candidate entered this answer and employer submission was verified."
        });
        if (persistVector) {
            void saveFormAnswer({
                questionText: row.field_label,
                answer: row.application_value,
                sourceJobId: jobId,
                semanticKey,
                field,
                answerScope: classification.scope,
                approvedByCandidate: true,
                profile: getCandidateProfile()
            });
        }
    }
    if (approved.size) db.prepare(`
        INSERT INTO application_events (application_id, event_type, message, metadata, attempt_id)
        VALUES (?, 'ANSWERS_PROMOTED', ?, ?, ?)
    `).run(applicationId, `Promoted ${approved.size} verified reusable answer(s).`,
        JSON.stringify({ semanticKeys: [...approved.keys()] }), attempt.id);
    return { promoted: approved.size, keys: [...approved.keys()] };
}

function runAuthorization(req, runId = req.params.runId) {
    return authorizeExtensionRun({
        runId: String(runId || req.header("x-job-hunter-run-id") || ""),
        sessionToken: String(req.header("x-job-hunter-run-token") || ""),
        targetOrigin: req.header("x-job-hunter-target-origin") || null
    });
}

function idempotentRouteResult(req, { runId = null, eventType }, mutate) {
    const idempotencyKey = req.header("idempotency-key") || null;
    if (idempotencyKey) runAuthorization(req, runId);
    return runIdempotentExtensionMutation({
        idempotencyKey,
        runId,
        request: req.body || {},
        eventType
    }, mutate).result;
}

router.post("/api/extension/launches/issue", (req, res) => {
    try {
        recordProtocolMessage({
            messageId: req.body?.messageId,
            nonce: req.body?.clientNonce,
            messageType: "JOB_HUNTER_LAUNCH_REQUEST",
            sourceOrigin: req.body?.websiteOrigin,
            sentAtMs: req.body?.sentAtMs
        });
        res.status(201).json(issueExtensionLaunch({
            jobId: req.body?.jobId,
            websiteOrigin: req.body?.websiteOrigin,
            targetUrl: req.body?.targetUrl,
            protocolVersion: req.body?.protocolVersion,
            clientNonce: req.body?.clientNonce
        }));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/launches/consume", (req, res) => {
    try {
        res.json(consumeExtensionLaunch(req.body || {}));
    } catch (error) {
        res.status(409).json({ error: error.message });
    }
});

router.post("/api/extension/runs/bootstrap", (req, res) => {
    try {
        const binding = runAuthorization(req, req.body?.runId);
        const application = getDb().prepare("SELECT * FROM applications WHERE id = ? AND user_id = ?")
            .get(binding.application_id, LOCAL_USER_ID);
        if (!application) throw new Error("The bound application is unavailable.");
        const job = getJobForApplication(application.job_id);
        res.json({
            schemaVersion: 1,
            protocolVersion: binding.protocol_version,
            runContext: {
                runId: binding.run_id,
                applicationId: binding.application_id,
                bindingVersion: binding.version,
                targetOrigin: binding.target_origin,
                expiresAtMs: binding.expires_at_ms
            },
            job: publicJob(job),
            application: publicApplication(application)
        });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

router.post("/api/extension/runs/:runId/resolve-delta", (req, res) => {
    try {
        const binding = runAuthorization(req);
        const result = updateRunGeneration(binding, {
            pageGeneration: req.body?.pageGeneration,
            formGeneration: req.body?.formGeneration,
            fields: Array.isArray(req.body?.fields) ? req.body.fields : []
        });
        res.json({ ...result, applicationId: binding.application_id, runId: binding.run_id, resolveMode: "CHANGED_FIELDS_ONLY" });
    } catch (error) {
        res.status(409).json({ error: error.message });
    }
});

router.post("/api/extension/runs/:runId/resolve-delta/commit", (req, res) => {
    try {
        const binding = runAuthorization(req);
        res.json(commitResolvedRunFields(binding, Array.isArray(req.body?.logicalFieldFingerprints)
            ? req.body.logicalFieldFingerprints : []));
    } catch (error) {
        res.status(409).json({ error: error.message });
    }
});

router.post("/api/extension/runs/:runId/rebind", (req, res) => {
    try {
        const binding = runAuthorization(req);
        res.json(rebindExtensionRun(binding, req.body || {}));
    } catch (error) {
        res.status(409).json({ error: error.message });
    }
});

router.post("/api/extension/runs/:runId/authorize-origin", (req, res) => {
    try {
        const binding = runAuthorization(req);
        res.json(authorizeExtensionRunOrigin(binding, req.body?.currentUrl));
    } catch (error) {
        res.status(409).json({ error: error.message });
    }
});

router.get("/api/extension/runs/:runId/protocol-diagnostics", (req, res) => {
    try {
        runAuthorization(req);
        res.json(extensionProtocolDiagnostics(req.params.runId));
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

router.post("/api/extension/runs/:runId/telemetry", (req, res) => {
    try {
        const binding = runAuthorization(req);
        const envelopes = Array.isArray(req.body?.envelopes) ? req.body.envelopes : [];
        res.json(idempotentRouteResult(req, { runId: binding.run_id, eventType: "TELEMETRY_BATCH" },
            () => persistTelemetryBatch(binding, envelopes)));
    } catch (error) {
        res.status(409).json({ error: error.message });
    }
});

router.get("/api/extension/runs/:runId/delivery-diagnostics", (req, res) => {
    try {
        runAuthorization(req);
        res.json(extensionDeliveryDiagnostics(req.params.runId));
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

router.get("/api/extension/job-context", (req, res) => {
    const requestedJob = req.query.jobId ? getJobForApplication(String(req.query.jobId)) : null;
    const match = requestedJob || findJobByUrl(req.query.url);
    const job = match ? getJobForApplication(match.id) : null;
    const application = job ? getApplicationByJobId(job.id) : null;
    const attempt = application ? ensureApplicationAttempt(application.id, String(req.query.url || job.url || "")) : null;
    res.json({
        job: publicJob(job),
        application: application ? publicApplication(application) : null,
        runContext: attempt ? { runId: attempt.id, applicationId: application.id, schemaVersion: 1 } : null
    });
});

router.post("/api/extension/assistant/ask", async (req, res) => {
    try {
        const question = String(req.body?.question || "").trim();
        const requestedJobId = String(req.body?.jobId || "").trim();
        const job = requestedJobId ? getJobForApplication(requestedJobId) : null;
        if (requestedJobId && !job) throw new Error("The linked application is no longer available.");
        const application = job ? getApplicationByJobId(job.id) : null;
        const answer = await answerSidePanelQuestion(question, {
            profile: getCandidateProfile(),
            resume: loadResume(),
            job,
            application: assistantApplicationContext(application)
        });
        recordUsageEvent({
            meterKey: "AI_ASSISTANT_REQUEST",
            quantity: 1,
            unit: "request",
            metadata: {
                source: answer.source,
                safety: answer.safety,
                grounded: answer.grounded,
                jobId: job?.id || null,
                pageHost: siteHost(String(req.body?.pageUrl || "")),
                questionHash: crypto.createHash("sha256").update(question).digest("hex").slice(0, 16),
                questionLength: question.length,
                answerLength: String(answer.answer || "").length
            }
        });
        res.json(answer);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get("/api/extension/jobs/:id/sidecar-state", (req, res) => {
    try {
        const job = getJobForApplication(req.params.id);
        const application = getApplicationByJobId(req.params.id);
        if (!job || !application) throw new Error("Application not found.");
        const profile = getCandidateProfile();
        const currentPageUrl = String(req.query.pageUrl || "");
        const currentPlatform = currentPageUrl ? jobPlatform({ url: currentPageUrl }) : null;
        const currentApplySupport = currentPageUrl ? applySupportForJob({ url: currentPageUrl }) : null;
        const resume = loadResume();
        const resumeVariants = seedResumeVariantsFromJobs();
        const plan = getLatestApplicationPlan(application.id);
        const activeAttempt = getDb().prepare(`SELECT id FROM application_attempts
            WHERE application_id = ? AND status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1`).get(application.id);
        const operationRows = activeAttempt ? getDb().prepare(`SELECT operation_id AS operationId,
            operation_key AS operationKey, phase, semantic_key AS semanticKey,
            target_signature AS targetSignature, status, attempt_number AS attemptNumber,
            duration_ms AS durationMs, error_code AS errorCode, created_at AS createdAt
            FROM application_operation_events WHERE attempt_id = ? ORDER BY client_time_ms DESC, created_at DESC LIMIT 160`).all(activeAttempt.id) : [];
        const latestOperationMap = new Map();
        for (const item of operationRows) if (!latestOperationMap.has(item.operationKey)) latestOperationMap.set(item.operationKey, item);
        const latestOperations = [...latestOperationMap.values()];
        const resumeAvailable = Boolean(job.generated_resume_path && fs.existsSync(job.generated_resume_path));
        const resumeRevision = resumeAvailable ? String(Math.trunc(fs.statSync(job.generated_resume_path).mtimeMs)) : null;
        const planFields = new Set([...(plan?.summary?.ready || []), ...(plan?.summary?.review || []),
            ...(plan?.summary?.conflicts || []), ...(plan?.summary?.completed || [])].map((item) => String(item.fieldId)));
        const attentionItems = listAttentionItems({ applicationId: application.id }).filter((item) =>
            (!plan?.pageUrl || item.pageUrl === plan.pageUrl) && (!planFields.size || planFields.has(String(item.fieldId))));
        res.json({
            job: publicJob(job), application: publicApplication(application),
            currentPlatform,
            currentApplySupport,
            applySupport: applySupportForJob(job),
            assistPreview: applySupportForJob(job)?.mode !== "AUTOFILL"
                ? { applySupport: applySupportForJob(job), cards: buildAssistCards({ profile }) }
                : null,
            documents: {
                resumeAvailable,
                resumeRevision,
                coverLetterAvailable: Boolean(job.cover_letter?.trim()),
                coverLetterText: job.cover_letter || "",
                selectedResumeTemplate: job.resume_template || "ats",
                resumeTemplates: RESUME_TEMPLATES,
                selectedResumeVariantId: job.resume_variant_id || null,
                resumeVariants: resumeVariants.map(({ modifications, ...variant }) => variant)
            },
            agentSession: getOrCreateAgentSession(application.id),
            plan,
            operations: {
                latest: latestOperations,
                counts: latestOperations.reduce((counts, item) => {
                    const key = String(item.status || "UNKNOWN").toUpperCase();
                    counts[key] = (counts[key] || 0) + 1;
                    return counts;
                }, {})
            },
            attentionItems,
            globalAttentionCount: attentionCount(),
            reuseConsent: reusableAnswerConsent(application.id),
            autofillPolicies: getAutofillPolicies(),
            profileReconciliation: reconcileResumeProfile(profile, resume),
            applicationSession: applicationSessionSummary(application.id, plan?.pageUrl),
            aiApplicationAnswers: canUseAiApplicationAnswers(profile),
            profileDetails: {
                ...profile,
                experience: (resume.experience || []).slice(0, 12).map((item) => ({
                    title: item.title || "", company: item.company || "", location: item.location || "",
                    startDate: item.startDate || "", endDate: item.endDate || "",
                    description: item.description || "", bullets: (item.bullets || []).slice(0, 8)
                })),
                education: (resume.education || []).slice(0, 8).map((item) => ({
                    institution: item.institution || item.school || "", degree: item.degree || "",
                    field: item.field || item.fieldOfStudy || "", location: item.location || "",
                    startDate: item.startDate || "", endDate: item.endDate || "", description: item.description || ""
                }))
            },
            quickCopy: {
                name: profile.name, email: profile.email, phone: profile.phone,
                linkedin: profile.linkedinUrl, github: profile.githubUrl, portfolio: profile.portfolioUrl,
                currentCompany: profile.currentCompany, currentLocation: profile.currentLocation,
                currentCTC: profile.currentCTC, expectedCTC: profile.expectedCTC,
                noticePeriod: profile.noticePeriodDays == null ? "" : `${profile.noticePeriodDays} days`
            }
        });
    } catch (error) { res.status(404).json({ error: error.message }); }
});

router.get("/api/extension/attention", (_req, res) => {
    res.json({ items: listAttentionItems(), groups: listAttentionGroups(), blockingCount: attentionCount() });
});

router.post("/api/extension/attention/batch-resolve", (req, res) => {
    try {
        const result = resolveAttentionBatch({ ids: req.body.ids, decision: req.body.decision, candidateApproved: req.body.candidateApproved === true });
        for (const item of result.items) recordLearningEvent({
            type: "PREFERENCE_CHANGED", applicationId: item.application_id, fieldId: item.field_id,
            metadata: { source: "BATCH_CONFLICT_RESOLUTION", candidateApproved: true, reason: result.decision }
        });
        res.json({ resolved: result.resolved, decision: result.decision });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get("/api/extension/autofill-policies", (_req, res) => res.json({ policies: getAutofillPolicies() }));

router.post("/api/extension/autofill-policies", (req, res) => {
    try { res.json({ policy: saveAutofillPolicy(req.body) }); }
    catch (error) { res.status(400).json({ error: error.message }); }
});

router.get("/api/extension/profile-reconciliation", (_req, res) => {
    res.json(reconcileResumeProfile(getCandidateProfile(), loadResume()));
});

router.get("/api/extension/adapter-health", (_req, res) => {
    res.json(adapterHealthReport());
});

router.get("/api/extension/mapping-pack", (req, res) => {
    res.json(activeMappingPackForHost(req.query.host || req.query.url || ""));
});

router.post("/api/extension/jobs/:id/attention/:fieldId/resolve", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        const decision = String(req.body.decision || "").toUpperCase();
        if (!new Set(["KEEP_EXISTING", "USE_PROFILE", "EDIT_MANUALLY"]).has(decision)) throw new Error("Invalid conflict decision.");
        resolveAttentionItem(application.id, req.params.fieldId);
        recordLearningEvent({
            type: decision === "USE_PROFILE" ? "FACT_CONFIRMED" : "PREFERENCE_CHANGED",
            applicationId: application.id, fieldId: req.params.fieldId,
            metadata: { source: "CONFLICT_RESOLUTION", candidateApproved: true, reason: decision }
        });
        res.json({ resolved: true, decision });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/progress", (req, res) => {
    try {
        const allowed = new Set(["OPENING", "FORM_DETECTED", "FORM_CHANGED", "FIELDS_ANALYZED", "PLAN_READY", "FILLING", "WAITING_FOR_USER", "READY_TO_SUBMIT", "USER_ACTION_REQUIRED", "UNKNOWN_FIELD", "LOGIN_REQUIRED", "CAPTCHA_REQUIRED", "PORTAL_CHANGED"]);
        const status = String(req.body.status || "").toUpperCase();
        if (!allowed.has(status)) throw new Error("Invalid extension progress status.");
        const application = extensionProgress(req.params.id, status, String(req.body.message || status), req.body.metadata || {});
        if (!application) throw new Error("Prepare this job with the extension from Qualified Jobs first.");
        res.json({ application: publicApplication(application) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/jobs/:id/operation-event", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application || application.adapter !== "EXTENSION") throw new Error("No active extension application was found.");
        const status = String(req.body.status || "").toUpperCase();
        const allowed = new Set(["DETECTED", "PLANNED", "STARTED", "FILLED", "SKIPPED", "REVIEW", "CONFIRMED", "FAILED"]);
        if (!allowed.has(status)) throw new Error("Invalid operation status.");
        const pageUrl = String(req.body.pageUrl || "").slice(0, 2000);
        const attempt = ensureApplicationAttempt(application.id, pageUrl);
        const safeMetadata = req.body.metadata && typeof req.body.metadata === "object" ? {
            portalKind: String(req.body.metadata.portalKind || "").slice(0, 80),
            extensionVersion: String(req.body.metadata.extensionVersion || "").slice(0, 40),
            adapterVersion: String(req.body.metadata.adapterVersion || "").slice(0, 40),
            documentKind: String(req.body.metadata.documentKind || "").slice(0, 40),
            reason: String(req.body.metadata.reason || "").slice(0, 200)
        } : {};
        getDb().prepare(`INSERT INTO application_operation_events
            (id, application_id, attempt_id, operation_id, operation_key, page_url, phase,
             semantic_key, target_signature, status, attempt_number, trigger_events_json,
             file_hash, duration_ms, error_code, extension_version, portal_kind, adapter_version,
             metadata_json, client_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(crypto.randomUUID(), application.id, attempt.id,
                String(req.body.operationId || crypto.randomUUID()).slice(0, 120),
                String(req.body.operationKey || "operation").slice(0, 500), pageUrl,
                String(req.body.phase || "FILL").slice(0, 80),
                req.body.semanticKey ? String(req.body.semanticKey).slice(0, 100) : null,
                req.body.targetSignature ? String(req.body.targetSignature).slice(0, 500) : null,
                status, Math.max(1, Math.min(10, Number(req.body.attemptNumber) || 1)),
                JSON.stringify((Array.isArray(req.body.triggerEvents) ? req.body.triggerEvents : []).map(String).slice(0, 8)),
                req.body.fileHash ? String(req.body.fileHash).slice(0, 100) : null,
                Number.isFinite(Number(req.body.durationMs)) ? Math.max(0, Math.round(Number(req.body.durationMs))) : null,
                req.body.errorCode ? String(req.body.errorCode).slice(0, 100) : null,
                safeMetadata.extensionVersion || null, safeMetadata.portalKind || null, safeMetadata.adapterVersion || null,
                JSON.stringify(safeMetadata), Number.isFinite(Number(req.body.clientTimeMs)) ? Number(req.body.clientTimeMs) : Date.now());
        res.status(201).json({ recorded: true });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/analyze-page", (req, res) => {
    try {
        res.json(analyzeExtensionPage(req.params.id, req.body));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/jobs/:id/assist", (req, res) => {
    try {
        const job = getJobForApplication(req.params.id);
        if (!job) throw new Error("Job not found.");
        const session = resolveAssistSession({
            url: req.body.pageUrl || job.url,
            pageText: req.body.pageText || "",
            questions: req.body.questions || [],
            portalKind: req.body.portalKind || "",
            hasLikelyForm: req.body.hasLikelyForm === true,
            instantApplySuppressed: req.body.instantApplyBoard === true || req.body.instantApplySuppressed === true,
            easyApplyUi: req.body.easyApplyUi === true,
            surface: req.body.surface || "",
            profile: getCandidateProfile()
        });
        res.json({ job: publicJob(job), ...session });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/jobs/:id/assist-copy", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application || application.adapter !== "EXTENSION" || application.status === "SUCCESS") {
            throw new Error("No active prepared application was found.");
        }
        const semanticKey = String(req.body.semanticKey || "UNKNOWN").replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 100);
        const surface = String(req.body.surface || "assist").replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 80);
        addApplicationEvent(application.id, "ASSIST_VALUE_COPIED", "Candidate copied a prepared Assist answer.", {
            semanticKey,
            surface
        });
        res.json({ recorded: true, semanticKey, surface });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/jobs/:id/resolve-fields", async (req, res) => {
    try {
        const page = analyzeExtensionPage(req.params.id, req.body);
        if (!page.eligibility.allowed) return res.status(409).json({ blocked: true, ...page });
        const profile = getCandidateProfile();
        const resume = loadResume();
        const job = getJobForApplication(req.params.id);
        const application = getApplicationByJobId(req.params.id);
        const session = application ? getOrCreateAgentSession(application.id) : null;
        if (application) invalidateContaminatedApplicationQuestions(application.id);
        const previousAnswers = new Map(
            application
                ? listApplicationQuestions(application.id)
                    .filter((question) => question.status === "ANSWERED" && question.answer != null)
                    .map((question) => [question.field_id, question])
                : []
        );
        const answers = [];
        const host = siteHost(req.body.pageUrl);
        const runtime = activeMappingPackForHost(req.body.pageUrl);
        const context = evidenceContext(req, req.body.pageUrl);
        if (runtime.killed) {
            return res.json({
                blocked: false,
                killed: true,
                killReason: runtime.killReason,
                job: page.job,
                answers: [],
                plan: { actions: [], review: [], summary: { ready: 0, needsYou: 0, manual: 0, aiDrafts: 0 } },
                currentQuestion: null,
                sensitiveFields: [],
                attentionItems: [],
                reuseConsent: application ? reusableAnswerConsent(application.id) : null,
                agentSession: application ? getOrCreateAgentSession(application.id) : null
            });
        }
        let mappingQuestionCount = application ? countMappingQuestions(application.id) : 0;
        const locallyFilled = new Set((Array.isArray(req.body.locallyFilledFieldIds) ? req.body.locallyFilledFieldIds : []).map(String));
        const fieldsToProcess = (Array.isArray(req.body.fields) ? req.body.fields : [])
            .filter((field) => !locallyFilled.has(String(field.id || "")))
            .slice(0, 80);
        const snapshot = application ? capturePageSnapshot(application.id, req.body.pageUrl, fieldsToProcess, {
            reason: "FIELDS_ANALYZED",
            adapterKind: context.adapterKind || "EXTENSION",
            adapterVersion: context.adapterVersion || "1",
            extensionVersion: context.extensionVersion,
            mappingPackVersion: context.mappingPackVersion,
            mappingStage: context.mappingStage
        }) : null;
        if (application) recordFieldEvidence(application.id, req.body.pageUrl, fieldsToProcess.map((field) => ({
            ...field,
            fieldSignature: fieldSignature(field),
            finalState: "DETECTED",
            fillOutcome: "NOT_ATTEMPTED",
            intendedAction: "NOT_ATTEMPTED",
            value: field.legal || field.sensitive ? null : field.value
        })), context);
        
        // Resolve questions in parallel batches to avoid 30s extension timeout
        const resolvedData = [];
        for (let i = 0; i < fieldsToProcess.length; i += 10) {
            const batch = fieldsToProcess.slice(i, i + 10);
            const batchResults = await Promise.all(batch.map(async (field) => {
                const signature = fieldSignature(field);
                const pattern = findPortalFieldPattern(host, field.portalFieldKey);
                const learned = findFieldMapping(host, signature) || (pattern?.semanticKey ? { semanticKey: pattern.semanticKey, status: "PORTAL_PATTERN" } : null);
                const canonicalization = await canonicalizeField(field, {
                    ats: context.adapterKind || context.portalKind || runtime.portalKind || "generic",
                    portalKind: context.portalKind || runtime.portalKind,
                    host,
                    adapterVersion: context.adapterVersion || runtime.adapterVersion,
                    knownSemanticKey: learned?.semanticKey || null
                });
                const inference = canonicalization.inference;
                const previous = previousAnswers.get(field.id);
                const trustedKey = canonicalization.decision === "RESOLVED" ? canonicalization.canonicalKey : null;
                const semanticKey = canonicalization.canonicalKey || inference.key;
                const aiAllowed = allowAiForSemanticKey(semanticKey, runtime.pack)
                    && aiGenerationEligible(semanticKey, field);
                const previousAiIsNowBlocked = String(previous?.source || "").toUpperCase() === "AI_GROUNDED" && !aiAllowed;
                // Never replay an application answer merely because an
                // unstable DOM field id happens to match. A current semantic
                // key must independently confirm the stored answer's key.
                const previousIsCompatible = Boolean(previous && trustedKey && previous.question_key === trustedKey && !previousAiIsNowBlocked);
                const mappingRequiresConfirmation = ["NEEDS_CONFIRMATION", "NEW_CONCEPT_PROPOSED"].includes(canonicalization.decision);
                const candidateResolved = previousIsCompatible
                    ? {
                        normalizedKey: previous.question_key,
                        answer: previous.answer,
                        confidence: Number(previous.confidence || 1),
                        source: previous.source || "APPLICATION_DRAFT",
                        evidence: previous.evidence || "Saved for this application.",
                        requiresUserInput: false
                    }
                    : mappingRequiresConfirmation
                        ? {
                            normalizedKey: semanticKey,
                            answer: null,
                            confidence: canonicalization.confidence,
                            source: "MAPPING_CONFIRMATION_REQUIRED",
                            evidence: "This field meaning is a candidate mapping and must be confirmed before any saved answer can be used.",
                            requiresUserInput: true
                        }
                        : !trustedKey
                            ? { normalizedKey: "CUSTOM_FIELD", answer: null, confidence: 0, source: "UNKNOWN_MAPPING", evidence: "No safe canonical meaning is available, so reusable memory was not used.", requiresUserInput: true }
                            : await resolveQuestion(trustedKey, {
                            profile, resume, job, field,
                            allowAi: aiAllowed
                        }).catch(e => ({ answer: null, confidence: 0, source: "ERROR", evidence: e.message, normalizedKey: field.label }));
                const validation = field.type === "file"
                    ? { valid: true, resolved: candidateResolved }
                    : validateResolvedValue(field, candidateResolved);
                return { field, signature, learned, canonicalization, inference, previous, previousIsCompatible, previousAiIsNowBlocked, trustedKey,
                    resolved: validation.resolved, validation };
            }));
            resolvedData.push(...batchResults);
        }

        // Part 2B shadow boundary. The current resolver remains authoritative;
        // these contracts are computed in one batch and returned only for parity
        // inspection until the staged cutover gates are explicitly enabled.
        let fieldAnswerContracts = [];
        let fieldAnswerShadowError = false;
        try {
            fieldAnswerContracts = buildFieldAnswerContracts({
                userId: LOCAL_USER_ID,
                fields: resolvedData.map(({ field, canonicalization }) => ({
                    fieldId: field.id,
                    semantic: toSharedFieldSemanticResult(canonicalization),
                    control: {
                        type: field.type,
                        options: field.options,
                        minLength: Number.isInteger(field.minLength) ? field.minLength : null,
                        maxLength: Number.isInteger(field.maxLength) ? field.maxLength : null,
                        min: field.min != null && Number.isFinite(Number(field.min)) ? Number(field.min) : null,
                        max: field.max != null && Number.isFinite(Number(field.max)) ? Number(field.max) : null,
                        step: field.step != null && Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : null,
                        pattern: field.pattern || ""
                    }
                })),
                context: {
                    applicationId: application?.id,
                    companyId: job?.company_id,
                    companyName: job?.company_name,
                    countryCode: req.body?.countryCode || job?.country_code,
                    country: req.body?.country || job?.country,
                    roleTitle: job?.title,
                    location: job?.location,
                    employmentType: job?.employment_type
                }
            });
        } catch {
            // A shadow failure must never interrupt the established autofill
            // path. Values are intentionally excluded from diagnostics/logs.
            fieldAnswerShadowError = true;
            fieldAnswerContracts = resolvedData.map(({ field, canonicalization }) => ({
                fieldId: field.id,
                canonicalKey: canonicalization.canonicalKey || null,
                status: "NEEDS_USER",
                reasonCodes: ["FIELD_ANSWER_SHADOW_ERROR"],
                policy: null,
                contract: null
            }));
        }
        const fieldAnswerContractById = new Map(fieldAnswerContracts.map((result) => [result.fieldId, result]));
        const candidateAnswerParityEvents = [];

        for (const data of resolvedData) {
            const { field, signature, learned, canonicalization, inference, previous, previousIsCompatible, previousAiIsNowBlocked, trustedKey, resolved, validation } = data;

            if (application && learned?.semanticKey && inference.obvious && learned.semanticKey !== inference.key) {
                rejectStaleFieldMapping({ siteHost: host, fieldSignature: signature, portalFieldKey: field.portalFieldKey,
                    observedLabel: field.label, inferredSemanticKey: inference.key });
                addApplicationEvent(application.id, "FIELD_MAPPING_REJECTED",
                    `Rejected stale ${host} mapping for “${field.label}”.`, {
                        metadata: { fieldId: field.id, previousSemanticKey: learned.semanticKey, inferredSemanticKey: inference.key,
                            portalFieldKey: field.portalFieldKey, automationEligible: true }
                    });
                recordLearningEvent({ type: "FIELD_MAPPING_REJECTED", applicationId: application.id, fieldId: field.id,
                    memoryKey: learned.semanticKey, memoryScope: "STRUCTURAL_ONLY",
                    metadata: { observedLabel: field.label, correctedSemanticKey: inference.key, portalFieldKey: field.portalFieldKey } });
            }
            if (application && previous && !previousIsCompatible) {
                const rejectionReason = previousAiIsNowBlocked ? "AI_IDENTITY_FACT_UNGROUNDED" : "STALE_SEMANTIC_KEY";
                invalidateApplicationQuestion(application.id, field.id, rejectionReason);
                addApplicationEvent(application.id, "STALE_APPLICATION_ANSWER_REJECTED",
                    previousAiIsNowBlocked
                        ? `Ignored an AI-generated identity/profile value for “${field.label}”.`
                        : `Ignored a saved answer whose semantic key no longer matches “${field.label}”.`, {
                        metadata: { fieldId: field.id, savedSemanticKey: previous.question_key, inferredSemanticKey: inference.key,
                            reason: rejectionReason, automationEligible: true }
                    });
                recordLearningEvent({
                    type: "STALE_APPLICATION_ANSWER_REJECTED", applicationId: application.id, fieldId: field.id,
                    memoryKey: previous.question_key, memoryScope: "APPLICATION_ONLY",
                    metadata: { reason: previousAiIsNowBlocked
                        ? "AI cannot supply identity or social-profile facts."
                        : "Current field semantics conflict with the stored answer key." }
                });
            }
            if (application && !validation.valid) {
                if (previous) invalidateApplicationQuestion(application.id, field.id, validation.reason);
                addApplicationEvent(application.id, "VALUE_SEMANTIC_MISMATCH",
                    `A stored or resolved value did not match “${field.label}” and was not filled.`, {
                        metadata: { fieldId: field.id, semanticKey: resolved.normalizedKey,
                            controlType: field.type, reason: validation.reason, automationEligible: false }
                    });
                recordLearningEvent({
                    type: "VALUE_SEMANTIC_MISMATCH", applicationId: application.id, fieldId: field.id,
                    memoryKey: resolved.normalizedKey, memoryScope: "APPLICATION_ONLY",
                    metadata: { controlType: field.type, reason: validation.reason }
                });
            }

            // Document controls are actions, never candidate questions. Clear
            // stale questions created by older/generic portal mappings and use
            // an explicit semantic key so upload evidence stays meaningful.
            if (field.type === "file") {
                const identity = `${field.label || ""} ${field.name || ""} ${field.id || ""}`;
                const documentKey = /input_cover_letter|cover.?letter/i.test(identity) && !/input_resume/i.test(`${field.name || ""} ${field.id || ""}`)
                    ? "COVER_LETTER"
                    : "RESUME";
                const documentResolved = {
                    normalizedKey: documentKey,
                    answer: null,
                    confidence: 1,
                    source: "GENERATED_DOCUMENT",
                    evidence: documentKey === "COVER_LETTER" ? "Job-specific cover letter asset." : "Selected tailored resume asset.",
                    requiresUserInput: false
                };
                savePortalFieldPattern({
                    siteHost: host,
                    portalFieldKey: field.portalFieldKey,
                    fieldLabel: documentKey === "COVER_LETTER" ? "Cover letter" : "Resume",
                    controlKind: "file",
                    selectorCandidates: field.selectorCandidates,
                    containerSignature: field.containerSignature,
                    semanticKey: documentKey
                });
                if (application) dismissPendingAgentQuestion(application.id, field.id);
                answers.push({
                    fieldId: field.id,
                    label: documentKey === "COVER_LETTER" ? "Cover letter" : "Resume",
                    learnedMapping: Boolean(learned),
                    fieldAnswerResolution: fieldAnswerContractById.get(field.id) || null,
                    classification: classifyAgentField({ ...field, label: documentKey === "COVER_LETTER" ? "Cover letter" : "Resume" }, documentKey),
                    ...documentResolved
                });
                if (application) recordFieldResolution(application.id, req.body.pageUrl, field, documentResolved, field.value ? "SAFE_FILL" : "REVIEW");
                continue;
            }
            
            if (application && !learned && canonicalization.decision === "RESOLVED" && inference.obvious) {
                saveLocalDraftMapping({ siteHost: host, fieldSignature: signature, fieldLabel: field.label, semanticKey: inference.key, status: "AUTO_INFERRED" });
                dismissPendingMappingQuestion(application.id, field.id);
            }
            savePortalFieldPattern({
                siteHost: host, portalFieldKey: field.portalFieldKey, fieldLabel: field.label,
                controlKind: field.type, selectorCandidates: field.selectorCandidates,
                containerSignature: field.containerSignature,
                semanticKey: trustedKey
            });
            
            const classification = classifyAgentField(field, resolved.normalizedKey);
            let safeResolved = classification.autoFill === false && ["legal", "sensitive"].includes(classification.kind)
                ? { ...resolved, answer: null, confidence: 0, source: "MANUAL_ACTION", requiresUserInput: true }
                : resolved;

            let resolutionRouting = {
                mode: "SHADOW_COMPARE",
                productionSource: safeResolved.answer == null ? "NONE" : "LEGACY",
                comparisonOutcome: "SHADOW_ERROR",
                canaryEligible: false,
                reasonCodes: ["PARITY_LEDGER_FAILS_OPEN_TO_LEGACY"]
            };
            try {
                const routed = routeCandidateAnswerResolution({
                    userId: LOCAL_USER_ID,
                    applicationId: application?.id || null,
                    applicationRunId: req.body?.runId || req.body?.applicationRunId || null,
                    fieldLogicalId: String(field.id || signature),
                    canonicalKey: canonicalization.canonicalKey || safeResolved.normalizedKey || null,
                    controlType: field.type,
                    legacyResolution: safeResolved,
                    versionedResolution: fieldAnswerContractById.get(field.id) || null,
                    protectedField: ["legal", "sensitive"].includes(classification.kind),
                    shadowError: fieldAnswerShadowError,
                    persistParity: false
                });
                safeResolved = routed.productionResolution;
                resolutionRouting = routed.routing;
                if (routed.parityEvent) candidateAnswerParityEvents.push(routed.parityEvent);
            } catch {
                // Parity persistence and staged routing are fail-open to the
                // established resolver. A diagnostic write must never block a
                // candidate from continuing an application.
            }

            // Use the current resolution immediately, but do not publish it to
            // shared structure memory. Canonical mappings are promoted only
            // after a verified application completion.
            
            answers.push({
                fieldId: field.id,
                label: field.label,
                learnedMapping: Boolean(learned || canonicalization.mapping),
                classification,
                canonicalResolution: {
                    key: canonicalization.canonicalKey,
                    decision: canonicalization.decision,
                    source: canonicalization.source,
                    confidence: canonicalization.confidence,
                    mappingStatus: canonicalization.mapping?.status || null,
                    reasonCodes: canonicalization.reasonCodes,
                    contract: toSharedFieldSemanticResult(canonicalization)
                },
                fieldAnswerResolution: fieldAnswerContractById.get(field.id) || null,
                resolutionRouting,
                ...safeResolved
            });
            if (application) recordFieldResolution(application.id, req.body.pageUrl, field, safeResolved,
                classification.autoFill === false ? "MANUAL_ONLY" : safeResolved.answer == null ? "REVIEW" : "SAFE_FILL");
            if (application && field.type !== "file") {
                if (safeResolved.requiresUserInput || safeResolved.answer == null || Number(safeResolved.confidence || 0) < 0.7) {
                    // No longer queuing manual questions
                } else {
                    saveResolvedQuestion(application.id, field, safeResolved);
                }
            }
            // Reusable memory is promoted only from a candidate-entered or
            // candidate-confirmed value after reusable-answer consent.
            if (!application || !field.required || previous || field.type === "file") continue;
            if (hasSkippedAgentQuestion(application.id, field.id)) continue;
            let question = null;
            if (["legal", "sensitive"].includes(classification.kind)) {
                question = { fieldId: field.id, questionType: "MANUAL_ACTION", prompt: manualActionPrompt(field.label), answerScope: "NEVER_PERSIST" };
            } else if (req.body.teachMode !== false
                && (["NEEDS_CONFIRMATION", "NEW_CONCEPT_PROPOSED"].includes(canonicalization.decision)
                    || (!learned && shouldAskMappingQuestion(inference, mappingQuestionCount)))
                && !["START_DATE", "TOTAL_EXPERIENCE"].includes(safeResolved.normalizedKey)) {
                const suggestedDefinition = canonicalization.canonical || semanticDefinition(safeResolved.normalizedKey);
                const suggested = { ...suggestedDefinition, alternatives: inference.alternatives };
                question = {
                    fieldId: field.id,
                    questionType: "CONFIRM_MAPPING",
                    prompt: contextualMappingPrompt(field.label, suggested),
                    suggestedSemanticKey: safeResolved.normalizedKey,
                    answerScope: classification.scope,
                    options: mappingChoices(suggested),
                    siteHost: host,
                    fieldSignature: signature,
                    fieldLabel: field.label
                };
                mappingQuestionCount += 1;
            } else if ((safeResolved.requiresUserInput || safeResolved.answer == null) && !genericFieldLabel(field.label)) {
                const options = Array.isArray(field.options) && field.options.length
                    ? field.options
                    : (semanticDefinition(safeResolved.normalizedKey).options || []).map((value) => ({ value, label: value }));
                question = {
                    fieldId: field.id,
                    questionType: options.length ? "CHOOSE_OPTION" : "ASK_VALUE",
                    prompt: candidateValuePrompt(field.label, safeResolved.normalizedKey, classification.scope),
                    suggestedSemanticKey: safeResolved.normalizedKey,
                    answerScope: classification.scope,
                    options
                };
            }
            if (question) queueAgentQuestion(application.id, question);
        }
        try {
            // One short transaction per page, never one autocommit per field.
            // This remains value-redacted and fail-open to the legacy path.
            persistCandidateAnswerResolutionParityBatch(candidateAnswerParityEvents);
        } catch {
            // Diagnostics cannot interrupt application progress.
        }
        const currentQuestion = session ? getOrCreateAgentSession(application.id).pendingQuestion : null;
        if (application && currentQuestion) transitionAgent(application.id,
            currentQuestion.questionType === "CONFIRM_MAPPING" ? AGENT_STATES.TEACHING_UNKNOWN_FIELD
                : currentQuestion.questionType === "MANUAL_ACTION" ? AGENT_STATES.USER_ACTION_REQUIRED
                    : AGENT_STATES.ASKING_CANDIDATE_QUESTION,
            currentQuestion.prompt, { fieldId: currentQuestion.fieldId });
        const sensitiveFields = answers.filter((a) => a.classification?.kind === "legal" || a.classification?.kind === "sensitive").map((a) => ({
            fieldId: a.fieldId, label: a.label, kind: a.classification.kind
        }));
        const plan = buildApplicationPlan({ fields: fieldsToProcess, answers, categoryPolicies: autofillPolicyMap() });
        let attentionItems = [];
        if (application) {
            saveApplicationPlan(application.id, req.body.pageUrl, persistedPlanSummary(plan));
            const answerByField = new Map(answers.map((answer) => [answer.fieldId, answer]));
            const blockers = [...plan.review, ...plan.conflicts];
            for (const item of blockers) {
                const answer = answerByField.get(item.fieldId) || {};
                upsertAttentionItem(application.id, {
                    fieldId: item.fieldId,
                    type: attentionTypeFor(item, answer),
                    title: questionForCanonical(answer.normalizedKey)?.status === "TRUSTED"
                        ? questionForCanonical(answer.normalizedKey).displayQuestion
                        : item.label,
                    reason: item.reason === "existing_value_conflict"
                        ? "This form already contains a different value. Choose which value to keep."
                        : item.reason === "candidate_confirmation"
                            ? "This field requires your direct confirmation."
                            : item.reason === "upload_required"
                                ? "A required file must be attached and verified."
                                : "No safe, verified answer is available yet.",
                    semanticKey: answer.normalizedKey,
                    answerScope: answer.classification?.scope,
                    options: currentQuestion?.fieldId === item.fieldId ? currentQuestion.options : [],
                    priority: item.reason === "candidate_confirmation" ? 90 : item.reason === "existing_value_conflict" ? 85 : 70,
                    blocking: true,
                    pageUrl: req.body.pageUrl
                });
            }
            resolveAbsentAttentionItems(application.id, blockers.map((item) => item.fieldId), req.body.pageUrl);
            attentionItems = listAttentionItems({ applicationId: application.id });
            transitionAgent(application.id, AGENT_STATES.PLAN_READY,
                `${plan.summary.ready} safe field(s) ready; ${plan.summary.needsYou + plan.summary.manual + plan.summary.aiDrafts} need review.`,
                { counts: plan.summary, pageUrl: req.body.pageUrl });
            if (snapshot) completeAdapterRun(snapshot.runId, {
                status: blockers.length ? "NEEDS_REVIEW" : "VERIFIED",
                filledCount: plan.summary.ready,
                reviewCount: blockers.length
            });
        }
        res.json({
            blocked: false, job: page.job, answers, plan, currentQuestion, sensitiveFields, attentionItems,
            candidateTruthContracts: {
                mode: FIELD_ANSWER_CONTRACT_MODE,
                resolver: candidateAnswerResolverConfig(),
                productionApplied: answers.some((answer) => answer.resolutionRouting?.productionSource === "VERSIONED")
            },
            reuseConsent: application ? reusableAnswerConsent(application.id) : null,
            agentSession: application ? getOrCreateAgentSession(application.id) : null
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/jobs/:id/agent-questions/:questionId/answer", async (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        const db = getDb();
        const row = db.prepare(`
            SELECT q.*, s.application_id FROM agent_questions q JOIN agent_sessions s ON s.id = q.agent_session_id WHERE q.id = ?
        `).get(req.params.questionId);
        if (!row || row.application_id !== application.id) throw new Error("Agent question not found.");
        const answer = String(req.body.answer ?? "").trim();
        let learnedSemanticKey = row.suggested_semantic_key;
        let semanticMapping = null;
        if (String(req.body.action || "").toUpperCase() === "SKIP") {
            const result = skipAgentQuestion(req.params.questionId);
            return res.json({ skipped: true, nextQuestion: result.nextQuestion, session: getOrCreateAgentSession(application.id) });
        }
        if (row.question_type === "MANUAL_ACTION") throw new Error("This field must be confirmed directly on the employer form.");
        if (row.question_type === "CONFIRM_MAPPING") {
            const confirmed = /^(?:yes|true)$/i.test(answer);
            const semanticKey = confirmed
                ? row.suggested_semantic_key
                : String(req.body.semanticKey || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
            const options = (() => { try { return JSON.parse(row.options_json || "[]"); } catch { return []; } })();
            if (!semanticKey) return res.json({ chooseMapping: true, options, nextQuestion: { id: row.id, fieldId: row.field_id, questionType: row.question_type, prompt: row.prompt, suggestedSemanticKey: row.suggested_semantic_key, answerScope: row.answer_scope, options } });
            const applicationQuestion = db.prepare("SELECT * FROM application_questions WHERE application_id = ? AND field_id = ?").get(application.id, row.field_id);
            const mappingStructure = structuralMappingInput(req.body, row, applicationQuestion);
            const context = evidenceContext(req, req.body.pageUrl || "");
            const descriptor = buildFieldSemanticDescriptor({
                id: row.field_id,
                label: mappingStructure.fieldLabel,
                type: req.body.fieldType || "text",
                name: req.body.name,
                portalFieldKey: req.body.portalFieldKey,
                attributes: req.body.attributes,
                semanticContext: req.body.semanticContext,
                options: req.body.options,
                required: req.body.required,
                legal: req.body.legal,
                sensitive: req.body.sensitive
            }, {
                ats: context.adapterKind || context.portalKind || "generic",
                host: mappingStructure.siteHost,
                adapterVersion: context.adapterVersion
            });
            const previousSemanticMapping = findSemanticMapping(descriptor);
            if (req.body.saveMapping !== false) saveLocalDraftMapping({
                ...mappingStructure,
                semanticKey
            });
            const attemptId = ensureApplicationAttempt(application.id, req.body.pageUrl || "").id;
            if (!confirmed && previousSemanticMapping) recordExplicitSemanticDecision({
                applicationId: application.id,
                attemptId,
                mappingId: previousSemanticMapping.id,
                canonicalKey: previousSemanticMapping.canonicalFieldKey,
                fieldId: row.field_id,
                fieldSignature: mappingStructure.fieldSignature,
                decision: "CORRECTED",
                correctedTo: semanticKey,
                legal: Boolean(req.body.legal),
                sensitive: Boolean(req.body.sensitive),
                extensionVersion: context.extensionVersion,
                adapterVersion: context.adapterVersion,
                formFingerprint: context.pageFingerprint
            });
            semanticMapping = saveSemanticMapping({
                descriptor,
                canonicalFieldKey: semanticKey,
                source: "USER_CONFIRMED",
                confidence: 1,
                status: "CANDIDATE"
            });
            if (semanticMapping) {
                const semanticEvidence = recordExplicitSemanticDecision({
                    applicationId: application.id,
                    attemptId,
                    mappingId: semanticMapping.id,
                    canonicalKey: semanticKey,
                    fieldId: row.field_id,
                    fieldSignature: mappingStructure.fieldSignature,
                    decision: "CONFIRMED",
                    alternative: semanticMapping.conflict === true,
                    legal: Boolean(req.body.legal),
                    sensitive: Boolean(req.body.sensitive),
                    extensionVersion: context.extensionVersion,
                    adapterVersion: context.adapterVersion,
                    formFingerprint: context.pageFingerprint
                });
                semanticMapping = semanticEvidence.mapping;
            }
            learnedSemanticKey = semanticKey;
            if (!confirmed) {
                db.prepare(`UPDATE application_questions SET question_key = ?, status = 'PENDING', answer = NULL, confidence = 0, source = 'USER_REQUIRED', updated_at = CURRENT_TIMESTAMP WHERE application_id = ? AND field_id = ?`)
                    .run(semanticKey, application.id, row.field_id);
            }
        } else {
            if (!answer) throw new Error("An answer is required.");
            const question = db.prepare("SELECT * FROM application_questions WHERE application_id = ? AND field_id = ?").get(application.id, row.field_id);
            if (!question) throw new Error("Application question not found.");
            db.prepare(`UPDATE application_questions SET answer = ?, status = 'ANSWERED', confidence = 1, source = 'USER', evidence = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                .run(answer, `Candidate answered in the extension. Scope: ${row.answer_scope || "APPLICATION_ONLY"}.`, question.id);
            // Answering the current employer field is not approval to update
            // future memory. Eligible learning is considered only after a
            // verified submission or a later explicit save checkpoint.
        }
        const result = answerAgentQuestion(req.params.questionId);
        resolveAttentionItem(application.id, row.field_id);
        recordLearningEvent({
            type: row.question_type === "CONFIRM_MAPPING"
                ? (learnedSemanticKey === row.suggested_semantic_key ? "FIELD_MAPPING_CONFIRMED" : "FIELD_MAPPING_CORRECTED")
                : "FACT_CONFIRMED",
            applicationId: application.id, fieldId: row.field_id,
            memoryKey: learnedSemanticKey, memoryScope: row.answer_scope,
            metadata: { source: "USER", candidateApproved: true, protected: row.answer_scope === "NEVER_PERSIST" }
        });
        res.json({ answered: true, nextQuestion: result.nextQuestion, session: getOrCreateAgentSession(application.id),
            semanticLearning: semanticMapping ? { mappingId: semanticMapping.id, status: semanticMapping.status } : null });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/manual-input", async (req, res) => {
    try {
        const { fieldId, fieldLabel, value, pageUrl, fieldType, fieldSignature: suppliedSignature,
            options, required, legal, sensitive, name, portalFieldKey, attributes, semanticContext } = req.body;
        if (!fieldLabel) return res.json({ saved: false, promoted: false });
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        
        const host = siteHost(pageUrl);
        const signature = suppliedSignature || fieldSignature({ id: fieldId, label: fieldLabel, type: fieldType, name, portalFieldKey });
        const learned = findFieldMapping(host, signature);
        const applicationQuestion = getDb().prepare("SELECT question_key FROM application_questions WHERE application_id = ? AND field_id = ?")
            .get(application.id, fieldId);
        const capturedKey = applicationQuestion?.question_key && applicationQuestion.question_key !== "CUSTOM_FIELD"
            ? applicationQuestion.question_key : null;
        const field = { id: fieldId, label: fieldLabel, type: fieldType, options, required, legal, sensitive,
            name, portalFieldKey, attributes, semanticContext };
        const context = evidenceContext(req, pageUrl);
        const canonicalization = await canonicalizeField(field, {
            ats: context.adapterKind || context.portalKind || "generic",
            portalKind: context.portalKind,
            host,
            adapterVersion: context.adapterVersion,
            knownSemanticKey: learned?.semanticKey || null
        });
        // A raw normalized employer label is never promoted into the canonical
        // namespace. If resolution is still uncertain, retain only the
        // canonical captured for this application, otherwise use CUSTOM_FIELD.
        const semanticKey = canonicalization.canonicalKey
            || (capturedKey && questionForCanonical(capturedKey) ? capturedKey : null)
            || "CUSTOM_FIELD";
        const classification = classifyAgentField(field, semanticKey);
        const protectedValue = ["legal", "sensitive"].includes(classification.kind) || legal || sensitive;
        const valid = req.body.valid !== false;
        const evidenceResult = recordFieldEvidence(application.id, pageUrl, [{
            ...field,
            fieldSignature: signature,
            semanticKey,
            finalState: valid ? "USER_EDITED" : "INVALID",
            fillOutcome: valid ? "USER_CORRECTED" : "INVALID",
            intendedAction: "USER",
            source: "USER_MANUAL_INPUT",
            beforeValueHash: req.body.beforeValueHash,
            intendedValueHash: req.body.intendedValueHash,
            finalValueHash: req.body.finalValueHash,
            normalizedEquivalent: typeof req.body.normalizedEquivalent === "boolean" ? req.body.normalizedEquivalent : null,
            value: protectedValue ? null : value,
            filled: Boolean(value),
            valid,
            visible: req.body.visible !== false
        }], context);
        const neutralObservation = buildFieldInteractionObservation({
            ...field,
            logicalFieldId: req.body.logicalFieldFingerprint || fieldId,
            operationId: req.body.operationId,
            semanticKey,
            finalState: valid ? "USER_EDITED" : "INVALID",
            fillOutcome: valid ? "USER_CORRECTED" : "INVALID",
            intendedAction: "USER",
            source: "USER_MANUAL_INPUT",
            beforeValueHash: req.body.beforeValueHash,
            intendedValueHash: req.body.intendedValueHash,
            finalValueHash: req.body.finalValueHash,
            normalizedEquivalent: typeof req.body.normalizedEquivalent === "boolean" ? req.body.normalizedEquivalent : null,
            value: protectedValue ? null : value,
            filled: Boolean(value),
            valid,
            visible: req.body.visible !== false,
            completedByUser: true
        }, {
            applicationId: application.id,
            attemptId: evidenceResult.attemptId,
            checkpoint: req.body.checkpoint,
            clientTimeMs: req.body.clientTimeMs
        });
        const classifierFlag = getFeatureFlag("learning.phase0_classifier", false);
        const adaptiveEvidenceFlag = getFeatureFlag("adaptive_evidence.shadow", false);
        recordNeutralObservation(application.id, neutralObservation,
            classifierFlag.enabled ? classifyFieldInteraction(neutralObservation) : null,
            { adaptiveEvidenceShadow: classifierFlag.enabled && adaptiveEvidenceFlag.enabled,
                evidenceContext: { extensionVersion: context.extensionVersion, adapterVersion: context.adapterVersion,
                    formFingerprint: /^[a-f0-9]{64}$/.test(String(context.pageFingerprint || "")) ? context.pageFingerprint : null } });
        if (!valid) {
            upsertAttentionItem(application.id, {
                type: "VALIDATION_FAILED", fieldId, title: fieldLabel,
                semanticKey, answerScope: "APPLICATION_ONLY", pageUrl,
                reason: "Employer validation rejected the current value."
            });
            recordLearningEvent({
                type: "VALIDATION_FAILED", applicationId: application.id, fieldId,
                memoryKey: semanticKey, memoryScope: "APPLICATION_ONLY",
                metadata: { source: "USER_MANUAL_INPUT", candidateApproved: false, protected: protectedValue }
            });
            return res.json({ saved: false, promoted: false, invalid: true });
        }
        // Manual input is candidate-answer/interaction evidence, never direct
        // evidence that the semantic mapping was right or wrong. The Phase 0
        // classifier attributes it after a reliable application checkpoint.
        if (semanticKey !== "CUSTOM_FIELD" && !genericFieldLabel(fieldLabel)) {
            saveLocalDraftMapping({
                siteHost: host,
                fieldSignature: signature,
                fieldLabel,
                semanticKey,
                status: "LOCAL_DRAFT"
            });
        }
        resolveAttentionItem(application.id, fieldId);
        recordLearningEvent({
            type: capturedKey ? "FACT_CORRECTED" : "FACT_CONFIRMED",
            applicationId: application.id, fieldId, memoryKey: semanticKey,
            memoryScope: classification.scope,
            metadata: { source: "USER_MANUAL_INPUT", changed: Boolean(capturedKey), candidateApproved: false, protected: protectedValue }
        });
        if (!protectedValue && value != null && String(value).trim()) {
            saveResolvedQuestion(application.id, { id: fieldId || signature, label: fieldLabel }, {
                normalizedKey: semanticKey,
                answer: value,
                confidence: 1,
                source: "USER_MANUAL_INPUT",
                evidence: "Candidate entered this value for this application."
            });
        }
        const consent = reusableAnswerConsent(application.id);
        const runtimeProposal = consent.allowed ? stageManualCandidateAnswerProposal({
            userId: application.user_id,
            applicationId: application.id,
            runId: evidenceResult.attemptId,
            observation: neutralObservation,
            canonicalKey: semanticKey,
            rawValue: value,
            field: { label: fieldLabel, type: fieldType, options },
            protectedValue
        }) : { staged: false, reasonCodes: ["REUSABLE_LEARNING_DISABLED"] };
        // Current-field use is immediate; future-memory promotion waits for a
        // verified submission/explicit-save checkpoint in the durable learning
        // phase. This prevents a half-finished application from mutating the
        // candidate profile.
        const promoted = false;
        const correctionApprovalRequired = false;
        res.json({ saved: true, promoted, correctionApprovalRequired, reuseConsent: consent,
            pendingLearning: runtimeProposal.staged,
            runtimeProposal: { staged: runtimeProposal.staged, proposalId: runtimeProposal.proposalId || null,
                reasonCodes: runtimeProposal.reasonCodes || [] },
            semanticLearning: {
                canonicalKey: semanticKey,
                decision: canonicalization.decision,
                mappingId: canonicalization.mapping?.id || null,
                contract: toSharedFieldSemanticResult(canonicalization)
            } });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/reuse-consent", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        const consent = setReusableAnswerConsent(application.id, req.body.approved === true);
        transitionAgent(application.id, AGENT_STATES.ASKING_CANDIDATE_QUESTION,
            req.body.approved === true ? "Candidate enabled reusable answer learning." : "Candidate declined reusable learning for this application.",
            { reusableAnswerConsent: req.body.approved === true });
        res.json({ consent });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/learning-preference", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        const consent = setApplicationLearningDisabled(application.id, req.body.disabled === true);
        recordLearningEvent({
            type: req.body.disabled === true ? "APPLICATION_LEARNING_DISABLED" : "APPLICATION_LEARNING_ENABLED",
            applicationId: application.id,
            memoryScope: "APPLICATION_ONLY",
            metadata: { candidateApproved: true }
        });
        res.json({ consent });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/field-evidence", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        const fields = Array.isArray(req.body.fields) ? req.body.fields : [];
        const context = evidenceContext(req, req.body.pageUrl);
        const result = recordFieldEvidence(application.id, req.body.pageUrl, fields, context);
        for (const field of fields) {
            if (String(field.fieldType || field.type || "").toLowerCase() === "file"
                && ["FILLED", "USER_EDITED", "USER_CORRECTED"].includes(String(field.fillOutcome || field.finalState || "").toUpperCase())) {
                resolveAttentionItem(application.id, field.fieldId || field.id);
                dismissPendingAgentQuestion(application.id, field.fieldId || field.id);
            }
        }
        const snapshot = capturePageSnapshot(application.id, req.body.pageUrl, fields, {
            reason: "POST_FILL_VERIFY",
            adapterKind: context.adapterKind || "EXTENSION",
            adapterVersion: context.adapterVersion || "1",
            extensionVersion: context.extensionVersion,
            mappingPackVersion: context.mappingPackVersion,
            mappingStage: context.mappingStage
        });
        const host = siteHost(req.body.pageUrl);
        for (const field of fields) {
            const outcome = mappingOutcomeFromFill(field.fillOutcome || field.finalState);
            if (!field.portalFieldKey || !outcome) continue;
            recordPortalFieldPatternOutcome(host, field.portalFieldKey, outcome === "success", { portalKind: context.portalKind });
            if (outcome === "failure") {
                recordAdapterIncident({
                    portalKind: context.portalKind,
                    siteHost: host,
                    failureClass: String(field.fillOutcome || field.finalState || "FILL_FAILED").toUpperCase(),
                    controlKind: field.controlKind || field.type,
                    fingerprint: field.fieldSignature || field.id,
                    sample: { label: field.label, fillOutcome: field.fillOutcome || field.finalState }
                });
            }
        }
        const filledCount = fields.filter((field) => ["FILLED", "USER_CORRECTED"].includes(String(field.fillOutcome || field.finalState || "").toUpperCase())).length;
        const reviewCount = fields.filter((field) => ["BLOCKED", "INVALID", "FILL_FAILED", "SNAPSHOT_LIE"].includes(String(field.fillOutcome || field.finalState || "").toUpperCase())).length;
        const classifierFlag = getFeatureFlag("learning.phase0_classifier", false);
        const adaptiveEvidenceFlag = getFeatureFlag("adaptive_evidence.shadow", false);
        const phase0Classifications = fields.map((field) => {
            const observation = buildFieldInteractionObservation(field, {
                applicationId: application.id,
                attemptId: result.attemptId,
                checkpoint: field.checkpoint || req.body.checkpoint,
                clientTimeMs: field.clientTimeMs || req.body.clientTimeMs
            });
            const classification = classifierFlag.enabled ? classifyFieldInteraction(observation) : null;
            recordNeutralObservation(application.id, observation, classification,
                { adaptiveEvidenceShadow: Boolean(classification) && adaptiveEvidenceFlag.enabled,
                    evidenceContext: { extensionVersion: context.extensionVersion, adapterVersion: context.adapterVersion,
                        formFingerprint: snapshot.pageFingerprint } });
            if (field.candidateAnswerVersionId && reusableAnswerConsent(application.id).allowed) {
                stageVersionedCandidateAnswerProposal({
                    userId: application.user_id,
                    applicationId: application.id,
                    runId: result.attemptId,
                    observation,
                    canonicalKey: field.semanticKey,
                    rawValue: field.value,
                    usedAnswerVersionId: field.candidateAnswerVersionId,
                    field: { label: field.label, type: field.type, options: field.options },
                    protectedValue: observation.protected
                });
            }
            if (!classification) return null;
            return {
                fieldId: String(field.id || field.fieldId || observation.logicalFieldId).slice(0, 240),
                observationId: observation.observationId,
                semantic: classification.semantic,
                answer: classification.answer,
                representation: classification.representation,
                strategy: classification.strategy,
                acceptance: classification.acceptance,
                learningEligibility: classification.learningEligibility
            };
        }).filter(Boolean);
        completeAdapterRun(snapshot.runId, { status: reviewCount ? "NEEDS_REVIEW" : "VERIFIED", filledCount, reviewCount });
        recordUsageEvent({ meterKey: "ADAPTER_FILL", quantity: 1, metadata: { portalKind: context.portalKind } });
        proposeMappingPatches();
        res.json({ ...result, snapshotId: snapshot.snapshotId, pageFingerprint: snapshot.pageFingerprint,
            phase0Classifier: { enabled: classifierFlag.enabled, mode: "SHADOW", classifications: phase0Classifications },
            adaptiveEvidence: { enabled: classifierFlag.enabled && adaptiveEvidenceFlag.enabled, mode: "SHADOW" } });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/field-revision", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        res.status(201).json(idempotentRouteResult(req, {
            runId: req.body?.identity?.runId || null,
            eventType: "FIELD_REVISION_RECORDED"
        }, () => recordFieldRevision(application.id, req.body)));
    } catch (error) { res.status(400).json({ error: error.message, reasonCode: error.code || "INVALID_FIELD_REVISION" }); }
});

router.post("/api/extension/jobs/:id/edit-session", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        res.status(201).json(idempotentRouteResult(req, {
            runId: req.body?.identity?.runId || null,
            eventType: "EDIT_SESSION_RECORDED"
        }, () => recordEditSessionSnapshot(application.id, req.body)));
    } catch (error) { res.status(400).json({ error: error.message, reasonCode: error.code || "INVALID_EDIT_SESSION" }); }
});

router.post("/api/extension/jobs/:id/checkpoint-receipt", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        res.status(201).json(idempotentRouteResult(req, {
            runId: req.body?.runId || null,
            eventType: "CHECKPOINT_RECEIPT_RECORDED"
        }, () => {
            const checkpointInput = req.body || {};
            const receipt = recordCheckpointReceipt(application.id, checkpointInput);
            const classifierFlag = getFeatureFlag("learning.phase0_classifier", false);
            const adaptiveEvidenceFlag = getFeatureFlag("adaptive_evidence.shadow", false);
            const changeSetFlag = getFeatureFlag("candidate-answer-intelligence.change-sets", false);
            const shouldClassify = classifierFlag.enabled || changeSetFlag.enabled;
            const replay = shouldClassify ? classifyAttemptAtCheckpoint(application.id, checkpointInput,
                { adaptiveEvidenceShadow: adaptiveEvidenceFlag.enabled }) : null;
            let learningChangeSet = {
                enabled: changeSetFlag.enabled,
                status: changeSetFlag.enabled ? "NO_PROPOSALS" : "SHADOW_DISABLED",
                reasonCode: changeSetFlag.enabled ? "NO_SERVER_STAGED_PROPOSALS" : "AUTOMATIC_CHECKPOINT_COMMIT_DISABLED"
            };
            if (changeSetFlag.enabled && checkpointInput.status === "VERIFIED"
                && ["SUBMISSION", "EXPLICIT_SAVE"].includes(checkpointInput.type)) {
                learningChangeSet = finalizeRuntimeCandidateAnswerProposals({
                    userId: application.user_id,
                    applicationId: application.id,
                    runId: checkpointInput.runId,
                    checkpointId: checkpointInput.checkpointId
                });
            }
            return { ...receipt, phase0Classifier: { enabled: shouldClassify, mode: "SHADOW", replay },
                learningChangeSet,
                adaptiveEvidence: { enabled: shouldClassify && adaptiveEvidenceFlag.enabled, mode: "SHADOW" } };
        }));
    } catch (error) { res.status(400).json({ error: error.message, reasonCode: error.code || "INVALID_CHECKPOINT_RECEIPT" }); }
});

router.get("/api/extension/jobs/:id/field-revision-diagnostics", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        res.json(fieldRevisionDiagnostics(application.id, req.query.attemptId ? String(req.query.attemptId) : null));
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get("/api/extension/jobs/:id/attempts", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        res.json({ attempts: listAttemptTimeline(application.id) });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/extension/jobs/:id/validate", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        recordFieldEvidence(application.id, req.body.pageUrl || "", Array.isArray(req.body.fields) ? req.body.fields : [], evidenceContext(req, req.body.pageUrl || ""));
        transitionAgent(application.id, AGENT_STATES.VALIDATING_FORM, "Checking visible required fields.");
        const result = readinessStatus(req.body);
        const messages = {
            READY_TO_SUBMIT: "Everything required is complete. I am ready for your review.",
            USER_ACTION_REQUIRED: "A required legal or consent field needs your direct confirmation.",
            CAPTCHA_REQUIRED: "Complete the employer CAPTCHA directly before review.",
            UNKNOWN_FIELD: "A required field still needs to be taught.",
            WAITING_FOR_USER: "One required answer still needs you."
        };
        updateApplicationStatus(application.id, result.status, messages[result.status] || result.status, { metadata: result });
        transitionAgent(application.id, result.state, messages[result.status] || result.status, result);
        res.json({ ...result, application: publicApplication(getApplicationByJobId(req.params.id)), session: getOrCreateAgentSession(application.id) });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get("/api/extension/jobs/:id/resume", (req, res) => {
    const job = getJobForApplication(req.params.id);
    if (!job?.generated_resume_path || !fs.existsSync(job.generated_resume_path)) {
        return res.status(404).json({ error: "Build or choose a resume for this job first." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(job.generated_resume_path);
});

router.post("/api/extension/jobs/:id/resume-selection", async (req, res) => {
    try {
        if (req.body?.fresh === true) {
            const selected = await createFreshDashboardResumeVariant(req.params.id);
            return res.json({ selected: true, fresh: true, variantId: selected.variant.id, templateId: selected.templateId });
        }
        if (req.body?.variantId) {
            const selected = await selectDashboardResumeVariant(req.params.id, req.body.variantId);
            return res.json({ selected: true, variantId: selected.variant.id, templateId: selected.templateId });
        }
        const selected = await selectDashboardApplicationResume(req.params.id, req.body?.templateId);
        res.json({ selected: true, templateId: selected.templateId });
    } catch (error) {
        res.status(400).json({ error: error.message || "Resume selection failed." });
    }
});

router.get("/api/extension/jobs/:id/cover-letter", async (req, res) => {
    try {
        const job = getJobForApplication(req.params.id);
        if (!job?.cover_letter?.trim()) return res.status(404).json({ error: "No tailored cover letter is available for this job." });
        const result = await generateCoverLetterPdf({ job, coverLetter: job.cover_letter, companyName: job.company_name });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(result.path);
    } catch (error) {
        res.status(500).json({ error: error.message || "Cover letter generation failed." });
    }
});

router.post("/api/extension/jobs/:id/learning-change-sets/:changeSetId/undo", (req, res) => {
    try {
        const application = getApplicationByJobId(req.params.id);
        if (!application) throw new Error("Application not found.");
        const target = getDb().prepare(`SELECT id FROM candidate_answer_change_sets
            WHERE id = ? AND user_id = ? AND application_id = ?`)
            .get(req.params.changeSetId, application.user_id, application.id);
        if (!target) {
            const error = new Error("Learning change set was not found for this application.");
            error.status = 404;
            throw error;
        }
        const reversal = undoCandidateAnswerChangeSet({
            userId: application.user_id,
            changeSetId: req.params.changeSetId,
            idempotencyKey: String(req.get("Idempotency-Key") || "").trim()
        });
        res.status(reversal.idempotentReplay || reversal.alreadyReversed ? 200 : 201).json({ reversal });
    } catch (error) {
        res.status(error.status || 400).json({ error: error.message, reasonCode: error.code || "LEARNING_UNDO_FAILED" });
    }
});

router.post("/api/extension/jobs/:id/submitted", (req, res) => {
    try {
        const db = getDb();
        const job = getJobForApplication(req.params.id);
        if (!job) throw new Error("Job not found.");
        const confirmationSource = req.body.employerConfirmation === true
            ? "EMPLOYER_CONFIRMATION_PAGE"
            : req.body.candidateVerified === true ? "CANDIDATE_VERIFIED" : null;
        if (!confirmationSource) throw new Error("Submission requires an employer confirmation page or explicit candidate verification.");
        const activeAttempt = db.prepare("SELECT id FROM application_attempts WHERE application_id = ? AND status = 'ACTIVE' ORDER BY started_at DESC LIMIT 1")
            .get(getApplicationByJobId(req.params.id)?.id);
        const id = crypto.randomUUID();
        db.prepare(`
            INSERT INTO applications (id, user_id, job_id, adapter, mode, status, match_score, started_at, submitted_at)
            VALUES (?, ?, ?, 'EXTENSION', 'ASSISTED', 'SUCCESS', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, job_id) DO UPDATE SET
                adapter = 'EXTENSION', status = 'SUCCESS', submitted_at = CURRENT_TIMESTAMP,
                failure_reason = NULL, updated_at = CURRENT_TIMESTAMP
        `).run(id, LOCAL_USER_ID, job.id, job.match_score);
        const application = db.prepare("SELECT id FROM applications WHERE user_id = ? AND job_id = ?").get(LOCAL_USER_ID, job.id);
        addApplicationEvent(application.id, "SUCCESS",
            confirmationSource === "EMPLOYER_CONFIRMATION_PAGE" ? "Employer confirmation detected by the browser extension." : "Candidate explicitly verified employer submission.",
            { pageUrl: req.body.pageUrl || "", confirmationSource });
        transitionAgent(application.id, AGENT_STATES.SUBMISSION_DETECTED,
            confirmationSource === "EMPLOYER_CONFIRMATION_PAGE" ? "Employer submission confirmation detected." : "Candidate verified employer submission.",
            { pageUrl: req.body.pageUrl || "", confirmationSource });
        const changeSetFlag = getFeatureFlag("candidate-answer-intelligence.change-sets", false);
        let learningChangeSet = { enabled: changeSetFlag.enabled, status: "NO_ACTIVE_ATTEMPT" };
        if (changeSetFlag.enabled && activeAttempt?.id) {
            let checkpoint = db.prepare(`SELECT checkpoint_id AS checkpointId FROM application_checkpoint_receipts
                WHERE application_id = ? AND attempt_id = ? AND checkpoint_type = 'SUBMISSION' AND status = 'VERIFIED'
                ORDER BY observed_at_ms DESC, created_at DESC LIMIT 1`).get(application.id, activeAttempt.id);
            if (!checkpoint) {
                const checkpointInput = {
                    schemaVersion: 1,
                    checkpointId: `checkpoint:submission:${crypto.randomUUID()}`,
                    runId: activeAttempt.id,
                    applicationId: application.id,
                    applicationContentRevisionId: null,
                    type: "SUBMISSION",
                    status: "VERIFIED",
                    source: confirmationSource === "EMPLOYER_CONFIRMATION_PAGE" ? "EMPLOYER_RECEIPT" : "CANDIDATE_GESTURE",
                    observedAtMs: Date.now(),
                    evidenceHash: crypto.createHash("sha256").update(
                        `submission|${application.id}|${activeAttempt.id}|${confirmationSource}`).digest("hex"),
                    valueFree: true
                };
                recordCheckpointReceipt(application.id, checkpointInput);
                classifyAttemptAtCheckpoint(application.id, checkpointInput, {
                    adaptiveEvidenceShadow: getFeatureFlag("adaptive_evidence.shadow", false).enabled
                });
                checkpoint = { checkpointId: checkpointInput.checkpointId };
            }
            learningChangeSet = finalizeRuntimeCandidateAnswerProposals({
                userId: application.user_id,
                applicationId: application.id,
                runId: activeAttempt.id,
                checkpointId: checkpoint.checkpointId
            });
        } else if (!changeSetFlag.enabled) {
            promoteVerifiedApplicationAnswers(application.id, job.id, activeAttempt?.id || null);
        }
        completeApplicationAttempt(application.id, { status: "SUCCESS", confirmationSource, pageUrl: req.body.pageUrl || "" });
        recordApplicationOutcome({
            applicationId: application.id,
            eventType: "SUBMITTED",
            evidenceSource: confirmationSource === "EMPLOYER_CONFIRMATION_PAGE" ? "BROWSER" : "CANDIDATE",
            confirmationStatus: "CONFIRMED",
            sourceReference: req.body.pageUrl || null
        });
        db.prepare("UPDATE attention_items SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE application_id = ? AND status = 'OPEN'").run(application.id);
        db.prepare("UPDATE jobs SET status = 'APPLIED', applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP) WHERE id = ?").run(job.id);
        const schema = registerCurrentApplicationSchema(application.id);
        res.json({ recorded: true, applicationId: application.id, learningChangeSet,
            schema: schema ? { id: schema.id, status: schema.status, expiresAt: schema.expires_at } : null });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/session/unlink", (req, res) => {
    try {
        const jobId = req.body?.jobId;
        if (jobId) {
            const application = getApplicationByJobId(jobId);
            if (application) {
                updateApplicationStatus(application.id, "WAITING_FOR_USER", "Candidate unlinked COPILOT session.");
                completeApplicationAttempt(application.id, { status: "ABANDONED", confirmationSource: "CANDIDATE_UNLINKED" });
            }
        }
        res.json({ unlinked: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/session/pending-review", (req, res) => {
    try {
        const application = getApplicationByJobId(req.body?.jobId);
        if (!application) throw new Error("Application not found.");
        if (application.status === "SUCCESS") return res.json({ pending: false, alreadySubmitted: true });
        const pageUrl = String(req.body?.pageUrl || "");
        const reason = String(req.body?.reason || "APPLICATION_TAB_CLOSED").slice(0, 100);
        updateApplicationStatus(application.id, "WAITING_FOR_USER",
            "Application paused before submission could be verified.", { metadata: { pageUrl, reason } });
        completeApplicationAttempt(application.id, { status: "PENDING_REVIEW", confirmationSource: reason, pageUrl });
        upsertAttentionItem(application.id, {
            fieldId: "__submission_review__",
            type: "SUBMISSION_REVIEW",
            title: "Was this application submitted?",
            reason: "COPILOT could not verify submission before the application tab closed or another application started.",
            semanticKey: "APPLICATION_SUBMISSION_STATUS",
            answerScope: "APPLICATION_ONLY",
            priority: 95,
            blocking: true,
            pageUrl
        });
        res.json({ pending: true, applicationId: application.id });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/api/extension/session/recovered", (req, res) => {
    try {
        res.json(recoverExtensionSession({
            jobId: req.body?.jobId,
            pageUrl: req.body?.pageUrl,
            rebound: req.body?.rebound === true
        }));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

export default router;
