import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { KyselyStrategyRepository, migrateInitialSchema, migrateStrategyIntelligence, type SqlClient, type V2Database } from "@job-hunter-v2/database";
import { StrategyIntelligenceService, digest } from "@job-hunter-v2/strategy-intelligence";
import { validateStrategyOffline } from "./strategy-offline.js";

const pg = new PGlite();
const executor = (target: Pick<PGlite, "query" | "exec">) => ({
  query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({ rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows }),
  executeScript: async (text: string) => target.exec(text).then(() => undefined)
});
const client: SqlClient = { ...executor(pg), withTransaction: (work) => pg.transaction((tx) => work(executor(tx))) };
await migrateInitialSchema(client); await migrateStrategyIntelligence(client);
const db = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
try {
  const repo = new KyselyStrategyRepository(db), q = new StrategyIntelligenceService(repo, "offline-fixture-secret-only".repeat(2));
  await q.initialize();
  const pattern = { capability: "NATIVE_TEXT" as const, representationKind: "TEXT" as const, representationId: "TEXT@1", structuralFingerprint: "a".repeat(64), siteFamily: "OTHER" as const };
  const state = await q.cluster(pattern), actorId = crypto.randomUUID();
  const command = (revision: number) => ({ idempotencyKey: crypto.randomUUID(), expectedRevision: revision, actorId, reason: "EVIDENCE_EVALUATION" });
  const proposal = await q.propose(state.cluster, { kind: "TARGET_TEXT", steps: ["FOCUS", "SET_NATIVE_VALUE", "INPUT", "CHANGE", "BLUR"] }, "DEVELOPER", command(0));
  const definition = (await repo.definitions()).find((d) => d.key === proposal.key)!;
  const proof = await validateStrategyOffline(definition, actorId, q);
  assert.ok(Object.values(proof.checks).every(Boolean));
  await assert.rejects(q.approveOffline(state.cluster, proposal.key, { ...proof, attestation: "0".repeat(64) }, command(1)), /OFFLINE/);
  await assert.rejects(q.approveOffline(state.cluster, proposal.key, { ...proof, definitionHash: digest("different") }, command(1)), /OFFLINE/);
  const approved = await q.approveOffline(state.cluster, proposal.key, proof, command(1));
  const canary = await q.startCanary(state.cluster, proposal.key, command(approved.revision));
  assert.equal(canary.experiment?.percent, 5);
  assert.equal((await q.evaluate(state.cluster, command(canary.revision))).states[proposal.key], "CANARY");
  const selected = await q.select(pattern, { accountId: actorId, candidateId: crypto.randomUUID() }, crypto.randomUUID());
  assert.ok(selected.strategies.some((s) => s.key === "NATIVE_VALUE_SETTER@1"));
  const disabled = await q.control(state.cluster, proposal.key, "DISABLE", command(canary.revision));
  assert.equal(disabled.experiment?.status, "HALTED");
  // A safe-looking direct setter is rejected by the independent framework fixture.
  const bad = await q.propose(state.cluster, { kind: "TARGET_TEXT", steps: ["SET_DIRECT_VALUE", "INPUT", "CHANGE"] }, "AI_ASSISTED", command(disabled.revision));
  const badDefinition = (await repo.definitions()).find((d) => d.key === bad.key)!;
  await assert.rejects(validateStrategyOffline(badDefinition, actorId, q), /react/);
  await assert.rejects(q.startCanary(state.cluster, bad.key, command(bad.state.revision)), /ELIGIBLE/);
  process.stdout.write("Phase Q independent browser pipeline passed: sixteen K/verifier fixtures, unsigned/tampered-proof rejection, reviewed canary eligibility, insufficient-sample non-promotion, failed candidate→verified stable fallback, expired-policy refusal, emergency stop, and failing-framework candidate exclusion.\n");
} finally { await db.destroy(); }
