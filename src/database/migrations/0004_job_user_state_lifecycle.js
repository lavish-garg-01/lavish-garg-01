import { defineMigration } from "../migrationRunner.js";

export const jobUserStateLifecycleMigration = defineMigration({
    id: "0004_job_user_state_lifecycle",
    description: "Add version-aware candidate job state and lifecycle timestamps",
    up(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(job_user_states)").all().map((column) => column.name));
        const add = (name, ddl) => {
            if (!columns.has(name)) db.exec(`ALTER TABLE job_user_states ADD COLUMN ${ddl}`);
        };

        add("seen", "seen INTEGER NOT NULL DEFAULT 0");
        add("seen_match_version", "seen_match_version INTEGER");
        add("seen_at", "seen_at DATETIME");
        add("saved_match_version", "saved_match_version INTEGER");
        add("saved_at", "saved_at DATETIME");
        add("dismissed_match_version", "dismissed_match_version INTEGER");
        add("dismissed_at", "dismissed_at DATETIME");

        db.exec(`
            UPDATE job_user_states
            SET seen = CASE WHEN saved = 1 OR dismissed = 1 THEN 1 ELSE seen END,
                seen_match_version = CASE
                    WHEN (saved = 1 OR dismissed = 1) AND seen_match_version IS NULL
                    THEN (SELECT match_version FROM jobs WHERE jobs.id = job_user_states.job_id)
                    ELSE seen_match_version END,
                seen_at = CASE WHEN (saved = 1 OR dismissed = 1) AND seen_at IS NULL THEN updated_at ELSE seen_at END,
                saved_match_version = CASE
                    WHEN saved = 1 AND saved_match_version IS NULL
                    THEN (SELECT match_version FROM jobs WHERE jobs.id = job_user_states.job_id)
                    ELSE saved_match_version END,
                saved_at = CASE WHEN saved = 1 AND saved_at IS NULL THEN updated_at ELSE saved_at END,
                dismissed_match_version = CASE
                    WHEN dismissed = 1 AND dismissed_match_version IS NULL
                    THEN (SELECT match_version FROM jobs WHERE jobs.id = job_user_states.job_id)
                    ELSE dismissed_match_version END,
                dismissed_at = CASE WHEN dismissed = 1 AND dismissed_at IS NULL THEN updated_at ELSE dismissed_at END;

            CREATE INDEX IF NOT EXISTS idx_job_user_states_saved
                ON job_user_states(user_id, saved, saved_at);
            CREATE INDEX IF NOT EXISTS idx_job_user_states_dismissed_version
                ON job_user_states(user_id, dismissed, dismissed_match_version);
        `);
    },
    verify(db) {
        const columns = new Set(db.prepare("PRAGMA table_info(job_user_states)").all().map((column) => column.name));
        return ["seen", "seen_match_version", "seen_at", "saved_match_version", "saved_at",
            "dismissed_match_version", "dismissed_at"].every((column) => columns.has(column));
    }
});
