import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobForRegistry } from "../src/services/jobNormalizer.js";
import {
    assertMatchDecision,
    evaluateMatchingPolicy,
    MATCH_EXCLUSION_CODES,
    MATCH_GAP_CODES,
    MATCH_REASON_CODES,
    MATCH_UNKNOWN_CODES
} from "../src/services/matchingPolicy.js";
import { shouldEscalateToAi } from "../src/services/heuristicMatcher.js";

const NOW = new Date("2026-08-28T12:00:00.000Z");

function job(overrides = {}) {
    return {
        id: "job-1",
        title: "Backend Engineer",
        company_name: "Acme India",
        location: "Bengaluru, India",
        description: "Full-time backend role. Must have Node.js and PostgreSQL. Nice to have Kafka. Minimum 5 years experience.",
        posted_at: "2026-08-27T12:00:00.000Z",
        lifecycle_status: "ACTIVE",
        ...overrides
    };
}

function resume(overrides = {}) {
    return {
        skills: ["Node.js", "PostgreSQL", "Redis"],
        skillGroups: {},
        experience: [],
        ...overrides
    };
}

function profile(overrides = {}) {
    return {
        profileVersion: 4,
        targetRoles: ["Backend Engineer"],
        careerFamilies: ["SOFTWARE_ENGINEERING"],
        primaryCoreStacks: ["Node.js"],
        acceptableCoreStacks: [],
        adjacentCareerTracks: [],
        desiredSeniorityLevels: [],
        preferredSkills: ["PostgreSQL"],
        excludedSkills: [],
        preferredLocations: ["Bengaluru"],
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
        workAuthorization: "AUTHORIZED_IN_MARKET",
        sponsorshipNeed: "NOT_REQUIRED",
        relocationPreference: "NOT_WILLING",
        totalExperienceYears: 4,
        currentTitle: "Backend Engineer",
        ...overrides
    };
}

function evaluate(jobPatch = {}, profilePatch = {}, resumePatch = {}, options = {}) {
    return evaluateMatchingPolicy(job(jobPatch), resume(resumePatch), profile(profilePatch), { now: NOW, ...options });
}

function codes(values = []) {
    return values.map((item) => item.code);
}

test("primary Node stack is eligible while an unaccepted Java primary stack is excluded", () => {
    const node = evaluate();
    const java = evaluate({
        title: "Java Backend Engineer",
        description: "Full-time backend role. Must have Java and Spring Boot. Minimum 5 years experience."
    });
    assert.equal(node.eligibility.status, "ELIGIBLE");
    assert.ok(codes(node.reasons).includes(MATCH_REASON_CODES.PRIMARY_STACK_MATCH));
    assert.equal(java.eligibility.status, "INELIGIBLE");
    assert.ok(codes(java.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.UNACCEPTED_PRIMARY_STACK));
    assert.ok(java.matchScore <= 35);
    assert.equal(shouldEscalateToAi(java), false, "AI cannot rescue a hard stack conflict");
});

test("an explicitly acceptable Java stack remains visible with a transparent penalty", () => {
    const result = evaluate({
        title: "Java Backend Engineer",
        description: "Full-time backend role. Must have Java. Minimum 5 years experience."
    }, { acceptableCoreStacks: ["Java"] }, { skills: ["Java"] });
    assert.equal(result.eligibility.status, "ELIGIBLE");
    assert.ok(codes(result.reasons).includes(MATCH_REASON_CODES.ACCEPTABLE_STACK_MATCH));
    assert.ok(codes(result.gaps).includes(MATCH_GAP_CODES.ACCEPTABLE_STACK_NOT_PRIMARY));
});

test("missing secondary skills are visible gaps, never hard exclusions", () => {
    const result = evaluate();
    assert.equal(result.eligibility.status, "ELIGIBLE");
    assert.ok(result.gaps.some((item) => item.code === MATCH_GAP_CODES.MISSING_SECONDARY_SKILL && /Kafka/.test(item.label)));
});

test("experience tolerance keeps 4-versus-5 visible and excludes 4-versus-10", () => {
    const nearby = evaluate();
    const unrealistic = evaluate({ yoe_min: 10 });
    assert.equal(nearby.eligibility.status, "ELIGIBLE");
    assert.ok(codes(nearby.gaps).includes(MATCH_GAP_CODES.SMALL_EXPERIENCE_GAP));
    assert.equal(unrealistic.eligibility.status, "INELIGIBLE");
    assert.ok(codes(unrealistic.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.EXPERIENCE_GAP_TOO_LARGE));
});

test("unknown salary, work mode, and sponsorship evidence stay eligible without score penalties", () => {
    const result = evaluate({
        description: "Backend engineering role. Must have Node.js and PostgreSQL. Minimum 4 years experience.",
        location: "Bengaluru, India",
        work_mode: "unstated",
        ctc_min_lpa: null,
        ctc_max_lpa: null,
        sponsorship_policy: "UNKNOWN"
    }, {
        preferredWorkModes: ["REMOTE"],
        minimumSalary: 25,
        sponsorshipNeed: "REQUIRED"
    });
    assert.equal(result.eligibility.status, "ELIGIBLE");
    assert.ok(codes(result.unknowns).includes(MATCH_UNKNOWN_CODES.WORK_MODE_UNKNOWN));
    assert.ok(codes(result.unknowns).includes(MATCH_UNKNOWN_CODES.COMPENSATION_UNKNOWN));
    assert.ok(codes(result.unknowns).includes(MATCH_UNKNOWN_CODES.SPONSORSHIP_POLICY_UNKNOWN));
    assert.equal(result.dimensions.workMode.score, 100);
    assert.equal(result.dimensions.compensation.score, 100);
});

test("unclassified roles remain eligible but cannot rank like verified target roles", () => {
    const classified = evaluate();
    const unknown = evaluate({
        title: "Enterprise Solutions Specialist",
        description: "Remote customer solutions role. Must have Node.js and PostgreSQL. Minimum 4 years experience."
    });
    assert.equal(unknown.eligibility.status, "ELIGIBLE");
    assert.ok(codes(unknown.unknowns).includes(MATCH_UNKNOWN_CODES.ROLE_CLASSIFICATION_UNKNOWN));
    assert.equal(unknown.dimensions.role.score, 35);
    assert.ok(unknown.matchScore < classified.matchScore);
});

test("an unstated primary stack stays eligible but cannot rank as a verified skills match", () => {
    const result = evaluate({
        title: "Senior Software Engineer",
        description: "Build reliable product features for customers. Minimum 4 years experience."
    });
    assert.equal(result.eligibility.status, "ELIGIBLE");
    assert.ok(codes(result.unknowns).includes(MATCH_UNKNOWN_CODES.PRIMARY_STACK_UNKNOWN));
    assert.equal(result.dimensions.skills.status, "UNKNOWN");
    assert.ok(result.dimensions.skills.score < 70);
    assert.ok(result.matchScore < 88);
});

test("legacy zero-year values are unknown unless the posting explicitly allows zero experience", () => {
    const legacy = evaluate({ yoe_min: 0, description: "Full-time backend role. Must have Node.js." });
    const explicit = evaluate({ yoe_min: 0, description: "Full-time backend role. Must have Node.js. No prior experience is required." });
    assert.equal(legacy.minimumExperienceYears, null);
    assert.ok(codes(legacy.unknowns).includes(MATCH_UNKNOWN_CODES.EXPERIENCE_REQUIREMENT_UNKNOWN));
    assert.equal(explicit.minimumExperienceYears, 0);
    assert.ok(codes(explicit.reasons).includes(MATCH_REASON_CODES.EXPERIENCE_MEETS_MINIMUM));
});

test("remote roles explicitly tied to a foreign market are excluded for India", () => {
    const result = evaluate({
        title: "Enterprise Solutions Engineer, Italy",
        location: "Remote",
        description: "Remote Italy-based customer engineering role. Must have Node.js."
    }, { preferredWorkModes: ["REMOTE"] });
    assert.ok(codes(result.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.REMOTE_COUNTRY_CONFLICT));
});

test("explicit hard preference conflicts dominate otherwise strong evidence", () => {
    const salary = evaluate({ ctc_max_lpa: 18 }, { minimumSalary: 25, compensationConstraintMode: "HARD" });
    const workMode = evaluate({ work_mode: "WFO" }, { preferredWorkModes: ["REMOTE"], workModeConstraintMode: "HARD" });
    const location = evaluate({ location: "Chennai, India" }, { locationConstraintMode: "HARD" });
    const contract = evaluate({ employment_type: "CONTRACT" }, { employmentTypeConstraintMode: "HARD" });
    assert.ok(codes(salary.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.COMPENSATION_HARD_CONFLICT));
    assert.ok(codes(workMode.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.WORK_MODE_HARD_CONFLICT));
    assert.ok(codes(location.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.LOCATION_HARD_CONFLICT));
    assert.ok(codes(contract.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.EMPLOYMENT_TYPE_HARD_CONFLICT));
});

test("soft location, work-mode, compensation, and employment mismatches stay rankable", () => {
    const result = evaluate({ location: "Chennai, India", work_mode: "WFO", ctc_max_lpa: 18, employment_type: "CONTRACT" }, {
        preferredWorkModes: ["REMOTE"],
        minimumSalary: 25
    });
    assert.equal(result.eligibility.status, "ELIGIBLE");
    assert.ok(codes(result.gaps).includes(MATCH_GAP_CODES.LOCATION_PREFERENCE_MISMATCH));
    assert.ok(codes(result.gaps).includes(MATCH_GAP_CODES.WORK_MODE_PREFERENCE_MISMATCH));
    assert.ok(codes(result.gaps).includes(MATCH_GAP_CODES.COMPENSATION_BELOW_PREFERENCE));
    assert.ok(codes(result.gaps).includes(MATCH_GAP_CODES.EMPLOYMENT_TYPE_PREFERENCE_MISMATCH));
});

test("remote country and sponsorship incompatibilities are hard only when explicit", () => {
    const geography = evaluate({ location: "Remote — US only", work_mode: "Remote" }, { preferredWorkModes: ["REMOTE"] });
    const sponsorship = evaluate({ sponsorship_policy: "NOT_AVAILABLE" }, { sponsorshipNeed: "REQUIRED" });
    assert.ok(codes(geography.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.REMOTE_COUNTRY_CONFLICT));
    assert.ok(codes(sponsorship.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.SPONSORSHIP_CONFLICT));
});

test("negated relocation, bond, and travel language never creates deal-breaker conflicts", () => {
    const safe = evaluate({
        description: "Full-time Node.js backend role. Must have Node.js. Minimum 4 years experience. No relocation required. No employment bond. No heavy travel required."
    }, { dealBreakers: ["MANDATORY_RELOCATION", "EMPLOYMENT_BOND", "HEAVY_TRAVEL"] });
    assert.equal(safe.eligibility.status, "ELIGIBLE");
    const normalized = normalizeJobForRegistry(job({
        description: "No relocation required. No employment bond. No heavy travel required."
    }));
    assert.equal(normalized.relocationPolicy, "NOT_REQUIRED");
    assert.equal(normalized.bondPolicy, "NONE_EXPLICIT");
    assert.equal(normalized.travelRequirement, "NONE");
});

test("explicit deal-breakers, company exclusions, unrelated roles, and unsupported leadership exclude", () => {
    const shift = evaluate({ description: "Full-time Node.js backend role requiring night shifts. Minimum 4 years experience." }, { dealBreakers: ["NIGHT_SHIFT"] });
    const company = evaluate({}, { excludedCompanies: ["Acme"] });
    const role = evaluate({ title: "Data Analyst", description: "Full-time analytics role. Must have SQL. Minimum 4 years experience." });
    const manager = evaluate({ title: "Engineering Manager", description: "Full-time Node.js engineering management role. Must have Node.js. Minimum 4 years experience." }, {
        totalExperienceYears: 8
    });
    assert.ok(codes(shift.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.NIGHT_SHIFT_CONFLICT));
    assert.ok(codes(company.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.EXCLUDED_COMPANY));
    assert.ok(codes(role.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.UNRELATED_ROLE_FAMILY));
    assert.ok(codes(manager.eligibility.exclusions).includes(MATCH_EXCLUSION_CODES.UNSUPPORTED_LEADERSHIP_LEVEL));
});

test("verified leadership evidence can support an engineering leadership role", () => {
    const result = evaluate({
        title: "Engineering Manager",
        description: "Full-time Node.js engineering management role. Must have Node.js. Minimum 6 years experience."
    }, { totalExperienceYears: 8 }, {
        experience: [{ title: "Senior Backend Engineer", bullets: ["Led a team of six engineers and handled performance reviews."] }]
    });
    assert.equal(result.eligibility.status, "ELIGIBLE");
});

test("every deterministic decision is traceable and versioned by dimension", () => {
    const result = assertMatchDecision(evaluate());
    assert.equal(result.versions.profileVersion, 4);
    assert.equal(result.versions.algorithmVersion, "matching-policy-v1.3");
    assert.deepEqual(Object.keys(result.dimensions), [
        "role", "skills", "experience", "workMode", "location", "compensation", "employmentType", "seniority"
    ]);
    for (const [name, value] of Object.entries(result.dimensions)) {
        assert.ok(Number.isFinite(value.score), `${name} has a numeric score`);
        assert.ok(Array.isArray(value.codes), `${name} exposes reason codes`);
    }
    assert.equal(result.aiEscalated, false);
    assert.equal(result.scoringMethod, "MATCHING_POLICY_V1");
});
