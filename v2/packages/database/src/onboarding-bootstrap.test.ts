import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { IdentityService, StaticIdentityTokenVerifier } from "@job-hunter-v2/auth";
import { CandidateTruthService, HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";
import { CandidateSessionService } from "@job-hunter-v2/onboarding";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateBootstrapRepository,
  KyselyCandidateTruthRepository,
  KyselyIdentityRepository,
  migrateCandidateOnboardingBootstrap,
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
  return {
    ...executor(database),
    withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction)))
  };
}

test("G1 creates one account-owned candidate and distinguishes first from returning login", async () => {
  const database = new PGlite();
  const migrationClient = client(database);
  await migrateInitialSchema(migrationClient);
  await migrateCoreEntitlements(migrationClient);
  await migrateCandidateOnboardingBootstrap(migrationClient);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const now = new Date("2026-09-01T10:00:00.000Z");
  const verifier = new StaticIdentityTokenVerifier(async () => ({
    provider: "TEST",
    providerSubject: "candidate-subject",
    email: "candidate@example.com",
    tokenId: null,
    expiresAt: new Date("2026-09-02T00:00:00.000Z")
  }));
  const session = new CandidateSessionService(
    verifier,
    new IdentityService(new KyselyIdentityRepository(kysely), { now: () => now }),
    new CandidateTruthService(
      new KyselyCandidateTruthRepository(kysely),
      new HmacCandidateValueFingerprinter("g1-candidate-secret-that-is-at-least-32-bytes", 1),
      { now: () => now }
    ),
    new KyselyCandidateBootstrapRepository(kysely),
    { now: () => now }
  );
  const first = await session.authenticate("Bearer first");
  const returning = await session.authenticate("Bearer second");
  assert.equal(first.candidate.isNewCandidate, true);
  assert.equal(returning.candidate.isNewCandidate, false);
  assert.equal(returning.account.accountId, first.account.accountId);
  assert.equal(returning.candidate.candidateId, first.candidate.candidateId);
  const counts = await database.query<{ accounts: string; candidates: string; states: string }>(`
    SELECT
      (SELECT count(*)::text FROM accounts) AS accounts,
      (SELECT count(*)::text FROM candidates) AS candidates,
      (SELECT count(*)::text FROM candidate_onboarding_states) AS states
  `);
  assert.deepEqual(counts.rows[0], { accounts: "1", candidates: "1", states: "1" });
  await assert.rejects(
    new KyselyCandidateBootstrapRepository(kysely).ensureState({
      accountId: "10000000-0000-4000-8000-000000000099",
      candidateId: first.candidate.candidateId,
      observedAt: now
    }),
    /Active candidate was not found/
  );
  await kysely.destroy();
});
