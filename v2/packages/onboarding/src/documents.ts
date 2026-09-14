import { createHash } from "node:crypto";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { NotFoundError, ValidationError } from "@job-hunter-v2/domain";
import type { DocumentLifecycleStatus, ObjectStoragePort } from "./resume.js";

export const DOCUMENT_PURPOSES = [
  "MASTER_RESUME", "TAILORED_RESUME", "COVER_LETTER",
  "APPLICATION_ATTACHMENT", "DIAGNOSTIC"
] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

export interface DocumentApplicationUse {
  applicationId: string;
  applicationRunId: string;
  documentKind: "RESUME" | "COVER_LETTER";
  selectedAt: Date;
}

export interface CandidateDocument {
  documentId: string;
  candidateId: string;
  purpose: DocumentPurpose;
  documentVersion: number;
  status: DocumentLifecycleStatus;
  originalFileName: string | null;
  mimeType: string;
  byteSize: number;
  contentSha256: string;
  sourceDocumentId: string | null;
  jobId: string | null;
  applicationId: string | null;
  generationPolicyVersion: number | null;
  failureCode: string | null;
  isCurrentMaster: boolean;
  createdAt: Date;
  updatedAt: Date;
  readyAt: Date | null;
  applicationUses: readonly DocumentApplicationUse[];
}

export interface StoredCandidateDocument extends CandidateDocument {
  accountId: string;
  objectKey: string;
}

export interface CandidateDocumentRepository {
  list(input: { accountId: string; candidateId: string }): Promise<readonly CandidateDocument[]>;
  find(input: { accountId: string; candidateId: string; documentId: string }): Promise<StoredCandidateDocument | null>;
}

export class DocumentIntelligenceService {
  constructor(
    private readonly repository: CandidateDocumentRepository,
    private readonly storage: ObjectStoragePort
  ) {}

  list(accountId: string, candidateId: string): Promise<readonly CandidateDocument[]> {
    return this.repository.list({ accountId: UuidSchema.parse(accountId), candidateId: UuidSchema.parse(candidateId) });
  }

  async download(input: { accountId: string; candidateId: string; documentId: string }): Promise<{
    document: CandidateDocument;
    bytes: Uint8Array;
  }> {
    const stored = await this.repository.find({
      accountId: UuidSchema.parse(input.accountId),
      candidateId: UuidSchema.parse(input.candidateId),
      documentId: UuidSchema.parse(input.documentId)
    });
    if (!stored || ["UPLOADING", "QUARANTINED", "DELETED"].includes(stored.status)) {
      throw new NotFoundError("Document was not found for this candidate.");
    }
    const bytes = await this.storage.get(stored.objectKey);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== stored.byteSize || digest !== stored.contentSha256) {
      throw new ValidationError("The stored document failed its integrity check.", {
        reasonCode: "DOCUMENT_STORAGE_INTEGRITY_FAILED"
      });
    }
    return {
      document: {
        documentId: stored.documentId,
        candidateId: stored.candidateId,
        purpose: stored.purpose,
        documentVersion: stored.documentVersion,
        status: stored.status,
        originalFileName: stored.originalFileName,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        contentSha256: stored.contentSha256,
        sourceDocumentId: stored.sourceDocumentId,
        jobId: stored.jobId,
        applicationId: stored.applicationId,
        generationPolicyVersion: stored.generationPolicyVersion,
        failureCode: stored.failureCode,
        isCurrentMaster: stored.isCurrentMaster,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        readyAt: stored.readyAt,
        applicationUses: stored.applicationUses
      },
      bytes
    };
  }
}
