import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { StrategyIntelligenceService, builtinDefinitions, digest, StrategyEvidenceSchema, type StrategyEvidence, type Transition } from "@job-hunter-v2/strategy-intelligence";
import { KyselyStrategyRepository, migrateInitialSchema, migrateStrategyIntelligence, type SqlClient, type V2Database } from "./index.js";

function client(pg: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({
      rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows
    }), executeScript: async (text: string) => target.exec(text).then(() => undefined)
  });
  return { ...executor(pg), withTransaction: async (work) => pg.transaction((tx) => work(executor(tx))) };
}
test("Q database migration, immutable versions, lifecycle OCC/replay and scoped policy survive repository restart", async () => {
  const pg = new PGlite();
  await migrateInitialSchema(client(pg)); await migrateStrategyIntelligence(client(pg));
  assert.equal((await migrateStrategyIntelligence(client(pg))).applied, false);
  const database = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  try {
    const repo = new KyselyStrategyRepository(database), q = new StrategyIntelligenceService(repo, "test-secret".repeat(4));
    await q.initialize(); await q.initialize();
    const definitions = await repo.definitions(); assert.equal(definitions.length, 10);
    await assert.rejects(repo.addDefinition({ ...builtinDefinitions()[0]!, origin: "DEVELOPER" }), /IMMUTABLE/);
    const state = await q.cluster({ capability: "NATIVE_TEXT", representationKind: "TEXT", representationId: "TEXT@1", siteFamily: "OTHER", structuralFingerprint: "a".repeat(32) });
    const command: Transition = { idempotencyKey: crypto.randomUUID(), expectedRevision: 0, actorId: crypto.randomUUID(), reason: "EVIDENCE_EVALUATION" };
    const proposed = await q.propose(state.cluster, { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, "DEVELOPER", command);
    const replay = await q.propose(state.cluster, { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, "DEVELOPER", command);
    assert.equal(replay.state.revision, 1);
    await assert.rejects(q.propose(state.cluster, { kind: "TARGET_TEXT", steps: ["FOCUS", "SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, "DEVELOPER", command), /IDEMPOTENCY/);
    const revisionCommand = { ...command, idempotencyKey: crypto.randomUUID(), expectedRevision: 1 };
    const competing = await Promise.allSettled([
      q.control(state.cluster, proposed.key, "DISABLE", revisionCommand),
      q.control(state.cluster, proposed.key, "REJECT", { ...revisionCommand, idempotencyKey: crypto.randomUUID() })
    ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    const restarted = new KyselyStrategyRepository(database);
    assert.equal((await restarted.read(state.cluster))?.revision, 2);
    const different = await q.cluster({ ...state.pattern, structuralFingerprint: "b".repeat(32) });
    assert.equal(different.revision, 0); assert.equal(different.states[proposed.key], undefined);
    await assert.rejects(pg.exec("DELETE FROM strategy_versions"), /append-only/);
    await assert.rejects(pg.exec("DELETE FROM strategy_policy_transitions"), /append-only/);
    const transition = await pg.query<{ state: unknown }>("SELECT state FROM strategy_policy_transitions WHERE revision=1");
    assert.equal(digest(transition.rows[0]?.state) === "", false);
    const flags = await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='strategy_performance_evidence'");
    assert.equal(flags.rows[0]?.relrowsecurity, true);
  } finally { await database.destroy(); }
});

test("Q PostgreSQL promotion commits once, survives restart/retry and never overwrites later rollback", async () => {
  const pg = new PGlite();
  await migrateInitialSchema(client(pg)); await migrateStrategyIntelligence(client(pg));
  const database = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  // Attribution/persistence is covered by the real L integration test; inject a synthetic
  // population here to isolate actual SQL policy locking/history from evidence acquisition.
  const events: StrategyEvidence[] = [];
  class PopulationRepository extends KyselyStrategyRepository {
    override async evidence() { return events; }
  }
  try {
    const now = Date.now(), secret = "promotion-fixture-secret".repeat(2);
    const repo = new PopulationRepository(database), q = new StrategyIntelligenceService(repo, secret, undefined, () => now);
    await q.initialize();
    const initial = await q.cluster({ capability: "NATIVE_TEXT", representationKind: "TEXT", representationId: "TEXT@1", siteFamily: "OTHER", structuralFingerprint: "e".repeat(32) });
    const actorId = crypto.randomUUID();
    const command = (expectedRevision: number): Transition => ({ expectedRevision, idempotencyKey: crypto.randomUUID(), actorId, reason: "EVIDENCE_EVALUATION" });
    const { key, state: proposed } = await q.propose(initial.cluster, { kind: "TARGET_TEXT", steps: ["SET_NATIVE_VALUE", "INPUT", "CHANGE"] }, "DEVELOPER", command(0));
    const definition = (await repo.definitions()).find((d) => d.key === key)!;
    const unsigned = { definitionHash: digest(definition), suiteVersion: "Q_FIXTURES@1", reviewedBy: actorId, checkedAt: new Date(now).toISOString(),
      checks: { targetOnly: true, events: true, verifier: true, rerender: true, failure: true, bounded: true, userIntervention: true,
        dynamic: true, declaration: true, deduplication: true, regression: true, browser: true } };
    const approved = await q.approveOffline(initial.cluster, key, { ...unsigned, attestation: q.attestProof(unsigned) }, command(proposed.revision));
    let state = await q.startCanary(initial.cluster, key, command(approved.revision));
    const addPopulation = () => { for (let i = 0; i < 500; i++) for (const arm of ["CONTROL", "TREATMENT"] as const) {
      const verified = arm === "TREATMENT" || i < 430;
      events.push(StrategyEvidenceSchema.parse({ eventId: digest(crypto.randomUUID()), accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(),
        applicationRunId: crypto.randomUUID(), operationId: crypto.randomUUID(), key: arm === "TREATMENT" ? key : state.experiment!.control,
        cluster: initial.cluster, occurredAt: new Date(now).toISOString(), experimentId: state.experiment!.id, arm,
        attribution: verified ? "NONE" : "VERIFIER", executed: true, verified, verifierFailed: !verified, attempt: 1,
        durationMs: 10, fallback: false, feedback: "NONE", severe: "NONE", manualPattern: [], manualCommitted: false, containsCandidateValue: false }));
    } };
    for (const percent of [20, 50]) { addPopulation(); state = await q.evaluate(initial.cluster, command(state.revision)); assert.equal(state.experiment?.percent, percent); }
    addPopulation();
    const commands = [command(state.revision), command(state.revision)];
    const results = await Promise.allSettled(commands.map((cmd) => q.evaluate(initial.cluster, cmd)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const promoted = (await repo.read(initial.cluster))!;
    assert.equal(promoted.states[key], "STABLE"); assert.equal(promoted.order[0], key);
    const recorded = await pg.query<{ total: number }>("SELECT count(*)::int AS total FROM strategy_policy_transitions WHERE cluster=$1 AND state->'experiment'->>'status'='PROMOTED'", [initial.cluster]);
    assert.equal(recorded.rows[0]?.total, 1);
    // The winning command is recovered from the concurrent results, without assuming scheduling.
    const cmd = commands[results.findIndex((r) => r.status === "fulfilled")]!;
    const restarted = new StrategyIntelligenceService(new PopulationRepository(database), secret, undefined, () => now);
    assert.deepEqual(await restarted.evaluate(initial.cluster, cmd), promoted);
    const rolled = await restarted.control(initial.cluster, key, "ROLLBACK", command(promoted.revision));
    assert.deepEqual(await restarted.evaluate(initial.cluster, cmd), promoted);
    assert.deepEqual(await repo.read(initial.cluster), rolled);
    await assert.rejects(restarted.evaluate(initial.cluster, { ...cmd, actorId: crypto.randomUUID() }), /IDEMPOTENCY/);
  } finally { await database.destroy(); }
});
