const PROFILE_FIELDS = Object.freeze([
  ["name", "FULL_NAME"],
  ["preferred_first_name", "PREFERRED_FIRST_NAME"],
  ["preferred_last_name", "PREFERRED_LAST_NAME"],
  ["legal_first_name", "LEGAL_FIRST_NAME"],
  ["legal_middle_name", "LEGAL_MIDDLE_NAME"],
  ["legal_last_name", "LEGAL_LAST_NAME"],
  ["email", "EMAIL"],
  ["phone", "PHONE"],
  ["country", "COUNTRY"],
  ["current_location", "CURRENT_LOCATION"],
  ["address_line1", "ADDRESS_LINE1"],
  ["address_line2", "ADDRESS_LINE2"],
  ["address_city", "ADDRESS_CITY"],
  ["address_state", "ADDRESS_STATE"],
  ["postal_code", "POSTAL_CODE"],
  ["linkedin_url", "LINKEDIN_URL"],
  ["github_url", "GITHUB_URL"],
  ["portfolio_url", "PORTFOLIO_URL"],
  ["current_company", "CURRENT_COMPANY"],
  ["current_industry", "CURRENT_INDUSTRY"],
  ["preferred_locations", "PREFERRED_LOCATIONS", "JSON_LIST"],
  ["current_ctc", "CURRENT_CTC", "LPA"],
  ["expected_ctc", "EXPECTED_CTC", "LPA"],
  ["notice_period_days", "NOTICE_PERIOD", "DAYS"],
  ["last_working_date", "LAST_WORKING_DATE"],
  ["total_experience_years", "TOTAL_EXPERIENCE", "YEARS"],
  ["skills", "SKILLS", "JSON_LIST"],
  ["willing_to_relocate", "RELOCATION", "BOOLEAN_DEFAULT"],
  ["work_authorization", "WORK_AUTHORIZATION"],
  ["sponsorship_required", "SPONSORSHIP"]
]);

const RESUME_FIELDS = Object.freeze([
  ["fullName", "FULL_NAME"],
  ["email", "EMAIL"],
  ["phone", "PHONE"],
  ["country", "COUNTRY"],
  ["location", "CURRENT_LOCATION"],
  ["linkedin", "LINKEDIN_URL"],
  ["github", "GITHUB_URL"],
  ["portfolio", "PORTFOLIO_URL"],
  ["noticePeriodDays", "NOTICE_PERIOD", "DAYS"],
  ["totalExperienceYears", "TOTAL_EXPERIENCE", "YEARS"],
  ["summary", "PERSONAL_SUMMARY"],
  ["skills", "SKILLS", "LIST"]
]);

function parseJson(value, fallback) {
  try {
    return JSON.parse(value ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function tableExists(database, table) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function tableColumns(database, table) {
  if (!tableExists(database, table)) return new Set();
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function selectRows(database, table, sql, parameters = []) {
  return tableExists(database, table) ? database.prepare(sql).all(...parameters) : [];
}

function profileSources(profile) {
  if (!profile) return [];
  const result = [];
  for (const [column, canonicalKey, unit] of PROFILE_FIELDS) {
    let rawValue = profile[column];
    if (unit === "JSON_LIST") rawValue = parseJson(rawValue, []);
    if (!hasValue(rawValue) && rawValue !== false && rawValue !== 0) continue;
    result.push({
      sourceKind: "CANDIDATE_PROFILE",
      sourceRecordId: `candidate_profiles:${profile.user_id}:${column}`,
      canonicalKey,
      rawValue,
      confirmedAt: profile.updated_at ?? null,
      metadata: {
        ...(unit && unit !== "BOOLEAN_DEFAULT" ? { unit } : {}),
        ...(profile.country ? { countryCode: profile.country } : {}),
        ...((unit === "BOOLEAN_DEFAULT" && !rawValue) ||
        (column === "notice_period_days" && Number(rawValue) === 0)
          ? { ambiguousDefault: true }
          : {})
      }
    });
  }
  return result;
}

function versionedSources(rows) {
  return rows.map((row) => {
    const qualifiers = parseJson(row.scope_qualifiers_json, {});
    const hasQualifiers = Object.keys(qualifiers).length > 0;
    const entityCanonical = /^(?:EMPLOYMENT|EDUCATION|PROJECT|CERTIFICATION|LANGUAGE)_/.test(
      String(row.canonical_key ?? "").toUpperCase()
    );
    return {
      sourceKind: "V1_VERSIONED_TRUTH",
      sourceRecordId: `candidate_answer_versions:${row.id}`,
      canonicalKey: row.canonical_key,
      rawValue: parseJson(row.value_json, null),
      confirmedAt: row.confirmed_at ?? null,
      metadata: {
        versionStatus: row.status ?? null,
        trustState: row.learning_state === "TRUSTED" ? "TRUSTED" : "REVIEW",
        scopeKind: entityCanonical ? "ENTITY" : hasQualifiers ? "CONTEXTUAL" : "GLOBAL"
      }
    };
  });
}

function factSources(rows, countryCode) {
  return rows.map((row) => ({
    sourceKind: "APPROVED_FACT_MEMORY",
    sourceRecordId: `candidate_fact_memory:${row.id}`,
    canonicalKey: row.semantic_key,
    rawValue: row.value_text,
    confirmedAt: row.verified_at ?? row.updated_at ?? null,
    metadata: {
      candidateApproved: Boolean(row.candidate_approved),
      factScope: row.fact_scope ?? null,
      ...(countryCode ? { countryCode } : {}),
      ...(["CURRENT_CTC", "EXPECTED_CTC"].includes(String(row.semantic_key).toUpperCase())
        ? { unit: "LPA" }
        : String(row.semantic_key).toUpperCase() === "TOTAL_EXPERIENCE"
          ? { unit: "YEARS" }
          : {})
    }
  }));
}

function answerSources(rows, countryCode) {
  return rows.map((row) => ({
    sourceKind: "CANDIDATE_ANSWER",
    sourceRecordId: `candidate_answers:${row.id}`,
    canonicalKey: row.question_key,
    rawValue: row.answer,
    confirmedAt: row.updated_at ?? null,
    metadata: {
      answerSource: row.source ?? null,
      confidence: Number(row.confidence ?? 0),
      ...(countryCode ? { countryCode } : {}),
      ...(["CURRENT_CTC", "EXPECTED_CTC"].includes(String(row.question_key).toUpperCase())
        ? { unit: "LPA" }
        : String(row.question_key).toUpperCase() === "TOTAL_EXPERIENCE"
          ? { unit: "YEARS" }
          : {})
    }
  }));
}

function resumeSources(row, countryCode) {
  if (!row) return [];
  const profile = parseJson(row.parsed_profile_json, {});
  const resumeCountry = profile.country ?? countryCode;
  return RESUME_FIELDS.flatMap(([property, canonicalKey, unit]) => {
    const rawValue = profile[property];
    if (!hasValue(rawValue)) return [];
    return [{
      sourceKind: "MASTER_RESUME",
      sourceRecordId: `resume_versions:${row.id}:${property}`,
      canonicalKey,
      rawValue,
      confirmedAt: row.created_at ?? null,
      metadata: {
        resumeCandidateConfirmed: Boolean(row.candidate_confirmed),
        ...(unit ? { unit } : {}),
        ...(resumeCountry ? { countryCode: resumeCountry } : {})
      }
    }];
  });
}

export function readV1CandidateTruthExport(database, userId, exportedAt = new Date()) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) throw new Error("V1 user identity is required.");
  const profile = tableExists(database, "candidate_profiles")
    ? database.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(normalizedUserId) ?? null
    : null;
  const versionColumns = tableColumns(database, "candidate_answer_versions");
  const versionRows = versionColumns.size
    ? selectRows(
        database,
        "candidate_answer_versions",
        `SELECT * FROM candidate_answer_versions
         WHERE user_id = ? AND status = 'ACTIVE'
         ORDER BY canonical_key, scope_hash, created_at DESC, id DESC`,
        [normalizedUserId]
      )
    : [];
  const facts = selectRows(
    database,
    "candidate_fact_memory",
    "SELECT * FROM candidate_fact_memory WHERE user_id = ? ORDER BY semantic_key, id",
    [normalizedUserId]
  );
  const answers = selectRows(
    database,
    "candidate_answers",
    "SELECT * FROM candidate_answers WHERE user_id = ? ORDER BY question_key, id",
    [normalizedUserId]
  );
  const resume = tableExists(database, "resume_versions")
    ? database.prepare(
        `SELECT * FROM resume_versions
         WHERE user_id = ? AND type = 'MASTER'
         ORDER BY created_at DESC, id DESC LIMIT 1`
      ).get(normalizedUserId) ?? null
    : null;
  const countryCode = profile?.country ?? null;
  const sources = [
    ...versionedSources(versionRows),
    ...profileSources(profile),
    ...factSources(facts, countryCode),
    ...answerSources(answers, countryCode),
    ...resumeSources(resume, countryCode)
  ];
  const sharedMemoryCount = tableExists(database, "form_answers")
    ? Number(database.prepare("SELECT count(*) AS count FROM form_answers").get()?.count ?? 0)
    : 0;
  return {
    schemaVersion: 1,
    migrationVersion: 1,
    v1UserId: normalizedUserId,
    exportedAt: exportedAt.toISOString(),
    sources,
    exclusions: [{
      source: "form_answers",
      count: sharedMemoryCount,
      reasonCode: "SHARED_MEMORY_NOT_CANDIDATE_OWNED"
    }]
  };
}
