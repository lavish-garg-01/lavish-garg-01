import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("onboarding resumes and reliability metrics are computed from local evidence", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-reliability-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { estimateAiCostUsd, recordAiCall } = await import("../src/services/aiTelemetry.js");
    const { onboardingState, updateOnboardingState } = await import("../src/services/onboarding.js");
    const { reliabilityReport } = await import("../src/services/reliabilityReport.js");
    try {
        const db = getDb();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, phone, current_location, country, address_line1, address_city, address_state, postal_code,
             target_roles, preferred_locations, preferred_work_modes, skills, total_experience_years)
            VALUES ('local-user', 'Asha Rao', 'asha@example.com', '9999999999', 'Bengaluru', 'India', '12 MG Road', 'Bengaluru', 'Karnataka', '560001',
                    '["Backend Engineer"]', '["Bengaluru"]', '["Hybrid"]', '["Node.js"]', 5)`).run();
        db.prepare(`INSERT INTO jobs (id, title, description, url, source, status)
            VALUES ('job-1', 'Backend Engineer', 'Node.js role', 'https://example.com/jobs/1', 'test', 'MATCHED')`).run();
        db.prepare(`INSERT INTO applications (id, job_id, adapter, status)
            VALUES ('app-1', 'job-1', 'EXTENSION', 'READY_TO_SUBMIT')`).run();
        db.prepare(`INSERT INTO application_attempts (id, application_id, status, started_url, current_url)
            VALUES ('attempt-1', 'app-1', 'ACTIVE', 'https://example.com/apply/1', 'https://example.com/apply/2')`).run();

        const insertField = db.prepare(`INSERT INTO application_field_evidence
            (id, attempt_id, application_id, page_url, site_host, field_id, field_signature,
             field_label, semantic_key, field_type, is_sensitive, is_legal, final_state)
            VALUES (@id, 'attempt-1', 'app-1', @pageUrl, 'example.com', @fieldId, @fieldId,
                    @label, @semanticKey, @fieldType, @sensitive, @legal, @finalState)`);
        insertField.run({ id: "field-1", pageUrl: "https://example.com/apply/1", fieldId: "firstName", label: "First name", semanticKey: "FIRST_NAME", fieldType: "text", sensitive: 0, legal: 0, finalState: "FILLED" });
        insertField.run({ id: "field-2", pageUrl: "https://example.com/apply/1", fieldId: "resume", label: "Resume", semanticKey: "RESUME", fieldType: "file", sensitive: 0, legal: 0, finalState: "FILLED" });
        insertField.run({ id: "field-3", pageUrl: "https://example.com/apply/2", fieldId: "cover", label: "Cover letter", semanticKey: "COVER_LETTER", fieldType: "file", sensitive: 0, legal: 0, finalState: "BLOCKED" });
        insertField.run({ id: "field-4", pageUrl: "https://example.com/apply/2", fieldId: "custom", label: "Custom question", semanticKey: null, fieldType: "textarea", sensitive: 0, legal: 0, finalState: "INVALID" });
        insertField.run({ id: "field-5", pageUrl: "https://example.com/apply/2", fieldId: "captcha", label: "Captcha", semanticKey: null, fieldType: "text", sensitive: 1, legal: 0, finalState: "BLOCKED" });

        db.prepare(`INSERT INTO attention_items
            (id, application_id, field_id, attention_type, title, reason, blocking, status)
            VALUES ('attention-1', 'app-1', 'cover', 'UPLOAD_REQUIRED', 'Resume upload', 'Upload failed', 1, 'OPEN'),
                   ('attention-2', 'app-1', 'custom', 'FACT_REQUIRED', 'Custom question', 'Unknown answer', 0, 'OPEN')`).run();
        db.prepare(`INSERT INTO portal_field_patterns
            (id, site_host, portal_field_key, field_label, semantic_key, success_count, failure_count)
            VALUES ('pattern-1', 'example.com', 'first-name', 'First name', 'FIRST_NAME', 7, 1),
                   ('pattern-2', 'example.com', 'resume', 'Resume', 'RESUME', 1, 1)`).run();
        db.prepare(`INSERT INTO agent_sessions (id, application_id) VALUES ('session-1', 'app-1')`).run();
        db.prepare(`INSERT INTO agent_questions
            (id, agent_session_id, field_id, question_type, prompt, status)
            VALUES ('question-1', 'session-1', 'custom', 'CONFIRM_MAPPING', 'What does this field mean?', 'PENDING')`).run();

        recordAiCall({ operation: "job_scoring", model: "gpt-4o-mini", usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } });
        recordAiCall({ operation: "future_operation", model: "unpriced-model", succeeded: false });

        updateOnboardingState({
            intentReviewed: true,
            resumeSkipped: true,
            manualProfileReviewed: true,
            searchReviewed: true,
            extensionReady: true,
            status: "ACTIVE",
            lastStep: "value"
        });
        const onboarding = onboardingState();
        assert.equal(onboarding.complete, true);
        assert.equal(onboarding.completed, 4);
        assert.equal(onboarding.next, null);
        assert.equal(onboarding.searchReadiness.ready, true);
        assert.deepEqual(onboarding.profileReadiness.missingRequired, []);
        assert.ok(Array.isArray(onboarding.profileReadiness.missingRecommended));

        const readyButNotActivated = updateOnboardingState({ status: "SEARCH_READY", lastStep: "value" });
        assert.equal(readyButNotActivated.searchReadiness.ready, true);
        assert.equal(readyButNotActivated.complete, false, "readiness must not bypass the explicit activation action");

        db.prepare(`INSERT INTO resume_versions
            (id, user_id, type, parsed_profile_json, parser_version, parse_confidence, candidate_confirmed)
            VALUES ('confirmed-resume', 'local-user', 'MASTER', '{}', 'test', 1, 1)`).run();
        const repairedResumeChoice = updateOnboardingState({
            resumeSkipped: true,
            resumeProfileReviewed: true,
            manualProfileReviewed: false,
            status: "SEARCH_READY",
            lastStep: "value"
        });
        assert.equal(repairedResumeChoice.steps.find((step) => step.id === "verify").complete, true,
            "a later confirmed-resume choice must repair the legacy skipped-resume flag");
        assert.equal(repairedResumeChoice.next, null);
        updateOnboardingState({ status: "ACTIVE", lastStep: "value" });

        const report = reliabilityReport({ days: 30, allVersions: true });
        assert.deepEqual(report.autofill, { successRate: 50, filled: 2, attempted: 4, detected: 4, notAttempted: 0, candidateCompleted: 0, failed: 2 });
        assert.deepEqual(report.verification, { successRate: 50, verified: 2, attempted: 4 });
        assert.deepEqual(report.review, { fields: 2, openItems: 2, blockingItems: 1 });
        assert.deepEqual(report.uploads, { confirmed: 1, failures: 1, receipts: 2, detected: 2, notAttempted: 0, successRate: 50, source: "FIELD_EVIDENCE_FALLBACK" });
        assert.deepEqual(report.mappings, { unknown: 1, succeeded: 8, failed: 2, successRate: 80, knownPatterns: 2 });
        assert.deepEqual(report.sessions, { recovered: 1, multiPageSessions: 1, recoveryRate: 100 });
        assert.equal(report.ai.calls, 2);
        assert.equal(report.ai.failedCalls, 1);
        assert.equal(report.ai.unpricedCalls, 1);
        assert.equal(report.ai.estimatedCostUsd, 0.75);
        assert.equal(estimateAiCostUsd("gpt-4o-mini", 1_000_000, 1_000_000), 0.75);
        assert.equal(estimateAiCostUsd("text-embedding-3-small", 1_000_000, 0), 0.02);

        const currentVersion = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../extension/manifest.json"), "utf8")).version;
        db.prepare(`UPDATE application_field_evidence SET extension_version = ?, fill_outcome = 'NOT_ATTEMPTED' WHERE id = 'field-3'`).run(currentVersion);
        db.prepare(`UPDATE application_field_evidence SET extension_version = ?, fill_outcome = 'FILLED', semantic_key = 'RESUME' WHERE id = 'field-2'`).run(currentVersion);
        db.prepare(`INSERT INTO application_operation_events
            (id, application_id, attempt_id, operation_id, operation_key, page_url, phase, semantic_key,
             target_signature, status, attempt_number, extension_version, portal_kind, adapter_version, client_time_ms)
            VALUES ('upload-start', 'app-1', 'attempt-1', 'upload-1', 'resume', 'https://example.com/apply/1', 'DOCUMENT', 'RESUME',
                    'resume|input', 'STARTED', 1, ?, 'generic', '1.0.0', 1),
                   ('upload-confirm', 'app-1', 'attempt-1', 'upload-1', 'resume', 'https://example.com/apply/1', 'DOCUMENT', 'RESUME',
                    'resume|input', 'CONFIRMED', 1, ?, 'generic', '1.0.0', 2)`).run(currentVersion, currentVersion);
        db.prepare(`INSERT INTO jobs (id, title, description, url, source, status)
            VALUES ('job-local', 'Diagnostic', '', 'http://127.0.0.1:3001/extension-diagnostic', 'diagnostic', 'MATCHED')`).run();
        db.prepare(`INSERT INTO applications (id, job_id, adapter, status)
            VALUES ('app-local', 'job-local', 'EXTENSION', 'READY_TO_SUBMIT')`).run();
        db.prepare(`INSERT INTO application_attempts (id, application_id, status, started_url, current_url)
            VALUES ('attempt-local', 'app-local', 'ACTIVE', 'http://127.0.0.1:3001/extension-diagnostic', 'http://127.0.0.1:3001/extension-diagnostic')`).run();
        db.prepare(`INSERT INTO application_field_evidence
            (id, attempt_id, application_id, page_url, site_host, field_id, field_signature, field_label,
             semantic_key, field_type, is_sensitive, is_legal, final_state, fill_outcome, extension_version)
            VALUES ('field-local', 'attempt-local', 'app-local', 'http://127.0.0.1:3001/extension-diagnostic',
                    '127.0.0.1', 'local-name', 'local-name', 'Full name', 'FULL_NAME', 'text', 0, 0, 'FILLED', 'FILLED', ?)`).run(currentVersion);
        const current = reliabilityReport({ days: 30, extensionVersion: currentVersion });
        assert.equal(current.scope.mode, "CURRENT_BUILD");
        assert.equal(current.scope.includeSynthetic, false);
        assert.equal(current.autofill.detected, 2);
        assert.equal(current.uploads.successRate, 100);
        assert.equal(current.uploads.receipts, 1);
        assert.equal(current.uploads.notAttempted, 1);
        assert.equal(reliabilityReport({ days: 30, extensionVersion: currentVersion, includeSynthetic: true }).autofill.detected, 3);

        const metricColumns = db.prepare("PRAGMA table_info(ai_call_metrics)").all().map((column) => column.name);
        assert.equal(metricColumns.includes("prompt"), false);
        assert.equal(metricColumns.includes("response"), false);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("Indian onboarding validates PIN code and persists current industry", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-profile-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb } = await import("../src/database/connection.js");
    const { getCandidateProfile, saveCandidateProfile } = await import("../src/repositories/copilotRepository.js");
    try {
        const initial = getCandidateProfile();
        assert.throws(() => saveCandidateProfile({ country: "India", postalCode: "12201" }), /6-digit Indian PIN/);
        const profile = saveCandidateProfile({ country: "India", postalCode: "122011", currentIndustry: "Edtech" });
        assert.equal(profile.postalCode, "122011");
        assert.equal(profile.currentIndustry, "Edtech");
        assert.equal(profile.searchProfileVersion, initial.searchProfileVersion,
            "career-evidence edits must not invalidate matching caches");
        const searchChanged = saveCandidateProfile({ targetRoles: ["Platform Engineer"] });
        assert.equal(searchChanged.searchProfileVersion, initial.searchProfileVersion + 1,
            "matching-intent edits must advance the search-profile version");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("onboarding and reliability interfaces expose the complete product flow", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const routes = fs.readFileSync(path.join(root, "src/routes/dashboard.js"), "utf8");
    const onboarding = fs.readFileSync(path.join(root, "src/views/onboarding.ejs"), "utf8");
    const reliability = fs.readFileSync(path.join(root, "src/views/reliability.ejs"), "utf8");
    const dashboard = fs.readFileSync(path.join(root, "src/views/index.ejs"), "utf8");

    assert.match(routes, /router\.get\("\/onboarding"/);
    assert.match(routes, /router\.get\("\/api\/admin\/reliability"/);
    assert.match(routes, /router\.get\("\/admin\/adapters"/);
    for (const label of ["Start from your resume", "Verify your core profile", "Indian job-search boundaries", "privacy and learning", "Connect COPILOT", "first guided application"]) {
        assert.match(onboarding, new RegExp(label, "i"));
    }
    for (const label of ["Autofill success rate", "Field verification rate", "Fields requiring review", "Upload failures", "Unknown mappings", "Session recovery rate", "Learned mapping success", "AI calls", "Estimated AI cost"]) {
        assert.match(reliability, new RegExp(label, "i"));
    }
    assert.match(dashboard, /Continue onboarding/);
});
