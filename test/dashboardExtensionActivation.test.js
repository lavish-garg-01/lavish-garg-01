import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("dashboard Open with Extension prepares an activation session before redirecting", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-dashboard-extension-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { prepareDashboardExtensionSession } = await import("../src/routes/dashboard.js");
    const { listAttentionSessions, upsertAttentionItem } = await import("../src/repositories/attentionRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO candidate_profiles (user_id, name, email) VALUES ('local-user', 'Candidate', 'candidate@example.com')").run();
        db.prepare("INSERT INTO jobs (id, title, description, url, source, status, match_score) VALUES (?, ?, ?, ?, 'jobspy', 'PREFILTERED', 40)")
            .run("discarded-job", "Tech Lead", "Requires 6-10 years.", "https://www.linkedin.com/jobs/view/123");

        const first = prepareDashboardExtensionSession("discarded-job");
        assert.equal(first.url, "https://www.linkedin.com/jobs/view/123");
        assert.equal(first.application.adapter, "EXTENSION");
        assert.equal(first.application.status, "OPENING");
        assert.equal(db.prepare("SELECT status FROM jobs WHERE id = 'discarded-job'").get().status, "PREFILTERED");
        const openingEvent = db.prepare(`
            SELECT event_type, metadata FROM application_events
            WHERE application_id = ? AND event_type = 'OPENING'
            ORDER BY id DESC LIMIT 1
        `).get(first.application.id);
        assert.equal(openingEvent.event_type, "OPENING");
        assert.equal(JSON.parse(openingEvent.metadata).source, "DASHBOARD_OPEN_WITH_EXTENSION");

        const second = prepareDashboardExtensionSession("discarded-job");
        assert.equal(second.application.id, first.application.id);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM applications WHERE job_id = 'discarded-job'").get().count, 1);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM application_attempts WHERE application_id = ?").get(first.application.id).count, 1);

        const resumedAttempt = db.prepare("SELECT id FROM application_attempts WHERE application_id = ? AND status = 'ACTIVE'").get(first.application.id);
        assert.ok(resumedAttempt?.id);
        db.prepare("UPDATE application_attempts SET started_at = datetime('now', '-4 days') WHERE id = ?").run(resumedAttempt.id);
        const third = prepareDashboardExtensionSession("discarded-job");
        assert.equal(third.application.id, first.application.id);
        const attempts = db.prepare("SELECT id, status FROM application_attempts WHERE application_id = ? ORDER BY started_at").all(first.application.id);
        assert.equal(attempts.length, 2);
        assert.equal(attempts.find((attempt) => attempt.id === resumedAttempt.id).status, "EXPIRED");
        assert.equal(attempts.filter((attempt) => attempt.status === "ACTIVE").length, 1);

        upsertAttentionItem(first.application.id, {
            fieldId: "notice-period", type: "FACT_REQUIRED", title: "Notice period",
            reason: "A verified answer is required.", pageUrl: third.url
        });
        const attentionSessions = listAttentionSessions({ sinceDays: 3 });
        assert.equal(attentionSessions.length, 1);
        assert.equal(attentionSessions[0].applicationId, first.application.id);
        assert.equal(attentionSessions[0].attentionCount, 1);
        assert.deepEqual(attentionSessions[0].platform, { id: "linkedin", label: "LinkedIn" });
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("dashboard control posts through the activation route instead of linking directly", () => {
    const view = fs.readFileSync(new URL("../src/views/index.ejs", import.meta.url), "utf8");
    const routes = fs.readFileSync(new URL("../src/routes/dashboard.js", import.meta.url), "utf8");
    assert.match(view, /method="POST" action="\/jobs\/<%= selected\.id %>\/open-with-extension"[^>]*data-open-with-extension/);
    assert.match(view, /type="button"/);
    assert.match(view, /onsubmit="return false;"/);
    assert.match(view, /data-job-url="<%= selected\.url %>"/);
    assert.doesNotMatch(view, /open-with-extension" target="_blank"/);
    assert.doesNotMatch(view, /href="<%= selected\.url %>"[^>]*>🚀 Open with Extension/);
    const openRoute = routes.slice(routes.indexOf('router.post("/jobs/:id/open-with-extension"'), routes.indexOf('router.post("/jobs/:id/archive"'));
    assert.ok(openRoute.indexOf("ensureDashboardApplicationResume") < openRoute.indexOf("prepareDashboardExtensionSession"));
    assert.match(openRoute, /res\.redirect\(303, redirectTo\(req/);
    assert.doesNotMatch(openRoute, /res\.redirect\(303, prepared\.url\)/);
    assert.match(routes, /const template = job\.resume_template \? resolveTemplateId\(job\.resume_template\) : "ats"/);
    assert.match(routes, /const tailored = await tailorApplication\(job, loadMasterResume\(\), parseAnalysis\(job\.ai_analysis\)\)/);
});

test("dashboard resume preparation imports the filesystem dependency it uses", () => {
    const routes = fs.readFileSync(new URL("../src/routes/dashboard.js", import.meta.url), "utf8");
    assert.match(routes, /import fs from "fs"/);
    assert.match(routes, /fs\.existsSync\(job\.generated_resume_path\)/);
});
