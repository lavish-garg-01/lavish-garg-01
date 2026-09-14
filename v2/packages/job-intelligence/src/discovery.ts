import { createHash } from "node:crypto";
import { NotFoundError, ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import { ROLE_FAMILIES, WORK_MODES, type CandidateJobProfile, type CatalogJob, type RoleFamily, type WorkMode } from "./contracts.js";
import { evaluateAndRankJob, JOB_RANKING_POLICY_VERSION, type RankedJobEvaluation } from "./matching.js";
import { normalizedText, sha256 } from "./normalization.js";

export interface CatalogQuery {
  query: string | null;
  roleFamily: RoleFamily | null;
  workMode: WorkMode | null;
  countryCode: string | null;
  maximum: number;
}

export interface JobCatalogRepository {
  listDiscoverable(input: CatalogQuery): Promise<readonly CatalogJob[]>;
  findById(jobId: string): Promise<CatalogJob | null>;
}

export interface CandidateJobProfileProvider {
  getCandidateJobProfile(accountId: string, candidateId: string): Promise<CandidateJobProfile>;
}

export interface CandidateFacingJob {
  job: CatalogJob;
  evaluation: RankedJobEvaluation;
  freshness: { state: "FRESH" | "AGING" | "STALE"; verifiedAt: Date | null };
}

export interface JobDiscoveryPage {
  items: readonly CandidateFacingJob[];
  nextCursor: string | null;
  catalogTruncated: boolean;
  policyVersion: string;
}

const requestSchema = z.object({
  query: z.string().trim().max(200).nullable().default(null),
  roleFamily: z.enum(ROLE_FAMILIES).nullable().default(null),
  workMode: z.enum(WORK_MODES).nullable().default(null),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().default(null),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2_000).nullable().default(null)
}).strict();

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

function profileFingerprint(profile: CandidateJobProfile): string {
  return createHash("sha256").update(JSON.stringify(stable(profile))).digest("hex");
}

function encodeCursor(input: { offset: number; requestFingerprint: string }): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null, requestFingerprint: string): number {
  if (!cursor) return 0;
  try {
    const parsed = z.object({ offset: z.number().int().min(0).max(10_000), requestFingerprint: z.string().length(64) })
      .strict().parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.requestFingerprint !== requestFingerprint) throw new Error("cursor mismatch");
    return parsed.offset;
  } catch {
    throw new ValidationError("The job page cursor is invalid or belongs to different filters.");
  }
}

function freshness(job: CatalogJob, now: Date): CandidateFacingJob["freshness"] {
  const verified = job.lastVerifiedAt ?? job.lastSeenAt;
  const ageDays = Math.max(0, Math.floor((now.getTime() - verified.getTime()) / 86_400_000));
  return {
    state: job.status === "STALE" || ageDays > 14 ? "STALE" : ageDays > 3 ? "AGING" : "FRESH",
    verifiedAt: job.lastVerifiedAt
  };
}

/**
 * Distinct requisition identifiers remain distinct catalog records for audit and
 * lifecycle purposes. Candidate discovery, however, should not repeat an
 * otherwise identical posting merely because an ATS published several IDs for
 * the same company/title/location/description. This is deliberately stricter
 * than fuzzy dedupe: a materially different description remains visible.
 */
function presentationIdentity(job: CatalogJob): string {
  return sha256(JSON.stringify({
    company: job.normalizedCompanyName,
    title: normalizedText(job.title),
    location: normalizedText(job.locationText ?? ""),
    description: normalizedText(job.description),
    roleFamily: job.roleFamily,
    employmentType: job.employmentType,
    workMode: job.workMode,
    countries: [...job.countryCodes].sort()
  }));
}

function uniquePresentations(items: readonly CandidateFacingJob[]): CandidateFacingJob[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = presentationIdentity(item.job);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export class JobDiscoveryService {
  private static readonly MAXIMUM_CATALOG_CANDIDATES = 1_000;

  constructor(
    private readonly repository: JobCatalogRepository,
    private readonly profiles: CandidateJobProfileProvider,
    private readonly clock: Clock = systemClock
  ) {}

  async discover(input: {
    accountId: string;
    candidateId: string;
    query?: string | null;
    roleFamily?: RoleFamily | null;
    workMode?: WorkMode | null;
    countryCode?: string | null;
    limit?: number;
    cursor?: string | null;
  }): Promise<JobDiscoveryPage> {
    const request = requestSchema.parse({
      query: input.query ?? null, roleFamily: input.roleFamily ?? null,
      workMode: input.workMode ?? null, countryCode: input.countryCode ?? null,
      limit: input.limit ?? 20, cursor: input.cursor ?? null
    });
    const profile = await this.profiles.getCandidateJobProfile(input.accountId, input.candidateId);
    const fingerprint = createHash("sha256").update(JSON.stringify({
      candidateId: input.candidateId,
      query: request.query, roleFamily: request.roleFamily, workMode: request.workMode,
      countryCode: request.countryCode, profile: profileFingerprint(profile)
    })).digest("hex");
    const offset = decodeCursor(request.cursor, fingerprint);
    const catalog = await this.repository.listDiscoverable({
      query: request.query, roleFamily: request.roleFamily, workMode: request.workMode,
      countryCode: request.countryCode, maximum: JobDiscoveryService.MAXIMUM_CATALOG_CANDIDATES + 1
    });
    const now = this.clock.now();
    const eligible = uniquePresentations(catalog.slice(0, JobDiscoveryService.MAXIMUM_CATALOG_CANDIDATES)
      .map((job) => ({ job, evaluation: evaluateAndRankJob(job, profile, now), freshness: freshness(job, now) }))
      .filter((item) => item.evaluation.eligibility.state !== "INELIGIBLE")
      .sort((left, right) =>
        (right.evaluation.rankScore ?? -1) - (left.evaluation.rankScore ?? -1)
        || (right.job.lastVerifiedAt ?? right.job.lastSeenAt).getTime() - (left.job.lastVerifiedAt ?? left.job.lastSeenAt).getTime()
        || left.job.jobId.localeCompare(right.job.jobId)
      ));
    const items = eligible.slice(offset, offset + request.limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < eligible.length ? encodeCursor({ offset: nextOffset, requestFingerprint: fingerprint }) : null,
      catalogTruncated: catalog.length > JobDiscoveryService.MAXIMUM_CATALOG_CANDIDATES,
      policyVersion: items[0]?.evaluation.policyVersion ?? JOB_RANKING_POLICY_VERSION
    };
  }

  async detail(input: { accountId: string; candidateId: string; jobId: string }): Promise<CandidateFacingJob> {
    const profile = await this.profiles.getCandidateJobProfile(input.accountId, input.candidateId);
    const job = await this.repository.findById(z.string().uuid().parse(input.jobId));
    if (!job || !["ACTIVE", "STALE"].includes(job.status)) throw new NotFoundError("Job was not found.");
    const now = this.clock.now();
    const evaluation = evaluateAndRankJob(job, profile, now);
    if (evaluation.eligibility.state === "INELIGIBLE") throw new NotFoundError("Job was not found.");
    return { job, evaluation, freshness: freshness(job, now) };
  }

  async related(input: { accountId: string; candidateId: string; jobId: string; limit?: number }): Promise<JobDiscoveryPage> {
    const anchor = await this.detail(input);
    const page = await this.discover({
      accountId: input.accountId, candidateId: input.candidateId,
      roleFamily: anchor.job.roleFamily, limit: Math.min(20, (input.limit ?? 5) + 1)
    });
    const anchorPresentation = presentationIdentity(anchor.job);
    return {
      ...page,
      items: page.items.filter((item) =>
        item.job.jobId !== input.jobId && presentationIdentity(item.job) !== anchorPresentation
      ).slice(0, input.limit ?? 5)
    };
  }
}
