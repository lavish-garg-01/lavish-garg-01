import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    semanticValueMismatchReason,
    validateResolvedValue
} from "../src/services/applicationValueValidation.js";

test("semantic value validation blocks shifted identity values", () => {
    assert.equal(semanticValueMismatchReason({}, { normalizedKey: "FIRST_NAME", answer: "candidate@example.com" }), "NAME_FORMAT");
    assert.equal(semanticValueMismatchReason({}, { normalizedKey: "EMAIL", answer: "Garg" }), "EMAIL_FORMAT");
    assert.equal(semanticValueMismatchReason({}, { normalizedKey: "PHONE", answer: "Current employer" }), "PHONE_FORMAT");
    assert.equal(semanticValueMismatchReason({}, { normalizedKey: "CURRENT_COMPANY", answer: "+91 700 909 1401" }), "COMPANY_FORMAT");
    assert.equal(semanticValueMismatchReason({}, { normalizedKey: "LINKEDIN_URL", answer: "https://example.com/person" }), "LINKEDIN_URL_FORMAT");
});

test("semantic value validation requires exact employer options", () => {
    const field = {
        type: "select-one",
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]
    };
    assert.equal(semanticValueMismatchReason(field, { normalizedKey: "CUSTOM_FIELD", answer: "Maybe" }), "OPTION_NOT_FOUND");
    assert.equal(validateResolvedValue(field, { normalizedKey: "CUSTOM_FIELD", answer: "Yes", confidence: 1 }).valid, true);
});

test("invalid values are converted to review-only resolutions", () => {
    const validation = validateResolvedValue(
        { type: "text", label: "Last name" },
        { normalizedKey: "LAST_NAME", answer: "candidate@example.com", confidence: 1, source: "APPLICATION_DRAFT" }
    );
    assert.equal(validation.valid, false);
    assert.equal(validation.resolved.answer, null);
    assert.equal(validation.resolved.requiresUserInput, true);
    assert.equal(validation.resolved.source, "VALUE_SEMANTIC_MISMATCH");
});

test("contaminated historical application answers are quarantined, not deleted", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-answer-integrity-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { invalidateContaminatedApplicationQuestions, safeEventMetadata } = await import("../src/repositories/applicationRepository.js");
    const { recordLearningEvent } = await import("../src/repositories/attentionRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO companies (id,name) VALUES ('company','Company')").run();
        db.prepare("INSERT INTO jobs (id,title,description,url,source,company_id) VALUES ('job','Engineer','Role','https://example.test/job','test','company')").run();
        db.prepare("INSERT INTO applications (id,job_id) VALUES ('application','job')").run();
        db.prepare(`INSERT INTO application_questions
            (id,application_id,question_key,question,field_id,status,answer,confidence,source)
            VALUES ('question','application','FIRST_NAME','First name','field-12','ANSWERED','candidate@example.com',1,'AI_GROUNDED')`).run();
        db.prepare(`INSERT INTO application_questions
            (id,application_id,question_key,question,field_id,status,answer,confidence,source)
            VALUES ('website-question','application','WEBSITE_URL','Website','website-field','ANSWERED','https://linkedin.example/profile',1,'AI_GROUNDED')`).run();
        db.prepare("INSERT INTO application_attempts (id,application_id) VALUES ('attempt','application')").run();
        db.prepare(`INSERT INTO field_resolutions
            (id,attempt_id,application_id,field_id,source_type,confidence,policy_decision,value_hash,evidence_summary)
            VALUES ('resolution','attempt','application','field-12','AI_GROUNDED',1,'SAFE_FILL',?,'raw candidate value')`)
            .run((await import("node:crypto")).createHash("sha256").update("candidate@example.com").digest("hex"));
        db.prepare(`INSERT INTO application_field_evidence
            (id,attempt_id,application_id,field_id,field_signature,field_label,application_value,answer_source)
            VALUES ('evidence','attempt','application','field-12','sig','First name','candidate@example.com','AI_GROUNDED')`).run();

        const repaired = invalidateContaminatedApplicationQuestions("application");
        assert.equal(repaired.length, 2);
        const row = db.prepare("SELECT status,answer,invalidated_reason FROM application_questions WHERE id='question'").get();
        assert.equal(row.status, "INVALIDATED");
        assert.equal(row.answer, null);
        assert.equal(row.invalidated_reason, "NAME_FORMAT");
        const website = db.prepare("SELECT status,answer,invalidated_reason FROM application_questions WHERE id='website-question'").get();
        assert.deepEqual(website, { status: "INVALIDATED", answer: null, invalidated_reason: "AI_IDENTITY_FACT_UNGROUNDED" });
        assert.deepEqual(db.prepare("SELECT source_type,confidence,policy_decision,value_hash,evidence_summary FROM field_resolutions WHERE id='resolution'").get(), {
            source_type: "DATA_INTEGRITY_REPAIR", confidence: 0, policy_decision: "REVIEW", value_hash: null,
            evidence_summary: "Quarantined incompatible historical answer."
        });
        assert.deepEqual(db.prepare("SELECT application_value,answer_source,final_state,fill_outcome FROM application_field_evidence WHERE id='evidence'").get(), {
            application_value: null, answer_source: "DATA_INTEGRITY_REPAIR", final_state: "DETECTED", fill_outcome: null
        });
        const { saveResolvedQuestion } = await import("../src/repositories/applicationRepository.js");
        saveResolvedQuestion("application", { id: "field-12", label: "First name" }, {
            normalizedKey: "FIRST_NAME", answer: "Asha", confidence: 1, source: "PROFILE", evidence: "Verified profile"
        });
        assert.deepEqual(db.prepare("SELECT status,answer,invalidated_reason,invalidated_at FROM application_questions WHERE id='question'").get(), {
            status: "ANSWERED", answer: "Asha", invalidated_reason: null, invalidated_at: null
        });
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM application_events WHERE application_id='application' AND event_type='APPLICATION_ANSWER_INVALIDATED'").get().count, 2);
        recordLearningEvent({
            type: "VALUE_SEMANTIC_MISMATCH",
            applicationId: "application",
            fieldId: "field-12",
            memoryKey: "FIRST_NAME",
            metadata: { reason: "NAME_FORMAT", rawValue: "must not persist" }
        });
        const learning = db.prepare("SELECT metadata_json FROM learning_events WHERE application_id='application'").get();
        assert.deepEqual(JSON.parse(learning.metadata_json), {
            source: null,
            changed: false,
            candidateApproved: false,
            protected: false,
            reason: "NAME_FORMAT"
        });
        assert.deepEqual(
            safeEventMetadata({
                fieldId: "field",
                proposedValue: "secret",
                nested: { rawValue: "secret", count: 2 },
                error: "could contain employer content"
            }),
            { fieldId: "field", nested: { count: 2 } }
        );
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
