import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    assertConnectedJobsPolicy,
    CONNECTED_JOBS_POLICY,
    MATCH_DECISION_CONTRACT
} from "../src/config/connectedJobsPolicy.js";
import { env } from "../src/config/environment.js";

test("Connected Jobs policy locks the agreed discovery and personal-state lifecycle", () => {
    assert.equal(CONNECTED_JOBS_POLICY.version, 1);
    assert.equal(CONNECTED_JOBS_POLICY.algorithmVersion, "matching-policy-v1.3");
    assert.equal(CONNECTED_JOBS_POLICY.discovery.freshThroughDays, 7);
    assert.equal(CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays, 14);
    assert.equal(CONNECTED_JOBS_POLICY.discovery.olderJobTreatment, "HIDDEN");
    assert.equal(CONNECTED_JOBS_POLICY.availabilityVerification.maxOpenClaimsPerJob, 1);
    assert.equal(CONNECTED_JOBS_POLICY.availabilityVerification.unsupportedReportsToClose, 2);
    assert.equal(CONNECTED_JOBS_POLICY.availabilityVerification.singleUnsupportedReportTreatment, "SUSPECTED_CLOSED");
    assert.equal(CONNECTED_JOBS_POLICY.availabilityVerification.conflictingReportsTreatment, "UNKNOWN");
    assert.equal(CONNECTED_JOBS_POLICY.availabilityVerification.candidateAnswersStored, false);
    assert.equal(CONNECTED_JOBS_POLICY.savedJobs.ignoresDiscoveryAge, true);
    assert.equal(CONNECTED_JOBS_POLICY.savedJobs.retainUntilUserUnsaves, true);
    assert.equal(CONNECTED_JOBS_POLICY.savedJobs.copilotAllowedWhenClosed, false);
    assert.equal(CONNECTED_JOBS_POLICY.dismissedJobs.scope, "MATERIAL_JOB_VERSION");
    assert.equal(CONNECTED_JOBS_POLICY.appliedJobs.nearDuplicateCooldownDays, 45);
    assert.equal(env.ingestion.maxJobAgeDays, CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays);
});

test("unknown posting evidence stays eligible while explicit incompatibilities are hard", () => {
    assert.equal(CONNECTED_JOBS_POLICY.evidence.missingPostingEvidence, "UNKNOWN");
    assert.equal(CONNECTED_JOBS_POLICY.evidence.unknownCreatesHardConflict, false);
    assert.equal(CONNECTED_JOBS_POLICY.evidence.hardExclusionsRequireExplicitEvidence, true);
    assert.equal(CONNECTED_JOBS_POLICY.location.explicitRemoteCountryConflict, "HARD_EXCLUDE");
    assert.equal(CONNECTED_JOBS_POLICY.exclusions.explicitSponsorshipConflict, "HARD_EXCLUDE");
    assert.equal(CONNECTED_JOBS_POLICY.exclusions.explicitWorkAuthorizationConflict, "HARD_EXCLUDE");
    for (const dealBreaker of ["NIGHT_SHIFT", "MANDATORY_RELOCATION", "EMPLOYMENT_BOND", "HEAVY_TRAVEL"]) {
        assert.ok(CONNECTED_JOBS_POLICY.exclusions.supportedDealBreakers.includes(dealBreaker));
    }
});

test("ranking policy separates hard core requirements from soft preferences", () => {
    assert.equal(CONNECTED_JOBS_POLICY.compensation.missingSalaryTreatment, "UNKNOWN_NO_PENALTY");
    assert.equal(CONNECTED_JOBS_POLICY.employmentType.defaultMode, "SOFT");
    assert.equal(CONNECTED_JOBS_POLICY.employmentType.fullTimePreferenceAllowsContract, true);
    assert.equal(CONNECTED_JOBS_POLICY.experience.smallGapTreatment, "VISIBLE_WITH_PENALTY");
    assert.equal(CONNECTED_JOBS_POLICY.experience.unrealisticGapTreatment, "HARD_EXCLUDE");
    assert.equal(CONNECTED_JOBS_POLICY.skills.missingPrimaryCoreStack, "HARD_EXCLUDE");
    assert.equal(CONNECTED_JOBS_POLICY.skills.missingSecondarySkill, "VISIBLE_WITH_GAP");
    assert.equal(CONNECTED_JOBS_POLICY.roles.unrelatedFamilyTreatment, "HARD_EXCLUDE");
    assert.equal(CONNECTED_JOBS_POLICY.roles.explicitAdjacentTrackTreatment, "VISIBLE_WITH_PENALTY");
});

test("Free matching and explanations require no AI inference", () => {
    assert.equal(CONNECTED_JOBS_POLICY.freePlan.aiRequiredForJobMatching, false);
    assert.equal(CONNECTED_JOBS_POLICY.freePlan.aiRequiredForMatchExplanation, false);
    assert.equal(CONNECTED_JOBS_POLICY.freePlan.explanationSource, "DETERMINISTIC_EVIDENCE");
    assert.deepEqual(MATCH_DECISION_CONTRACT.requiredVersions,
        ["profileVersion", "jobMatchVersion", "algorithmVersion"]);
    assert.deepEqual(MATCH_DECISION_CONTRACT.scoreDimensions,
        ["role", "skills", "experience", "location", "workMode", "compensation", "employmentType", "seniority"]);
});

test("policy is immutable and invalid edits require a new valid version", () => {
    assert.equal(Object.isFrozen(CONNECTED_JOBS_POLICY), true);
    assert.equal(Object.isFrozen(CONNECTED_JOBS_POLICY.discovery), true);
    assert.throws(() => {
        CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays = 30;
    }, TypeError);

    const invalid = structuredClone(CONNECTED_JOBS_POLICY);
    invalid.discovery.eligibleThroughDays = 7;
    invalid.freePlan.aiRequiredForJobMatching = true;
    assert.throws(() => assertConnectedJobsPolicy(invalid), /freshThroughDays.*Free matching/s);
});

test("Node 24 is project-local and enforced for both backend and frontend installs", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const backend = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const frontend = JSON.parse(fs.readFileSync(path.join(root, "web/package.json"), "utf8"));
    assert.equal(fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim(), "24");
    assert.equal(fs.readFileSync(path.join(root, "web/.nvmrc"), "utf8").trim(), "24");
    assert.equal(backend.engines.node, "24.x");
    assert.equal(frontend.engines.node, "24.x");
    assert.match(fs.readFileSync(path.join(root, ".npmrc"), "utf8"), /engine-strict=true/);
    assert.equal(Number(process.versions.node.split(".")[0]), 24);
});
