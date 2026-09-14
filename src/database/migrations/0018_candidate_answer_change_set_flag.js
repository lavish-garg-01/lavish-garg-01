import { defineMigration } from "../migrationRunner.js";

export const candidateAnswerChangeSetFlagMigration = defineMigration({
    id: "0018_candidate_answer_change_set_flag",
    description: "Seed the shadow-only automatic candidate-answer change-set feature flag",
    up(db) {
        db.exec(`
            INSERT OR IGNORE INTO feature_flags
                (key, enabled, scope, payload_json, updated_at)
            VALUES (
                'candidate-answer-intelligence.change-sets', 0, 'global',
                '{"mode":"SHADOW","reasonCodes":["AUTOMATIC_CHECKPOINT_COMMIT_DISABLED_BY_DEFAULT"]}',
                CURRENT_TIMESTAMP
            );
        `);
    },
    verify(db) {
        const row = db.prepare(`SELECT enabled, scope, payload_json
            FROM feature_flags WHERE key = 'candidate-answer-intelligence.change-sets'`).get();
        return row?.enabled === 0
            && row?.scope === "global"
            && JSON.parse(row?.payload_json || "{}").mode === "SHADOW";
    }
});
