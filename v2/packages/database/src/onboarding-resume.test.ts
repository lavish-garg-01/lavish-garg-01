import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  AesGcmCandidatePayloadCipher,
  CandidateConfirmationService,
  DeterministicResumeCandidateExtractor,
  ResumeOnboardingService,
  type ObjectStoragePort,
  type ResumeTextExtractor
} from "@job-hunter-v2/onboarding";
import {
  CandidateTruthService,
  HmacCandidateValueFingerprinter
} from "@job-hunter-v2/candidate-truth";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyCandidateConfirmationRepository,
  KyselyCandidateTruthRepository,
  KyselyResumeRepository,
  migrateCandidateOnboardingBootstrap,
  migrateCandidateOnboardingConfirmation,
  migrateCandidateReviewOutcomeProofs,
  migrateCandidateAnswerReversals,
  migrateCandidateResumeIntelligence,
  migrateDocumentIntelligence,
  migrateCandidateScopePolicyVectors,
  migrateCandidateTruthMutationGuards,
  migrateCandidateTruthOntology,
  migrateInitialSchema,
  type SqlClient,
  type V2Database
} from "./index.js";

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await target.query<Row>(text, values ? [...values] : undefined);
      return { rows: result.rows };
    },
    executeScript: async (text: string) => void (await target.exec(text))
  });
  return {
    ...executor(database),
    withTransaction: async (work) => database.transaction((transaction) => work(executor(transaction)))
  };
}

class MemoryStorage implements ObjectStoragePort {
  readonly objects = new Map<string, Uint8Array>();
  async put(input: { objectKey: string; bytes: Uint8Array }): Promise<void> {
    this.objects.set(input.objectKey, input.bytes.slice());
  }
  async get(objectKey: string): Promise<Uint8Array> {
    const value = this.objects.get(objectKey);
    if (!value) throw new Error("missing object");
    return value.slice();
  }
  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
}

const accountId = "10000000-0000-4000-8000-000000000001";
const candidateId = "20000000-0000-4000-8000-000000000001";
const foreignAccountId = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-01T10:00:00.000Z");

function fakePdf(marker: string): Uint8Array {
  return Buffer.from(`%PDF-1.7\n${marker}\n%%EOF`, "utf8");
}

test("G2/G3 stores candidate-owned PDFs and encrypted, retry-safe review proposals", async () => {
  const database = new PGlite();
  const migration = client(database);
  await migrateInitialSchema(migration);
  await migrateCandidateTruthOntology(migration);
  await migrateCandidateTruthMutationGuards(migration);
  await migrateCandidateScopePolicyVectors(migration);
  await migrateCandidateReviewOutcomeProofs(migration);
  await migrateCandidateAnswerReversals(migration);
  await migrateCandidateOnboardingBootstrap(migration);
  const firstMigration = await migrateCandidateResumeIntelligence(migration);
  const replayMigration = await migrateCandidateResumeIntelligence(migration);
  await migrateCandidateOnboardingConfirmation(migration);
  await migrateDocumentIntelligence(migration);
  await migrateGlobalAnswerDefaults(migration);
  assert.equal(firstMigration.applied, true);
  assert.equal(replayMigration.applied, false);
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES
      ('${accountId}', 'NORMAL'), ('${foreignAccountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id, status) VALUES ('${candidateId}', '${accountId}', 'ACTIVE');
    INSERT INTO candidate_onboarding_states (
      candidate_id, account_id, stage, status, started_at, last_seen_at
    ) VALUES ('${candidateId}', '${accountId}', 'WELCOME', 'IN_PROGRESS', '${now.toISOString()}', '${now.toISOString()}');
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  const storage = new MemoryStorage();
  const hmac = new HmacCandidateValueFingerprinter("resume-hmac-secret-that-is-at-least-32-bytes", 1);
  let extractionText = [
    "Lavish Kumar", "lavish@example.com", "+91 9876543210", "TypeScript Node.js PostgreSQL",
    "E X P E R I E N C E", "ENGINEER, EXAMPLE LABS January 2024 – present"
  ].join("\n");
  const textExtractor: ResumeTextExtractor = {
    name: "TEST_PDF",
    version: "1",
    extract: async () => extractionText
  };
  let sequence = 0;
  const service = new ResumeOnboardingService(
    new KyselyResumeRepository(kysely, () => `90000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`),
    storage,
    textExtractor,
    new DeterministicResumeCandidateExtractor(),
    new AesGcmCandidatePayloadCipher(Buffer.alloc(32, 7), 1),
    hmac,
    { now: () => now },
    () => `80000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
  );
  const truth = new CandidateTruthService(new KyselyCandidateTruthRepository(kysely), hmac, { now: () => now });
  const confirmation = new CandidateConfirmationService(
    service,
    truth,
    new KyselyCandidateConfirmationRepository(
      kysely,
      () => `70000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
    ),
    hmac,
    { now: () => now },
    () => `60000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
  );

  const document = await service.upload({
    accountId, candidateId, fileName: "Lavish Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("first"), idempotencyKey: "upload-resume-first"
  });
  const uploadReplay = await service.upload({
    accountId, candidateId, fileName: "Lavish Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("first"), idempotencyKey: "upload-resume-first"
  });
  assert.equal(uploadReplay.documentId, document.documentId);
  assert.equal(document.status, "UPLOADED");
  const contentReplay = await service.upload({
    accountId, candidateId, fileName: "Same bytes, renamed.pdf", mimeType: "application/pdf",
    bytes: fakePdf("first"), idempotencyKey: "upload-resume-same-content"
  });
  assert.equal(contentReplay.documentId, document.documentId);
  assert.equal((await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM documents WHERE candidate_id = '${candidateId}'
  `)).rows[0]?.count, "1");
  await assert.rejects(
    service.upload({
      accountId, candidateId, fileName: "Lavish Resume.pdf", mimeType: "application/pdf",
      bytes: fakePdf("different bytes"), idempotencyKey: "upload-resume-first"
    }),
    /idempotency key was reused for another file/i
  );
  assert.equal(storage.objects.has(document.objectKey), true);
  const review = await service.extract({
    accountId, candidateId, documentId: document.documentId, idempotencyKey: "extract-resume-first"
  });
  assert.equal(review.extraction?.status, "COMPLETED");
  assert.equal(review.proposals.some((proposal) => proposal.canonicalKey === "EMAIL"), true);
  assert.equal(review.proposals.filter((proposal) => !proposal.entityType).every((proposal) => proposal.comparison === "NEW"), true);
  assert.equal(review.proposals.filter((proposal) => proposal.entityType).every((proposal) => proposal.comparison === "REPEATABLE_ENTITY_NEW"), true);
  assert.equal(review.proposals.every((proposal) => proposal.extractionSchemaVersion === 2), true);
  assert.equal(review.proposals.every((proposal) => /^[a-f0-9]{64}$/.test(proposal.evidenceSha256)), true);
  const retry = await service.extract({
    accountId, candidateId, documentId: document.documentId, idempotencyKey: "extract-resume-first"
  });
  assert.equal(retry.extraction?.extractionId, review.extraction?.extractionId);
  const semanticRetry = await service.extract({
    accountId, candidateId, documentId: document.documentId, idempotencyKey: "extract-resume-same-version"
  });
  assert.equal(semanticRetry.extraction?.extractionId, review.extraction?.extractionId);
  assert.equal((await database.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM resume_extraction_runs WHERE document_id = '${document.documentId}'
  `)).rows[0]?.count, "1");

  const decisions = review.proposals.map((proposal) => ({
    proposalId: proposal.proposalId,
    action: proposal.canonicalKey === "FULL_NAME"
      ? "CORRECT" as const
      : ["EMAIL", "RESUME"].includes(proposal.canonicalKey) || proposal.entityType
        ? "ACCEPT" as const : "SKIP" as const,
    ...(proposal.canonicalKey === "FULL_NAME" ? {
      correctedValue: {
        schemaVersion: 1 as const,
        dataClass: "CANDIDATE_PRIVATE" as const,
        kind: "STRING" as const,
        value: "Lavish K"
      }
    } : {})
  }));
  const confirmed = await confirmation.confirm({
    accountId, candidateId, documentId: document.documentId,
    idempotencyKey: "confirm-resume-first", decisions
  });
  assert.ok(confirmed.changeSetId);
  assert.equal(confirmed.accepted, 5);
  assert.equal(confirmed.corrected, 1);
  const confirmationReplay = await confirmation.confirm({
    accountId, candidateId, documentId: document.documentId,
    idempotencyKey: "confirm-resume-first", decisions
  });
  assert.equal(confirmationReplay.receiptId, confirmed.receiptId);
  assert.equal(confirmationReplay.idempotentReplay, true);

  const encrypted = await database.query<{ payload: string }>(`
    SELECT encode(encrypted_payload, 'escape') AS payload
    FROM resume_candidate_proposals
  `);
  assert.equal(encrypted.rows.some((row) => row.payload.includes("lavish@example.com")), false);
  const outbox = await database.query<{ payload: string }>(`
    SELECT payload_reference::text AS payload FROM outbox_events
  `);
  assert.equal(outbox.rows.some((row) => row.payload.includes("lavish@example.com")), false);
  await assert.rejects(
    service.getReview({ accountId: foreignAccountId, candidateId }),
    /not found/i
  );

  extractionText = [
    "Lavish Kumar", "other@example.com", "TypeScript",
    "E X P E R I E N C E", "SENIOR ENGINEER, EXAMPLE LABS January 2024 – present"
  ].join("\n");
  const second = await service.upload({
    accountId, candidateId, fileName: "Updated Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("second"), idempotencyKey: "upload-resume-second"
  });
  const secondReview = await service.extract({
    accountId, candidateId, documentId: second.documentId, idempotencyKey: "extract-resume-second"
  });
  assert.equal(
    secondReview.proposals.find((proposal) => proposal.canonicalKey === "EMAIL")?.comparison,
    "CONFLICT"
  );
  assert.equal(
    secondReview.proposals.find((proposal) => proposal.canonicalKey === "EMPLOYMENT_COMPANY")?.comparison,
    "REPEATABLE_ENTITY_MATCH"
  );
  assert.equal(
    secondReview.proposals.find((proposal) => proposal.canonicalKey === "EMPLOYMENT_TITLE")?.comparison,
    "CONFLICT"
  );
  assert.equal(
    secondReview.proposals.find((proposal) => proposal.canonicalKey === "EMPLOYMENT_DATE_RANGE")?.comparison,
    "REPEATABLE_ENTITY_MATCH"
  );
  const current = await new KyselyCandidateTruthRepository(kysely).listCurrentCandidates({
    accountId, candidateId, canonicalKey: "EMAIL", entityId: null, context: {}
  });
  assert.equal(current[0]?.normalizedValue.kind === "STRING" && current[0].normalizedValue.value, "lavish@example.com");

  const newerEmail = await truth.save({
    accountId, candidateId, canonicalKey: "EMAIL",
    normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "candidate-edited@example.com" },
    scopeType: "GLOBAL", source: "USER_MANUAL", commitPoint: "EXPLICIT_SAVE",
    expectedCurrentVersionId: current[0]?.answerVersionId ?? null,
    idempotencyKey: "candidate-edits-email-during-review"
  });
  assert.ok(newerEmail.answerVersionId);
  await assert.rejects(
    confirmation.confirm({
      accountId, candidateId, documentId: second.documentId,
      idempotencyKey: "confirm-stale-resume-comparison",
      decisions: secondReview.proposals.map((proposal) => ({
        proposalId: proposal.proposalId,
        action: proposal.canonicalKey === "EMAIL" ? "ACCEPT" as const : "SKIP" as const
      }))
    }),
    /changed|conflict|version/i
  );

  const stagedDocuments = await database.query<{ id: string; status: string }>(`
    SELECT id, status FROM documents
    WHERE candidate_id = '${candidateId}' AND purpose = 'MASTER_RESUME'
    ORDER BY created_at, id
  `);
  assert.deepEqual(
    stagedDocuments.rows.map((row) => [row.id, row.status]),
    [[document.documentId, "READY"], [second.documentId, "RECONCILING"]]
  );

  const skipSecond = secondReview.proposals.map((proposal) => ({
    proposalId: proposal.proposalId,
    action: "SKIP" as const
  }));
  const skippedSecond = await confirmation.confirm({
    accountId, candidateId, documentId: second.documentId,
    idempotencyKey: "confirm-resume-second-skip", decisions: skipSecond
  });
  assert.equal(skippedSecond.skipped, secondReview.proposals.length);
  const skipReplay = await confirmation.confirm({
    accountId, candidateId, documentId: second.documentId,
    idempotencyKey: "confirm-resume-second-skip", decisions: skipSecond
  });
  assert.equal(skipReplay.idempotentReplay, true);

  const afterSkip = await database.query<{ id: string; status: string }>(`
    SELECT id, status FROM documents
    WHERE candidate_id = '${candidateId}' AND purpose = 'MASTER_RESUME'
    ORDER BY created_at, id
  `);
  assert.deepEqual(
    afterSkip.rows.map((row) => [row.id, row.status]),
    [[document.documentId, "READY"], [second.documentId, "ARCHIVED"]]
  );
  const resumeAfterSkip = await new KyselyCandidateTruthRepository(kysely).listCurrentCandidates({
    accountId, candidateId, canonicalKey: "RESUME", entityId: null, context: {}
  });
  assert.equal(
    resumeAfterSkip[0]?.normalizedValue.kind === "FILE_REF" && resumeAfterSkip[0].normalizedValue.fileId,
    document.documentId
  );

  extractionText = "Lavish Kumar\nlatest@example.com\nTypeScript";
  const replacement = await service.upload({
    accountId, candidateId, fileName: "Accepted Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("accepted replacement"), idempotencyKey: "upload-resume-accepted"
  });
  const replacementReview = await service.extract({
    accountId, candidateId, documentId: replacement.documentId, idempotencyKey: "extract-resume-accepted"
  });
  const acceptReplacement = replacementReview.proposals.map((proposal) => ({
    proposalId: proposal.proposalId,
    action: proposal.canonicalKey === "RESUME" ? "ACCEPT" as const : "SKIP" as const
  }));
  await confirmation.confirm({
    accountId, candidateId, documentId: replacement.documentId,
    idempotencyKey: "confirm-resume-accepted", decisions: acceptReplacement
  });
  const afterAccept = await database.query<{ id: string; status: string }>(`
    SELECT id, status FROM documents
    WHERE candidate_id = '${candidateId}' AND purpose = 'MASTER_RESUME'
    ORDER BY created_at, id
  `);
  assert.equal(afterAccept.rows.find((row) => row.id === document.documentId)?.status, "SUPERSEDED");
  assert.equal(afterAccept.rows.find((row) => row.id === replacement.documentId)?.status, "READY");
  const resumeAfterAccept = await new KyselyCandidateTruthRepository(kysely).listCurrentCandidates({
    accountId, candidateId, canonicalKey: "RESUME", entityId: null, context: {}
  });
  assert.equal(
    resumeAfterAccept[0]?.normalizedValue.kind === "FILE_REF" && resumeAfterAccept[0].normalizedValue.fileId,
    replacement.documentId
  );

  const partialService = new ResumeOnboardingService(
    new KyselyResumeRepository(kysely, () => `91000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`),
    storage,
    textExtractor,
    {
      extract: async () => [
        {
          itemKey: "name",
          canonicalKey: "FULL_NAME",
          entityType: null,
          entityGroupKey: null,
          normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "Lavish K" },
          confidence: 0.99,
          reasonCodes: ["EXTRACTED_NAME"],
          sourceSection: "HEADER",
          sourceEvidence: "Lavish Kumar"
        },
        {
          itemKey: "unsafe-legal-inference",
          canonicalKey: "WORK_AUTHORIZATION",
          entityType: null,
          entityGroupKey: null,
          normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "BOOLEAN", value: true },
          confidence: 0.99,
          reasonCodes: ["UNSAFE_INFERENCE_TEST"],
          sourceSection: "OTHER",
          sourceEvidence: "Lavish Kumar"
        },
        {
          itemKey: "hallucinated-project",
          canonicalKey: "PROJECT_NAME",
          entityType: "PROJECT",
          entityGroupKey: "project-1",
          normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "Invented Project" },
          confidence: 1,
          reasonCodes: ["UNSUPPORTED_AI_VALUE_TEST"],
          sourceSection: "PROJECTS",
          sourceEvidence: "Invented Project"
        }
      ]
    },
    new AesGcmCandidatePayloadCipher(Buffer.alloc(32, 7), 1),
    hmac,
    { now: () => now },
    () => `92000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
  );
  const partialDocument = await partialService.upload({
    accountId, candidateId, fileName: "Partial Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("partial"), idempotencyKey: "upload-resume-partial"
  });
  const partialReview = await partialService.extract({
    accountId, candidateId, documentId: partialDocument.documentId, idempotencyKey: "extract-resume-partial"
  });
  assert.equal(partialReview.extraction?.status, "PARTIAL");
  assert.equal(partialReview.proposals.some((proposal) => proposal.canonicalKey === "FULL_NAME"), true);
  assert.equal(partialReview.proposals.some((proposal) => proposal.canonicalKey === "WORK_AUTHORIZATION"), false);
  assert.equal(partialReview.proposals.some((proposal) => proposal.canonicalKey === "PROJECT_NAME"), false);

  const retryDocument = await service.upload({
    accountId, candidateId, fileName: "Retry Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("retry"), idempotencyKey: "upload-resume-retry"
  });
  const failingService = new ResumeOnboardingService(
    new KyselyResumeRepository(kysely),
    storage,
    { name: "FAILING_TEST", version: "1", extract: async () => { throw new Error("temporary extractor failure"); } },
    new DeterministicResumeCandidateExtractor(),
    new AesGcmCandidatePayloadCipher(Buffer.alloc(32, 7), 1),
    hmac,
    { now: () => now }
  );
  await assert.rejects(
    failingService.extract({
      accountId, candidateId, documentId: retryDocument.documentId, idempotencyKey: "extract-resume-failure"
    }),
    /could not read this resume/i
  );
  assert.equal((await failingService.getReview({ accountId, candidateId })).extraction?.status, "FAILED");
  const failureSafety = await database.query<{ id: string; status: string }>(`
    SELECT id, status FROM documents
    WHERE candidate_id = '${candidateId}' AND status IN ('READY', 'FAILED') ORDER BY document_version
  `);
  assert.equal(failureSafety.rows.find((row) => row.id === replacement.documentId)?.status, "READY");
  assert.equal(failureSafety.rows.find((row) => row.id === retryDocument.documentId)?.status, "FAILED");
  const recovered = await service.extract({
    accountId, candidateId, documentId: retryDocument.documentId, idempotencyKey: "extract-resume-recovery"
  });
  assert.equal(recovered.extraction?.status, "COMPLETED");

  const lifecycle = await database.query<{ document_id: string; sequence: number; to_status: string }>(`
    SELECT document_id, sequence, to_status FROM document_lifecycle_events
    WHERE document_id IN ('${document.documentId}', '${replacement.documentId}', '${retryDocument.documentId}')
    ORDER BY document_id, sequence
  `);
  for (const id of [document.documentId, replacement.documentId, retryDocument.documentId]) {
    const events = lifecycle.rows.filter((row) => row.document_id === id);
    assert.deepEqual(events.map((event) => Number(event.sequence)), events.map((_, index) => index + 1));
  }

  await assert.rejects(
    service.upload({
      accountId, candidateId, fileName: "not.pdf", mimeType: "application/pdf",
      bytes: Buffer.from("not a pdf"), idempotencyKey: "upload-invalid-file"
    }),
    /not a complete PDF/
  );

  const ambiguousAccountId = "10000000-0000-4000-8000-000000000003";
  const ambiguousCandidateId = "20000000-0000-4000-8000-000000000003";
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES ('${ambiguousAccountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id, status) VALUES ('${ambiguousCandidateId}', '${ambiguousAccountId}', 'ACTIVE');
    INSERT INTO candidate_onboarding_states (
      candidate_id, account_id, stage, status, started_at, last_seen_at
    ) VALUES ('${ambiguousCandidateId}', '${ambiguousAccountId}', 'RESUME', 'IN_PROGRESS', '${now.toISOString()}', '${now.toISOString()}');
  `);
  const entityRepository = new KyselyCandidateConfirmationRepository(kysely);
  const ambiguousTruth = new CandidateTruthService(new KyselyCandidateTruthRepository(kysely), hmac, { now: () => now });
  for (const [index, entityId] of [
    "30000000-0000-4000-8000-000000000031",
    "30000000-0000-4000-8000-000000000032"
  ].entries()) {
    await entityRepository.ensureEntity({
      accountId: ambiguousAccountId, candidateId: ambiguousCandidateId, entityId,
      entityType: "EMPLOYMENT", sourceKey: `manual:duplicate-role-${index}`, createdAt: now
    });
    await ambiguousTruth.saveGroup({
      accountId: ambiguousAccountId, candidateId: ambiguousCandidateId,
      commitPoint: "EXPLICIT_SAVE", idempotencyKey: `duplicate-role-truth-${index}`,
      items: [
        { itemKey: "company", canonicalKey: "EMPLOYMENT_COMPANY", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "Example Labs" }, scopeType: "GLOBAL", entityId, source: "USER_MANUAL", expectedCurrentVersionId: null },
        { itemKey: "title", canonicalKey: "EMPLOYMENT_TITLE", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "Engineer" }, scopeType: "GLOBAL", entityId, source: "USER_MANUAL", expectedCurrentVersionId: null },
        { itemKey: "dates", canonicalKey: "EMPLOYMENT_DATE_RANGE", normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "DATE_RANGE", start: { isoDate: "2024-01-01", precision: "MONTH" }, end: null, current: true }, scopeType: "GLOBAL", entityId, source: "USER_MANUAL", expectedCurrentVersionId: null }
      ]
    });
  }
  extractionText = "Example Person\nEXPERIENCE\nENGINEER, EXAMPLE LABS January 2024 – present";
  const ambiguousDocument = await service.upload({
    accountId: ambiguousAccountId, candidateId: ambiguousCandidateId,
    fileName: "Ambiguous Resume.pdf", mimeType: "application/pdf",
    bytes: fakePdf("ambiguous"), idempotencyKey: "upload-ambiguous-resume"
  });
  const ambiguousReview = await service.extract({
    accountId: ambiguousAccountId, candidateId: ambiguousCandidateId,
    documentId: ambiguousDocument.documentId, idempotencyKey: "extract-ambiguous-resume"
  });
  assert.equal(
    ambiguousReview.proposals.filter((proposal) => proposal.entityType === "EMPLOYMENT")
      .every((proposal) => proposal.comparison === "AMBIGUOUS"),
    true
  );
  await kysely.destroy();
});
import { migrateGlobalAnswerDefaults } from "./index.js";
