import { getDb } from "../database/connection.js";
import {
    JOB_NORMALIZER_VERSION,
    jobMatchFingerprint,
    jobPostingSeriesKey,
    normalizeJobForRegistry
} from "./jobNormalizer.js";

/**
 * Brings legacy rows into the current read model without changing their
 * scoring workflow status. Re-running is cheap because normalized rows are
 * skipped; a future normalizer version can deliberately rebuild the model.
 */
export function backfillJobRegistry(db = getDb(), { limit = 10_000 } = {}) {
    const rows = db.prepare(`SELECT j.*, c.name AS company
        FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.normalizer_version IS NULL OR j.normalizer_version != ?
        ORDER BY j.created_at LIMIT ?`).all(JOB_NORMALIZER_VERSION, Math.max(1, Number(limit) || 10_000));
    const update = db.prepare(`UPDATE jobs SET
        employment_type = ?, seniority_level = ?, country_code = ?, remote_scope = ?,
        sponsorship_policy = ?, relocation_policy = ?, travel_requirement = ?, bond_policy = ?,
        primary_stack = ?, required_skills_json = ?, secondary_skills_json = ?,
        explicit_deadline = COALESCE(?, explicit_deadline),
        match_fingerprint = ?, posting_series_key = ?, normalizer_version = ?,
        match_version = CASE WHEN match_fingerprint IS NOT NULL AND match_fingerprint != ?
            THEN COALESCE(match_version, 1) + 1 ELSE COALESCE(match_version, 1) END
        WHERE id = ?`);
    const apply = db.transaction(() => {
        for (const row of rows) {
            const normalized = normalizeJobForRegistry(row);
            const fingerprint = jobMatchFingerprint(row, normalized);
            update.run(
                normalized.employmentType, normalized.seniorityLevel, normalized.countryCode,
                normalized.remoteScope, normalized.sponsorshipPolicy, normalized.relocationPolicy,
                normalized.travelRequirement, normalized.bondPolicy, normalized.primaryStack,
                JSON.stringify(normalized.requiredSkills), JSON.stringify(normalized.secondarySkills),
                normalized.explicitDeadline, fingerprint, jobPostingSeriesKey(row, normalized),
                normalized.normalizerVersion, fingerprint, row.id
            );
        }
    });
    apply();
    return rows.length;
}
