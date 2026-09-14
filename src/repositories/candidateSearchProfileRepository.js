import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { classifyJobTitle } from "../services/roleTaxonomy.js";

export const CANDIDATE_SEARCH_PROFILE_SCHEMA_VERSION = 1;

export const SEARCH_PROFILE_INPUT_KEYS = Object.freeze([
    "targetRoles", "careerProfiles", "careerFamilies", "primaryCoreStacks", "acceptableCoreStacks",
    "adjacentCareerTracks", "desiredSeniorityLevels", "preferredSkills", "excludedSkills",
    "preferredLocations", "preferredWorkModes", "employmentTypes", "minimumSalary",
    "compensationConstraintMode", "locationConstraintMode", "workModeConstraintMode",
    "employmentTypeConstraintMode", "experienceTolerance", "excludedCompanies", "dealBreakers",
    "countryCode", "searchCountryCode", "workAuthorization", "sponsorshipNeed", "sponsorshipRequired",
    "relocationPreference", "willingToRelocate"
]);

const CONSTRAINT_MODES = new Set(["SOFT", "HARD"]);
const WORK_MODES = new Map([
    ["REMOTE", "REMOTE"], ["WFH", "REMOTE"], ["WORK FROM HOME", "REMOTE"],
    ["HYBRID", "HYBRID"],
    ["OFFICE", "OFFICE"], ["WFO", "OFFICE"], ["ONSITE", "OFFICE"], ["ON-SITE", "OFFICE"]
]);
const EMPLOYMENT_TYPES = new Map([
    ["FULL TIME", "FULL_TIME"], ["FULL-TIME", "FULL_TIME"], ["FULL_TIME", "FULL_TIME"],
    ["CONTRACT", "CONTRACT"], ["CONTRACTOR", "CONTRACT"], ["FREELANCE", "CONTRACT"],
    ["PART TIME", "PART_TIME"], ["PART-TIME", "PART_TIME"], ["PART_TIME", "PART_TIME"],
    ["INTERNSHIP", "INTERNSHIP"], ["INTERN", "INTERNSHIP"]
]);
const DEAL_BREAKERS = new Map([
    ["NIGHT_SHIFT", "NIGHT_SHIFT"], ["NO NIGHT SHIFTS", "NIGHT_SHIFT"], ["NIGHT SHIFT", "NIGHT_SHIFT"],
    ["MANDATORY_RELOCATION", "MANDATORY_RELOCATION"], ["NO MANDATORY RELOCATION", "MANDATORY_RELOCATION"],
    ["EMPLOYMENT_BOND", "EMPLOYMENT_BOND"], ["NO EMPLOYMENT BOND", "EMPLOYMENT_BOND"], ["NO BOND", "EMPLOYMENT_BOND"],
    ["HEAVY_TRAVEL", "HEAVY_TRAVEL"], ["NO HEAVY TRAVEL", "HEAVY_TRAVEL"],
    ["SIX_DAY_WEEK", "SIX_DAY_WEEK"], ["NO 6-DAY WEEK", "SIX_DAY_WEEK"], ["NO SIX-DAY WEEK", "SIX_DAY_WEEK"],
    ["INTERNSHIP", "INTERNSHIP"], ["NO INTERNSHIPS", "INTERNSHIP"],
    ["STAFFING_AGENCY", "STAFFING_AGENCY"], ["NO STAFFING AGENCIES", "STAFFING_AGENCY"]
]);
const DEAL_BREAKER_LABELS = Object.freeze({
    NIGHT_SHIFT: "No night shifts",
    MANDATORY_RELOCATION: "No mandatory relocation",
    EMPLOYMENT_BOND: "No employment bond",
    HEAVY_TRAVEL: "No heavy travel",
    SIX_DAY_WEEK: "No 6-day week",
    INTERNSHIP: "No internships",
    STAFFING_AGENCY: "No staffing agencies"
});

const DEFAULT_PROFILE = Object.freeze({
    targetRoles: [],
    careerFamilies: [],
    primaryCoreStacks: [],
    acceptableCoreStacks: [],
    adjacentCareerTracks: [],
    desiredSeniorityLevels: [],
    preferredSkills: [],
    excludedSkills: [],
    preferredLocations: [],
    preferredWorkModes: [],
    employmentTypes: ["FULL_TIME"],
    minimumSalary: null,
    compensationConstraintMode: "SOFT",
    locationConstraintMode: "SOFT",
    workModeConstraintMode: "SOFT",
    employmentTypeConstraintMode: "SOFT",
    experienceTolerance: { smallGapYears: 1, maxPlausibleGapYears: 3, allowNearbySeniority: true },
    excludedCompanies: [],
    dealBreakers: [],
    countryCode: "IN",
    workAuthorization: "UNKNOWN",
    sponsorshipNeed: "UNKNOWN",
    relocationPreference: "UNKNOWN"
});

function parseJson(value, fallback) {
    if (value && typeof value === "object") return value;
    try { return JSON.parse(value ?? "") ?? fallback; } catch { return fallback; }
}

function list(value, limit = 30) {
    const raw = Array.isArray(value) ? value : typeof value === "string"
        ? (() => {
            const parsed = parseJson(value, null);
            return Array.isArray(parsed) ? parsed : value.split(/[\n,]/);
        })()
        : [];
    const seen = new Set();
    return raw.map((item) => String(item || "").normalize("NFKC").replace(/\s+/g, " ").trim())
        .filter((item) => {
            const key = item.toLowerCase();
            if (!item || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, limit);
}

function mappedList(value, mapping, limit = 20) {
    return [...new Set(list(value, limit).map((item) => mapping.get(item.toUpperCase())).filter(Boolean))];
}

function upperList(value, limit = 20) {
    return [...new Set(list(value, limit).map((item) => item.toUpperCase().replace(/[ -]+/g, "_")))];
}

function constraintMode(value, fallback = "SOFT") {
    const mode = String(value || "").toUpperCase();
    return CONSTRAINT_MODES.has(mode) ? mode : fallback;
}

function numberOrNull(value) {
    if (value === "" || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function authorization(value) {
    const text = String(value || "").trim().toUpperCase();
    if (!text || text === "UNKNOWN") return "UNKNOWN";
    if (["YES", "TRUE", "ELIGIBLE"].includes(text)) return "AUTHORIZED_IN_MARKET";
    if (["NO", "FALSE"].includes(text)) return "NOT_AUTHORIZED";
    if (/NOT.AUTHORI[ZS]ED|NO WORK AUTHORI[ZS]ATION/.test(text)) return "NOT_AUTHORIZED";
    if (/AUTHORI[ZS]ED|ELIGIBLE|CITIZEN|PERMANENT RESIDENT|OCI/.test(text)) return "AUTHORIZED_IN_MARKET";
    return ["AUTHORIZED_IN_MARKET", "NOT_AUTHORIZED"].includes(text) ? text : "UNKNOWN";
}

function sponsorship(value) {
    if (value === true) return "REQUIRED";
    if (value === false) return "NOT_REQUIRED";
    const text = String(value || "").trim().toUpperCase();
    if (["REQUIRED", "YES", "TRUE", "NEEDED"].includes(text)) return "REQUIRED";
    if (["NOT_REQUIRED", "NO", "FALSE", "NOT NEEDED"].includes(text)) return "NOT_REQUIRED";
    return "UNKNOWN";
}

function relocation(value) {
    if (value === true) return "WILLING";
    if (value === false) return "NOT_WILLING";
    const text = String(value || "").trim().toUpperCase();
    return ["WILLING", "NOT_WILLING", "UNKNOWN"].includes(text) ? text : "UNKNOWN";
}

function experienceTolerance(value, fallback = DEFAULT_PROFILE.experienceTolerance) {
    const raw = parseJson(value, {}) || {};
    const small = Math.max(0, Math.min(5, Number(raw.smallGapYears ?? fallback.smallGapYears) || 0));
    const plausible = Math.max(small, Math.min(10, Number(raw.maxPlausibleGapYears ?? fallback.maxPlausibleGapYears) || 0));
    return {
        smallGapYears: small,
        maxPlausibleGapYears: plausible,
        allowNearbySeniority: raw.allowNearbySeniority === undefined
            ? Boolean(fallback.allowNearbySeniority) : Boolean(raw.allowNearbySeniority)
    };
}

function careerFamiliesForRoles(roles) {
    return [...new Set(roles.map((role) => classifyJobTitle(role).family).filter(Boolean))];
}

export function canonicalCandidateSearchProfile(input = {}, current = DEFAULT_PROFILE) {
    const targetRoles = list(input.targetRoles ?? current.targetRoles, 8);
    const suppliedFamilies = input.careerFamilies ?? input.careerProfiles;
    const careerFamilies = suppliedFamilies !== undefined
        ? upperList(suppliedFamilies, 8)
        : input.targetRoles !== undefined ? careerFamiliesForRoles(targetRoles) : upperList(current.careerFamilies, 8);
    const currentTolerance = current.experienceTolerance || DEFAULT_PROFILE.experienceTolerance;
    return {
        targetRoles,
        careerFamilies,
        primaryCoreStacks: list(input.primaryCoreStacks ?? current.primaryCoreStacks, 12),
        acceptableCoreStacks: list(input.acceptableCoreStacks ?? current.acceptableCoreStacks, 20),
        adjacentCareerTracks: upperList(input.adjacentCareerTracks ?? current.adjacentCareerTracks, 20),
        desiredSeniorityLevels: upperList(input.desiredSeniorityLevels ?? current.desiredSeniorityLevels, 10),
        preferredSkills: list(input.preferredSkills ?? current.preferredSkills, 30),
        excludedSkills: list(input.excludedSkills ?? current.excludedSkills, 30),
        preferredLocations: list(input.preferredLocations ?? current.preferredLocations, 20),
        preferredWorkModes: mappedList(input.preferredWorkModes ?? current.preferredWorkModes, WORK_MODES, 6),
        employmentTypes: mappedList(input.employmentTypes ?? current.employmentTypes, EMPLOYMENT_TYPES, 8),
        minimumSalary: numberOrNull(Object.hasOwn(input, "minimumSalary") ? input.minimumSalary : current.minimumSalary),
        compensationConstraintMode: constraintMode(input.compensationConstraintMode, current.compensationConstraintMode),
        locationConstraintMode: constraintMode(input.locationConstraintMode, current.locationConstraintMode),
        workModeConstraintMode: constraintMode(input.workModeConstraintMode, current.workModeConstraintMode),
        employmentTypeConstraintMode: constraintMode(input.employmentTypeConstraintMode, current.employmentTypeConstraintMode),
        experienceTolerance: experienceTolerance(input.experienceTolerance, currentTolerance),
        excludedCompanies: list(input.excludedCompanies ?? current.excludedCompanies, 50),
        dealBreakers: mappedList(input.dealBreakers ?? current.dealBreakers, DEAL_BREAKERS, 20),
        countryCode: String((input.countryCode ?? input.searchCountryCode ?? current.countryCode) || "IN")
            .trim().toUpperCase().slice(0, 2) || "IN",
        workAuthorization: authorization(input.workAuthorization ?? current.workAuthorization),
        sponsorshipNeed: sponsorship(input.sponsorshipNeed ?? input.sponsorshipRequired ?? current.sponsorshipNeed),
        relocationPreference: relocation(input.relocationPreference ?? input.willingToRelocate ?? current.relocationPreference)
    };
}

function stableForSignature(profile) {
    const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
    return {
        minimumSalary: profile.minimumSalary,
        compensationConstraintMode: profile.compensationConstraintMode,
        locationConstraintMode: profile.locationConstraintMode,
        workModeConstraintMode: profile.workModeConstraintMode,
        employmentTypeConstraintMode: profile.employmentTypeConstraintMode,
        experienceTolerance: profile.experienceTolerance,
        countryCode: profile.countryCode,
        workAuthorization: profile.workAuthorization,
        sponsorshipNeed: profile.sponsorshipNeed,
        relocationPreference: profile.relocationPreference,
        targetRoles: sorted(profile.targetRoles),
        careerFamilies: sorted(profile.careerFamilies),
        primaryCoreStacks: sorted(profile.primaryCoreStacks),
        acceptableCoreStacks: sorted(profile.acceptableCoreStacks),
        adjacentCareerTracks: sorted(profile.adjacentCareerTracks),
        desiredSeniorityLevels: sorted(profile.desiredSeniorityLevels),
        preferredSkills: sorted(profile.preferredSkills),
        excludedSkills: sorted(profile.excludedSkills),
        preferredLocations: sorted(profile.preferredLocations),
        preferredWorkModes: sorted(profile.preferredWorkModes),
        employmentTypes: sorted(profile.employmentTypes),
        excludedCompanies: sorted(profile.excludedCompanies),
        dealBreakers: sorted(profile.dealBreakers)
    };
}

export function candidateSearchProfileSignature(profile) {
    return crypto.createHash("sha256").update(JSON.stringify(stableForSignature(profile))).digest("hex").slice(0, 40);
}

function rowToProfile(row) {
    const canonical = canonicalCandidateSearchProfile({
        targetRoles: parseJson(row.target_roles_json, []),
        careerFamilies: parseJson(row.career_families_json, []),
        primaryCoreStacks: parseJson(row.primary_core_stacks_json, []),
        acceptableCoreStacks: parseJson(row.acceptable_core_stacks_json, []),
        adjacentCareerTracks: parseJson(row.adjacent_career_tracks_json, []),
        desiredSeniorityLevels: parseJson(row.desired_seniority_levels_json, []),
        preferredSkills: parseJson(row.preferred_skills_json, []),
        excludedSkills: parseJson(row.excluded_skills_json, []),
        preferredLocations: parseJson(row.preferred_locations_json, []),
        preferredWorkModes: parseJson(row.preferred_work_modes_json, []),
        employmentTypes: parseJson(row.employment_types_json, ["FULL_TIME"]),
        minimumSalary: row.minimum_salary_lpa,
        compensationConstraintMode: row.compensation_constraint_mode,
        locationConstraintMode: row.location_constraint_mode,
        workModeConstraintMode: row.work_mode_constraint_mode,
        employmentTypeConstraintMode: row.employment_type_constraint_mode,
        experienceTolerance: parseJson(row.experience_tolerance_json, DEFAULT_PROFILE.experienceTolerance),
        excludedCompanies: parseJson(row.excluded_companies_json, []),
        dealBreakers: parseJson(row.deal_breakers_json, []),
        countryCode: row.country_code,
        workAuthorization: row.work_authorization,
        sponsorshipNeed: row.sponsorship_need,
        relocationPreference: row.relocation_preference
    });
    return {
        userId: row.user_id,
        schemaVersion: Number(row.schema_version || 1),
        profileVersion: Number(row.profile_version || 1),
        ...canonical,
        matchSignature: row.match_signature || candidateSearchProfileSignature(canonical),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function storageValues(userId, profile, version, signature) {
    return {
        userId,
        schemaVersion: CANDIDATE_SEARCH_PROFILE_SCHEMA_VERSION,
        profileVersion: version,
        targetRoles: JSON.stringify(profile.targetRoles),
        careerFamilies: JSON.stringify(profile.careerFamilies),
        primaryCoreStacks: JSON.stringify(profile.primaryCoreStacks),
        acceptableCoreStacks: JSON.stringify(profile.acceptableCoreStacks),
        adjacentCareerTracks: JSON.stringify(profile.adjacentCareerTracks),
        desiredSeniorityLevels: JSON.stringify(profile.desiredSeniorityLevels),
        preferredSkills: JSON.stringify(profile.preferredSkills),
        excludedSkills: JSON.stringify(profile.excludedSkills),
        preferredLocations: JSON.stringify(profile.preferredLocations),
        preferredWorkModes: JSON.stringify(profile.preferredWorkModes),
        employmentTypes: JSON.stringify(profile.employmentTypes),
        minimumSalary: profile.minimumSalary,
        compensationConstraintMode: profile.compensationConstraintMode,
        locationConstraintMode: profile.locationConstraintMode,
        workModeConstraintMode: profile.workModeConstraintMode,
        employmentTypeConstraintMode: profile.employmentTypeConstraintMode,
        experienceTolerance: JSON.stringify(profile.experienceTolerance),
        excludedCompanies: JSON.stringify(profile.excludedCompanies),
        dealBreakers: JSON.stringify(profile.dealBreakers),
        countryCode: profile.countryCode,
        workAuthorization: profile.workAuthorization,
        sponsorshipNeed: profile.sponsorshipNeed,
        relocationPreference: profile.relocationPreference,
        matchSignature: signature
    };
}

function updateRow(db, values) {
    db.prepare(`UPDATE candidate_search_profiles SET
        schema_version=@schemaVersion, profile_version=@profileVersion,
        target_roles_json=@targetRoles, career_families_json=@careerFamilies,
        primary_core_stacks_json=@primaryCoreStacks, acceptable_core_stacks_json=@acceptableCoreStacks,
        adjacent_career_tracks_json=@adjacentCareerTracks, desired_seniority_levels_json=@desiredSeniorityLevels,
        preferred_skills_json=@preferredSkills, excluded_skills_json=@excludedSkills,
        preferred_locations_json=@preferredLocations, preferred_work_modes_json=@preferredWorkModes,
        employment_types_json=@employmentTypes, minimum_salary_lpa=@minimumSalary,
        compensation_constraint_mode=@compensationConstraintMode, location_constraint_mode=@locationConstraintMode,
        work_mode_constraint_mode=@workModeConstraintMode, employment_type_constraint_mode=@employmentTypeConstraintMode,
        experience_tolerance_json=@experienceTolerance, excluded_companies_json=@excludedCompanies,
        deal_breakers_json=@dealBreakers, country_code=@countryCode, work_authorization=@workAuthorization,
        sponsorship_need=@sponsorshipNeed, relocation_preference=@relocationPreference,
        match_signature=@matchSignature, updated_at=CURRENT_TIMESTAMP WHERE user_id=@userId`).run(values);
}

function ensureRow(db, userId) {
    let row = db.prepare("SELECT * FROM candidate_search_profiles WHERE user_id = ?").get(userId);
    if (!row) {
        const candidate = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(userId);
        if (!candidate) throw new Error("Create the candidate profile before the search profile.");
        db.prepare("INSERT INTO candidate_search_profiles (user_id) VALUES (?)").run(userId);
        const autoApply = db.prepare("SELECT * FROM auto_apply_settings WHERE user_id = ?").get(userId) || {};
        const onboarding = db.prepare("SELECT state_json FROM onboarding_states WHERE user_id = ?").get(userId);
        const stored = parseJson(onboarding?.state_json, {});
        const seeded = canonicalCandidateSearchProfile({
            targetRoles: parseJson(candidate.target_roles, []).length
                ? parseJson(candidate.target_roles, []) : parseJson(autoApply.target_roles, []),
            careerFamilies: parseJson(candidate.target_roles, []).length
                ? parseJson(candidate.career_profiles, []) : [],
            preferredSkills: parseJson(candidate.preferred_skills, []),
            excludedSkills: parseJson(candidate.excluded_skills, []),
            preferredLocations: parseJson(candidate.preferred_locations, []).length
                ? parseJson(candidate.preferred_locations, []) : parseJson(autoApply.preferred_locations, []),
            preferredWorkModes: parseJson(candidate.preferred_work_modes, []),
            employmentTypes: stored.employmentTypes || ["FULL_TIME"],
            minimumSalary: candidate.minimum_salary ?? autoApply.minimum_salary,
            excludedCompanies: parseJson(autoApply.excluded_companies, []),
            dealBreakers: stored.dealBreakers || [],
            countryCode: "IN",
            workAuthorization: candidate.work_authorization,
            sponsorshipNeed: candidate.sponsorship_required,
            willingToRelocate: candidate.willing_to_relocate === 1
        });
        const seededSignature = candidateSearchProfileSignature(seeded);
        updateRow(db, storageValues(userId, seeded, 1, seededSignature));
        row = db.prepare("SELECT * FROM candidate_search_profiles WHERE user_id = ?").get(userId);
    }
    if (!row.match_signature) {
        const profile = rowToProfile(row);
        const signature = candidateSearchProfileSignature(profile);
        updateRow(db, storageValues(userId, profile, profile.profileVersion, signature));
        row = db.prepare("SELECT * FROM candidate_search_profiles WHERE user_id = ?").get(userId);
    }
    return row;
}

export function getCandidateSearchProfile(userId = "local-user", { db = getDb() } = {}) {
    return rowToProfile(ensureRow(db, userId));
}

function changedFields(previous, next) {
    return Object.keys(DEFAULT_PROFILE).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

function legacyWorkModes(values) {
    return values.map((value) => ({ REMOTE: "Remote", HYBRID: "Hybrid", OFFICE: "Office" })[value] || value);
}

function legacyEmploymentTypes(values) {
    return values.map((value) => ({ FULL_TIME: "Full-time", CONTRACT: "Contract", PART_TIME: "Part-time", INTERNSHIP: "Internship" })[value] || value);
}

function legacyWorkAuthorization(value) {
    if (value === "AUTHORIZED_IN_MARKET") return "AUTHORIZED";
    if (value === "NOT_AUTHORIZED") return "NOT_AUTHORIZED";
    return "";
}

function legacySponsorship(value) {
    if (value === "REQUIRED") return "YES";
    if (value === "NOT_REQUIRED") return "NO";
    return "";
}

function syncLegacyMirrors(db, userId, profile) {
    db.prepare(`UPDATE candidate_profiles SET
        preferred_locations=?, preferred_skills=?, excluded_skills=?, target_roles=?, career_profiles=?,
        preferred_work_modes=?, minimum_salary=?, willing_to_relocate=?, work_authorization=?, sponsorship_required=?,
        updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).run(
        JSON.stringify(profile.preferredLocations), JSON.stringify(profile.preferredSkills),
        JSON.stringify(profile.excludedSkills), JSON.stringify(profile.targetRoles), JSON.stringify(profile.careerFamilies),
        JSON.stringify(legacyWorkModes(profile.preferredWorkModes)), profile.minimumSalary,
        profile.relocationPreference === "WILLING" ? 1 : 0, profile.workAuthorization, profile.sponsorshipNeed, userId
    );
    db.prepare("INSERT OR IGNORE INTO auto_apply_settings (user_id) VALUES (?)").run(userId);
    db.prepare(`UPDATE auto_apply_settings SET target_roles=?, preferred_locations=?, excluded_companies=?,
        minimum_salary=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).run(
        JSON.stringify(profile.targetRoles), JSON.stringify(profile.preferredLocations),
        JSON.stringify(profile.excludedCompanies), profile.minimumSalary, userId
    );
}

export function saveCandidateSearchProfile(patch = {}, userId = "local-user", {
    db = getDb(), source = "PROFILE"
} = {}) {
    const current = getCandidateSearchProfile(userId, { db });
    const next = canonicalCandidateSearchProfile(patch, current);
    const signature = candidateSearchProfileSignature(next);
    if (signature === current.matchSignature) return current;
    const fields = changedFields(current, next);
    const version = current.profileVersion + 1;
    db.transaction(() => {
        updateRow(db, storageValues(userId, next, version, signature));
        db.prepare(`INSERT INTO candidate_search_profile_events
            (id, user_id, from_version, to_version, changed_fields_json, source)
            VALUES (?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), userId, current.profileVersion, version,
            JSON.stringify(fields), String(source || "PROFILE").slice(0, 40));
        syncLegacyMirrors(db, userId, next);
    })();
    return getCandidateSearchProfile(userId, { db });
}

export function extractCandidateSearchPatch(input = {}) {
    return Object.fromEntries(SEARCH_PROFILE_INPUT_KEYS
        .filter((key) => Object.hasOwn(input, key))
        .map((key) => [key, input[key]]));
}

export function toCandidateProfileSearchFields(profile) {
    return {
        searchProfileVersion: profile.profileVersion,
        targetRoles: profile.targetRoles,
        careerProfiles: profile.careerFamilies,
        primaryCoreStacks: profile.primaryCoreStacks,
        acceptableCoreStacks: profile.acceptableCoreStacks,
        adjacentCareerTracks: profile.adjacentCareerTracks,
        desiredSeniorityLevels: profile.desiredSeniorityLevels,
        preferredSkills: profile.preferredSkills,
        excludedSkills: profile.excludedSkills,
        preferredLocations: profile.preferredLocations,
        preferredWorkModes: legacyWorkModes(profile.preferredWorkModes),
        employmentTypes: legacyEmploymentTypes(profile.employmentTypes),
        minimumSalary: profile.minimumSalary,
        compensationConstraintMode: profile.compensationConstraintMode,
        locationConstraintMode: profile.locationConstraintMode,
        workModeConstraintMode: profile.workModeConstraintMode,
        employmentTypeConstraintMode: profile.employmentTypeConstraintMode,
        experienceTolerance: profile.experienceTolerance,
        excludedCompanies: profile.excludedCompanies,
        dealBreakers: profile.dealBreakers.map((code) => DEAL_BREAKER_LABELS[code] || code),
        searchCountryCode: profile.countryCode,
        workAuthorization: legacyWorkAuthorization(profile.workAuthorization),
        sponsorshipNeed: profile.sponsorshipNeed,
        sponsorshipRequired: legacySponsorship(profile.sponsorshipNeed),
        relocationPreference: profile.relocationPreference,
        willingToRelocate: profile.relocationPreference === "WILLING"
    };
}

export function searchProfileDefaults() {
    return structuredClone(DEFAULT_PROFILE);
}
