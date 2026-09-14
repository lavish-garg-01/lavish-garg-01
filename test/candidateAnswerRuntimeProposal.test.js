import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

test("Part 2C stages private answers, commits only after verification, reviews consequential changes, and supports discard", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-answer-runtime-"));
    process.env.DATABASE_PATH = path.join(directory, "runtime.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { ensureApplicationAttempt } = await import("../src/repositories/learningRepository.js");
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const { ensureAnswerPolicyRegistry } = await import("../src/services/answerPolicyRegistry.js");
    const { classifyAttemptAtCheckpoint, recordCheckpointReceipt, recordNeutralObservation } = await import("../src/services/fieldRevisionService.js");
    const {
        commitPendingCandidateAnswerReviews,
        discardPendingCandidateAnswerReviews,
        finalizeRuntimeCandidateAnswerProposals,
        listPendingCandidateAnswerReviews,
        normalizeRuntimeCandidateAnswer,
        stageManualCandidateAnswerProposal
    } = await import("../src/services/candidateAnswerRuntimeProposalService.js");
    const { getActiveAnswerPolicy } = await import("../src/services/answerPolicyRegistry.js");
    const { listCandidateAnswerVersions } = await import("../src/repositories/candidateAnswerVersionRepository.js");

    try {
        const db = getDb();
        ensureAnswerPolicyRegistry();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, reusable_answer_consent, preferred_locations, skills, target_roles, preferred_work_modes)
            VALUES ('local-user', 'Candidate', 'candidate@example.com', 1, '[]', '[]', '[]', '[]')`).run();
        db.prepare("INSERT INTO companies (id, name, domain) VALUES ('company-runtime', 'Acme Labs', 'acme.example')").run();
        db.prepare(`INSERT INTO jobs
            (id, company_id, title, location, description, url, source, country_code, employment_type)
            VALUES ('job-runtime', 'company-runtime', 'Backend Engineer', 'Bengaluru', '',
                'https://acme.example/job', 'test', 'IN', 'FULL_TIME')`).run();
        db.prepare(`INSERT INTO applications (id, job_id, user_id, adapter)
            VALUES ('app-runtime', 'job-runtime', 'local-user', 'EXTENSION')`).run();
        const attempt = ensureApplicationAttempt("app-runtime", "https://acme.example/apply");
        let clock = Date.now();

        const observeAndStage = (canonicalKey, raw, suffix) => {
            const logical = hash(`logical-${suffix}`);
            const observation = buildFieldInteractionObservation({
                id: logical,
                logicalFieldId: logical,
                semanticKey: canonicalKey,
                fillOutcome: "USER_CORRECTED",
                finalState: "USER_EDITED",
                source: "USER_MANUAL_INPUT",
                finalValueHash: hash(raw),
                completedByUser: true,
                valid: true
            }, {
                applicationId: "app-runtime",
                attemptId: attempt.id,
                observationId: `observation:${suffix}`,
                checkpoint: { type: "NONE", status: "NOT_OBSERVED" },
                clientTimeMs: clock += 10
            });
            recordNeutralObservation("app-runtime", observation);
            const staged = stageManualCandidateAnswerProposal({
                userId: "local-user",
                applicationId: "app-runtime",
                runId: attempt.id,
                observation,
                canonicalKey,
                rawValue: raw,
                field: { label: canonicalKey.replaceAll("_", " "), type: "text", options: [] }
            });
            assert.equal(staged.staged, true, staged.reasonCodes?.join(", "));
            return staged;
        };
        const checkpoint = (id, type = "SUBMISSION") => {
            const receipt = {
                schemaVersion: 1,
                checkpointId: `checkpoint:${id}`,
                runId: attempt.id,
                applicationId: "app-runtime",
                applicationContentRevisionId: null,
                type,
                status: "VERIFIED",
                source: type === "SUBMISSION" ? "EMPLOYER_RECEIPT" : "CANDIDATE_GESTURE",
                observedAtMs: clock += 100,
                evidenceHash: hash(`evidence-${id}`),
                valueFree: true
            };
            recordCheckpointReceipt("app-runtime", receipt);
            classifyAttemptAtCheckpoint("app-runtime", receipt);
            return receipt;
        };

        observeAndStage("FULL_NAME", "Asha Sharma", "name");
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "FULL_NAME" }).length, 0,
            "an unfinished application must not mutate candidate truth");
        const submission = checkpoint("first-submit");
        const learned = finalizeRuntimeCandidateAnswerProposals({
            userId: "local-user", applicationId: "app-runtime", runId: attempt.id,
            checkpointId: submission.checkpointId
        });
        assert.equal(learned.summary.learned, 1);
        assert.equal(learned.summary.canUndo, true);
        assert.deepEqual(learned.summary.canonicalKeys, ["FULL_NAME"]);
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "FULL_NAME", includeInactive: false })[0]
            .normalizedValue.value, "Asha Sharma");

        observeAndStage("CURRENT_COMPANY", "Acme Labs", "company");
        const second = checkpoint("company-submit");
        const held = finalizeRuntimeCandidateAnswerProposals({
            userId: "local-user", applicationId: "app-runtime", runId: attempt.id,
            checkpointId: second.checkpointId
        });
        assert.equal(held.summary.needsReview, 1);
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "CURRENT_COMPANY" }).length, 0);
        const reviewGroup = listPendingCandidateAnswerReviews("local-user")[0];
        assert.equal(reviewGroup.proposals[0].normalizedValue.value, "Acme Labs",
            "the candidate review API may return the candidate's own private value");

        const explicit = checkpoint("company-explicit", "EXPLICIT_SAVE");
        const approved = commitPendingCandidateAnswerReviews({
            userId: "local-user",
            applicationId: "app-runtime",
            runId: attempt.id,
            checkpointId: explicit.checkpointId,
            proposalIds: [reviewGroup.proposals[0].id],
            idempotencyKey: "explicit-company-save"
        });
        assert.equal(approved.itemCount, 1);
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "CURRENT_COMPANY", includeInactive: false })[0]
            .normalizedValue.value, "Acme Labs");

        observeAndStage("NOTICE_PERIOD", "30 days", "notice");
        const third = checkpoint("notice-submit");
        finalizeRuntimeCandidateAnswerProposals({
            userId: "local-user", applicationId: "app-runtime", runId: attempt.id,
            checkpointId: third.checkpointId
        });
        const notice = listPendingCandidateAnswerReviews("local-user")[0].proposals
            .find((proposal) => proposal.canonicalKey === "NOTICE_PERIOD");
        assert.ok(notice);
        assert.equal(discardPendingCandidateAnswerReviews("local-user", [notice.id]).discarded, 1);
        assert.equal(listPendingCandidateAnswerReviews("local-user").length, 0);
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "NOTICE_PERIOD" }).length, 0);

        observeAndStage("EMAIL", "unfinished@example.com", "unfinished");
        assert.equal(listCandidateAnswerVersions("local-user", { canonicalKey: "EMAIL" }).length, 0,
            "staging without a later strong checkpoint remains application-local");

        assert.equal(normalizeRuntimeCandidateAnswer({
            rawValue: "twelve-ish",
            policy: getActiveAnswerPolicy("CURRENT_CTC"),
            field: { label: "Current CTC" }
        }).ok, false, "ambiguous compensation must fail closed");
        assert.equal(normalizeRuntimeCandidateAnswer({
            rawValue: "12 LPA",
            policy: getActiveAnswerPolicy("CURRENT_CTC"),
            field: { label: "Current CTC" }
        }).normalizedValue.amountExact, "1200000");

        const valueFreeAudit = JSON.stringify({
            checkpoints: db.prepare("SELECT contract_json FROM application_checkpoint_receipts").all(),
            outbox: db.prepare("SELECT payload_json FROM extension_backend_outbox").all()
        });
        assert.doesNotMatch(valueFreeAudit, /Asha Sharma|Acme Labs|unfinished@example\.com/,
            "extension durable telemetry and outbox summaries remain value-free");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("Part 2C extension source propagates answer versions and exposes reversible value-free summaries", () => {
    const content = fs.readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
    const background = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
    const panel = fs.readFileSync(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
    assert.match(content, /answerVersionId: action\.candidateAnswerVersionId/);
    assert.match(content, /eventType.*READBACK|"READBACK"/s);
    assert.match(background, /lastLearningSummary/);
    assert.match(background, /UNDO_LEARNING_CHANGE_SET/);
    assert.match(panel, /Updated for next time/);
    assert.match(panel, /Review changes/);
});

test("Part 2C Supabase boundary keeps staged proposals own-row and server-mutation-only", () => {
    const sql = fs.readFileSync(new URL("../supabase/phase2_candidate_truth_rls.sql", import.meta.url), "utf8");
    assert.match(sql, /candidate_answer_runtime_proposals enable row level security/i);
    assert.match(sql, /candidate_answer_runtime_proposals_select_own/i);
    assert.doesNotMatch(sql, /create policy candidate_answer_runtime_proposals_(?:insert|update|delete)/i);
});
