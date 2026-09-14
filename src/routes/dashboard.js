import fs from "fs";
import { Router } from "express";
import { env } from "../config/environment.js";
import { getDb, getSetting, setSetting } from "../database/connection.js";
import { enrichJobOutreach } from "../services/enrichment.js";
import { generateApplicationAssets, generateCoverLetterPdf, inspectResumeHtml, renderCoverLetterHtml } from "../services/pdfGenerator.js";
import { loadMasterResume, scoreJob, tailorApplication } from "../services/openai.js";
import {
    archiveStaleJobs,
    getPipelineRunState,
    launchPipelineRun,
    parseProcessLimit,
    processPendingFromDashboard,
    searchAndProcessFromDashboard
} from "../services/pipelineRunner.js";
import { analyzeResumeReadiness } from "../services/resumeAnalyzer.js";
import { RESUME_TEMPLATES, renderResumeHtml, resolveTemplateId } from "../services/resumeRenderer.js";
import { salarySanity } from "../utils/jobTags.js";
import { jobPlatform, platformBadgeClass } from "../services/jobPlatform.js";
import { applySupportForJob, applySupportBadgeClass } from "../services/applySupport.js";
import {
    assignResumeVariant,
    bestResumeVariantForJob,
    seedResumeVariantsFromJobs,
    upsertResumeVariantForJob
} from "../repositories/resumeVariantRepository.js";
import { normalizeLineBreaks } from "../utils/textFormatting.js";
import {
    collectGapInsights,
    loadResume,
    requeueForRescoring,
    resumeFromForm,
    saveResume
} from "../services/resumeStore.js";
import {
    createOrResetApplication,
    getApplicationByJobId,
    getJobForApplication,
    updateApplicationStatus
} from "../repositories/applicationRepository.js";
import {
    getAutoApplySettings,
    getCandidateProfile,
    jsonList,
    saveAutoApplySettings,
    saveCandidateProfile
} from "../repositories/copilotRepository.js";
import { onboardingState, updateOnboardingState } from "../services/onboarding.js";
import { reliabilityReport } from "../services/reliabilityReport.js";
import { resetCurrentReliabilityBaseline } from "../services/reliabilityScope.js";
import { adapterHealthReport } from "../services/adapterHealth.js";
import { killPortalAdapter, getMappingPack, promoteMappingPack, revivePortalAdapter } from "../repositories/mappingPackRepository.js";
import { getFeatureFlag, setFeatureFlag } from "../repositories/featureFlagRepository.js";
import { listAdaptiveEvidenceDiagnostics } from "../repositories/evidenceRollupRepository.js";
import { dismissMappingProposal, formAGate, promoteMappingProposal } from "../services/learnProposer.js";
import { resolveApplicationUrl } from "../utils/applicationUrl.js";
import { evaluateCurrentCandidateMatch, matchBlockingReason } from "../services/currentCandidateMatching.js";
import { careerProfiles, profileForTargets } from "../services/roleTaxonomy.js";
import { ingestionDashboardMetrics } from "../services/ingestionScheduler.js";
import { matchingDashboardMetrics } from "../services/matchingTelemetry.js";
import { aiUsageSummary } from "../services/aiTelemetry.js";

const router = Router();

const PANELS = ["matches", "close", "discarded", "pending", "tracker", "archived", "overview"];

const PANEL_STATUSES = {
    matches: ["MATCHED", "APPROVED"],
    close: ["CLOSE"],
    discarded: ["PREFILTERED", "REJECTED"],
    pending: ["PENDING"],
    tracker: ["APPROVED", "APPLIED"],
    archived: ["ARCHIVED"]
};

function panelFromReq(req) {
    const panel = String(req.query.panel || req.body?.panel || "matches");
    return PANELS.includes(panel) ? panel : "matches";
}

function redirectTo(req, extra = {}) {
    const panel = extra.panel || panelFromReq(req);
    const job = extra.job || req.body?.job || req.query.job || "";
    const params = new URLSearchParams();
    params.set("panel", panel);
    if (job) params.set("job", job);
    if (extra.success) params.set("success", extra.success);
    if (extra.error) params.set("error", extra.error);
    return `/?${params.toString()}`;
}

function embeddedA4Html(html) {
    const runtime = `<script id="job-hunter-embedded-document">(() => {
      const pageWidth = 794;
      const pageHeight = 1123;
      function fit() {
        const scale = Math.min(1, window.innerWidth / pageWidth);
        document.body.style.transformOrigin = "top left";
        document.body.style.transform = "scale(" + scale + ")";
        document.documentElement.style.width = "100%";
        document.documentElement.style.minHeight = (pageHeight * scale) + "px";
        document.documentElement.style.overflow = "hidden";
      }
      addEventListener("resize", fit, { passive: true });
      fit();
    })();</script>`;
    return String(html).replace("</body>", `${runtime}</body>`);
}

export function prepareDashboardExtensionSession(jobId) {
    const job = getJobForApplication(String(jobId || ""));
    if (!job || job.status === "ARCHIVED") throw new Error("Job not found or archived.");
    const matchDecision = evaluateCurrentCandidateMatch(job);
    if (matchDecision.eligibility.status === "INELIGIBLE") throw new Error(matchBlockingReason(matchDecision));
    let target;
    try { target = resolveApplicationUrl(job.url); } catch (error) {
        throw new Error(error.message === "Invalid URL" ? "This job does not have a valid application URL." : error.message);
    }

    const existing = getApplicationByJobId(job.id);
    if (existing?.status === "SUCCESS") throw new Error("This job already has a verified successful application.");
    const application = existing?.adapter === "EXTENSION"
        ? existing
        : createOrResetApplication(job, getAutoApplySettings(), { adapter: "EXTENSION" });
    updateApplicationStatus(application.id, "OPENING",
        "Candidate opened this job with the current-browser extension.",
        { metadata: { source: "DASHBOARD_OPEN_WITH_EXTENSION" } });
    if (target.unwrapped) {
        getDb().prepare("UPDATE jobs SET url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(target.url, job.id);
        job.url = target.url;
    }
    return { job, application: getApplicationByJobId(job.id), url: target.url };
}

export async function ensureDashboardApplicationResume(jobId) {
    let job = getJobById(String(jobId || ""));
    if (!job) throw new Error("Job not found.");
    seedResumeVariantsFromJobs();
    if (!job.resume_variant_id) {
        const currentMods = parseResumeMods(job.resume_modifications);
        const seeded = upsertResumeVariantForJob(job, currentMods) || bestResumeVariantForJob(job);
        if (seeded) assignResumeVariant(job.id, seeded.id);
        job = getJobById(job.id);
    }
    if (job.generated_resume_path && fs.existsSync(job.generated_resume_path)) return job.generated_resume_path;
    let coverLetter = job.cover_letter || "";
    let resumeModifications = parseResumeMods(job.resume_modifications);
    if (!coverLetter || !resumeModifications.resumeSummary || !resumeModifications.modifiedBullets.length) {
        const tailored = await tailorApplication(job, loadMasterResume(), parseAnalysis(job.ai_analysis));
        coverLetter ||= tailored.coverLetter || "";
        // Existing category variants are reused. A new tailoring delta is
        // created only when this category has no active resume yet.
        if (!job.resume_variant_id) resumeModifications = tailoredToMods(tailored, resumeModifications);
        getDb().prepare(`
            UPDATE jobs SET cover_letter = ?, resume_modifications = ? WHERE id = ?
        `).run(coverLetter, JSON.stringify(resumeModifications), job.id);
        if (!job.resume_variant_id) {
            const variant = upsertResumeVariantForJob(job, resumeModifications);
            if (variant) assignResumeVariant(job.id, variant.id);
        }
    }
    // Preserve an explicit user-selected template. Otherwise use the most
    // conservative ATS layout for files transmitted to employer portals.
    const template = job.resume_template ? resolveTemplateId(job.resume_template) : "ats";
    const assets = await persistAssets(job, coverLetter, resumeModifications, template);
    return assets.resumePdfPath;
}

export async function selectDashboardApplicationResume(jobId, templateId) {
    const job = getJobById(String(jobId || ""));
    if (!job) throw new Error("Job not found.");
    const template = resolveTemplateId(templateId);
    const coverLetter = job.cover_letter || "";
    const resumeModifications = parseResumeMods(job.resume_modifications);
    const assets = await persistAssets(job, coverLetter, resumeModifications, template);
    return { templateId: assets.templateId, resumePdfPath: assets.resumePdfPath };
}

export async function selectDashboardResumeVariant(jobId, variantId) {
    const job = getJobById(String(jobId || ""));
    if (!job) throw new Error("Job not found.");
    const variant = assignResumeVariant(job.id, variantId);
    const refreshed = getJobById(job.id);
    const assets = await persistAssets(refreshed, refreshed.cover_letter || "", variant.modifications,
        refreshed.resume_template || "ats");
    return { variant, templateId: assets.templateId, resumePdfPath: assets.resumePdfPath };
}

export async function createFreshDashboardResumeVariant(jobId) {
    const job = getJobById(String(jobId || ""));
    if (!job) throw new Error("Job not found.");
    const tailored = await tailorApplication(job, loadMasterResume(), parseAnalysis(job.ai_analysis));
    const modifications = tailoredToMods(tailored, emptyMods());
    getDb().prepare(`
        UPDATE jobs SET cover_letter = ?, resume_modifications = ?, generated_resume_path = NULL
        WHERE id = ?
    `).run(tailored.coverLetter || job.cover_letter || "", JSON.stringify(modifications), job.id);
    const variant = upsertResumeVariantForJob(job, modifications, { replace: true });
    if (!variant) throw new Error("The tailored resume did not contain reusable modifications.");
    assignResumeVariant(job.id, variant.id);
    const refreshed = getJobById(job.id);
    const assets = await persistAssets(refreshed, refreshed.cover_letter || "", variant.modifications,
        refreshed.resume_template || "ats");
    return { variant, templateId: assets.templateId, resumePdfPath: assets.resumePdfPath };
}

const JOB_SORTS = {
    score: "COALESCE(j.match_score, -1)",
    created: "j.created_at",
    posted: "COALESCE(j.posted_at, j.created_at)",
    ctc: "COALESCE(j.ctc_max_lpa, j.ctc_min_lpa, -1)",
    companyScore: "COALESCE(c.overall_score, -1)"
};

function jobListFilters(req) {
    const sortBy = Object.hasOwn(JOB_SORTS, req.query.sort) ? req.query.sort : "created";
    const direction = String(req.query.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const number = (value) => value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
    return {
        sortBy,
        direction,
        minScore: number(req.query.minScore),
        createdFrom: date(req.query.createdFrom),
        postedFrom: date(req.query.postedFrom),
        minCtc: number(req.query.minCtc),
        minCompanyScore: number(req.query.minCompanyScore)
    };
}

function getJobsForPanel(panel, filters = {}) {
    const db = getDb();
    if (panel === "overview") {
        return [];
    }
    const statuses = PANEL_STATUSES[panel] || PANEL_STATUSES.matches;
    const placeholders = statuses.map(() => "?").join(", ");
    const conditions = [];
    const values = [...statuses];
    if (filters.minScore != null) { conditions.push("j.match_score >= ?"); values.push(filters.minScore); }
    if (filters.createdFrom) { conditions.push("date(j.created_at) >= date(?)"); values.push(filters.createdFrom); }
    if (filters.postedFrom) { conditions.push("j.posted_at IS NOT NULL AND date(j.posted_at) >= date(?)"); values.push(filters.postedFrom); }
    if (filters.minCtc != null) { conditions.push("COALESCE(j.ctc_max_lpa, j.ctc_min_lpa) >= ?"); values.push(filters.minCtc); }
    if (filters.minCompanyScore != null) { conditions.push("c.overall_score >= ?"); values.push(filters.minCompanyScore); }
    const sort = JOB_SORTS[filters.sortBy] || JOB_SORTS.created;
    const direction = filters.direction === "asc" ? "ASC" : "DESC";
    return db
        .prepare(
            `
            SELECT j.*, c.name AS company_name, c.domain AS company_domain, c.ats_type,
                   c.overall_score AS company_score, c.score_source AS company_score_source
            FROM jobs j
            LEFT JOIN companies c ON c.id = j.company_id
            WHERE j.status IN (${placeholders})
              AND j.url NOT LIKE '%example.com%'
              AND j.url NOT LIKE '%example.org%'
              AND j.url LIKE 'http%'
              ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
            ORDER BY ${sort} ${direction}, j.created_at DESC
            `
        )
        .all(...values);
}

function getCounts() {
    const db = getDb();
    const row = (sql) => db.prepare(sql).get().n;
    return {
        matches: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('MATCHED','APPROVED')"),
        close: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'CLOSE'"),
        discarded: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('PREFILTERED','REJECTED')"),
        pending: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'PENDING'"),
        tracker: row("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('APPROVED','APPLIED')"),
        archived: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'ARCHIVED'"),
        applications: row("SELECT COUNT(*) AS n FROM applications"),
        applied: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'APPLIED'"),
        followUpDue: row(
            "SELECT COUNT(*) AS n FROM jobs WHERE follow_up_due IS NOT NULL AND follow_up_due <= datetime('now') AND status IN ('APPROVED','APPLIED')"
        )
    };
}

function getOverview() {
    const db = getDb();
    const row = (sql) => db.prepare(sql).get().n;
    const enabledSearchSources = [
        env.jobspy.enabled,
        env.firecrawl.enabled,
        env.greenhouseBoards.length > 0,
        env.leverCompanies.length > 0,
        env.ashbyBoards.length > 0,
        ...Object.values(env.indiaAggregators)
    ].filter(Boolean).length;
    return {
        actions: {
            pending: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'PENDING'"),
            matched: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'MATCHED'"),
            readyToApply: row("SELECT COUNT(*) AS n FROM jobs WHERE status = 'APPROVED'"),
            followUpDue: row("SELECT COUNT(*) AS n FROM jobs WHERE follow_up_due <= datetime('now') AND status = 'APPLIED'")
        },
        lastSevenDays: {
            added: row("SELECT COUNT(*) AS n FROM jobs WHERE created_at >= datetime('now', '-7 days')"),
            matches: row("SELECT COUNT(*) AS n FROM jobs WHERE created_at >= datetime('now', '-7 days') AND status IN ('MATCHED','APPROVED','APPLIED')"),
            applied: row("SELECT COUNT(*) AS n FROM jobs WHERE applied_at >= datetime('now', '-7 days')")
        },
        health: {
            openai: Boolean(env.openaiApiKey),
            hunter: env.hunterApiKeys.length > 0,
            searchSources: enabledSearchSources
        },
        ingestion: ingestionDashboardMetrics(db),
        matching: matchingDashboardMetrics(db),
        ai: aiUsageSummary({ days: 30 })
    };
}

function formatCreatedAt(value) {
    if (!value) return "Unknown";
    const normalized = String(value).replace(" ", "T");
    const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata"
    }).format(date);
}

function getJobById(id) {
    const db = getDb();
    const job = db
        .prepare(
            `
            SELECT j.*, c.name AS company_name, c.domain AS company_domain, c.ats_type,
                   c.overall_score AS company_score, c.score_source AS company_score_source
            FROM jobs j
            LEFT JOIN companies c ON c.id = j.company_id
            WHERE j.id = ?
            `
        )
        .get(id);
    if (job) job.cover_letter = normalizeLineBreaks(job.cover_letter || "");
    return job;
}

function getOutreach(jobId) {
    const db = getDb();
    return db
        .prepare(
            `
            SELECT * FROM outreach
            WHERE job_id = ?
            ORDER BY id ASC
            `
        )
        .all(jobId);
}

function missingCopyFields(job, mods) {
    const missing = [];
    if (!job?.cover_letter) missing.push("cover letter");
    if (!mods?.resumeSummary) missing.push("resume summary");
    if (!mods?.modifiedBullets?.length) missing.push("resume bullets");
    if (!mods?.outreachEmail) missing.push("cold email");
    if (!mods?.linkedinOutreachNote) missing.push("LinkedIn notes");
    return missing;
}

function emptyMods() {
    return {
        resumeSummary: "",
        modifiedBullets: [],
        modifiedBulletsByRole: [],
        outreachEmail: "",
        linkedinOutreachNote: "",
        linkedinOutreachCuriosity: "",
        extraSkills: [],
        excludedSkills: [],
        keywordsToEmphasize: []
    };
}

function parseResumeMods(raw) {
    if (!raw) return emptyMods();
    try {
        const parsed = JSON.parse(raw);
        return {
            resumeSummary: normalizeLineBreaks(parsed.resumeSummary || ""),
            modifiedBullets: parsed.modifiedBullets || [],
            modifiedBulletsByRole: parsed.modifiedBulletsByRole || [],
            outreachEmail: normalizeLineBreaks(parsed.outreachEmail || ""),
            linkedinOutreachNote: normalizeLineBreaks(parsed.linkedinOutreachNote || "").slice(0, 300),
            linkedinOutreachCuriosity: normalizeLineBreaks(parsed.linkedinOutreachCuriosity || "").slice(0, 300),
            extraSkills: parsed.extraSkills || [],
            excludedSkills: parsed.excludedSkills || [],
            keywordsToEmphasize: parsed.keywordsToEmphasize || []
        };
    } catch {
        return emptyMods();
    }
}

function parseAnalysis(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return { explanation: raw };
    }
}

function composeLinks(job, mods, outreach = []) {
    const recruiter = outreach.find((p) => p.recruiter_email) || {};
    const to = recruiter.recruiter_email || "";
    const subject = `${job.title} — ${job.company_name || "application"}`;
    const body = normalizeLineBreaks(mods?.outreachEmail || "");
    const gmail = new URLSearchParams({ view: "cm", fs: "1" });
    if (to) gmail.set("to", to);
    if (subject) gmail.set("su", subject);
    if (body) gmail.set("body", body.slice(0, 1800));
    const mailto = new URLSearchParams();
    if (subject) mailto.set("subject", subject);
    if (body) mailto.set("body", body.slice(0, 1800));
    return {
        gmail: `https://mail.google.com/mail/?${gmail.toString()}`,
        mailto: `mailto:${encodeURIComponent(to)}?${mailto.toString()}`
    };
}

function naukriReminder() {
    const last = getSetting("naukriLastRefresh", "");
    const lastDate = last ? new Date(last) : null;
    const valid = lastDate && !Number.isNaN(lastDate.getTime());
    const daysAgo = valid ? Math.floor((Date.now() - lastDate.getTime()) / 86400000) : null;
    return {
        lastRefresh: valid ? lastDate.toISOString() : null,
        daysAgo,
        stale: daysAgo === null || daysAgo >= 7
    };
}

function naukriAssistContent() {
    const resume = loadMasterResume();
    const allSkills = [
        ...(resume.skills || []),
        ...Object.values(resume.skillGroups || {}).flat(),
        ...(resume.keywords || [])
    ];
    const uniqueSkills = [...new Map(allSkills.filter(Boolean).map((skill) => [String(skill).toLowerCase(), String(skill)])).values()];
    const preferred = ["Node.js", "JavaScript", "Microservices", "AWS", "PostgreSQL", "MongoDB", "Redis", "Docker"];
    const prioritized = preferred
        .map((needle) => uniqueSkills.find((skill) => skill.toLowerCase().includes(needle.toLowerCase())))
        .filter(Boolean);
    const remaining = uniqueSkills.filter(
        (skill) => !prioritized.some((picked) => picked.toLowerCase() === skill.toLowerCase())
    );
    const skills = [...prioritized, ...remaining].slice(0, 15);
    const targetTitle = env.targetTitles[0] || resume.experience?.[0]?.title || "Software Engineer";
    return {
        editUrl: "https://www.naukri.com/mnjuser/profile",
        headline: [targetTitle, ...skills.slice(0, 6)].join(" | ").slice(0, 250),
        summary: normalizeLineBreaks(resume.summary || "").trim(),
        skills: skills.join(", "),
        noticePeriodDays: Number(resume.noticePeriodDays ?? env.candidateNoticeDays ?? 0)
    };
}

function viewLocals(req, extra = {}) {
    archiveStaleJobs();
    const panel = extra.panel || panelFromReq(req);
    const filters = jobListFilters(req);
    const jobs = extra.jobs || getJobsForPanel(panel, filters);
    const selectedId = extra.selectedId || req.query.job || jobs[0]?.id || null;
    const selected = selectedId ? getJobById(selectedId) : null;
    const outreach = selected ? getOutreach(selected.id) : [];
    const mods = selected ? parseResumeMods(selected.resume_modifications) : null;
    const analysis = selected ? parseAnalysis(selected.ai_analysis) : null;
    const tags = selected
        ? {
              yoeMin: selected.yoe_min,
              ctcMinLpa: selected.ctc_min_lpa,
              ctcMaxLpa: selected.ctc_max_lpa,
              workMode: selected.work_mode,
              hasEsops: selected.has_esops,
              hasBond: selected.has_bond,
              locationLabel: selected.location_label,
              salarySanity: salarySanity(selected.title, selected.ctc_min_lpa, selected.ctc_max_lpa)
          }
        : null;

    return {
        panel,
        jobs,
        filters,
        filterQuery: new URLSearchParams({
            sort: filters.sortBy,
            direction: filters.direction,
            ...(filters.minScore != null ? { minScore: String(filters.minScore) } : {}),
            ...(filters.createdFrom ? { createdFrom: filters.createdFrom } : {}),
            ...(filters.postedFrom ? { postedFrom: filters.postedFrom } : {}),
            ...(filters.minCtc != null ? { minCtc: String(filters.minCtc) } : {}),
            ...(filters.minCompanyScore != null ? { minCompanyScore: String(filters.minCompanyScore) } : {})
        }).toString(),
        counts: getCounts(),
        overview: getOverview(),
        selected,
        outreach,
        mods,
        analysis,
        tags,
        platformOf: jobPlatform,
        platformBadgeClass,
        applySupportOf: applySupportForJob,
        applySupportBadgeClass,
        selectedPlatform: selected ? jobPlatform(selected) : null,
        selectedSupport: selected ? applySupportForJob(selected) : null,
        compose: selected && mods ? composeLinks(selected, mods, outreach) : null,
        missingCopy: selected ? missingCopyFields(selected, mods) : [],
        naukri: naukriReminder(),
        naukriAssist: naukriAssistContent(),
        onboarding: onboardingState(),
        candidateEmail: env.candidateEmail,
        formatCreatedAt,
        error: extra.error || req.query.error || null,
        success: extra.success || req.query.success || null
    };
}

function onboardingRedirect(anchor, kind = "success", message = "Progress saved.") {
    return `/onboarding?${kind}=${encodeURIComponent(message)}${anchor ? `#${anchor}` : ""}`;
}

router.get("/onboarding", (req, res) => {
    res.render("onboarding", {
        panel: "onboarding",
        counts: getCounts(),
        onboarding: onboardingState(),
        profile: getCandidateProfile(),
        settings: getAutoApplySettings(),
        careerProfiles: careerProfiles(),
        error: String(req.query.error || ""),
        success: String(req.query.success || "")
    });
});

router.post("/onboarding/profile", (req, res) => {
    try {
        saveCandidateProfile({
            name: req.body.name, email: req.body.email, phone: req.body.phone,
            preferredFirstName: req.body.preferredFirstName, preferredLastName: req.body.preferredLastName,
            legalFirstName: req.body.legalFirstName, legalMiddleName: req.body.legalMiddleName,
            legalLastName: req.body.legalLastName,
            currentLocation: req.body.currentLocation, country: req.body.country, postalCode: req.body.postalCode,
            addressLine1: req.body.addressLine1, addressLine2: req.body.addressLine2,
            addressCity: req.body.addressCity, addressState: req.body.addressState,
            linkedinUrl: req.body.linkedinUrl, githubUrl: req.body.githubUrl, portfolioUrl: req.body.portfolioUrl,
            currentCompany: req.body.currentCompany, currentIndustry: req.body.currentIndustry,
            totalExperienceYears: req.body.totalExperienceYears,
            workAuthorization: req.body.workAuthorization,
            sponsorshipRequired: req.body.sponsorshipRequired
        });
        updateOnboardingState({ profileReviewed: true });
        res.redirect(303, onboardingRedirect("preferences", "success", "Core profile verified."));
    } catch (error) {
        res.redirect(303, onboardingRedirect("profile", "error", error.message));
    }
});

router.post("/onboarding/resume-profile/confirm", (req, res) => {
    try {
        const state = onboardingState();
        const parsed = state.resumeProfile;
        if (!parsed) throw new Error("Upload a resume before confirming its extracted profile.");
        const preferredSkills = jsonList(req.body.preferredSkills || parsed.preferredSkills || []);
        const targetRoles = jsonList(req.body.targetRoles || parsed.searchSuggestions?.targetRoles || []);
        saveCandidateProfile({
            name: parsed.contact?.fullName || undefined,
            email: parsed.contact?.email || undefined,
            phone: parsed.contact?.phone || undefined,
            currentLocation: parsed.contact?.location || undefined,
            linkedinUrl: parsed.contact?.linkedin || undefined,
            githubUrl: parsed.contact?.github || undefined,
            portfolioUrl: parsed.contact?.portfolio || undefined,
            currentCompany: parsed.career?.currentCompany || undefined,
            totalExperienceYears: parsed.career?.totalExperienceYears ?? undefined,
            skills: parsed.skills || [], preferredSkills,
            targetRoles: targetRoles.length ? targetRoles : undefined,
            careerProfiles: profileForTargets(targetRoles)
        });
        if (parsed.resumeVersionId) {
            getDb().prepare("UPDATE resume_versions SET candidate_confirmed = 1 WHERE id = ? AND user_id = 'local-user'")
                .run(parsed.resumeVersionId);
        }
        updateOnboardingState({ resumeProfileReviewed: true });
        res.redirect(303, onboardingRedirect("profile", "success", "Resume details confirmed and added to your application profile."));
    } catch (error) {
        res.redirect(303, onboardingRedirect("resume", "error", error.message));
    }
});

router.post("/onboarding/preferences", (req, res) => {
    try {
        const targetRoles = jsonList(req.body.targetRoles);
        const preferredLocations = jsonList(req.body.preferredLocations);
        const preferredWorkModes = jsonList(req.body.preferredWorkModes);
        const preferredSkills = jsonList(req.body.preferredSkills);
        const excludedSkills = jsonList(req.body.excludedSkills);
        const selectedCareerProfiles = jsonList(req.body.careerProfiles);
        const profile = saveCandidateProfile({
            targetRoles, preferredLocations, preferredWorkModes, preferredSkills, excludedSkills,
            careerProfiles: selectedCareerProfiles,
            currentCTC: req.body.currentCTC, expectedCTC: req.body.expectedCTC,
            minimumSalary: req.body.minimumSalary, noticePeriodDays: req.body.noticePeriodDays,
            lastWorkingDate: req.body.lastWorkingDate,
            willingToRelocate: req.body.willingToRelocate === "1"
        });
        saveAutoApplySettings({
            targetRoles, preferredLocations, minimumSalary: profile.minimumSalary,
            excludedCompanies: jsonList(req.body.excludedCompanies)
        });
        updateOnboardingState({ preferencesReviewed: true });
        res.redirect(303, onboardingRedirect("privacy", "success", "Search boundaries saved."));
    } catch (error) {
        res.redirect(303, onboardingRedirect("preferences", "error", error.message));
    }
});

router.post("/onboarding/privacy", (req, res) => {
    try {
        saveCandidateProfile({
            aiProcessingConsent: req.body.aiProcessingConsent === "1",
            reusableAnswerConsent: req.body.reusableAnswerConsent === "1"
        });
        updateOnboardingState({ privacyReviewed: true });
        res.redirect(303, onboardingRedirect("extension", "success", "Privacy choices saved."));
    } catch (error) {
        res.redirect(303, onboardingRedirect("privacy", "error", error.message));
    }
});

router.post("/onboarding/extension", (req, res) => {
    updateOnboardingState({ extensionReady: req.body.extensionReady === "1" });
    res.redirect(303, onboardingRedirect("extension", "success", "COPILOT setup status saved."));
});

router.get("/admin/reliability", (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const allVersions = req.query.scope === "historical";
    res.render("reliability", {
        panel: "reliability", counts: getCounts(), report: reliabilityReport({ days, allVersions }),
        error: req.query.error || "", success: req.query.success || ""
    });
});

router.get("/api/admin/reliability", (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    res.json(reliabilityReport({
        days, allVersions: req.query.scope === "historical",
        portalKind: req.query.portalKind, adapterVersion: req.query.adapterVersion
    }));
});

router.get("/admin/adaptive-evidence", (req, res) => {
    const classifier = getFeatureFlag("learning.phase0_classifier", false);
    const adaptive = getFeatureFlag("adaptive_evidence.shadow", false);
    res.render("adaptiveEvidence", {
        panel: "adaptive-evidence",
        counts: getCounts(),
        classifier,
        adaptive,
        report: listAdaptiveEvidenceDiagnostics({ limit: req.query.limit })
    });
});

router.get("/api/admin/adaptive-evidence", (req, res) => {
    res.json({
        classifier: getFeatureFlag("learning.phase0_classifier", false),
        adaptiveEvidence: getFeatureFlag("adaptive_evidence.shadow", false),
        ...listAdaptiveEvidenceDiagnostics({ limit: req.query.limit })
    });
});

router.post("/admin/adaptive-evidence/shadow", (req, res) => {
    try {
        const enabled = String(req.body.enabled || "") === "true";
        if (enabled) setFeatureFlag({ key: "learning.phase0_classifier", enabled: true, scope: "global" });
        setFeatureFlag({ key: "adaptive_evidence.shadow", enabled, scope: "global" });
        res.redirect(303, `/admin/adaptive-evidence?success=${encodeURIComponent(enabled
            ? "Adaptive evidence is recording SHADOW recommendations only. Live learning and promotion remain unchanged."
            : "Adaptive evidence SHADOW recording is paused. Existing evidence remains available.")}`);
    } catch (error) {
        res.redirect(303, `/admin/adaptive-evidence?error=${encodeURIComponent(error.message)}`);
    }
});

router.post("/admin/reliability/baseline", (_req, res) => {
    try {
        const scope = resetCurrentReliabilityBaseline();
        res.redirect(303, `/admin/reliability?success=${encodeURIComponent(`Fresh ${scope.extensionVersion} reliability baseline started without deleting historical evidence.`)}`);
    } catch (error) {
        res.redirect(303, `/admin/reliability?error=${encodeURIComponent(error.message)}`);
    }
});

router.get("/admin/adapters", (req, res) => {
    res.render("adapters", {
        panel: "adapters",
        counts: getCounts(),
        report: adapterHealthReport(),
        error: req.query.error || "",
        success: req.query.success || ""
    });
});

router.get("/api/admin/adapters", (_req, res) => {
    res.json(adapterHealthReport());
});

router.post("/admin/adapters/:portalKind/kill", (req, res) => {
    try {
        killPortalAdapter(req.params.portalKind, req.body.reason || "Manual kill switch");
        res.redirect(303, "/admin/adapters?success=" + encodeURIComponent(`Kill switch on for ${req.params.portalKind}.`));
    } catch (error) {
        res.redirect(303, "/admin/adapters?error=" + encodeURIComponent(error.message));
    }
});

router.post("/admin/adapters/:portalKind/revive", (req, res) => {
    try {
        revivePortalAdapter(req.params.portalKind);
        res.redirect(303, "/admin/adapters?success=" + encodeURIComponent(`Adapter revived for ${req.params.portalKind}.`));
    } catch (error) {
        res.redirect(303, "/admin/adapters?error=" + encodeURIComponent(error.message));
    }
});

router.post("/admin/mapping-packs/:id/promote", (req, res) => {
    try {
        const pack = getMappingPack(req.params.id);
        if (!pack) throw new Error("Mapping pack not found.");
        const gate = formAGate({ ...(pack.pack || {}), portalKind: pack.portalKind });
        promoteMappingPack(req.params.id, {
            gate: { ...gate, formAGate: gate.status || gate.formAGate, actor: "local-admin" }
        });
        res.redirect(303, "/admin/adapters?success=" + encodeURIComponent("Mapping pack promoted."));
    } catch (error) {
        res.redirect(303, "/admin/adapters?error=" + encodeURIComponent(error.message));
    }
});

router.post("/admin/flags", (req, res) => {
    try {
        setFeatureFlag({
            key: req.body.key,
            enabled: req.body.enabled === "1" || req.body.enabled === true,
            scope: req.body.scope || "global",
            portalKind: req.body.portalKind || null
        });
        res.redirect(303, "/admin/adapters?success=" + encodeURIComponent("Flag saved."));
    } catch (error) {
        res.redirect(303, "/admin/adapters?error=" + encodeURIComponent(error.message));
    }
});

router.post("/admin/proposals/:id/promote", (req, res) => {
    try {
        promoteMappingProposal(req.params.id);
        res.redirect(303, "/admin/adapters?success=" + encodeURIComponent("Proposal saved as a LOCAL_DRAFT mapping pack. It does not rewrite content.js."));
    } catch (error) {
        res.redirect(303, "/admin/adapters?error=" + encodeURIComponent(error.message));
    }
});

router.post("/admin/proposals/:id/dismiss", (req, res) => {
    try {
        dismissMappingProposal(req.params.id);
        res.redirect(303, "/admin/adapters?success=" + encodeURIComponent("Proposal dismissed."));
    } catch (error) {
        res.redirect(303, "/admin/adapters?error=" + encodeURIComponent(error.message));
    }
});

router.get("/", (req, res) => {
    try {
        res.render("index", viewLocals(req));
    } catch (error) {
        console.error("[dashboard:GET /]", error);
        res.status(500).render("index", viewLocals(req, { error: error.message, jobs: [], selectedId: null }));
    }
});

router.post("/jobs/:id/open-with-extension", async (req, res) => {
    try {
        await ensureDashboardApplicationResume(req.params.id);
        const prepared = prepareDashboardExtensionSession(req.params.id);
        if (req.accepts(["json", "html"]) === "json") {
            return res.json({ jobUrl: prepared.url, jobId: prepared.job.id, applicationId: prepared.application.id, status: prepared.application.status });
        }
        res.redirect(303, redirectTo(req, {
            job: prepared.job.id,
            error: "Reload the Job Hunter COPILOT unpacked extension, then click Open with Extension again. The dashboard stays here; the application opens in a grouped tab."
        }));
    } catch (error) {
        console.error("[dashboard:open-with-extension]", error);
        res.redirect(303, redirectTo(req, { job: req.params.id, error: error.message }));
    }
});

router.post("/jobs/:id/archive", (req, res) => {
    try {
        getDb().prepare(`
            UPDATE jobs
            SET archived_from_status = status,
                archived_at = CURRENT_TIMESTAMP,
                status = 'ARCHIVED'
            WHERE id = ? AND status != 'ARCHIVED'
        `).run(req.params.id);
        res.redirect(redirectTo(req));
    } catch (error) {
        console.error("[dashboard:archive]", error);
        res.redirect(redirectTo(req, { job: req.params.id, error: error.message }));
    }
});

router.post("/jobs/:id/restore", (req, res) => {
    try {
        const job = getDb().prepare("SELECT status, archived_from_status FROM jobs WHERE id = ?").get(req.params.id);
        const target = job?.status === "ARCHIVED" && ["MATCHED", "CLOSE", "APPROVED", "APPLIED"].includes(job.archived_from_status)
            ? job.archived_from_status
            : "PENDING";
        getDb().prepare(`
            UPDATE jobs
            SET status = ?, archived_from_status = NULL, archived_at = NULL
            WHERE id = ?
        `).run(target, req.params.id);
        const panel = target === "MATCHED" || target === "APPROVED" ? "matches" : target === "CLOSE" ? "close" : target === "APPLIED" ? "tracker" : "pending";
        res.redirect(redirectTo(req, { panel, success: `Restored to ${target.toLowerCase()}` }));
    } catch (error) {
        console.error("[dashboard:restore]", error);
        res.redirect(redirectTo(req, { job: req.params.id, error: error.message }));
    }
});

function scoringSummary(scoring) {
    return `processed ${scoring.scanned}; matched ${scoring.matched}; close ${scoring.close}; discarded ${scoring.prefiltered + scoring.rejected}; failed ${scoring.failed || 0}`;
}

router.post("/pipeline/process-pending", async (req, res) => {
    try {
        const limit = parseProcessLimit(req.body.limit);
        const result = await processPendingFromDashboard(limit);
        res.redirect(redirectTo(req, {
            panel: "overview",
            success: `Pending run complete: ${scoringSummary(result.scoring)}. Auto-archived ${result.archived} stale job(s).`
        }));
    } catch (error) {
        console.error("[dashboard:process-pending]", error);
        res.redirect(redirectTo(req, { panel: "overview", error: error.message }));
    }
});

router.post("/pipeline/search-and-process", async (req, res) => {
    try {
        const limit = parseProcessLimit(req.body.limit);
        const result = await searchAndProcessFromDashboard(limit);
        res.redirect(redirectTo(req, {
            panel: "overview",
            success: `Search complete: fetched ${result.ingestion.fetched}, added ${result.ingestion.inserted}, skipped ${result.ingestion.skipped}; ${scoringSummary(result.scoring)} newly added job(s). Auto-archived ${result.archived} stale job(s).`
        }));
    } catch (error) {
        console.error("[dashboard:search-and-process]", error);
        res.redirect(redirectTo(req, { panel: "overview", error: error.message }));
    }
});

router.post("/api/pipeline/run", (req, res) => {
    try {
        res.status(202).json(launchPipelineRun(req.body.kind, req.body.limit));
    } catch (error) {
        res.status(409).json({ error: error.message, run: getPipelineRunState() });
    }
});

router.get("/api/pipeline/run", (_req, res) => res.json(getPipelineRunState()));

function submittedText(body, key, fallback = "") {
    const value = Object.prototype.hasOwnProperty.call(body || {}, key)
        ? String(body[key] ?? "")
        : String(fallback ?? "");
    return normalizeLineBreaks(value);
}

function groupedSkillItems(skills = []) {
    const result = [];
    let pending = "";
    for (const item of skills || []) {
        const text = String(item || "").trim();
        if (!text) continue;
        pending = pending ? `${pending}, ${text}` : text;
        const opens = (pending.match(/\(/g) || []).length;
        const closes = (pending.match(/\)/g) || []).length;
        if (opens <= closes) {
            result.push(pending);
            pending = "";
        }
    }
    if (pending) result.push(pending);
    return result;
}

function masterSkillOptions(resume = loadMasterResume()) {
    return [...new Set(Object.values(resume.skillGroups || {}).flatMap(groupedSkillItems)
        .map((skill) => String(skill || "").trim()).filter(Boolean))];
}

function collectModsFromBody(job, body = {}) {
    const existing = parseResumeMods(job.resume_modifications);
    const hasModifiedBullets = Object.prototype.hasOwnProperty.call(body, "modifiedBullets");
    const bulletsRaw = submittedText(body, "modifiedBullets", existing.modifiedBullets.join("\n"));
    const modifiedBullets = String(bulletsRaw)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const extraSkills = submittedText(body, "extraSkills", existing.extraSkills.join(", "))
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const baseSkills = masterSkillOptions();
    const includedSkills = new Set([].concat(body.includedSkills || []).map((skill) => String(skill).trim()));
    const excludedSkills = String(body.skillsEditor || "") === "1"
        ? baseSkills.filter((skill) => !includedSkills.has(skill))
        : existing.excludedSkills;
    const modifiedBulletsByRole = hasModifiedBullets && existing.modifiedBulletsByRole.length
        ? existing.modifiedBulletsByRole.map((role, index) =>
              index === 0 ? { ...role, bullets: modifiedBullets } : role
          )
        : existing.modifiedBulletsByRole;

    return {
        ...existing,
        resumeSummary: submittedText(body, "resumeSummary", existing.resumeSummary),
        modifiedBullets,
        modifiedBulletsByRole,
        outreachEmail: submittedText(body, "outreachEmail", existing.outreachEmail),
        linkedinOutreachNote: submittedText(body, "linkedinOutreachNote", existing.linkedinOutreachNote).slice(0, 300),
        linkedinOutreachCuriosity: submittedText(
            body,
            "linkedinOutreachCuriosity",
            existing.linkedinOutreachCuriosity
        ).slice(0, 300),
        extraSkills,
        excludedSkills
    };
}

async function persistAssets(job, coverLetter, resumeModifications, templateId) {
    const db = getDb();
    const template = resolveTemplateId(templateId || job.resume_template);
    const assets = await generateApplicationAssets({
        job,
        coverLetter,
        resumeModifications,
        companyName: job.company_name,
        templateId: template
    });
    if (!assets.resumePdfPath) {
        const error = new Error(assets.pdfError || "PDF rendering failed; no resume asset was saved.");
        error.code = "RESUME_PDF_FAILED";
        error.layout = assets.layout || null;
        throw error;
    }
    db.prepare(
        `
        UPDATE jobs
        SET generated_resume_path = @path,
            resume_template = @template
        WHERE id = @jobId
        `
    ).run({ jobId: job.id, path: assets.resumePdfPath, template });
    db.prepare(
        `
        UPDATE outreach
        SET generated_resume_path = @path,
            status = 'READY',
            updated_at = CURRENT_TIMESTAMP
        WHERE job_id = @jobId
        `
    ).run({ jobId: job.id, path: assets.resumePdfPath });
    return assets;
}

function tailoredToMods(tailored, existing = emptyMods()) {
    return {
        ...existing,
        resumeSummary: tailored.resumeSummary || existing.resumeSummary,
        modifiedBullets: tailored.modifiedBullets?.length ? tailored.modifiedBullets : existing.modifiedBullets,
        modifiedBulletsByRole: tailored.modifiedBulletsByRole?.length
            ? tailored.modifiedBulletsByRole
            : existing.modifiedBulletsByRole,
        outreachEmail: normalizeLineBreaks(tailored.outreachEmail || existing.outreachEmail),
        linkedinOutreachNote: normalizeLineBreaks(tailored.linkedinOutreachNote || existing.linkedinOutreachNote).slice(0, 300),
        linkedinOutreachCuriosity: normalizeLineBreaks(
            tailored.linkedinOutreachCuriosity || existing.linkedinOutreachCuriosity
        ).slice(0, 300),
        extraSkills: tailored.extraSkills?.length ? tailored.extraSkills : existing.extraSkills,
        keywordsToEmphasize: tailored.keywordsToEmphasize?.length
            ? tailored.keywordsToEmphasize
            : existing.keywordsToEmphasize
    };
}

router.post("/jobs/:id/approve", async (req, res) => {
    const jobId = req.params.id;

    try {
        const db = getDb();
        const job = getJobById(jobId);
        if (!job) {
            return res.redirect("/");
        }

        const coverLetter = submittedText(req.body, "coverLetter", job.cover_letter || "");
        const resumeModifications = collectModsFromBody(job, req.body);

        db.prepare(
            `
            UPDATE jobs
            SET cover_letter = @coverLetter,
                resume_modifications = @resumeModifications,
                generated_resume_path = NULL
            WHERE id = @id
            `
        ).run({
            id: jobId,
            coverLetter,
            resumeModifications: JSON.stringify(resumeModifications)
        });

        const assets = await persistAssets(job, coverLetter, resumeModifications);
        const recruiters = await enrichJobOutreach(jobId, { emailBody: resumeModifications.outreachEmail });
        db.prepare("UPDATE jobs SET status = 'APPROVED' WHERE id = ?").run(jobId);

        res.render(
            "index",
            viewLocals(req, {
                panel: "matches",
                selectedId: jobId,
                success: `Approved. Enriched ${recruiters.length} recruiter(s). Assets saved to ${assets.directory}`
            })
        );
    } catch (error) {
        console.error("[dashboard:approve]", error);
        res.status(500).render("index", viewLocals(req, { selectedId: jobId, error: error.message }));
    }
});

router.post("/jobs/:id/build-resume", async (req, res) => {
    const jobId = req.params.id;
    try {
        const db = getDb();
        const job = getJobById(jobId);
        if (!job) return res.redirect("/");

        const coverLetter = submittedText(req.body, "coverLetter", job.cover_letter || "");
        const resumeModifications = collectModsFromBody(job, req.body);
        db.prepare(
            `
            UPDATE jobs
            SET cover_letter = @coverLetter,
                resume_modifications = @resumeModifications,
                generated_resume_path = NULL
            WHERE id = @id
            `
        ).run({
            id: jobId,
            coverLetter,
            resumeModifications: JSON.stringify(resumeModifications)
        });

        const assets = await persistAssets(job, coverLetter, resumeModifications, req.body.template);
        if (String(req.query.preview || "") === "1") {
            const params = new URLSearchParams({
                panel: panelFromReq(req),
                template: assets.templateId
            });
            return res.redirect(`/jobs/${encodeURIComponent(jobId)}/resume-preview?${params.toString()}`);
        }
        res.redirect(redirectTo(req, { job: jobId, success: "Resume built. Open Preview & download to pick a layout." }));
    } catch (error) {
        console.error("[dashboard:build-resume]", error);
        res.redirect(redirectTo(req, { job: jobId, error: error.message }));
    }
});

router.get("/jobs/:id/resume-preview", (req, res) => {
    try {
        const job = getJobById(req.params.id);
        if (!job) return res.redirect("/");
        const selectedTemplate = resolveTemplateId(req.query.template || job.resume_template);
        const modifications = parseResumeMods(job.resume_modifications);
        const resume = loadMasterResume();
        const excludedSkills = new Set(modifications.excludedSkills || []);
        const skillOptions = masterSkillOptions(resume)
            .map((skill) => ({ skill, included: !excludedSkills.has(skill) }));
        res.render("resumePreview", {
            panel: "matches",
            counts: getCounts(),
            job,
            templates: RESUME_TEMPLATES,
            selectedTemplate,
            modifications,
            skillOptions,
            back: `/?panel=${encodeURIComponent(panelFromReq(req))}&job=${encodeURIComponent(job.id)}`,
            error: req.query.error || null,
            success: req.query.success || null
        });
    } catch (error) {
        console.error("[dashboard:resume-preview]", error);
        res.redirect(redirectTo(req, { job: req.params.id, error: error.message }));
    }
});

router.get("/jobs/:id/resume.html", (req, res) => {
    try {
        const job = getJobById(req.params.id);
        if (!job) return res.status(404).send("Not found");
        const resume = loadMasterResume();
        const mods = parseResumeMods(job.resume_modifications);
        const templateId = resolveTemplateId(req.query.template || job.resume_template);
        const html = renderResumeHtml(resume, mods, { templateId });
        res.type("html").send(String(req.query.embed || "") === "1" ? embeddedA4Html(html) : html);
    } catch (error) {
        console.error("[dashboard:resume.html]", error);
        res.status(500).send(error.message);
    }
});

router.get("/jobs/:id/cover-letter.html", (req, res) => {
    try {
        const job = getJobById(req.params.id);
        if (!job?.cover_letter?.trim()) return res.status(404).send("Cover letter not found");
        const html = renderCoverLetterHtml({ resume: loadMasterResume(), job, coverLetter: job.cover_letter });
        res.type("html").send(String(req.query.embed || "") === "1" ? embeddedA4Html(html) : html);
    } catch (error) {
        console.error("[dashboard:cover-letter.html]", error);
        res.status(500).send(error.message);
    }
});

function downloadCoverLetterText(req, res) {
    try {
        const job = getJobById(req.params.id);
        if (!job) return res.status(404).send("Job not found");
        const coverLetter = submittedText(req.body, "coverLetter", job.cover_letter || "").trim();
        if (!coverLetter) return res.status(404).send("No cover letter has been generated for this job");

        const resume = loadMasterResume();
        const safeCandidate = String(resume.fullName || "Candidate").replace(/[^\w.-]+/g, "_");
        const safeCompany = String(job.company_name || "Company").replace(/[^\w.-]+/g, "_");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.attachment(`${safeCandidate}_${safeCompany}_Cover_Letter.txt`);
        res.send(`${coverLetter}\n`);
    } catch (error) {
        console.error("[dashboard:cover-letter.txt]", error);
        res.status(500).send(error.message);
    }
}

router.get("/jobs/:id/cover-letter.txt", downloadCoverLetterText);
router.post("/jobs/:id/cover-letter.txt", downloadCoverLetterText);

async function downloadCoverLetterPdf(req, res) {
    try {
        const job = getJobById(req.params.id);
        if (!job) return res.status(404).send("Job not found");
        const coverLetter = submittedText(req.body, "coverLetter", job.cover_letter || "");
        const result = await generateCoverLetterPdf({
            job,
            coverLetter,
            companyName: job.company_name
        });
        const resume = loadMasterResume();
        const safeCandidate = String(resume.fullName || "Candidate").replace(/[^\w.-]+/g, "_");
        const safeCompany = String(job.company_name || "Company").replace(/[^\w.-]+/g, "_");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "no-store");
        res.download(result.path, `${safeCandidate}_${safeCompany}_Cover_Letter.pdf`);
    } catch (error) {
        console.error("[dashboard:cover-letter.pdf]", error);
        res.status(500).send(error.message);
    }
}

router.get("/jobs/:id/cover-letter.pdf", downloadCoverLetterPdf);
router.post("/jobs/:id/cover-letter.pdf", downloadCoverLetterPdf);

router.get("/jobs/:id/resume-check", async (req, res) => {
    try {
        const job = getJobById(req.params.id);
        if (!job) return res.status(404).json({ error: "Job not found" });
        const resume = loadMasterResume();
        const modifications = parseResumeMods(job.resume_modifications);
        const templateId = resolveTemplateId(req.query.template || job.resume_template);
        const html = renderResumeHtml(resume, modifications, { templateId });
        const diagnostics = await inspectResumeHtml(html, { includePdf: true });
        const report = analyzeResumeReadiness({
            resume,
            modifications,
            job,
            templateId,
            diagnostics
        });
        res.setHeader("Cache-Control", "no-store");
        res.json(report);
    } catch (error) {
        console.error("[dashboard:resume-check]", error);
        res.status(500).json({ error: error.message || "Could not inspect the selected resume" });
    }
});

router.get("/jobs/:id/resume.pdf", async (req, res) => {
    try {
        const job = getJobById(req.params.id);
        if (!job) return res.status(404).send("Not found");
        const templateId = resolveTemplateId(req.query.template || job.resume_template);
        const mods = parseResumeMods(job.resume_modifications);
        const assets = await persistAssets(job, job.cover_letter || "", mods, templateId);
        if (!assets.resumePdfPath) {
            throw new Error(
                assets.pdfError ||
                    "PDF rendering failed. Run `npx playwright install chromium` and retry."
            );
        }

        const candidateName = String(loadMasterResume().fullName || "Candidate").replace(/[^\w.-]+/g, "_");
        const safeName = String(job.company_name || "Company").replace(/[^\w.-]+/g, "_");
        const filename = `${candidateName}_${safeName}_Resume.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "no-store");
        res.download(assets.resumePdfPath, filename);
    } catch (error) {
        console.error("[dashboard:resume.pdf]", error);
        res.status(500).type("html").send(
            `<!doctype html><p>Could not build the PDF: ${String(error.message)
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</p><p><a href="/jobs/${encodeURIComponent(req.params.id)}/resume-preview">Back to preview</a></p>`
        );
    }
});

router.post("/jobs/:id/generate-copy", async (req, res) => {
    const jobId = req.params.id;
    try {
        const db = getDb();
        const job = getJobById(jobId);
        if (!job) return res.redirect("/");

        const resume = loadMasterResume();
        let analysis = parseAnalysis(job.ai_analysis);
        if (!analysis || analysis.matchScore == null) {
            analysis = await scoreJob(job, resume);
            db.prepare(
                `
                UPDATE jobs
                SET match_score = @matchScore,
                    ai_analysis = @aiAnalysis
                WHERE id = @id
                `
            ).run({
                id: jobId,
                matchScore: Math.round(analysis.matchScore || 0),
                aiAnalysis: JSON.stringify(analysis)
            });
        }

        const tailored = await tailorApplication(job, resume, analysis);
        const existing = parseResumeMods(job.resume_modifications);
        const overwrite = String(req.body.overwrite || "") === "1";
        const resumeModifications = overwrite
            ? tailoredToMods(tailored, emptyMods())
            : {
                  ...existing,
                  resumeSummary: existing.resumeSummary || tailored.resumeSummary,
                  modifiedBullets: existing.modifiedBullets.length
                      ? existing.modifiedBullets
                      : tailored.modifiedBullets || [],
                  modifiedBulletsByRole: existing.modifiedBulletsByRole.length
                      ? existing.modifiedBulletsByRole
                      : tailored.modifiedBulletsByRole || [],
                  outreachEmail: existing.outreachEmail || tailored.outreachEmail,
                  linkedinOutreachNote:
                      existing.linkedinOutreachNote || String(tailored.linkedinOutreachNote || "").slice(0, 300),
                  linkedinOutreachCuriosity:
                      existing.linkedinOutreachCuriosity ||
                      String(tailored.linkedinOutreachCuriosity || "").slice(0, 300),
                  extraSkills: existing.extraSkills.length ? existing.extraSkills : tailored.extraSkills || [],
                  keywordsToEmphasize: existing.keywordsToEmphasize.length
                      ? existing.keywordsToEmphasize
                      : tailored.keywordsToEmphasize || []
              };

        db.prepare(
            `
            UPDATE jobs
            SET cover_letter = @coverLetter,
                resume_modifications = @resumeModifications,
                generated_resume_path = NULL
            WHERE id = @id
            `
        ).run({
            id: jobId,
            coverLetter: overwrite || !job.cover_letter ? tailored.coverLetter : job.cover_letter,
            resumeModifications: JSON.stringify(resumeModifications)
        });

        res.redirect(
            redirectTo(req, {
                job: jobId,
                success: "Generated cover letter, resume summary, bullets, email, and LinkedIn notes. Review, then download the PDF."
            })
        );
    } catch (error) {
        console.error("[dashboard:generate-copy]", error);
        res.redirect(redirectTo(req, { job: jobId, error: error.message }));
    }
});

router.post("/jobs/:id/applied", (req, res) => {
    try {
        const referral = String(req.body.referral_name || "").trim();
        getDb()
            .prepare(
                `
                UPDATE jobs
                SET status = 'APPLIED',
                    applied_at = CURRENT_TIMESTAMP,
                    follow_up_due = datetime('now', '+7 days'),
                    referral_name = @referral
                WHERE id = @id
                `
            )
            .run({ id: req.params.id, referral: referral || null });
        res.redirect(redirectTo(req, { panel: "tracker", job: req.params.id, success: "Marked applied. Follow-up in 7 days." }));
    } catch (error) {
        console.error("[dashboard:applied]", error);
        res.redirect(redirectTo(req, { job: req.params.id, error: error.message }));
    }
});

router.post("/settings/naukri-refresh", (req, res) => {
    try {
        if (String(req.body.confirmed_saved || "") !== "1") {
            return res.redirect(
                redirectTo(req, {
                    panel: "overview",
                    error: "Open Naukri, save your profile changes, then confirm the save before recording the refresh."
                })
            );
        }
        setSetting("naukriLastRefresh", new Date().toISOString());
        res.redirect(redirectTo(req, { panel: "overview", success: "Naukri profile save confirmed and refresh recorded." }));
    } catch (error) {
        res.redirect(redirectTo(req, { error: error.message }));
    }
});

function resumeLocals(extra = {}) {
    return {
        panel: "resume",
        counts: getCounts(),
        resume: extra.resume || loadResume(),
        gaps: extra.gaps || collectGapInsights(extra.resume || loadResume()),
        error: extra.error || null,
        success: extra.success || null
    };
}

router.get("/resume", (_req, res) => {
    try {
        res.render("resume", resumeLocals());
    } catch (error) {
        console.error("[dashboard:GET /resume]", error);
        res.status(500).render("resume", resumeLocals({ error: error.message, resume: {}, gaps: [] }));
    }
});

router.post("/resume", (req, res) => {
    try {
        const next = saveResume(resumeFromForm(req.body));
        let message = "Master resume saved. New ingest/scoring runs will use it.";
        if (req.body.requeueDiscarded) {
            const n = requeueForRescoring();
            message += ` Requeued ${n} Close/Discarded job(s) as Pending.`;
        }
        res.render("resume", resumeLocals({ resume: next, success: message }));
    } catch (error) {
        console.error("[dashboard:POST /resume]", error);
        res.status(400).render(
            "resume",
            resumeLocals({
                resume: resumeFromForm(req.body),
                error: error.message
            })
        );
    }
});

router.get("/api/jobs", (req, res) => {
    try {
        res.json({ panel: panelFromReq(req), jobs: getJobsForPanel(panelFromReq(req), jobListFilters(req)), counts: getCounts() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/api/jobs/:id", (req, res) => {
    try {
        const job = getJobById(req.params.id);
        if (!job) {
            return res.status(404).json({ error: "Not found" });
        }
        res.json({
            job,
            outreach: getOutreach(job.id),
            mods: parseResumeMods(job.resume_modifications),
            analysis: parseAnalysis(job.ai_analysis)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
