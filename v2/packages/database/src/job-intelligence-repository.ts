import { randomUUID } from "node:crypto";
import type {
  JobIngestionRepository,
  JobIngestionResult,
  JobLifecycleStatus,
  NormalizedJob
} from "@job-hunter-v2/job-intelligence";
import { IdempotencyConflictError, ValidationError } from "@job-hunter-v2/domain";
import { sql, type Kysely } from "kysely";
import type { V2Database } from "./index.js";

interface ReceiptRow {
  request_fingerprint: string;
  job_id: string;
  job_source_id: string;
  snapshot_id: string | null;
  material_version: number;
  status: JobLifecycleStatus;
  created: boolean;
  changed: boolean;
}

interface JobRow {
  id: string;
  company_id: string;
  material_fingerprint: string;
  material_version: number;
  status: JobLifecycleStatus;
}

function replay(row: ReceiptRow): JobIngestionResult {
  return {
    jobId: row.job_id,
    sourceId: row.job_source_id,
    snapshotId: row.snapshot_id,
    materialVersion: row.material_version,
    status: row.status,
    created: row.created,
    changed: row.changed,
    idempotentReplay: true
  };
}

export class KyselyJobIngestionRepository implements JobIngestionRepository {
  constructor(
    private readonly database: Kysely<V2Database>,
    private readonly newId: () => string = randomUUID
  ) {}

  async ingest(input: Parameters<JobIngestionRepository["ingest"]>[0]): Promise<JobIngestionResult> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`job-ingestion:${input.idempotencyKey}`}))`.execute(transaction);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`job-source:${input.normalized.sourceIdentityKey}`}))`.execute(transaction);
      const priorReceipt = await sql<ReceiptRow>`
        SELECT request_fingerprint, job_id, job_source_id, snapshot_id, material_version,
               status, created, changed
        FROM job_ingestion_receipts
        WHERE idempotency_key = ${input.idempotencyKey}
      `.execute(transaction);
      if (priorReceipt.rows[0]) {
        if (priorReceipt.rows[0].request_fingerprint !== input.requestFingerprint) {
          throw new IdempotencyConflictError("Job ingestion idempotency key was reused for a different observation.");
        }
        return replay(priorReceipt.rows[0]);
      }

      await sql`SELECT pg_advisory_xact_lock(hashtext(${`company:${input.normalized.normalizedCompanyName}:${input.normalized.companyWebsiteDomain ?? ""}`}))`.execute(transaction);
      let company = await sql<{ id: string }>`
        SELECT id FROM companies
        WHERE normalized_name = ${input.normalized.normalizedCompanyName}
          AND website_domain IS NOT DISTINCT FROM ${input.normalized.companyWebsiteDomain}
        FOR UPDATE
      `.execute(transaction);
      if (!company.rows[0]) {
        const companyId = this.newId();
        await sql`
          INSERT INTO companies (id, canonical_name, normalized_name, website_domain, created_at)
          VALUES (${companyId}, ${input.normalized.canonicalCompanyName}, ${input.normalized.normalizedCompanyName},
                  ${input.normalized.companyWebsiteDomain}, ${input.observedAt})
        `.execute(transaction);
        company = { rows: [{ id: companyId }] };
      }
      const companyRow = company.rows[0];
      if (!companyRow) throw new Error("Canonical company creation did not return an identity.");
      const companyId = companyRow.id;

      let source = await sql<{ id: string }>`
        SELECT id FROM job_sources
        WHERE source_type = ${input.raw.source.type}
          AND source_identifier = ${input.raw.source.identifier}
        FOR UPDATE
      `.execute(transaction);
      if (!source.rows[0]) {
        const sourceId = this.newId();
        await sql`
          INSERT INTO job_sources (
            id, company_id, source_type, source_url, source_identifier, ingestion_version,
            active, last_checked_at, last_observed_at, etag, last_modified, created_at
          ) VALUES (
            ${sourceId}, ${companyId}, ${input.raw.source.type}, ${input.raw.source.url},
            ${input.raw.source.identifier}, ${input.raw.source.ingestionVersion}, true,
            ${input.observedAt}, ${input.observedAt}, ${input.raw.source.etag},
            ${input.raw.source.lastModified}, ${input.observedAt}
          )
        `.execute(transaction);
        source = { rows: [{ id: sourceId }] };
      } else {
        await sql`
          UPDATE job_sources SET
            company_id = coalesce(company_id, ${companyId}), source_url = ${input.raw.source.url},
            ingestion_version = ${input.raw.source.ingestionVersion}, active = true,
            last_checked_at = ${input.observedAt}, last_observed_at = ${input.observedAt},
            etag = ${input.raw.source.etag}, last_modified = ${input.raw.source.lastModified}
          WHERE id = ${source.rows[0].id}
        `.execute(transaction);
      }
      const sourceRow = source.rows[0];
      if (!sourceRow) throw new Error("Job source creation did not return an identity.");
      const sourceId = sourceRow.id;

      const sourceState = await sql<{ job_id: string; latest_raw_fingerprint: string }>`
        SELECT job_id, latest_raw_fingerprint FROM job_source_job_states
        WHERE job_source_id = ${sourceId} AND source_identity_key = ${input.normalized.sourceIdentityKey}
        FOR UPDATE
      `.execute(transaction);
      let jobId = sourceState.rows[0]?.job_id ?? null;
      if (!jobId) {
        const dedupeMatches = await sql<{ job_id: string }>`
          SELECT DISTINCT job_id FROM job_dedupe_keys
          WHERE dedupe_key = ANY(${input.normalized.strongDedupeKeys}::text[])
        `.execute(transaction);
        if (dedupeMatches.rows.length > 1) {
          throw new ValidationError("Strong job identity keys disagree; an operator must review this source.", {
            reasonCode: "JOB_DEDUPE_KEY_CONFLICT"
          });
        }
        jobId = dedupeMatches.rows[0]?.job_id ?? null;
      }

      let current: JobRow | null = null;
      if (jobId) {
        const result = await sql<JobRow>`
          SELECT id, company_id, material_fingerprint, material_version, status
          FROM jobs WHERE id = ${jobId} FOR UPDATE
        `.execute(transaction);
        current = result.rows[0] ?? null;
        if (!current) throw new Error("Job identity points to a missing canonical job.");
        if (current.company_id !== companyId) {
          throw new ValidationError("A strong job identity cannot merge jobs from different canonical companies.", {
            reasonCode: "JOB_DEDUPE_COMPANY_CONFLICT"
          });
        }
      }

      const created = current === null;
      jobId ??= this.newId();
      const changed = current ? current.material_fingerprint !== input.normalized.materialFingerprint : true;
      const statusChanged = current ? current.status !== input.normalized.lifecycleStatus : true;
      const materialVersion = current ? current.material_version + (changed ? 1 : 0) : 1;
      const closedAt = ["CLOSED", "EXPIRED", "REMOVED"].includes(input.normalized.lifecycleStatus)
        ? input.observedAt : null;

      if (created) {
        await sql`
          INSERT INTO jobs (
            id, company_id, canonical_title, normalized_title, description, role_family,
            seniority, country_code, country_codes, location_text, work_mode,
            remote_country_codes, employment_type, ats, application_url, status,
            material_fingerprint, material_version, first_seen_at, last_seen_at,
            last_verified_at, published_at, expires_at, closed_at, created_at, updated_at
          ) VALUES (
            ${jobId}, ${companyId}, ${input.normalized.canonicalTitle}, ${input.normalized.normalizedTitle},
            ${input.normalized.description}, ${input.normalized.roleFamily}, ${input.normalized.seniority},
            ${input.normalized.countryCodes[0] ?? null}, ${input.normalized.countryCodes},
            ${input.normalized.locationText}, ${input.normalized.workMode}, ${input.normalized.remoteCountryCodes},
            ${input.normalized.employmentType}, ${input.normalized.ats}, ${input.normalized.applicationUrl},
            ${input.normalized.lifecycleStatus}, ${input.normalized.materialFingerprint}, 1,
            ${input.observedAt}, ${input.observedAt}, ${input.observedAt}, ${input.normalized.postedAt},
            ${input.normalized.expiresAt}, ${closedAt}, ${input.observedAt}, ${input.observedAt}
          )
        `.execute(transaction);
      } else {
        await sql`
          UPDATE jobs SET
            canonical_title = ${input.normalized.canonicalTitle}, normalized_title = ${input.normalized.normalizedTitle},
            description = ${input.normalized.description}, role_family = ${input.normalized.roleFamily},
            seniority = ${input.normalized.seniority}, country_code = ${input.normalized.countryCodes[0] ?? null},
            country_codes = ${input.normalized.countryCodes}, location_text = ${input.normalized.locationText},
            work_mode = ${input.normalized.workMode}, remote_country_codes = ${input.normalized.remoteCountryCodes},
            employment_type = ${input.normalized.employmentType}, ats = ${input.normalized.ats},
            application_url = ${input.normalized.applicationUrl}, status = ${input.normalized.lifecycleStatus},
            material_fingerprint = ${input.normalized.materialFingerprint}, material_version = ${materialVersion},
            last_seen_at = GREATEST(last_seen_at, ${input.observedAt}),
            last_verified_at = GREATEST(coalesce(last_verified_at, ${input.observedAt}), ${input.observedAt}),
            published_at = coalesce(${input.normalized.postedAt}, published_at),
            expires_at = ${input.normalized.expiresAt}, closed_at = ${closedAt}, updated_at = ${input.observedAt}
          WHERE id = ${jobId}
        `.execute(transaction);
      }

      await this.replaceFacets(transaction, jobId, input.normalized);
      if (changed) {
        await this.replaceSkills(transaction, jobId, input.normalized);
        for (const [factKey, fact] of Object.entries(input.normalized.facts)) {
          await sql`
            INSERT INTO job_fact_provenance (
              id, job_id, material_version, fact_key, origin, evidence_path, evidence_hash,
              derived_by, derived_version, confidence, created_at
            ) VALUES (
              ${this.newId()}, ${jobId}, ${materialVersion}, ${factKey}, ${fact.origin},
              ${fact.evidencePath}, ${fact.evidenceHash}, ${fact.derivedBy},
              ${fact.derivedVersion}, ${fact.confidence}, ${input.observedAt}
            )
          `.execute(transaction);
        }
      }

      let snapshotId: string | null;
      if (!sourceState.rows[0] || sourceState.rows[0].latest_raw_fingerprint !== input.normalized.rawSourceFingerprint) {
        const existingSnapshot = await sql<{ id: string }>`
          SELECT id FROM job_source_snapshots
          WHERE job_source_id = ${sourceId} AND content_hash = ${input.normalized.rawSourceFingerprint}
        `.execute(transaction);
        snapshotId = existingSnapshot.rows[0]?.id ?? this.newId();
        if (!existingSnapshot.rows[0]) {
          await sql`
            INSERT INTO job_source_snapshots (
              id, job_id, job_source_id, content_hash, object_key, extracted_metadata,
              observed_at, source_identity_key, raw_source_fingerprint, material_fingerprint,
              ingestion_version, raw_evidence, material_version
            ) VALUES (
              ${snapshotId}, ${jobId}, ${sourceId}, ${input.normalized.rawSourceFingerprint},
              ${input.rawEvidenceObjectKey}, ${JSON.stringify({
                title: input.normalized.canonicalTitle,
                company: input.normalized.canonicalCompanyName,
                applicationUrl: input.normalized.applicationUrl
              })}::jsonb, ${input.observedAt}, ${input.normalized.sourceIdentityKey},
              ${input.normalized.rawSourceFingerprint}, ${input.normalized.materialFingerprint},
              ${input.raw.source.ingestionVersion}, ${JSON.stringify({
                sourceUrl: input.raw.source.url,
                externalJobId: input.raw.source.externalJobId,
                etag: input.raw.source.etag,
                lastModified: input.raw.source.lastModified,
                rawByteLength: Buffer.byteLength(input.raw.rawContent, "utf8")
              })}::jsonb, ${materialVersion}
            )
          `.execute(transaction);
        }
      } else {
        const latest = await sql<{ latest_snapshot_id: string | null }>`
          SELECT latest_snapshot_id FROM job_source_job_states
          WHERE job_source_id = ${sourceId} AND source_identity_key = ${input.normalized.sourceIdentityKey}
        `.execute(transaction);
        snapshotId = latest.rows[0]?.latest_snapshot_id ?? null;
      }

      await sql`
        INSERT INTO job_source_job_states (
          job_source_id, source_identity_key, job_id, external_job_id, application_url,
          latest_snapshot_id, latest_raw_fingerprint, missing_observation_count,
          last_observed_at, updated_at
        ) VALUES (
          ${sourceId}, ${input.normalized.sourceIdentityKey}, ${jobId}, ${input.raw.source.externalJobId},
          ${input.normalized.applicationUrl}, ${snapshotId}, ${input.normalized.rawSourceFingerprint},
          0, ${input.observedAt}, ${input.observedAt}
        )
        ON CONFLICT (job_source_id, source_identity_key) DO UPDATE SET
          job_id = excluded.job_id, external_job_id = excluded.external_job_id,
          application_url = excluded.application_url,
          latest_snapshot_id = coalesce(excluded.latest_snapshot_id, job_source_job_states.latest_snapshot_id),
          latest_raw_fingerprint = excluded.latest_raw_fingerprint,
          missing_observation_count = 0, last_observed_at = excluded.last_observed_at,
          updated_at = excluded.updated_at
      `.execute(transaction);

      for (const dedupeKey of input.normalized.strongDedupeKeys) {
        const existing = await sql<{ job_id: string }>`SELECT job_id FROM job_dedupe_keys WHERE dedupe_key = ${dedupeKey}`.execute(transaction);
        if (existing.rows[0] && existing.rows[0].job_id !== jobId) {
          throw new ValidationError("A strong job identity key already belongs to another canonical job.", {
            reasonCode: "JOB_DEDUPE_KEY_CONFLICT"
          });
        }
        await sql`
          INSERT INTO job_dedupe_keys (dedupe_key, job_id, confidence, created_at)
          VALUES (${dedupeKey}, ${jobId}, 'STRONG', ${input.observedAt})
          ON CONFLICT (dedupe_key) DO NOTHING
        `.execute(transaction);
      }

      if (statusChanged) {
        await sql`
          INSERT INTO job_lifecycle_events (
            id, job_id, from_status, to_status, reason_code, source_snapshot_id, observed_at, created_at
          ) VALUES (
            ${this.newId()}, ${jobId}, ${current?.status ?? null}, ${input.normalized.lifecycleStatus},
            ${created ? "FIRST_OBSERVATION" : input.normalized.lifecycleStatus === "ACTIVE" ? "SOURCE_REACTIVATED" : "EXPLICIT_SOURCE_STATUS"},
            ${snapshotId}, ${input.observedAt}, ${input.observedAt}
          )
        `.execute(transaction);
      }

      await sql`
        INSERT INTO job_ingestion_receipts (
          id, idempotency_key, request_fingerprint, job_id, job_source_id, snapshot_id,
          material_version, status, created, changed, created_at
        ) VALUES (
          ${input.operationId}, ${input.idempotencyKey}, ${input.requestFingerprint}, ${jobId},
          ${sourceId}, ${snapshotId}, ${materialVersion}, ${input.normalized.lifecycleStatus},
          ${created}, ${changed}, ${input.observedAt}
        )
      `.execute(transaction);
      await sql`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, payload_reference, created_at
        ) VALUES (
          ${this.newId()}, 'JOB', ${jobId}, ${created ? "job.created" : changed ? "job.materially_updated" : "job.observed"},
          ${JSON.stringify({ jobId, materialVersion, snapshotId, status: input.normalized.lifecycleStatus })}::jsonb,
          ${input.observedAt}
        )
      `.execute(transaction);
      return {
        jobId, sourceId, snapshotId, materialVersion, status: input.normalized.lifecycleStatus,
        created, changed, idempotentReplay: false
      };
    });
  }

  private async replaceFacets(database: Kysely<V2Database>, jobId: string, job: NormalizedJob): Promise<void> {
    await sql`
      INSERT INTO job_facets (
        job_id, min_experience_months, max_experience_months, min_compensation_minor,
        max_compensation_minor, currency_code, compensation_period, requires_sponsorship,
        sponsorship_available, night_shift_required, relocation_required, heavy_travel_required,
        employment_bond_required, evidence, work_authorization_country_codes, education_requirement
      ) VALUES (
        ${jobId}, ${job.minExperienceMonths}, ${job.maxExperienceMonths}, ${job.minCompensationMinor},
        ${job.maxCompensationMinor}, ${job.currencyCode}, ${job.compensationPeriod}, null,
        ${job.sponsorshipAvailable}, ${job.nightShiftRequired}, ${job.relocationRequired},
        ${job.heavyTravelRequired}, ${job.employmentBondRequired},
        ${JSON.stringify({ materialFingerprint: job.materialFingerprint })}::jsonb,
        ${job.workAuthorizationCountryCodes}, ${job.educationRequirement}
      )
      ON CONFLICT (job_id) DO UPDATE SET
        min_experience_months = excluded.min_experience_months,
        max_experience_months = excluded.max_experience_months,
        min_compensation_minor = excluded.min_compensation_minor,
        max_compensation_minor = excluded.max_compensation_minor,
        currency_code = excluded.currency_code,
        compensation_period = excluded.compensation_period,
        sponsorship_available = excluded.sponsorship_available,
        night_shift_required = excluded.night_shift_required,
        relocation_required = excluded.relocation_required,
        heavy_travel_required = excluded.heavy_travel_required,
        employment_bond_required = excluded.employment_bond_required,
        evidence = excluded.evidence,
        work_authorization_country_codes = excluded.work_authorization_country_codes,
        education_requirement = excluded.education_requirement
    `.execute(database);
  }

  private async replaceSkills(database: Kysely<V2Database>, jobId: string, job: NormalizedJob): Promise<void> {
    await sql`DELETE FROM job_skills WHERE job_id = ${jobId}`.execute(database);
    for (const skill of job.skills) {
      const row = await sql<{ id: number }>`
        INSERT INTO skills (canonical_name) VALUES (${skill.key})
        ON CONFLICT (canonical_name) DO UPDATE SET canonical_name = excluded.canonical_name
        RETURNING id
      `.execute(database);
      await sql`
        INSERT INTO job_skills (job_id, skill_id, requirement)
        VALUES (${jobId}, ${row.rows[0]?.id}, ${skill.requirement})
      `.execute(database);
    }
  }
}
