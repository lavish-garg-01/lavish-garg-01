import { defineMigration } from "../migrationRunner.js";

export const jobLifecycleMigration = defineMigration({
    id: "0001_job_lifecycle",
    description: "Add global job normalization, lifecycle evidence, raw snapshots, and soft availability verification",
    up(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(jobs)").all().map((column) => column.name));
        const add = (name, ddl) => {
            if (!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${ddl}`);
        };

        add("lifecycle_status", "lifecycle_status TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("lifecycle_reason", "lifecycle_reason TEXT");
        add("lifecycle_confidence", "lifecycle_confidence REAL NOT NULL DEFAULT 0");
        add("explicit_deadline", "explicit_deadline DATETIME");
        add("last_verified_at", "last_verified_at DATETIME");
        add("next_check_at", "next_check_at DATETIME");
        add("closed_at", "closed_at DATETIME");
        add("consecutive_verification_failures", "consecutive_verification_failures INTEGER NOT NULL DEFAULT 0");
        add("closure_evidence_source", "closure_evidence_source TEXT");
        add("employment_type", "employment_type TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("seniority_level", "seniority_level TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("country_code", "country_code TEXT");
        add("remote_scope", "remote_scope TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("sponsorship_policy", "sponsorship_policy TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("relocation_policy", "relocation_policy TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("travel_requirement", "travel_requirement TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("bond_policy", "bond_policy TEXT NOT NULL DEFAULT 'UNKNOWN'");
        add("primary_stack", "primary_stack TEXT");
        add("required_skills_json", "required_skills_json TEXT NOT NULL DEFAULT '[]'");
        add("secondary_skills_json", "secondary_skills_json TEXT NOT NULL DEFAULT '[]'");
        add("match_fingerprint", "match_fingerprint TEXT");
        add("match_version", "match_version INTEGER NOT NULL DEFAULT 1");
        add("posting_series_key", "posting_series_key TEXT");
        add("normalizer_version", "normalizer_version TEXT");

        db.exec(`
            CREATE TABLE IF NOT EXISTS job_raw_snapshots (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                source TEXT NOT NULL,
                source_url TEXT NOT NULL,
                raw_text TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{}',
                content_hash TEXT NOT NULL,
                parser_version TEXT NOT NULL,
                fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(job_id, content_hash),
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );
            CREATE TABLE IF NOT EXISTS job_lifecycle_events (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                from_status TEXT,
                to_status TEXT NOT NULL,
                reason TEXT NOT NULL,
                evidence_source TEXT NOT NULL,
                evidence_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );
            CREATE TABLE IF NOT EXISTS job_verification_requests (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN',
                reason TEXT NOT NULL,
                claimed_by_user_id TEXT,
                claim_expires_at DATETIME,
                result TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );
            CREATE TABLE IF NOT EXISTS job_availability_reports (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                request_id TEXT,
                user_id TEXT NOT NULL,
                result TEXT NOT NULL,
                evidence_source TEXT NOT NULL DEFAULT 'USER',
                evidence_code TEXT NOT NULL DEFAULT 'NONE',
                confidence REAL NOT NULL DEFAULT 0,
                evidence_json TEXT NOT NULL DEFAULT '{}',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES jobs(id),
                FOREIGN KEY(request_id) REFERENCES job_verification_requests(id)
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_lifecycle_discovery
                ON jobs(lifecycle_status, posted_at, created_at);
            CREATE INDEX IF NOT EXISTS idx_jobs_lifecycle_check
                ON jobs(next_check_at, lifecycle_status);
            CREATE INDEX IF NOT EXISTS idx_job_raw_snapshots_job
                ON job_raw_snapshots(job_id, fetched_at);
            CREATE INDEX IF NOT EXISTS idx_job_lifecycle_events_job
                ON job_lifecycle_events(job_id, created_at);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_job_verification_one_open
                ON job_verification_requests(job_id)
                WHERE status IN ('OPEN', 'CLAIMED');
            CREATE INDEX IF NOT EXISTS idx_job_verification_claim
                ON job_verification_requests(status, claim_expires_at);
            CREATE INDEX IF NOT EXISTS idx_job_availability_reports_job
                ON job_availability_reports(job_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_job_availability_reports_user
                ON job_availability_reports(user_id, created_at);
        `);

        // The former runner archived by age at 3/7 days. Restore rows that are
        // still inside the now-authoritative 14-day discovery window.
        db.exec(`
            UPDATE jobs
            SET status = archived_from_status,
                archived_from_status = NULL,
                archived_at = NULL
            WHERE status = 'ARCHIVED'
              AND archived_from_status IN ('PENDING', 'MATCHED', 'CLOSE')
              AND COALESCE(NULLIF(posted_at, ''), created_at) >= datetime('now', '-14 days');

            UPDATE jobs
            SET lifecycle_status = CASE
                    WHEN COALESCE(NULLIF(posted_at, ''), NULLIF(last_seen_at, ''), created_at) >= datetime('now', '-14 days')
                        THEN 'ACTIVE'
                    ELSE 'UNKNOWN'
                END,
                lifecycle_reason = CASE
                    WHEN COALESCE(NULLIF(posted_at, ''), NULLIF(last_seen_at, ''), created_at) >= datetime('now', '-14 days')
                        THEN 'MIGRATED_RECENT_OBSERVATION'
                    ELSE 'MIGRATED_WITHOUT_RECENT_VERIFICATION'
                END,
                lifecycle_confidence = CASE
                    WHEN COALESCE(NULLIF(posted_at, ''), NULLIF(last_seen_at, ''), created_at) >= datetime('now', '-14 days')
                        THEN 0.65
                    ELSE 0
                END,
                last_verified_at = COALESCE(last_seen_at, last_scraped_at),
                next_check_at = CASE
                    WHEN COALESCE(NULLIF(posted_at, ''), created_at) >= datetime('now', '-7 days')
                        THEN datetime('now', '+12 hours')
                    ELSE datetime('now', '+1 day')
                END,
                bond_policy = CASE WHEN has_bond = 1 THEN 'REQUIRED' ELSE 'UNKNOWN' END,
                match_version = CASE WHEN match_version < 1 THEN 1 ELSE match_version END;

            INSERT OR IGNORE INTO job_raw_snapshots
                (id, job_id, source, source_url, raw_text, payload_json, content_hash, parser_version, fetched_at)
            SELECT job_id || ':legacy-v1', job_id, source, url, description, '{}',
                   COALESCE(NULLIF(content_fingerprint, ''), job_id || ':legacy-v1'),
                   'legacy-import-v1', COALESCE(last_scraped_at, last_seen_at, created_at)
            FROM (SELECT id AS job_id, source, url, description, content_fingerprint,
                         last_scraped_at, last_seen_at, created_at FROM jobs);
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(jobs)").all().map((column) => column.name));
        const requiredColumns = [
            "lifecycle_status", "match_version", "match_fingerprint", "posting_series_key",
            "employment_type", "seniority_level", "primary_stack", "required_skills_json"
        ];
        const requiredTables = [
            "job_raw_snapshots", "job_lifecycle_events", "job_verification_requests", "job_availability_reports"
        ];
        return requiredColumns.every((column) => columns.has(column))
            && requiredTables.every((table) => Boolean(db.prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
            ).get(table)));
    }
});

