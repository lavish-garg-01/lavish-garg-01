import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";

function iso(value = new Date()) {
    return (value instanceof Date ? value : new Date(value)).toISOString();
}

function publicState(row, currentMatchVersion) {
    const version = Number(currentMatchVersion || row?.current_match_version || 1);
    const dismissedVersion = row?.dismissed_match_version == null ? null : Number(row.dismissed_match_version);
    const seenVersion = row?.seen_match_version == null ? null : Number(row.seen_match_version);
    const savedVersion = row?.saved_match_version == null ? null : Number(row.saved_match_version);
    const dismissedForCurrentVersion = Boolean(row?.dismissed) && dismissedVersion === version;
    return {
        seen: Boolean(row?.seen),
        saved: Boolean(row?.saved),
        dismissed: dismissedForCurrentVersion,
        dismissedForOlderVersion: Boolean(row?.dismissed) && !dismissedForCurrentVersion,
        hasMaterialUpdate: Boolean(row?.seen) && seenVersion != null && seenVersion < version,
        currentMatchVersion: version,
        seenMatchVersion: seenVersion,
        savedMatchVersion: savedVersion,
        dismissedMatchVersion: dismissedVersion,
        seenAt: row?.seen_at || null,
        savedAt: row?.saved_at || null,
        dismissedAt: row?.dismissed_at || null
    };
}

export function getJobUserState(jobId, userId = LOCAL_USER_ID, { db = getDb() } = {}) {
    const row = db.prepare(`SELECT state.*, job.match_version AS current_match_version
        FROM jobs job
        LEFT JOIN job_user_states state ON state.job_id=job.id AND state.user_id=?
        WHERE job.id=?`).get(userId, jobId);
    return row ? publicState(row, row.current_match_version) : null;
}

export function updateJobUserState(jobId, patch, userId = LOCAL_USER_ID, {
    db = getDb(),
    now = new Date()
} = {}) {
    const job = db.prepare("SELECT id, match_version FROM jobs WHERE id=?").get(jobId);
    if (!job) return null;
    const timestamp = iso(now);
    const current = db.prepare("SELECT * FROM job_user_states WHERE user_id=? AND job_id=?")
        .get(userId, jobId) || {};
    const next = {
        seen: patch.seen === undefined
            ? Boolean(current.seen) || patch.saved === true || patch.dismissed === true
            : Boolean(patch.seen),
        saved: patch.saved === undefined ? Boolean(current.saved) : Boolean(patch.saved),
        dismissed: patch.dismissed === undefined ? Boolean(current.dismissed) : Boolean(patch.dismissed)
    };
    const matchVersion = Number(job.match_version || 1);
    const impliesSeen = patch.seen === true || patch.saved === true || patch.dismissed === true;
    const seenAt = impliesSeen ? (current.seen ? current.seen_at : timestamp)
        : patch.seen === false ? null : current.seen_at || null;
    const savedAt = patch.saved === true ? (current.saved ? current.saved_at : timestamp)
        : patch.saved === false ? null : current.saved_at || null;
    const dismissedAt = patch.dismissed === true ? timestamp
        : patch.dismissed === false ? null : current.dismissed_at || null;
    const seenVersion = impliesSeen ? matchVersion
        : patch.seen === false ? null : current.seen_match_version ?? null;
    const savedVersion = patch.saved === true ? matchVersion
        : patch.saved === false ? null : current.saved_match_version ?? null;
    const dismissedVersion = patch.dismissed === true ? matchVersion
        : patch.dismissed === false ? null : current.dismissed_match_version ?? null;

    db.prepare(`INSERT INTO job_user_states
        (user_id, job_id, seen, saved, dismissed, seen_match_version, saved_match_version,
         dismissed_match_version, seen_at, saved_at, dismissed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, job_id) DO UPDATE SET
            seen=excluded.seen,
            saved=excluded.saved,
            dismissed=excluded.dismissed,
            seen_match_version=excluded.seen_match_version,
            saved_match_version=excluded.saved_match_version,
            dismissed_match_version=excluded.dismissed_match_version,
            seen_at=excluded.seen_at,
            saved_at=excluded.saved_at,
            dismissed_at=excluded.dismissed_at,
            updated_at=excluded.updated_at`).run(
        userId, jobId, next.seen ? 1 : 0, next.saved ? 1 : 0, next.dismissed ? 1 : 0,
        seenVersion, savedVersion, dismissedVersion, seenAt, savedAt, dismissedAt, timestamp
    );
    return getJobUserState(jobId, userId, { db });
}

export function isDismissedForCurrentVersion(row) {
    return Boolean(row?.dismissed)
        && Number(row.dismissed_match_version || 0) === Number(row.match_version || row.current_match_version || 1);
}
