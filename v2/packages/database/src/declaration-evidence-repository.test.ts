import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { RecordDeclarationEvidenceRequest } from "@job-hunter-v2/contracts";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyDeclarationEvidenceRepository,
  migrateDeclarationConsentPolicy,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => ({
      rows: (await target.query<Row>(text, values ? [...values] : undefined)).rows
    }),
    executeScript: async (text: string) => target.exec(text).then(() => undefined)
  });
  return { ...executor(database), withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction))) };
}

const accountId = "10000000-0000-4000-8000-000000000170";
const candidateId = "20000000-0000-4000-8000-000000000170";
const applicationId = "30000000-0000-4000-8000-000000000170";
const runId = "40000000-0000-4000-8000-000000000170";

function evidence(eventType: RecordDeclarationEvidenceRequest["eventType"], eventId: string): RecordDeclarationEvidenceRequest {
  return {
    schemaVersion: 1, requestId: crypto.randomUUID(), evidenceEventId: eventId,
    applicationId, applicationRunId: runId, pageInstanceId: "50000000-0000-4000-8000-000000000170",
    formInstanceId: "form:declaration", fieldRuntimeId: "field:declaration", controlFingerprint: "control:declaration",
    descriptorFingerprint: "a".repeat(64), graphGuard: {
      pageInstanceId: "50000000-0000-4000-8000-000000000170", graphRevision: 2, graphFingerprint: "b".repeat(64)
    },
    declarationType: "ACCURACY_CERTIFICATION", semanticConfidence: 0.99, policyVersion: "O1-2026-09",
    policyDecision: "PREPARE_FOR_REVIEW", decisionFingerprint: "c".repeat(64), eventType,
    actionOrigin: eventType === "POLICY_DECIDED" ? "POLICY_ENGINE" : "COPILOT",
    operationId: eventType === "PREPARED" ? "60000000-0000-4000-8000-000000000170" : null,
    executionStatus: eventType === "PREPARED" ? "VERIFIED" : null,
    verificationStatus: eventType === "PREPARED" ? "VERIFIED" : null,
    failureCode: null, required: true, candidateModified: false, finalReviewState: "NOT_PRESENTED",
    checkpointId: null, occurredAt: "2026-09-10T10:00:00.000Z", valuePrivate: true, containsCandidateValue: false
  };
}

test("declaration evidence is application-authorized, decision-bound and replay-safe", async () => {
  const pg = new PGlite();
  const migration = client(pg);
  await migrateInitialSchema(migration);
  await migrateDeclarationConsentPolicy(migration);
  await pg.exec(`
    INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES ('${accountId}', 'TEST', false);
    INSERT INTO candidates (id, account_id) VALUES ('${candidateId}', '${accountId}');
    INSERT INTO applications (id, account_id, candidate_id, target_url, status)
      VALUES ('${applicationId}', '${accountId}', '${candidateId}', 'https://example.test/apply', 'IN_PROGRESS');
    INSERT INTO application_runs (id, application_id, protocol_version, status)
      VALUES ('${runId}', '${applicationId}', 1, 'ACTIVE');
  `);
  const database = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  const ids = [
    "70000000-0000-4000-8000-000000000170",
    "80000000-0000-4000-8000-000000000170"
  ];
  const repository = new KyselyDeclarationEvidenceRepository(database, () => ids.shift() ?? crypto.randomUUID());
  const decision = evidence("POLICY_DECIDED", "90000000-0000-4000-8000-000000000170");
  const decisionCommand = {
    accountId, candidateId, request: decision, idempotencyKey: `decision:${decision.decisionFingerprint}`,
    requestFingerprint: "d".repeat(64), recordedAt: new Date(decision.occurredAt)
  };
  assert.equal((await repository.record(decisionCommand)).idempotentReplay, false);
  assert.equal((await repository.record(decisionCommand)).idempotentReplay, true);

  const prepared = evidence("PREPARED", "a0000000-0000-4000-8000-000000000170");
  assert.equal((await repository.record({
    accountId, candidateId, request: prepared, idempotencyKey: `event:${prepared.evidenceEventId}`,
    requestFingerprint: "e".repeat(64), recordedAt: new Date(prepared.occurredAt)
  })).idempotentReplay, false);
  await pg.exec(`
    UPDATE applications SET status = 'SUBMITTED', submitted_at = now() WHERE id = '${applicationId}';
    UPDATE application_runs SET status = 'COMPLETED', ended_at = now() WHERE id = '${runId}';
  `);
  const submitted: RecordDeclarationEvidenceRequest = {
    ...evidence("POLICY_DECIDED", "b0000000-0000-4000-8000-000000000171"),
    eventType: "SUBMISSION_VERIFIED", actionOrigin: "SYSTEM", finalReviewState: "SUBMISSION_VERIFIED",
    checkpointId: "c0000000-0000-4000-8000-000000000171"
  };
  assert.equal((await repository.record({
    accountId, candidateId, request: submitted, idempotencyKey: `event:${submitted.evidenceEventId}`,
    requestFingerprint: "1".repeat(64), recordedAt: new Date(submitted.occurredAt)
  })).idempotentReplay, false);
  await assert.rejects(repository.record({ ...decisionCommand, requestFingerprint: "f".repeat(64) }), /different input/);
  await assert.rejects(pg.exec(`UPDATE application_declaration_evidence SET required = false WHERE id = '70000000-0000-4000-8000-000000000170'`), /append-only/);
  await database.destroy();
});

test("declaration events without their exact policy decision are rejected", async () => {
  const pg = new PGlite();
  const migration = client(pg);
  await migrateInitialSchema(migration);
  await migrateDeclarationConsentPolicy(migration);
  await pg.exec(`
    INSERT INTO accounts (id, account_type, contributes_to_global_learning) VALUES ('${accountId}', 'TEST', false);
    INSERT INTO candidates (id, account_id) VALUES ('${candidateId}', '${accountId}');
    INSERT INTO applications (id, account_id, candidate_id, target_url, status)
      VALUES ('${applicationId}', '${accountId}', '${candidateId}', 'https://example.test/apply', 'IN_PROGRESS');
    INSERT INTO application_runs (id, application_id, protocol_version, status)
      VALUES ('${runId}', '${applicationId}', 1, 'ACTIVE');
  `);
  const database = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: pg }) });
  const repository = new KyselyDeclarationEvidenceRepository(database);
  const prepared = evidence("PREPARED", "b0000000-0000-4000-8000-000000000170");
  await assert.rejects(repository.record({
    accountId, candidateId, request: prepared, idempotencyKey: `event:${prepared.evidenceEventId}`,
    requestFingerprint: "a".repeat(64), recordedAt: new Date(prepared.occurredAt)
  }), /no matching policy decision/);
  await database.destroy();
});
