import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("recent complete application schemas power grouped Attention gaps without sharing answers", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-schema-registry-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const {
        findCanonicalMapping,
        applicationReadinessSummary,
        listAttentionGaps,
        rebuildAttentionGaps,
        registerCurrentApplicationSchema
    } = await import("../src/services/applicationSchemaRegistry.js");

    try {
        const db = getDb();
        db.prepare(`INSERT INTO candidate_profiles
            (user_id, name, email, target_roles, preferred_locations, preferred_work_modes, skills)
            VALUES ('local-user', 'Asha Rao', 'asha@example.com', '["Backend Engineer"]',
                    '["Bengaluru"]', '["Hybrid"]', '["Node.js"]')`).run();
        db.prepare("INSERT INTO companies (id, name, ats_type) VALUES ('company-1', 'Razorpay', 'greenhouse'), ('company-2', 'Postman', 'lever'), ('company-3', 'Acme', 'workday')").run();
        db.prepare(`INSERT INTO jobs
            (id, company_id, title, description, url, source, match_score, status, last_seen_at)
            VALUES
            ('job-1', 'company-1', 'Backend Engineer', 'Node.js', 'https://jobs.example/1', 'greenhouse', 91, 'MATCHED', CURRENT_TIMESTAMP),
            ('job-2', 'company-2', 'Platform Engineer', 'Node.js', 'https://jobs.example/2', 'lever', 88, 'MATCHED', CURRENT_TIMESTAMP),
            ('job-3', 'company-3', 'Cloud Engineer', 'Node.js', 'https://jobs.example/3', 'workday', 85, 'MATCHED', CURRENT_TIMESTAMP)`).run();

        const addApplicationObservation = (suffix) => {
            db.prepare(`INSERT INTO applications (id, user_id, job_id, adapter, status)
                VALUES (?, 'schema-observer', ?, 'EXTENSION', 'READY_TO_SUBMIT')`).run(`app-${suffix}`, `job-${suffix}`);
            db.prepare(`INSERT INTO application_attempts (id, application_id, status, started_url, current_url)
                VALUES (?, ?, 'ACTIVE', ?, ?)`).run(`attempt-${suffix}`, `app-${suffix}`, `https://apply.example/${suffix}`, `https://apply.example/${suffix}`);
            db.prepare(`INSERT INTO application_page_snapshots
                (id, attempt_id, application_id, page_url, site_host, portal_kind, page_fingerprint, field_count, required_count)
                VALUES (?, ?, ?, ?, 'apply.example', 'generic', ?, 1, 1)`)
                .run(`page-${suffix}`, `attempt-${suffix}`, `app-${suffix}`, `https://apply.example/${suffix}`, `fingerprint-${suffix}`);
            db.prepare(`INSERT INTO application_field_snapshots
                (id, page_snapshot_id, field_id, field_signature, field_label, semantic_key, field_type, required, visible)
                VALUES (?, ?, 'expected-ctc', 'expected-ctc|number', 'Expected annual CTC', 'EXPECTED_CTC', 'number', 1, 1)`)
                .run(`field-${suffix}`, `page-${suffix}`);
        };

        addApplicationObservation("1");
        const draft = registerCurrentApplicationSchema("app-1");
        assert.equal(draft.status, "DRAFT");
        assert.equal(findCanonicalMapping("Expected annual CTC", {
            inputType: "number", contextKey: "expected-ctc|number"
        }), null, "draft observations must not publish shared canonical mappings");
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM current_application_schemas").get().count, 0);
        assert.deepEqual(listAttentionGaps("local-user"), []);

        db.prepare("UPDATE applications SET status = 'SUCCESS' WHERE id = 'app-1'").run();
        const complete = registerCurrentApplicationSchema("app-1");
        assert.equal(complete.status, "FRESH");
        assert.equal(complete.observation_count, 1, "re-registering one attempt must not inflate observations");
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM question_mappings").get().count, 0,
            "the schema registry must not write the legacy question-mapping path");
        assert.ok(db.prepare(`SELECT id FROM field_semantic_mappings
            WHERE canonical_field_key = 'EXPECTED_CTC' LIMIT 1`).get(),
            "verified schemas must reuse the canonical semantic registry");
        assert.equal(rebuildAttentionGaps("local-user")[0].affectedJobCount, 1);

        const { proposeCanonical } = await import("../src/repositories/fieldSemanticRepository.js");
        for (let index = 1; index <= 5; index += 1) {
            const proposal = proposeCanonical({
                canonicalName: `UNREVIEWED_READINESS_FIELD_${index}`,
                label: `Unreviewed readiness field ${index}`,
                description: `Unreviewed application-only concept ${index}`
            });
            db.prepare(`INSERT INTO application_schema_fields
                (schema_id, field_signature, canonical_field_key, raw_label, input_type, required, confidence)
                VALUES (?, ?, ?, ?, 'text', 1, 0.99)`)
                .run(complete.id, `unreviewed-${index}`, proposal.canonical.key, proposal.canonical.label);
        }
        assert.equal(applicationReadinessSummary("local-user").credible, false,
            "proposed canonicals must not inflate cross-user readiness metrics");

        db.prepare(`INSERT INTO applications (id, user_id, job_id, adapter, status)
            VALUES ('app-1b', 'second-observer', 'job-1', 'EXTENSION', 'READY_TO_SUBMIT')`).run();
        db.prepare(`INSERT INTO application_attempts (id, application_id, status, started_url, current_url)
            VALUES ('attempt-1b', 'app-1b', 'ACTIVE', 'https://apply.example/1', 'https://apply.example/1')`).run();
        db.prepare(`INSERT INTO application_page_snapshots
            (id, attempt_id, application_id, page_url, site_host, portal_kind, page_fingerprint, field_count, required_count)
            VALUES ('page-1b', 'attempt-1b', 'app-1b', 'https://apply.example/1', 'apply.example', 'generic', 'fingerprint-1b', 1, 1)`).run();
        db.prepare(`INSERT INTO application_field_snapshots
            (id, page_snapshot_id, field_id, field_signature, field_label, semantic_key, field_type, required, visible)
            VALUES ('field-1b', 'page-1b', 'expected-ctc', 'expected-ctc|number', 'Expected annual CTC', 'EXPECTED_CTC', 'number', 1, 1)`).run();
        const incompleteRepeat = registerCurrentApplicationSchema("app-1b");
        assert.equal(incompleteRepeat.status, "FRESH", "an incomplete repeat must never downgrade a validated schema");

        addApplicationObservation("2");
        db.prepare("UPDATE applications SET status = 'SUCCESS' WHERE id = 'app-2'").run();
        registerCurrentApplicationSchema("app-2");
        const gaps = rebuildAttentionGaps("local-user");
        assert.equal(gaps.length, 1);
        assert.equal(gaps[0].canonicalFieldKey, "EXPECTED_CTC");
        assert.equal(gaps[0].affectedJobCount, 2);
        assert.deepEqual(gaps[0].affectedJobs.map((job) => job.company).sort(), ["Postman", "Razorpay"]);

        const mapping = findCanonicalMapping("Expected annual CTC", { inputType: "number", contextKey: "expected-ctc|number" });
        assert.equal(mapping.canonicalFieldKey, "EXPECTED_CTC");
        assert.equal(Object.hasOwn(mapping, "answer"), false);
        assert.equal(db.prepare("PRAGMA table_info(question_mappings)").all().some((column) => /answer|value/i.test(column.name)), false);

        db.prepare(`INSERT INTO applications (id, user_id, job_id, adapter, status)
            VALUES ('app-3', 'schema-observer', 'job-3', 'EXTENSION', 'SUCCESS')`).run();
        db.prepare(`INSERT INTO application_attempts (id, application_id, status, started_url, current_url)
            VALUES ('attempt-3', 'app-3', 'SUCCESS', 'https://workday.example/apply', 'https://workday.example/apply')`).run();
        db.prepare(`INSERT INTO application_page_snapshots
            (id, attempt_id, application_id, page_url, site_host, portal_kind, page_fingerprint, field_count, required_count)
            VALUES
            ('page-3a', 'attempt-3', 'app-3', 'https://workday.example/apply', 'workday.example', 'workday', 'fingerprint-3a', 1, 1),
            ('page-3b', 'attempt-3', 'app-3', 'https://workday.example/apply', 'workday.example', 'workday', 'fingerprint-3b', 1, 1)`).run();
        db.prepare(`INSERT INTO application_field_snapshots
            (id, page_snapshot_id, field_id, field_signature, field_label, semantic_key, field_type, required, visible)
            VALUES
            ('field-3a', 'page-3a', 'full-name', 'identity.full-name|text', 'Full name', 'FULL_NAME', 'text', 1, 1),
            ('field-3b', 'page-3b', 'email', 'identity.email|email', 'Email', 'EMAIL', 'email', 1, 1)`).run();
        const sameUrlWizard = registerCurrentApplicationSchema("app-3");
        assert.equal(sameUrlWizard.pageCount, 2, "same-URL SPA steps must both survive aggregation");
        assert.equal(sameUrlWizard.fieldCount, 2);

        db.prepare("UPDATE application_schemas SET expires_at = datetime('now', '-1 minute')").run();
        assert.deepEqual(rebuildAttentionGaps("local-user"), []);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
