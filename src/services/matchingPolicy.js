import { CONNECTED_JOBS_POLICY, MATCH_DECISION_CONTRACT } from "../config/connectedJobsPolicy.js";
import { candidateExperienceYears, extractMinimumExperienceYears } from "./experienceEligibility.js";
import { evaluateJobRequirements } from "./jobRequirementModel.js";
import { normalizeJobForRegistry } from "./jobNormalizer.js";
import { classifyJobTitle } from "./roleTaxonomy.js";
import { canonicalSkill, extractKnownSkills } from "./skillOntology.js";
import { scoringTerms } from "./resumeStore.js";

export const MATCHING_POLICY_ALGORITHM_VERSION = "matching-policy-v1.3";

export const MATCH_REASON_CODES = Object.freeze({
    FRESH_JOB: "FRESH_JOB",
    RECENT_JOB: "RECENT_JOB",
    ROLE_FAMILY_MATCH: "ROLE_FAMILY_MATCH",
    ROLE_TRACK_MATCH: "ROLE_TRACK_MATCH",
    ADJACENT_TRACK_ACCEPTED: "ADJACENT_TRACK_ACCEPTED",
    PRIMARY_STACK_MATCH: "PRIMARY_STACK_MATCH",
    ACCEPTABLE_STACK_MATCH: "ACCEPTABLE_STACK_MATCH",
    REQUIRED_SKILLS_MATCH: "REQUIRED_SKILLS_MATCH",
    EXPERIENCE_MEETS_MINIMUM: "EXPERIENCE_MEETS_MINIMUM",
    LOCATION_MATCH: "LOCATION_MATCH",
    WORK_MODE_MATCH: "WORK_MODE_MATCH",
    COMPENSATION_MEETS_MINIMUM: "COMPENSATION_MEETS_MINIMUM",
    EMPLOYMENT_TYPE_MATCH: "EMPLOYMENT_TYPE_MATCH",
    SENIORITY_MATCH: "SENIORITY_MATCH",
    SPONSORSHIP_COMPATIBLE: "SPONSORSHIP_COMPATIBLE"
});

export const MATCH_GAP_CODES = Object.freeze({
    DIFFERENT_ROLE_TRACK: "DIFFERENT_ROLE_TRACK",
    ACCEPTABLE_STACK_NOT_PRIMARY: "ACCEPTABLE_STACK_NOT_PRIMARY",
    MISSING_REQUIRED_SKILL: "MISSING_REQUIRED_SKILL",
    MISSING_SECONDARY_SKILL: "MISSING_SECONDARY_SKILL",
    SMALL_EXPERIENCE_GAP: "SMALL_EXPERIENCE_GAP",
    LARGE_EXPERIENCE_GAP: "LARGE_EXPERIENCE_GAP",
    LOCATION_PREFERENCE_MISMATCH: "LOCATION_PREFERENCE_MISMATCH",
    WORK_MODE_PREFERENCE_MISMATCH: "WORK_MODE_PREFERENCE_MISMATCH",
    COMPENSATION_BELOW_PREFERENCE: "COMPENSATION_BELOW_PREFERENCE",
    EMPLOYMENT_TYPE_PREFERENCE_MISMATCH: "EMPLOYMENT_TYPE_PREFERENCE_MISMATCH",
    NEARBY_SENIORITY: "NEARBY_SENIORITY"
});

export const MATCH_EXCLUSION_CODES = Object.freeze({
    JOB_CLOSED: "JOB_CLOSED",
    JOB_OUTSIDE_DISCOVERY_WINDOW: "JOB_OUTSIDE_DISCOVERY_WINDOW",
    UNRELATED_ROLE_FAMILY: "UNRELATED_ROLE_FAMILY",
    UNACCEPTED_PRIMARY_STACK: "UNACCEPTED_PRIMARY_STACK",
    EXCLUDED_SKILL_REQUIRED: "EXCLUDED_SKILL_REQUIRED",
    EXPERIENCE_GAP_TOO_LARGE: "EXPERIENCE_GAP_TOO_LARGE",
    LOCATION_HARD_CONFLICT: "LOCATION_HARD_CONFLICT",
    WORK_MODE_HARD_CONFLICT: "WORK_MODE_HARD_CONFLICT",
    COMPENSATION_HARD_CONFLICT: "COMPENSATION_HARD_CONFLICT",
    EMPLOYMENT_TYPE_HARD_CONFLICT: "EMPLOYMENT_TYPE_HARD_CONFLICT",
    REMOTE_COUNTRY_CONFLICT: "REMOTE_COUNTRY_CONFLICT",
    SPONSORSHIP_CONFLICT: "SPONSORSHIP_CONFLICT",
    WORK_AUTHORIZATION_CONFLICT: "WORK_AUTHORIZATION_CONFLICT",
    RELOCATION_CONFLICT: "RELOCATION_CONFLICT",
    EXCLUDED_COMPANY: "EXCLUDED_COMPANY",
    NIGHT_SHIFT_CONFLICT: "NIGHT_SHIFT_CONFLICT",
    EMPLOYMENT_BOND_CONFLICT: "EMPLOYMENT_BOND_CONFLICT",
    HEAVY_TRAVEL_CONFLICT: "HEAVY_TRAVEL_CONFLICT",
    SIX_DAY_WEEK_CONFLICT: "SIX_DAY_WEEK_CONFLICT",
    INTERNSHIP_CONFLICT: "INTERNSHIP_CONFLICT",
    STAFFING_AGENCY_CONFLICT: "STAFFING_AGENCY_CONFLICT",
    SENIORITY_OUTSIDE_RANGE: "SENIORITY_OUTSIDE_RANGE",
    UNSUPPORTED_LEADERSHIP_LEVEL: "UNSUPPORTED_LEADERSHIP_LEVEL"
});

export const MATCH_UNKNOWN_CODES = Object.freeze({
    POSTED_DATE_UNKNOWN: "POSTED_DATE_UNKNOWN",
    ROLE_CLASSIFICATION_UNKNOWN: "ROLE_CLASSIFICATION_UNKNOWN",
    PRIMARY_STACK_UNKNOWN: "PRIMARY_STACK_UNKNOWN",
    EXPERIENCE_REQUIREMENT_UNKNOWN: "EXPERIENCE_REQUIREMENT_UNKNOWN",
    CANDIDATE_EXPERIENCE_UNKNOWN: "CANDIDATE_EXPERIENCE_UNKNOWN",
    LOCATION_UNKNOWN: "LOCATION_UNKNOWN",
    WORK_MODE_UNKNOWN: "WORK_MODE_UNKNOWN",
    COMPENSATION_UNKNOWN: "COMPENSATION_UNKNOWN",
    EMPLOYMENT_TYPE_UNKNOWN: "EMPLOYMENT_TYPE_UNKNOWN",
    SENIORITY_UNKNOWN: "SENIORITY_UNKNOWN",
    SPONSORSHIP_POLICY_UNKNOWN: "SPONSORSHIP_POLICY_UNKNOWN",
    WORK_AUTHORIZATION_UNKNOWN: "WORK_AUTHORIZATION_UNKNOWN"
});

const DIMENSION_WEIGHTS = Object.freeze({
    role: 20,
    skills: 30,
    experience: 15,
    location: 8,
    workMode: 7,
    compensation: 8,
    employmentType: 5,
    seniority: 7
});

const SENIORITY_RANK = Object.freeze({ INTERN: 0, JUNIOR: 1, MID: 2, SENIOR: 3, LEAD: 4, MANAGER: 4, STAFF: 5, PRINCIPAL: 6, DIRECTOR: 7 });
const LEADERSHIP_MINIMUM_YEARS = Object.freeze({ LEAD: 6, MANAGER: 6, STAFF: 8, PRINCIPAL: 10, DIRECTOR: 10 });

function clamp(value, minimum = 0, maximum = 100) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function list(value) {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
        // Treat ordinary strings as comma-separated profile input.
    }
    return String(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function upper(value = "") {
    return String(value || "").trim().toUpperCase().replace(/[ -]+/g, "_");
}

function normalizedText(value = "") {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function asConstraint(value, fallback = "SOFT") {
    return upper(value) === "HARD" ? "HARD" : fallback;
}

function workMode(value) {
    const text = upper(value);
    if (["REMOTE", "WFH", "WORK_FROM_HOME"].includes(text)) return "REMOTE";
    if (text === "HYBRID") return "HYBRID";
    if (["OFFICE", "WFO", "ONSITE", "ON_SITE", "LOCATION_BOUND"].includes(text)) return "OFFICE";
    return "UNKNOWN";
}

function employmentType(value) {
    const text = upper(value);
    if (["FULL_TIME", "FULLTIME"].includes(text)) return "FULL_TIME";
    if (["CONTRACT", "CONTRACTOR", "FREELANCE"].includes(text)) return "CONTRACT";
    if (["PART_TIME", "PARTTIME"].includes(text)) return "PART_TIME";
    if (["INTERN", "INTERNSHIP"].includes(text)) return "INTERNSHIP";
    if (["TEMPORARY", "FIXED_TERM"].includes(text)) return "TEMPORARY";
    return "UNKNOWN";
}

function canonicalDealBreaker(value) {
    const text = upper(value).replace(/^NO_/, "");
    const aliases = {
        NIGHT_SHIFTS: "NIGHT_SHIFT",
        MANDATORY_RELOCATION: "MANDATORY_RELOCATION",
        EMPLOYMENT_BOND: "EMPLOYMENT_BOND",
        BOND: "EMPLOYMENT_BOND",
        HEAVY_TRAVEL: "HEAVY_TRAVEL",
        "6_DAY_WEEK": "SIX_DAY_WEEK",
        SIX_DAY_WEEK: "SIX_DAY_WEEK",
        INTERNSHIPS: "INTERNSHIP",
        INTERNSHIP: "INTERNSHIP",
        STAFFING_AGENCIES: "STAFFING_AGENCY",
        STAFFING_AGENCY: "STAFFING_AGENCY"
    };
    return aliases[text] || text;
}

function careerFamilies(profile) {
    const supplied = list(profile.careerFamilies?.length ? profile.careerFamilies : profile.careerProfiles).map(upper);
    if (supplied.length) return [...new Set(supplied)];
    return [...new Set(list(profile.targetRoles).map((role) => classifyJobTitle(role).family).filter(Boolean))];
}

function canonicalProfile(profile = {}) {
    const tolerance = profile.experienceTolerance || {};
    const smallGapYears = Math.max(0, Math.min(5, Number(tolerance.smallGapYears ?? 1) || 0));
    const rawAuthorization = upper(profile.workAuthorization || "UNKNOWN");
    const rawSponsorship = upper(profile.sponsorshipNeed || profile.sponsorshipRequired || "UNKNOWN");
    const rawRelocation = upper(profile.relocationPreference || (profile.willingToRelocate ? "WILLING" : "UNKNOWN"));
    return {
        profileVersion: Number(profile.profileVersion || profile.searchProfileVersion || 1),
        targetRoles: list(profile.targetRoles),
        careerFamilies: careerFamilies(profile),
        primaryCoreStacks: list(profile.primaryCoreStacks),
        acceptableCoreStacks: list(profile.acceptableCoreStacks),
        adjacentCareerTracks: list(profile.adjacentCareerTracks).map(upper),
        desiredSeniorityLevels: list(profile.desiredSeniorityLevels).map(upper),
        preferredSkills: list(profile.preferredSkills),
        excludedSkills: list(profile.excludedSkills),
        preferredLocations: list(profile.preferredLocations),
        preferredWorkModes: list(profile.preferredWorkModes).map(workMode).filter((value) => value !== "UNKNOWN"),
        employmentTypes: list(profile.employmentTypes).map(employmentType).filter((value) => value !== "UNKNOWN"),
        minimumSalary: profile.minimumSalary == null || profile.minimumSalary === "" ? null : Number(profile.minimumSalary),
        compensationConstraintMode: asConstraint(profile.compensationConstraintMode),
        locationConstraintMode: asConstraint(profile.locationConstraintMode),
        workModeConstraintMode: asConstraint(profile.workModeConstraintMode),
        employmentTypeConstraintMode: asConstraint(profile.employmentTypeConstraintMode),
        experienceTolerance: {
            smallGapYears,
            maxPlausibleGapYears: Math.max(smallGapYears, Math.min(10, Number(tolerance.maxPlausibleGapYears ?? 3) || 0)),
            allowNearbySeniority: tolerance.allowNearbySeniority !== false
        },
        excludedCompanies: list(profile.excludedCompanies),
        dealBreakers: new Set(list(profile.dealBreakers).map(canonicalDealBreaker)),
        countryCode: upper(profile.countryCode || profile.searchCountryCode || "IN").slice(0, 2),
        workAuthorization: ["AUTHORIZED_IN_MARKET", "AUTHORIZED", "YES", "TRUE"].includes(rawAuthorization) ? "AUTHORIZED_IN_MARKET"
            : ["NOT_AUTHORIZED", "NO", "FALSE"].includes(rawAuthorization) ? "NOT_AUTHORIZED" : "UNKNOWN",
        sponsorshipNeed: ["REQUIRED", "YES", "TRUE"].includes(rawSponsorship) ? "REQUIRED"
            : ["NOT_REQUIRED", "NO", "FALSE"].includes(rawSponsorship) ? "NOT_REQUIRED" : "UNKNOWN",
        relocationPreference: ["WILLING", "YES", "TRUE"].includes(rawRelocation) ? "WILLING"
            : ["NOT_WILLING", "NO", "FALSE"].includes(rawRelocation) ? "NOT_WILLING" : "UNKNOWN",
        totalExperienceYears: profile.totalExperienceYears,
        currentTitle: String(profile.currentTitle || "")
    };
}

function persistedFacet(job, snake, camel, inferred, unknown = "UNKNOWN") {
    const value = job[snake] ?? job[camel];
    const normalizedValue = upper(value);
    const missing = !value || normalizedValue === "UNKNOWN" || (unknown && normalizedValue === unknown);
    return missing ? inferred : value;
}

function canonicalJob(job = {}) {
    const inferred = normalizeJobForRegistry(job);
    return {
        family: persistedFacet(job, "career_family", "careerFamily", inferred.careerFamily, null),
        track: persistedFacet(job, "career_track", "careerTrack", inferred.careerTrack, null),
        employmentType: employmentType(persistedFacet(job, "employment_type", "employmentType", inferred.employmentType)),
        seniorityLevel: upper(persistedFacet(job, "seniority_level", "seniorityLevel", inferred.seniorityLevel)),
        countryCode: upper(persistedFacet(job, "country_code", "countryCode", inferred.countryCode, null)).slice(0, 2),
        remoteScope: upper(persistedFacet(job, "remote_scope", "remoteScope", inferred.remoteScope)),
        sponsorshipPolicy: upper(persistedFacet(job, "sponsorship_policy", "sponsorshipPolicy", inferred.sponsorshipPolicy)),
        relocationPolicy: upper(persistedFacet(job, "relocation_policy", "relocationPolicy", inferred.relocationPolicy)),
        travelRequirement: upper(persistedFacet(job, "travel_requirement", "travelRequirement", inferred.travelRequirement)),
        bondPolicy: upper(persistedFacet(job, "bond_policy", "bondPolicy", inferred.bondPolicy)),
        primaryStack: persistedFacet(job, "primary_stack", "primaryStack", inferred.primaryStack, null) || null,
        requiredSkills: list(job.required_skills_json ?? job.requiredSkills).length
            ? list(job.required_skills_json ?? job.requiredSkills) : inferred.requiredSkills,
        secondarySkills: list(job.secondary_skills_json ?? job.secondarySkills).length
            ? list(job.secondary_skills_json ?? job.secondarySkills) : inferred.secondarySkills,
        workMode: workMode(persistedFacet(job, "work_mode", "workMode", inferred.workMode)),
        yoeMin: job.yoe_min ?? job.yoeMin ?? inferred.yoeMin,
        ctcMinLpa: job.ctc_min_lpa ?? job.ctcMinLpa ?? inferred.ctcMinLpa,
        ctcMaxLpa: job.ctc_max_lpa ?? job.ctcMaxLpa ?? inferred.ctcMaxLpa,
        matchVersion: Number(job.match_version || job.matchVersion || 1)
    };
}

function signal(code, dimension, label, candidateEvidence = null, jobEvidence = null) {
    return { code, dimension, label, evidence: { candidate: candidateEvidence, job: jobEvidence } };
}

function tokens(value = "") {
    return normalizedText(value).replace(/c\+\+/g, "cplusplus").replace(/c#/g, "csharp")
        .match(/[a-z0-9+#.]{2,}/g) || [];
}

function tokenSimilarity(left, right) {
    const a = new Set(tokens(left));
    const b = new Set(tokens(right));
    if (!a.size || !b.size) return 0;
    const overlap = [...a].filter((value) => b.has(value)).length;
    return overlap / (a.size + b.size - overlap);
}

function stackSkills(values) {
    const skills = [];
    for (const value of values) {
        const known = extractKnownSkills(value);
        if (known.length) skills.push(...known);
        else skills.push(...String(value).split(/[+/|]/).map((item) => item.trim()).filter(Boolean));
    }
    return [...new Set(skills.map((skill) => canonicalSkill(skill).canonical).filter(Boolean))];
}

function containsCanonical(values, requested) {
    const wanted = canonicalSkill(requested).canonical.toLowerCase();
    return values.some((value) => canonicalSkill(value).canonical.toLowerCase() === wanted);
}

function seniorityFromTitle(title = "") {
    const text = normalizedText(title);
    if (/\b(?:director|head of|vp|vice president)\b/.test(text)) return "DIRECTOR";
    if (/\b(?:principal|distinguished)\b/.test(text)) return "PRINCIPAL";
    if (/\bstaff\b/.test(text)) return "STAFF";
    if (/\b(?:manager|engineering manager)\b/.test(text)) return "MANAGER";
    if (/\b(?:lead|tech lead|team lead|architect)\b/.test(text)) return "LEAD";
    if (/\b(?:senior|sr\.?|sde[ -]?(?:2|ii|3|iii))\b/.test(text)) return "SENIOR";
    if (/\b(?:junior|jr\.?|associate|entry[ -]?level|graduate|sde[ -]?(?:1|i))\b/.test(text)) return "JUNIOR";
    if (/\b(?:intern|trainee|apprentice)\b/.test(text)) return "INTERN";
    return "UNKNOWN";
}

function postedAgeDays(job, now) {
    const value = job.posted_at || job.postedAt || job.created_at || job.createdAt;
    if (!value) return null;
    const normalized = String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}Z`;
    const timestamp = new Date(normalized).getTime();
    return Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / 86400000) : null;
}

function explicitTextSignal(text, positive, negative) {
    return positive.test(text) && !(negative && negative.test(text));
}

function dimension(score, status, codes = []) {
    return { score: Math.round(clamp(score)), status, codes };
}

function deterministicExplanation(eligibility, reasons, gaps, unknowns) {
    if (eligibility.status === "INELIGIBLE") {
        return `Not eligible because ${eligibility.exclusions.slice(0, 2).map((item) => item.label.toLowerCase()).join(" and ")}.`;
    }
    const positive = reasons.slice(0, 3).map((item) => item.label).join("; ");
    const gap = gaps[0]?.label;
    const unknown = unknowns[0]?.label;
    return [positive || "No explicit hard conflict was found", gap ? `Gap: ${gap}.` : "", unknown ? `Unknown: ${unknown}.` : ""]
        .filter(Boolean).join(" ");
}

export function evaluateMatchingPolicy(job = {}, resume = {}, candidate = {}, {
    lexical = { score: 0, terms: [] },
    now = new Date(),
    context = "DISCOVERY",
    saved = false
} = {}) {
    const profile = canonicalProfile(candidate);
    const normalizedJob = canonicalJob(job);
    const text = normalizedText(`${job.title || ""}\n${job.description || ""}\n${job.location || ""}`);
    const company = String(job.company_name || job.company || "").trim();
    const reasons = [];
    const gaps = [];
    const unknowns = [];
    const exclusions = [];
    const dimensions = {};
    const exclude = (code, dimensionName, label, candidateEvidence, jobEvidence) => {
        const existing = exclusions.find((item) => item.code === code);
        if (existing) return existing;
        const item = signal(code, dimensionName, label, candidateEvidence, jobEvidence);
        exclusions.push(item);
        return item;
    };
    const addReason = (code, dimensionName, label, candidateEvidence, jobEvidence) => {
        const item = signal(code, dimensionName, label, candidateEvidence, jobEvidence);
        reasons.push(item);
        return item;
    };
    const addGap = (code, dimensionName, label, candidateEvidence, jobEvidence) => {
        const item = signal(code, dimensionName, label, candidateEvidence, jobEvidence);
        gaps.push(item);
        return item;
    };
    const addUnknown = (code, dimensionName, label, candidateEvidence = null, jobEvidence = null) => {
        const item = signal(code, dimensionName, label, candidateEvidence, jobEvidence);
        unknowns.push(item);
        return item;
    };

    const lifecycle = upper(job.lifecycle_status || job.lifecycleStatus);
    if (["CLOSED", "EXPIRED"].includes(lifecycle)) {
        exclude(MATCH_EXCLUSION_CODES.JOB_CLOSED, "freshness", "The employer listing is closed.", null, lifecycle);
    }
    const ageDays = postedAgeDays(job, now);
    if (context === "DISCOVERY" && !saved) {
        if (ageDays == null) addUnknown(MATCH_UNKNOWN_CODES.POSTED_DATE_UNKNOWN, "freshness", "Posting date is not available.");
        else if (ageDays > CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays) {
            exclude(MATCH_EXCLUSION_CODES.JOB_OUTSIDE_DISCOVERY_WINDOW, "freshness",
                `Posted more than ${CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays} days ago.`, null, Number(ageDays.toFixed(1)));
        } else if (ageDays <= CONNECTED_JOBS_POLICY.discovery.freshThroughDays) {
            addReason(MATCH_REASON_CODES.FRESH_JOB, "freshness", "Recently posted role.", null, Number(ageDays.toFixed(1)));
        } else addReason(MATCH_REASON_CODES.RECENT_JOB, "freshness", "Still inside the active discovery window.", null, Number(ageDays.toFixed(1)));
    }

    const excludedCompany = profile.excludedCompanies.find((value) => {
        const excluded = normalizedText(value);
        const actual = normalizedText(company);
        return excluded && actual && (actual === excluded || actual.includes(excluded));
    });
    if (excludedCompany) exclude(MATCH_EXCLUSION_CODES.EXCLUDED_COMPANY, "company", `${company} is excluded from your search.`, excludedCompany, company);

    const selectedFamilies = profile.careerFamilies;
    const targetClassifications = profile.targetRoles.map(classifyJobTitle).filter((item) => item.family);
    const targetTracks = [...new Set(targetClassifications.map((item) => item.track).filter(Boolean))];
    const roleSimilarity = Math.max(0, ...profile.targetRoles.map((role) => tokenSimilarity(role, job.title)));
    if (!normalizedJob.family) {
        addUnknown(MATCH_UNKNOWN_CODES.ROLE_CLASSIFICATION_UNKNOWN, "role", "Role family could not be classified.", selectedFamilies, job.title || null);
        // Unknown role evidence stays eligible, but it must not rank like a
        // verified target-role match.
        dimensions.role = dimension(35, "UNKNOWN", [MATCH_UNKNOWN_CODES.ROLE_CLASSIFICATION_UNKNOWN]);
    } else if (selectedFamilies.length && !selectedFamilies.includes(normalizedJob.family)) {
        if (profile.adjacentCareerTracks.includes(normalizedJob.track)) {
            addReason(MATCH_REASON_CODES.ADJACENT_TRACK_ACCEPTED, "role", "Role is in an adjacent track you selected.", profile.adjacentCareerTracks, normalizedJob.track);
            dimensions.role = dimension(55, "GAP", [MATCH_REASON_CODES.ADJACENT_TRACK_ACCEPTED]);
        } else {
            exclude(MATCH_EXCLUSION_CODES.UNRELATED_ROLE_FAMILY, "role", "Role is outside your selected career families.", selectedFamilies, normalizedJob.family);
            dimensions.role = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.UNRELATED_ROLE_FAMILY]);
        }
    } else {
        addReason(MATCH_REASON_CODES.ROLE_FAMILY_MATCH, "role", "Role family matches your search.", selectedFamilies, normalizedJob.family);
        if (targetTracks.includes(normalizedJob.track)) {
            addReason(MATCH_REASON_CODES.ROLE_TRACK_MATCH, "role", "Role track matches a target role.", targetTracks, normalizedJob.track);
            dimensions.role = dimension(85 + roleSimilarity * 15, "MATCH", [MATCH_REASON_CODES.ROLE_FAMILY_MATCH, MATCH_REASON_CODES.ROLE_TRACK_MATCH]);
        } else if (targetTracks.length) {
            addGap(MATCH_GAP_CODES.DIFFERENT_ROLE_TRACK, "role", "Same career family, but a different role track.", targetTracks, normalizedJob.track);
            dimensions.role = dimension(58 + roleSimilarity * 20, "GAP", [MATCH_GAP_CODES.DIFFERENT_ROLE_TRACK]);
        } else dimensions.role = dimension(80, "MATCH", [MATCH_REASON_CODES.ROLE_FAMILY_MATCH]);
    }

    const primaryChoices = stackSkills(profile.primaryCoreStacks);
    const acceptableChoices = stackSkills(profile.acceptableCoreStacks);
    if (!normalizedJob.primaryStack) {
        addUnknown(MATCH_UNKNOWN_CODES.PRIMARY_STACK_UNKNOWN, "skills", "Primary technology stack is not explicit in the posting.", [...primaryChoices, ...acceptableChoices]);
    } else if (primaryChoices.length || acceptableChoices.length) {
        if (containsCanonical(primaryChoices, normalizedJob.primaryStack)) {
            addReason(MATCH_REASON_CODES.PRIMARY_STACK_MATCH, "skills", `${normalizedJob.primaryStack} is in your primary stack.`, primaryChoices, normalizedJob.primaryStack);
        } else if (containsCanonical(acceptableChoices, normalizedJob.primaryStack)) {
            addReason(MATCH_REASON_CODES.ACCEPTABLE_STACK_MATCH, "skills", `${normalizedJob.primaryStack} is an acceptable alternative stack.`, acceptableChoices, normalizedJob.primaryStack);
            addGap(MATCH_GAP_CODES.ACCEPTABLE_STACK_NOT_PRIMARY, "skills", "The role uses an acceptable stack rather than your primary choice.", primaryChoices, normalizedJob.primaryStack);
        } else {
            exclude(MATCH_EXCLUSION_CODES.UNACCEPTED_PRIMARY_STACK, "skills", `${normalizedJob.primaryStack} is not in your primary or acceptable stacks.`, [...primaryChoices, ...acceptableChoices], normalizedJob.primaryStack);
        }
    }

    const explicitRequired = [...new Set([normalizedJob.primaryStack, ...normalizedJob.requiredSkills].filter(Boolean))];
    const excludedRequired = profile.excludedSkills.find((skill) => containsCanonical(explicitRequired, skill));
    if (excludedRequired) {
        exclude(MATCH_EXCLUSION_CODES.EXCLUDED_SKILL_REQUIRED, "skills", `${excludedRequired} is required by this role and excluded by you.`, excludedRequired, explicitRequired);
    }

    const candidateSkills = [...new Set([
        ...scoringTerms(resume),
        ...list(candidate.skills),
        ...Object.values(resume.skillGroups || {}).flat()
    ].filter(Boolean))];
    const skillEvaluation = evaluateJobRequirements(`${job.title || ""}\n${job.description || ""}`, candidateSkills);
    const requiredMissing = skillEvaluation.missing.filter((item) => item.importance === "REQUIRED");
    const secondaryMissing = skillEvaluation.missing.filter((item) => item.importance !== "REQUIRED");
    if (skillEvaluation.exact.length || skillEvaluation.transferable.length) {
        addReason(MATCH_REASON_CODES.REQUIRED_SKILLS_MATCH, "skills", "Verified skills satisfy part of the posting requirements.",
            [...skillEvaluation.exact, ...skillEvaluation.transferable].map((item) => item.evidence).filter(Boolean), skillEvaluation.requirements);
    }
    for (const item of requiredMissing.slice(0, 4)) {
        addGap(MATCH_GAP_CODES.MISSING_REQUIRED_SKILL, "skills", `${item.requirement} is a stated requirement without verified evidence.`, candidateSkills, item.requirement);
    }
    for (const item of secondaryMissing.slice(0, 3)) {
        addGap(MATCH_GAP_CODES.MISSING_SECONDARY_SKILL, "skills", `${item.requirement} appears in the posting but is not verified.`, candidateSkills, item.requirement);
    }
    const hasConfiguredStack = Boolean(primaryChoices.length || acceptableChoices.length);
    const stackScore = normalizedJob.primaryStack && hasConfiguredStack
        ? containsCanonical(primaryChoices, normalizedJob.primaryStack) ? 100
            : containsCanonical(acceptableChoices, normalizedJob.primaryStack) ? 78 : 0
        : hasConfiguredStack ? 50 : 100;
    const skillBase = skillEvaluation.requirements.length ? skillEvaluation.score : hasConfiguredStack ? 50 : 100;
    dimensions.skills = dimension((skillBase * 0.7) + (stackScore * 0.2) + (clamp(lexical.score) * 0.1),
        exclusions.some((item) => item.dimension === "skills") ? "CONFLICT"
            : gaps.some((item) => item.dimension === "skills") ? "GAP"
                : unknowns.some((item) => item.dimension === "skills") ? "UNKNOWN" : "MATCH",
        [...reasons, ...gaps, ...unknowns, ...exclusions]
            .filter((item) => item.dimension === "skills").map((item) => item.code));

    const explicitZeroExperience = /\b(?:no (?:prior )?experience (?:is )?required|freshers? (?:may|can) apply|0\+?\s*(?:years?|yrs?))\b/.test(text);
    const requiredYears = normalizedJob.yoeMin !== null && normalizedJob.yoeMin !== undefined && normalizedJob.yoeMin !== ""
        && Number.isFinite(Number(normalizedJob.yoeMin))
        && (Number(normalizedJob.yoeMin) > 0 || (Number(normalizedJob.yoeMin) === 0 && explicitZeroExperience))
        ? Number(normalizedJob.yoeMin) : extractMinimumExperienceYears(`${job.title || ""} ${job.description || ""}`);
    const candidateYears = candidateExperienceYears(profile, resume);
    let experienceCompatible = true;
    if (requiredYears == null) {
        addUnknown(MATCH_UNKNOWN_CODES.EXPERIENCE_REQUIREMENT_UNKNOWN, "experience", "Minimum experience is not stated.", candidateYears);
        dimensions.experience = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.EXPERIENCE_REQUIREMENT_UNKNOWN]);
    } else if (candidateYears == null) {
        addUnknown(MATCH_UNKNOWN_CODES.CANDIDATE_EXPERIENCE_UNKNOWN, "experience", "Your total experience is not confirmed.", null, requiredYears);
        dimensions.experience = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.CANDIDATE_EXPERIENCE_UNKNOWN]);
    } else if (candidateYears >= requiredYears) {
        const experienceLabel = requiredYears === 0
            ? "This role explicitly accepts candidates without prior experience."
            : `Your ${candidateYears} years meet the ${requiredYears}-year minimum.`;
        addReason(MATCH_REASON_CODES.EXPERIENCE_MEETS_MINIMUM, "experience", experienceLabel, candidateYears, requiredYears);
        dimensions.experience = dimension(100, "MATCH", [MATCH_REASON_CODES.EXPERIENCE_MEETS_MINIMUM]);
    } else {
        const difference = requiredYears - candidateYears;
        const displayedDifference = Number(difference.toFixed(1));
        if (difference <= profile.experienceTolerance.smallGapYears) {
            addGap(MATCH_GAP_CODES.SMALL_EXPERIENCE_GAP, "experience", `Experience is ${displayedDifference} year${displayedDifference === 1 ? "" : "s"} below the stated minimum.`, candidateYears, requiredYears);
            dimensions.experience = dimension(72, "GAP", [MATCH_GAP_CODES.SMALL_EXPERIENCE_GAP]);
        } else if (difference <= profile.experienceTolerance.maxPlausibleGapYears) {
            addGap(MATCH_GAP_CODES.LARGE_EXPERIENCE_GAP, "experience", `Experience is ${displayedDifference} years below the stated minimum.`, candidateYears, requiredYears);
            dimensions.experience = dimension(42, "GAP", [MATCH_GAP_CODES.LARGE_EXPERIENCE_GAP]);
        } else {
            experienceCompatible = false;
            exclude(MATCH_EXCLUSION_CODES.EXPERIENCE_GAP_TOO_LARGE, "experience", `The role requires ${requiredYears} years; you have ${candidateYears}.`, candidateYears, requiredYears);
            dimensions.experience = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.EXPERIENCE_GAP_TOO_LARGE]);
        }
    }

    const preferredModes = new Set(profile.preferredWorkModes);
    if (!preferredModes.size) dimensions.workMode = dimension(100, "NOT_CONFIGURED");
    else if (normalizedJob.workMode === "UNKNOWN") {
        addUnknown(MATCH_UNKNOWN_CODES.WORK_MODE_UNKNOWN, "workMode", "Work mode is not stated.", [...preferredModes]);
        dimensions.workMode = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.WORK_MODE_UNKNOWN]);
    } else if (preferredModes.has(normalizedJob.workMode)) {
        addReason(MATCH_REASON_CODES.WORK_MODE_MATCH, "workMode", "Work mode matches your preference.", [...preferredModes], normalizedJob.workMode);
        dimensions.workMode = dimension(100, "MATCH", [MATCH_REASON_CODES.WORK_MODE_MATCH]);
    } else if (profile.workModeConstraintMode === "HARD") {
        exclude(MATCH_EXCLUSION_CODES.WORK_MODE_HARD_CONFLICT, "workMode", "Work mode conflicts with a hard preference.", [...preferredModes], normalizedJob.workMode);
        dimensions.workMode = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.WORK_MODE_HARD_CONFLICT]);
    } else {
        addGap(MATCH_GAP_CODES.WORK_MODE_PREFERENCE_MISMATCH, "workMode", "Work mode differs from your preference.", [...preferredModes], normalizedJob.workMode);
        dimensions.workMode = dimension(42, "GAP", [MATCH_GAP_CODES.WORK_MODE_PREFERENCE_MISMATCH]);
    }

    const jobLocation = normalizedText(`${job.location_label || ""} ${job.location || ""}`);
    const preferredLocations = profile.preferredLocations.map(normalizedText).filter(Boolean);
    if ((normalizedJob.remoteScope === "RESTRICTED_OTHER" && profile.countryCode === "IN")
        || (normalizedJob.remoteScope === "INDIA_ONLY" && profile.countryCode !== "IN")) {
        exclude(MATCH_EXCLUSION_CODES.REMOTE_COUNTRY_CONFLICT, "location", "Remote geography is explicitly restricted to a different country.", profile.countryCode, normalizedJob.remoteScope);
        dimensions.location = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.REMOTE_COUNTRY_CONFLICT]);
    } else if (!preferredLocations.length) dimensions.location = dimension(100, "NOT_CONFIGURED");
    else if (!jobLocation || /not specified|location unknown/.test(jobLocation)) {
        addUnknown(MATCH_UNKNOWN_CODES.LOCATION_UNKNOWN, "location", "Job location is not stated.", preferredLocations);
        dimensions.location = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.LOCATION_UNKNOWN]);
    } else {
        const remoteAccepted = normalizedJob.workMode === "REMOTE" && preferredModes.has("REMOTE")
            && normalizedJob.remoteScope !== "RESTRICTED_OTHER";
        const locationMatched = remoteAccepted || preferredLocations.some((place) => jobLocation.includes(place)
            || (place.includes("india") && normalizedJob.countryCode === "IN"));
        if (locationMatched) {
            addReason(MATCH_REASON_CODES.LOCATION_MATCH, "location", "Location is compatible with your search.", preferredLocations, job.location || job.location_label);
            dimensions.location = dimension(100, "MATCH", [MATCH_REASON_CODES.LOCATION_MATCH]);
        } else if (profile.locationConstraintMode === "HARD") {
            exclude(MATCH_EXCLUSION_CODES.LOCATION_HARD_CONFLICT, "location", "Location conflicts with a hard preference.", preferredLocations, job.location || job.location_label);
            dimensions.location = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.LOCATION_HARD_CONFLICT]);
        } else {
            addGap(MATCH_GAP_CODES.LOCATION_PREFERENCE_MISMATCH, "location", "Location differs from your preference.", preferredLocations, job.location || job.location_label);
            dimensions.location = dimension(45, "GAP", [MATCH_GAP_CODES.LOCATION_PREFERENCE_MISMATCH]);
        }
    }

    const minimumSalary = Number(profile.minimumSalary);
    const listedMaximum = Number(normalizedJob.ctcMaxLpa ?? normalizedJob.ctcMinLpa);
    if (!Number.isFinite(minimumSalary) || minimumSalary <= 0) dimensions.compensation = dimension(100, "NOT_CONFIGURED");
    else if (!Number.isFinite(listedMaximum) || listedMaximum <= 0) {
        addUnknown(MATCH_UNKNOWN_CODES.COMPENSATION_UNKNOWN, "compensation", "Compensation is not disclosed.", minimumSalary);
        dimensions.compensation = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.COMPENSATION_UNKNOWN]);
    } else if (listedMaximum >= minimumSalary) {
        addReason(MATCH_REASON_CODES.COMPENSATION_MEETS_MINIMUM, "compensation", "Listed compensation meets your minimum.", minimumSalary, listedMaximum);
        dimensions.compensation = dimension(100, "MATCH", [MATCH_REASON_CODES.COMPENSATION_MEETS_MINIMUM]);
    } else if (profile.compensationConstraintMode === "HARD") {
        exclude(MATCH_EXCLUSION_CODES.COMPENSATION_HARD_CONFLICT, "compensation", "Listed maximum is below your hard minimum.", minimumSalary, listedMaximum);
        dimensions.compensation = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.COMPENSATION_HARD_CONFLICT]);
    } else {
        addGap(MATCH_GAP_CODES.COMPENSATION_BELOW_PREFERENCE, "compensation", "Listed maximum is below your preferred minimum.", minimumSalary, listedMaximum);
        dimensions.compensation = dimension(Math.max(35, (listedMaximum / minimumSalary) * 80), "GAP", [MATCH_GAP_CODES.COMPENSATION_BELOW_PREFERENCE]);
    }

    const employmentChoices = new Set(profile.employmentTypes);
    if (!employmentChoices.size) dimensions.employmentType = dimension(100, "NOT_CONFIGURED");
    else if (normalizedJob.employmentType === "UNKNOWN") {
        addUnknown(MATCH_UNKNOWN_CODES.EMPLOYMENT_TYPE_UNKNOWN, "employmentType", "Employment type is not stated.", [...employmentChoices]);
        dimensions.employmentType = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.EMPLOYMENT_TYPE_UNKNOWN]);
    } else if (employmentChoices.has(normalizedJob.employmentType)) {
        addReason(MATCH_REASON_CODES.EMPLOYMENT_TYPE_MATCH, "employmentType", "Employment type matches your preference.", [...employmentChoices], normalizedJob.employmentType);
        dimensions.employmentType = dimension(100, "MATCH", [MATCH_REASON_CODES.EMPLOYMENT_TYPE_MATCH]);
    } else if (profile.employmentTypeConstraintMode === "HARD") {
        exclude(MATCH_EXCLUSION_CODES.EMPLOYMENT_TYPE_HARD_CONFLICT, "employmentType", "Employment type conflicts with a hard preference.", [...employmentChoices], normalizedJob.employmentType);
        dimensions.employmentType = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.EMPLOYMENT_TYPE_HARD_CONFLICT]);
    } else {
        addGap(MATCH_GAP_CODES.EMPLOYMENT_TYPE_PREFERENCE_MISMATCH, "employmentType", "Employment type differs from your preference.", [...employmentChoices], normalizedJob.employmentType);
        dimensions.employmentType = dimension(55, "GAP", [MATCH_GAP_CODES.EMPLOYMENT_TYPE_PREFERENCE_MISMATCH]);
    }

    const jobSeniority = SENIORITY_RANK[normalizedJob.seniorityLevel] == null ? "UNKNOWN" : normalizedJob.seniorityLevel;
    const candidateTitles = [profile.currentTitle, ...(resume.experience || []).map((item) => item.title)].filter(Boolean);
    const candidateSeniority = candidateTitles.map(seniorityFromTitle)
        .sort((left, right) => (SENIORITY_RANK[right] ?? -1) - (SENIORITY_RANK[left] ?? -1))[0] || "UNKNOWN";
    const leadershipText = normalizedText(`${resume.summary || ""}\n${(resume.experience || []).flatMap((item) => [
        item.title,
        ...(item.bullets || [])
    ]).join("\n")}`);
    if (jobSeniority === "UNKNOWN") {
        addUnknown(MATCH_UNKNOWN_CODES.SENIORITY_UNKNOWN, "seniority", "Role seniority is not explicit.", profile.desiredSeniorityLevels);
        dimensions.seniority = dimension(100, "UNKNOWN", [MATCH_UNKNOWN_CODES.SENIORITY_UNKNOWN]);
    } else {
        const leadershipMinimum = LEADERSHIP_MINIMUM_YEARS[jobSeniority];
        const candidateRank = SENIORITY_RANK[candidateSeniority];
        const leadershipLanguage = ["MANAGER", "DIRECTOR"].includes(jobSeniority)
            ? /\b(?:managed|people manager|hired|performance reviews?|led (?:a |the )?team)\b/.test(leadershipText)
            : /\b(?:led|technical leadership|architect(?:ed|ure)?|mentored|owned [^.\n]{0,30}architecture)\b/.test(leadershipText);
        const leadershipSupported = leadershipMinimum == null
            || (candidateRank != null && candidateRank >= SENIORITY_RANK[jobSeniority])
            || (candidateYears != null && candidateYears >= leadershipMinimum && leadershipLanguage);
        if (leadershipMinimum != null && !leadershipSupported && candidateYears != null) {
            exclude(MATCH_EXCLUSION_CODES.UNSUPPORTED_LEADERSHIP_LEVEL, "seniority", `${jobSeniority.toLowerCase()} scope needs stronger leadership evidence.`,
                { years: candidateYears, title: profile.currentTitle || null }, jobSeniority);
            dimensions.seniority = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.UNSUPPORTED_LEADERSHIP_LEVEL]);
        } else if (profile.desiredSeniorityLevels.length && !profile.desiredSeniorityLevels.includes(jobSeniority)) {
            const distance = Math.min(...profile.desiredSeniorityLevels.map((level) => Math.abs((SENIORITY_RANK[level] ?? 99) - SENIORITY_RANK[jobSeniority])));
            if (profile.experienceTolerance.allowNearbySeniority && distance <= 1) {
                addGap(MATCH_GAP_CODES.NEARBY_SENIORITY, "seniority", "Role is one nearby seniority level from your preference.", profile.desiredSeniorityLevels, jobSeniority);
                dimensions.seniority = dimension(72, "GAP", [MATCH_GAP_CODES.NEARBY_SENIORITY]);
            } else {
                exclude(MATCH_EXCLUSION_CODES.SENIORITY_OUTSIDE_RANGE, "seniority", "Role seniority is outside your selected levels.", profile.desiredSeniorityLevels, jobSeniority);
                dimensions.seniority = dimension(0, "CONFLICT", [MATCH_EXCLUSION_CODES.SENIORITY_OUTSIDE_RANGE]);
            }
        } else {
            addReason(MATCH_REASON_CODES.SENIORITY_MATCH, "seniority", "Seniority is compatible with your profile.", profile.desiredSeniorityLevels, jobSeniority);
            dimensions.seniority = dimension(100, "MATCH", [MATCH_REASON_CODES.SENIORITY_MATCH]);
        }
    }

    if (profile.sponsorshipNeed === "REQUIRED") {
        if (normalizedJob.sponsorshipPolicy === "NOT_AVAILABLE") {
            exclude(MATCH_EXCLUSION_CODES.SPONSORSHIP_CONFLICT, "authorization", "You require sponsorship, but the employer explicitly does not provide it.", profile.sponsorshipNeed, normalizedJob.sponsorshipPolicy);
        } else if (normalizedJob.sponsorshipPolicy === "AVAILABLE") {
            addReason(MATCH_REASON_CODES.SPONSORSHIP_COMPATIBLE, "authorization", "Employer explicitly offers sponsorship.", profile.sponsorshipNeed, normalizedJob.sponsorshipPolicy);
        } else addUnknown(MATCH_UNKNOWN_CODES.SPONSORSHIP_POLICY_UNKNOWN, "authorization", "Employer sponsorship policy is not stated.", profile.sponsorshipNeed);
    }
    if (profile.workAuthorization === "NOT_AUTHORIZED" && normalizedJob.sponsorshipPolicy === "NOT_AVAILABLE") {
        exclude(MATCH_EXCLUSION_CODES.WORK_AUTHORIZATION_CONFLICT, "authorization", "Work authorization is incompatible and sponsorship is unavailable.", profile.workAuthorization, normalizedJob.sponsorshipPolicy);
    } else if (profile.workAuthorization === "UNKNOWN") {
        addUnknown(MATCH_UNKNOWN_CODES.WORK_AUTHORIZATION_UNKNOWN, "authorization", "Your work authorization is not specified.", null, normalizedJob.countryCode || null);
    }
    if (profile.relocationPreference === "NOT_WILLING" && normalizedJob.relocationPolicy === "REQUIRED") {
        exclude(MATCH_EXCLUSION_CODES.RELOCATION_CONFLICT, "location", "The employer explicitly requires relocation.", profile.relocationPreference, normalizedJob.relocationPolicy);
    }

    const dealBreakers = profile.dealBreakers;
    const nightShift = explicitTextSignal(text, /\bnight\s+shifts?\b/, /\bno\b[^.\n]{0,24}\bnight\s+shifts?\b/);
    const sixDayWeek = explicitTextSignal(text, /\b(?:6|six)[ -]day\s+(?:work\s*)?week\b/, /\bno\b[^.\n]{0,24}\b(?:6|six)[ -]day\s+(?:work\s*)?week\b/);
    const staffingAgency = explicitTextSignal(text,
        /\b(?:staffing|recruitment) agency\b|\bthird[- ]party payroll\b/,
        /\b(?:not|isn.t|is not|aren.t|are not) (?:a )?(?:staffing|recruitment) agency\b/);
    if (dealBreakers.has("NIGHT_SHIFT") && nightShift) exclude(MATCH_EXCLUSION_CODES.NIGHT_SHIFT_CONFLICT, "dealBreaker", "Posting explicitly requires night shifts.", "NIGHT_SHIFT", "night shift");
    if (dealBreakers.has("MANDATORY_RELOCATION") && normalizedJob.relocationPolicy === "REQUIRED") exclude(MATCH_EXCLUSION_CODES.RELOCATION_CONFLICT, "dealBreaker", "Posting explicitly requires relocation.", "MANDATORY_RELOCATION", normalizedJob.relocationPolicy);
    if (dealBreakers.has("EMPLOYMENT_BOND") && normalizedJob.bondPolicy === "REQUIRED") exclude(MATCH_EXCLUSION_CODES.EMPLOYMENT_BOND_CONFLICT, "dealBreaker", "Posting explicitly requires an employment bond.", "EMPLOYMENT_BOND", normalizedJob.bondPolicy);
    if (dealBreakers.has("HEAVY_TRAVEL") && normalizedJob.travelRequirement === "HEAVY") exclude(MATCH_EXCLUSION_CODES.HEAVY_TRAVEL_CONFLICT, "dealBreaker", "Posting explicitly requires heavy travel.", "HEAVY_TRAVEL", normalizedJob.travelRequirement);
    if (dealBreakers.has("SIX_DAY_WEEK") && sixDayWeek) exclude(MATCH_EXCLUSION_CODES.SIX_DAY_WEEK_CONFLICT, "dealBreaker", "Posting explicitly requires a six-day week.", "SIX_DAY_WEEK", "six-day week");
    if (dealBreakers.has("INTERNSHIP") && normalizedJob.employmentType === "INTERNSHIP") exclude(MATCH_EXCLUSION_CODES.INTERNSHIP_CONFLICT, "dealBreaker", "Role is an internship.", "INTERNSHIP", normalizedJob.employmentType);
    if (dealBreakers.has("STAFFING_AGENCY") && staffingAgency) exclude(MATCH_EXCLUSION_CODES.STAFFING_AGENCY_CONFLICT, "dealBreaker", "Posting is explicitly through a staffing agency.", "STAFFING_AGENCY", company || "staffing agency");

    const weightedScore = Object.entries(DIMENSION_WEIGHTS).reduce((sum, [name, weight]) =>
        sum + (dimensions[name]?.score ?? 100) * weight / 100, 0);
    const eligibility = {
        status: exclusions.length ? "INELIGIBLE" : "ELIGIBLE",
        exclusions
    };
    const score = Math.round(eligibility.status === "INELIGIBLE" ? Math.min(weightedScore, 35) : weightedScore);
    const roleConfidence = normalizedJob.family ? 0.98 : 0.2;
    const descriptionEvidence = Math.min(1, String(job.description || "").length / 1200);
    const knownFacetCount = [normalizedJob.workMode, normalizedJob.employmentType, jobSeniority,
        normalizedJob.sponsorshipPolicy, normalizedJob.remoteScope].filter((value) => value && value !== "UNKNOWN").length;
    const confidence = Number(Math.min(0.98, Math.max(0.2,
        roleConfidence * 0.35 + skillEvaluation.evidenceCoverage * 0.30 + descriptionEvidence * 0.15
        + (requiredYears != null && candidateYears != null ? 0.10 : 0.03) + (knownFacetCount / 5) * 0.10
    )).toFixed(2));
    const versions = {
        profileVersion: profile.profileVersion,
        jobMatchVersion: normalizedJob.matchVersion,
        algorithmVersion: MATCHING_POLICY_ALGORITHM_VERSION
    };
    const decision = {
        eligibility,
        score,
        reasons,
        gaps,
        unknowns,
        versions,
        dimensions
    };
    for (const field of MATCH_DECISION_CONTRACT.requiredFields) {
        if (decision[field] === undefined) throw new Error(`MatchingPolicy omitted required field: ${field}`);
    }
    return {
        ...decision,
        matchScore: score,
        confidence,
        scoringMethod: "MATCHING_POLICY_V1",
        aiEscalated: false,
        explanation: deterministicExplanation(eligibility, reasons, gaps, unknowns),
        matchedSkills: skillEvaluation.exact.map((item) => item.requirement),
        transferableSkills: skillEvaluation.transferable.map((item) => ({
            requirement: item.requirement, evidence: item.evidence, type: item.type, credit: item.credit
        })),
        missingSkills: skillEvaluation.missing.map((item) => item.requirement),
        recommendation: eligibility.status === "INELIGIBLE" ? "skip" : score >= 80 ? "pursue" : score >= 65 ? "maybe" : "skip",
        experienceCompatible,
        minimumExperienceYears: requiredYears,
        candidateExperienceYears: candidateYears,
        breakdown: {
            dimensions,
            reasons,
            gaps,
            unknowns,
            eligibility,
            versions,
            bm25Terms: lexical.terms || [],
            roleClassification: {
                family: normalizedJob.family,
                track: normalizedJob.track,
                targetRoleSimilarity: Number(roleSimilarity.toFixed(3))
            },
            skillEvidence: skillEvaluation.matches,
            requirementGroups: skillEvaluation.groups,
            normalizedJob
        }
    };
}

export function assertMatchDecision(decision) {
    for (const field of MATCH_DECISION_CONTRACT.requiredFields) {
        if (decision?.[field] === undefined) throw new Error(`Invalid MatchDecision: missing ${field}.`);
    }
    if (!MATCH_DECISION_CONTRACT.eligibilityStatuses.includes(decision.eligibility?.status)) {
        throw new Error(`Invalid MatchDecision eligibility: ${decision.eligibility?.status || "missing"}.`);
    }
    for (const field of MATCH_DECISION_CONTRACT.requiredVersions) {
        if (decision.versions?.[field] === undefined) throw new Error(`Invalid MatchDecision version: missing ${field}.`);
    }
    for (const name of MATCH_DECISION_CONTRACT.scoreDimensions) {
        if (!Number.isFinite(decision.dimensions?.[name]?.score)) {
            throw new Error(`Invalid MatchDecision dimension: missing ${name}.`);
        }
    }
    return decision;
}
