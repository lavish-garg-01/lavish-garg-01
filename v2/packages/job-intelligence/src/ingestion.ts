import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { IdempotencyConflictError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import { NormalizedJobSchema, RawJobPostingSchema, type JobLifecycleStatus, type NormalizedJob, type RawJobPosting } from "./contracts.js";
import { normalizeRawJob, sha256 } from "./normalization.js";

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);

export interface JobIngestionResult {
  jobId: string;
  sourceId: string;
  snapshotId: string | null;
  materialVersion: number;
  status: JobLifecycleStatus;
  created: boolean;
  changed: boolean;
  idempotentReplay: boolean;
}

export interface JobIngestionRepository {
  ingest(input: {
    operationId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    raw: RawJobPosting;
    normalized: NormalizedJob;
    observedAt: Date;
    rawEvidenceObjectKey: string | null;
  }): Promise<JobIngestionResult>;
}

export interface JobRawEvidenceStore {
  put(input: { objectKey: string; content: string; contentType: string }): Promise<void>;
}

export class FileSystemJobRawEvidenceStore implements JobRawEvidenceStore {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private path(objectKey: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(objectKey)) throw new Error("Raw job evidence key is invalid.");
    const path = resolve(this.root, objectKey);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) throw new Error("Raw job evidence path escaped its root.");
    return path;
  }
  async put(input: { objectKey: string; content: string }): Promise<void> {
    const target = this.path(input.objectKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, input.content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }
}

export interface JobNormalizer {
  readonly name: string;
  readonly version: string;
  normalize(input: RawJobPosting): Promise<NormalizedJob> | NormalizedJob;
}

export class DeterministicJobNormalizer implements JobNormalizer {
  readonly name = "DETERMINISTIC_JOB_NORMALIZER";
  readonly version = "H-1";
  normalize(input: RawJobPosting): NormalizedJob { return normalizeRawJob(input); }
}

export class JobIngestionService {
  constructor(
    private readonly repository: JobIngestionRepository,
    private readonly normalizer: JobNormalizer = new DeterministicJobNormalizer(),
    private readonly evidenceStore: JobRawEvidenceStore | null = null,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async ingest(input: { posting: RawJobPosting; idempotencyKey: string }): Promise<JobIngestionResult> {
    const posting = RawJobPostingSchema.parse(input.posting);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    if (posting.observedAt > new Date(this.clock.now().getTime() + 5 * 60_000)) {
      throw new IdempotencyConflictError("A job observation cannot be recorded in the future.");
    }
    const normalized = NormalizedJobSchema.parse(await this.normalizer.normalize(posting));
    const rawEvidenceObjectKey = this.evidenceStore
      ? `job-source/${normalized.rawSourceFingerprint.slice(0, 2)}/${normalized.rawSourceFingerprint}.source`
      : null;
    if (rawEvidenceObjectKey && this.evidenceStore) {
      await this.evidenceStore.put({
        objectKey: rawEvidenceObjectKey,
        content: posting.rawContent,
        contentType: "text/plain; charset=utf-8"
      });
    }
    const requestFingerprint = sha256(JSON.stringify({
      sourceIdentityKey: normalized.sourceIdentityKey,
      rawSourceFingerprint: normalized.rawSourceFingerprint,
      observedAt: posting.observedAt.toISOString(),
      normalizer: `${this.normalizer.name}:${this.normalizer.version}`
    }));
    return this.repository.ingest({
      operationId: this.newId(), idempotencyKey, requestFingerprint,
      raw: posting, normalized, observedAt: posting.observedAt, rawEvidenceObjectKey
    });
  }
}
