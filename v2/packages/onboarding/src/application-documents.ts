import { createHash, randomUUID } from "node:crypto";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import type { ObjectStoragePort } from "./resume.js";

export type ApplicationDocumentKind = "RESUME" | "COVER_LETTER";
export interface ApplicationDocumentSelection {
  selectionId: string;
  documentId: string;
  documentKind: ApplicationDocumentKind;
  fileName: string;
  mimeType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  byteSize: number;
  contentSha256: string;
  objectKey: string;
  selectionSource: "TAILORED" | "MASTER" | "APPROVED_COVER_LETTER";
  idempotentReplay: boolean;
}

export interface ApplicationDocumentRepository {
  resolve(input: {
    selectionId: string; accountId: string; candidateId: string; applicationId: string;
    applicationRunId: string; jobId: string | null; documentKind: ApplicationDocumentKind;
    selectedAt: Date;
  }): Promise<ApplicationDocumentSelection | null>;
  recordUpload(input: {
    evidenceId: string; accountId: string; candidateId: string; applicationId: string;
    applicationRunId: string; selectionId: string; documentId: string; operationId: string;
    fieldKey: string; outcome: "VERIFIED" | "FAILED" | "SKIPPED"; reasonCode: string;
    observedFileCount: number | null; requestFingerprint: string; observedAt: Date;
  }): Promise<{ evidenceId: string; idempotentReplay: boolean }>;
}

export interface ResolvedApplicationDocument extends Omit<ApplicationDocumentSelection, "objectKey"> {
  bytesBase64: string;
}

export class ApplicationDocumentService {
  constructor(
    private readonly repository: ApplicationDocumentRepository,
    private readonly storage: ObjectStoragePort,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async resolve(input: {
    accountId: string; candidateId: string; applicationId: string; applicationRunId: string;
    jobId: string | null; documentKind: ApplicationDocumentKind;
  }): Promise<ResolvedApplicationDocument | null> {
    const parsed = {
      accountId: UuidSchema.parse(input.accountId), candidateId: UuidSchema.parse(input.candidateId),
      applicationId: UuidSchema.parse(input.applicationId), applicationRunId: UuidSchema.parse(input.applicationRunId),
      jobId: input.jobId ? UuidSchema.parse(input.jobId) : null,
      documentKind: input.documentKind
    };
    const selection = await this.repository.resolve({ ...parsed, selectionId: this.newId(), selectedAt: this.clock.now() });
    if (!selection) return null;
    const bytes = await this.storage.get(selection.objectKey);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== selection.contentSha256 || bytes.byteLength !== selection.byteSize) {
      throw new ValidationError("The selected application document failed its integrity check.", {
        reasonCode: "DOCUMENT_STORAGE_INTEGRITY_FAILED"
      });
    }
    return {
      selectionId: selection.selectionId,
      documentId: selection.documentId,
      documentKind: selection.documentKind,
      fileName: selection.fileName,
      mimeType: selection.mimeType,
      byteSize: selection.byteSize,
      contentSha256: selection.contentSha256,
      selectionSource: selection.selectionSource,
      idempotentReplay: selection.idempotentReplay,
      bytesBase64: Buffer.from(bytes).toString("base64")
    };
  }

  recordUpload(input: {
    accountId: string; candidateId: string; applicationId: string; applicationRunId: string;
    selectionId: string; documentId: string; operationId: string; fieldKey: string;
    outcome: "VERIFIED" | "FAILED" | "SKIPPED"; reasonCode: string; observedFileCount: number | null;
  }) {
    const command = {
      accountId: UuidSchema.parse(input.accountId), candidateId: UuidSchema.parse(input.candidateId),
      applicationId: UuidSchema.parse(input.applicationId), applicationRunId: UuidSchema.parse(input.applicationRunId),
      selectionId: UuidSchema.parse(input.selectionId), documentId: UuidSchema.parse(input.documentId),
      operationId: UuidSchema.parse(input.operationId),
      fieldKey: input.fieldKey.trim(), outcome: input.outcome, reasonCode: input.reasonCode.trim(),
      observedFileCount: input.observedFileCount, observedAt: this.clock.now()
    };
    if (!command.fieldKey || command.fieldKey.length > 240 || !/^[A-Z][A-Z0-9_]{0,119}$/.test(command.reasonCode)) {
      throw new ValidationError("Document upload evidence is malformed.");
    }
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      candidateId: command.candidateId, applicationId: command.applicationId,
      applicationRunId: command.applicationRunId, selectionId: command.selectionId,
      documentId: command.documentId, operationId: command.operationId,
      fieldKey: command.fieldKey, outcome: command.outcome,
      reasonCode: command.reasonCode, observedFileCount: command.observedFileCount
    })).digest("hex");
    return this.repository.recordUpload({ ...command, evidenceId: this.newId(), requestFingerprint });
  }
}
