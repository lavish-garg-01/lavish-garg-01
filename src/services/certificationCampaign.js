import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { classifyEngineCoverage } from "../adapters/engineCatalog.js";
import { resolvePortal } from "../adapters/registry.js";

export const CERTIFICATION_STATUSES = Object.freeze([
    "DISCOVERED", "FINGERPRINTED", "FIXTURE_LOCKED", "LIVE_VERIFIED",
    "RETEST_REQUIRED", "BLOCKED_AUTH", "BLOCKED_CAPTCHA", "REJECTED_UNSAFE"
]);

function normalizedUrl(value = "") {
    const url = new URL(String(value));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
        if (/^utm_|gclid|fbclid|source|ref|tracking/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
}

function targetId(siteHost, careerUrl) {
    return crypto.createHash("sha256").update(`${siteHost}|${careerUrl}`).digest("hex").slice(0, 32);
}

export function upsertCareerTestTarget({ companyName = "", careerUrl, priority = 50, source = "OBSERVED_JOB", requiresLogin = false } = {}) {
    const cleanUrl = normalizedUrl(careerUrl);
    const coverage = classifyEngineCoverage(cleanUrl);
    const id = targetId(coverage.hostname, cleanUrl);
    getDb().prepare(`
        INSERT INTO career_test_targets
            (id, company_name, career_url, site_host, portal_kind, support_tier, priority, requires_login, source)
        VALUES (@id, @companyName, @careerUrl, @siteHost, @portalKind, @supportTier, @priority, @requiresLogin, @source)
        ON CONFLICT(site_host, career_url) DO UPDATE SET
            company_name = CASE WHEN excluded.company_name != '' THEN excluded.company_name ELSE career_test_targets.company_name END,
            portal_kind = excluded.portal_kind,
            support_tier = excluded.support_tier,
            priority = MAX(career_test_targets.priority, excluded.priority),
            requires_login = MAX(career_test_targets.requires_login, excluded.requires_login),
            updated_at = CURRENT_TIMESTAMP
    `).run({
        id, companyName: String(companyName).slice(0, 160), careerUrl: cleanUrl,
        siteHost: coverage.hostname, portalKind: coverage.portalKind, supportTier: coverage.tier,
        priority: Math.max(0, Math.min(100, Number(priority) || 50)),
        requiresLogin: requiresLogin ? 1 : 0, source: String(source).slice(0, 40)
    });
    return getDb().prepare("SELECT * FROM career_test_targets WHERE site_host = ? AND career_url = ?").get(coverage.hostname, cleanUrl);
}

export function seedCareerTargetsFromJobs({ limit = 5000 } = {}) {
    const rows = getDb().prepare(`
        SELECT j.url AS careerUrl, COALESCE(c.name, '') AS companyName,
               CASE WHEN j.status IN ('APPLIED','SUCCESS') THEN 90 WHEN j.match_score >= 75 THEN 75 ELSE 50 END AS priority
        FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE COALESCE(j.url, '') != ''
        ORDER BY priority DESC, j.created_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(5000, Number(limit) || 5000)));
    for (const row of rows) upsertCareerTestTarget(row);
    return campaignSummary();
}

export function shouldRunTarget(target, { extensionVersion, adapterVersion, pageFingerprint = null } = {}) {
    if (!target?.id) return { run: false, reason: "missing_target" };
    if (["BLOCKED_AUTH", "BLOCKED_CAPTCHA", "REJECTED_UNSAFE"].includes(target.status)) {
        return { run: false, reason: target.status.toLowerCase() };
    }
    const passed = getDb().prepare(`
        SELECT id FROM career_test_runs
        WHERE target_id = ? AND extension_version = ? AND adapter_version = ?
          AND COALESCE(page_fingerprint, '') = COALESCE(?, '')
          AND status IN ('PASS','LIVE_VERIFIED')
        ORDER BY completed_at DESC LIMIT 1
    `).get(target.id, String(extensionVersion), String(adapterVersion), pageFingerprint);
    return passed ? { run: false, reason: "already_verified_same_build_and_fingerprint", priorRunId: passed.id }
        : { run: true, reason: target.status === "RETEST_REQUIRED" ? "retest_required" : "unverified_build_or_fingerprint" };
}

export function startCertificationRun({ targetId: id, personaId, extensionVersion, pageFingerprint = null, runKind = "FIXTURE" } = {}) {
    const target = getDb().prepare("SELECT * FROM career_test_targets WHERE id = ?").get(id);
    if (!target) throw new Error("Career test target not found.");
    const adapterVersion = resolvePortal(target.portal_kind).version;
    const decision = shouldRunTarget(target, { extensionVersion, adapterVersion, pageFingerprint });
    if (!decision.run) return { skipped: true, ...decision };
    const runId = crypto.randomUUID();
    getDb().prepare(`INSERT INTO career_test_runs
        (id, target_id, persona_id, extension_version, adapter_version, page_fingerprint, run_kind, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING')`).run(
        runId, id, String(personaId), String(extensionVersion), adapterVersion, pageFingerprint, String(runKind)
    );
    getDb().prepare("UPDATE career_test_targets SET status = 'FINGERPRINTED', page_fingerprint = ?, last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(pageFingerprint, id);
    return { skipped: false, runId, adapterVersion };
}

export function completeCertificationRun(runId, { status, detected = 0, filled = 0, review = 0, failureClasses = [], fixturePath = null } = {}) {
    const finalStatus = String(status || "FAIL").toUpperCase();
    if (!new Set(["PASS", "FAIL", "LIVE_VERIFIED", "BLOCKED_AUTH", "BLOCKED_CAPTCHA", "REJECTED_UNSAFE"]).has(finalStatus)) {
        throw new Error("Unsupported certification result.");
    }
    const run = getDb().prepare("SELECT * FROM career_test_runs WHERE id = ?").get(runId);
    if (!run) throw new Error("Certification run not found.");
    getDb().prepare(`UPDATE career_test_runs SET status = ?, detected_count = ?, filled_count = ?, review_count = ?,
        failure_classes_json = ?, fixture_path = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        finalStatus, Number(detected) || 0, Number(filled) || 0, Number(review) || 0,
        JSON.stringify([...new Set(failureClasses.map(String))]), fixturePath, runId
    );
    const targetStatus = finalStatus === "LIVE_VERIFIED" ? "LIVE_VERIFIED"
        : finalStatus === "PASS" ? "FIXTURE_LOCKED"
            : finalStatus === "FAIL" ? "RETEST_REQUIRED" : finalStatus;
    getDb().prepare(`UPDATE career_test_targets SET status = ?,
        last_verified_at = CASE WHEN ? IN ('PASS','LIVE_VERIFIED') THEN CURRENT_TIMESTAMP ELSE last_verified_at END,
        last_extension_version = ?, last_adapter_version = ?,
        failure_count = failure_count + CASE WHEN ? = 'FAIL' THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        targetStatus, finalStatus, run.extension_version, run.adapter_version, finalStatus, run.target_id
    );
    return getDb().prepare("SELECT * FROM career_test_targets WHERE id = ?").get(run.target_id);
}

export function nextCertificationBatch({ limit = 20 } = {}) {
    const max = Math.max(1, Math.min(100, Number(limit) || 20));
    const candidates = getDb().prepare(`
        SELECT * FROM career_test_targets
        WHERE status NOT IN ('BLOCKED_AUTH','BLOCKED_CAPTCHA','REJECTED_UNSAFE')
        ORDER BY CASE status WHEN 'RETEST_REQUIRED' THEN 0 WHEN 'DISCOVERED' THEN 1 WHEN 'FINGERPRINTED' THEN 2 ELSE 3 END,
                 CASE support_tier WHEN 'REGRESSION_LOCKED' THEN 0 WHEN 'DISCOVERY_ONLY' THEN 1 ELSE 2 END,
                 priority DESC, updated_at ASC
        LIMIT 2000
    `).all();
    const groups = new Map();
    for (const target of candidates) {
        const key = target.portal_kind || "generic";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(target);
    }
    const batch = [];
    while (batch.length < max && [...groups.values()].some((items) => items.length)) {
        for (const items of groups.values()) {
            if (items.length && batch.length < max) batch.push(items.shift());
        }
    }
    return batch;
}

export function campaignSummary() {
    const byTier = getDb().prepare("SELECT support_tier AS tier, COUNT(*) AS count FROM career_test_targets GROUP BY support_tier").all();
    const byStatus = getDb().prepare("SELECT status, COUNT(*) AS count FROM career_test_targets GROUP BY status").all();
    return { total: byTier.reduce((sum, row) => sum + Number(row.count), 0), byTier, byStatus };
}
