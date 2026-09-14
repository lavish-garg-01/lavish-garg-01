import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";

/** Nested repository writes share the outer commit, with local rollback on handled conflicts. */
export async function inTransaction<DB, T>(database: Kysely<DB>, work: (transaction: Transaction<DB>) => Promise<T>): Promise<T> {
  if (!database.isTransaction) return database.transaction().execute(work);
  const transaction = database as Transaction<DB>;
  const name = sql.id(`nested_${randomUUID().replaceAll("-", "")}`);
  await sql`SAVEPOINT ${name}`.execute(transaction);
  try {
    const result = await work(transaction);
    await sql`RELEASE SAVEPOINT ${name}`.execute(transaction);
    return result;
  } catch (error) {
    await sql`ROLLBACK TO SAVEPOINT ${name}`.execute(transaction);
    await sql`RELEASE SAVEPOINT ${name}`.execute(transaction);
    throw error;
  }
}
