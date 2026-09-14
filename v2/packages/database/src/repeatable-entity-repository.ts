import { createHash, randomUUID } from "node:crypto";
import type {
  CandidateEntityDescriptor,
  CandidateEntityLifecycleResult,
  CandidateEntityReorderResult,
  RepeatableEntityRepository,
  StoredEntityBinding
} from "@job-hunter-v2/repeatable-entities";
import { EntityBindingReceiptSchema, type CandidateEntityType, type EntityBindingReceipt } from "@job-hunter-v2/contracts";
import { ConflictError, IdempotencyConflictError, NotFoundError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface EntityRow {
  id: string; entity_type: CandidateEntityType; entity_version: number | string;
  status: "ACTIVE" | "REMOVED"; display_order: number | string | null; canonical_keys: unknown; value_fingerprints: unknown;
}
interface BindingRow {
  structural_fingerprint: string; form_repeat_group_id: string; entity_type: CandidateEntityType | null;
  binding_state: EntityBindingReceipt["state"]; candidate_entity_id: string | null;
  candidate_entity_version: number | string | null; candidate_entity_revision: string | null;
  binding_version: number | string; confidence: number | string;
  confidence_bucket: EntityBindingReceipt["confidenceBucket"]; evidence_categories: unknown;
  reason_codes: unknown; error_codes: unknown;
}
interface OperationRow {
  request_fingerprint: string; operation_type: "REMOVE" | "RESTORE" | "REORDER";
  entity_type: CandidateEntityType; candidate_entity_id: string | null;
  ordered_entity_ids: unknown; result_entity_versions: unknown; result_status: string | null;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{")) return value.slice(1, -1).split(",").filter(Boolean);
  return [];
}
function numbers(value: unknown): Record<string, number> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, number>;
  return value && typeof value === "object" ? value as Record<string, number> : {};
}
function revision(entityId: string, version: number, canonicals: readonly string[], fingerprints: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify({
    entityId, version, canonicals: [...canonicals].sort(), fingerprints: [...fingerprints].sort()
  })).digest("hex");
}
function bindingReceipt(row: BindingRow): EntityBindingReceipt {
  return EntityBindingReceiptSchema.parse({
    schemaVersion: 1, formRepeatGroupId: row.form_repeat_group_id, entityType: row.entity_type,
    state: row.binding_state, candidateEntityId: row.candidate_entity_id,
    candidateEntityVersion: row.candidate_entity_version === null ? null : Number(row.candidate_entity_version),
    candidateEntityRevision: row.candidate_entity_revision, bindingVersion: Number(row.binding_version),
    confidence: Number(row.confidence), confidenceBucket: row.confidence_bucket,
    evidenceCategories: strings(row.evidence_categories), reasonCodes: strings(row.reason_codes),
    errorCodes: strings(row.error_codes), valuePrivate: true, containsCandidateValue: false
  });
}

function sameBinding(left: EntityBindingReceipt, right: EntityBindingReceipt): boolean {
  const withoutVersion = (receipt: EntityBindingReceipt) => ({ ...receipt, bindingVersion: 0 });
  return JSON.stringify(withoutVersion(left)) === JSON.stringify(withoutVersion(right));
}

export class KyselyRepeatableEntityRepository implements RepeatableEntityRepository {
  constructor(private readonly database: Kysely<V2Database>, private readonly newId: () => string = randomUUID) {}

  async invalidateBindingsExcept(input: Parameters<RepeatableEntityRepository["invalidateBindingsExcept"]>[0]): Promise<void> {
    await sql`
      UPDATE application_entity_bindings SET invalidated_at = ${input.invalidatedAt}, updated_at = ${input.invalidatedAt}
      WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        AND application_run_id = ${input.applicationRunId} AND page_instance_id = ${input.pageInstanceId}
        AND invalidated_at IS NULL
        AND NOT (form_repeat_group_id = ANY(${input.activeFormRepeatGroupIds}::text[]))
    `.execute(this.database);
  }

  async listCandidateEntities(input: Parameters<RepeatableEntityRepository["listCandidateEntities"]>[0]): Promise<readonly CandidateEntityDescriptor[]> {
    const result = await sql<EntityRow>`
      SELECT entity.id, entity.entity_type, entity.entity_version, entity.status, entity.display_order,
             coalesce(array_agg(DISTINCT canonical.canonical_key) FILTER (WHERE canonical.canonical_key IS NOT NULL), '{}'::text[]) AS canonical_keys,
             coalesce(array_agg(DISTINCT version.value_fingerprint) FILTER (WHERE version.value_fingerprint IS NOT NULL), '{}'::text[]) AS value_fingerprints
      FROM candidate_entities entity
      JOIN candidates candidate ON candidate.id = entity.candidate_id
      LEFT JOIN candidate_answers_current current_answer ON current_answer.candidate_id = entity.candidate_id AND current_answer.entity_id = entity.id
      LEFT JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
      LEFT JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
      WHERE entity.candidate_id = ${input.candidateId} AND candidate.account_id = ${input.accountId}
        AND candidate.status = 'ACTIVE' AND entity.entity_type = ANY(${input.entityTypes}::text[])
      GROUP BY entity.id
      ORDER BY entity.entity_type, entity.created_at DESC, entity.id
    `.execute(this.database);
    const ranks = new Map<CandidateEntityType, number>();
    return result.rows.map((row) => {
      const rank = ranks.get(row.entity_type) ?? 0;
      ranks.set(row.entity_type, rank + 1);
      const version = Number(row.entity_version);
      const canonicalCoverage = strings(row.canonical_keys);
      const privateValueFingerprints = strings(row.value_fingerprints);
      return {
        candidateEntityId: row.id, entityType: row.entity_type, entityVersion: version,
        entityRevision: revision(row.id, version, canonicalCoverage, privateValueFingerprints), status: row.status,
        displayOrder: row.display_order === null ? null : Number(row.display_order),
        recencyRank: row.status === "ACTIVE" ? rank : null,
        canonicalCoverage, privateValueFingerprints
      };
    });
  }

  async findBinding(input: Parameters<RepeatableEntityRepository["findBinding"]>[0]): Promise<StoredEntityBinding | null> {
    const found = await sql<BindingRow>`
      SELECT structural_fingerprint, form_repeat_group_id, entity_type, binding_state, candidate_entity_id,
             candidate_entity_version, candidate_entity_revision, binding_version, confidence,
             confidence_bucket, evidence_categories, reason_codes, error_codes
      FROM application_entity_bindings
      WHERE account_id = ${input.accountId} AND candidate_id = ${input.candidateId}
        AND application_run_id = ${input.applicationRunId} AND page_instance_id = ${input.pageInstanceId}
        AND form_repeat_group_id = ${input.formRepeatGroupId} AND invalidated_at IS NULL
    `.execute(this.database);
    return found.rows[0] ? { receipt: bindingReceipt(found.rows[0]), structuralFingerprint: found.rows[0].structural_fingerprint } : null;
  }

  async saveBinding(input: Parameters<RepeatableEntityRepository["saveBinding"]>[0]): Promise<EntityBindingReceipt> {
    return this.database.transaction().execute(async (transaction) => {
      const run = await sql<{ id: string }>`
        SELECT run.id FROM application_runs run JOIN applications application ON application.id = run.application_id
        WHERE run.id = ${input.applicationRunId} AND application.candidate_id = ${input.candidateId}
          AND application.account_id = ${input.accountId} AND run.status IN ('AUTHORIZED', 'ACTIVE', 'PAUSED')
      `.execute(transaction);
      if (!run.rows[0]) throw new ConflictError("Application run is stale or does not belong to this candidate.");
      const existing = await sql<BindingRow>`
        SELECT structural_fingerprint, form_repeat_group_id, entity_type, binding_state, candidate_entity_id,
               candidate_entity_version, candidate_entity_revision, binding_version, confidence,
               confidence_bucket, evidence_categories, reason_codes, error_codes
        FROM application_entity_bindings WHERE application_run_id = ${input.applicationRunId}
          AND page_instance_id = ${input.pageInstanceId} AND form_repeat_group_id = ${input.group.formRepeatGroupId} FOR UPDATE
      `.execute(transaction);
      if (existing.rows[0]) {
        const previous = bindingReceipt(existing.rows[0]);
        let nextReceipt = input.receipt;
        if (existing.rows[0].structural_fingerprint !== input.group.structuralFingerprint) {
          nextReceipt = EntityBindingReceiptSchema.parse({
            schemaVersion: 1, formRepeatGroupId: input.group.formRepeatGroupId, entityType: input.group.entityType,
            state: "UNBOUND", candidateEntityId: null, candidateEntityVersion: null, candidateEntityRevision: null,
            bindingVersion: Number(existing.rows[0].binding_version) + 1, confidence: 0, confidenceBucket: "NONE",
            evidenceCategories: [], reasonCodes: ["FORM_GROUP_STRUCTURE_CHANGED"], errorCodes: ["FORM_GROUP_STALE"],
            valuePrivate: true, containsCandidateValue: false
          });
        } else if (sameBinding(previous, nextReceipt)) {
          return previous;
        } else {
          nextReceipt = EntityBindingReceiptSchema.parse({
            ...nextReceipt,
            bindingVersion: Number(existing.rows[0].binding_version) + 1
          });
        }
        await this.assertCurrentEntityRevision(transaction, input, nextReceipt);
        await sql`
          UPDATE application_entity_bindings SET
            structural_fingerprint = ${input.group.structuralFingerprint}, identity_kind = ${input.group.identityKind},
            entity_type = ${input.group.entityType}, binding_state = ${nextReceipt.state},
            candidate_entity_id = ${nextReceipt.candidateEntityId}, candidate_entity_version = ${nextReceipt.candidateEntityVersion},
            candidate_entity_revision = ${nextReceipt.candidateEntityRevision}, binding_version = ${nextReceipt.bindingVersion},
            confidence = ${nextReceipt.confidence}, confidence_bucket = ${nextReceipt.confidenceBucket},
            evidence_categories = ${nextReceipt.evidenceCategories}::text[], reason_codes = ${nextReceipt.reasonCodes}::text[],
            error_codes = ${nextReceipt.errorCodes}::text[], invalidated_at = NULL, updated_at = ${input.createdAt}
          WHERE application_run_id = ${input.applicationRunId} AND page_instance_id = ${input.pageInstanceId}
            AND form_repeat_group_id = ${input.group.formRepeatGroupId}
        `.execute(transaction);
        return nextReceipt;
      }
      await this.assertCurrentEntityRevision(transaction, input, input.receipt);
      await sql`
        INSERT INTO application_entity_bindings (
          id, account_id, candidate_id, application_run_id, page_instance_id, form_instance_id,
          form_repeat_group_id, structural_fingerprint, identity_kind, entity_type, binding_state,
          candidate_entity_id, candidate_entity_version, candidate_entity_revision, binding_version,
          confidence, confidence_bucket, evidence_categories, reason_codes, error_codes, created_at, updated_at
        ) VALUES (
          ${input.bindingId}, ${input.accountId}, ${input.candidateId}, ${input.applicationRunId}, ${input.pageInstanceId},
          ${input.formInstanceId}, ${input.group.formRepeatGroupId}, ${input.group.structuralFingerprint},
          ${input.group.identityKind}, ${input.group.entityType}, ${input.receipt.state}, ${input.receipt.candidateEntityId},
          ${input.receipt.candidateEntityVersion}, ${input.receipt.candidateEntityRevision}, ${input.receipt.bindingVersion},
          ${input.receipt.confidence}, ${input.receipt.confidenceBucket}, ${input.receipt.evidenceCategories}::text[],
          ${input.receipt.reasonCodes}::text[], ${input.receipt.errorCodes}::text[], ${input.createdAt}, ${input.createdAt}
        )
      `.execute(transaction);
      return input.receipt;
    });
  }

  private async assertCurrentEntityRevision(
    executor: Kysely<V2Database>,
    input: Parameters<RepeatableEntityRepository["saveBinding"]>[0],
    receipt: EntityBindingReceipt
  ): Promise<void> {
    if (!receipt.candidateEntityId) return;
    const found = await sql<EntityRow>`
      SELECT entity.id, entity.entity_type, entity.entity_version, entity.status, entity.display_order,
        coalesce(array_agg(DISTINCT canonical.canonical_key) FILTER (WHERE canonical.canonical_key IS NOT NULL), '{}'::text[]) AS canonical_keys,
        coalesce(array_agg(DISTINCT version.value_fingerprint) FILTER (WHERE version.value_fingerprint IS NOT NULL), '{}'::text[]) AS value_fingerprints
      FROM candidate_entities entity
      JOIN candidates candidate ON candidate.id = entity.candidate_id
      LEFT JOIN candidate_answers_current current_answer ON current_answer.candidate_id = entity.candidate_id AND current_answer.entity_id = entity.id
      LEFT JOIN candidate_answer_versions version ON version.id = current_answer.answer_version_id
      LEFT JOIN canonical_fields canonical ON canonical.id = current_answer.canonical_id
      WHERE entity.id = ${receipt.candidateEntityId} AND entity.candidate_id = ${input.candidateId}
        AND candidate.account_id = ${input.accountId} AND entity.status = 'ACTIVE'
      GROUP BY entity.id
    `.execute(executor);
    const entity = found.rows[0];
    if (!entity || Number(entity.entity_version) !== receipt.candidateEntityVersion ||
      revision(entity.id, Number(entity.entity_version), strings(entity.canonical_keys), strings(entity.value_fingerprints)) !== receipt.candidateEntityRevision) {
      throw new ConflictError("Candidate entity changed before the binding was saved.");
    }
  }

  async mutateEntity(input: Parameters<RepeatableEntityRepository["mutateEntity"]>[0]): Promise<CandidateEntityLifecycleResult> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`candidate-entity:${input.candidateId}:${input.idempotencyKey}`}))`.execute(transaction);
      const replay = await this.operation(transaction, input.candidateId, input.idempotencyKey);
      if (replay) {
        if (replay.request_fingerprint !== input.requestFingerprint) throw new IdempotencyConflictError("Entity operation key was reused.");
        return { candidateEntityId: replay.candidate_entity_id!, status: replay.result_status as "ACTIVE" | "REMOVED", entityVersion: numbers(replay.result_entity_versions)[replay.candidate_entity_id!]!, idempotentReplay: true };
      }
      const entity = await sql<{ entity_type: CandidateEntityType; status: "ACTIVE" | "REMOVED"; entity_version: number | string }>`
        SELECT entity.entity_type, entity.status, entity.entity_version FROM candidate_entities entity
        JOIN candidates candidate ON candidate.id = entity.candidate_id
        WHERE entity.id = ${input.candidateEntityId} AND entity.candidate_id = ${input.candidateId}
          AND candidate.account_id = ${input.accountId} AND candidate.status = 'ACTIVE' FOR UPDATE
      `.execute(transaction);
      if (!entity.rows[0]) throw new NotFoundError("Candidate entity was not found.");
      if (Number(entity.rows[0].entity_version) !== input.expectedEntityVersion) throw new ConflictError("Candidate entity changed before this operation.");
      const status = input.action === "REMOVE" ? "REMOVED" : "ACTIVE";
      const next = input.expectedEntityVersion + (entity.rows[0].status === status ? 0 : 1);
      if (next !== input.expectedEntityVersion) {
        await sql`UPDATE candidate_entities SET status = ${status}, entity_version = ${next}, updated_at = ${input.occurredAt}, removed_at = ${status === "REMOVED" ? input.occurredAt : null} WHERE id = ${input.candidateEntityId} AND entity_version = ${input.expectedEntityVersion}`.execute(transaction);
        await sql`INSERT INTO candidate_entity_versions (id, entity_id, version, attributes, source, created_at, supersedes_version_id)
          SELECT ${this.newId()}, ${input.candidateEntityId}, ${next}, ${JSON.stringify({ lifecycle: status })}::jsonb,
            ${`CANDIDATE_${input.action}`}, ${input.occurredAt}, previous.id FROM candidate_entity_versions previous
          WHERE previous.entity_id = ${input.candidateEntityId} AND previous.version = ${input.expectedEntityVersion}`.execute(transaction);
      }
      if (status === "REMOVED") await sql`UPDATE application_entity_bindings SET invalidated_at = ${input.occurredAt}, updated_at = ${input.occurredAt} WHERE candidate_id = ${input.candidateId} AND candidate_entity_id = ${input.candidateEntityId} AND invalidated_at IS NULL`.execute(transaction);
      const versions = { [input.candidateEntityId]: next };
      await this.insertOperation(transaction, input, entity.rows[0].entity_type, status, [], versions);
      return { candidateEntityId: input.candidateEntityId, status, entityVersion: next, idempotentReplay: false };
    });
  }

  async reorderEntities(input: Parameters<RepeatableEntityRepository["reorderEntities"]>[0]): Promise<CandidateEntityReorderResult> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`candidate-entity:${input.candidateId}:${input.idempotencyKey}`}))`.execute(transaction);
      const replay = await this.operation(transaction, input.candidateId, input.idempotencyKey);
      if (replay) {
        if (replay.request_fingerprint !== input.requestFingerprint) throw new IdempotencyConflictError("Entity operation key was reused.");
        return { entityType: replay.entity_type, orderedEntityIds: strings(replay.ordered_entity_ids), entityVersions: numbers(replay.result_entity_versions), idempotentReplay: true };
      }
      const rows = await sql<{ id: string; entity_version: number | string }>`SELECT entity.id, entity.entity_version FROM candidate_entities entity JOIN candidates candidate ON candidate.id = entity.candidate_id WHERE entity.candidate_id = ${input.candidateId} AND candidate.account_id = ${input.accountId} AND entity.entity_type = ${input.entityType} AND entity.status = 'ACTIVE' FOR UPDATE`.execute(transaction);
      if (rows.rows.length !== input.orderedEntityIds.length || input.orderedEntityIds.some((id) => !rows.rows.some((row) => row.id === id))) throw new ConflictError("Reorder must include every active entity exactly once.");
      const versions: Record<string, number> = {};
      for (const [order, entityId] of input.orderedEntityIds.entries()) {
        const current = Number(rows.rows.find((row) => row.id === entityId)!.entity_version);
        if (input.expectedEntityVersions[entityId] !== current) throw new ConflictError("Candidate entity changed before reorder.");
        const next = current + 1;
        await sql`UPDATE candidate_entities SET display_order = ${order}, entity_version = ${next}, updated_at = ${input.occurredAt} WHERE id = ${entityId} AND entity_version = ${current}`.execute(transaction);
        await sql`INSERT INTO candidate_entity_versions (id, entity_id, version, attributes, source, created_at, supersedes_version_id)
          SELECT ${this.newId()}, ${entityId}, ${next}, ${JSON.stringify({ displayOrder: order })}::jsonb, 'CANDIDATE_REORDER', ${input.occurredAt}, previous.id
          FROM candidate_entity_versions previous WHERE previous.entity_id = ${entityId} AND previous.version = ${current}`.execute(transaction);
        versions[entityId] = next;
      }
      await this.insertOperation(transaction, input, input.entityType, null, input.orderedEntityIds, versions);
      return { entityType: input.entityType, orderedEntityIds: input.orderedEntityIds, entityVersions: versions, idempotentReplay: false };
    });
  }

  private async operation(executor: Kysely<V2Database>, candidateId: string, idempotencyKey: string): Promise<OperationRow | null> {
    const found = await sql<OperationRow>`SELECT request_fingerprint, operation_type, entity_type, candidate_entity_id, ordered_entity_ids, result_entity_versions, result_status FROM candidate_entity_operation_receipts WHERE candidate_id = ${candidateId} AND idempotency_key = ${idempotencyKey}`.execute(executor);
    return found.rows[0] ?? null;
  }

  private async insertOperation(executor: Kysely<V2Database>, input: Parameters<RepeatableEntityRepository["mutateEntity"]>[0] | Parameters<RepeatableEntityRepository["reorderEntities"]>[0], entityType: CandidateEntityType, status: string | null, ordered: readonly string[], versions: Record<string, number>): Promise<void> {
    const entityId = "candidateEntityId" in input ? input.candidateEntityId : null;
    const operation = "action" in input ? input.action : "REORDER";
    await sql`INSERT INTO candidate_entity_operation_receipts (id, account_id, candidate_id, idempotency_key, request_fingerprint, operation_type, entity_type, candidate_entity_id, ordered_entity_ids, result_entity_versions, result_status, created_at)
      VALUES (${input.receiptId}, ${input.accountId}, ${input.candidateId}, ${input.idempotencyKey}, ${input.requestFingerprint}, ${operation}, ${entityType}, ${entityId}, ${ordered}::uuid[], ${JSON.stringify(versions)}::jsonb, ${status}, ${input.occurredAt})`.execute(executor);
  }
}
