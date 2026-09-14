import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  CandidateSearchProfileService,
  CandidateSearchPreferencesSchema,
  JobIngestionService,
  JobDiscoveryService,
  JobLifecycleService,
  RawJobPostingSchema
} from "@job-hunter-v2/job-intelligence";
import { Kysely, PGliteDialect } from "kysely";
import {
  KyselyJobIngestionRepository,
  KyselyJobLifecycleRepository,
  KyselyJobCatalogRepository,
  KyselyCandidateSearchProfileRepository,
  migrateInitialSchema,
  migrateJobIntelligence,
  type SqlClient,
  type V2Database
} from "./index.js";

function rawPosting(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      type: "ATS_API" as const, identifier: "greenhouse:razorpay",
      url: "https://boards.greenhouse.io/razorpay", externalJobId: "827361",
      ingestionVersion: "greenhouse-v1", etag: null, lastModified: null
    },
    observedAt: new Date("2026-09-01T10:00:00.000Z"),
    rawContent: JSON.stringify({ id: 827361, title: "Senior Backend Engineer" }),
    job: {
      title: "Senior Backend Engineer", companyName: "Razorpay Private Limited",
      companyWebsiteDomain: "razorpay.com", description: "Build reliable Node.js APIs with PostgreSQL and AWS.",
      locationText: "Bengaluru, Karnataka, India", countryCodes: ["IN"], workMode: "HYBRID" as const,
      remoteCountryCodes: [], employmentType: "FULL_TIME" as const, minExperienceMonths: 36,
      maxExperienceMonths: 72, requiredSkills: ["Node JS", "Postgres"], preferredSkills: ["AWS"],
      minCompensationMinor: 200_000_000, maxCompensationMinor: 300_000_000,
      currencyCode: "INR", compensationPeriod: "YEAR" as const, sponsorshipAvailable: false,
      workAuthorizationCountryCodes: ["IN"], educationRequirement: "Bachelor's degree or equivalent experience",
      relocationRequired: false, nightShiftRequired: false, heavyTravelRequired: false,
      employmentBondRequired: false, ats: "GREENHOUSE",
      applicationUrl: "https://boards.greenhouse.io/razorpay/jobs/827361?utm_source=feed",
      postedAt: new Date("2026-08-30T00:00:00.000Z"), expiresAt: null,
      explicitlyClosed: false, explicitlyRemoved: false, ...overrides
    }
  };
}

function client(database: PGlite): SqlClient {
  const executor = (target: Pick<PGlite, "query" | "exec">) => ({
    query: async <Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
      const result = await target.query<Row>(text, values ? [...values] : undefined);
      return { rows: result.rows };
    },
    executeScript: async (text: string) => void (await target.exec(text))
  });
  return { ...executor(database), withTransaction: async (work) => database.transaction((tx) => work(executor(tx))) };
}

test("H1-H3 ingestion is replay-safe, update-aware, strongly deduplicated and provenance-preserving", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  assert.equal((await migrateJobIntelligence(migrations)).applied, true);
  assert.equal((await migrateJobIntelligence(migrations)).applied, false);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  let sequence = 0;
  const ids = () => `a1000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const service = new JobIngestionService(
    new KyselyJobIngestionRepository(kysely, ids),
    undefined,
    null,
    { now: () => new Date("2026-09-01T10:01:00.000Z") },
    ids
  );
  const firstPosting = RawJobPostingSchema.parse(rawPosting());
  const concurrent = await Promise.all([
    service.ingest({ posting: firstPosting, idempotencyKey: "job-ingest-first" }),
    service.ingest({ posting: firstPosting, idempotencyKey: "job-ingest-first" })
  ]);
  const first = concurrent.find((result) => !result.idempotentReplay);
  assert.ok(first);
  assert.equal(concurrent.filter((result) => result.idempotentReplay).length, 1);
  assert.equal(new Set(concurrent.map((result) => result.jobId)).size, 1);
  assert.deepEqual(
    { created: first.created, changed: first.changed, version: first.materialVersion, replay: first.idempotentReplay },
    { created: true, changed: true, version: 1, replay: false }
  );
  const replay = await service.ingest({ posting: firstPosting, idempotencyKey: "job-ingest-first" });
  assert.equal(replay.jobId, first.jobId);
  assert.equal(replay.idempotentReplay, true);
  const unchanged = await service.ingest({ posting: firstPosting, idempotencyKey: "job-ingest-unchanged" });
  assert.equal(unchanged.jobId, first.jobId);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.materialVersion, 1);

  const updatedPosting = RawJobPostingSchema.parse({
    ...rawPosting({ description: "Build reliable Node.js APIs with PostgreSQL, Redis and AWS." }),
    rawContent: JSON.stringify({ id: 827361, revision: 2 })
  });
  const updated = await service.ingest({ posting: updatedPosting, idempotencyKey: "job-ingest-updated" });
  assert.equal(updated.jobId, first.jobId);
  assert.equal(updated.changed, true);
  assert.equal(updated.materialVersion, 2);

  const secondSource = RawJobPostingSchema.parse({
    ...rawPosting(),
    source: {
      ...rawPosting().source,
      type: "IMPORTED_FEED",
      identifier: "trusted-feed",
      url: "https://feed.example/jobs",
      ingestionVersion: "feed-v1"
    },
    rawContent: JSON.stringify({ external: "827361", source: "feed" }),
    job: {
      ...rawPosting().job,
      applicationUrl: "https://careers.razorpay.com/jobs/827361"
    }
  });
  const deduped = await service.ingest({ posting: secondSource, idempotencyKey: "job-ingest-second-source" });
  assert.equal(deduped.jobId, first.jobId, "strong company + requisition identity should merge sources");

  const distinct = RawJobPostingSchema.parse({
    ...rawPosting(),
    source: { ...rawPosting().source, externalJobId: "827362" },
    rawContent: JSON.stringify({ id: 827362 }),
    job: { ...rawPosting().job, applicationUrl: "https://boards.greenhouse.io/razorpay/jobs/827362" }
  });
  const distinctResult = await service.ingest({ posting: distinct, idempotencyKey: "job-ingest-distinct-requisition" });
  assert.notEqual(distinctResult.jobId, first.jobId, "similar title must not merge a different requisition");

  const counts = await database.query<{ jobs: string; snapshots: string; sources: string }>(`
    SELECT
      (SELECT count(*)::text FROM jobs) AS jobs,
      (SELECT count(*)::text FROM job_source_snapshots) AS snapshots,
      (SELECT count(*)::text FROM job_sources) AS sources
  `);
  assert.deepEqual(counts.rows[0], { jobs: "2", snapshots: "4", sources: "2" });
  const provenance = await database.query<{ origin: string; count: string }>(`
    SELECT origin, count(*)::text AS count FROM job_fact_provenance
    WHERE job_id = '${first.jobId}' GROUP BY origin ORDER BY origin
  `);
  assert.equal(provenance.rows.some((row) => row.origin === "EXPLICIT_SOURCE_FACT"), true);
  assert.equal(provenance.rows.some((row) => row.origin === "DETERMINISTIC_DERIVATION"), true);
  const rawLeak = await database.query<{ leaked: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM job_source_snapshots
      WHERE raw_evidence::text LIKE '%Build reliable Node.js APIs%'
    ) AS leaked
  `);
  assert.equal(rawLeak.rows[0]?.leaked, false);
  const outbox = await database.query<{ payload: string }>(`SELECT payload_reference::text AS payload FROM outbox_events`);
  assert.equal(outbox.rows.some((row) => row.payload.includes("PostgreSQL")), false);
  await kysely.destroy();
});

test("H8 discovery filters before pagination and hard-hidden jobs cannot leak through detail or related", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  await migrateJobIntelligence(migrations);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  let sequence = 0;
  const ids = () => `d1000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const ingestion = new JobIngestionService(
    new KyselyJobIngestionRepository(kysely, ids), undefined, null,
    { now: () => new Date("2026-09-02T00:00:00.000Z") }, ids
  );
  const excluded = await ingestion.ingest({
    posting: RawJobPostingSchema.parse(rawPosting()), idempotencyKey: "discovery-excluded-job"
  });
  const eligibleOnePosting = RawJobPostingSchema.parse({
    ...rawPosting({
      companyName: "Acme Technologies", companyWebsiteDomain: "acme.example",
      title: "Backend Engineer", minExperienceMonths: 24, maxExperienceMonths: 60,
      applicationUrl: "https://jobs.acme.example/backend-1"
    }),
    source: { ...rawPosting().source, identifier: "greenhouse:acme", url: "https://boards.greenhouse.io/acme", externalJobId: "acme-1" },
    rawContent: JSON.stringify({ id: "acme-1" })
  });
  const eligibleOne = await ingestion.ingest({ posting: eligibleOnePosting, idempotencyKey: "discovery-eligible-job-1" });
  const eligibleTwoPosting = RawJobPostingSchema.parse({
    ...rawPosting({
      companyName: "Acme Technologies", companyWebsiteDomain: "acme.example",
      title: "Senior Backend Engineer II", applicationUrl: "https://jobs.acme.example/backend-2"
    }),
    source: { ...rawPosting().source, identifier: "greenhouse:acme", url: "https://boards.greenhouse.io/acme", externalJobId: "acme-2" },
    rawContent: JSON.stringify({ id: "acme-2" })
  });
  const eligibleTwo = await ingestion.ingest({ posting: eligibleTwoPosting, idempotencyKey: "discovery-eligible-job-2" });
  const auditFixturePosting = RawJobPostingSchema.parse({
    ...rawPosting({
      companyName: "Candidate Invisible Fixture", companyWebsiteDomain: "fixture.audit.example",
      title: "Backend Fixture", ats: "AUDIT_FIXTURE",
      applicationUrl: "https://jobs.audit.example/backend-fixture"
    }),
    source: { ...rawPosting().source, identifier: "audit:fixture", url: "https://jobs.audit.example", externalJobId: "fixture-1" },
    rawContent: JSON.stringify({ fixture: "candidate-invisible" })
  });
  const auditFixture = await ingestion.ingest({ posting: auditFixturePosting, idempotencyKey: "discovery-audit-fixture" });
  const catalogRepository = new KyselyJobCatalogRepository(kysely);
  const candidateCatalog = await catalogRepository.listDiscoverable({
    query: null, roleFamily: null, workMode: null, countryCode: null, maximum: 100
  });
  assert.equal(candidateCatalog.some((job) => job.jobId === auditFixture.jobId), false);
  assert.equal(await catalogRepository.findById(auditFixture.jobId), null);
  const candidateProfile = {
    preferences: CandidateSearchPreferencesSchema.parse({
      version: 1, targetRoleFamilies: ["BACKEND"], acceptableRoleFamilies: ["FULLSTACK"],
      preferredWorkModes: ["REMOTE", "HYBRID"], preferredCountryCodes: ["IN"],
      excludedCompanyNames: ["Razorpay"], minimumCompensationMinor: null,
      compensationCurrencyCode: null,
      dealBreakers: { mandatoryRelocation: true, nightShift: true, heavyTravel: true, employmentBond: true }
    }),
    facts: {
      currentRoleFamily: "BACKEND" as const, skills: ["nodejs", "postgresql"],
      totalExperienceMonths: 48, authorizedCountryCodes: ["IN"], sponsorshipRequiredCountryCodes: [],
      currentCountryCode: "IN", expectedCompensationMinor: null,
      expectedCompensationCurrencyCode: null, relocationWilling: false
    }
  };
  const discovery = new JobDiscoveryService(
    catalogRepository,
    { getCandidateJobProfile: async () => candidateProfile },
    { now: () => new Date("2026-09-02T00:00:00.000Z") }
  );
  const firstPage = await discovery.discover({ accountId: "account", candidateId: "candidate", limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.notEqual(firstPage.items[0]?.job.jobId, excluded.jobId);
  assert.ok(firstPage.nextCursor);
  const secondPage = await discovery.discover({
    accountId: "account", candidateId: "candidate", limit: 1, cursor: firstPage.nextCursor
  });
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(secondPage.items[0]?.job.jobId, excluded.jobId);
  assert.notEqual(secondPage.items[0]?.job.jobId, firstPage.items[0]?.job.jobId);
  await assert.rejects(
    discovery.detail({ accountId: "account", candidateId: "candidate", jobId: excluded.jobId }),
    /not found/i
  );
  const related = await discovery.related({ accountId: "account", candidateId: "candidate", jobId: eligibleOne.jobId, limit: 5 });
  assert.equal(related.items.some((item) => item.job.jobId === excluded.jobId), false);
  assert.equal(related.items.some((item) => item.job.jobId === eligibleTwo.jobId), true);
  await assert.rejects(
    discovery.discover({ accountId: "account", candidateId: "candidate", limit: 1, cursor: firstPage.nextCursor, workMode: "ONSITE" }),
    /cursor is invalid|different filters/i
  );
  await kysely.destroy();
});

test("H7 complete scans age conservatively, lifecycle is auditable, and fresh evidence reactivates", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  await migrateJobIntelligence(migrations);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  let sequence = 0;
  const ids = () => `c1000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const ingestion = new JobIngestionService(
    new KyselyJobIngestionRepository(kysely, ids), undefined, null,
    { now: () => new Date("2026-10-01T00:00:00.000Z") }, ids
  );
  const lifecycle = new JobLifecycleService(
    new KyselyJobLifecycleRepository(kysely, ids),
    { now: () => new Date("2026-10-01T00:00:00.000Z") }, ids
  );
  const initialPosting = RawJobPostingSchema.parse(rawPosting());
  const initial = await ingestion.ingest({ posting: initialPosting, idempotencyKey: "lifecycle-ingest-first" });
  const identity = await database.query<{ source_identity_key: string }>(`
    SELECT source_identity_key FROM job_source_job_states WHERE job_id = '${initial.jobId}'
  `);
  const sourceIdentityKey = identity.rows[0]?.source_identity_key.trim();
  assert.ok(sourceIdentityKey);

  const firstMiss = await lifecycle.recordSourceScan({
    sourceType: "ATS_API", sourceIdentifier: "greenhouse:razorpay",
    observedSourceIdentityKeys: [], complete: true,
    idempotencyKey: "lifecycle-scan-miss-1", observedAt: new Date("2026-09-10T00:00:00.000Z")
  });
  assert.equal(firstMiss.staleTransitionCount, 0);
  await lifecycle.recordSourceScan({
    sourceType: "ATS_API", sourceIdentifier: "greenhouse:razorpay",
    observedSourceIdentityKeys: [], complete: true,
    idempotencyKey: "lifecycle-scan-miss-2", observedAt: new Date("2026-09-11T00:00:00.000Z")
  });
  const thirdMiss = await lifecycle.recordSourceScan({
    sourceType: "ATS_API", sourceIdentifier: "greenhouse:razorpay",
    observedSourceIdentityKeys: [], complete: true,
    idempotencyKey: "lifecycle-scan-miss-3", observedAt: new Date("2026-09-12T00:00:00.000Z")
  });
  assert.equal(thirdMiss.staleTransitionCount, 1);
  let status = await database.query<{ status: string }>(`SELECT status FROM jobs WHERE id = '${initial.jobId}'`);
  assert.equal(status.rows[0]?.status, "STALE");

  const reactivatedPosting = RawJobPostingSchema.parse({ ...rawPosting(), observedAt: new Date("2026-09-13T00:00:00.000Z") });
  const reactivated = await ingestion.ingest({ posting: reactivatedPosting, idempotencyKey: "lifecycle-ingest-reactivate" });
  assert.equal(reactivated.status, "ACTIVE");
  status = await database.query<{ status: string }>(`SELECT status FROM jobs WHERE id = '${initial.jobId}'`);
  assert.equal(status.rows[0]?.status, "ACTIVE");

  const expiringPosting = RawJobPostingSchema.parse({
    ...rawPosting({ expiresAt: new Date("2026-09-14T00:00:00.000Z") }),
    observedAt: new Date("2026-09-13T01:00:00.000Z"),
    rawContent: JSON.stringify({ id: 827361, expires: "2026-09-14" })
  });
  await ingestion.ingest({ posting: expiringPosting, idempotencyKey: "lifecycle-ingest-expiring" });
  const expiryScan = await lifecycle.recordSourceScan({
    sourceType: "ATS_API", sourceIdentifier: "greenhouse:razorpay",
    observedSourceIdentityKeys: [sourceIdentityKey], complete: true,
    idempotencyKey: "lifecycle-scan-expiry", observedAt: new Date("2026-09-15T00:00:00.000Z")
  });
  assert.equal(expiryScan.expiredTransitionCount, 1);
  status = await database.query<{ status: string }>(`SELECT status FROM jobs WHERE id = '${initial.jobId}'`);
  assert.equal(status.rows[0]?.status, "EXPIRED");
  const replay = await lifecycle.recordSourceScan({
    sourceType: "ATS_API", sourceIdentifier: "greenhouse:razorpay",
    observedSourceIdentityKeys: [sourceIdentityKey], complete: true,
    idempotencyKey: "lifecycle-scan-expiry", observedAt: new Date("2026-09-15T00:00:00.000Z")
  });
  assert.equal(replay.idempotentReplay, true);
  const events = await database.query<{ from_status: string | null; to_status: string; reason_code: string }>(`
    SELECT from_status, to_status, reason_code FROM job_lifecycle_events
    WHERE job_id = '${initial.jobId}' ORDER BY observed_at, id
  `);
  assert.equal(events.rows.some((event) => event.to_status === "STALE" && event.reason_code === "REPEATED_COMPLETE_SCAN_MISS"), true);
  assert.equal(events.rows.some((event) => event.from_status === "STALE" && event.to_status === "ACTIVE"), true);
  assert.equal(events.rows.some((event) => event.to_status === "EXPIRED" && event.reason_code === "EXPLICIT_EXPIRY_REACHED"), true);
  await kysely.destroy();
});

test("H4 search preferences are versioned, tenant-owned, idempotent and OCC-safe", async () => {
  const database = new PGlite();
  const migrations = client(database);
  await migrateInitialSchema(migrations);
  await migrateJobIntelligence(migrations);
  const accountId = "10000000-0000-4000-8000-000000000001";
  const foreignAccountId = "10000000-0000-4000-8000-000000000002";
  const candidateId = "20000000-0000-4000-8000-000000000001";
  await database.exec(`
    INSERT INTO accounts (id, account_type) VALUES
      ('${accountId}', 'NORMAL'), ('${foreignAccountId}', 'NORMAL');
    INSERT INTO candidates (id, account_id, status) VALUES ('${candidateId}', '${accountId}', 'ACTIVE');
  `);
  const kysely = new Kysely<V2Database>({ dialect: new PGliteDialect({ pglite: database }) });
  let sequence = 0;
  const service = new CandidateSearchProfileService(
    new KyselyCandidateSearchProfileRepository(kysely),
    { now: () => new Date("2026-09-01T10:00:00.000Z") },
    () => `b1000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
  );
  assert.equal((await service.get(accountId, candidateId)).version, 0);
  const preferences = {
    version: 1 as const,
    targetRoleFamilies: ["BACKEND" as const], acceptableRoleFamilies: ["FULLSTACK" as const],
    preferredWorkModes: ["REMOTE" as const], preferredCountryCodes: ["IN"],
    excludedCompanyNames: ["Example Corp"], minimumCompensationMinor: 2_500_000_00,
    compensationCurrencyCode: "INR",
    dealBreakers: { mandatoryRelocation: true, nightShift: true, heavyTravel: true, employmentBond: true }
  };
  const saved = await service.save({
    accountId, candidateId, expectedVersion: 0, preferences, idempotencyKey: "search-profile-first"
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.idempotentReplay, false);
  const replay = await service.save({
    accountId, candidateId, expectedVersion: 0, preferences, idempotencyKey: "search-profile-first"
  });
  assert.equal(replay.version, 1);
  assert.equal(replay.idempotentReplay, true);
  await assert.rejects(
    service.save({ accountId, candidateId, expectedVersion: 0, preferences, idempotencyKey: "search-profile-stale" }),
    /changed after this screen/i
  );
  await assert.rejects(service.get(foreignAccountId, candidateId), /not found/i);
  const versions = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM candidate_search_profile_versions`);
  assert.equal(versions.rows[0]?.count, "1");
  const outbox = await database.query<{ payload: string }>(`
    SELECT payload_reference::text AS payload FROM outbox_events
    WHERE event_type = 'candidate.search_preferences_updated'
  `);
  assert.equal(outbox.rows.some((row) => row.payload.includes("Example Corp")), false);
  await kysely.destroy();
});
