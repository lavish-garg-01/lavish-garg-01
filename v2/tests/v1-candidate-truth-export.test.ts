import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const requireFromTest = createRequire(import.meta.url);
const Database = requireFromTest("../../node_modules/better-sqlite3");

function seedDatabase(path: string) {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE candidate_profiles (
      user_id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT,
      preferred_first_name TEXT, preferred_last_name TEXT,
      legal_first_name TEXT, legal_middle_name TEXT, legal_last_name TEXT,
      country TEXT, current_location TEXT, address_line1 TEXT, address_line2 TEXT,
      address_city TEXT, address_state TEXT, postal_code TEXT,
      linkedin_url TEXT, github_url TEXT, portfolio_url TEXT,
      current_company TEXT, current_industry TEXT, preferred_locations TEXT,
      current_ctc REAL, expected_ctc REAL, notice_period_days INTEGER DEFAULT 0,
      last_working_date TEXT, total_experience_years REAL, skills TEXT,
      willing_to_relocate INTEGER DEFAULT 0, work_authorization TEXT,
      sponsorship_required TEXT, updated_at TEXT
    );
    CREATE TABLE candidate_fact_memory (
      id TEXT PRIMARY KEY, user_id TEXT, semantic_key TEXT, value_text TEXT,
      fact_scope TEXT, candidate_approved INTEGER, verified_at TEXT, updated_at TEXT
    );
    CREATE TABLE candidate_answers (
      id TEXT PRIMARY KEY, user_id TEXT, question_key TEXT, answer TEXT,
      confidence REAL, source TEXT, updated_at TEXT
    );
    CREATE TABLE candidate_answer_versions (
      id TEXT PRIMARY KEY, user_id TEXT, canonical_key TEXT,
      scope_qualifiers_json TEXT, scope_hash TEXT, value_json TEXT,
      status TEXT, learning_state TEXT, confirmed_at TEXT, created_at TEXT
    );
    CREATE TABLE resume_versions (
      id TEXT PRIMARY KEY, user_id TEXT, type TEXT, parsed_profile_json TEXT,
      candidate_confirmed INTEGER, created_at TEXT
    );
    CREATE TABLE form_answers (id INTEGER PRIMARY KEY, question_text TEXT, answer TEXT);
  `);
  const timestamp = "2026-08-31T10:00:00.000Z";
  database.prepare(`
    INSERT INTO candidate_profiles (
      user_id, name, email, country, notice_period_days, willing_to_relocate,
      skills, preferred_locations, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "local-user",
    "Asha Sharma",
    "asha@example.com",
    "India",
    0,
    0,
    '["TypeScript"]',
    '[]',
    timestamp
  );
  database.prepare(`
    INSERT INTO candidate_answer_versions (
      id, user_id, canonical_key, scope_qualifiers_json, scope_hash,
      value_json, status, learning_state, confirmed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "v1-version",
    "local-user",
    "CURRENT_COMPANY",
    "{}",
    "global",
    JSON.stringify({
      schemaVersion: 1,
      dataClass: "CANDIDATE_PRIVATE",
      kind: "STRING",
      value: "Private Co"
    }),
    "ACTIVE",
    "TRUSTED",
    timestamp,
    timestamp
  );
  database.prepare(`
    INSERT INTO candidate_fact_memory (
      id, user_id, semantic_key, value_text, fact_scope,
      candidate_approved, verified_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("fact-1", "local-user", "PHONE", "9876543210", "CANDIDATE_PROFILE", 1, timestamp, timestamp);
  database.prepare(`
    INSERT INTO candidate_answers (
      id, user_id, question_key, answer, confidence, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("answer-1", "local-user", "GITHUB_URL", "https://github.com/asha", 1, "USER", timestamp);
  database.prepare(`
    INSERT INTO resume_versions (
      id, user_id, type, parsed_profile_json, candidate_confirmed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "resume-1",
    "local-user",
    "MASTER",
    JSON.stringify({ fullName: "Asha Sharma", skills: ["TypeScript"] }),
    1,
    timestamp
  );
  database.prepare("INSERT INTO form_answers (question_text, answer) VALUES (?, ?), (?, ?)")
    .run("Question one", "private one", "Question two", "private two");
  database.close();
}

test("one-time V1 exporter preserves source provenance and explicitly excludes shared form memory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "job-hunter-v1-export-"));
  const databasePath = join(directory, "v1.sqlite");
  const outputPath = join(directory, "candidate-private.json");
  try {
    seedDatabase(databasePath);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/export-v1-candidate-truth.mjs",
        "--database",
        databasePath,
        "--user",
        "local-user",
        "--output",
        outputPath
      ],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /excluded 2 shared form-memory records/);
    const exported = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.migrationVersion, 1);
    assert.deepEqual(exported.exclusions, [{
      source: "form_answers",
      count: 2,
      reasonCode: "SHARED_MEMORY_NOT_CANDIDATE_OWNED"
    }]);
    assert.ok(exported.sources.some(
      (item: { sourceKind: string; canonicalKey: string; metadata: { trustState?: string } }) =>
        item.sourceKind === "V1_VERSIONED_TRUTH" &&
        item.canonicalKey === "CURRENT_COMPANY" &&
        item.metadata.trustState === "TRUSTED"
    ));
    const relocation = exported.sources.find(
      (item: { canonicalKey: string }) => item.canonicalKey === "RELOCATION"
    );
    assert.equal(relocation.metadata.ambiguousDefault, true);
    const notice = exported.sources.find(
      (item: { canonicalKey: string }) => item.canonicalKey === "NOTICE_PERIOD"
    );
    assert.equal(notice.metadata.ambiguousDefault, true);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    const second = spawnSync(
      process.execPath,
      [
        "scripts/export-v1-candidate-truth.mjs",
        "--database",
        databasePath,
        "--user",
        "local-user",
        "--output",
        outputPath
      ],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" }
    );
    assert.notEqual(second.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

