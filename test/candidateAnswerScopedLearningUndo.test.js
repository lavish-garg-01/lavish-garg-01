import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const candidatePrivateMoney = (amountExact) => ({
    schemaVersion: 1,
    dataClass: "CANDIDATE_PRIVATE",
    kind: "MONEY",
    amountExact: String(amountExact),
    currency: "INR",
    period: "YEAR"
});
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

test("scoped overrides learn as REVIEW, promote after exact reuse, and undo/restore append safely", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-scoped-learning-"));
    process.env.DATABASE_PATH = path.join(directory, "scoped-learning.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { ensureApplicationAttempt } = await import("../src/repositories/learningRepository.js");
    const { buildFieldInteractionObservation } = await import("../src/contracts/fieldInteractionObservation.js");
    const {
        classifyAttemptAtCheckpoint, recordCheckpointReceipt, recordFieldRevision, recordNeutralObservation
    } = await import("../src/services/fieldRevisionService.js");
    const { ensureAnswerPolicyRegistry } = await import("../src/services/answerPolicyRegistry.js");
    const { ensureAnswerContextRegistry } = await import("../src/services/answerContextNormalization.js");
    const {
        getActiveCandidateAnswerVersion, listCandidateAnswerVersions,
        resolveCandidateTruth, saveCandidateAnswerVersion
    } = await import("../src/repositories/candidateAnswerVersionRepository.js");
    const {
        commitCandidateAnswerChangeSet
    } = await import("../src/services/candidateAnswerChangeSetService.js");
    const {
        restoreCandidateAnswerVersion, undoCandidateAnswerChangeSet
    } = await import("../src/services/candidateAnswerReversalService.js");

    try {
        const db = getDb();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, reusable_answer_consent, preferred_locations, skills, target_roles, preferred_work_modes)
            VALUES ('local-user', 'Candidate', 'candidate@example.com', 1, '[]', '[]', '[]', '[]')`).run();
        db.prepare("INSERT INTO companies (id, name, domain) VALUES ('company-google', 'Google', 'google.com')").run();
        db.prepare("INSERT INTO companies (id, name, domain) VALUES ('company-amazon', 'Amazon', 'amazon.jobs')").run();
        ensureAnswerContextRegistry();
        ensureAnswerPolicyRegistry();
        const global = saveCandidateAnswerVersion({
            userId: "local-user",
            canonicalKey: "EXPECTED_CTC",
            normalizedValue: candidatePrivateMoney("2500000"),
            context: {},
            scopeQualifiers: {},
            source: "EXPLICIT_SAVE",
            expectedActiveVersionId: null,
            idempotencyKey: "global-expected-ctc",
            candidateApproved: true,
            learningState: "TRUSTED",
            originKind: "USER_EXPLICIT_SAVE"
        });

        const createApplication = (suffix, companyId) => {
            const jobId = `job-${suffix}`;
            const applicationId = `app-${suffix}`;
            db.prepare(`INSERT INTO jobs (id, company_id, title, description, url, source)
                VALUES (?, ?, 'Backend Engineer', '', ?, 'test')`)
                .run(jobId, companyId, `https://example.com/${suffix}`);
            db.prepare(`INSERT INTO applications (id, job_id, user_id, adapter)
                VALUES (?, ?, 'local-user', 'EXTENSION')`).run(applicationId, jobId);
            return { applicationId, attempt: ensureApplicationAttempt(applicationId, `https://example.com/${suffix}/apply`) };
        };
        const context = (companyName) => ({
            companyName,
            roleFamily: "SOFTWARE_ENGINEERING",
            countryCode: "IN"
        });
        let clock = 1_788_160_000_000;
        const checkpoint = (applicationId, attempt, suffix) => {
            const receipt = {
                schemaVersion: 1,
                checkpointId: `checkpoint:${suffix}`,
                runId: attempt.id,
                applicationId,
                applicationContentRevisionId: null,
                type: "SUBMISSION",
                status: "VERIFIED",
                source: "EMPLOYER_RECEIPT",
                observedAtMs: clock += 1000,
                evidenceHash: hash(`evidence-${suffix}`),
                valueFree: true
            };
            recordCheckpointReceipt(applicationId, receipt);
            classifyAttemptAtCheckpoint(applicationId, receipt);
            return receipt;
        };
        const directProposal = ({ applicationId, attempt, suffix, amount, intended, companyName,
            expectedActiveVersionId = null, usedAnswerVersionId = global.id }) => {
            const logical = hash(`logical-${suffix}`);
            const observationId = `observation:${suffix}`;
            recordNeutralObservation(applicationId, buildFieldInteractionObservation({
                id: logical,
                logicalFieldId: logical,
                semanticKey: "EXPECTED_CTC",
                fillOutcome: "USER_CORRECTED",
                finalState: "USER_EDITED",
                source: "USER_MANUAL_INPUT",
                beforeValueHash: intended ? hash(intended) : null,
                intendedValueHash: intended ? hash(intended) : null,
                finalValueHash: hash(amount),
                normalizedEquivalent: false,
                completedByUser: true
            }, {
                applicationId,
                attemptId: attempt.id,
                observationId,
                checkpoint: { type: "NONE", status: "NOT_OBSERVED" },
                clientTimeMs: clock += 10
            }));
            return {
                observationId,
                fieldLogicalId: logical,
                canonicalKey: "EXPECTED_CTC",
                normalizedValue: candidatePrivateMoney(amount),
                finalValueHash: hash(amount),
                context: context(companyName),
                scopeQualifiers: {},
                expectedActiveVersionId,
                usedAnswerVersionId,
                reasonCodes: ["CANDIDATE_CONTEXTUAL_CORRECTION"]
            };
        };

        const googleFirst = createApplication("google-first", "company-google");
        const googleProposal = directProposal({ ...googleFirst, suffix: "google-first",
            amount: "2800000", intended: "2500000", companyName: "Google" });
        const googleCheckpoint = checkpoint(googleFirst.applicationId, googleFirst.attempt, "google-first");
        const googleLearn = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "learn-google-28",
            input: { applicationId: googleFirst.applicationId, runId: googleFirst.attempt.id,
                checkpointId: googleCheckpoint.checkpointId, proposals: [googleProposal] }
        });
        assert.equal(googleLearn.items[0].transitionKind, "CREATE_REVIEW");
        assert.equal(googleLearn.items[0].learningStateAfter, "REVIEW");
        const googleReview = listCandidateAnswerVersions("local-user", {
            canonicalKey: "EXPECTED_CTC", includeInactive: false
        }).find((version) => version.id === googleLearn.items[0].learnedVersionId);
        assert.equal(googleReview.learningState, "REVIEW");
        assert.equal(googleReview.originKind, "USER_CORRECTION");
        const googleResolution = resolveCandidateTruth({
            userId: "local-user", canonicalKey: "EXPECTED_CTC", context: context("Google")
        });
        assert.equal(googleResolution.answerVersion.id, googleReview.id);
        assert.equal(googleResolution.trialReuse, true);

        const amazonFirst = createApplication("amazon-first", "company-amazon");
        const amazonProposal = directProposal({ ...amazonFirst, suffix: "amazon-first",
            amount: "2200000", intended: "2500000", companyName: "Amazon" });
        const amazonCheckpoint = checkpoint(amazonFirst.applicationId, amazonFirst.attempt, "amazon-first");
        const amazonLearn = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "learn-amazon-22",
            input: { applicationId: amazonFirst.applicationId, runId: amazonFirst.attempt.id,
                checkpointId: amazonCheckpoint.checkpointId, proposals: [amazonProposal] }
        });
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EXPECTED_CTC",
            context: context("Amazon") }).answerVersion.normalizedValue.amountExact, "2200000");
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EXPECTED_CTC",
            context: context("Google") }).answerVersion.normalizedValue.amountExact, "2800000");

        const googleSecond = createApplication("google-second", "company-google");
        const logical = hash("logical-google-second");
        const intendedHash = hash("2800000");
        recordFieldRevision(googleSecond.applicationId, {
            schemaVersion: 1,
            revisionId: "revision:google-second",
            identity: {
                schemaVersion: 1,
                runId: googleSecond.attempt.id,
                tabId: 9,
                frameId: 0,
                documentId: "document-google-second",
                documentLifecycle: "ACTIVE",
                pageGeneration: 1,
                formGeneration: 1,
                formGroupId: "application-0",
                logicalFieldFingerprint: logical,
                fieldInstanceGeneration: 0
            },
            operationId: "operation:google-second",
            editSessionId: null,
            sequence: 1,
            actor: "COPILOT",
            eventType: "READBACK",
            beforeValueHash: null,
            intendedValueHash: intendedHash,
            afterValueHash: intendedHash,
            canonicalKey: "EXPECTED_CTC",
            answerVersionId: googleReview.id,
            representationVersionId: null,
            strategyVersionId: null,
            clientTimeMs: clock += 10,
            valueFree: true
        });
        recordNeutralObservation(googleSecond.applicationId, buildFieldInteractionObservation({
            id: logical,
            logicalFieldId: logical,
            semanticKey: "EXPECTED_CTC",
            fillOutcome: "FILLED",
            source: "VERSIONED_CANDIDATE_TRUTH",
            intendedValueHash: intendedHash,
            finalValueHash: intendedHash,
            normalizedEquivalent: true,
            completedByUser: false,
            strategyAttempted: true,
            readback: "MATCH"
        }, {
            applicationId: googleSecond.applicationId,
            attemptId: googleSecond.attempt.id,
            observationId: "observation:google-second",
            checkpoint: { type: "NONE", status: "NOT_OBSERVED" },
            clientTimeMs: clock += 10
        }));
        const googleSecondCheckpoint = checkpoint(googleSecond.applicationId, googleSecond.attempt, "google-second");
        const promoted = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "promote-google-28",
            input: {
                applicationId: googleSecond.applicationId,
                runId: googleSecond.attempt.id,
                checkpointId: googleSecondCheckpoint.checkpointId,
                proposals: [{
                    observationId: "observation:google-second",
                    fieldLogicalId: logical,
                    canonicalKey: "EXPECTED_CTC",
                    normalizedValue: candidatePrivateMoney("2800000"),
                    finalValueHash: intendedHash,
                    context: context("Google"),
                    scopeQualifiers: googleReview.scopeQualifiers,
                    expectedActiveVersionId: googleReview.id,
                    usedAnswerVersionId: googleReview.id,
                    reasonCodes: []
                }]
            }
        });
        assert.equal(promoted.items[0].transitionKind, "PROMOTE_TRUSTED");
        const trusted = getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", googleReview.scopeHash);
        assert.equal(trusted.learningState, "TRUSTED");
        assert.equal(trusted.supersedesId, googleReview.id);

        const undoPromotion = undoCandidateAnswerChangeSet({
            userId: "local-user", changeSetId: promoted.id, idempotencyKey: "undo-google-promotion"
        });
        assert.equal(undoPromotion.summary.restored, 1);
        const reviewAgain = getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", googleReview.scopeHash);
        assert.equal(reviewAgain.learningState, "REVIEW");
        assert.equal(reviewAgain.restoresVersionId, googleReview.id);
        assert.equal(undoCandidateAnswerChangeSet({
            userId: "local-user", changeSetId: promoted.id, idempotencyKey: "undo-google-promotion"
        }).idempotentReplay, true);

        const restored = restoreCandidateAnswerVersion({
            userId: "local-user",
            versionId: trusted.id,
            idempotencyKey: "restore-google-trusted",
            input: { expectedActiveVersionId: reviewAgain.id }
        });
        assert.equal(restored.summary.restored, 1);
        const restoredTrusted = getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", googleReview.scopeHash);
        assert.equal(restoredTrusted.learningState, "TRUSTED");
        assert.equal(restoredTrusted.restoresVersionId, trusted.id);

        const staleUndo = undoCandidateAnswerChangeSet({
            userId: "local-user", changeSetId: googleLearn.id, idempotencyKey: "undo-stale-google-create"
        });
        assert.equal(staleUndo.summary.skippedNewerVersion, 1);
        assert.equal(getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", googleReview.scopeHash).id,
            restoredTrusted.id, "an old undo must not overwrite a newer restored answer");

        const googleReset = createApplication("google-reset", "company-google");
        const resetProposal = directProposal({ ...googleReset, suffix: "google-reset",
            amount: "2500000", intended: "2800000", companyName: "Google",
            expectedActiveVersionId: restoredTrusted.id, usedAnswerVersionId: restoredTrusted.id });
        const resetCheckpoint = checkpoint(googleReset.applicationId, googleReset.attempt, "google-reset");
        const removedOverride = commitCandidateAnswerChangeSet({
            userId: "local-user", idempotencyKey: "remove-google-override",
            input: { applicationId: googleReset.applicationId, runId: googleReset.attempt.id,
                checkpointId: resetCheckpoint.checkpointId, proposals: [resetProposal] }
        });
        assert.equal(removedOverride.items[0].transitionKind, "REMOVE_OVERRIDE");
        assert.equal(getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", googleReview.scopeHash), null);
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EXPECTED_CTC",
            context: context("Google") }).answerVersion.id, global.id);
        const undoRemoval = undoCandidateAnswerChangeSet({
            userId: "local-user", changeSetId: removedOverride.id, idempotencyKey: "undo-google-removal"
        });
        assert.equal(undoRemoval.summary.restored, 1);
        assert.equal(getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", googleReview.scopeHash)
            .normalizedValue.amountExact, "2800000");

        const amazonReview = getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC",
            amazonLearn.items[0].scopeHash);
        assert.equal(amazonReview.learningState, "REVIEW");
        const forgetAmazon = undoCandidateAnswerChangeSet({
            userId: "local-user", changeSetId: amazonLearn.id, idempotencyKey: "undo-amazon-new-override"
        });
        assert.equal(forgetAmazon.summary.forgotten, 1);
        assert.equal(getActiveCandidateAnswerVersion("local-user", "EXPECTED_CTC", amazonReview.scopeHash), null);
        assert.equal(resolveCandidateTruth({ userId: "local-user", canonicalKey: "EXPECTED_CTC",
            context: context("Amazon") }).answerVersion.id, global.id, "forgetting an override must fall back globally");

        const partial = createApplication("partial-undo", "company-google");
        const partialFields = [
            { observationId: "observation:partial-name", logical: hash("partial-name"),
                canonicalKey: "FULL_NAME", value: "Candidate Name" },
            { observationId: "observation:partial-email", logical: hash("partial-email"),
                canonicalKey: "EMAIL", value: "first@example.com" }
        ];
        for (const field of partialFields) {
            recordNeutralObservation(partial.applicationId, buildFieldInteractionObservation({
                id: field.logical,
                logicalFieldId: field.logical,
                semanticKey: field.canonicalKey,
                fillOutcome: "USER_CORRECTED",
                finalState: "USER_EDITED",
                source: "USER_MANUAL_INPUT",
                finalValueHash: hash(field.value),
                normalizedEquivalent: null,
                completedByUser: true
            }, {
                applicationId: partial.applicationId,
                attemptId: partial.attempt.id,
                observationId: field.observationId,
                checkpoint: { type: "NONE", status: "NOT_OBSERVED" },
                clientTimeMs: clock += 10
            }));
        }
        const partialCheckpoint = checkpoint(partial.applicationId, partial.attempt, "partial-undo");
        const partialChangeSet = commitCandidateAnswerChangeSet({
            userId: "local-user",
            idempotencyKey: "learn-partial-undo-fields",
            input: {
                applicationId: partial.applicationId,
                runId: partial.attempt.id,
                checkpointId: partialCheckpoint.checkpointId,
                proposals: partialFields.map((field) => ({
                    observationId: field.observationId,
                    fieldLogicalId: field.logical,
                    canonicalKey: field.canonicalKey,
                    normalizedValue: {
                        schemaVersion: 1,
                        dataClass: "CANDIDATE_PRIVATE",
                        kind: "STRING",
                        value: field.value
                    },
                    finalValueHash: hash(field.value),
                    context: {},
                    scopeQualifiers: {},
                    expectedActiveVersionId: null,
                    usedAnswerVersionId: null,
                    reasonCodes: []
                }))
            }
        });
        assert.equal(partialChangeSet.itemCount, 2);
        const learnedEmail = getActiveCandidateAnswerVersion("local-user", "EMAIL",
            partialChangeSet.items.find((item) => item.canonicalKey === "EMAIL").scopeHash);
        const newerEmail = saveCandidateAnswerVersion({
            userId: "local-user",
            canonicalKey: "EMAIL",
            normalizedValue: {
                schemaVersion: 1,
                dataClass: "CANDIDATE_PRIVATE",
                kind: "STRING",
                value: "newer@example.com"
            },
            context: {},
            scopeQualifiers: {},
            source: "EXPLICIT_SAVE",
            expectedActiveVersionId: learnedEmail.id,
            idempotencyKey: "newer-email-before-partial-undo",
            candidateApproved: true,
            learningState: "TRUSTED",
            originKind: "USER_EXPLICIT_SAVE"
        });
        const partialUndo = undoCandidateAnswerChangeSet({
            userId: "local-user",
            changeSetId: partialChangeSet.id,
            idempotencyKey: "undo-partial-change-set"
        });
        assert.equal(partialUndo.summary.forgotten, 1);
        assert.equal(partialUndo.summary.skippedNewerVersion, 1);
        assert.equal(getActiveCandidateAnswerVersion("local-user", "EMAIL", learnedEmail.scopeHash).id,
            newerEmail.id, "partial Undo must keep a newer answer while reverting unaffected fields");
        const learnedNameItem = partialChangeSet.items.find((item) => item.canonicalKey === "FULL_NAME");
        assert.equal(getActiveCandidateAnswerVersion("local-user", "FULL_NAME", learnedNameItem.scopeHash), null);

        const privateAudit = JSON.stringify({
            reversals: db.prepare("SELECT * FROM candidate_answer_reversal_sets").all(),
            items: db.prepare("SELECT * FROM candidate_answer_reversal_items").all(),
            receipts: db.prepare("SELECT * FROM candidate_answer_reversal_receipts").all(),
            outbox: db.prepare("SELECT * FROM extension_backend_outbox WHERE event_type = 'CANDIDATE_ANSWER_REVERSAL_COMMITTED'").all()
        });
        assert.doesNotMatch(privateAudit, /2800000|2200000|2500000/,
            "reversal audit and outbox must remain value-free");
        assert.throws(() => db.prepare("UPDATE candidate_answer_reversal_sets SET item_count = 2").run(), /immutable/);
        assert.throws(() => db.prepare("DELETE FROM candidate_answer_reversal_items").run(), /immutable/);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
