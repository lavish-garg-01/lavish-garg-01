import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import type { AiReservation } from "@job-hunter-v2/ai";
import { KyselyAiLedger, migrateInitialSchema, migrateAiOrchestration, type SqlClient, type V2Database } from "./index.js";

function client(pg: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({
      rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows
    }), executeScript: async (text: string) => target.exec(text).then(() => undefined)
  });
  return { ...executor(pg), withTransaction: async (work) => pg.transaction((tx) => work(executor(tx))) };
}
test("P durable reservations survive new repository instances, reject foreign scope and enforce daily caps", async () => {
  const pg = new PGlite();
  await migrateInitialSchema(client(pg)); await migrateAiOrchestration(client(pg));
  assert.equal((await migrateAiOrchestration(client(pg))).applied, false);
  const accountId = crypto.randomUUID(), candidateId = crypto.randomUUID();
  await pg.query("INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES ($1,'TEST',false)", [accountId]);
  await pg.query("INSERT INTO candidates (id,account_id) VALUES ($1,$2)", [candidateId, accountId]);
  const database = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  const ledger = new KyselyAiLedger(database);
  const command: AiReservation = { key: "a".repeat(64), fingerprint: "b".repeat(64), accountId, candidateId, applicationId: null,
    provider: "GROQ", model: "fixture", taskType: "CANONICALIZE_FIELD", amountMicros: 60,
    dailyLimitMicros: 100, candidateLimitMicros: 100, applicationLimitMicros: 100 };
  assert.equal(await ledger.reserve(command), "RESERVED");
  assert.equal(await new KyselyAiLedger(database).reserve(command), "DUPLICATE");
  assert.equal(await ledger.reserve({ ...command, fingerprint: "c".repeat(64) }), "CONFLICT");
  assert.equal(await ledger.reserve({ ...command, key: "d".repeat(64) }), "BUDGET_EXCEEDED");
  assert.equal(await ledger.reserve({ ...command, accountId: crypto.randomUUID() }), "CONFLICT");
  await assert.rejects(pg.exec("DELETE FROM ai_request_reservations"), /append-only/);
  const columns = await pg.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='ai_request_reservations'");
  assert.equal(columns.rows.some((r) => /prompt|payload|response|secret/.test(r.column_name)), false);
  const rls = await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname='ai_request_reservations'");
  assert.equal(rls.rows[0]?.relrowsecurity, true);
  await ledger.record({ accountId, candidateId, applicationId: null }, {
    requestId: crypto.randomUUID(), taskType: "CANONICALIZE_FIELD", taskVersion: 1, schemaVersion: 1,
    policyVersion: "P1-2026-09", status: "ACCEPTED", error: null, confidence: 0.9, cache: "MISS",
    attempts: [{ provider: "GROQ", model: "fixture", usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 5,
      chargedMicros: 60, usageEstimated: false, failure: null }]
  });
  assert.equal((await pg.query("SELECT * FROM ai_usage_events")).rows.length, 1);
  await assert.rejects(pg.exec("DELETE FROM ai_usage_events"), /append-only/);
  await database.destroy();
});
