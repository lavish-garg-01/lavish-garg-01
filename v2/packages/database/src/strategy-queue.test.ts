import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { migrateInitialSchema, migrateStrategyOperations, type SqlClient, type V2Database } from "./index.js";
import { enqueueStrategyJob, StrategyJobQueue } from "./strategy-queue.js";

test("Q queue coalesces pending evaluations, leases exclusively, recovers crashes and bounds retries", async () => {
  const pg = new PGlite();
  const ex = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({ rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows }),
    executeScript: async (text: string) => target.exec(text).then(() => undefined)
  });
  const client: SqlClient = { ...ex(pg), withTransaction: (work) => pg.transaction((tx) => work(ex(tx))) };
  await migrateInitialSchema(client); await migrateStrategyOperations(client);
  const db = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  try {
    const queue = new StrategyJobQueue(db), job = { kind: "EVALUATE" as const, cluster: "a".repeat(64) };
    await Promise.all([enqueueStrategyJob(db, job), enqueueStrategyJob(db, job)]);
    assert.equal((await pg.query("SELECT id FROM worker_jobs")).rows.length, 1);
    const [first, second] = await Promise.all([queue.claim("first"), queue.claim("second")]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const claimed = first ?? second!;
    await queue.finish(claimed.id, "wrong-owner", false);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM worker_jobs WHERE id=$1", [claimed.id])).rows[0]!.status, "PROCESSING");
    await pg.query("UPDATE worker_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1", [claimed.id]);
    const recovered = await queue.claim("restarted"); assert.equal(recovered?.id, claimed.id); assert.equal(recovered?.attempt_count, 2);
    await enqueueStrategyJob(db, job); // New evidence while evaluator is running must not be lost.
    assert.equal((await pg.query("SELECT id FROM worker_jobs")).rows.length, 2);
    await queue.finish(claimed.id, "restarted", true);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM worker_jobs WHERE id=$1", [claimed.id])).rows[0]!.status, "COMPLETED");
    let executions = 0;
    await queue.runOne(async () => { executions++; throw new Error("private provider detail must not be stored"); });
    assert.equal(executions, 1);
    const stored = await pg.query<{ status: string; last_error_code: string }>("SELECT status,last_error_code FROM worker_jobs WHERE status='PENDING'");
    assert.equal(stored.rows[0]?.last_error_code, "Q_JOB_FAILED");
    await pg.exec("UPDATE worker_jobs SET available_at=now(),attempt_count=7 WHERE status='PENDING'");
    await queue.runOne(async () => { throw new Error("failed again"); });
    assert.equal((await pg.query("SELECT id FROM worker_jobs WHERE status='DEAD'")).rows.length, 1);
    assert.equal(await queue.runOne(async () => undefined), false);
  } finally { await db.destroy(); }
});
