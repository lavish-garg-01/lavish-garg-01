import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("reusable learning uses one global preference with a per-application opt-out", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-learning-consent-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        completeApplicationAttempt,
        recordFieldEvidence,
        reusableAnswerConsent,
        setApplicationLearningDisabled,
        setReusableLearningPreference,
        listAttemptTimeline
    } = await import("../src/repositories/learningRepository.js");
    const { addApplicationEvent, getApplication, updateApplicationStatus } = await import("../src/repositories/applicationRepository.js");
    const { savePortalFieldPattern, recordPortalFieldPatternOutcome } = await import("../src/repositories/agentRepository.js");
    const { listAttentionGroups, listAttentionItems, recordLearningEvent, resolveAttentionBatch, resolveAttentionItem, saveApplicationPlan, upsertAttentionItem } = await import("../src/repositories/attentionRepository.js");
    const { getAutofillPolicies, saveAutofillPolicy } = await import("../src/repositories/autofillPolicyRepository.js");
    const { promoteVerifiedApplicationAnswers } = await import("../src/routes/extension.js");
    const { proposeCanonical, setCanonicalStatus } = await import("../src/repositories/fieldSemanticRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO candidate_profiles (user_id, name, email) VALUES ('local-user', 'Candidate', 'candidate@example.com')").run();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES (?, ?, '', ?, 'test')")
            .run("job-1", "Role one", "https://example.com/jobs/1");
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES (?, ?, '', ?, 'test')")
            .run("job-2", "Role two", "https://example.com/jobs/2");
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES (?, ?, 'EXTENSION')").run("app-1", "job-1");
        db.prepare("INSERT INTO applications (id, job_id, adapter) VALUES (?, ?, 'EXTENSION')").run("app-2", "job-2");

        savePortalFieldPattern({
            siteHost: "gokwik.keka.com", portalFieldKey: "currentsalary_amount:text",
            fieldLabel: "Current Salary", controlKind: "text",
            selectorCandidates: ['input[name="currentSalary.amount"]', 'input[name="currentSalary.amount"]', "bad{selector"],
            containerSignature: "row_input_group_custom"
        });
        savePortalFieldPattern({
            siteHost: "gokwik.keka.com", portalFieldKey: "currentsalary_amount:text",
            fieldLabel: "Current Salary *", controlKind: "text",
            selectorCandidates: ['input[name="currentSalary.amount"]'],
            containerSignature: "row_input_group_custom", semanticKey: "CURRENT_CTC"
        });
        recordPortalFieldPatternOutcome("gokwik.keka.com", "currentsalary_amount:text", true);
        const pattern = db.prepare("SELECT * FROM portal_field_patterns WHERE site_host = 'gokwik.keka.com'").get();
        assert.equal(pattern.observed_count, 2);
        assert.equal(pattern.success_count, 1);
        assert.equal(pattern.semantic_key, "CURRENT_CTC");
        assert.deepEqual(JSON.parse(pattern.selector_candidates_json), ['input[name="currentSalary.amount"]']);

        saveApplicationPlan("app-1", "https://example.com/apply", { counts: { total: 2, ready: 1, needsYou: 1 }, submits: false });
        upsertAttentionItem("app-1", { fieldId: "kafka", type: "FACT_REQUIRED", title: "Kafka experience", reason: "No verified answer.", answerScope: "GLOBAL_FACT", pageUrl: "https://example.com/apply" });
        assert.equal(listAttentionItems({ applicationId: "app-1" }).length, 1);
        recordLearningEvent({ type: "FACT_CONFIRMED", applicationId: "app-1", fieldId: "kafka", memoryKey: "KAFKA_EXPERIENCE", memoryScope: "GLOBAL_FACT", metadata: { source: "USER", candidateApproved: true, rawValue: "must-not-persist" } });
        const learning = db.prepare("SELECT metadata_json FROM learning_events WHERE application_id = 'app-1'").get();
        assert.equal(learning.metadata_json.includes("must-not-persist"), false);
        resolveAttentionItem("app-1", "kafka");
        assert.equal(listAttentionItems({ applicationId: "app-1" }).length, 0);

        upsertAttentionItem("app-1", { fieldId: "ctc", type: "DATA_CONFLICT", title: "Expected CTC", reason: "Different portal value.", semanticKey: "EXPECTED_CTC" });
        upsertAttentionItem("app-2", { fieldId: "ctc", type: "DATA_CONFLICT", title: "Expected CTC", reason: "Different portal value.", semanticKey: "EXPECTED_CTC" });
        const conflictGroup = listAttentionGroups().find((group) => group.semanticKey === "EXPECTED_CTC");
        assert.equal(conflictGroup.count, 2);
        assert.equal(conflictGroup.batchAction, "KEEP_EXISTING");
        assert.throws(() => resolveAttentionBatch({ ids: conflictGroup.itemIds, decision: "KEEP_EXISTING" }), /approval/i);
        assert.equal(resolveAttentionBatch({ ids: conflictGroup.itemIds, decision: "KEEP_EXISTING", candidateApproved: true }).resolved, 2);
        assert.equal(listAttentionItems().length, 0);

        assert.equal(getAutofillPolicies().find((policy) => policy.category === "COMPENSATION").mode, "ASK_EACH_TIME");
        assert.throws(() => saveAutofillPolicy({ category: "COMPENSATION", mode: "AUTO_VERIFIED" }), /approval/i);
        assert.equal(saveAutofillPolicy({ category: "COMPENSATION", mode: "AUTO_VERIFIED", candidateApproved: true }).mode, "AUTO_VERIFIED");
        assert.throws(() => saveAutofillPolicy({ category: "LEGAL", mode: "AUTO_VERIFIED", candidateApproved: true }), /never/i);

        assert.deepEqual(reusableAnswerConsent("app-1"), {
            globalConsent: false, applicationDecision: "PENDING", allowed: false,
            promptRequired: false, learningDisabledForApplication: false
        });
        setReusableLearningPreference(true);
        assert.equal(reusableAnswerConsent("app-1").allowed, true);
        assert.equal(reusableAnswerConsent("app-1").promptRequired, false);
        assert.equal(setApplicationLearningDisabled("app-1", true).allowed, false);
        assert.equal(reusableAnswerConsent("app-1").learningDisabledForApplication, true);
        assert.equal(reusableAnswerConsent("app-2").allowed, true);
        setApplicationLearningDisabled("app-1", false);
        assert.equal(reusableAnswerConsent("app-1").allowed, true);

        recordFieldEvidence("app-1", "https://example.com/apply", [
            { id: "address", label: "Present Address", type: "text", value: "Bengaluru", finalState: "USER_EDITED", source: "USER_MANUAL_INPUT" },
            { id: "python", label: "Experience with Python in years?", type: "textarea", value: "3", finalState: "USER_EDITED", source: "USER_MANUAL_INPUT" },
            { id: "password", label: "Password", type: "password", value: "must-not-be-stored", sensitive: true, finalState: "USER_EDITED" }
        ]);
        const pythonCanonical = proposeCanonical({
            canonicalName: "EXPERIENCE_WITH_PYTHON_IN_YEARS",
            label: "Python experience in years",
            description: "Candidate-verified years of professional Python experience",
            semanticGroup: "skills_experience",
            dataType: "NUMBER",
            answerType: "NUMBER",
            question: "How many years of Python experience do you have?",
            createdSource: "ADMIN_TEST"
        });
        assert.equal(pythonCanonical.created, true);
        setCanonicalStatus("EXPERIENCE_WITH_PYTHON_IN_YEARS", "VALIDATED");
        setCanonicalStatus("EXPERIENCE_WITH_PYTHON_IN_YEARS", "TRUSTED");
        db.prepare(`INSERT INTO application_questions
            (id, application_id, question_key, question, field_id, status, answer, source)
            VALUES ('python-question', 'app-1', 'EXPERIENCE_WITH_PYTHON_IN_YEARS', 'Experience with Python in years?', 'python', 'ANSWERED', '3', 'USER_MANUAL_INPUT')`).run();
        addApplicationEvent("app-1", "FIELDS_ANALYZED", "Fields captured.", { pageUrl: "https://example.com/apply" });

        const evidence = db.prepare("SELECT field_id, application_value, is_sensitive, final_state FROM application_field_evidence ORDER BY field_id").all();
        assert.deepEqual(evidence, [
            { field_id: "address", application_value: "Bengaluru", is_sensitive: 0, final_state: "USER_EDITED" },
            { field_id: "password", application_value: null, is_sensitive: 1, final_state: "USER_EDITED" },
            { field_id: "python", application_value: "3", is_sensitive: 0, final_state: "USER_EDITED" }
        ]);
        const attemptId = db.prepare("SELECT id FROM application_attempts WHERE application_id = 'app-1'").get().id;
        const promoted = promoteVerifiedApplicationAnswers("app-1", "job-1", attemptId);
        assert.deepEqual(promoted.keys, ["EXPERIENCE_WITH_PYTHON_IN_YEARS"]);
        assert.equal(db.prepare("SELECT source FROM candidate_answers WHERE question_key = 'EXPERIENCE_WITH_PYTHON_IN_YEARS'").get().source, "VERIFIED_APPLICATION_INPUT");
        const timeline = listAttemptTimeline("app-1");
        assert.equal(timeline.length, 1);
        assert.equal(timeline[0].events[0].event_type, "FIELDS_ANALYZED");
        assert.equal(timeline[0].fields.length, 3);

        updateApplicationStatus("app-1", "SUCCESS", "Verified.");
        completeApplicationAttempt("app-1", { status: "SUCCESS", confirmationSource: "EMPLOYER_CONFIRMATION_PAGE", pageUrl: "https://example.com/confirmation" });
        const { phase1AcceptanceReport } = await import("../src/services/phase1Acceptance.js");
        assert.equal(phase1AcceptanceReport().safety.realSuccessWithoutProof, 0);
        updateApplicationStatus("app-1", "WAITING_FOR_USER", "Late iframe event.");
        assert.equal(getApplication("app-1").status, "SUCCESS");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
