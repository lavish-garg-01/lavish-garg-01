import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { env } from "../config/environment.js";
import { DATABASE_MIGRATIONS } from "./migrations/index.js";
import { defineMigration, runMigrations } from "./migrationRunner.js";
import { assertSqliteRepositoryContract, CONNECTED_JOBS_REPOSITORY_CONTRACT_V1 } from "./repositoryContract.js";

let dbInstance = null;

export function getDb() {
    if (dbInstance) {
        return dbInstance;
    }

    fs.mkdirSync(env.paths.output, { recursive: true });
    fs.mkdirSync(pathDirname(env.paths.db), { recursive: true });

    dbInstance = new Database(env.paths.db);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");

    const schema = fs.readFileSync(env.paths.schema, "utf8");
    const baseline = defineMigration({
        id: "0000_legacy_baseline",
        description: "Freeze the pre-versioned schema and compatibility migrations",
        checksumSource: [schema, migrate.toString(), seedDefaultMappingPacks.toString()].join("\n"),
        up(db) {
            db.exec(schema);
            migrate(db);
        },
        verify(db) {
            return assertSqliteRepositoryContract(db, CONNECTED_JOBS_REPOSITORY_CONTRACT_V1);
        }
    });
    runMigrations(dbInstance, {
        migrations: [baseline, ...DATABASE_MIGRATIONS],
        databasePath: env.paths.db,
        backupDirectory: path.join(pathDirname(env.paths.db), "backups")
    });
    assertSqliteRepositoryContract(dbInstance);

    return dbInstance;
}

function pathDirname(filePath) {
    const parts = filePath.split(/[/\\]/);
    parts.pop();
    return parts.join("/") || ".";
}

function migrate(db) {
    const agentQuestionSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_questions'").get()?.sql || "";
    if (/UNIQUE\s*\(\s*agent_session_id\s*,\s*field_id\s*\)/i.test(agentQuestionSql)) {
        db.exec(`
            ALTER TABLE agent_questions RENAME TO agent_questions_legacy;
            CREATE TABLE agent_questions (
                id TEXT PRIMARY KEY,
                agent_session_id TEXT NOT NULL,
                field_id TEXT NOT NULL,
                question_type TEXT NOT NULL,
                prompt TEXT NOT NULL,
                suggested_semantic_key TEXT,
                answer_scope TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                answered_at DATETIME,
                FOREIGN KEY(agent_session_id) REFERENCES agent_sessions(id)
            );
            INSERT INTO agent_questions SELECT * FROM agent_questions_legacy;
            DROP TABLE agent_questions_legacy;
            CREATE INDEX IF NOT EXISTS idx_agent_questions_session ON agent_questions(agent_session_id, status);
        `);
    }
    const companyColumns = db.prepare("PRAGMA table_info(companies)").all().map((col) => col.name);
    const addCompany = (name, ddl) => {
        if (!companyColumns.includes(name)) db.exec(`ALTER TABLE companies ADD COLUMN ${ddl}`);
    };
    addCompany("overall_score", "overall_score REAL");
    addCompany("score_source", "score_source TEXT");
    addCompany("score_updated_at", "score_updated_at DATETIME");

    const columns = db.prepare("PRAGMA table_info(jobs)").all().map((col) => col.name);
    const addJob = (name, ddl) => {
        if (!columns.includes(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${ddl}`);
    };

    addJob("cover_letter", "cover_letter TEXT");
    addJob("canonical_url", "canonical_url TEXT");
    addJob("resume_modifications", "resume_modifications TEXT");
    addJob("notice_period_required", "notice_period_required TEXT");
    addJob("notice_period_days", "notice_period_days INTEGER");
    addJob("posted_at", "posted_at DATETIME");
    addJob("pre_score", "pre_score INTEGER DEFAULT -1");
    addJob("career_family", "career_family TEXT");
    addJob("career_track", "career_track TEXT");
    addJob("scoring_method", "scoring_method TEXT");
    addJob("scoring_confidence", "scoring_confidence REAL");
    addJob("matching_breakdown_json", "matching_breakdown_json TEXT");
    addJob("yoe_min", "yoe_min INTEGER");
    addJob("ctc_min_lpa", "ctc_min_lpa REAL");
    addJob("ctc_max_lpa", "ctc_max_lpa REAL");
    addJob("work_mode", "work_mode TEXT");
    addJob("has_esops", "has_esops INTEGER DEFAULT 0");
    addJob("has_bond", "has_bond INTEGER DEFAULT 0");
    addJob("location_label", "location_label TEXT");
    addJob("applied_at", "applied_at DATETIME");
    addJob("follow_up_due", "follow_up_due DATETIME");
    addJob("referral_name", "referral_name TEXT");
    addJob("generated_resume_path", "generated_resume_path TEXT");
    addJob("resume_template", "resume_template TEXT");
    addJob("resume_variant_id", "resume_variant_id TEXT");
    addJob("archived_from_status", "archived_from_status TEXT");
    addJob("archived_at", "archived_at DATETIME");

    // NEW COLUMNS FOR DEDUPLICATION AND FRESHNESS
    addJob("first_seen_at", "first_seen_at DATETIME");
    addJob("last_seen_at", "last_seen_at DATETIME");
    addJob("last_changed_at", "last_changed_at DATETIME");
    addJob("last_scraped_at", "last_scraped_at DATETIME");
    addJob("content_fingerprint", "content_fingerprint TEXT");
    addJob("discovery_count", "discovery_count INTEGER NOT NULL DEFAULT 1");
    addJob("posting_velocity_score", "posting_velocity_score INTEGER");
    addJob("duplicate_of_job_id", "duplicate_of_job_id TEXT");
    addJob("dedup_hash", "dedup_hash TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_canonical_url ON jobs(canonical_url)");

    db.exec(`
        CREATE TABLE IF NOT EXISTS resume_variants (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            category_key TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            modifications_json TEXT NOT NULL DEFAULT '{}',
            source_job_id TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            use_count INTEGER NOT NULL DEFAULT 0,
            last_used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, category_key)
        );
        CREATE INDEX IF NOT EXISTS idx_resume_variants_user_active ON resume_variants(user_id, active, last_used_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_dedup_hash ON jobs(dedup_hash);
        CREATE INDEX IF NOT EXISTS idx_companies_overall_score ON companies(overall_score);
    `);

    // NEW TABLE FOR APPLICATION MEMORY (VECTOR STORE)
    db.exec(`
        CREATE TABLE IF NOT EXISTS form_answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_text TEXT NOT NULL,
            question_embedding TEXT,
            answer TEXT NOT NULL,
            source_job_id TEXT,
            semantic_key TEXT,
            field_type TEXT,
            answer_scope TEXT,
            is_sensitive INTEGER NOT NULL DEFAULT 0,
            used_count INTEGER DEFAULT 1,
            last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    const memoryColumns = db.prepare("PRAGMA table_info(form_answers)").all().map((col) => col.name);
    const addMemory = (name, ddl) => {
        if (!memoryColumns.includes(name)) db.exec(`ALTER TABLE form_answers ADD COLUMN ${ddl}`);
    };
    addMemory("semantic_key", "semantic_key TEXT");
    addMemory("field_type", "field_type TEXT");
    addMemory("answer_scope", "answer_scope TEXT");
    addMemory("is_sensitive", "is_sensitive INTEGER NOT NULL DEFAULT 0");
    db.exec("DELETE FROM form_answers WHERE id NOT IN (SELECT MAX(id) FROM form_answers GROUP BY question_text, answer, COALESCE(semantic_key, ''))");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_form_answers_dedupe ON form_answers(question_text, answer, COALESCE(semantic_key, ''))");

    const outreachColumns = db.prepare("PRAGMA table_info(outreach)").all().map((col) => col.name);
    if (!outreachColumns.includes("linkedin_url")) {
        db.exec("ALTER TABLE outreach ADD COLUMN linkedin_url TEXT");
    }

    const answerColumns = db.prepare("PRAGMA table_info(candidate_answers)").all().map((col) => col.name);
    if (!answerColumns.includes("evidence")) db.exec("ALTER TABLE candidate_answers ADD COLUMN evidence TEXT");

    const questionColumns = db.prepare("PRAGMA table_info(application_questions)").all().map((col) => col.name);
    const addQuestion = (name, ddl) => {
        if (!questionColumns.includes(name)) db.exec(`ALTER TABLE application_questions ADD COLUMN ${ddl}`);
    };
    addQuestion("confidence", "confidence REAL");
    addQuestion("source", "source TEXT");
    addQuestion("evidence", "evidence TEXT");
    addQuestion("invalidated_reason", "invalidated_reason TEXT");
    addQuestion("invalidated_at", "invalidated_at DATETIME");

    const profileColumns = db.prepare("PRAGMA table_info(candidate_profiles)").all().map((col) => col.name);
    const addProfile = (name, ddl) => {
        if (!profileColumns.includes(name)) db.exec(`ALTER TABLE candidate_profiles ADD COLUMN ${ddl}`);
    };
    addProfile("preferred_first_name", "preferred_first_name TEXT");
    addProfile("preferred_last_name", "preferred_last_name TEXT");
    addProfile("legal_first_name", "legal_first_name TEXT");
    addProfile("legal_middle_name", "legal_middle_name TEXT");
    addProfile("legal_last_name", "legal_last_name TEXT");
    addProfile("country", "country TEXT");
    addProfile("ai_processing_consent", "ai_processing_consent INTEGER DEFAULT 0");
    addProfile("ai_processing_consented_at", "ai_processing_consented_at DATETIME");
    addProfile("reusable_answer_consent", "reusable_answer_consent INTEGER DEFAULT 0");
    addProfile("reusable_answer_consented_at", "reusable_answer_consented_at DATETIME");
    addProfile("postal_code", "postal_code TEXT");
    addProfile("address_line1", "address_line1 TEXT");
    addProfile("address_line2", "address_line2 TEXT");
    addProfile("address_city", "address_city TEXT");
    addProfile("address_state", "address_state TEXT");
    addProfile("linkedin_url", "linkedin_url TEXT");
    addProfile("github_url", "github_url TEXT");
    addProfile("portfolio_url", "portfolio_url TEXT");
    addProfile("current_company", "current_company TEXT");
    addProfile("current_industry", "current_industry TEXT");
    addProfile("preferred_skills", "preferred_skills TEXT DEFAULT '[]'");
    addProfile("excluded_skills", "excluded_skills TEXT DEFAULT '[]'");
    addProfile("career_profiles", "career_profiles TEXT DEFAULT '[\"SOFTWARE_ENGINEERING\"]'");
    addProfile("work_authorization", "work_authorization TEXT");
    addProfile("sponsorship_required", "sponsorship_required TEXT");

    db.exec(`
        CREATE TABLE IF NOT EXISTS ingestion_runs (
            id TEXT PRIMARY KEY, selection_limit INTEGER,
            fetched_count INTEGER NOT NULL DEFAULT 0, eligible_count INTEGER NOT NULL DEFAULT 0,
            inserted_count INTEGER NOT NULL DEFAULT 0, selected_count INTEGER NOT NULL DEFAULT 0,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME
        );
        CREATE TABLE IF NOT EXISTS ingestion_source_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, source TEXT NOT NULL,
            fetched_count INTEGER NOT NULL DEFAULT 0, eligible_count INTEGER NOT NULL DEFAULT 0,
            inserted_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
            selected_count INTEGER NOT NULL DEFAULT 0, matched_count INTEGER NOT NULL DEFAULT 0,
            close_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
            newest_posted_at DATETIME, error_message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(run_id, source), FOREIGN KEY(run_id) REFERENCES ingestion_runs(id)
        );
        CREATE INDEX IF NOT EXISTS idx_ingestion_source_runs_source ON ingestion_source_runs(source, created_at);
        CREATE TABLE IF NOT EXISTS ingestion_source_state (
            source TEXT PRIMARY KEY, newest_posted_at DATETIME, last_selected_at DATETIME,
            total_fetched INTEGER NOT NULL DEFAULT 0, total_inserted INTEGER NOT NULL DEFAULT 0,
            total_selected INTEGER NOT NULL DEFAULT 0, total_matched INTEGER NOT NULL DEFAULT 0,
            total_close INTEGER NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS job_score_events (
            id TEXT PRIMARY KEY, job_id TEXT NOT NULL, source TEXT NOT NULL,
            pre_score INTEGER, final_score INTEGER, confidence REAL,
            scoring_method TEXT NOT NULL, ai_escalated INTEGER NOT NULL DEFAULT 0,
            outcome TEXT, breakdown_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(job_id) REFERENCES jobs(id)
        );
        CREATE INDEX IF NOT EXISTS idx_job_score_events_created ON job_score_events(created_at, scoring_method);
    `);

    const sourceRunColumns = db.prepare("PRAGMA table_info(ingestion_source_runs)").all().map((col) => col.name);
    const addSourceRun = (name, ddl) => {
        if (!sourceRunColumns.includes(name)) db.exec(`ALTER TABLE ingestion_source_runs ADD COLUMN ${ddl}`);
    };
    addSourceRun("quota_count", "quota_count INTEGER NOT NULL DEFAULT 0");
    addSourceRun("allocation_weight", "allocation_weight REAL");
    addSourceRun("quality_score", "quality_score REAL");
    addSourceRun("compatible_posterior", "compatible_posterior REAL");
    addSourceRun("unique_posterior", "unique_posterior REAL");

    const resumeVersionColumns = db.prepare("PRAGMA table_info(resume_versions)").all().map((col) => col.name);
    const addResumeVersion = (name, ddl) => {
        if (!resumeVersionColumns.includes(name)) db.exec(`ALTER TABLE resume_versions ADD COLUMN ${ddl}`);
    };
    addResumeVersion("parsed_profile_json", "parsed_profile_json TEXT");
    addResumeVersion("parser_version", "parser_version TEXT");
    addResumeVersion("parse_confidence", "parse_confidence REAL");
    addResumeVersion("candidate_confirmed", "candidate_confirmed INTEGER NOT NULL DEFAULT 0");

    const applicationColumns = db.prepare("PRAGMA table_info(applications)").all().map((col) => col.name);
    if (!applicationColumns.includes("reusable_answer_decision")) {
        db.exec("ALTER TABLE applications ADD COLUMN reusable_answer_decision TEXT NOT NULL DEFAULT 'PENDING'");
    }

    const eventColumns = db.prepare("PRAGMA table_info(application_events)").all().map((col) => col.name);
    if (!eventColumns.includes("attempt_id")) db.exec("ALTER TABLE application_events ADD COLUMN attempt_id TEXT");

    db.exec(`
        CREATE TABLE IF NOT EXISTS application_attempts (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            started_url TEXT,
            current_url TEXT,
            confirmation_source TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS application_field_evidence (
            id TEXT PRIMARY KEY,
            attempt_id TEXT NOT NULL,
            application_id TEXT NOT NULL,
            page_url TEXT NOT NULL DEFAULT '',
            site_host TEXT NOT NULL DEFAULT 'unknown-site',
            field_id TEXT NOT NULL,
            field_signature TEXT NOT NULL,
            field_label TEXT NOT NULL,
            semantic_key TEXT,
            field_type TEXT NOT NULL DEFAULT 'text',
            options_json TEXT NOT NULL DEFAULT '[]',
            required INTEGER NOT NULL DEFAULT 0,
            is_legal INTEGER NOT NULL DEFAULT 0,
            is_sensitive INTEGER NOT NULL DEFAULT 0,
            final_state TEXT NOT NULL DEFAULT 'DETECTED',
            answer_source TEXT,
            application_value TEXT,
            validation_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(attempt_id, page_url, field_id),
            FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS application_operation_events (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            attempt_id TEXT NOT NULL,
            operation_id TEXT NOT NULL,
            operation_key TEXT NOT NULL,
            page_url TEXT NOT NULL DEFAULT '',
            phase TEXT NOT NULL,
            semantic_key TEXT,
            target_signature TEXT,
            status TEXT NOT NULL,
            attempt_number INTEGER NOT NULL DEFAULT 1,
            trigger_events_json TEXT NOT NULL DEFAULT '[]',
            file_hash TEXT,
            duration_ms INTEGER,
            error_code TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            client_time_ms INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id),
            FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_application_operation_events_attempt
            ON application_operation_events(attempt_id, operation_key, created_at);
        CREATE INDEX IF NOT EXISTS idx_application_attempts_application ON application_attempts(application_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_application_field_evidence_attempt ON application_field_evidence(attempt_id, page_url);
        CREATE TABLE IF NOT EXISTS portal_field_patterns (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            site_host TEXT NOT NULL,
            portal_field_key TEXT NOT NULL,
            field_label TEXT NOT NULL,
            control_kind TEXT NOT NULL DEFAULT 'text',
            selector_candidates_json TEXT NOT NULL DEFAULT '[]',
            container_signature TEXT,
            semantic_key TEXT,
            observed_count INTEGER NOT NULL DEFAULT 1,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_observed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, site_host, portal_field_key)
        );
        CREATE INDEX IF NOT EXISTS idx_portal_field_patterns_site ON portal_field_patterns(user_id, site_host);
        CREATE TABLE IF NOT EXISTS application_plans (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            page_url TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'PLAN_READY',
            summary_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(application_id, page_url),
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS attention_items (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            field_id TEXT NOT NULL,
            attention_type TEXT NOT NULL,
            title TEXT NOT NULL,
            reason TEXT NOT NULL,
            semantic_key TEXT,
            answer_scope TEXT,
            options_json TEXT NOT NULL DEFAULT '[]',
            priority INTEGER NOT NULL DEFAULT 50,
            blocking INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'OPEN',
            page_url TEXT NOT NULL DEFAULT '',
            resolved_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(application_id, field_id),
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS learning_events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            event_type TEXT NOT NULL,
            application_id TEXT,
            field_id TEXT,
            memory_key TEXT,
            memory_scope TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS candidate_fact_memory (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            semantic_key TEXT NOT NULL,
            category TEXT NOT NULL,
            value_text TEXT NOT NULL,
            value_type TEXT NOT NULL,
            fact_scope TEXT NOT NULL DEFAULT 'CANDIDATE_PROFILE',
            source TEXT NOT NULL,
            candidate_approved INTEGER NOT NULL DEFAULT 0,
            verified_at DATETIME NOT NULL,
            valid_until DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, semantic_key, fact_scope)
        );
        CREATE TABLE IF NOT EXISTS writing_style_profiles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            role_cluster TEXT NOT NULL DEFAULT 'default',
            tone TEXT NOT NULL DEFAULT 'professional',
            max_words INTEGER NOT NULL DEFAULT 150,
            traits_json TEXT NOT NULL DEFAULT '[]',
            candidate_approved INTEGER NOT NULL DEFAULT 0,
            approved_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, role_cluster)
        );
        CREATE TABLE IF NOT EXISTS autofill_category_policies (
            user_id TEXT NOT NULL DEFAULT 'local-user',
            category TEXT NOT NULL,
            mode TEXT NOT NULL,
            candidate_approved INTEGER NOT NULL DEFAULT 0,
            approved_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(user_id, category)
        );
        CREATE INDEX IF NOT EXISTS idx_application_plans_application ON application_plans(application_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_attention_items_open ON attention_items(status, blocking, created_at);
        CREATE INDEX IF NOT EXISTS idx_learning_events_application ON learning_events(application_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_candidate_fact_memory_key ON candidate_fact_memory(user_id, semantic_key, fact_scope);
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS application_page_snapshots (
            id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, application_id TEXT NOT NULL,
            page_url TEXT NOT NULL DEFAULT '', site_host TEXT NOT NULL DEFAULT 'unknown-site',
            portal_kind TEXT NOT NULL DEFAULT 'generic', page_fingerprint TEXT NOT NULL,
            field_count INTEGER NOT NULL DEFAULT 0, required_count INTEGER NOT NULL DEFAULT 0,
            snapshot_reason TEXT NOT NULL DEFAULT 'OBSERVED', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(attempt_id, page_fingerprint), FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS application_field_snapshots (
            id TEXT PRIMARY KEY, page_snapshot_id TEXT NOT NULL, field_id TEXT NOT NULL,
            field_signature TEXT NOT NULL, field_label TEXT NOT NULL, semantic_key TEXT,
            field_type TEXT NOT NULL DEFAULT 'text', options_hash TEXT, required INTEGER NOT NULL DEFAULT 0,
            visible INTEGER NOT NULL DEFAULT 1, value_state TEXT NOT NULL DEFAULT 'EMPTY',
            is_legal INTEGER NOT NULL DEFAULT 0, is_sensitive INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(page_snapshot_id, field_id),
            FOREIGN KEY(page_snapshot_id) REFERENCES application_page_snapshots(id)
        );
        CREATE TABLE IF NOT EXISTS adapter_runs (
            id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, application_id TEXT NOT NULL, page_snapshot_id TEXT,
            adapter_kind TEXT NOT NULL, adapter_version TEXT NOT NULL DEFAULT '1', status TEXT NOT NULL DEFAULT 'STARTED',
            failure_code TEXT, field_count INTEGER NOT NULL DEFAULT 0, filled_count INTEGER NOT NULL DEFAULT 0,
            review_count INTEGER NOT NULL DEFAULT 0, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME,
            FOREIGN KEY(attempt_id) REFERENCES application_attempts(id), FOREIGN KEY(application_id) REFERENCES applications(id),
            FOREIGN KEY(page_snapshot_id) REFERENCES application_page_snapshots(id)
        );
        CREATE TABLE IF NOT EXISTS field_resolutions (
            id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, application_id TEXT NOT NULL, page_url TEXT NOT NULL DEFAULT '',
            field_id TEXT NOT NULL, semantic_key TEXT, source_type TEXT NOT NULL, source_version TEXT,
            confidence REAL NOT NULL DEFAULT 0, policy_decision TEXT NOT NULL DEFAULT 'REVIEW', value_hash TEXT,
            evidence_summary TEXT, model_version TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(attempt_id) REFERENCES application_attempts(id), FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS candidate_fact_correction_proposals (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local-user', semantic_key TEXT NOT NULL,
            fact_scope TEXT NOT NULL, value_type TEXT NOT NULL, previous_value_hash TEXT, proposed_value_hash TEXT NOT NULL,
            observation_count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'PROPOSED', reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, semantic_key, fact_scope, proposed_value_hash)
        );
        CREATE TABLE IF NOT EXISTS application_outcome_events (
            id TEXT PRIMARY KEY, application_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at DATETIME NOT NULL,
            evidence_source TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
            confirmation_status TEXT NOT NULL DEFAULT 'PROPOSED', candidate_confirmed_at DATETIME,
            source_reference TEXT, note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE INDEX IF NOT EXISTS idx_page_snapshots_attempt ON application_page_snapshots(attempt_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_adapter_runs_application ON adapter_runs(application_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_field_resolutions_application ON field_resolutions(application_id, field_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_outcomes_application ON application_outcome_events(application_id, occurred_at);
    `);

    // CAPTCHA challenges are ephemeral anti-bot credentials. Older extension
    // builds could mislabel Keka CAPTCHA controls and retain the typed value.
    // Scrub any legacy copies whenever the local database opens.
    db.exec(`
        UPDATE application_field_evidence
        SET application_value = NULL, answer_source = NULL, is_sensitive = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE lower(field_label || ' ' || field_id || ' ' || field_signature) LIKE '%captcha%';
        UPDATE application_questions
        SET answer = NULL, status = 'PENDING', source = 'MANUAL_ACTION',
            evidence = 'Protected CAPTCHA values are never retained.', updated_at = CURRENT_TIMESTAMP
        WHERE lower(question || ' ' || question_key || ' ' || field_id) LIKE '%captcha%';
        DELETE FROM candidate_answers
        WHERE lower(original_question || ' ' || question_key) LIKE '%captcha%';
        DELETE FROM form_answers
        WHERE lower(question_text || ' ' || COALESCE(semantic_key, '')) LIKE '%captcha%';
    `);

    const agentQuestionColumns = db.prepare("PRAGMA table_info(agent_questions)").all().map((col) => col.name);
    if (!agentQuestionColumns.includes("options_json")) db.exec("ALTER TABLE agent_questions ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]'");

    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        ;
        CREATE TABLE IF NOT EXISTS ai_call_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd REAL,
            succeeded INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_ai_call_metrics_created ON ai_call_metrics(created_at);
    `);

    const addColumns = (table, columns) => {
        const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);
        for (const [name, ddl] of Object.entries(columns)) {
            if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        }
    };
    addColumns("application_field_evidence", {
        portal_kind: "portal_kind TEXT NOT NULL DEFAULT 'generic'",
        control_kind: "control_kind TEXT",
        fill_outcome: "fill_outcome TEXT",
        intended_action: "intended_action TEXT",
        extension_version: "extension_version TEXT",
        adapter_kind: "adapter_kind TEXT",
        adapter_version: "adapter_version TEXT",
        mapping_pack_id: "mapping_pack_id TEXT",
        mapping_pack_version: "mapping_pack_version INTEGER",
        mapping_stage: "mapping_stage TEXT",
        page_fingerprint: "page_fingerprint TEXT"
    });
    addColumns("application_events", {
        extension_version: "extension_version TEXT",
        portal_kind: "portal_kind TEXT"
    });
    addColumns("application_operation_events", {
        client_time_ms: "client_time_ms INTEGER NOT NULL DEFAULT 0",
        extension_version: "extension_version TEXT",
        portal_kind: "portal_kind TEXT",
        adapter_version: "adapter_version TEXT"
    });
    addColumns("adapter_runs", {
        portal_kind: "portal_kind TEXT",
        extension_version: "extension_version TEXT",
        mapping_pack_version: "mapping_pack_version INTEGER",
        mapping_stage: "mapping_stage TEXT"
    });
    addColumns("portal_field_patterns", {
        portal_kind: "portal_kind TEXT",
        mapping_stage: "mapping_stage TEXT",
        last_success_at: "last_success_at DATETIME",
        last_failure_at: "last_failure_at DATETIME"
    });

    db.exec(`
        CREATE TABLE IF NOT EXISTS application_field_timeline (
            id TEXT PRIMARY KEY,
            attempt_id TEXT NOT NULL,
            application_id TEXT NOT NULL,
            page_url TEXT NOT NULL DEFAULT '',
            site_host TEXT NOT NULL DEFAULT 'unknown-site',
            portal_kind TEXT NOT NULL DEFAULT 'generic',
            field_id TEXT NOT NULL,
            field_label TEXT NOT NULL DEFAULT '',
            field_signature TEXT,
            control_kind TEXT NOT NULL DEFAULT 'text',
            semantic_key TEXT,
            observed_state TEXT NOT NULL,
            intended_action TEXT,
            intended_value_hash TEXT,
            observed_value_hash TEXT,
            answer_source TEXT,
            extension_version TEXT,
            adapter_kind TEXT,
            adapter_version TEXT,
            mapping_pack_id TEXT,
            mapping_pack_version INTEGER,
            mapping_stage TEXT,
            page_fingerprint TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
            FOREIGN KEY(application_id) REFERENCES applications(id)
        );
        CREATE TABLE IF NOT EXISTS mapping_packs (
            id TEXT PRIMARY KEY,
            portal_kind TEXT NOT NULL,
            site_host TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            stage TEXT NOT NULL DEFAULT 'DEFAULT',
            pack_json TEXT NOT NULL DEFAULT '{}',
            parent_version INTEGER,
            promoted_at DATETIME,
            killed_at DATETIME,
            kill_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(portal_kind, site_host, version, stage)
        );
        CREATE TABLE IF NOT EXISTS mapping_promotions (
            id TEXT PRIMARY KEY,
            mapping_pack_id TEXT NOT NULL,
            from_stage TEXT NOT NULL,
            to_stage TEXT NOT NULL,
            gate_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(mapping_pack_id) REFERENCES mapping_packs(id)
        );
        CREATE TABLE IF NOT EXISTS mapping_proposals (
            id TEXT PRIMARY KEY,
            portal_kind TEXT NOT NULL,
            site_host TEXT NOT NULL,
            control_kind TEXT NOT NULL DEFAULT 'text',
            field_fingerprint TEXT NOT NULL,
            cluster_key TEXT NOT NULL,
            proposed_patch_json TEXT NOT NULL DEFAULT '{}',
            form_a_gate TEXT NOT NULL DEFAULT 'SKIPPED',
            status TEXT NOT NULL DEFAULT 'PROPOSED',
            occurrence_count INTEGER NOT NULL DEFAULT 1,
            shadow_would_fill INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS feature_flags (
            key TEXT PRIMARY KEY,
            enabled INTEGER NOT NULL DEFAULT 0,
            scope TEXT NOT NULL DEFAULT 'global',
            portal_kind TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS usage_events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            meter_key TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 0,
            unit TEXT NOT NULL DEFAULT 'count',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS adapter_incidents (
            id TEXT PRIMARY KEY,
            portal_kind TEXT NOT NULL,
            site_host TEXT NOT NULL DEFAULT 'unknown-site',
            failure_class TEXT NOT NULL,
            control_kind TEXT,
            fingerprint TEXT,
            occurrence_count INTEGER NOT NULL DEFAULT 1,
            redacted_sample_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'OPEN',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_field_timeline_attempt ON application_field_timeline(attempt_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_mapping_packs_portal ON mapping_packs(portal_kind, stage, version);
        CREATE INDEX IF NOT EXISTS idx_mapping_proposals_portal ON mapping_proposals(portal_kind, status);
        CREATE INDEX IF NOT EXISTS idx_usage_events_meter ON usage_events(user_id, meter_key, created_at);
        CREATE INDEX IF NOT EXISTS idx_adapter_incidents_portal ON adapter_incidents(portal_kind, status);
    `);

    seedDefaultMappingPacks(db);
}

function seedDefaultMappingPacks(db) {
    const packDir = path.join(env.rootDir, "src", "adapters", "packs");
    if (!fs.existsSync(packDir)) return;
    const insert = db.prepare(`
        INSERT INTO mapping_packs (id, portal_kind, site_host, version, stage, pack_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET pack_json = excluded.pack_json
    `);
    for (const file of fs.readdirSync(packDir).filter((name) => name.endsWith(".json"))) {
        const pack = JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8"));
        const portalKind = String(pack.portalKind || path.basename(file, ".json")).toLowerCase();
        const version = Number(pack.version) || 1;
        const stage = String(pack.stage || "DEFAULT").toUpperCase();
        const siteHost = portalKind === "generic" ? "*" : portalKind;
        const id = crypto.createHash("sha256").update(`${portalKind}|${siteHost}|${version}|${stage}`).digest("hex").slice(0, 32);
        insert.run(id, portalKind, siteHost, version, stage, JSON.stringify(pack));
    }
}

export function getSetting(key, fallback = "") {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value ?? fallback;
}

export function setSetting(key, value) {
    getDb()
        .prepare(
            `
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `
        )
        .run(key, String(value));
}

export function closeDb() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}
