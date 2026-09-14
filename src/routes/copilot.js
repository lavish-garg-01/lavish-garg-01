import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { generateApplicationAssets, inspectPdfBuffer } from "../services/pdfGenerator.js";
import { processPendingJobs } from "../services/openai.js";
import { evaluateAutoApply } from "../services/autoApplyRules.js";
import { loadResume } from "../services/resumeStore.js";
import { evaluateCurrentCandidateMatch, matchBlockingReason } from "../services/currentCandidateMatching.js";
import { buildCandidateResumeProfile, PARSER_VERSION } from "../services/candidateProfileBuilder.js";
import { normalizeCompanyScore, parsePostedAt } from "../services/ingestion.js";
import { archiveStaleJobs } from "../services/pipelineRunner.js";
import { jobPlatform, platformBadgeClass } from "../services/jobPlatform.js";
import { applySupportForJob, applySupportBadgeClass } from "../services/applySupport.js";
import { RESUME_TEMPLATES, resolveTemplateId } from "../services/resumeRenderer.js";
import {
    answerApplicationQuestion,
    applicationMetrics,
    createOrResetApplication,
    enqueueTask,
    getApplication,
    getJobForApplication,
    listApplicationQuestions,
    listApplicationEvents,
    listApplications,
    listPendingQuestions,
    updateApplicationStatus
} from "../repositories/applicationRepository.js";
import {
    deleteCandidateAnswer,
    findCandidateAnswer,
    getAutoApplySettings,
    getCandidateProfile,
    jsonList,
    listCandidateAnswers,
    saveAutoApplySettings,
    saveCandidateAnswer,
    saveCandidateProfile,
    LOCAL_USER_ID
} from "../repositories/copilotRepository.js";
import {
    listAttentionSessions,
    recordLearningEvent,
    resolveAttentionBatch,
    resolveAttentionItemsByType
} from "../repositories/attentionRepository.js";
import {
    applicationOutcomeReport,
    confirmApplicationOutcome,
    recordApplicationOutcome
} from "../repositories/applicationIntelligenceRepository.js";
import { completeApplicationAttempt } from "../repositories/learningRepository.js";

const router = Router();
const resumeDirectory = path.join(env.paths.storage, "resumes");
fs.mkdirSync(resumeDirectory, { recursive: true });

router.get("/outcomes", (req, res) => {
    res.render("outcomes", { report: applicationOutcomeReport(), notice: String(req.query.notice || ""), error: String(req.query.error || "") });
});

router.post("/applications/:id/outcomes", (req, res) => {
    try {
        recordApplicationOutcome({
            applicationId: req.params.id,
            eventType: req.body.eventType,
            occurredAt: req.body.occurredAt || new Date().toISOString(),
            evidenceSource: "CANDIDATE",
            confirmationStatus: "CONFIRMED",
            note: req.body.note || null
        });
        res.redirect(`/outcomes?notice=${encodeURIComponent("Application outcome recorded.")}`);
    } catch (error) {
        res.redirect(`/outcomes?error=${encodeURIComponent(error.message)}`);
    }
});

router.post("/outcomes/:id/confirm", (req, res) => {
    try {
        confirmApplicationOutcome(req.params.id, req.body.confirmed === "true");
        res.redirect(`/outcomes?notice=${encodeURIComponent("Outcome proposal reviewed.")}`);
    } catch (error) {
        res.redirect(`/outcomes?error=${encodeURIComponent(error.message)}`);
    }
});

router.get("/attention", (req, res) => {
    const sessions = listAttentionSessions({ sinceDays: 3 });
    res.render("attention", {
        sessions,
        blockingCount: sessions.reduce((count, session) => count + session.blockingCount, 0),
        notice: String(req.query.notice || ""),
        applySupportOf: applySupportForJob,
        applySupportBadgeClass
    });
});

router.post("/attention/batch-resolve", (req, res) => {
    try {
        const result = resolveAttentionBatch({
            ids: Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean),
            decision: req.body.decision,
            candidateApproved: req.body.candidateApproved === "true"
        });
        for (const item of result.items) recordLearningEvent({
            type: "PREFERENCE_CHANGED", applicationId: item.application_id, fieldId: item.field_id,
            metadata: { source: "BATCH_CONFLICT_RESOLUTION", candidateApproved: true, reason: result.decision }
        });
        res.redirect(`/attention?notice=${encodeURIComponent(`${result.resolved} conflicts kept unchanged.`)}`);
    } catch (error) {
        res.status(400).send(error.message);
    }
});

router.post("/attention/applications/:id/mark-submitted", (req, res) => {
    try {
        const application = getApplication(req.params.id);
        if (!application) throw new Error("Application not found.");
        if (application.status !== "SUCCESS") {
            updateApplicationStatus(application.id, "SUCCESS", "Candidate confirmed the employer application was submitted.", {
                metadata: { confirmationSource: "CANDIDATE_VERIFIED" }
            });
            getDb().prepare("UPDATE jobs SET status = 'APPLIED', applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP) WHERE id = ?").run(application.job_id);
            completeApplicationAttempt(application.id, { status: "SUCCESS", confirmationSource: "CANDIDATE_VERIFIED" });
            recordApplicationOutcome({ applicationId: application.id, eventType: "SUBMITTED", evidenceSource: "CANDIDATE", confirmationStatus: "CONFIRMED" });
        }
        resolveAttentionItemsByType(application.id, "SUBMISSION_REVIEW");
        res.redirect(`/attention?notice=${encodeURIComponent("Application marked submitted.")}`);
    } catch (error) {
        res.status(400).send(error.message);
    }
});

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, resumeDirectory),
        filename: (_req, _file, callback) => callback(null, `master_${Date.now()}_${crypto.randomUUID()}.pdf`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, file.mimetype === "application/pdf")
});

function counts() {
    const db = getDb();
    const row = (sql) => db.prepare(sql).get().n;
    return {
        matches: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('MATCHED','APPROVED')"),
        close: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'CLOSE'"),
        discarded: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('PREFILTERED','REJECTED')"),
        pending: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'PENDING'"),
        tracker: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('APPROVED','APPLIED')"),
        archived: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'ARCHIVED'"),
        applications: row("SELECT COUNT(*) AS n FROM applications")
    };
}

function availableJobs() {
    const profile = currentCandidateMatchingProfile();
    const resume = loadResume();
    return getDb().prepare(`
        SELECT j.*,
               c.name AS company_name, c.overall_score AS company_score,
               c.score_source AS company_score_source
        FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.status != 'ARCHIVED' AND j.lifecycle_status != 'CLOSED'
          AND COALESCE(NULLIF(j.posted_at, ''), j.created_at) >= datetime('now', '-14 days')
        ORDER BY COALESCE(j.posted_at, j.created_at) DESC LIMIT 500
    `).all().map((job) => ({
        job,
        decision: evaluateCurrentCandidateMatch(job, { context: "DISCOVERY", saved: false, profile, resume })
    }))
        .filter(({ decision }) => decision.eligibility.status === "ELIGIBLE")
        .sort((left, right) => right.decision.matchScore - left.decision.matchScore)
        .slice(0, 100)
        .map(({ job, decision }) => ({
            ...job,
            match_score: decision.matchScore,
            analysis: parseJsonObject(job.ai_analysis),
            tailored: parseJsonObject(job.resume_modifications)
        }));
}

function parseJsonObject(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function createManualJob(input = {}) {
    const title = String(input.title || "").trim();
    const company = String(input.company || "").trim();
    const description = String(input.description || "").trim();
    const url = String(input.url || "").trim();
    if (!title || !company || !description || !/^https?:\/\//.test(url)) {
        throw new Error("Company, title, description, and a valid URL are required.");
    }
    const companyId = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || crypto.randomUUID();
    const id = crypto.createHash("sha256").update(`manual|${company}|${title}|${url}`.toLowerCase()).digest("hex").slice(0, 32);
    const db = getDb();
    const companyScore = normalizeCompanyScore(input.companyScore);
    db.prepare(`
        INSERT INTO companies (id, name, ats_type, overall_score, score_source, score_updated_at)
        VALUES (?, ?, 'manual', ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            overall_score = COALESCE(excluded.overall_score, companies.overall_score),
            score_source = COALESCE(excluded.score_source, companies.score_source),
            score_updated_at = CASE WHEN excluded.overall_score IS NOT NULL THEN CURRENT_TIMESTAMP ELSE companies.score_updated_at END
    `).run(companyId, company, companyScore, companyScore === null ? null : "manual entry", companyScore);
    const result = db.prepare(`
        INSERT INTO jobs (id, company_id, title, location, description, url, source, status, posted_at, ctc_min_lpa, ctc_max_lpa)
        VALUES (?, ?, ?, ?, ?, ?, 'manual', 'PENDING', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
    `).run(id, companyId, title, String(input.location || "Not specified"), description, url,
        parsePostedAt({ postedAt: input.postedAt }), input.salaryMin || null, input.salaryMax || null);
    return { id, inserted: result.changes > 0, job: getJobForApplication(id) };
}

function parseResumeModifications(raw) {
    return parseJsonObject(raw);
}

async function prepareApplication(jobId, requestedTemplate, { queueBrowser = true } = {}) {
    let job = getJobForApplication(jobId);
    if (!job) throw new Error("Job not found.");
    if (job.status === "ARCHIVED") throw new Error("An archived job cannot be prepared.");

    const settings = getAutoApplySettings();
    const candidate = getCandidateProfile();
    const preflight = evaluateAutoApply(job, candidate, settings, { requireResume: false });
    if (!preflight.allowed) throw new Error(preflight.reason);

    const templateId = resolveTemplateId(requestedTemplate || job.resume_template || "classic");
    const needsResume = !job.generated_resume_path || !fs.existsSync(job.generated_resume_path) || job.resume_template !== templateId;
    if (needsResume) {
        const assets = await generateApplicationAssets({
            job,
            coverLetter: job.cover_letter || "",
            resumeModifications: parseResumeModifications(job.resume_modifications),
            companyName: job.company_name,
            templateId
        });
        if (!assets.resumePdfPath) {
            throw new Error(`Could not build the ${templateId} resume: ${assets.pdfError || "PDF generation failed"}`);
        }
        getDb().prepare(`
            UPDATE jobs SET generated_resume_path = ?, resume_template = ? WHERE id = ?
        `).run(assets.resumePdfPath, templateId, job.id);
        job = getJobForApplication(job.id);
    }

    const decision = evaluateAutoApply(job, candidate, settings);
    if (!decision.allowed) throw new Error(decision.reason);
    if (!queueBrowser) return { decision, application: null, taskId: null, templateId, job };
    const application = createOrResetApplication(job, settings, { realSubmission: env.copilot.allowRealPreparation });
    const taskId = enqueueTask("PREPARE_APPLICATION", { applicationId: application.id }, { maxAttempts: 1 });
    return { decision, application, taskId, templateId, job };
}

function formatDate(value) {
    if (!value) return "—";
    const normalized = String(value).replace(" ", "T");
    const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function copilotLocals(extra = {}) {
    archiveStaleJobs();
    const applications = listApplications();
    const applicationQuestions = Object.fromEntries(
        applications.map((application) => [application.id, listApplicationQuestions(application.id)])
    );
    return {
        panel: "copilot",
        counts: counts(),
        profile: getCandidateProfile(),
        settings: getAutoApplySettings(),
        answers: listCandidateAnswers(),
        jobs: availableJobs(),
        applications,
        questionsByApplication: Object.fromEntries(
            applications.map((application) => [
                application.id,
                (applicationQuestions[application.id] || []).filter((question) => question.status === "PENDING")
            ])
        ),
        resolvedAnswersByApplication: Object.fromEntries(
            applications.map((application) => [
                application.id,
                (applicationQuestions[application.id] || []).filter((question) => question.status === "ANSWERED")
            ])
        ),
        eventsByApplication: Object.fromEntries(applications.map((application) => [application.id, listApplicationEvents(application.id).slice(-8).reverse()])),
        metrics: applicationMetrics(),
        resumeTemplates: RESUME_TEMPLATES,
        allowRealSubmission: env.copilot.allowRealPreparation,
        formatDate,
        platformOf: jobPlatform,
        platformBadgeClass,
        applySupportOf: applySupportForJob,
        applySupportBadgeClass,
        error: extra.error || null,
        success: extra.success || null
    };
}

function redirectMessage(kind, message) {
    return `/copilot?${new URLSearchParams({ [kind]: message }).toString()}`;
}

function reusableApplicationAnswer(questionKey) {
    return !["WHY_INTERESTED"].includes(String(questionKey || "").toUpperCase());
}

function legallySignificantQuestion(question = "") {
    return /consent|privacy|terms|declaration|certif|signature|authorize|agree.{0,25}(?:terms|policy)/i.test(String(question));
}

router.get("/copilot", (req, res) => {
    try {
        res.render("copilot", copilotLocals({ error: req.query.error, success: req.query.success }));
    } catch (error) {
        console.error("[copilot:get]", error);
        res.status(500).send(error.message);
    }
});

router.post("/copilot/profile", (req, res) => {
    try {
        saveCandidateProfile({
            ...req.body,
            preferredLocations: jsonList(req.body.preferredLocations),
            skills: jsonList(req.body.skills),
            targetRoles: jsonList(req.body.targetRoles),
            preferredWorkModes: jsonList(req.body.preferredWorkModes),
            willingToRelocate: req.body.willingToRelocate === "1",
            aiProcessingConsent: req.body.aiProcessingConsent === "1",
            reusableAnswerConsent: req.body.reusableAnswerConsent === "1"
        });
        res.redirect(redirectMessage("success", "Candidate profile saved."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/settings", (req, res) => {
    try {
        saveAutoApplySettings({
            ...req.body,
            enabled: req.body.enabled === "1",
            targetRoles: jsonList(req.body.targetRoles),
            preferredLocations: jsonList(req.body.preferredLocations),
            excludedCompanies: jsonList(req.body.excludedCompanies)
        });
        res.redirect(redirectMessage("success", "COPILOT safety settings saved."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/answers", (req, res) => {
    try {
        saveCandidateAnswer({
            questionKey: String(req.body.questionKey || "").trim().toUpperCase(),
            originalQuestion: String(req.body.originalQuestion || req.body.questionKey || "").trim(),
            answer: req.body.answer,
            confidence: 1,
            source: "USER"
        });
        res.redirect(redirectMessage("success", "Reusable answer saved."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/answers/:id/delete", (req, res) => {
    deleteCandidateAnswer(req.params.id);
    res.redirect(redirectMessage("success", "Reusable answer deleted."));
});

router.post("/copilot/answers/:id", (req, res) => {
    try {
        saveCandidateAnswer({
            id: req.params.id,
            questionKey: String(req.body.questionKey || "").trim().toUpperCase(),
            originalQuestion: String(req.body.originalQuestion || req.body.questionKey || "").trim(),
            answer: req.body.answer,
            confidence: 1,
            source: "USER_EDITED",
            evidence: "Candidate reviewed and edited this reusable answer in COPILOT."
        });
        res.redirect(redirectMessage("success", "Reusable answer updated for future applications."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/jobs", (req, res) => {
    try {
        createManualJob(req.body);
        res.redirect(redirectMessage("success", "Manual job added to Pending. Score it before preparing an application."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/jobs/:id/score", async (req, res) => {
    try {
        const result = await processPendingJobs({ limit: 1, jobIds: [req.params.id] });
        res.redirect(redirectMessage("success", `Scoring complete: processed ${result.scanned}, failed ${result.failed || 0}.`));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/jobs/:id/prepare", async (req, res) => {
    try {
        const prepared = await prepareApplication(req.params.id, req.body.resumeTemplate);
        const target = env.copilot.allowRealPreparation ? "real job site" : "local test form";
        res.redirect(redirectMessage("success", `${prepared.templateId} resume ready and ${target} preparation queued. A visible Chromium window will open; refresh this page to follow progress.`));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/jobs/:id/prepare-extension", async (req, res) => {
    try {
        const prepared = await prepareApplication(req.params.id, req.body.resumeTemplate, { queueBrowser: false });
        createOrResetApplication(prepared.job, getAutoApplySettings(), { adapter: "EXTENSION" });
        res.redirect(prepared.job.url);
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/api/extension/jobs/:id/prepare", async (req, res) => {
    try {
        const prepared = await prepareApplication(req.params.id, req.body.resumeTemplate, { queueBrowser: false });
        const application = createOrResetApplication(prepared.job, getAutoApplySettings(), { adapter: "EXTENSION" });
        updateApplicationStatus(application.id, "OPENING", "Tailored resume is ready; waiting for the browser extension to open the job.");
        res.json({
            jobUrl: prepared.job.url,
            jobId: prepared.job.id,
            applicationId: application.id,
            status: "OPENING",
            templateId: prepared.templateId
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/copilot/applications/:id/mark-filled", (req, res) => {
    try {
        const application = getApplication(req.params.id);
        if (!application) throw new Error("Application not found.");
        if (application.adapter !== "EXTENSION") throw new Error("Only extension applications can be marked filled manually.");
        const job = getJobForApplication(application.job_id);
        const decision = evaluateCurrentCandidateMatch(job);
        if (decision.eligibility.status === "INELIGIBLE") throw new Error(matchBlockingReason(decision));
        updateApplicationStatus(application.id, "READY_TO_SUBMIT", "Candidate manually marked the extension form as filled and ready for review.");
        res.redirect(redirectMessage("success", "Application marked as filled and ready for review."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/applications/:id/unlink", (req, res) => {
    try {
        const application = getApplication(req.params.id);
        if (!application) throw new Error("Application not found.");
        updateApplicationStatus(application.id, "WAITING_FOR_USER", "Candidate unlinked this application from COPILOT session.");
        res.redirect(redirectMessage("success", "COPILOT session unlinked from this job."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/applications/:id/questions/:questionId", (req, res) => {
    try {
        const answer = String(req.body.answer || "").trim();
        if (!answer) throw new Error("An answer is required.");
        const pending = getDb().prepare("SELECT * FROM application_questions WHERE id = ?").get(req.params.questionId);
        if (legallySignificantQuestion(pending?.question)) throw new Error("This requires your direct confirmation on the employer form.");
        const question = answerApplicationQuestion(req.params.questionId, answer);
        if (reusableApplicationAnswer(question.question_key)) {
            saveCandidateAnswer({
                questionKey: question.question_key,
                originalQuestion: question.question,
                answer,
                confidence: 1,
                source: "USER",
                evidence: "Candidate confirmed this stable fact while reviewing an application."
            });
        }
        const remaining = listPendingQuestions(req.params.id);
        if (!remaining.length) {
            const application = getApplication(req.params.id);
            if (application?.adapter === "EXTENSION") {
                updateApplicationStatus(req.params.id, "QUEUED", "All pending answers received; return to the extension and choose Fill this page.");
            } else {
                updateApplicationStatus(req.params.id, "QUEUED", "All pending answers received; resuming preparation.");
                enqueueTask("RESUME_APPLICATION", { applicationId: req.params.id }, { maxAttempts: 1 });
            }
        }
        res.redirect(redirectMessage("success", remaining.length ? "Answer saved. Complete the remaining questions." : "Answer saved and preparation resumed."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/applications/:id/retry", (req, res) => {
    try {
        const application = getApplication(req.params.id);
        if (!application) throw new Error("Application not found.");
        if (application.status === "SUCCESS") throw new Error("A verified successful application cannot be retried.");
        const job = getJobForApplication(application.job_id);
        if (!job || job.status === "ARCHIVED") {
            throw new Error("This job is no longer eligible for application preparation.");
        }
        const decision = evaluateAutoApply(job, getCandidateProfile(), getAutoApplySettings(), { requireResume: false });
        if (!decision.allowed) throw new Error(decision.reason);
        updateApplicationStatus(application.id, "QUEUED", "Application preparation manually retried.");
        enqueueTask("RESUME_APPLICATION", { applicationId: application.id }, { maxAttempts: 1 });
        res.redirect(redirectMessage("success", "Application preparation queued again."));
    } catch (error) {
        res.redirect(redirectMessage("error", error.message));
    }
});

router.post("/copilot/applications/:id/submit", (req, res) => {
    res.redirect(redirectMessage("error", "Review-only policy is enabled. Submit directly on the employer form when you are ready."));
});

router.get("/test-job-form", (req, res) => {
    const application = getApplication(req.query.applicationId);
    if (!application) return res.status(404).send("Application not found");
    const profile = getCandidateProfile();
    const nodeExperience = findCandidateAnswer("NODEJS_EXPERIENCE")?.answer || "";
    const draft = {
        fullName: profile.name || "",
        email: profile.email || "",
        phone: profile.phone || "",
        currentLocation: profile.currentLocation || "",
        currentCTC: profile.currentCTC ?? "",
        expectedCTC: profile.expectedCTC ?? "",
        noticePeriod: profile.noticePeriodDays ?? "",
        nodeExperience,
        ...Object.fromEntries(
        listApplicationQuestions(application.id)
            .filter((question) => question.status === "ANSWERED" && question.answer != null)
            .map((question) => [question.field_id, question.answer])
        )
    };
    const resumeAttached = Boolean(application.generated_resume_path && fs.existsSync(application.generated_resume_path));
    res.render("testJobForm", {
        application,
        submitted: false,
        draft,
        resumeAttached,
        resumeFileName: resumeAttached ? path.basename(application.generated_resume_path) : ""
    });
});

router.post("/test-job-form/submit", upload.single("resume"), (req, res) => {
    try {
        const application = getApplication(req.body.applicationId);
        if (!application) return res.status(404).send("Application not found");
        if (application.status !== "READY_TO_SUBMIT") {
            return res.status(409).send(`Application is ${application.status}; it must be READY_TO_SUBMIT before manual submission.`);
        }
        const required = ["fullName", "email", "phone", "currentLocation", "currentCTC", "expectedCTC", "noticePeriod", "nodeExperience", "whyInterested"];
        const missing = required.filter((field) => !String(req.body[field] ?? "").trim());
        const resumePath = req.file?.path || application.generated_resume_path;
        if (missing.length || !resumePath || !fs.existsSync(resumePath)) {
            return res.status(400).send(`Required test-form values are missing: ${[...missing, ...(!resumePath ? ["resume"] : [])].join(", ")}.`);
        }
        updateApplicationStatus(application.id, "SUBMITTING", "User manually submitted the local test form.");
        updateApplicationStatus(application.id, "VERIFYING", "Checking local confirmation page.");
        updateApplicationStatus(application.id, "SUCCESS", "Local test submission verified successfully.", {
            metadata: { testForm: true }
        });
        res.render("testJobForm", {
            application: getApplication(application.id),
            submitted: true,
            draft: {},
            resumeAttached: true,
            resumeFileName: path.basename(resumePath)
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

router.get("/api/profile", (_req, res) => res.json(getCandidateProfile()));
router.put("/api/profile", (req, res) => {
    try { res.json(saveCandidateProfile(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});
router.get("/api/answers", (_req, res) => res.json(listCandidateAnswers()));
router.post("/api/answers", (req, res) => {
    try { res.status(201).json(saveCandidateAnswer(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});
router.put("/api/answers/:id", (req, res) => {
    try { res.json(saveCandidateAnswer({ ...req.body, id: req.params.id })); } catch (error) { res.status(400).json({ error: error.message }); }
});
router.delete("/api/answers/:id", (req, res) => res.json({ deleted: deleteCandidateAnswer(req.params.id) }));
router.post("/api/jobs", (req, res) => {
    try {
        const result = createManualJob(req.body);
        res.status(result.inserted ? 201 : 200).json(result);
    } catch (error) { res.status(400).json({ error: error.message }); }
});
router.post("/api/jobs/:id/score", async (req, res) => {
    try {
        const result = await processPendingJobs({ limit: 1, jobIds: [req.params.id] });
        res.json({ ...result, job: getJobForApplication(req.params.id) });
    } catch (error) { res.status(400).json({ error: error.message }); }
});
router.post("/api/jobs/:id/prepare-application", async (req, res) => {
    try {
        const prepared = await prepareApplication(req.params.id, req.body.resumeTemplate);
        res.status(202).json(prepared);
    } catch (error) { res.status(400).json({ error: error.message }); }
});
router.get("/api/applications", (_req, res) => res.json(listApplications()));
router.get("/api/applications/:id", (req, res) => {
    const application = getApplication(req.params.id);
    if (!application) return res.status(404).json({ error: "Application not found" });
    res.json({ application, questions: listPendingQuestions(application.id), events: listApplicationEvents(application.id) });
});
router.get("/api/applications/:id/questions", (req, res) => res.json(listPendingQuestions(req.params.id)));
router.post("/api/applications/:id/questions/:questionId/answer", (req, res) => {
    try {
        const pending = getDb().prepare("SELECT * FROM application_questions WHERE id = ?").get(req.params.questionId);
        if (legallySignificantQuestion(pending?.question)) throw new Error("This requires your direct confirmation on the employer form.");
        const question = answerApplicationQuestion(req.params.questionId, req.body.answer);
        if (reusableApplicationAnswer(question.question_key)) {
            saveCandidateAnswer({
                questionKey: question.question_key,
                originalQuestion: question.question,
                answer: req.body.answer,
                evidence: "Candidate confirmed this stable fact through the application API."
            });
        }
        const remaining = listPendingQuestions(req.params.id);
        if (!remaining.length) {
            const application = getApplication(req.params.id);
            if (application?.adapter === "EXTENSION") {
                updateApplicationStatus(req.params.id, "QUEUED", "All pending answers received through API; return to the extension and choose Fill this page.");
            } else {
                updateApplicationStatus(req.params.id, "QUEUED", "All pending answers received through API; resuming preparation.");
                enqueueTask("RESUME_APPLICATION", { applicationId: req.params.id }, { maxAttempts: 1 });
            }
        }
        res.json({ answered: true, remaining: remaining.length, resumed: remaining.length === 0 });
    } catch (error) { res.status(400).json({ error: error.message }); }
});
router.get("/api/metrics", (_req, res) => res.json(applicationMetrics()));
router.get("/api/auto-apply-settings", (_req, res) => res.json(getAutoApplySettings()));
router.put("/api/auto-apply-settings", (req, res) => {
    try { res.json(saveAutoApplySettings(req.body)); } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post("/api/resume", upload.single("resume"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "A PDF file is required." });
    try {
        const buffer = fs.readFileSync(req.file.path);
        const diagnostics = await inspectPdfBuffer(buffer);
        const parserText = diagnostics.layoutText || diagnostics.plainText;
        const parsedProfile = buildCandidateResumeProfile({ text: parserText, existingResume: loadResume() });
        const id = crypto.randomUUID();
        getDb().prepare(`
            INSERT INTO resume_versions
                (id, user_id, type, file_path, text_content, parsed_profile_json, parser_version, parse_confidence)
            VALUES (?, ?, 'MASTER', ?, ?, ?, ?, ?)
        `).run(id, LOCAL_USER_ID, req.file.path, parserText,
            JSON.stringify(parsedProfile), PARSER_VERSION, parsedProfile.confidence);
        res.status(201).json({
            id,
            filePath: req.file.path,
            pageCount: diagnostics.pageCount,
            textLength: parserText.length,
            extractedTextPreview: parserText.slice(0, 2000),
            profilePreview: parsedProfile,
            requiresConfirmation: true,
            message: "Resume stored and text extracted. Existing candidate values were not overwritten; review and update them in COPILOT Profile."
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

export default router;
