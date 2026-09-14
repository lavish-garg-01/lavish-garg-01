import assert from "node:assert/strict";
import test from "node:test";
import { IdentityService, StaticIdentityTokenVerifier } from "@job-hunter-v2/auth";
import { CandidateTruthService, HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import {
  AesGcmCandidatePayloadCipher,
  CandidateConfirmationService,
  CandidateProfileService,
  CandidateSessionService,
  DeterministicResumeCandidateExtractor,
  ResumeOnboardingService,
  type ObjectStoragePort,
  type ResumeTextExtractor
} from "@job-hunter-v2/onboarding";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateBootstrapRepository,
  KyselyCandidateConfirmationRepository,
  KyselyCandidateProfileRepository,
  KyselyCandidateTruthRepository,
  KyselyIdentityRepository,
  KyselyResumeRepository,
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
  migrateCoreEntitlements,
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
  return { ...executor(database), withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction))) };
}

class MemoryStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, Uint8Array>();
  async put(input: { objectKey: string; bytes: Uint8Array }): Promise<void> { this.objects.set(input.objectKey, input.bytes.slice()); }
  async get(objectKey: string): Promise<Uint8Array> {
    const bytes = this.objects.get(objectKey);
    if (!bytes) throw new Error("Resume object is missing.");
    return bytes.slice();
  }
  async delete(objectKey: string): Promise<void> { this.objects.delete(objectKey); }
}

test("G8 new candidate completes the resume journey and returns to one ready Candidate Truth profile", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  await migrateCoreEntitlements(migrations);
  await migrateCandidateTruthOntology(migrations);
  await migrateCandidateTruthMutationGuards(migrations);
  await migrateCandidateScopePolicyVectors(migrations);
  await migrateCandidateReviewOutcomeProofs(migrations);
  await migrateCandidateAnswerReversals(migrations);
  await migrateCandidateOnboardingBootstrap(migrations);
  await migrateCandidateResumeIntelligence(migrations);
  await migrateCandidateOnboardingConfirmation(migrations);
  await migrateCandidateProfileCompletion(migrations);
  await migrateDocumentIntelligence(migrations);
  await migrateGlobalAnswerDefaults(migrations);

  const now = new Date("2026-09-01T10:00:00.000Z");
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const hmac = new HmacCandidateValueFingerprinter("g8-journey-secret-that-is-at-least-32-bytes", 1);
  const truth = new CandidateTruthService(new KyselyCandidateTruthRepository(kysely), hmac, { now: () => now });
  const session = new CandidateSessionService(
    new StaticIdentityTokenVerifier(async () => ({
      provider: "TEST", providerSubject: "g8-candidate", email: "asha@example.com",
      tokenId: null, expiresAt: new Date("2026-09-02T00:00:00.000Z")
    })),
    new IdentityService(new KyselyIdentityRepository(kysely), { now: () => now }),
    truth,
    new KyselyCandidateBootstrapRepository(kysely),
    { now: () => now }
  );
  const first = await session.authenticate("Bearer first-login");
  assert.equal(first.candidate.isNewCandidate, true);
  assert.equal(first.candidate.stage, "WELCOME");

  const extractor: ResumeTextExtractor = {
    name: "G8_TEST_PDF", version: "1",
    extract: async () => "Asha Sharma\nasha@example.com\n+91 9876543210\nTypeScript Node.js PostgreSQL"
  };
  const resumes = new ResumeOnboardingService(
    new KyselyResumeRepository(kysely),
    new MemoryStorage(),
    extractor,
    new DeterministicResumeCandidateExtractor(),
    new AesGcmCandidatePayloadCipher(Buffer.alloc(32, 8), 1),
    hmac,
    { now: () => now }
  );
  const entities = new KyselyCandidateConfirmationRepository(kysely);
  const confirmation = new CandidateConfirmationService(resumes, truth, entities, hmac, { now: () => now });
  const profile = new CandidateProfileService(
    new KyselyCandidateProfileRepository(kysely), truth, entities, { now: () => now }
  );

  const document = await resumes.upload({
    accountId: first.account.accountId,
    candidateId: first.candidate.candidateId,
    fileName: "Asha Resume.pdf",
    mimeType: "application/pdf",
    bytes: Buffer.from("%PDF-1.7\nG8 journey\n%%EOF", "utf8"),
    idempotencyKey: "g8-upload-resume"
  });
  const review = await resumes.extract({
    accountId: first.account.accountId,
    candidateId: first.candidate.candidateId,
    documentId: document.documentId,
    idempotencyKey: "g8-extract-resume"
  });
  assert.equal(review.extraction?.status, "COMPLETED");
  for (const canonical of ["FULL_NAME", "EMAIL", "PHONE", "RESUME"]) {
    assert.equal(review.proposals.some((proposal) => proposal.canonicalKey === canonical), true);
  }

  const confirmed = await confirmation.confirm({
    accountId: first.account.accountId,
    candidateId: first.candidate.candidateId,
    documentId: document.documentId,
    idempotencyKey: "g8-confirm-resume",
    decisions: review.proposals.map((proposal) => ({ proposalId: proposal.proposalId, action: "ACCEPT" as const }))
  });
  assert.ok(confirmed.changeSetId);

  const snapshot = await profile.get(first.account.accountId, first.candidate.candidateId);
  assert.equal(snapshot.answers.some((answer) => answer.canonicalKey === "FULL_NAME"), true);
  assert.equal(snapshot.answers.some((answer) => answer.canonicalKey === "EMAIL"), true);
  assert.equal(snapshot.answers.some((answer) => answer.canonicalKey === "PHONE"), true);
  assert.equal((await profile.readiness(first.account.accountId, first.candidate.candidateId)).ready, true);
  const completed = await profile.complete({
    accountId: first.account.accountId,
    candidateId: first.candidate.candidateId,
    expectedOnboardingVersion: snapshot.onboardingVersion,
    idempotencyKey: "g8-complete-onboarding"
  });
  assert.equal(completed.idempotentReplay, false);

  const returning = await session.authenticate("Bearer returning-login");
  assert.equal(returning.candidate.isNewCandidate, false);
  assert.equal(returning.candidate.completed, true);
  assert.equal(returning.candidate.stage, "READY");
  assert.equal(returning.account.accountId, first.account.accountId);
  assert.equal(returning.candidate.candidateId, first.candidate.candidateId);

  const counts = await database.query<{ accounts: string; candidates: string; current_answers: string }>(`
    SELECT
      (SELECT count(*)::text FROM accounts) AS accounts,
      (SELECT count(*)::text FROM candidates) AS candidates,
      (SELECT count(*)::text FROM candidate_answers_current WHERE candidate_id = '${first.candidate.candidateId}') AS current_answers
  `);
  assert.equal(counts.rows[0]?.accounts, "1");
  assert.equal(counts.rows[0]?.candidates, "1");
  assert.equal(Number(counts.rows[0]?.current_answers ?? 0) >= 4, true);
  const outbox = await database.query<{ payload: string }>("SELECT payload_reference::text AS payload FROM outbox_events");
  assert.equal(outbox.rows.some((row) => /asha@example\.com|9876543210|Asha Sharma/.test(row.payload)), false);
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";
