import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect, sql } from "kysely";
import { inTransaction } from "./transaction-scope.js";

test("nested repository SQL conflicts roll back locally without poisoning the outer transaction", async () => {
  const pglite = new PGlite();
  const database = new Kysely<Record<string, never>>({ dialect: new PGliteDialect({ pglite }) });
  try {
    await sql`CREATE TABLE probe(id integer PRIMARY KEY)`.execute(database);
    await inTransaction(database, async (outer) => {
      await sql`INSERT INTO probe VALUES(1)`.execute(outer);
      await assert.rejects(inTransaction(outer, async (inner) => {
        await sql`INSERT INTO probe VALUES(2)`.execute(inner);
        await sql`INSERT INTO probe VALUES(1)`.execute(inner);
      }));
      await sql`INSERT INTO probe VALUES(3)`.execute(outer);
    });
    assert.deepEqual((await sql<{ id: number }>`SELECT id FROM probe ORDER BY id`.execute(database)).rows, [{ id: 1 }, { id: 3 }]);
    await assert.rejects(inTransaction(database, async (outer) => {
      await inTransaction(outer, async (inner) => { await sql`INSERT INTO probe VALUES(4)`.execute(inner); });
      throw new Error("BEFORE_OUTER_COMMIT");
    }), /BEFORE_OUTER_COMMIT/);
    assert.deepEqual((await sql<{ id: number }>`SELECT id FROM probe ORDER BY id`.execute(database)).rows, [{ id: 1 }, { id: 3 }]);
  } finally { await database.destroy(); }
});
