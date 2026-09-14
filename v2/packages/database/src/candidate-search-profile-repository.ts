import type {
  CandidateSearchProfileRepository,
  StoredCandidateSearchProfile
} from "@job-hunter-v2/job-intelligence";
import { CandidateSearchPreferencesSchema } from "@job-hunter-v2/job-intelligence";
import { ConflictError, IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface ProfileRow {
  candidate_id: string;
  version: number;
  preferences: unknown;
  updated_at: Date;
}

function stored(row: ProfileRow): StoredCandidateSearchProfile {
  return {
    candidateId: row.candidate_id,
    version: row.version,
    preferences: CandidateSearchPreferencesSchema.parse(row.preferences),
    updatedAt: row.updated_at
  };
}

export class KyselyCandidateSearchProfileRepository implements CandidateSearchProfileRepository {
  constructor(private readonly database: Kysely<V2Database>) {}

  async get(input: { accountId: string; candidateId: string }): Promise<StoredCandidateSearchProfile | null> {
    const candidate = await sql<{ id: string }>`
      SELECT id FROM candidates WHERE id = ${input.candidateId} AND account_id = ${input.accountId} AND status = 'ACTIVE'
    `.execute(this.database);
    if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
    const result = await sql<ProfileRow>`
      SELECT profile.candidate_id, profile.version, version.preferences, profile.updated_at
      FROM candidate_search_profiles profile
      JOIN candidate_search_profile_versions version
        ON version.id = profile.profile_version_id AND version.candidate_id = profile.candidate_id
      WHERE profile.candidate_id = ${input.candidateId} AND profile.account_id = ${input.accountId}
    `.execute(this.database);
    return result.rows[0] ? stored(result.rows[0]) : null;
  }

  async save(input: Parameters<CandidateSearchProfileRepository["save"]>[0]) {
    return this.database.transaction().execute(async (transaction) => {
      const candidate = await sql<{ id: string }>`
        SELECT id FROM candidates
        WHERE id = ${input.candidateId} AND account_id = ${input.accountId} AND status = 'ACTIVE'
        FOR UPDATE
      `.execute(transaction);
      if (!candidate.rows[0]) throw new NotFoundError("Active candidate was not found for this account.");
      const receipt = await sql<{ request_fingerprint: string; profile_version_id: string }>`
        SELECT request_fingerprint, profile_version_id
        FROM candidate_search_profile_receipts
        WHERE candidate_id = ${input.candidateId} AND idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Search-profile idempotency key was reused for another request.");
        }
        const replay = await sql<ProfileRow>`
          SELECT version.candidate_id, version.profile_version AS version,
                 version.preferences, version.created_at AS updated_at
          FROM candidate_search_profile_versions version
          WHERE version.id = ${receipt.rows[0].profile_version_id}
            AND version.candidate_id = ${input.candidateId}
        `.execute(transaction);
        if (!replay.rows[0]) throw new Error("Search-profile receipt is missing its version.");
        return { ...stored(replay.rows[0]), idempotentReplay: true };
      }
      const current = await sql<{ version: number }>`
        SELECT version FROM candidate_search_profiles WHERE candidate_id = ${input.candidateId} FOR UPDATE
      `.execute(transaction);
      const currentVersion = current.rows[0]?.version ?? 0;
      if (currentVersion !== input.expectedVersion) {
        throw new ConflictError("Search preferences changed after this screen was loaded.", {
          expectedVersion: input.expectedVersion,
          currentVersion
        });
      }
      const nextVersion = currentVersion + 1;
      await sql`
        INSERT INTO candidate_search_profile_versions (
          id, candidate_id, account_id, profile_version, preferences, created_at
        ) VALUES (
          ${input.receiptId}, ${input.candidateId}, ${input.accountId}, ${nextVersion},
          ${JSON.stringify(input.preferences)}::jsonb, ${input.updatedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_search_profiles (
          candidate_id, account_id, version, profile_version_id, updated_at
        ) VALUES (
          ${input.candidateId}, ${input.accountId}, ${nextVersion}, ${input.receiptId}, ${input.updatedAt}
        )
        ON CONFLICT (candidate_id) DO UPDATE SET
          version = excluded.version, profile_version_id = excluded.profile_version_id,
          updated_at = excluded.updated_at
      `.execute(transaction);
      await sql`
        INSERT INTO candidate_search_profile_receipts (
          id, candidate_id, account_id, idempotency_key, request_fingerprint,
          profile_version, profile_version_id, created_at
        ) VALUES (
          ${input.receiptId}, ${input.candidateId}, ${input.accountId}, ${input.idempotencyKey},
          ${input.requestFingerprint}, ${nextVersion}, ${input.receiptId}, ${input.updatedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload_reference, created_at
        ) VALUES (
          ${randomUUID()}, 'CANDIDATE_SEARCH_PROFILE', ${input.candidateId},
          'candidate.search_preferences_updated',
          ${JSON.stringify({ candidateId: input.candidateId, profileVersion: nextVersion })}::jsonb,
          ${input.updatedAt}
        )
      `.execute(transaction);
      return {
        candidateId: input.candidateId, version: nextVersion,
        preferences: input.preferences, updatedAt: input.updatedAt, idempotentReplay: false
      };
    });
  }
}
import { randomUUID } from "node:crypto";
