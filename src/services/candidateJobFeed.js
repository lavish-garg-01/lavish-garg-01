import crypto from "node:crypto";
import { CONNECTED_JOBS_POLICY } from "../config/connectedJobsPolicy.js";
import { getDb } from "../database/connection.js";
import { getCandidateSearchProfile } from "../repositories/candidateSearchProfileRepository.js";
import { LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { currentCandidateMatchingProfile } from "./currentCandidateMatching.js";
import { buildBm25CorpusStats, evaluateHeuristicMatch } from "./heuristicMatcher.js";
import { MATCHING_POLICY_ALGORITHM_VERSION } from "./matchingPolicy.js";
import { loadResume } from "./resumeStore.js";

const DEFAULT_FEED_SIZE = 300;
const MAX_FEED_SIZE = 300;
const MAX_PAGE_SIZE = 50;
const rebuilds = new Map();

function iso(value = new Date()) {
    return (value instanceof Date ? value : new Date(value)).toISOString();
}

function cutoffDate(now, days) {
    return new Date(new Date(now).getTime() - days * 86400000).toISOString();
}

function hash(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
}

export function candidateEvidenceSignature(profile = {}, resume = {}) {
    return hash(JSON.stringify(stableValue({
        currentTitle: profile.currentTitle || "",
        totalExperienceYears: profile.totalExperienceYears ?? null,
        skills: profile.skills || [],
        resume: {
            summary: resume.summary || "",
            skills: resume.skills || [],
            skillGroups: resume.skillGroups || {},
            experience: (resume.experience || []).map((item) => ({
                title: item.title || "",
                company: item.company || "",
                start: item.start || item.startDate || "",
                end: item.end || item.endDate || "",
                bullets: item.bullets || []
            }))
        }
    })));
}

function registryRows(db, now) {
    const cutoff = cutoffDate(now, CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays);
    return db.prepare(`SELECT id, title, description, status, lifecycle_status, match_version,
            COALESCE(NULLIF(posted_at, ''), created_at) AS effective_posted_at
        FROM jobs
        WHERE status != 'ARCHIVED'
          AND url LIKE 'http%' AND url NOT LIKE '%example.%'
          AND datetime(COALESCE(NULLIF(posted_at, ''), created_at)) >= datetime(?)
        ORDER BY id`).all(cutoff);
}

export function candidateJobRegistrySignature(db = getDb(), now = new Date()) {
    const rows = registryRows(db, now);
    const value = rows.map((row) => [row.id, Number(row.match_version || 1), row.status,
        row.lifecycle_status, row.effective_posted_at].join("|")).join("\n");
    return { signature: hash(value), sourceJobCount: rows.length, rows };
}

function buildCandidates(db, userId, now) {
    const cutoff = cutoffDate(now, CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays);
    const appliedCutoff = cutoffDate(now, CONNECTED_JOBS_POLICY.appliedJobs.nearDuplicateCooldownDays);
    return db.prepare(`SELECT j.*, c.name AS company_name, c.ats_type
        FROM jobs j
        LEFT JOIN companies c ON c.id = j.company_id
        LEFT JOIN job_user_states candidate_state
            ON candidate_state.job_id = j.id AND candidate_state.user_id = ?
        WHERE j.status != 'ARCHIVED'
          AND j.url LIKE 'http%' AND j.url NOT LIKE '%example.%'
          AND j.lifecycle_status != 'CLOSED'
          AND datetime(COALESCE(NULLIF(j.posted_at, ''), j.created_at)) >= datetime(?)
          AND (COALESCE(candidate_state.dismissed, 0) = 0
            OR COALESCE(candidate_state.dismissed_match_version, 0) != COALESCE(j.match_version, 1))
          AND NOT EXISTS (SELECT 1 FROM applications exact_application
              WHERE exact_application.job_id = j.id AND exact_application.user_id = ?
                AND exact_application.status = 'SUCCESS')
          AND NOT EXISTS (
              SELECT 1 FROM applications prior_application
              JOIN jobs prior_job ON prior_job.id = prior_application.job_id
              WHERE prior_application.user_id = ? AND prior_application.status = 'SUCCESS'
                AND datetime(COALESCE(prior_application.submitted_at, prior_application.updated_at,
                    prior_application.created_at)) >= datetime(?)
                AND prior_job.id != j.id
                AND prior_job.posting_series_key IS NOT NULL AND j.posting_series_key IS NOT NULL
                AND prior_job.posting_series_key = j.posting_series_key
          )
        ORDER BY datetime(COALESCE(NULLIF(j.posted_at, ''), j.created_at)) DESC, j.id`)
        .all(userId, cutoff, userId, userId, appliedCutoff);
}

function compactDecision(decision) {
    return {
        eligibility: decision.eligibility,
        score: decision.score,
        matchScore: decision.matchScore,
        confidence: decision.confidence,
        scoringMethod: decision.scoringMethod,
        reasons: decision.reasons,
        gaps: decision.gaps,
        unknowns: decision.unknowns,
        versions: decision.versions,
        dimensions: decision.dimensions,
        matchedSkills: decision.matchedSkills,
        transferableSkills: decision.transferableSkills,
        missingSkills: decision.missingSkills,
        recommendation: decision.recommendation,
        experienceCompatible: decision.experienceCompatible,
        minimumExperienceYears: decision.minimumExperienceYears,
        candidateExperienceYears: decision.candidateExperienceYears
    };
}

function parseDecision(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
}

function newestFirst(left, right) {
    const evidenceWeighted = (item) => Number(item.decision.matchScore || 0)
        * (0.7 + 0.3 * Number(item.decision.confidence || 0));
    const leftTime = Date.parse(left.job.posted_at || left.job.created_at || 0) || 0;
    const rightTime = Date.parse(right.job.posted_at || right.job.created_at || 0) || 0;
    return evidenceWeighted(right) - evidenceWeighted(left)
        || right.decision.matchScore - left.decision.matchScore
        || Number(right.decision.confidence || 0) - Number(left.decision.confidence || 0)
        || rightTime - leftTime
        || String(left.job.id).localeCompare(String(right.job.id));
}

function performRebuild(userId, {
    db,
    profile,
    resume,
    now,
    maxItems,
    evaluate
}) {
    const startedAt = new Date(now);
    const startedMs = Date.now();
    const generationId = crypto.randomUUID();
    const registry = candidateJobRegistrySignature(db, startedAt);
    const evidenceSignature = candidateEvidenceSignature(profile, resume);
    const profileVersion = Number(profile.profileVersion || 1);

    db.prepare(`INSERT INTO candidate_job_feed_builds
        (id, user_id, status, profile_version, candidate_evidence_signature, algorithm_version,
         job_registry_signature, source_job_count, started_at)
        VALUES (?, ?, 'BUILDING', ?, ?, ?, ?, ?, ?)`).run(
        generationId, userId, profileVersion, evidenceSignature, MATCHING_POLICY_ALGORITHM_VERSION,
        registry.signature, registry.sourceJobCount, iso(startedAt)
    );

    try {
        const candidates = buildCandidates(db, userId, startedAt);
        const corpus = buildBm25CorpusStats(registry.rows);
        const evaluated = candidates.map((job) => ({
            job,
            decision: evaluate(job, resume, profile, { corpus, context: "DISCOVERY", saved: false, now: startedAt })
        }));
        const eligible = evaluated.filter(({ decision }) => decision.eligibility.status === "ELIGIBLE").sort(newestFirst);
        const selected = eligible.slice(0, maxItems);
        const durationMs = Math.max(0, Date.now() - startedMs);
        const completedAt = iso(new Date());

        const commit = db.transaction(() => {
            const insert = db.prepare(`INSERT INTO candidate_job_feed
                (generation_id, user_id, job_id, rank, match_score, confidence, eligibility,
                 profile_version, job_match_version, algorithm_version, decision_json, computed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            selected.forEach(({ job, decision }, index) => insert.run(
                generationId, userId, job.id, index + 1, decision.matchScore,
                Number(decision.confidence || 0), decision.eligibility.status, profileVersion,
                Number(job.match_version || 1), MATCHING_POLICY_ALGORITHM_VERSION,
                JSON.stringify(compactDecision(decision)), completedAt
            ));
            db.prepare(`UPDATE candidate_job_feed_builds SET status='READY', eligible_count=?, feed_count=?,
                duration_ms=?, completed_at=? WHERE id=?`).run(eligible.length, selected.length, durationMs, completedAt, generationId);
            db.prepare(`INSERT INTO candidate_job_feed_state
                (user_id, active_generation_id, profile_version, candidate_evidence_signature,
                 algorithm_version, job_registry_signature, built_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    active_generation_id=excluded.active_generation_id,
                    profile_version=excluded.profile_version,
                    candidate_evidence_signature=excluded.candidate_evidence_signature,
                    algorithm_version=excluded.algorithm_version,
                    job_registry_signature=excluded.job_registry_signature,
                    built_at=excluded.built_at,
                    updated_at=excluded.updated_at`).run(
                userId, generationId, profileVersion, evidenceSignature,
                MATCHING_POLICY_ALGORITHM_VERSION, registry.signature, completedAt, completedAt
            );

            // The active pointer changes in the same transaction as the rows.
            // Readers therefore see either the complete old generation or the complete new one.
            db.prepare(`DELETE FROM candidate_job_feed
                WHERE user_id=? AND generation_id != ?`).run(userId, generationId);
            db.prepare(`DELETE FROM candidate_job_feed_builds
                WHERE user_id=? AND id != ? AND status='READY'`).run(userId, generationId);
        });
        commit();
        return {
            generationId,
            status: "READY",
            profileVersion,
            algorithmVersion: MATCHING_POLICY_ALGORITHM_VERSION,
            jobRegistrySignature: registry.signature,
            sourceJobCount: registry.sourceJobCount,
            eligibleCount: eligible.length,
            feedCount: selected.length,
            durationMs,
            builtAt: completedAt
        };
    } catch (error) {
        db.prepare(`UPDATE candidate_job_feed_builds SET status='FAILED', duration_ms=?, completed_at=?,
            error_message=? WHERE id=?`).run(Math.max(0, Date.now() - startedMs), iso(new Date()),
            String(error?.message || error).slice(0, 1000), generationId);
        throw error;
    }
}

export function rebuildCandidateJobFeed(userId = LOCAL_USER_ID, {
    db = getDb(),
    profile = currentCandidateMatchingProfile(userId),
    resume = loadResume(),
    now = new Date(),
    maxItems = DEFAULT_FEED_SIZE,
    evaluate = evaluateHeuristicMatch
} = {}) {
    const key = `${db.name || ":memory:"}:${userId}`;
    if (rebuilds.has(key)) return rebuilds.get(key);
    const boundedItems = Math.max(1, Math.min(MAX_FEED_SIZE, Number(maxItems) || DEFAULT_FEED_SIZE));
    const task = Promise.resolve().then(() => performRebuild(userId, {
        db, profile, resume, now, maxItems: boundedItems, evaluate
    }));
    rebuilds.set(key, task);
    task.finally(() => {
        if (rebuilds.get(key) === task) rebuilds.delete(key);
    }).catch(() => {});
    return task;
}

function currentInputs(userId, options) {
    const profile = options.profile || currentCandidateMatchingProfile(userId);
    const resume = options.resume || loadResume();
    return { profile, resume };
}

export function candidateJobFeedStatus(userId = LOCAL_USER_ID, options = {}) {
    const db = options.db || getDb();
    const now = options.now || new Date();
    const { profile, resume } = currentInputs(userId, options);
    const registry = candidateJobRegistrySignature(db, now);
    const evidenceSignature = candidateEvidenceSignature(profile, resume);
    const state = db.prepare(`SELECT state.*, builds.feed_count, builds.source_job_count,
            builds.eligible_count, builds.duration_ms, builds.status AS build_status
        FROM candidate_job_feed_state state
        JOIN candidate_job_feed_builds builds ON builds.id = state.active_generation_id
        WHERE state.user_id=?`).get(userId);
    const lastBuild = db.prepare(`SELECT id, status, error_message, started_at, completed_at
        FROM candidate_job_feed_builds WHERE user_id=? ORDER BY started_at DESC LIMIT 1`).get(userId);
    if (!state) {
        return {
            status: "MISSING",
            stale: true,
            staleReasons: ["NO_ACTIVE_GENERATION"],
            generationId: null,
            profileVersion: { current: Number(profile.profileVersion || 1), built: null },
            algorithmVersion: { current: MATCHING_POLICY_ALGORITHM_VERSION, built: null },
            jobRegistrySignature: { current: registry.signature, built: null },
            builtAt: null,
            feedCount: 0,
            lastBuild: lastBuild || null
        };
    }
    const staleReasons = [];
    if (Number(state.profile_version) !== Number(profile.profileVersion || 1)) staleReasons.push("PROFILE_VERSION_CHANGED");
    if (state.candidate_evidence_signature !== evidenceSignature) staleReasons.push("CANDIDATE_EVIDENCE_CHANGED");
    if (state.algorithm_version !== MATCHING_POLICY_ALGORITHM_VERSION) staleReasons.push("ALGORITHM_VERSION_CHANGED");
    if (state.job_registry_signature !== registry.signature) staleReasons.push("JOB_REGISTRY_CHANGED");
    return {
        status: staleReasons.length ? "STALE" : "READY",
        stale: Boolean(staleReasons.length),
        staleReasons,
        generationId: state.active_generation_id,
        profileVersion: { current: Number(profile.profileVersion || 1), built: Number(state.profile_version) },
        algorithmVersion: { current: MATCHING_POLICY_ALGORITHM_VERSION, built: state.algorithm_version },
        jobRegistrySignature: { current: registry.signature, built: state.job_registry_signature },
        builtAt: state.built_at,
        feedCount: Number(state.feed_count || 0),
        eligibleCount: Number(state.eligible_count || 0),
        sourceJobCount: Number(state.source_job_count || 0),
        durationMs: Number(state.duration_ms || 0),
        lastBuild: lastBuild || null
    };
}

export async function ensureCandidateJobFeed(userId = LOCAL_USER_ID, options = {}) {
    const status = candidateJobFeedStatus(userId, options);
    if (!options.force && status.status === "READY") return status;
    await rebuildCandidateJobFeed(userId, options);
    return candidateJobFeedStatus(userId, options);
}

function encodeCursor(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
        if (!parsed?.generationId || !Number.isInteger(Number(parsed.rank)) || !parsed.jobId) throw new Error("invalid");
        return { generationId: String(parsed.generationId), rank: Number(parsed.rank), jobId: String(parsed.jobId) };
    } catch {
        const error = new Error("The feed cursor is invalid. Refresh the shortlist and try again.");
        error.code = "INVALID_FEED_CURSOR";
        error.status = 400;
        throw error;
    }
}

const JOB_SELECT = `j.*, c.name AS company_name, c.ats_type,
    candidate_state.seen AS candidate_seen, candidate_state.saved AS candidate_saved,
    CASE WHEN candidate_state.dismissed = 1
        AND candidate_state.dismissed_match_version = COALESCE(j.match_version, 1)
        THEN 1 ELSE 0 END AS candidate_dismissed,
    candidate_state.seen_match_version AS candidate_seen_match_version,
    candidate_state.saved_match_version AS candidate_saved_match_version,
    candidate_state.dismissed_match_version AS candidate_dismissed_match_version,
    candidate_state.seen_at AS candidate_seen_at, candidate_state.saved_at AS candidate_saved_at,
    candidate_state.dismissed_at AS candidate_dismissed_at,
    schema.id AS application_schema_id, schema.last_seen_at AS application_schema_last_seen_at,
    (SELECT COUNT(*) FROM application_schema_fields sf WHERE sf.schema_id = schema.id) AS application_schema_field_count,
    (SELECT COUNT(*) FROM application_schema_fields sf WHERE sf.schema_id = schema.id AND sf.required = 1) AS application_schema_required_count`;

export function listCandidateJobFeed({
    userId = LOCAL_USER_ID,
    limit = 20,
    cursor = null,
    db = getDb(),
    now = new Date(),
    profile,
    resume
} = {}) {
    const boundedLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(limit) || 20));
    const state = db.prepare("SELECT active_generation_id FROM candidate_job_feed_state WHERE user_id=?").get(userId);
    const status = candidateJobFeedStatus(userId, { db, now, ...(profile ? { profile } : {}), ...(resume ? { resume } : {}) });
    if (!state) return { jobs: [], page: { nextCursor: null, hasMore: false, count: 0, total: 0 }, feed: status };
    const decoded = decodeCursor(cursor);
    if (decoded && decoded.generationId !== state.active_generation_id) {
        const error = new Error("This shortlist was refreshed. Start again from the first page.");
        error.code = "FEED_CURSOR_EXPIRED";
        error.status = 409;
        throw error;
    }
    const cutoff = cutoffDate(now, CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays);
    const appliedCutoff = cutoffDate(now, CONNECTED_JOBS_POLICY.appliedJobs.nearDuplicateCooldownDays);
    const afterRank = decoded?.rank || 0;
    const afterJobId = decoded?.jobId || "";
    const rows = db.prepare(`SELECT ${JOB_SELECT}, feed.rank AS feed_rank, feed.decision_json
        FROM candidate_job_feed feed
        JOIN jobs j ON j.id = feed.job_id
        LEFT JOIN companies c ON c.id = j.company_id
        LEFT JOIN job_user_states candidate_state ON candidate_state.job_id=j.id AND candidate_state.user_id=?
        LEFT JOIN current_application_schemas current_schema ON current_schema.job_id=j.id
        LEFT JOIN application_schemas schema ON schema.id=current_schema.schema_id
            AND schema.status='FRESH' AND schema.expires_at > CURRENT_TIMESTAMP
        WHERE feed.user_id=? AND feed.generation_id=?
          AND (feed.rank > ? OR (feed.rank = ? AND feed.job_id > ?))
          AND j.status != 'ARCHIVED' AND j.lifecycle_status != 'CLOSED'
          AND (COALESCE(candidate_state.dismissed, 0)=0
            OR COALESCE(candidate_state.dismissed_match_version, 0) != COALESCE(j.match_version, 1))
          AND datetime(COALESCE(NULLIF(j.posted_at, ''), j.created_at)) >= datetime(?)
          AND NOT EXISTS (SELECT 1 FROM applications exact_application
              WHERE exact_application.job_id=j.id AND exact_application.user_id=?
                AND exact_application.status='SUCCESS')
          AND NOT EXISTS (
              SELECT 1 FROM applications prior_application
              JOIN jobs prior_job ON prior_job.id=prior_application.job_id
              WHERE prior_application.user_id=? AND prior_application.status='SUCCESS'
                AND datetime(COALESCE(prior_application.submitted_at, prior_application.updated_at,
                    prior_application.created_at)) >= datetime(?)
                AND prior_job.id != j.id
                AND prior_job.posting_series_key IS NOT NULL AND j.posting_series_key IS NOT NULL
                AND prior_job.posting_series_key=j.posting_series_key
          )
        ORDER BY feed.rank, feed.job_id LIMIT ?`).all(
        userId, userId, state.active_generation_id, afterRank, afterRank, afterJobId,
        cutoff, userId, userId, appliedCutoff, boundedLimit + 1
    );
    const visible = rows.slice(0, boundedLimit);
    const hasMore = rows.length > boundedLimit;
    const last = visible.at(-1);
    const total = db.prepare(`SELECT COUNT(*) AS count FROM candidate_job_feed feed
        JOIN jobs j ON j.id=feed.job_id
        LEFT JOIN job_user_states candidate_state ON candidate_state.job_id=j.id AND candidate_state.user_id=?
        WHERE feed.user_id=? AND feed.generation_id=?
          AND j.status != 'ARCHIVED' AND j.lifecycle_status != 'CLOSED'
          AND (COALESCE(candidate_state.dismissed, 0)=0
            OR COALESCE(candidate_state.dismissed_match_version, 0) != COALESCE(j.match_version, 1))
          AND datetime(COALESCE(NULLIF(j.posted_at, ''), j.created_at)) >= datetime(?)
          AND NOT EXISTS (SELECT 1 FROM applications exact_application
              WHERE exact_application.job_id=j.id AND exact_application.user_id=?
                AND exact_application.status='SUCCESS')
          AND NOT EXISTS (
              SELECT 1 FROM applications prior_application
              JOIN jobs prior_job ON prior_job.id=prior_application.job_id
              WHERE prior_application.user_id=? AND prior_application.status='SUCCESS'
                AND datetime(COALESCE(prior_application.submitted_at, prior_application.updated_at,
                    prior_application.created_at)) >= datetime(?)
                AND prior_job.id != j.id
                AND prior_job.posting_series_key IS NOT NULL AND j.posting_series_key IS NOT NULL
                AND prior_job.posting_series_key=j.posting_series_key
          )`).get(
        userId, userId, state.active_generation_id, cutoff, userId, userId, appliedCutoff
    ).count;
    return {
        jobs: visible.map((row) => ({ job: row, decision: parseDecision(row.decision_json) })),
        page: {
            nextCursor: hasMore && last ? encodeCursor({
                generationId: state.active_generation_id,
                rank: Number(last.feed_rank),
                jobId: last.id
            }) : null,
            hasMore,
            count: visible.length,
            total: Number(total || 0)
        },
        feed: status
    };
}

export function listSavedCandidateJobs({ userId = LOCAL_USER_ID, limit = 100, db = getDb() } = {}) {
    const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const rows = db.prepare(`SELECT ${JOB_SELECT}, feed.decision_json
        FROM job_user_states candidate_state
        JOIN jobs j ON j.id=candidate_state.job_id
        LEFT JOIN companies c ON c.id=j.company_id
        LEFT JOIN candidate_job_feed_state active_feed ON active_feed.user_id=candidate_state.user_id
        LEFT JOIN candidate_job_feed feed ON feed.generation_id=active_feed.active_generation_id
            AND feed.user_id=candidate_state.user_id AND feed.job_id=j.id
        LEFT JOIN current_application_schemas current_schema ON current_schema.job_id=j.id
        LEFT JOIN application_schemas schema ON schema.id=current_schema.schema_id
            AND schema.status='FRESH' AND schema.expires_at > CURRENT_TIMESTAMP
        WHERE candidate_state.user_id=? AND candidate_state.saved=1
        ORDER BY candidate_state.updated_at DESC LIMIT ?`).all(userId, boundedLimit);
    return rows.map((row) => ({ job: row, decision: parseDecision(row.decision_json) }));
}

export function getCandidateJobDetail(jobId, { userId = LOCAL_USER_ID, db = getDb() } = {}) {
    const row = db.prepare(`SELECT ${JOB_SELECT}, feed.decision_json
        FROM jobs j
        LEFT JOIN companies c ON c.id=j.company_id
        LEFT JOIN job_user_states candidate_state ON candidate_state.job_id=j.id AND candidate_state.user_id=?
        LEFT JOIN candidate_job_feed_state active_feed ON active_feed.user_id=?
        LEFT JOIN candidate_job_feed feed ON feed.generation_id=active_feed.active_generation_id
            AND feed.user_id=? AND feed.job_id=j.id
        LEFT JOIN current_application_schemas current_schema ON current_schema.job_id=j.id
        LEFT JOIN application_schemas schema ON schema.id=current_schema.schema_id
            AND schema.status='FRESH' AND schema.expires_at > CURRENT_TIMESTAMP
        WHERE j.id=?`).get(userId, userId, userId, jobId);
    return row ? { job: row, decision: parseDecision(row.decision_json) } : null;
}

export function activeFeedGeneration(userId = LOCAL_USER_ID, { db = getDb() } = {}) {
    return db.prepare("SELECT active_generation_id FROM candidate_job_feed_state WHERE user_id=?").get(userId)?.active_generation_id || null;
}
