import { createHash, randomUUID } from "node:crypto";
import { type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import { JOB_SOURCE_TYPES, type JobSourceType } from "./contracts.js";

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const SourceIdentityKeySchema = z.string().regex(/^[a-f0-9]{64}$/);

export interface JobSourceScanResult {
  sourceId: string;
  scanComplete: boolean;
  observedIdentityCount: number;
  missingIncrementedCount: number;
  staleTransitionCount: number;
  expiredTransitionCount: number;
  idempotentReplay: boolean;
}

export interface JobLifecycleRepository {
  recordSourceScan(input: {
    receiptId: string;
    sourceType: JobSourceType;
    sourceIdentifier: string;
    observedSourceIdentityKeys: readonly string[];
    complete: boolean;
    idempotencyKey: string;
    requestFingerprint: string;
    observedAt: Date;
    staleAfterMissingScans: number;
    staleAfterMilliseconds: number;
  }): Promise<JobSourceScanResult>;
}

export class JobLifecycleService {
  constructor(
    private readonly repository: JobLifecycleRepository,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  recordSourceScan(input: {
    sourceType: JobSourceType;
    sourceIdentifier: string;
    observedSourceIdentityKeys: readonly string[];
    complete: boolean;
    idempotencyKey: string;
    observedAt?: Date;
  }) {
    const sourceType = z.enum(JOB_SOURCE_TYPES).parse(input.sourceType);
    const sourceIdentifier = z.string().trim().min(1).max(240).parse(input.sourceIdentifier);
    const observedSourceIdentityKeys = [...new Set(input.observedSourceIdentityKeys.map((key) => SourceIdentityKeySchema.parse(key)))].sort();
    const complete = z.boolean().parse(input.complete);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const observedAt = input.observedAt ?? this.clock.now();
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      sourceType, sourceIdentifier, observedSourceIdentityKeys, complete, observedAt: observedAt.toISOString()
    })).digest("hex");
    return this.repository.recordSourceScan({
      receiptId: this.newId(), sourceType, sourceIdentifier, observedSourceIdentityKeys,
      complete, idempotencyKey, requestFingerprint, observedAt,
      staleAfterMissingScans: 3, staleAfterMilliseconds: 7 * 86_400_000
    });
  }
}
