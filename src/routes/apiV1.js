import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/environment.js";
import { CONNECTED_JOBS_POLICY } from "../config/connectedJobsPolicy.js";
import { getDb } from "../database/connection.js";
import { requestIdentity, localSessionSummary } from "../middleware/requestIdentity.js";
import {
    getAutoApplySettings,
    getCandidateProfile,
    LOCAL_USER_ID,
    saveCandidateProfile
} from "../repositories/copilotRepository.js";
import {
    extractCandidateSearchPatch,
    getCandidateSearchProfile,
    saveCandidateSearchProfile
} from "../repositories/candidateSearchProfileRepository.js";
import { applicationMetrics, createOrResetApplication, getJobForApplication, listApplications } from "../repositories/applicationRepository.js";
import { listAttentionItems } from "../repositories/attentionRepository.js";
import { updateJobUserState } from "../repositories/jobUserStateRepository.js";
import { applySupportForJob } from "../services/applySupport.js";
import { buildCandidateResumeProfile, PARSER_VERSION, parsedResumeProfile } from "../services/candidateProfileBuilder.js";
import { applicationReadinessSummary, listAttentionGaps, resolveAttentionGap, seedCanonicalFieldCatalog } from "../services/applicationSchemaRegistry.js";
import { jobPlatform } from "../services/jobPlatform.js";
import { evaluateHeuristicMatch, recentJobCorpus } from "../services/heuristicMatcher.js";
import { currentCandidateMatchingProfile, matchBlockingReason } from "../services/currentCandidateMatching.js";
import {
    candidateJobFeedStatus,
    ensureCandidateJobFeed,
    getCandidateJobDetail,
    listCandidateJobFeed,
    listSavedCandidateJobs
} from "../services/candidateJobFeed.js";
import { onboardingState, updateOnboardingState } from "../services/onboarding.js";
import { inspectPdfBuffer } from "../services/pdfGenerator.js";
import { loadResume } from "../services/resumeStore.js";
import {
    assertJobCanApply,
    AVAILABILITY_RESULTS,
    claimAvailabilityVerification,
    publicJobLifecycle,
    submitAvailabilityFeedback
} from "../services/jobLifecycle.js";
import {
    mergeCanonical,
    remapSemanticMapping,
    semanticLearningDiagnostics,
    setCanonicalStatus,
    setSemanticMappingStatus
} from "../repositories/fieldSemanticRepository.js";
import { getFeatureFlag, setFeatureFlag } from "../repositories/featureFlagRepository.js";
import { normalizedValueSchema } from "../contracts/normalizedValue.js";
import { fieldSemanticResultSchema } from "../contracts/fieldSemanticResult.js";
import { answerPolicyDiagnostics, listActiveAnswerPolicies } from "../services/answerPolicyRegistry.js";
import { answerContextDiagnostics } from "../services/answerContextNormalization.js";
import { candidateAnswerPolicyParityReport } from "../services/candidateAnswerPolicyParity.js";
import {
    candidateTruthDiagnostics,
    listCandidateAnswerVersions,
    resolveCandidateTruthBatch,
    saveCandidateAnswerVersion
} from "../repositories/candidateAnswerVersionRepository.js";
import { buildFieldAnswerContracts, FIELD_ANSWER_CONTRACT_MODE } from "../services/fieldAnswerContractService.js";
import {
    applyLegacyCandidateTruthMigration,
    legacyCandidateTruthMigrationDiagnostics,
    previewLegacyCandidateTruthMigration
} from "../services/candidateAnswerLegacyMigrationService.js";
import {
    candidateAnswerResolverConfig,
    candidateAnswerResolverDiagnostics,
    setCandidateAnswerResolverMode
} from "../services/candidateAnswerResolver.js";
import {
    candidateAnswerChangeSetHistory,
    commitCandidateAnswerChangeSet
} from "../services/candidateAnswerChangeSetService.js";
import {
    candidateAnswerChangeSetDiagnostics,
    getCandidateAnswerChangeSet
} from "../repositories/candidateAnswerChangeSetRepository.js";
import {
    candidateAnswerReversalHistory,
    restoreCandidateAnswerVersion,
    undoCandidateAnswerChangeSet
} from "../services/candidateAnswerReversalService.js";
import { candidateAnswerReversalDiagnostics } from "../repositories/candidateAnswerReversalRepository.js";
import { scopedLearningDiagnostics } from "../services/scopedCandidateAnswerLearning.js";
import {
    commitPendingCandidateAnswerReviews,
    discardPendingCandidateAnswerReviews,
    listPendingCandidateAnswerReviews,
    runtimeReviewCheckpointId
} from "../services/candidateAnswerRuntimeProposalService.js";
import { classifyAttemptAtCheckpoint, recordCheckpointReceipt } from "../services/fieldRevisionService.js";

const router = Router();
router.use(requestIdentity);

const text = (max = 200) => z.string().trim().max(max);
const stringList = (max = 12) => z.array(text(120)).max(max).default([]);
const optionalStringList = (max = 12) => z.array(text(120)).max(max).optional();
const optionalNumber = z.union([z.number(), z.string()]).optional().nullable().transform((value) => {
    if (value === "" || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
});
const canonicalStatusSchema = z.object({ status: z.enum(["PROPOSED", "VALIDATED", "TRUSTED", "REJECTED"]) });
const semanticMappingStatusSchema = z.object({ status: z.enum(["CANDIDATE", "VALIDATED", "TRUSTED", "QUARANTINED", "REJECTED"]) });
const semanticMappingRemapSchema = z.object({ canonicalFieldKey: text(140) });
const canonicalMergeSchema = z.object({ sourceKey: text(140), targetKey: text(140) });
const canonicalFeatureFlagSchema = z.object({
    key: z.enum(["canonical.semantic-search", "canonical.ai-fallback", "canonical.new-proposals"]),
    enabled: z.boolean()
});
const answerContextSchema = z.object({
    applicationId: text(160).optional(), applicationContentRevisionId: text(160).optional(),
    employerGroupId: text(160).optional(), companyId: text(160).optional(),
    companyName: text(240).optional(), companyDomain: text(240).optional(),
    countryCode: text(20).optional(), country: text(120).optional(),
    roleFamily: text(120).optional(), roleTitle: text(240).optional(),
    location: text(240).optional(), employmentType: text(80).optional()
}).strict().default({});
const candidateTruthResolveSchema = z.object({
    canonicalKeys: z.array(text(140)).min(1).max(100),
    context: answerContextSchema
}).strict();
const candidateAnswerReviewSelectionSchema = z.object({
    proposalIds: z.array(text(180)).min(1).max(50)
}).strict();
const fieldAnswerOptionSchema = z.union([
    text(240),
    z.object({
        value: text(240).optional(), key: text(240).optional(),
        label: text(240).optional(), text: text(240).optional(), disabled: z.boolean().optional()
    }).strict()
]);
const fieldAnswerContractBatchSchema = z.object({
    context: answerContextSchema,
    fields: z.array(z.object({
        fieldId: text(160),
        semantic: fieldSemanticResultSchema,
        control: z.object({
            type: text(40).default("text"),
            options: z.array(fieldAnswerOptionSchema).max(100).default([]),
            minLength: z.number().int().min(0).max(12_000).nullable().default(null),
            maxLength: z.number().int().min(0).max(12_000).nullable().default(null),
            min: z.number().finite().nullable().default(null),
            max: z.number().finite().nullable().default(null),
            step: z.number().finite().positive().nullable().default(null),
            pattern: text(240).default("")
        }).strict().default({})
    }).strict()).min(1).max(100)
}).strict();
const candidateTruthWriteSchema = z.object({
    normalizedValue: normalizedValueSchema,
    context: answerContextSchema,
    scopeQualifiers: z.record(z.string(), text(240)).default({}),
    expectedActiveVersionId: text(160).nullable().default(null),
    source: z.enum(["PROFILE", "VERIFIED_RESUME", "DERIVED", "USER_ENTERED", "EXPLICIT_SAVE", "APPROVED_MEMORY"]).default("EXPLICIT_SAVE"),
    sourceVersionId: text(160).nullable().default(null),
    confirmedAt: z.string().datetime().optional(),
    candidateApproved: z.literal(true)
}).strict();

const intentSchema = z.object({
    currentTitle: text(120).optional().default(""),
    targetRoles: stringList(8).refine((items) => items.length > 0, "Choose at least one target role."),
    primaryCoreStacks: optionalStringList(12),
    acceptableCoreStacks: optionalStringList(20),
    totalExperienceYears: optionalNumber,
    currentCompany: text(160).optional().default("")
});

const manualProfileSchema = z.object({
    name: text(160),
    email: z.string().trim().email(),
    phone: text(30).optional().default(""),
    currentTitle: text(120).optional().default(""),
    currentCompany: text(160).optional().default(""),
    totalExperienceYears: optionalNumber,
    skills: stringList(30).refine((items) => items.length > 0, "Add at least one core skill."),
    linkedinUrl: text(500).optional().default(""),
    githubUrl: text(500).optional().default("")
});

const searchSchema = z.object({
    preferredLocations: stringList(12).refine((items) => items.length > 0, "Choose at least one location."),
    preferredWorkModes: stringList(4).refine((items) => items.length > 0, "Choose at least one work mode."),
    employmentTypes: stringList(4).default(["Full-time"]),
    minimumSalary: optionalNumber,
    excludedSkills: stringList(20),
    excludedCompanies: stringList(20),
    dealBreakers: stringList(12),
    compensationConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    locationConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    workModeConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    employmentTypeConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    countryCode: z.string().trim().length(2).optional(),
    workAuthorization: z.enum(["UNKNOWN", "AUTHORIZED_IN_MARKET", "NOT_AUTHORIZED"]).optional(),
    sponsorshipNeed: z.enum(["UNKNOWN", "REQUIRED", "NOT_REQUIRED"]).optional(),
    relocationPreference: z.enum(["UNKNOWN", "WILLING", "NOT_WILLING"]).optional(),
    experienceTolerance: z.object({
        smallGapYears: z.number().min(0).max(5),
        maxPlausibleGapYears: z.number().min(0).max(10),
        allowNearbySeniority: z.boolean()
    }).optional()
});

const profileUpdateSchema = z.object({
    name: text(160).optional(),
    email: z.string().trim().email().optional(),
    phone: text(30).optional(),
    currentTitle: text(120).optional(),
    currentCompany: text(160).optional(),
    totalExperienceYears: optionalNumber.optional(),
    targetRoles: stringList(8).optional(),
    preferredLocations: stringList(12).optional(),
    preferredWorkModes: stringList(4).optional(),
    employmentTypes: stringList(4).optional(),
    minimumSalary: optionalNumber.optional(),
    skills: stringList(30).optional(),
    excludedSkills: stringList(20).optional(),
    dealBreakers: stringList(12).optional(),
    linkedinUrl: text(500).optional(),
    githubUrl: text(500).optional(),
    primaryCoreStacks: optionalStringList(12),
    acceptableCoreStacks: optionalStringList(20),
    adjacentCareerTracks: optionalStringList(20),
    desiredSeniorityLevels: optionalStringList(10),
    preferredSkills: optionalStringList(30),
    excludedCompanies: optionalStringList(20),
    compensationConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    locationConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    workModeConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    employmentTypeConstraintMode: z.enum(["SOFT", "HARD"]).optional(),
    countryCode: z.string().trim().length(2).optional(),
    searchCountryCode: z.string().trim().length(2).optional(),
    workAuthorization: z.enum(["UNKNOWN", "AUTHORIZED_IN_MARKET", "NOT_AUTHORIZED"]).optional(),
    sponsorshipNeed: z.enum(["UNKNOWN", "REQUIRED", "NOT_REQUIRED"]).optional(),
    relocationPreference: z.enum(["UNKNOWN", "WILLING", "NOT_WILLING"]).optional(),
    experienceTolerance: z.object({
        smallGapYears: z.number().min(0).max(5),
        maxPlausibleGapYears: z.number().min(0).max(10),
        allowNearbySeniority: z.boolean()
    }).optional()
}).strict();

const jobStateSchema = z.object({
    seen: z.boolean().optional(),
    saved: z.boolean().optional(),
    dismissed: z.boolean().optional()
}).strict().refine((value) => value.seen !== undefined || value.saved !== undefined || value.dismissed !== undefined,
    "Choose a job state to update.");

const availabilityFeedbackSchema = z.object({
    requestId: z.string().uuid(),
    result: z.enum(AVAILABILITY_RESULTS),
    // Closure evidence is not trusted from a general browser client. Explicit
    // ATS/HTTP evidence enters through the server-side verification path.
    evidenceCode: z.enum(["NONE", "APPLY_CONTROL_AVAILABLE"]).optional().default("NONE"),
    httpStatus: z.number().int().min(100).max(599).optional().nullable(),
    pageHost: text(253).optional().default("")
}).strict();

const resumeDirectory = path.join(env.paths.storage, "resumes");
fs.mkdirSync(resumeDirectory, { recursive: true });
const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, resumeDirectory),
        filename: (_req, _file, callback) => callback(null, `master_${Date.now()}_${crypto.randomUUID()}.pdf`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, file.mimetype === "application/pdf")
});

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === "object") return value;
    try { return JSON.parse(value) || fallback; } catch { return fallback; }
}

function ageLabel(value) {
    if (!value) return "Recently";
    const date = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z"));
    if (Number.isNaN(date.getTime())) return "Recently";
    const hours = Math.max(1, Math.round((Date.now() - date.getTime()) / 3600000));
    if (hours < 24) return `${hours}h`;
    return `${Math.max(1, Math.round(hours / 24))}d`;
}

function salaryLabel(job) {
    const min = Number(job.ctc_min_lpa);
    const max = Number(job.ctc_max_lpa);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) return `₹${min}–${max} LPA`;
    if (Number.isFinite(min) && min > 0) return `₹${min}+ LPA`;
    if (Number.isFinite(max) && max > 0) return `Up to ₹${max} LPA`;
    return "Compensation not listed";
}

function stringArray(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") {
        const parsed = parseJson(value, null);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    }
    return [];
}

function signalLabels(value) {
    return (Array.isArray(value) ? value : []).map((item) => typeof item === "string" ? item : item?.label)
        .map((item) => String(item || "").trim()).filter(Boolean);
}

function rankedSignalLabels(value, priorities) {
    const rank = new Map(priorities.map((name, index) => [name, index]));
    return (Array.isArray(value) ? [...value] : [])
        .sort((left, right) => (rank.get(left?.dimension) ?? 99) - (rank.get(right?.dimension) ?? 99))
        .map((item) => item?.label).filter(Boolean);
}

function publicSignal(item) {
    if (!item || typeof item !== "object") return null;
    return {
        code: String(item.code || ""),
        dimension: String(item.dimension || "other"),
        label: String(item.label || ""),
        evidence: {
            candidate: item.evidence?.candidate ?? null,
            job: item.evidence?.job ?? null
        }
    };
}

function jobActionability(job, now = new Date()) {
    const deadline = job.explicit_deadline ? new Date(job.explicit_deadline).getTime() : NaN;
    if (Number.isFinite(deadline) && deadline <= now.getTime()) {
        return { status: "EXPIRED", canApply: false, discoveryEligible: false,
            reason: "The employer's stated application deadline has passed." };
    }
    if (job.lifecycle_status === "CLOSED") {
        return { status: "CLOSED", canApply: false, discoveryEligible: false,
            reason: "The employer listing is confirmed closed." };
    }
    const posted = job.posted_at || job.created_at;
    const postedAt = posted ? new Date(String(posted).replace(" ", "T") + (String(posted).includes("T") ? "" : "Z")).getTime() : NaN;
    const ageDays = Number.isFinite(postedAt) ? Math.max(0, (now.getTime() - postedAt) / 86400000) : null;
    const discoveryEligible = ageDays == null || ageDays <= CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays;
    return {
        status: discoveryEligible ? "OPEN" : "AGED_OUT",
        canApply: true,
        discoveryEligible,
        reason: discoveryEligible ? null : "Older than your 14-day discovery window; saved for your records."
    };
}

function jobFitReasons(job, breakdown, analysis) {
    const candidates = [
        ...signalLabels(breakdown.reasons),
        ...stringArray(breakdown.matchedSkills).slice(0, 2).map((skill) => `${skill} appears in your verified profile`),
        ...stringArray(analysis.strengths),
        ...stringArray(analysis.matchReasons)
    ].map((item) => String(item).trim()).filter(Boolean);
    if (!candidates.length) {
        if (job.career_track) candidates.push(`${String(job.career_track).replaceAll("_", " ")} role alignment`);
        if (job.location_label || job.location) candidates.push(`Matches your ${job.location_label || job.location} location search`);
        if (Number(job.yoe_min) > 0) candidates.push(`Requires ${job.yoe_min}+ years of experience`);
    }
    return [...new Set(candidates)].slice(0, 3);
}

function jobGapReasons(breakdown, analysis) {
    return [...new Set([
        ...stringArray(breakdown.missingRequiredSkills),
        ...signalLabels(breakdown.gaps),
        ...signalLabels(analysis.gaps),
        ...stringArray(analysis.missingSkills)
    ].map(String).filter(Boolean))].slice(0, 3);
}

function applicationSchemaSummary(job) {
    if (!job.application_schema_id) return { available: false, freshness: null, observedAt: null, fieldCount: 0, requiredFieldCount: 0 };
    const observedAt = job.application_schema_last_seen_at || null;
    const observedMs = observedAt ? new Date(`${String(observedAt).replace(" ", "T")}Z`).getTime() : NaN;
    const ageDays = Number.isFinite(observedMs) ? (Date.now() - observedMs) / 86400000 : 0;
    return {
        available: true,
        freshness: ageDays >= env.applicationSchema.freshDays ? "RECENT" : "FRESH",
        observedAt,
        fieldCount: Number(job.application_schema_field_count || 0),
        requiredFieldCount: Number(job.application_schema_required_count || 0)
    };
}

function publicJob(job, { includeAi = false, decision = null } = {}) {
    const breakdown = decision?.breakdown || parseJson(job.matching_breakdown_json);
    // Free responses use deterministic evidence only. Stored AI analysis is
    // never presented as a Free-plan explanation or computed on this request.
    const analysis = includeAi ? parseJson(job.ai_analysis) : {};
    const score = Number(decision?.matchScore ?? job.match_score ?? job.pre_score ?? 0);
    const evidenceCoverage = Number(decision?.confidence ?? (includeAi ? job.scoring_confidence : 0) ?? 0);
    const dimensions = decision?.dimensions || breakdown.dimensions || {};
    const reasons = (decision?.reasons || breakdown.reasons || []).map(publicSignal).filter(Boolean);
    const gaps = (decision?.gaps || breakdown.gaps || []).map(publicSignal).filter(Boolean);
    const unknowns = (decision?.unknowns || breakdown.unknowns || []).map(publicSignal).filter(Boolean);
    const platform = jobPlatform(job);
    const support = applySupportForJob(job);
    return {
        id: job.id,
        company: job.company_name || "Company",
        logo: String(job.company_name || "C").slice(0, 1).toUpperCase(),
        role: job.title,
        location: job.location_label || job.location || "India",
        salary: salaryLabel(job),
        matchScore: score >= 0 ? score : null,
        fit: score >= 88 && evidenceCoverage >= 0.72 ? "STRONG_FIT" : score >= 72 ? "POSSIBLE_FIT" : "REVIEW_CAREFULLY",
        fitReasons: decision ? rankedSignalLabels(decision.reasons,
            ["skills", "experience", "role", "location", "workMode", "compensation", "employmentType", "seniority", "freshness"]).slice(0, 3)
            : jobFitReasons(job, breakdown, analysis),
        gaps: decision ? rankedSignalLabels(decision.gaps,
            ["skills", "experience", "role", "seniority", "location", "workMode", "compensation", "employmentType"]).slice(0, 3)
            : jobGapReasons(breakdown, analysis),
        unknowns: decision ? signalLabels(decision.unknowns).slice(0, 3) : signalLabels(breakdown.unknowns).slice(0, 3),
        skills: [...new Set([...(decision?.matchedSkills || []), ...stringArray(breakdown.matchedSkills), ...stringArray(analysis.matchedSkills)])].slice(0, 5),
        source: platform?.label || job.source,
        support: support ? { mode: support.mode, label: support.label, reason: support.reason } : null,
        fresh: ageLabel(job.posted_at || job.created_at),
        postedAt: job.posted_at || job.created_at,
        url: job.url,
        status: job.status,
        saved: Boolean(job.candidate_saved),
        dismissed: Boolean(job.candidate_dismissed),
        personalState: {
            seen: Boolean(job.candidate_seen),
            saved: Boolean(job.candidate_saved),
            dismissed: Boolean(job.candidate_dismissed),
            hasMaterialUpdate: Boolean(job.candidate_seen_match_version)
                && Number(job.candidate_seen_match_version) < Number(job.match_version || 1),
            currentMatchVersion: Number(job.match_version || 1),
            seenMatchVersion: job.candidate_seen_match_version == null ? null : Number(job.candidate_seen_match_version),
            savedMatchVersion: job.candidate_saved_match_version == null ? null : Number(job.candidate_saved_match_version),
            dismissedMatchVersion: job.candidate_dismissed_match_version == null ? null : Number(job.candidate_dismissed_match_version),
            seenAt: job.candidate_seen_at || null,
            savedAt: job.candidate_saved_at || null,
            dismissedAt: job.candidate_dismissed_at || null
        },
        actionability: jobActionability(job),
        applicationSchema: applicationSchemaSummary(job),
        availability: publicJobLifecycle(job),
        whyThisJob: {
            scoringMethod: decision?.scoringMethod || (includeAi ? (job.scoring_method || "HEURISTIC") : "MATCHING_POLICY_V1"),
            evidenceCoverage,
            hardRequirementsFirst: true,
            eligibility: decision?.eligibility?.status || "ELIGIBLE",
            versions: decision?.versions || breakdown.versions || null,
            dimensions: Object.entries(dimensions).map(([name, value]) => ({
                name,
                score: Number(value?.score || 0),
                status: String(value?.status || "UNKNOWN"),
                codes: Array.isArray(value?.codes) ? value.codes.map(String) : []
            })),
            evidence: { reasons, gaps, unknowns }
        }
    };
}

function publicFeedPage({ limit = 20, cursor = null, userId = LOCAL_USER_ID } = {}) {
    const result = listCandidateJobFeed({ limit, cursor, userId });
    return {
        jobs: result.jobs.map(({ job, decision }) => publicJob(job, { decision })),
        page: result.page,
        feed: result.feed
    };
}

function publicApplication(application) {
    const status = String(application.status || "QUEUED");
    const stage = status === "SUCCESS" ? "Submitted"
        : status === "READY_TO_SUBMIT" ? "Ready to review"
            : ["WAITING_FOR_USER", "USER_ACTION_REQUIRED", "UNKNOWN_FIELD", "CAPTCHA_REQUIRED", "LOGIN_REQUIRED"].includes(status) ? "Needs you"
                : ["FAILED", "BLOCKED", "PORTAL_CHANGED"].includes(status) ? "Recovery needed" : "Preparing";
    const actionability = jobActionability(application);
    return {
        id: application.id,
        jobId: application.job_id,
        company: application.company_name || "Company",
        role: application.title,
        url: application.job_url || null,
        stage,
        status,
        matchScore: application.match_score,
        pendingQuestions: Number(application.pending_questions || 0),
        startedAt: application.started_at,
        submittedAt: application.submitted_at,
        updatedAt: application.updated_at,
        actionability,
        nextAction: stage === "Submitted" ? "Await employer update"
            : !actionability.canApply ? `${actionability.status === "EXPIRED" ? "Deadline passed" : "Listing closed"}; history retained`
            : stage === "Ready to review" ? "Review on the employer form"
                : stage === "Needs you" ? "Resolve the paused field"
                    : stage === "Recovery needed" ? "Open recovery details" : "Continue with Copilot"
    };
}

function dashboardPayload(userId = LOCAL_USER_ID) {
    const jobPage = publicFeedPage({ limit: 20, userId });
    const jobs = jobPage.jobs;
    const savedJobs = listSavedCandidateJobs({ userId, limit: 100 })
        .map(({ job, decision }) => publicJob(job, { decision }));
    const applications = listApplications().map(publicApplication);
    const blockers = listAttentionItems({ status: "OPEN" });
    const gaps = listAttentionGaps(userId);
    const metrics = applicationMetrics();
    return {
        jobs,
        savedJobs,
        jobFeed: { ...jobPage.feed, page: jobPage.page },
        applications,
        attention: { blockers, gaps, count: blockers.length + gaps.length },
        readiness: applicationReadinessSummary(userId),
        metrics: {
            newMatches: jobPage.page.total,
            readyToApply: jobs.filter((job) => job.fit === "STRONG_FIT").length,
            inProgress: applications.filter((item) => item.stage !== "Submitted").length,
            submitted: applications.filter((item) => item.stage === "Submitted").length,
            ...metrics
        }
    };
}

router.get("/session", (req, res) => {
    const profile = getCandidateProfile();
    res.json({ ...localSessionSummary(req), user: { name: profile.name, email: profile.email },
        onboarding: { complete: onboardingState(req.user.id).complete } });
});

router.get("/bootstrap", (req, res) => {
    seedCanonicalFieldCatalog();
    res.json({
        session: localSessionSummary(req),
        onboarding: onboardingState(req.user.id),
        profile: getCandidateProfile(),
        searchProfile: getCandidateSearchProfile(req.user.id),
        workspace: dashboardPayload(req.user.id),
        plan: { id: "FREE", trial: { status: "AVAILABLE", days: 7, cardRequired: false, startsOnFirstProAction: true } }
    });
});

router.get("/onboarding", (req, res) => res.json(onboardingState(req.user.id)));

router.put("/onboarding/intent", (req, res, next) => {
    try {
        const input = intentSchema.parse(req.body);
        saveCandidateProfile({
            currentTitle: input.currentTitle,
            totalExperienceYears: input.totalExperienceYears,
            currentCompany: input.currentCompany
        });
        saveCandidateSearchProfile({
            targetRoles: input.targetRoles,
            primaryCoreStacks: input.primaryCoreStacks,
            acceptableCoreStacks: input.acceptableCoreStacks
        }, req.user.id, { source: "ONBOARDING_INTENT" });
        res.json(updateOnboardingState({ intentReviewed: true,
            status: "INTENT_SAVED", lastStep: "resume" }, req.user.id));
    } catch (error) { next(error); }
});

router.post("/onboarding/resume", upload.single("resume"), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: "Choose a PDF resume up to 10 MB." });
    try {
        const buffer = fs.readFileSync(req.file.path);
        const diagnostics = await inspectPdfBuffer(buffer);
        const parserText = diagnostics.layoutText || diagnostics.plainText;
        const parsedProfile = buildCandidateResumeProfile({ text: parserText, existingResume: loadResume() });
        const id = crypto.randomUUID();
        getDb().prepare(`INSERT INTO resume_versions
            (id, user_id, type, file_path, text_content, parsed_profile_json, parser_version, parse_confidence)
            VALUES (?, ?, 'MASTER', ?, ?, ?, ?, ?)`)
            .run(id, req.user.id, req.file.path, parserText, JSON.stringify(parsedProfile), PARSER_VERSION, parsedProfile.confidence);
        updateOnboardingState({
            resumeUploaded: true,
            resumeSkipped: false,
            resumeProfileReviewed: false,
            manualProfileReviewed: false,
            status: "RESUME_REVIEW",
            lastStep: "verify"
        }, req.user.id);
        res.status(201).json({
            id,
            fileName: req.file.originalname,
            pageCount: diagnostics.pageCount,
            profilePreview: parsedProfile,
            parseConfidence: parsedProfile.confidence,
            requiresConfirmation: true
        });
    } catch (error) { next(error); }
});

router.post("/onboarding/resume/:id/confirm", (req, res, next) => {
    try {
        const row = getDb().prepare(`SELECT * FROM resume_versions WHERE id = ? AND user_id = ? AND type = 'MASTER'`)
            .get(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ error: "Resume version not found." });
        const parsed = parsedResumeProfile(row);
        if (!parsed) throw new Error("The resume profile could not be loaded. Upload it again.");
        const override = req.body?.profile || {};
        // A resume is evidence about the candidate's past; it must never silently
        // replace the job intent they chose in Step 1.
        saveCandidateProfile({
            name: override.name ?? parsed.contact?.fullName,
            email: override.email ?? parsed.contact?.email,
            phone: override.phone ?? parsed.contact?.phone,
            currentLocation: override.currentLocation ?? parsed.contact?.location,
            linkedinUrl: override.linkedinUrl ?? parsed.contact?.linkedin,
            githubUrl: override.githubUrl ?? parsed.contact?.github,
            portfolioUrl: override.portfolioUrl ?? parsed.contact?.portfolio,
            currentCompany: override.currentCompany ?? parsed.career?.currentCompany,
            currentTitle: override.currentTitle ?? parsed.career?.currentTitle,
            totalExperienceYears: override.totalExperienceYears ?? parsed.career?.totalExperienceYears,
            skills: override.skills ?? parsed.skills,
            preferredSkills: override.preferredSkills ?? undefined
        });
        getDb().prepare("UPDATE resume_versions SET candidate_confirmed = 1 WHERE id = ? AND user_id = ?").run(row.id, req.user.id);
        res.json(updateOnboardingState({
            resumeProfileReviewed: true,
            resumeSkipped: false,
            manualProfileReviewed: false,
            status: "PROFILE_VERIFIED",
            lastStep: "search"
        }, req.user.id));
    } catch (error) { next(error); }
});

router.post("/onboarding/resume/skip", (req, res) => {
    res.json(updateOnboardingState({
        resumeSkipped: true,
        resumeProfileReviewed: false,
        manualProfileReviewed: false,
        status: "MANUAL_PROFILE",
        lastStep: "verify"
    }, req.user.id));
});

router.put("/onboarding/manual-profile", (req, res, next) => {
    try {
        const input = manualProfileSchema.parse(req.body);
        saveCandidateProfile(input);
        res.json(updateOnboardingState({ resumeSkipped: true, resumeProfileReviewed: false,
            manualProfileReviewed: true,
            status: "PROFILE_VERIFIED", lastStep: "search" }, req.user.id));
    } catch (error) { next(error); }
});

router.put("/onboarding/search", (req, res, next) => {
    try {
        const input = searchSchema.parse(req.body);
        saveCandidateSearchProfile(input, req.user.id, { source: "ONBOARDING_SEARCH" });
        res.json(updateOnboardingState({ searchReviewed: true,
            status: "SEARCH_READY", lastStep: "value" }, req.user.id));
    } catch (error) { next(error); }
});

router.post("/onboarding/complete", async (req, res, next) => {
    try {
        const state = onboardingState(req.user.id);
        if (!state.searchReadiness.ready || state.steps.some((step) => !step.complete)) {
            const nextLabel = state.next?.label;
            return res.status(409).json({
                code: "ONBOARDING_INCOMPLETE",
                error: nextLabel
                    ? `Finish “${nextLabel}” before finding your first matches.`
                    : "Complete the required onboarding steps before finding your first matches.",
                onboarding: state
            });
        }
        const onboarding = updateOnboardingState({ status: "ACTIVE", lastStep: "value", valueShown: true }, req.user.id);
        await ensureCandidateJobFeed(req.user.id, { force: true });
        res.json({ onboarding, ...publicFeedPage({ limit: 6, userId: req.user.id }) });
    } catch (error) { next(error); }
});

router.get("/dashboard", (req, res) => res.json(dashboardPayload(req.user.id)));
router.get("/jobs", (req, res, next) => {
    try { res.json(publicFeedPage({ limit: req.query.limit, cursor: req.query.cursor, userId: req.user.id })); }
    catch (error) { next(error); }
});
router.get("/jobs/feed", (req, res, next) => {
    try { res.json(publicFeedPage({ limit: req.query.limit, cursor: req.query.cursor, userId: req.user.id })); }
    catch (error) { next(error); }
});
router.get("/jobs/feed/status", (req, res, next) => {
    try { res.json({ feed: candidateJobFeedStatus(req.user.id) }); }
    catch (error) { next(error); }
});
router.post("/jobs/feed/rebuild", async (req, res, next) => {
    try {
        const onboarding = onboardingState(req.user.id);
        if (!onboarding.complete) {
            return res.status(409).json({ code: "ONBOARDING_INCOMPLETE",
                error: "Complete onboarding before building your job shortlist." });
        }
        await ensureCandidateJobFeed(req.user.id, { force: true });
        res.json(publicFeedPage({ limit: req.body?.limit || 20, userId: req.user.id }));
    } catch (error) { next(error); }
});
router.get("/jobs/saved", (req, res, next) => {
    try {
        const jobs = listSavedCandidateJobs({ userId: req.user.id, limit: req.query.limit })
            .map(({ job, decision }) => publicJob(job, { decision }));
        res.json({ jobs, count: jobs.length });
    } catch (error) { next(error); }
});
router.get("/jobs/:id", (req, res, next) => {
    try {
        const result = getCandidateJobDetail(req.params.id, { userId: req.user.id });
        if (!result) return res.status(404).json({ error: "Job not found." });
        res.json({ job: publicJob(result.job, { decision: result.decision }) });
    } catch (error) { next(error); }
});
router.put("/jobs/:id/state", (req, res, next) => {
    try {
        const input = jobStateSchema.parse(req.body);
        const state = updateJobUserState(req.params.id, input, req.user.id);
        if (!state) return res.status(404).json({ error: "Job not found." });
        res.json({ jobId: req.params.id, state });
    } catch (error) { next(error); }
});
router.post("/jobs/:id/availability-verification/claim", (req, res, next) => {
    try {
        const prompt = claimAvailabilityVerification(req.params.id, req.user.id);
        res.json({ prompt });
    } catch (error) { next(error); }
});
router.post("/jobs/:id/availability-feedback", (req, res, next) => {
    try {
        const input = availabilityFeedbackSchema.parse(req.body);
        const availability = submitAvailabilityFeedback(req.params.id, req.user.id, input);
        res.json({ jobId: req.params.id, availability });
    } catch (error) { next(error); }
});
router.post("/jobs/:id/applications", (req, res, next) => {
    try {
        const job = getJobForApplication(req.params.id);
        if (!job || job.status === "ARCHIVED") return res.status(404).json({ error: "A reviewable job was not found." });
        try {
            assertJobCanApply(job);
        } catch (error) {
            if (error.code === "JOB_CLOSED") {
                return res.status(409).json({ code: error.code, error: error.message,
                    availability: publicJobLifecycle(job) });
            }
            throw error;
        }
        const decision = evaluateHeuristicMatch(job, loadResume(), currentCandidateMatchingProfile(req.user.id), {
            context: "APPLICATION",
            saved: true,
            corpus: recentJobCorpus(getDb())
        });
        if (decision.eligibility.status === "INELIGIBLE") {
            return res.status(409).json({
                code: "JOB_INELIGIBLE",
                error: matchBlockingReason(decision),
                decision
            });
        }
        const application = createOrResetApplication(job, getAutoApplySettings(), { adapter: "EXTENSION" });
        updateJobUserState(job.id, { seen: true }, req.user.id);
        res.status(201).json({ application: publicApplication({ ...application, title: job.title,
            company_name: job.company_name, job_url: job.url, pending_questions: 0 }) });
    } catch (error) { next(error); }
});
router.get("/applications", (_req, res) => res.json({ applications: listApplications().map(publicApplication) }));
router.get("/attention", (req, res) => res.json({
    blockers: listAttentionItems({ status: "OPEN" }),
    gaps: listAttentionGaps(req.user.id),
    readiness: applicationReadinessSummary(req.user.id)
}));
router.post("/attention/gaps/:key/resolve", (req, res, next) => {
    try { res.json(resolveAttentionGap(req.params.key, req.body?.value, req.user.id)); }
    catch (error) { next(error); }
});
router.get("/profile", (req, res) => res.json({ profile: getCandidateProfile(),
    searchProfile: getCandidateSearchProfile(req.user.id), settings: getAutoApplySettings() }));
router.put("/profile", async (req, res, next) => {
    try {
        const input = profileUpdateSchema.parse(req.body);
        const previousSearchProfile = getCandidateSearchProfile(req.user.id);
        const searchPatch = extractCandidateSearchPatch(input);
        const evidencePatch = Object.fromEntries(Object.entries(input)
            .filter(([key]) => !Object.hasOwn(searchPatch, key)));
        if (Object.keys(evidencePatch).length) saveCandidateProfile(evidencePatch);
        const searchProfile = Object.keys(searchPatch).length
            ? saveCandidateSearchProfile(searchPatch, req.user.id, { source: "PROFILE_SETTINGS" })
            : getCandidateSearchProfile(req.user.id);
        const matchingEvidenceChanged = Object.keys(evidencePatch)
            .some((key) => ["currentTitle", "totalExperienceYears", "skills"].includes(key));
        if (onboardingState(req.user.id).complete
            && (matchingEvidenceChanged || searchProfile.profileVersion !== previousSearchProfile.profileVersion)) {
            await ensureCandidateJobFeed(req.user.id, { force: true });
        }
        res.json({ profile: getCandidateProfile(), searchProfile });
    } catch (error) { next(error); }
});

// Candidate-private, append-only truth API. These routes are explicit user
// actions; browser correction events cannot call the write path implicitly.
router.get("/candidate-truth/policies", (req, res, next) => {
    try {
        const keys = String(req.query.keys || "").split(",").map((key) => key.trim()).filter(Boolean).slice(0, 100);
        res.json({ policies: listActiveAnswerPolicies(keys.length ? keys : null) });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/resolve", (req, res, next) => {
    try {
        const input = candidateTruthResolveSchema.parse(req.body);
        res.json({ results: resolveCandidateTruthBatch({ userId: req.user.id,
            canonicalKeys: input.canonicalKeys, context: input.context }) });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/field-answer-contracts", (req, res, next) => {
    try {
        const input = fieldAnswerContractBatchSchema.parse(req.body);
        res.json({
            mode: FIELD_ANSWER_CONTRACT_MODE,
            resolver: candidateAnswerResolverConfig(),
            productionApplied: false,
            results: buildFieldAnswerContracts({
                userId: req.user.id,
                fields: input.fields,
                context: input.context
            })
        });
    } catch (error) { next(error); }
});
router.get("/candidate-truth/history", (req, res, next) => {
    try {
        const canonicalKey = req.query.canonicalKey ? String(req.query.canonicalKey) : null;
        res.json({ versions: listCandidateAnswerVersions(req.user.id, { canonicalKey, includeInactive: true }) });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/:canonicalKey/versions", (req, res, next) => {
    try {
        const input = candidateTruthWriteSchema.parse(req.body);
        const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
        const version = saveCandidateAnswerVersion({
            userId: req.user.id,
            canonicalKey: req.params.canonicalKey,
            normalizedValue: input.normalizedValue,
            context: input.context,
            scopeQualifiers: input.scopeQualifiers,
            source: input.source,
            sourceVersionId: input.sourceVersionId,
            expectedActiveVersionId: input.expectedActiveVersionId,
            idempotencyKey,
            confirmedAt: input.confirmedAt,
            candidateApproved: input.candidateApproved
        });
        res.status(version.idempotentReplay ? 200 : 201).json({ version });
    } catch (error) { next(error); }
});
router.get("/candidate-truth/change-sets/history", (req, res, next) => {
    try {
        res.json({ changeSets: candidateAnswerChangeSetHistory(req.user.id, { limit: Number(req.query.limit || 20) }) });
    } catch (error) { next(error); }
});
router.get("/candidate-truth/reversals/history", (req, res, next) => {
    try {
        res.json({ reversals: candidateAnswerReversalHistory(req.user.id, { limit: Number(req.query.limit || 20) }) });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/change-sets", (req, res, next) => {
    try {
        const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
        const changeSet = commitCandidateAnswerChangeSet({
            userId: req.user.id,
            idempotencyKey,
            input: req.body
        });
        res.status(changeSet.idempotentReplay ? 200 : changeSet.id ? 201 : 200).json({ changeSet });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/change-sets/:changeSetId/undo", (req, res, next) => {
    try {
        const reversal = undoCandidateAnswerChangeSet({
            userId: req.user.id,
            changeSetId: req.params.changeSetId,
            idempotencyKey: String(req.get("Idempotency-Key") || "").trim()
        });
        res.status(reversal.idempotentReplay || reversal.alreadyReversed ? 200 : 201).json({ reversal });
    } catch (error) { next(error); }
});
router.get("/candidate-truth/pending-review", (req, res, next) => {
    try {
        res.json({ groups: listPendingCandidateAnswerReviews(req.user.id, { limit: Number(req.query.limit || 100) }) });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/pending-review/save", (req, res, next) => {
    try {
        const input = candidateAnswerReviewSelectionSchema.parse(req.body);
        const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(idempotencyKey)) {
            const error = new Error("A bounded Idempotency-Key is required.");
            error.status = 400;
            throw error;
        }
        const replayReceipt = getDb().prepare(`SELECT change_set_id FROM candidate_answer_change_set_receipts
            WHERE user_id = ? AND idempotency_key = ?`).get(req.user.id, idempotencyKey);
        if (replayReceipt) {
            return res.json({ changeSet: { ...getCandidateAnswerChangeSet(req.user.id, replayReceipt.change_set_id),
                idempotentReplay: true } });
        }
        const groups = listPendingCandidateAnswerReviews(req.user.id, { limit: 500 });
        const selected = groups.flatMap((group) => group.proposals.map((proposal) => ({ group, proposal })))
            .filter(({ proposal }) => input.proposalIds.includes(proposal.id));
        if (selected.length !== input.proposalIds.length) {
            const error = new Error("One or more review items are no longer available.");
            error.status = 409;
            throw error;
        }
        const groupKeys = new Set(selected.map(({ group }) => `${group.applicationId}:${group.runId}`));
        if (groupKeys.size !== 1) {
            const error = new Error("Save one application’s review items at a time.");
            error.status = 400;
            throw error;
        }
        const { applicationId, runId } = selected[0].group;
        const checkpointId = runtimeReviewCheckpointId(`${req.user.id}:${idempotencyKey}`);
        const checkpoint = {
            schemaVersion: 1,
            checkpointId,
            runId,
            applicationId,
            applicationContentRevisionId: null,
            type: "EXPLICIT_SAVE",
            status: "VERIFIED",
            source: "CANDIDATE_GESTURE",
            observedAtMs: Date.now(),
            evidenceHash: crypto.createHash("sha256").update(`explicit-save|${req.user.id}|${checkpointId}`).digest("hex"),
            valueFree: true
        };
        recordCheckpointReceipt(applicationId, checkpoint);
        classifyAttemptAtCheckpoint(applicationId, checkpoint, {
            adaptiveEvidenceShadow: getFeatureFlag("adaptive_evidence.shadow", false).enabled
        });
        const changeSet = commitPendingCandidateAnswerReviews({
            userId: req.user.id,
            applicationId,
            runId,
            checkpointId,
            proposalIds: input.proposalIds,
            idempotencyKey
        });
        res.status(changeSet.idempotentReplay ? 200 : changeSet.id ? 201 : 200).json({ changeSet });
    } catch (error) { next(error); }
});
router.post("/candidate-truth/pending-review/discard", (req, res, next) => {
    try {
        const input = candidateAnswerReviewSelectionSchema.parse(req.body);
        res.json(discardPendingCandidateAnswerReviews(req.user.id, input.proposalIds));
    } catch (error) { next(error); }
});
router.post("/candidate-truth/versions/:versionId/restore", (req, res, next) => {
    try {
        const reversal = restoreCandidateAnswerVersion({
            userId: req.user.id,
            versionId: req.params.versionId,
            idempotencyKey: String(req.get("Idempotency-Key") || "").trim(),
            input: req.body
        });
        res.status(reversal.idempotentReplay ? 200 : 201).json({ reversal });
    } catch (error) { next(error); }
});

// Local operator boundary. In Supabase mode these routes remain unavailable
// until requestIdentity is replaced with role-verified authentication.
router.get("/admin/candidate-answer-policies", (_req, res, next) => {
    try {
        res.json({
            policies: answerPolicyDiagnostics(),
            policyRows: listActiveAnswerPolicies(),
            contexts: answerContextDiagnostics(),
            truth: candidateTruthDiagnostics(),
            migration: legacyCandidateTruthMigrationDiagnostics(LOCAL_USER_ID),
            parity: candidateAnswerPolicyParityReport(),
            resolver: candidateAnswerResolverDiagnostics(),
            changeSets: candidateAnswerChangeSetDiagnostics(),
            reversals: candidateAnswerReversalDiagnostics(),
            scopedLearning: scopedLearningDiagnostics(),
            changeSetFlag: getFeatureFlag("candidate-answer-intelligence.change-sets", false),
            featureFlag: getFeatureFlag("candidate-answer-intelligence.parity", false)
        });
    } catch (error) { next(error); }
});
router.post("/admin/candidate-answer-policies/legacy-migration/preview", (req, res, next) => {
    try {
        res.json({ migration: previewLegacyCandidateTruthMigration({ userId: req.user.id }) });
    } catch (error) { next(error); }
});
router.post("/admin/candidate-answer-policies/legacy-migration/apply", (req, res, next) => {
    try {
        res.json({ migration: applyLegacyCandidateTruthMigration({
            userId: req.user.id,
            initiatedBy: "ADMIN"
        }) });
    } catch (error) { next(error); }
});
router.put("/admin/candidate-answer-policies/parity", (req, res, next) => {
    try {
        const input = z.object({ enabled: z.boolean() }).strict().parse(req.body);
        setFeatureFlag({ key: "candidate-answer-intelligence.parity",
            enabled: input.enabled, scope: "global" });
        res.json({ resolver: setCandidateAnswerResolverMode({
            mode: input.enabled ? "SHADOW_COMPARE" : "LEGACY_ONLY",
            changedBy: "LOCAL_ADMIN_COMPATIBILITY_TOGGLE"
        }) });
    } catch (error) { next(error); }
});
router.put("/admin/candidate-answer-policies/resolver-mode", (req, res, next) => {
    try {
        const input = z.object({
            mode: z.enum(["LEGACY_ONLY", "SHADOW_COMPARE", "CANARY", "VERSIONED_PRIMARY"]),
            canaryPercent: z.number().int().min(1).max(10).optional()
        }).strict().parse(req.body);
        res.json({ resolver: setCandidateAnswerResolverMode({
            mode: input.mode,
            canaryPercent: input.canaryPercent,
            changedBy: "LOCAL_ADMIN"
        }) });
    } catch (error) { next(error); }
});
router.put("/admin/candidate-answer-policies/change-sets", (req, res, next) => {
    try {
        const input = z.object({ enabled: z.boolean() }).strict().parse(req.body);
        res.json({ flag: setFeatureFlag({
            key: "candidate-answer-intelligence.change-sets",
            enabled: input.enabled,
            scope: "global",
            payload: {
                mode: input.enabled ? "AUTO_LOW_RISK" : "SHADOW",
                reasonCodes: [input.enabled ? "ADMIN_ENABLED_LOW_RISK_CHECKPOINT_COMMITS" : "ADMIN_DISABLED_AUTOMATIC_COMMITS"]
            }
        }) });
    } catch (error) { next(error); }
});
router.get("/admin/field-semantics", (_req, res, next) => {
    try {
        const canonicalFlags = [
            ["canonical.semantic-search", env.canonicalization.semanticSearchEnabled],
            ["canonical.ai-fallback", env.canonicalization.aiEnabled],
            ["canonical.new-proposals", env.canonicalization.newProposalsEnabled]
        ].map(([key, fallback]) => getFeatureFlag(key, fallback));
        res.json({
            ...semanticLearningDiagnostics(),
            featureFlags: canonicalFlags
        });
    }
    catch (error) { next(error); }
});
router.put("/admin/field-semantics/canonicals/:key/status", (req, res, next) => {
    try {
        const input = canonicalStatusSchema.parse(req.body);
        res.json({ canonical: setCanonicalStatus(req.params.key, input.status) });
    } catch (error) { next(error); }
});
router.put("/admin/field-semantics/mappings/:id/status", (req, res, next) => {
    try {
        const input = semanticMappingStatusSchema.parse(req.body);
        res.json({ mapping: setSemanticMappingStatus(req.params.id, input.status) });
    } catch (error) { next(error); }
});
router.put("/admin/field-semantics/mappings/:id/canonical", (req, res, next) => {
    try {
        const input = semanticMappingRemapSchema.parse(req.body);
        res.json({ mapping: remapSemanticMapping(req.params.id, input.canonicalFieldKey) });
    } catch (error) { next(error); }
});
router.post("/admin/field-semantics/merge", (req, res, next) => {
    try {
        const input = canonicalMergeSchema.parse(req.body);
        res.json(mergeCanonical(input.sourceKey, input.targetKey));
    } catch (error) { next(error); }
});
router.put("/admin/field-semantics/feature-flag", (req, res, next) => {
    try {
        const input = canonicalFeatureFlagSchema.parse(req.body);
        res.json({ flag: setFeatureFlag({ key: input.key, enabled: input.enabled, scope: "global" }) });
    } catch (error) { next(error); }
});

router.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues[0]?.message || "Check the highlighted fields.", issues: error.issues });
    }
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Resume must be 10 MB or smaller." : error.message });
    }
    console.error("[api:v1]", error);
    res.status(Number(error.status || 400)).json({ code: error.code || undefined, error: error.message || "Request failed." });
});

export default router;
