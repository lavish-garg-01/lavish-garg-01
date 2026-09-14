import { defineMigration } from "../migrationRunner.js";

export const candidateSearchProfileMigration = defineMigration({
    id: "0002_candidate_search_profile",
    description: "Create versioned candidate search profiles and separate current-role evidence from onboarding state",
    up(db) {
        const candidateColumns = new Set(db.prepare("PRAGMA table_info(candidate_profiles)").all().map((column) => column.name));
        if (!candidateColumns.has("current_title")) {
            db.exec("ALTER TABLE candidate_profiles ADD COLUMN current_title TEXT");
        }

        db.exec(`
            CREATE TABLE IF NOT EXISTS candidate_search_profiles (
                user_id TEXT PRIMARY KEY,
                schema_version INTEGER NOT NULL DEFAULT 1,
                profile_version INTEGER NOT NULL DEFAULT 1,
                target_roles_json TEXT NOT NULL DEFAULT '[]',
                career_families_json TEXT NOT NULL DEFAULT '[]',
                primary_core_stacks_json TEXT NOT NULL DEFAULT '[]',
                acceptable_core_stacks_json TEXT NOT NULL DEFAULT '[]',
                adjacent_career_tracks_json TEXT NOT NULL DEFAULT '[]',
                desired_seniority_levels_json TEXT NOT NULL DEFAULT '[]',
                preferred_skills_json TEXT NOT NULL DEFAULT '[]',
                excluded_skills_json TEXT NOT NULL DEFAULT '[]',
                preferred_locations_json TEXT NOT NULL DEFAULT '[]',
                preferred_work_modes_json TEXT NOT NULL DEFAULT '[]',
                employment_types_json TEXT NOT NULL DEFAULT '["FULL_TIME"]',
                minimum_salary_lpa REAL,
                compensation_constraint_mode TEXT NOT NULL DEFAULT 'SOFT',
                location_constraint_mode TEXT NOT NULL DEFAULT 'SOFT',
                work_mode_constraint_mode TEXT NOT NULL DEFAULT 'SOFT',
                employment_type_constraint_mode TEXT NOT NULL DEFAULT 'SOFT',
                experience_tolerance_json TEXT NOT NULL DEFAULT '{"smallGapYears":1,"maxPlausibleGapYears":3,"allowNearbySeniority":true}',
                excluded_companies_json TEXT NOT NULL DEFAULT '[]',
                deal_breakers_json TEXT NOT NULL DEFAULT '[]',
                country_code TEXT NOT NULL DEFAULT 'IN',
                work_authorization TEXT NOT NULL DEFAULT 'UNKNOWN',
                sponsorship_need TEXT NOT NULL DEFAULT 'UNKNOWN',
                relocation_preference TEXT NOT NULL DEFAULT 'UNKNOWN',
                match_signature TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES candidate_profiles(user_id)
            );

            CREATE TABLE IF NOT EXISTS candidate_search_profile_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                from_version INTEGER NOT NULL,
                to_version INTEGER NOT NULL,
                changed_fields_json TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'PROFILE',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES candidate_search_profiles(user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_candidate_search_profile_events_user
                ON candidate_search_profile_events(user_id, created_at);

            UPDATE candidate_profiles
            SET current_title = COALESCE(NULLIF(current_title, ''), (
                SELECT json_extract(onboarding_states.state_json, '$.currentTitle')
                FROM onboarding_states WHERE onboarding_states.user_id = candidate_profiles.user_id
            ));

            INSERT OR IGNORE INTO candidate_search_profiles (
                user_id, target_roles_json, career_families_json,
                preferred_skills_json, excluded_skills_json,
                preferred_locations_json, preferred_work_modes_json, employment_types_json,
                minimum_salary_lpa, excluded_companies_json, deal_breakers_json,
                country_code, work_authorization, sponsorship_need, relocation_preference
            )
            SELECT cp.user_id,
                CASE
                    WHEN json_valid(cp.target_roles) AND json_array_length(cp.target_roles) > 0 THEN cp.target_roles
                    WHEN json_valid(aa.target_roles) THEN aa.target_roles ELSE '[]'
                END,
                CASE
                    WHEN json_valid(cp.target_roles) AND json_array_length(cp.target_roles) > 0
                         AND json_valid(cp.career_profiles) THEN cp.career_profiles
                    ELSE '[]'
                END,
                CASE WHEN json_valid(cp.preferred_skills) THEN cp.preferred_skills ELSE '[]' END,
                CASE WHEN json_valid(cp.excluded_skills) THEN cp.excluded_skills ELSE '[]' END,
                CASE
                    WHEN json_valid(cp.preferred_locations) AND json_array_length(cp.preferred_locations) > 0
                        THEN cp.preferred_locations
                    WHEN json_valid(aa.preferred_locations) THEN aa.preferred_locations ELSE '[]'
                END,
                CASE WHEN json_valid(cp.preferred_work_modes) THEN cp.preferred_work_modes ELSE '[]' END,
                CASE
                    WHEN os.state_json IS NOT NULL
                         AND json_valid(json_extract(os.state_json, '$.employmentTypes'))
                        THEN json_extract(os.state_json, '$.employmentTypes')
                    ELSE '["FULL_TIME"]'
                END,
                COALESCE(cp.minimum_salary, aa.minimum_salary),
                CASE WHEN json_valid(aa.excluded_companies) THEN aa.excluded_companies ELSE '[]' END,
                CASE
                    WHEN os.state_json IS NOT NULL
                         AND json_valid(json_extract(os.state_json, '$.dealBreakers'))
                        THEN json_extract(os.state_json, '$.dealBreakers')
                    ELSE '[]'
                END,
                'IN',
                COALESCE(NULLIF(cp.work_authorization, ''), 'UNKNOWN'),
                CASE
                    WHEN lower(COALESCE(cp.sponsorship_required, '')) IN ('yes', 'true', 'required') THEN 'REQUIRED'
                    WHEN lower(COALESCE(cp.sponsorship_required, '')) IN ('no', 'false', 'not required') THEN 'NOT_REQUIRED'
                    ELSE 'UNKNOWN'
                END,
                CASE WHEN cp.willing_to_relocate = 1 THEN 'WILLING' ELSE 'UNKNOWN' END
            FROM candidate_profiles cp
            LEFT JOIN auto_apply_settings aa ON aa.user_id = cp.user_id
            LEFT JOIN onboarding_states os ON os.user_id = cp.user_id;
        `);
    },
    verify(db) {
        const profileColumns = new Set(db.prepare("PRAGMA table_info(candidate_profiles)").all().map((column) => column.name));
        const searchColumns = new Set(db.prepare("PRAGMA table_info(candidate_search_profiles)").all().map((column) => column.name));
        const events = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='candidate_search_profile_events'").get();
        const missingProfiles = db.prepare(`SELECT COUNT(*) AS count FROM candidate_profiles cp
            LEFT JOIN candidate_search_profiles sp ON sp.user_id = cp.user_id WHERE sp.user_id IS NULL`).get().count;
        return profileColumns.has("current_title")
            && ["profile_version", "target_roles_json", "primary_core_stacks_json", "experience_tolerance_json", "match_signature"]
                .every((column) => searchColumns.has(column))
            && Boolean(events)
            && missingProfiles === 0;
    }
});
