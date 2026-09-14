function freezeContract(value) {
    for (const child of Object.values(value)) {
        if (child && typeof child === "object") freezeContract(child);
    }
    return Object.freeze(value);
}

/**
 * Adapter-neutral minimum schema used by the Connected Jobs repositories.
 * A future Postgres/Supabase adapter must expose this same shape.
 */
export const CONNECTED_JOBS_REPOSITORY_CONTRACT_V1 = freezeContract({
    version: 1,
    tables: {
        companies: {
            primaryKey: ["id"],
            columns: ["id", "name", "domain", "ats_type"]
        },
        jobs: {
            primaryKey: ["id"],
            columns: [
                "id", "company_id", "title", "location", "description", "url", "canonical_url",
                "source", "posted_at", "career_family", "career_track", "content_fingerprint",
                "first_seen_at", "last_seen_at", "last_changed_at", "status", "created_at"
            ]
        },
        candidate_profiles: {
            primaryKey: ["user_id"],
            columns: [
                "user_id", "target_roles", "career_profiles", "preferred_locations",
                "preferred_work_modes", "minimum_salary", "total_experience_years", "skills"
            ]
        },
        job_user_states: {
            primaryKey: ["user_id", "job_id"],
            columns: ["user_id", "job_id", "saved", "dismissed", "created_at", "updated_at"]
        },
        applications: {
            primaryKey: ["id"],
            columns: ["id", "user_id", "job_id", "status", "match_score", "created_at", "updated_at"]
        },
        ingestion_runs: {
            primaryKey: ["id"],
            columns: ["id", "fetched_count", "eligible_count", "inserted_count", "started_at", "completed_at"]
        },
        ingestion_source_runs: {
            primaryKey: ["id"],
            columns: ["id", "run_id", "source", "fetched_count", "inserted_count", "failed", "created_at"]
        }
    }
});

export const CONNECTED_JOBS_REPOSITORY_CONTRACT_V2 = freezeContract({
    version: 2,
    tables: {
        ...CONNECTED_JOBS_REPOSITORY_CONTRACT_V1.tables,
        jobs: {
            primaryKey: ["id"],
            columns: [
                ...CONNECTED_JOBS_REPOSITORY_CONTRACT_V1.tables.jobs.columns,
                "lifecycle_status", "lifecycle_reason", "lifecycle_confidence", "explicit_deadline",
                "last_verified_at", "next_check_at", "closed_at", "closure_evidence_source",
                "employment_type", "seniority_level", "country_code", "remote_scope",
                "sponsorship_policy", "relocation_policy", "travel_requirement", "bond_policy",
                "primary_stack", "required_skills_json", "secondary_skills_json", "match_fingerprint",
                "match_version", "posting_series_key", "normalizer_version"
            ]
        },
        job_raw_snapshots: {
            primaryKey: ["id"],
            columns: ["id", "job_id", "source", "source_url", "raw_text", "payload_json", "content_hash", "parser_version", "fetched_at"]
        },
        job_lifecycle_events: {
            primaryKey: ["id"],
            columns: ["id", "job_id", "from_status", "to_status", "reason", "evidence_source", "evidence_json", "created_at"]
        },
        job_verification_requests: {
            primaryKey: ["id"],
            columns: ["id", "job_id", "status", "reason", "claimed_by_user_id", "claim_expires_at", "result", "created_at", "updated_at", "resolved_at"]
        },
        job_availability_reports: {
            primaryKey: ["id"],
            columns: ["id", "job_id", "request_id", "user_id", "result", "evidence_source", "evidence_code", "confidence", "evidence_json", "created_at"]
        }
    }
});

export const CONNECTED_JOBS_REPOSITORY_CONTRACT_V3 = freezeContract({
    version: 3,
    tables: {
        ...CONNECTED_JOBS_REPOSITORY_CONTRACT_V2.tables,
        candidate_profiles: {
            primaryKey: ["user_id"],
            columns: [...CONNECTED_JOBS_REPOSITORY_CONTRACT_V2.tables.candidate_profiles.columns, "current_title"]
        },
        candidate_search_profiles: {
            primaryKey: ["user_id"],
            columns: [
                "user_id", "schema_version", "profile_version", "target_roles_json", "career_families_json",
                "primary_core_stacks_json", "acceptable_core_stacks_json", "adjacent_career_tracks_json",
                "desired_seniority_levels_json", "preferred_skills_json", "excluded_skills_json",
                "preferred_locations_json", "preferred_work_modes_json", "employment_types_json",
                "minimum_salary_lpa", "compensation_constraint_mode", "location_constraint_mode",
                "work_mode_constraint_mode", "employment_type_constraint_mode", "experience_tolerance_json",
                "excluded_companies_json", "deal_breakers_json", "country_code", "work_authorization",
                "sponsorship_need", "relocation_preference", "match_signature", "created_at", "updated_at"
            ]
        },
        candidate_search_profile_events: {
            primaryKey: ["id"],
            columns: ["id", "user_id", "from_version", "to_version", "changed_fields_json", "source", "created_at"]
        }
    }
});

export const CONNECTED_JOBS_REPOSITORY_CONTRACT_V4 = freezeContract({
    version: 4,
    tables: {
        ...CONNECTED_JOBS_REPOSITORY_CONTRACT_V3.tables,
        candidate_job_feed_builds: {
            primaryKey: ["id"],
            columns: [
                "id", "user_id", "status", "profile_version", "candidate_evidence_signature",
                "algorithm_version", "job_registry_signature", "source_job_count", "eligible_count",
                "feed_count", "duration_ms", "started_at", "completed_at", "error_message"
            ]
        },
        candidate_job_feed: {
            primaryKey: ["generation_id", "job_id"],
            columns: [
                "generation_id", "user_id", "job_id", "rank", "match_score", "confidence",
                "eligibility", "profile_version", "job_match_version", "algorithm_version",
                "decision_json", "computed_at"
            ]
        },
        candidate_job_feed_state: {
            primaryKey: ["user_id"],
            columns: [
                "user_id", "active_generation_id", "profile_version", "candidate_evidence_signature",
                "algorithm_version", "job_registry_signature", "built_at", "updated_at"
            ]
        }
    }
});

export const CONNECTED_JOBS_REPOSITORY_CONTRACT = freezeContract({
    version: 5,
    tables: {
        ...CONNECTED_JOBS_REPOSITORY_CONTRACT_V4.tables,
        job_user_states: {
            primaryKey: ["user_id", "job_id"],
            columns: [
                ...CONNECTED_JOBS_REPOSITORY_CONTRACT_V4.tables.job_user_states.columns,
                "seen", "seen_match_version", "seen_at", "saved_match_version", "saved_at",
                "dismissed_match_version", "dismissed_at"
            ]
        }
    }
});

export function sqliteRepositoryShape(db) {
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const tables = {};
    for (const { name } of tableRows) {
        const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all();
        tables[name] = {
            columns: columns.map((column) => column.name),
            primaryKey: columns.filter((column) => column.pk > 0)
                .sort((left, right) => left.pk - right.pk)
                .map((column) => column.name)
        };
    }
    return { tables };
}

export function assertRepositoryContract(shape, contract = CONNECTED_JOBS_REPOSITORY_CONTRACT) {
    const issues = [];
    for (const [tableName, expected] of Object.entries(contract.tables)) {
        const actual = shape.tables?.[tableName];
        if (!actual) {
            issues.push(`missing table ${tableName}`);
            continue;
        }
        const columns = new Set(actual.columns || []);
        for (const column of expected.columns) {
            if (!columns.has(column)) issues.push(`missing column ${tableName}.${column}`);
        }
        if (JSON.stringify(actual.primaryKey || []) !== JSON.stringify(expected.primaryKey)) {
            issues.push(`primary key mismatch for ${tableName}: expected ${expected.primaryKey.join(", ")}`);
        }
    }
    if (issues.length) {
        throw new Error(`Connected Jobs repository contract v${contract.version} failed: ${issues.join("; ")}`);
    }
    return true;
}

export function assertSqliteRepositoryContract(db, contract = CONNECTED_JOBS_REPOSITORY_CONTRACT) {
    return assertRepositoryContract(sqliteRepositoryShape(db), contract);
}
