import crypto from "node:crypto";
import { isIndiaLocation } from "../utils/indiaLocation.js";
import { extractJobTags } from "../utils/jobTags.js";
import { extractJobRequirementModel } from "./jobRequirementModel.js";
import { classifyJobTitle } from "./roleTaxonomy.js";
import { extractKnownSkills } from "./skillOntology.js";

export const JOB_NORMALIZER_VERSION = "job-normalizer-v2";

const PRIMARY_STACK_SKILLS = new Set([
    "Node.js", "Java", "Kotlin", "Spring Boot", "Python", "Go", "PHP", "Laravel",
    "C#", ".NET", "JavaScript", "TypeScript", "React", "Angular", "Vue.js",
    "Python data", "Machine Learning", "Spark"
]);

function clean(value = "") {
    return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalized(value = "") {
    return clean(value).toLowerCase();
}

function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
}

function hash(parts) {
    return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40);
}

function explicitDate(job = {}) {
    const raw = job.explicitDeadline || job.applicationDeadline || job.application_deadline
        || job.expiresAt || job.expires_at || job.closingDate || job.closing_date || null;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function employmentType(text, explicit) {
    const value = normalized(explicit);
    if (/full.?time/.test(value)) return "FULL_TIME";
    if (/contract|contractor|freelance/.test(value)) return "CONTRACT";
    if (/intern/.test(value)) return "INTERNSHIP";
    if (/part.?time/.test(value)) return "PART_TIME";
    if (/temporary|fixed.?term/.test(value)) return "TEMPORARY";
    if (/\b(intern|internship)\b/.test(text)) return "INTERNSHIP";
    if (/\b(contract|contractor|freelance)\b/.test(text)) return "CONTRACT";
    if (/\bpart[ -]?time\b/.test(text)) return "PART_TIME";
    if (/\btemporary|fixed[ -]?term\b/.test(text)) return "TEMPORARY";
    if (/\bfull[ -]?time\b/.test(text)) return "FULL_TIME";
    return "UNKNOWN";
}

function seniority(title) {
    if (/\b(?:intern|trainee|apprentice)\b/.test(title)) return "INTERN";
    if (/\b(?:principal|distinguished)\b/.test(title)) return "PRINCIPAL";
    if (/\bstaff\b/.test(title)) return "STAFF";
    if (/\b(?:director|head of|vp|vice president)\b/.test(title)) return "DIRECTOR";
    if (/\b(?:manager|engineering manager)\b/.test(title)) return "MANAGER";
    if (/\b(?:lead|tech lead|team lead|architect)\b/.test(title)) return "LEAD";
    if (/\b(?:senior|sr\.?|sde[ -]?(?:2|ii|3|iii))\b/.test(title)) return "SENIOR";
    if (/\b(?:junior|jr\.?|associate|entry[ -]?level|graduate|sde[ -]?(?:1|i))\b/.test(title)) return "JUNIOR";
    return "UNKNOWN";
}

function remoteScope(text, workMode, location) {
    if (workMode !== "Remote") return workMode === "Hybrid" || workMode === "WFO" ? "LOCATION_BOUND" : "UNKNOWN";
    if (/\b(?:worldwide|anywhere in the world|global remote)\b/.test(text)) return "GLOBAL";
    if (/\b(?:us|u\.s\.|united states|uk|united kingdom|canada|europe|emea|italy|italian|france|germany|netherlands|spain|singapore|australia|japan|korea|uae|united arab emirates)[ -]?(?:only|based)?\b/.test(text)
        && !/\bindia\b/.test(text)) return "RESTRICTED_OTHER";
    if (/\b(?:india|within india|india only|remote[ -]india)\b/.test(`${text} ${location}`)) return "INDIA_ONLY";
    return "UNKNOWN";
}

function sponsorshipPolicy(text, explicit) {
    const value = normalized(explicit);
    if (/^(?:no|not available|unavailable)$/.test(value)) return "NOT_AVAILABLE";
    if (/^(?:yes|available|provided)$/.test(value)) return "AVAILABLE";
    if (/\b(?:no|without)\s+(?:visa\s+)?sponsorship|sponsorship (?:is )?not available|unable to sponsor\b/.test(text)) return "NOT_AVAILABLE";
    if (/\b(?:visa\s+)?sponsorship (?:is )?(?:available|provided)|will sponsor\b/.test(text)) return "AVAILABLE";
    return "UNKNOWN";
}

function relocationPolicy(text, explicit) {
    const value = normalized(explicit);
    if (/not required|no/.test(value)) return "NOT_REQUIRED";
    if (/required|mandatory/.test(value)) return "REQUIRED";
    if (/optional|available|provided/.test(value)) return "OPTIONAL";
    if (/\bno relocation required\b/.test(text)) return "NOT_REQUIRED";
    if (/\b(?:must|required to|mandatory to) relocate\b|\brelocation (?:is )?(?:required|mandatory)\b/.test(text)) return "REQUIRED";
    if (/\brelocation (?:assistance|support|available|provided)\b/.test(text)) return "OPTIONAL";
    return "UNKNOWN";
}

function travelRequirement(text, explicit) {
    const value = normalized(explicit);
    if (/none|no travel|0%/.test(value)) return "NONE";
    if (/heavy|extensive|frequent|(?:5\d|[6-9]\d|100)%/.test(value)) return "HEAVY";
    if (value) return "SOME";
    if (/\bno (?:heavy |extensive |frequent )?travel (?:is )?required\b/.test(text)) return "NONE";
    if (/\b(?:heavy|extensive|frequent) travel\b|\btravel\s+(?:5\d|[6-9]\d|100)%/.test(text)) return "HEAVY";
    if (/\b(?:occasional|some) travel\b|\btravel\s+(?:[1-4]\d)%/.test(text)) return "SOME";
    return "UNKNOWN";
}

function bondPolicy(text, explicit) {
    if (explicit === true || explicit === 1 || normalized(explicit) === "required") return "REQUIRED";
    if (explicit === false || normalized(explicit) === "none") return "NONE_EXPLICIT";
    if (/\bno (?:service |employment )?bond\b/.test(text)) return "NONE_EXPLICIT";
    if (/\b(?:service|employment) bond\b|\bbond of \d+/.test(text)) return "REQUIRED";
    return "UNKNOWN";
}

function primaryStackFor(title, requiredSkills, allSkills) {
    const titleSkills = extractKnownSkills(title).filter((skill) => PRIMARY_STACK_SKILLS.has(skill));
    return titleSkills[0]
        || requiredSkills.find((skill) => PRIMARY_STACK_SKILLS.has(skill))
        || allSkills.find((skill) => PRIMARY_STACK_SKILLS.has(skill))
        || null;
}

export function normalizeJobForRegistry(job = {}) {
    const title = clean(job.title);
    const description = clean(job.description);
    const location = clean(job.location || "Not specified");
    const text = normalized(`${title}\n${description}\n${location}`);
    const tags = extractJobTags(job);
    const inferredWorkMode = tags.workMode !== "unstated" ? tags.workMode
        : /\b(?:remote|wfh|work from home)\b/.test(normalized(location)) ? "Remote"
            : /\bhybrid\b/.test(normalized(location)) ? "Hybrid"
                : /\b(?:wfo|onsite|on-site|office)\b/.test(normalized(location)) ? "WFO" : "unstated";
    const classification = classifyJobTitle(title);
    const requirementModel = extractJobRequirementModel(`${title}\n${description}`);
    const requiredSkills = unique(requirementModel.filter((item) => item.kind === "REQUIRED").map((item) => item.skill));
    const allSkills = extractKnownSkills(`${title}\n${description}`);
    const secondarySkills = unique([
        ...requirementModel.filter((item) => item.kind === "PREFERRED" || item.kind === "CONTEXT").map((item) => item.skill),
        ...allSkills.filter((skill) => !requiredSkills.includes(skill))
    ]);
    const normalizedJob = {
        employmentType: employmentType(text, job.employmentType || job.employment_type),
        seniorityLevel: seniority(normalized(title)),
        countryCode: clean(job.countryCode || job.country_code || (isIndiaLocation(location) ? "IN" : "")).toUpperCase() || null,
        remoteScope: remoteScope(text, inferredWorkMode, normalized(location)),
        sponsorshipPolicy: sponsorshipPolicy(text, job.sponsorshipPolicy || job.sponsorship_policy),
        relocationPolicy: relocationPolicy(text, job.relocationRequired ?? job.relocation_policy),
        travelRequirement: travelRequirement(text, job.travelRequirement || job.travel_requirement),
        bondPolicy: bondPolicy(text, job.hasBond ?? job.bondRequired ?? job.bond_policy),
        primaryStack: primaryStackFor(title, requiredSkills, allSkills),
        requiredSkills,
        secondarySkills,
        explicitDeadline: explicitDate(job),
        workMode: inferredWorkMode,
        yoeMin: tags.yoeMin,
        ctcMinLpa: tags.ctcMinLpa,
        ctcMaxLpa: tags.ctcMaxLpa,
        hasEsops: tags.hasEsops,
        hasBond: tags.hasBond,
        careerFamily: classification.family,
        careerTrack: classification.track,
        normalizerVersion: JOB_NORMALIZER_VERSION
    };
    return normalizedJob;
}

export function jobMatchFingerprint(job = {}, normalizedJob = normalizeJobForRegistry(job)) {
    return hash([
        normalized(job.title),
        normalized(job.location),
        normalized(job.description),
        normalizedJob.employmentType,
        normalizedJob.seniorityLevel,
        normalizedJob.countryCode || "",
        normalizedJob.remoteScope,
        normalizedJob.sponsorshipPolicy,
        normalizedJob.relocationPolicy,
        normalizedJob.travelRequirement,
        normalizedJob.bondPolicy,
        normalizedJob.primaryStack || "",
        JSON.stringify(normalizedJob.requiredSkills),
        JSON.stringify(normalizedJob.secondarySkills),
        String(normalizedJob.yoeMin ?? ""),
        String(normalizedJob.ctcMinLpa ?? ""),
        String(normalizedJob.ctcMaxLpa ?? "")
    ]);
}

export function jobPostingSeriesKey(job = {}, normalizedJob = normalizeJobForRegistry(job)) {
    return hash([
        normalized(job.company),
        normalized(job.title),
        normalizedJob.careerFamily || "",
        normalizedJob.careerTrack || "",
        normalized(job.location)
    ]).slice(0, 32);
}

export function rawJobSnapshot(job = {}) {
    const rawText = String(job.description || "");
    const payload = {
        company: clean(job.company),
        domain: clean(job.domain),
        title: clean(job.title),
        location: clean(job.location),
        url: clean(job.url),
        source: clean(job.source),
        atsType: clean(job.atsType),
        atsSlug: clean(job.atsSlug),
        postedAt: job.postedAt || job.posted_at || job.date_posted || null,
        applicationDeadline: job.applicationDeadline || job.application_deadline || job.expiresAt || null
    };
    return {
        rawText,
        payload,
        contentHash: hash([JSON.stringify(payload), clean(rawText)]),
        parserVersion: JOB_NORMALIZER_VERSION
    };
}
