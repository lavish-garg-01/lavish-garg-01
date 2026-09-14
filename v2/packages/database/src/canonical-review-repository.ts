import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

export class KyselyCanonicalReviewRepository {
  constructor(private readonly database: Kysely<V2Database>) {}
  async record(accountId: string, candidateId: string, items: readonly { descriptorFingerprint: string; reason: string; candidateKeys: string[] }[]): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${candidateId})::bigint)`.execute(tx);
      for (const item of items.slice(0, 50)) await sql`
        INSERT INTO canonical_review_queue(account_id,candidate_id,descriptor_fingerprint,reason,candidate_keys)
        SELECT ${accountId}::uuid,${candidateId}::uuid,${item.descriptorFingerprint},${item.reason},${item.candidateKeys}::text[]
        WHERE EXISTS(SELECT 1 FROM candidates WHERE id=${candidateId} AND account_id=${accountId})
          AND ((SELECT count(*) FROM canonical_review_queue WHERE candidate_id=${candidateId}) < 500
            OR EXISTS(SELECT 1 FROM canonical_review_queue WHERE candidate_id=${candidateId} AND descriptor_fingerprint=${item.descriptorFingerprint}))
        ON CONFLICT(candidate_id,descriptor_fingerprint) DO UPDATE SET last_seen_at=now()
        WHERE canonical_review_queue.account_id=${accountId}
      `.execute(tx);
    });
  }
  async list(accountId: string, candidateId: string) {
    return (await sql<{ descriptorFingerprint: string; reason: string; candidateKeys: string[]; status: string }>`
      SELECT descriptor_fingerprint AS "descriptorFingerprint",reason,candidate_keys AS "candidateKeys",status
      FROM canonical_review_queue WHERE account_id=${accountId} AND candidate_id=${candidateId}
      ORDER BY last_seen_at DESC LIMIT 100
    `.execute(this.database)).rows;
  }
}
