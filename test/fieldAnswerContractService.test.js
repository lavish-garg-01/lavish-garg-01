import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const candidatePrivate = (kind, properties) => ({
    schemaVersion: 1,
    dataClass: "CANDIDATE_PRIVATE",
    kind,
    ...properties
});

test("Part 2B builds deterministic, scoped FieldAnswerContracts in SHADOW", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "field-answer-contract-"));
    process.env.DATABASE_PATH = path.join(directory, "contracts.db");
    const { closeDb } = await import("../src/database/connection.js");
    const { stableContractHash } = await import("../src/contracts/contractPrimitives.js");
    const { fieldAnswerContractSchema } = await import("../src/contracts/fieldAnswerContract.js");
    const { saveCandidateAnswerVersion } = await import("../src/repositories/candidateAnswerVersionRepository.js");
    const {
        buildFieldAnswerContracts,
        FIELD_ANSWER_CONTRACT_MODE,
        resolveBaselineRepresentation
    } = await import("../src/services/fieldAnswerContractService.js");

    const semantic = (canonicalKey, fingerprintSeed = canonicalKey) => ({
        schemaVersion: 1,
        descriptorFingerprint: stableContractHash({ fingerprintSeed }),
        status: "RESOLVED",
        canonicalKey,
        mappingId: `mapping_${canonicalKey.toLowerCase()}`,
        mappingVersion: 1,
        resolver: "DETERMINISTIC",
        confidence: 0.98,
        candidates: [{ canonicalKey, confidence: 0.98, source: "DETERMINISTIC" }],
        optionSetHash: null,
        valueFree: true,
        reasonCodes: ["TEST_RESOLVED"]
    });

    try {
        assert.equal(FIELD_ANSWER_CONTRACT_MODE, "SHADOW");
        const email = saveCandidateAnswerVersion({
            userId: "candidate-1",
            canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "asha@example.com" }),
            source: "EXPLICIT_SAVE",
            sourceVersionId: "profile_version_1",
            expectedActiveVersionId: null,
            idempotencyKey: "email-v1",
            candidateApproved: true
        });
        saveCandidateAnswerVersion({
            userId: "candidate-1",
            canonicalKey: "WORK_AUTHORIZATION",
            normalizedValue: candidatePrivate("BOOLEAN", { value: true }),
            context: { countryCode: "IN" },
            scopeQualifiers: { country: "IN" },
            source: "USER_ENTERED",
            expectedActiveVersionId: null,
            idempotencyKey: "work-auth-in-v1",
            candidateApproved: true
        });
        saveCandidateAnswerVersion({
            userId: "candidate-1",
            canonicalKey: "TOTAL_EXPERIENCE",
            normalizedValue: candidatePrivate("DURATION", { months: 56 }),
            source: "DERIVED",
            expectedActiveVersionId: null,
            idempotencyKey: "experience-v1",
            candidateApproved: true
        });
        saveCandidateAnswerVersion({
            userId: "candidate-1",
            canonicalKey: "NOTICE_PERIOD",
            normalizedValue: candidatePrivate("INTEGER", { value: 30 }),
            source: "USER_ENTERED",
            confirmedAt: "2026-06-01T00:00:00.000Z",
            expectedActiveVersionId: null,
            idempotencyKey: "notice-v1",
            candidateApproved: true
        });

        const requests = [
            { fieldId: "email", semantic: semantic("EMAIL"), control: { type: "email", maxLength: 120 } },
            { fieldId: "authorization", semantic: semantic("WORK_AUTHORIZATION"), control: {
                type: "radio", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
            } },
            { fieldId: "experience", semantic: semantic("TOTAL_EXPERIENCE"), control: { type: "number" } },
            { fieldId: "notice", semantic: semantic("NOTICE_PERIOD"), control: { type: "number" } },
            { fieldId: "unknown", semantic: {
                ...semantic("EMAIL", "unknown"), status: "UNKNOWN", canonicalKey: null,
                mappingId: null, mappingVersion: null, resolver: "NONE", confidence: 0, candidates: []
            }, control: { type: "text" } }
        ];
        const results = buildFieldAnswerContracts({
            userId: "candidate-1",
            fields: requests,
            context: { countryCode: "IN" },
            now: new Date("2026-08-31T00:00:00.000Z")
        });
        const byId = new Map(results.map((result) => [result.fieldId, result]));

        const emailResult = byId.get("email");
        assert.equal(emailResult.status, "READY");
        assert.equal(emailResult.contract.candidateAnswerVersionId, email.id);
        assert.equal(emailResult.contract.source, "USER_ENTERED");
        assert.equal(emailResult.contract.representation.ruleKey, "TEXT_IDENTITY");
        assert.equal(emailResult.contract.representation.renderedValue, "asha@example.com");
        assert.equal(fieldAnswerContractSchema.safeParse(emailResult.contract).success, true);
        assert.equal(emailResult.contract.normalizedValueHash, stableContractHash(emailResult.contract.normalizedValue));
        assert.equal(emailResult.contract.representation.renderedValueHash,
            stableContractHash(emailResult.contract.representation.renderedValue));

        const repeated = buildFieldAnswerContracts({
            userId: "candidate-1", fields: [requests[0]], context: { countryCode: "IN" },
            now: new Date("2026-08-31T00:00:00.000Z")
        })[0];
        assert.equal(repeated.contract.contractId, emailResult.contract.contractId,
            "the same semantic, truth and representation versions need a stable contract id");

        const authorization = byId.get("authorization");
        assert.equal(authorization.status, "REVIEW_REQUIRED");
        assert.equal(authorization.contract.review, "RECOMMENDED");
        assert.equal(authorization.contract.scope.scopeType, "COUNTRY");
        assert.equal(authorization.contract.scope.scopeKey, "IN");
        assert.equal(authorization.contract.representation.renderedValue, "yes");

        assert.equal(byId.get("experience").status, "NEEDS_USER");
        assert.ok(byId.get("experience").reasonCodes.includes("REPRESENTATION_NOT_IMPLEMENTED_DURATION"));
        assert.equal(byId.get("notice").status, "NEEDS_USER");
        assert.ok(byId.get("notice").reasonCodes.includes("ANSWER_REQUIRES_RECONFIRMATION"));
        assert.equal(byId.get("unknown").contract, null);
        assert.ok(byId.get("unknown").reasonCodes.includes("FIELD_SEMANTIC_UNKNOWN"));

        const wrongCountry = buildFieldAnswerContracts({
            userId: "candidate-1",
            fields: [requests[1]],
            context: { countryCode: "DE" }
        })[0];
        assert.equal(wrongCountry.status, "NEEDS_USER");
        assert.equal(wrongCountry.contract, null);
        assert.ok(wrongCountry.reasonCodes.includes("NO_COMPATIBLE_CANDIDATE_TRUTH"));

        const ambiguousBoolean = resolveBaselineRepresentation(candidatePrivate("BOOLEAN", { value: true }), {
            type: "radio",
            options: [{ value: "yes", label: "Yes" }, { value: "YES", label: "yes" }]
        });
        assert.equal(ambiguousBoolean.ok, false);
        assert.ok(ambiguousBoolean.reasonCodes.includes("BOOLEAN_OPTION_NOT_UNAMBIGUOUS"));
        const untrustedPattern = resolveBaselineRepresentation(candidatePrivate("STRING", { value: "Asha" }), {
            type: "text", pattern: "(a+)+$"
        });
        assert.equal(untrustedPattern.ok, false);
        assert.ok(untrustedPattern.reasonCodes.includes("CONTROL_PATTERN_REQUIRES_BROWSER_VALIDATION"));
        const forbiddenPassword = resolveBaselineRepresentation(candidatePrivate("STRING", { value: "secret" }), {
            type: "password"
        });
        assert.equal(forbiddenPassword.ok, false);
        assert.ok(forbiddenPassword.reasonCodes.includes("CONTROL_TYPE_FORBIDDEN"));
        const numericBounds = resolveBaselineRepresentation(candidatePrivate("INTEGER", { value: 31 }), {
            type: "number", min: 0, max: 365, step: 5
        });
        assert.equal(numericBounds.ok, false);
        assert.ok(numericBounds.reasonCodes.includes("CONTROL_NUMBER_STEP_MISMATCH"));
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
