CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    ats_type TEXT,
    ats_slug TEXT,
    overall_score REAL,
    score_source TEXT,
    score_updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    title TEXT NOT NULL,
    location TEXT,
    description TEXT NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    source TEXT NOT NULL,
    match_score INTEGER DEFAULT -1,
    pre_score INTEGER DEFAULT -1,
    career_family TEXT,
    career_track TEXT,
    scoring_method TEXT,
    scoring_confidence REAL,
    matching_breakdown_json TEXT,
    ai_analysis TEXT,
    cover_letter TEXT,
    resume_modifications TEXT,
    notice_period_required TEXT,
    notice_period_days INTEGER,
    yoe_min INTEGER,
    ctc_min_lpa REAL,
    ctc_max_lpa REAL,
    work_mode TEXT,
    has_esops INTEGER DEFAULT 0,
    has_bond INTEGER DEFAULT 0,
    location_label TEXT,
    posted_at DATETIME,
    applied_at DATETIME,
    follow_up_due DATETIME,
    referral_name TEXT,
    generated_resume_path TEXT,
    resume_template TEXT,
    archived_from_status TEXT,
    archived_at DATETIME,
    content_fingerprint TEXT,
    first_seen_at DATETIME,
    last_seen_at DATETIME,
    last_changed_at DATETIME,
    last_scraped_at DATETIME,
    discovery_count INTEGER NOT NULL DEFAULT 1,
    posting_velocity_score INTEGER,
    duplicate_of_job_id TEXT,
    dedup_hash TEXT,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS outreach (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    recruiter_name TEXT,
    recruiter_email TEXT,
    recruiter_title TEXT,
    linkedin_url TEXT,
    generated_email_body TEXT,
    generated_resume_path TEXT,
    status TEXT DEFAULT 'DRAFT',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS local_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS onboarding_states (
    user_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED',
    last_step TEXT NOT NULL DEFAULT 'intent',
    state_json TEXT NOT NULL DEFAULT '{}',
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_user_states (
    user_id TEXT NOT NULL DEFAULT 'local-user',
    job_id TEXT NOT NULL,
    saved INTEGER NOT NULL DEFAULT 0,
    dismissed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, job_id),
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_local_sessions_expiry ON local_sessions(expires_at);

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

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(match_score);
CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs(title);
CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url);
CREATE INDEX IF NOT EXISTS idx_outreach_job ON outreach(job_id);
CREATE INDEX IF NOT EXISTS idx_ai_call_metrics_created ON ai_call_metrics(created_at);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id TEXT PRIMARY KEY,
    selection_limit INTEGER,
    fetched_count INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    selected_count INTEGER NOT NULL DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS ingestion_source_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_count INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    selected_count INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    close_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    newest_posted_at DATETIME,
    error_message TEXT,
    quota_count INTEGER NOT NULL DEFAULT 0,
    allocation_weight REAL,
    quality_score REAL,
    compatible_posterior REAL,
    unique_posterior REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, source),
    FOREIGN KEY(run_id) REFERENCES ingestion_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_ingestion_source_runs_source ON ingestion_source_runs(source, created_at);

CREATE TABLE IF NOT EXISTS ingestion_source_state (
    source TEXT PRIMARY KEY,
    newest_posted_at DATETIME,
    last_selected_at DATETIME,
    total_fetched INTEGER NOT NULL DEFAULT 0,
    total_inserted INTEGER NOT NULL DEFAULT 0,
    total_selected INTEGER NOT NULL DEFAULT 0,
    total_matched INTEGER NOT NULL DEFAULT 0,
    total_close INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_score_events (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    source TEXT NOT NULL,
    pre_score INTEGER,
    final_score INTEGER,
    confidence REAL,
    scoring_method TEXT NOT NULL,
    ai_escalated INTEGER NOT NULL DEFAULT 0,
    outcome TEXT,
    breakdown_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_job_score_events_created ON job_score_events(created_at, scoring_method);

-- Non-candidate test inventory. One row represents a company career surface;
-- repeated jobs on the same engine/DOM fingerprint do not create new code paths.
CREATE TABLE IF NOT EXISTS career_test_targets (
    id TEXT PRIMARY KEY,
    company_name TEXT,
    career_url TEXT NOT NULL,
    site_host TEXT NOT NULL,
    portal_kind TEXT NOT NULL DEFAULT 'generic',
    support_tier TEXT NOT NULL DEFAULT 'GENERIC_FALLBACK',
    page_fingerprint TEXT,
    priority INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'DISCOVERED',
    requires_login INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'OBSERVED_JOB',
    last_scanned_at DATETIME,
    last_verified_at DATETIME,
    last_extension_version TEXT,
    last_adapter_version TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_host, career_url)
);

CREATE TABLE IF NOT EXISTS career_test_runs (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    extension_version TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    page_fingerprint TEXT,
    run_kind TEXT NOT NULL DEFAULT 'FIXTURE',
    status TEXT NOT NULL,
    detected_count INTEGER NOT NULL DEFAULT 0,
    filled_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    failure_classes_json TEXT NOT NULL DEFAULT '[]',
    fixture_path TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY(target_id) REFERENCES career_test_targets(id)
);

CREATE INDEX IF NOT EXISTS idx_career_test_targets_queue
    ON career_test_targets(status, support_tier, priority, updated_at);
CREATE INDEX IF NOT EXISTS idx_career_test_runs_target
    ON career_test_runs(target_id, extension_version, adapter_version, page_fingerprint, status);

CREATE TABLE IF NOT EXISTS candidate_profiles (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    preferred_first_name TEXT,
    preferred_last_name TEXT,
    legal_first_name TEXT,
    legal_middle_name TEXT,
    legal_last_name TEXT,
    country TEXT,
    ai_processing_consent INTEGER DEFAULT 0,
    ai_processing_consented_at DATETIME,
    reusable_answer_consent INTEGER DEFAULT 0,
    reusable_answer_consented_at DATETIME,
    current_location TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    address_city TEXT,
    address_state TEXT,
    postal_code TEXT,
    linkedin_url TEXT,
    github_url TEXT,
    portfolio_url TEXT,
    current_company TEXT,
    current_industry TEXT,
    preferred_locations TEXT DEFAULT '[]',
    current_ctc REAL,
    expected_ctc REAL,
    notice_period_days INTEGER DEFAULT 0,
    last_working_date TEXT,
    total_experience_years REAL,
    skills TEXT DEFAULT '[]',
    preferred_skills TEXT DEFAULT '[]',
    excluded_skills TEXT DEFAULT '[]',
    target_roles TEXT DEFAULT '[]',
    career_profiles TEXT DEFAULT '["SOFTWARE_ENGINEERING"]',
    preferred_work_modes TEXT DEFAULT '[]',
    minimum_salary REAL,
    willing_to_relocate INTEGER DEFAULT 0,
    work_authorization TEXT,
    sponsorship_required TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_answers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    question_key TEXT NOT NULL,
    original_question TEXT NOT NULL,
    answer TEXT NOT NULL,
    confidence REAL DEFAULT 1,
    source TEXT DEFAULT 'USER',
    evidence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, question_key)
);

CREATE TABLE IF NOT EXISTS resume_versions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    job_id TEXT,
    type TEXT NOT NULL,
    file_path TEXT,
    text_content TEXT,
    parsed_profile_json TEXT,
    parser_version TEXT,
    parse_confidence REAL,
    candidate_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

-- Resume variants store only a compact tailoring delta from the master resume.
-- PDFs are materialized on demand and cached on the job that currently uses one.
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

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    job_id TEXT NOT NULL,
    resume_version_id TEXT,
    adapter TEXT NOT NULL DEFAULT 'TEST_FORM',
    mode TEXT NOT NULL DEFAULT 'COPILOT',
    status TEXT NOT NULL DEFAULT 'QUEUED',
    match_score INTEGER,
    started_at DATETIME,
    submitted_at DATETIME,
    failure_reason TEXT,
    reusable_answer_decision TEXT NOT NULL DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, job_id),
    FOREIGN KEY(job_id) REFERENCES jobs(id),
    FOREIGN KEY(resume_version_id) REFERENCES resume_versions(id)
);

CREATE TABLE IF NOT EXISTS application_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT,
    metadata TEXT DEFAULT '{}',
    attempt_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
);

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
    extension_version TEXT,
    portal_kind TEXT,
    adapter_version TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    client_time_ms INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id),
    FOREIGN KEY(attempt_id) REFERENCES application_attempts(id)
);

CREATE TABLE IF NOT EXISTS application_page_snapshots (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    page_url TEXT NOT NULL DEFAULT '',
    site_host TEXT NOT NULL DEFAULT 'unknown-site',
    portal_kind TEXT NOT NULL DEFAULT 'generic',
    page_fingerprint TEXT NOT NULL,
    field_count INTEGER NOT NULL DEFAULT 0,
    required_count INTEGER NOT NULL DEFAULT 0,
    snapshot_reason TEXT NOT NULL DEFAULT 'OBSERVED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(attempt_id, page_fingerprint),
    FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
    FOREIGN KEY(application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS application_field_snapshots (
    id TEXT PRIMARY KEY,
    page_snapshot_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    field_signature TEXT NOT NULL,
    field_label TEXT NOT NULL,
    semantic_key TEXT,
    field_type TEXT NOT NULL DEFAULT 'text',
    options_hash TEXT,
    required INTEGER NOT NULL DEFAULT 0,
    visible INTEGER NOT NULL DEFAULT 1,
    value_state TEXT NOT NULL DEFAULT 'EMPTY',
    is_legal INTEGER NOT NULL DEFAULT 0,
    is_sensitive INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_snapshot_id, field_id),
    FOREIGN KEY(page_snapshot_id) REFERENCES application_page_snapshots(id)
);

CREATE TABLE IF NOT EXISTS adapter_runs (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    page_snapshot_id TEXT,
    adapter_kind TEXT NOT NULL,
    adapter_version TEXT NOT NULL DEFAULT '1',
    status TEXT NOT NULL DEFAULT 'STARTED',
    failure_code TEXT,
    field_count INTEGER NOT NULL DEFAULT 0,
    filled_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
    FOREIGN KEY(application_id) REFERENCES applications(id),
    FOREIGN KEY(page_snapshot_id) REFERENCES application_page_snapshots(id)
);

CREATE TABLE IF NOT EXISTS field_resolutions (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    page_url TEXT NOT NULL DEFAULT '',
    field_id TEXT NOT NULL,
    semantic_key TEXT,
    source_type TEXT NOT NULL,
    source_version TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    policy_decision TEXT NOT NULL DEFAULT 'REVIEW',
    value_hash TEXT,
    evidence_summary TEXT,
    model_version TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
    FOREIGN KEY(application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS application_questions (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    question_key TEXT NOT NULL,
    question TEXT NOT NULL,
    field_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    answer TEXT,
    confidence REAL,
    source TEXT,
    evidence TEXT,
    invalidated_reason TEXT,
    invalidated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(application_id, field_id),
    FOREIGN KEY(application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    priority INTEGER DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS field_mappings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    site_host TEXT NOT NULL,
    field_signature TEXT NOT NULL,
    field_label TEXT NOT NULL,
    semantic_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'LOCAL_DRAFT',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, site_host, field_signature)
);

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

CREATE TABLE IF NOT EXISTS candidate_fact_correction_proposals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    semantic_key TEXT NOT NULL,
    fact_scope TEXT NOT NULL,
    value_type TEXT NOT NULL,
    previous_value_hash TEXT,
    proposed_value_hash TEXT NOT NULL,
    observation_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, semantic_key, fact_scope, proposed_value_hash)
);

CREATE TABLE IF NOT EXISTS application_outcome_events (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at DATETIME NOT NULL,
    evidence_source TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1,
    confirmation_status TEXT NOT NULL DEFAULT 'PROPOSED',
    candidate_confirmed_at DATETIME,
    source_reference TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
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

CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL UNIQUE,
    current_state TEXT NOT NULL DEFAULT 'PAGE_DETECTED',
    current_field_mapping_id TEXT,
    pending_question_json TEXT,
    conversation_history_json TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id),
    FOREIGN KEY(current_field_mapping_id) REFERENCES field_mappings(id)
);

CREATE TABLE IF NOT EXISTS agent_questions (
    id TEXT PRIMARY KEY,
    agent_session_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    question_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    suggested_semantic_key TEXT,
    answer_scope TEXT,
    options_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    answered_at DATETIME,
    FOREIGN KEY(agent_session_id) REFERENCES agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS auto_apply_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 1,
    mode TEXT DEFAULT 'COPILOT',
    minimum_match_score INTEGER DEFAULT 80,
    max_applications_per_day INTEGER DEFAULT 5,
    max_applications_per_week INTEGER DEFAULT 25,
    target_roles TEXT DEFAULT '[]',
    preferred_locations TEXT DEFAULT '[]',
    excluded_companies TEXT DEFAULT '[]',
    minimum_salary REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_job_user_states_user ON job_user_states(user_id, saved, dismissed);
CREATE INDEX IF NOT EXISTS idx_application_events_application ON application_events(application_id);
CREATE INDEX IF NOT EXISTS idx_application_operation_events_attempt ON application_operation_events(attempt_id, operation_key, created_at);
CREATE INDEX IF NOT EXISTS idx_application_attempts_application ON application_attempts(application_id, started_at);
CREATE INDEX IF NOT EXISTS idx_application_field_evidence_attempt ON application_field_evidence(attempt_id, page_url);
CREATE INDEX IF NOT EXISTS idx_application_questions_application ON application_questions(application_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_schedule ON agent_tasks(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_agent_questions_session ON agent_questions(agent_session_id, status);
CREATE INDEX IF NOT EXISTS idx_field_mappings_site ON field_mappings(user_id, site_host);
CREATE INDEX IF NOT EXISTS idx_portal_field_patterns_site ON portal_field_patterns(user_id, site_host);
CREATE INDEX IF NOT EXISTS idx_application_plans_application ON application_plans(application_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_attention_items_open ON attention_items(status, blocking, created_at);
CREATE INDEX IF NOT EXISTS idx_learning_events_application ON learning_events(application_id, created_at);
CREATE INDEX IF NOT EXISTS idx_candidate_fact_memory_key ON candidate_fact_memory(user_id, semantic_key, fact_scope);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_attempt ON application_page_snapshots(attempt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_adapter_runs_application ON adapter_runs(application_id, started_at);
CREATE INDEX IF NOT EXISTS idx_field_resolutions_application ON field_resolutions(application_id, field_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_application ON application_outcome_events(application_id, occurred_at);

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

-- Shared application intelligence. Raw, user-specific page observations stay
-- in application_page_snapshots/application_field_snapshots. These tables are
-- the compact, recent read model used to prepare other candidates before they
-- open the same application.
CREATE TABLE IF NOT EXISTS canonical_fields (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'APPLICATION',
    data_type TEXT NOT NULL DEFAULT 'TEXT',
    scope TEXT NOT NULL DEFAULT 'CANDIDATE_PROFILE',
    sensitivity TEXT NOT NULL DEFAULT 'STANDARD',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_mappings (
    normalized_question_hash TEXT PRIMARY KEY,
    normalized_question TEXT NOT NULL,
    canonical_field_key TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    resolution_source TEXT NOT NULL DEFAULT 'RULE',
    observation_count INTEGER NOT NULL DEFAULT 1,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(canonical_field_key) REFERENCES canonical_fields(key)
);

CREATE TABLE IF NOT EXISTS application_schemas (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    ats_type TEXT NOT NULL DEFAULT 'generic',
    form_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    confidence REAL NOT NULL DEFAULT 0.5,
    observation_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'FRESH',
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, form_hash),
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS application_schema_fields (
    schema_id TEXT NOT NULL,
    field_signature TEXT NOT NULL,
    canonical_field_key TEXT NOT NULL,
    raw_label TEXT NOT NULL,
    page_index INTEGER NOT NULL DEFAULT 0,
    input_type TEXT NOT NULL DEFAULT 'text',
    required INTEGER NOT NULL DEFAULT 0,
    conditional INTEGER NOT NULL DEFAULT 0,
    condition_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0.5,
    observation_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(schema_id, field_signature),
    FOREIGN KEY(schema_id) REFERENCES application_schemas(id),
    FOREIGN KEY(canonical_field_key) REFERENCES canonical_fields(key)
);

CREATE TABLE IF NOT EXISTS current_application_schemas (
    job_id TEXT PRIMARY KEY,
    schema_id TEXT NOT NULL,
    refreshed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id),
    FOREIGN KEY(schema_id) REFERENCES application_schemas(id)
);

CREATE TABLE IF NOT EXISTS application_schema_observations (
    schema_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    application_id TEXT NOT NULL,
    observed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(schema_id, attempt_id),
    FOREIGN KEY(schema_id) REFERENCES application_schemas(id),
    FOREIGN KEY(attempt_id) REFERENCES application_attempts(id),
    FOREIGN KEY(application_id) REFERENCES applications(id)
);

-- One row per candidate and missing concept, not candidate × job × field.
-- affected_jobs_json only keeps a few examples; the count is the hot read.
CREATE TABLE IF NOT EXISTS attention_gaps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'local-user',
    canonical_field_key TEXT NOT NULL,
    label TEXT NOT NULL,
    affected_job_count INTEGER NOT NULL DEFAULT 0,
    affected_jobs_json TEXT NOT NULL DEFAULT '[]',
    impact_score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    source_schema_ids_json TEXT NOT NULL DEFAULT '[]',
    expires_at DATETIME NOT NULL,
    calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    UNIQUE(user_id, canonical_field_key),
    FOREIGN KEY(canonical_field_key) REFERENCES canonical_fields(key)
);

CREATE INDEX IF NOT EXISTS idx_question_mappings_canonical ON question_mappings(canonical_field_key, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_application_schemas_fresh ON application_schemas(job_id, expires_at, status);
CREATE INDEX IF NOT EXISTS idx_application_schema_fields_key ON application_schema_fields(canonical_field_key, required);
CREATE INDEX IF NOT EXISTS idx_application_schema_observations_application ON application_schema_observations(application_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_attention_gaps_open ON attention_gaps(user_id, status, impact_score);
