import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CandidateTruthService, HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { CandidateProfileService } from "@job-hunter-v2/onboarding";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateConfirmationRepository,
  KyselyCandidateProfileRepository,
  KyselyCandidateTruthRepository,
  migrateCandidateAnswerReversals,
  migrateCandidateOnboardingBootstrap,
  migrateCandidateOnboardingConfirmation,
  migrateCandidateProfileCompletion,
  migrateCandidateResumeIntelligence,
  migrateDocumentIntelligence,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await target.query<Row>(text, values ? [...values] : undefined);
      return { rows: result.rows };
    },
    executeScript: async (text: string) => void (await target.exec(text))
  });
  return { ...executor(database), withTransaction: async (work) => database.transaction((tx) => work(executor(tx))) };
}

const accountId = "10000000-0000-4000-8000-000000000011";
const candidateId = "20000000-0000-4000-8000-000000000011";
const foreignAccountId = "10000000-0000-4000-8000-000000000012";
const now = new Date("2026-09-01T10:00:00.000Z");
const common = { schemaVersion: 1 as const, dataClass: "CANDIDATE_PRIVATE" as const };

test("G5-G7 profile is a Candidate Truth view with stable entities, readiness, partial Undo and Restore", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  await migrateCandidateTruthOntology(migrations);
  await migrateCandidateTruthMutationGuards(migrations);
  await migrateCandidateScopePolicyVectors(migrations);
  await migrateCandidateReviewOutcomeProofs(migrations);
  await migrateCandidateAnswerReversals(migrations);
  await migrateCandidateOnboardingBootstrap(migrations);
  await migrateCandidateResumeIntelligence(migrations);
  await migrateCandidateOnboardingConfirmation(migrations);
  await migrateDocumentIntelligence(migrations);
  await migrateGlobalAnswerDefaults(migrations);
  const completionMigration = await migrateCandidateProfileCompletion(migrations);
  assert.equal(completionMigration.applied, true);
  assert.equal((await migrateCandidateProfileCompletion(migrations)).applied, false);
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES
      ('${accountId}', 'NORMAL'), ('${foreignAccountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id, status) VALUES ('${candidateId}', '${accountId}', 'ACTIVE');
    INSERT INTO candidate_onboarding_states (
      candidate_id, account_id, stage, status, version, started_at, last_seen_at
    ) VALUES ('${candidateId}', '${accountId}', 'PROFILE', 'IN_PROGRESS', 1, '${now.toISOString()}', '${now.toISOString()}');
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const hmac = new HmacCandidateValueFingerprinter("profile-test-secret-that-is-at-least-32-bytes", 1);
  const truth = new CandidateTruthService(new KyselyCandidateTruthRepository(kysely), hmac, { now: () => now });
  let sequence = 0;
  const entities = new KyselyCandidateConfirmationRepository(
    kysely,
    () => `71000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
  );
  const profile = new CandidateProfileService(
    new KyselyCandidateProfileRepository(kysely),
    truth,
    entities,
    { now: () => now },
    () => `61000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
  );

  const initial = await profile.save({
    accountId,
    candidateId,
    idempotencyKey: "manual-profile-initial",
    items: [
      { itemKey: "name", canonicalKey: "FULL_NAME", normalizedValue: { ...common, kind: "STRING", value: "Lavish Kumar" }, expectedCurrentVersionId: null },
      { itemKey: "email", canonicalKey: "EMAIL", normalizedValue: { ...common, kind: "STRING", value: "lavish@example.com" }, expectedCurrentVersionId: null },
      { itemKey: "phone", canonicalKey: "PHONE", normalizedValue: { ...common, kind: "PHONE", countryCode: "+91", nationalNumber: "9876543210", extension: null }, expectedCurrentVersionId: null },
      { itemKey: "skills", canonicalKey: "SKILLS", normalizedValue: { ...common, kind: "MULTI_ENUM", values: [{ key: "typescript", label: "TypeScript" }] }, expectedCurrentVersionId: null },
      { itemKey: "job1-company", canonicalKey: "EMPLOYMENT_COMPANY", normalizedValue: { ...common, kind: "STRING", value: "Vidyakul" }, entityType: "EMPLOYMENT", newEntityClientKey: "employment-one", expectedCurrentVersionId: null },
      { itemKey: "job1-title", canonicalKey: "EMPLOYMENT_TITLE", normalizedValue: { ...common, kind: "STRING", value: "Software Engineer" }, entityType: "EMPLOYMENT", newEntityClientKey: "employment-one", expectedCurrentVersionId: null },
      { itemKey: "job2-company", canonicalKey: "EMPLOYMENT_COMPANY", normalizedValue: { ...common, kind: "STRING", value: "Acme" }, entityType: "EMPLOYMENT", newEntityClientKey: "employment-two", expectedCurrentVersionId: null }
    ]
  });
  assert.equal(initial.items.length, 7);
  const snapshot = await profile.get(accountId, candidateId);
  assert.equal(snapshot.answers.length, 7);
  const employmentIds = new Set(snapshot.answers.filter((answer) => answer.entityType === "EMPLOYMENT").map((answer) => answer.entityId));
  assert.equal(employmentIds.size, 2, "repeatable history identity must not be array position");
  const readiness = await profile.readiness(accountId, candidateId);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.requirements.find((item) => item.key === "RESUME")?.met, false);

  const phone = snapshot.answers.find((answer) => answer.canonicalKey === "PHONE");
  const skills = snapshot.answers.find((answer) => answer.canonicalKey === "SKILLS");
  assert.ok(phone && skills);
  const grouped = await profile.save({
    accountId, candidateId, idempotencyKey: "profile-group-update",
    items: [
      { itemKey: "phone", canonicalKey: "PHONE", normalizedValue: { ...common, kind: "PHONE", countryCode: "+91", nationalNumber: "9123456789", extension: null }, expectedCurrentVersionId: phone.answerVersionId },
      { itemKey: "skills", canonicalKey: "SKILLS", normalizedValue: { ...common, kind: "MULTI_ENUM", values: [{ key: "typescript", label: "TypeScript" }, { key: "nodejs", label: "Node.js" }] }, expectedCurrentVersionId: skills.answerVersionId }
    ]
  });
  const groupedPhone = grouped.items.find((item) => item.canonicalKey === "PHONE");
  const groupedSkills = grouped.items.find((item) => item.canonicalKey === "SKILLS");
  assert.ok(groupedPhone && groupedSkills);
  await profile.save({
    accountId, candidateId, idempotencyKey: "newer-skills-update",
    items: [{
      itemKey: "skills", canonicalKey: "SKILLS",
      normalizedValue: { ...common, kind: "MULTI_ENUM", values: [{ key: "typescript", label: "TypeScript" }, { key: "postgresql", label: "PostgreSQL" }] },
      expectedCurrentVersionId: groupedSkills.answerVersionId
    }]
  });
  const undone = await profile.undo({
    accountId, candidateId, changeSetId: grouped.changeSetId, idempotencyKey: "undo-profile-group-update"
  });
  assert.deepEqual(undone.summary, { restored: 1, forgotten: 0, skippedNewerVersion: 1 });
  const phoneUndo = undone.items.find((item) => item.canonicalKey === "PHONE");
  assert.ok(phoneUndo?.compensatingVersionId);
  const restored = await profile.restore({
    accountId, candidateId, versionId: groupedPhone.answerVersionId,
    expectedCurrentVersionId: phoneUndo.compensatingVersionId,
    idempotencyKey: "restore-updated-phone"
  });
  assert.deepEqual(restored.summary, { restored: 1, forgotten: 0, skippedNewerVersion: 0 });
  await assert.rejects(
    profile.save({
      accountId, candidateId, idempotencyKey: "stale-phone-edit",
      items: [{
        itemKey: "phone", canonicalKey: "PHONE",
        normalizedValue: { ...common, kind: "PHONE", countryCode: "+91", nationalNumber: "9000000000", extension: null },
        expectedCurrentVersionId: phone.answerVersionId
      }]
    }),
    /changed (since|after)|current/i
  );
  const history = await profile.history({ accountId, candidateId, canonicalKey: "PHONE" });
  assert.equal(history.length >= 4, true);
  assert.equal(history.filter((entry) => entry.current).length, 1);
  assert.equal((await profile.reversalHistory({ accountId, candidateId })).length, 2);

  const beforeCompletion = await profile.get(accountId, candidateId);
  const completed = await profile.complete({
    accountId, candidateId, expectedOnboardingVersion: beforeCompletion.onboardingVersion,
    idempotencyKey: "complete-manual-onboarding"
  });
  assert.equal(completed.idempotentReplay, false);
  const completionReplay = await profile.complete({
    accountId, candidateId, expectedOnboardingVersion: beforeCompletion.onboardingVersion,
    idempotencyKey: "complete-manual-onboarding"
  });
  assert.equal(completionReplay.idempotentReplay, true);
  await assert.rejects(profile.get(foreignAccountId, candidateId), /not found/i);
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";
