import { defineMigration } from "../migrationRunner.js";

export const candidateJobFeedMigration = defineMigration({
    id: "0003_candidate_job_feed",
    description: "Add atomic, disposable, versioned candidate job feeds",
    up(db) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS candidate_job_feed_builds (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'BUILDING',
                profile_version INTEGER NOT NULL,
                candidate_evidence_signature TEXT NOT NULL,
                algorithm_version TEXT NOT NULL,
                job_registry_signature TEXT NOT NULL,
                source_job_count INTEGER NOT NULL DEFAULT 0,
                eligible_count INTEGER NOT NULL DEFAULT 0,
                feed_count INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER,
                started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                error_message TEXT,
                FOREIGN KEY(user_id) REFERENCES candidate_search_profiles(user_id)
            );

            CREATE TABLE IF NOT EXISTS candidate_job_feed (
                generation_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                job_id TEXT NOT NULL,
                rank INTEGER NOT NULL,
                match_score INTEGER NOT NULL,
                confidence REAL NOT NULL DEFAULT 0,
                eligibility TEXT NOT NULL DEFAULT 'ELIGIBLE',
                profile_version INTEGER NOT NULL,
                job_match_version INTEGER NOT NULL,
                algorithm_version TEXT NOT NULL,
                decision_json TEXT NOT NULL,
                computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(generation_id, job_id),
                FOREIGN KEY(generation_id) REFERENCES candidate_job_feed_builds(id) ON DELETE CASCADE,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS candidate_job_feed_state (
                user_id TEXT PRIMARY KEY,
                active_generation_id TEXT NOT NULL,
                profile_version INTEGER NOT NULL,
                candidate_evidence_signature TEXT NOT NULL,
                algorithm_version TEXT NOT NULL,
                job_registry_signature TEXT NOT NULL,
                built_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES candidate_search_profiles(user_id),
                FOREIGN KEY(active_generation_id) REFERENCES candidate_job_feed_builds(id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_job_feed_rank
                ON candidate_job_feed(generation_id, rank);
            CREATE INDEX IF NOT EXISTS idx_candidate_job_feed_user_generation
                ON candidate_job_feed(user_id, generation_id, rank);
            CREATE INDEX IF NOT EXISTS idx_candidate_job_feed_job
                ON candidate_job_feed(job_id, user_id);
            CREATE INDEX IF NOT EXISTS idx_candidate_job_feed_builds_user
                ON candidate_job_feed_builds(user_id, started_at);
        `);
    },
    verify(db) {
        const required = {
            candidate_job_feed_builds: ["id", "user_id", "status", "profile_version", "candidate_evidence_signature",
                "algorithm_version", "job_registry_signature", "feed_count", "duration_ms"],
            candidate_job_feed: ["generation_id", "user_id", "job_id", "rank", "match_score", "profile_version",
                "job_match_version", "algorithm_version", "decision_json"],
            candidate_job_feed_state: ["user_id", "active_generation_id", "profile_version",
                "candidate_evidence_signature", "algorithm_version", "job_registry_signature", "built_at"]
        };
        return Object.entries(required).every(([table, columns]) => {
            const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
            return columns.every((column) => actual.has(column));
        });
    }
});
