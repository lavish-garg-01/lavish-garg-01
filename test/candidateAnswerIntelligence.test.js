import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const candidatePrivate = (kind, properties) => ({ schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind, ...properties });

test("Phase 2A policies, controlled contexts, and persistent candidate truth fail closed", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-intelligence-"));
    process.env.DATABASE_PATH = path.join(directory, "answers.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        answerPolicyDiagnostics, getActiveAnswerPolicy, ensureAnswerPolicyRegistry,
        listActiveAnswerPolicies, sharedAnswerPolicy
    } = await import("../src/services/answerPolicyRegistry.js");
    const {
        ensureAnswerContextRegistry, normalizeAnswerContext, syncEmployerContextRegistry
    } = await import("../src/services/answerContextNormalization.js");
    const { primarySharedScope } = await import("../src/services/scopeRankPolicy.js");
    const {
        CandidateAnswerConflictError, candidateTruthDiagnostics, listCandidateAnswerVersions, resolveCandidateTruth,
        saveCandidateAnswerVersion, selectBestCandidateTruth
    } = await import("../src/repositories/candidateAnswerVersionRepository.js");

    try {
        const db = getDb();
        const seeded = ensureAnswerPolicyRegistry();
        assert.ok(seeded.canonicalCount >= 40);
        assert.equal(seeded.policyCount, seeded.canonicalCount, "every current canonical needs one active policy");
        assert.equal(answerPolicyDiagnostics().missingPolicies.length, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM canonical_answer_policies").get().count, seeded.policyCount);

        const identity = getActiveAnswerPolicy("EMAIL");
        assert.equal(identity.answerKind, "STABLE_FACT");
        assert.equal(identity.learningMode, "AUTO_VERSION");
        assert.equal(identity.scopePolicy, "GLOBAL");
        const legal = getActiveAnswerPolicy("WORK_AUTHORIZATION");
        assert.equal(legal.answerKind, "LEGAL_FACT");
        assert.deepEqual(legal.requiredScopeDimensions, ["COUNTRY"]);
        const entity = getActiveAnswerPolicy("PREVIOUS_EMPLOYEE");
        assert.deepEqual(entity.requiredScopeDimensions, ["COMPANY_GROUP"]);
        const protectedPolicy = getActiveAnswerPolicy("EEO_GENDER");
        assert.equal(protectedPolicy.riskTier, "PROHIBITED");
        assert.equal(protectedPolicy.learningMode, "NEVER");
        assert.equal(listActiveAnswerPolicies().length, seeded.policyCount);
        assert.equal(sharedAnswerPolicy(identity, primarySharedScope(identity)).reuseDecision, "AUTO_VERSION");

        ensureAnswerContextRegistry();
        const india = normalizeAnswerContext({ country: "India" }, { policy: legal });
        assert.equal(india.ok, true);
        assert.equal(india.context.country, "IN");
        const unknownCountry = normalizeAnswerContext({ country: "Atlantis" }, { policy: legal });
        assert.equal(unknownCountry.ok, false, "unknown jurisdictions must fail closed for legal facts");
        const unknownEmployer = normalizeAnswerContext({ companyName: "Unknown Similar Company" }, { policy: entity });
        assert.equal(unknownEmployer.ok, false, "fuzzy company names must never authorize entity-scoped reuse");

        db.prepare("INSERT INTO companies (id, name, domain) VALUES ('company-policy', 'Razorpay Software Pvt Ltd', 'razorpay.com')").run();
        db.prepare("INSERT INTO companies (id, name, domain) VALUES ('company-policy-duplicate', 'Razorpay Software Pvt Ltd', 'razorpay.com')").run();
        syncEmployerContextRegistry();
        const employer = normalizeAnswerContext({ companyId: "company-policy" }, { policy: entity });
        assert.equal(employer.ok, true);
        assert.match(employer.context.companyGroup, /^employer-group:/);
        assert.equal(normalizeAnswerContext({ companyId: "company-policy-duplicate" }, { policy: entity }).context.companyGroup,
            employer.context.companyGroup, "exact duplicate source companies should share one controlled employer group");

        const firstEmail = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "asha@example.com" }),
            expectedActiveVersionId: null, idempotencyKey: "email-create", candidateApproved: true
        });
        const retriedEmail = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "asha@example.com" }),
            expectedActiveVersionId: null, idempotencyKey: "email-create", candidateApproved: true
        });
        assert.equal(retriedEmail.id, firstEmail.id, "an exact retry must be idempotent");
        assert.throws(() => saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "other@example.com" }),
            expectedActiveVersionId: firstEmail.id, idempotencyKey: "email-create", candidateApproved: true
        }), CandidateAnswerConflictError);
        assert.throws(() => saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "new@example.com" }),
            expectedActiveVersionId: null, idempotencyKey: "email-stale-write", candidateApproved: true
        }), CandidateAnswerConflictError, "a replacement must name the active version it observed");
        const secondEmail = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "new@example.com" }),
            expectedActiveVersionId: firstEmail.id, idempotencyKey: "email-replace", candidateApproved: true
        });
        const emailHistory = listCandidateAnswerVersions("local-user", { canonicalKey: "EMAIL" });
        assert.equal(emailHistory.length, 2);
        assert.equal(emailHistory.find((row) => row.id === firstEmail.id).status, "SUPERSEDED");
        assert.equal(emailHistory.find((row) => row.id === secondEmail.id).status, "ACTIVE");
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EMAIL" }).answerVersion.id, secondEmail.id);
        saveCandidateAnswerVersion({
            userId: "other-user", canonicalKey: "EMAIL",
            normalizedValue: candidatePrivate("STRING", { value: "private-other@example.com" }),
            expectedActiveVersionId: null, idempotencyKey: "email-create", candidateApproved: true
        });
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "EMAIL" }).length, 2);
        assert.equal(listCandidateAnswerVersions("other-user", { canonicalKey: "EMAIL" }).length, 1);
        assert.doesNotMatch(JSON.stringify(listCandidateAnswerVersions("local-user")), /private-other@example\.com/);
        assert.doesNotMatch(JSON.stringify(candidateTruthDiagnostics()), /asha@example\.com|new@example\.com|private-other@example\.com/,
            "operator diagnostics must not expose candidate values");

        const authorization = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "WORK_AUTHORIZATION",
            normalizedValue: candidatePrivate("BOOLEAN", { value: true }),
            context: { country: "India" }, scopeQualifiers: { country: "IN" },
            expectedActiveVersionId: null, idempotencyKey: "authorization-in", candidateApproved: true
        });
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "WORK_AUTHORIZATION",
            context: { countryCode: "IN" } }).answerVersion.id, authorization.id);
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "WORK_AUTHORIZATION",
            context: { countryCode: "US" } }).status, "MISSING");
        assert.throws(() => saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "SPONSORSHIP",
            normalizedValue: candidatePrivate("BOOLEAN", { value: false }),
            context: { country: "India" }, scopeQualifiers: { country: "IN" }, source: "DERIVED",
            expectedActiveVersionId: null, idempotencyKey: "derived-legal", candidateApproved: true
        }), /direct candidate source/i, "legal facts may not be inferred from a derived source");
        assert.throws(() => saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "PHONE",
            normalizedValue: candidatePrivate("PHONE", { countryCode: "+91", nationalNumber: "9876543210", extension: null }),
            confirmedAt: "2099-01-01T00:00:00.000Z",
            expectedActiveVersionId: null, idempotencyKey: "future-confirmation", candidateApproved: true
        }), /future/i);

        const globalSalary = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EXPECTED_CTC",
            normalizedValue: candidatePrivate("MONEY", { amountExact: "2400000", currency: "INR", period: "YEAR" }),
            expectedActiveVersionId: null, idempotencyKey: "salary-global", candidateApproved: true
        });
        const scopedSalary = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EXPECTED_CTC",
            normalizedValue: candidatePrivate("MONEY", { amountExact: "2800000", currency: "INR", period: "YEAR" }),
            context: { companyId: "company-policy", roleTitle: "Backend Engineer", location: "Bengaluru", employmentType: "Full-time" },
            scopeQualifiers: { companyGroup: employer.context.companyGroup },
            expectedActiveVersionId: null, idempotencyKey: "salary-razorpay", candidateApproved: true
        });
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EXPECTED_CTC",
            context: { companyId: "company-policy", roleTitle: "Backend Engineer", location: "Bengaluru", employmentType: "Full-time" } }).answerVersion.id, scopedSalary.id);
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EXPECTED_CTC" }).answerVersion.id, globalSalary.id);
        const changedSalaryUnit = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EXPECTED_CTC",
            normalizedValue: candidatePrivate("MONEY", { amountExact: "30000", currency: "USD", period: "YEAR" }),
            expectedActiveVersionId: globalSalary.id, idempotencyKey: "salary-unit-change", candidateApproved: true
        });
        assert.equal(changedSalaryUnit.anomaly.suspicious, true);
        assert.ok(changedSalaryUnit.anomaly.reasonCodes.includes("COMPENSATION_UNIT_CHANGED"));

        saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "NOTICE_PERIOD",
            normalizedValue: candidatePrivate("INTEGER", { value: 30 }),
            confirmedAt: "2026-06-01T00:00:00.000Z",
            expectedActiveVersionId: null, idempotencyKey: "stale-notice", candidateApproved: true
        });
        const staleNotice = resolveCandidateTruth({ userId: "local-user", canonicalKey: "NOTICE_PERIOD",
            now: new Date("2026-08-31T00:00:00.000Z") });
        assert.equal(staleNotice.status, "NEEDS_USER");
        assert.ok(staleNotice.reasonCodes.includes("ANSWER_REQUIRES_RECONFIRMATION"));

        const equalRankConflict = selectBestCandidateTruth([
            { id: "a", status: "ACTIVE", scopeQualifiers: {}, scopeRank: [0], normalizedHash: "a", createdAt: "2026-08-30", validUntil: null },
            { id: "b", status: "ACTIVE", scopeQualifiers: {}, scopeRank: [0], normalizedHash: "b", createdAt: "2026-08-31", validUntil: null }
        ], identity, {});
        assert.equal(equalRankConflict.status, "NEEDS_USER");
        assert.deepEqual(equalRankConflict.reasonCodes, ["EQUAL_RANK_NON_EQUIVALENT_ANSWERS"]);

        const currentTitle = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "CURRENT_CAREER_STAGE",
            normalizedValue: candidatePrivate("STRING", { value: "Senior" }),
            expectedActiveVersionId: null, idempotencyKey: "career-stage", candidateApproved: true
        });
        const company = saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "CURRENT_COMPANY",
            normalizedValue: candidatePrivate("STRING", { value: "New Employer" }),
            expectedActiveVersionId: null, idempotencyKey: "company-change", candidateApproved: true
        });
        assert.ok(company.dependencyInvalidations >= 1);
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "CURRENT_CAREER_STAGE" })
            .find((row) => row.id === currentTitle.id).status, "INVALIDATED");
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "CURRENT_CAREER_STAGE" }).status, "MISSING");

        assert.throws(() => saveCandidateAnswerVersion({
            userId: "local-user", canonicalKey: "EEO_GENDER",
            normalizedValue: candidatePrivate("ENUM", { value: { key: "x", label: "Prefer not to say" } }),
            expectedActiveVersionId: null, idempotencyKey: "protected", candidateApproved: true
        }), /not allowed/i);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM candidate_answer_versions WHERE canonical_key = 'EEO_GENDER'").get().count, 0);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("future Supabase contract keeps candidate truth own-row and mutation service-only", () => {
    const sql = fs.readFileSync("supabase/phase2_candidate_truth_rls.sql", "utf8");
    for (const table of ["candidate_answer_versions", "candidate_answer_write_receipts", "candidate_answer_dependency_events",
        "candidate_answer_migration_runs", "candidate_answer_migration_items", "candidate_answer_change_sets",
        "candidate_answer_reversal_sets", "candidate_answer_reversal_items", "candidate_answer_reversal_receipts",
        "candidate_answer_change_set_items", "candidate_answer_change_set_receipts"]) {
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
        assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`));
        assert.match(sql, new RegExp(`${table}_select_own`));
    }
    assert.match(sql, /user_id = auth\.uid\(\)::text/);
    assert.doesNotMatch(sql, /candidate_answer_versions_(?:insert|update|delete)_own/);
    assert.match(sql, /for select to authenticated using \(true\)/);
});
