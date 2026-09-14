import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a rebound session records recovery without parking the application", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-session-rebind-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recoverExtensionSession } = await import("../src/services/sessionRecovery.js");
    const { listAttentionItems } = await import("../src/repositories/attentionRepository.js");
    const { getApplication } = await import("../src/repositories/applicationRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-r', 'Backend', '', 'https://acme.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter, status) VALUES ('app-r', 'job-r', 'EXTENSION', 'FILLING')").run();

        const result = recoverExtensionSession({ jobId: "job-r", pageUrl: "https://acme.rippling.com/apply", rebound: true });
        assert.deepEqual(result, { recovered: true, rebound: true, applicationId: "app-r" });

        const events = db.prepare("SELECT event_type FROM learning_events WHERE application_id = 'app-r'").all();
        assert.deepEqual(events.map((event) => event.event_type), ["SESSION_RECOVERED"]);
        assert.equal(getApplication("app-r").status, "FILLING");
        assert.equal(listAttentionItems().length, 0);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("a session with no surviving tab is parked in the Attention Center", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-session-park-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { recoverExtensionSession } = await import("../src/services/sessionRecovery.js");
    const { listAttentionItems, attentionCount } = await import("../src/repositories/attentionRepository.js");
    const { getApplication } = await import("../src/repositories/applicationRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-p', 'Backend', '', 'https://acme.rippling.com/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter, status) VALUES ('app-p', 'job-p', 'EXTENSION', 'FILLING')").run();

        const result = recoverExtensionSession({ jobId: "job-p", pageUrl: "https://acme.rippling.com/apply" });
        assert.equal(result.rebound, false);
        assert.equal(getApplication("app-p").status, "WAITING_FOR_USER");

        const [item] = listAttentionItems();
        assert.equal(item.fieldId, "__session_recovery__");
        assert.equal(item.type, "SUBMISSION_REVIEW");
        assert.equal(item.blocking, true);
        assert.equal(attentionCount() >= 1, true);
        assert.match(item.reason, /browser restarted/i);

        const events = db.prepare("SELECT event_type FROM learning_events WHERE application_id = 'app-p'").all();
        assert.deepEqual(events.map((event) => event.event_type), ["SESSION_RECOVERED"]);
        const attempt = db.prepare("SELECT status, confirmation_source FROM application_attempts WHERE application_id = 'app-p' ORDER BY started_at DESC").get();
        assert.equal(attempt.status, "PENDING_REVIEW");
        assert.equal(attempt.confirmation_source, "CHROME_RESTARTED");

        // A submitted application is never reopened by a restart.
        db.prepare("UPDATE applications SET status = 'SUCCESS' WHERE id = 'app-p'").run();
        assert.deepEqual(recoverExtensionSession({ jobId: "job-p" }), { recovered: false, alreadySubmitted: true });
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("candidate verification resolves every submission-recovery prompt", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-session-confirm-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { upsertAttentionItem, resolveAttentionItemsByType, listAttentionItems } = await import("../src/repositories/attentionRepository.js");
    try {
        const db = getDb();
        db.prepare("INSERT INTO jobs (id, title, description, url, source) VALUES ('job-c', 'Backend', '', 'https://acme.example/apply', 'test')").run();
        db.prepare("INSERT INTO applications (id, job_id, adapter, status) VALUES ('app-c', 'job-c', 'EXTENSION', 'WAITING_FOR_USER')").run();
        for (const fieldId of ["__submission_review__", "__session_recovery__"]) {
            upsertAttentionItem("app-c", {
                fieldId,
                type: "SUBMISSION_REVIEW",
                title: "Was this submitted?",
                reason: "Submission has not been verified.",
                semanticKey: "APPLICATION_SUBMISSION_STATUS"
            });
        }

        assert.equal(resolveAttentionItemsByType("app-c", "SUBMISSION_REVIEW"), 2);
        assert.equal(listAttentionItems({ applicationId: "app-c" }).length, 0);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("the service worker rebinds or parks the stored session on Chrome startup", () => {
    const background = fs.readFileSync(path.join(root, "extension/background.js"), "utf8");
    assert.match(background, /chrome\.runtime\.onStartup\.addListener\(\(\) => \{\s*\n\s*void configureSidePanel\(\);\s*\n\s*void restoreSessionAfterRestart\(\)/);
    assert.match(background, /async function restoreSessionAfterRestart/);
    assert.match(background, /function sameApplicationPage/);
    // Rebinds the live tab id, since Chrome hands out new ids after a restart.
    assert.match(background, /await chrome\.storage\.local\.set\(\{ activeTabId: tab\.id, isPaused: false \}\)/);
    assert.match(background, /"\/api\/extension\/session\/recovered"/);
    assert.match(background, /rebound: true/);
    assert.match(background, /rebound: false/);
    assert.match(background, /reason: "CHROME_RESTARTED"/);
    assert.match(background, /if \(!stored\.activeJob\?\.id && currentTab\?\.id/);
    assert.match(background, /jobContext\(currentTab\.url, currentTab\.id\)/);

    const routes = fs.readFileSync(path.join(root, "src/routes/extension.js"), "utf8");
    assert.match(routes, /router\.post\("\/api\/extension\/session\/recovered"/);

    const copilotRoutes = fs.readFileSync(path.join(root, "src/routes/copilot.js"), "utf8");
    assert.match(copilotRoutes, /confirmationSource: "CANDIDATE_VERIFIED"/);
    assert.match(copilotRoutes, /resolveAttentionItemsByType\(application\.id, "SUBMISSION_REVIEW"\)/);
});
