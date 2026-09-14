import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { EntityBindingReceiptSchema, FormRepeatGroupEvidenceSchema } from "@job-hunter-v2/contracts";
import { migrateInitialSchema, migrateRepeatableEntityIntelligence, migrateVerifiedLearningLoop, type SqlClient, type V2Database } from "./index.js";
import { KyselyRepeatableEntityRepository } from "./repeatable-entity-repository.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({ rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows }),
    executeScript: async (text: string) => void (await target.exec(text))
  });
  return { ...executor(database), withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction))) };
}

const accountId = "91000000-0000-4000-8000-000000000001";
const candidateId = "91000000-0000-4000-8000-000000000002";
const entityA = "91000000-0000-4000-8000-000000000003";
const entityB = "91000000-0000-4000-8000-000000000004";

test("entity lifecycle preserves UUID identity, OCC, reorder and idempotent history", async () => {
  const database = new PGlite();
  const migration = client(database);
  await migrateInitialSchema(migration);
  await migrateVerifiedLearningLoop(migration);
  await migrateRepeatableEntityIntelligence(migration);
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES ('${accountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id) VALUES ('${candidateId}', '${accountId}');
    INSERT INTO candidate_entities (id, candidate_id, entity_type, status, created_at) VALUES
      ('${entityA}', '${candidateId}', 'EMPLOYMENT', 'ACTIVE', '2026-01-01T00:00:00Z'),
      ('${entityB}', '${candidateId}', 'EMPLOYMENT', 'ACTIVE', '2025-01-01T00:00:00Z');
    INSERT INTO candidate_entity_versions (id, entity_id, version, attributes, source) VALUES
      ('91000000-0000-4000-8000-000000000013', '${entityA}', 1, '{}', 'TEST'),
      ('91000000-0000-4000-8000-000000000014', '${entityB}', 1, '{}', 'TEST');
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const repository = new KyselyRepeatableEntityRepository(kysely);

  const before = await repository.listCandidateEntities({ accountId, candidateId, entityTypes: ["EMPLOYMENT"] });
  assert.deepEqual(before.map((entity) => entity.candidateEntityId), [entityA, entityB]);
  const reordered = await repository.reorderEntities({
    receiptId: "91000000-0000-4000-8000-000000000021", accountId, candidateId,
    entityType: "EMPLOYMENT", orderedEntityIds: [entityB, entityA],
    expectedEntityVersions: { [entityA]: 1, [entityB]: 1 }, idempotencyKey: "reorder:test:1",
    requestFingerprint: "a".repeat(64), occurredAt: new Date("2026-09-02T00:00:00Z")
  });
  assert.deepEqual(reordered.orderedEntityIds, [entityB, entityA]);
  assert.deepEqual(reordered.entityVersions, { [entityB]: 2, [entityA]: 2 });
  const replay = await repository.reorderEntities({
    receiptId: "91000000-0000-4000-8000-000000000022", accountId, candidateId,
    entityType: "EMPLOYMENT", orderedEntityIds: [entityB, entityA],
    expectedEntityVersions: { [entityA]: 1, [entityB]: 1 }, idempotencyKey: "reorder:test:1",
    requestFingerprint: "a".repeat(64), occurredAt: new Date("2026-09-02T00:00:01Z")
  });
  assert.equal(replay.idempotentReplay, true);

  const removed = await repository.mutateEntity({
    receiptId: "91000000-0000-4000-8000-000000000023", accountId, candidateId,
    candidateEntityId: entityA, action: "REMOVE", expectedEntityVersion: 2,
    idempotencyKey: "remove:test:1", requestFingerprint: "b".repeat(64), occurredAt: new Date("2026-09-02T00:01:00Z")
  });
  assert.deepEqual(removed, { candidateEntityId: entityA, status: "REMOVED", entityVersion: 3, idempotentReplay: false });
  const restored = await repository.mutateEntity({
    receiptId: "91000000-0000-4000-8000-000000000024", accountId, candidateId,
    candidateEntityId: entityA, action: "RESTORE", expectedEntityVersion: 3,
    idempotencyKey: "restore:test:1", requestFingerprint: "c".repeat(64), occurredAt: new Date("2026-09-02T00:02:00Z")
  });
  assert.equal(restored.candidateEntityId, entityA);
  assert.equal(restored.entityVersion, 4);

  await assert.rejects(repository.mutateEntity({
    receiptId: "91000000-0000-4000-8000-000000000025", accountId, candidateId,
    candidateEntityId: entityB, action: "REMOVE", expectedEntityVersion: 1,
    idempotencyKey: "remove:test:2", requestFingerprint: "d".repeat(64), occurredAt: new Date()
  }), /changed before/);

  const versions = await database.query<{ entity_id: string; count: string }>(`
    SELECT entity_id, count(*)::text AS count FROM candidate_entity_versions
    GROUP BY entity_id ORDER BY entity_id
  `);
  assert.deepEqual(versions.rows, [
    { entity_id: entityA, count: "4" },
    { entity_id: entityB, count: "2" }
  ]);
  await kysely.destroy();
});

test("a stale persisted binding is superseded value-free instead of replaying an obsolete entity", async () => {
  const database = new PGlite();
  const migration = client(database);
  await migrateInitialSchema(migration);
  await migrateVerifiedLearningLoop(migration);
  await migrateRepeatableEntityIntelligence(migration);
  const applicationId = "92000000-0000-4000-8000-000000000001";
  const runId = "92000000-0000-4000-8000-000000000002";
  const pageId = "92000000-0000-4000-8000-000000000003";
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES ('${accountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id) VALUES ('${candidateId}', '${accountId}');
    INSERT INTO candidate_entities (id, candidate_id, entity_type, status) VALUES ('${entityA}', '${candidateId}', 'EMPLOYMENT', 'ACTIVE');
    INSERT INTO candidate_entity_versions (id, entity_id, version, attributes, source) VALUES ('92000000-0000-4000-8000-000000000004', '${entityA}', 1, '{}', 'TEST');
    INSERT INTO applications (id, account_id, candidate_id, target_url, status) VALUES ('${applicationId}', '${accountId}', '${candidateId}', 'https://apply.example.test/job', 'IN_PROGRESS');
    INSERT INTO application_runs (id, application_id, protocol_version, status) VALUES ('${runId}', '${applicationId}', 1, 'ACTIVE');
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const repository = new KyselyRepeatableEntityRepository(kysely);
  const descriptor = (await repository.listCandidateEntities({ accountId, candidateId, entityTypes: ["EMPLOYMENT"] }))[0]!;
  const group = FormRepeatGroupEvidenceSchema.parse({
    schemaVersion: 1, formRepeatGroupId: "repeat:stable-a", identityKind: "STABLE_DOM",
    stableGroupKey: "employment-current", structuralFingerprint: "a".repeat(64),
    entityType: "EMPLOYMENT", semanticRole: "CURRENT", ordinalHint: 0, groupLabel: "Current employment"
  });
  const bound = EntityBindingReceiptSchema.parse({
    schemaVersion: 1, formRepeatGroupId: group.formRepeatGroupId, entityType: "EMPLOYMENT", state: "BOUND_HIGH",
    candidateEntityId: entityA, candidateEntityVersion: descriptor.entityVersion, candidateEntityRevision: descriptor.entityRevision,
    bindingVersion: 1, confidence: 0.96, confidenceBucket: "HIGH", evidenceCategories: ["UNIQUE_ENTITY_OF_TYPE"],
    reasonCodes: ["ENTITY_BINDING_DETERMINISTIC_HIGH"], errorCodes: [], valuePrivate: true, containsCandidateValue: false
  });
  const first = await repository.saveBinding({
    bindingId: "92000000-0000-4000-8000-000000000005", accountId, candidateId, applicationRunId: runId,
    pageInstanceId: pageId, formInstanceId: "form:stable-a", group, receipt: bound, createdAt: new Date("2026-09-02T00:00:00Z")
  });
  assert.equal(first.state, "BOUND_HIGH");

  const stale = EntityBindingReceiptSchema.parse({
    schemaVersion: 1, formRepeatGroupId: group.formRepeatGroupId, entityType: "EMPLOYMENT", state: "UNBOUND",
    candidateEntityId: null, candidateEntityVersion: null, candidateEntityRevision: null,
    bindingVersion: 1, confidence: 0, confidenceBucket: "NONE", evidenceCategories: [],
    reasonCodes: ["CANDIDATE_ENTITY_CHANGED_AFTER_BINDING"], errorCodes: ["ENTITY_BINDING_STALE"],
    valuePrivate: true, containsCandidateValue: false
  });
  const superseded = await repository.saveBinding({
    bindingId: "92000000-0000-4000-8000-000000000006", accountId, candidateId, applicationRunId: runId,
    pageInstanceId: pageId, formInstanceId: "form:stable-a", group, receipt: stale, createdAt: new Date("2026-09-02T00:01:00Z")
  });
  assert.equal(superseded.state, "UNBOUND");
  assert.equal(superseded.bindingVersion, 2);
  assert.equal((await repository.findBinding({ accountId, candidateId, applicationRunId: runId, pageInstanceId: pageId, formRepeatGroupId: group.formRepeatGroupId }))?.receipt.state, "UNBOUND");
  await repository.invalidateBindingsExcept({ accountId, candidateId, applicationRunId: runId, pageInstanceId: pageId, activeFormRepeatGroupIds: [], invalidatedAt: new Date("2026-09-02T00:02:00Z") });
  assert.equal(await repository.findBinding({ accountId, candidateId, applicationRunId: runId, pageInstanceId: pageId, formRepeatGroupId: group.formRepeatGroupId }), null);
  await kysely.destroy();
});
