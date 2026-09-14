import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { diceCoefficient, normalizeText } from "../utils/textSimilarity.js";
import {
    buildCutshortSearchUrls,
    buildHiristSearchUrls,
    buildInstahyreSearchUrls,
    buildNaukriSearchUrls,
    buildWellfoundSearchUrls,
    enrichJobDetails,
    scrapeJobListings
} from "./firecrawl.js";
import { extractJobTags } from "../utils/jobTags.js";
import { isIndiaLocation, locationLabel } from "../utils/indiaLocation.js";
import { normalizeCompanyDomain } from "../utils/companyDomain.js";
import { CAREER_PROFILE_DEFINITIONS, classifyJobTitle, searchTermsForCareerProfiles } from "./roleTaxonomy.js";
import { adaptiveSourceSelection, ingestionHistory } from "./ingestionScheduler.js";
import {
    jobMatchFingerprint,
    jobPostingSeriesKey,
    normalizeJobForRegistry,
    rawJobSnapshot
} from "./jobNormalizer.js";
import { observeJobAvailable } from "./jobLifecycle.js";

const execAsync = promisify(exec);
const GLOBAL_CAREER_PROFILES = Object.freeze(CAREER_PROFILE_DEFINITIONS.map((profile) => profile.key));
const GLOBAL_SEARCH_TITLES = Object.freeze([
    env.targetTitles[0] || "software engineer",
    env.targetTitles[1] || "backend engineer",
    "data engineer",
    "product manager"
]);

const AGENCY_PATTERN =
    /\b(consultancy|consultancies|staffing|manpower|recruitment\s+agency|hiring\s+agency|talent\s+solutions\s+pvt|hr\s+services)\b/i;

function slugify(value = "") {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 80);
}

export function canonicalJobUrl(value = "") {
    try {
        const url = new URL(String(value).trim());
        url.hash = "";
        url.hostname = url.hostname.toLowerCase();
        url.pathname = url.pathname.replace(/\/+$/, "") || "/";
        for (const key of [...url.searchParams.keys()]) {
            if (/^(?:utm_|trk|tracking|ref|source)/i.test(key)) url.searchParams.delete(key);
        }
        url.searchParams.sort();
        return url.href.replace(/\/$/, "");
    } catch { return String(value || "").trim(); }
}

function fingerprintText(value = "") {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

export function jobContentFingerprint(job = {}) {
    return crypto.createHash("sha256").update([
        fingerprintText(job.title),
        fingerprintText(job.location),
        fingerprintText(job.description)
    ].join("\n")).digest("hex").slice(0, 32);
}

function findExistingJobByUrl(url, db = getDb()) {
    const exact = db.prepare(`SELECT id, company_id, posted_at, title, location, description, yoe_min,
        status, url, source, content_fingerprint, match_fingerprint, match_version,
        lifecycle_status, explicit_deadline, last_verified_at, next_check_at, lifecycle_reason,
        lifecycle_confidence, closed_at, closure_evidence_source, created_at
        FROM jobs WHERE url = ? LIMIT 1`).get(url);
    if (exact) return exact;
    const canonical = canonicalJobUrl(url);
    const indexed = db.prepare(`SELECT id, company_id, posted_at, title, location, description, yoe_min,
        status, url, source, content_fingerprint, match_fingerprint, match_version,
        lifecycle_status, explicit_deadline, last_verified_at, next_check_at, lifecycle_reason,
        lifecycle_confidence, closed_at, closure_evidence_source, created_at
        FROM jobs WHERE canonical_url = ? LIMIT 1`).get(canonical);
    if (indexed) return indexed;
    const legacy = db.prepare(`SELECT id, company_id, posted_at, title, location, description, yoe_min,
        status, url, source, content_fingerprint, match_fingerprint, match_version,
        lifecycle_status, explicit_deadline, last_verified_at, next_check_at, lifecycle_reason,
        lifecycle_confidence, closed_at, closure_evidence_source, created_at FROM jobs
        WHERE canonical_url IS NULL ORDER BY created_at DESC LIMIT 2000`)
        .all().find((job) => canonicalJobUrl(job.url) === canonical) || null;
    if (legacy) db.prepare("UPDATE jobs SET canonical_url = ? WHERE id = ?").run(canonical, legacy.id);
    return legacy;
}

function hashJob({ source, company, title, url }) {
    return crypto
        .createHash("sha256")
        .update([source, company, title, canonicalJobUrl(url)].join("|").toLowerCase())
        .digest("hex")
        .slice(0, 32);
}

export function normalizeCompanyScore(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    const normalized = parsed <= 5 ? parsed * 20 : parsed;
    return normalized <= 100 ? Number(normalized.toFixed(1)) : null;
}

function upsertCompany({ name, domain = null, atsType = "unknown", atsSlug = null, overallScore = null, scoreSource = null }) {
    const db = getDb();
    const id = slugify(name) || crypto.randomUUID();
    const normalizedDomain = normalizeCompanyDomain(domain);
    db.prepare(
        `
        INSERT INTO companies (id, name, domain, ats_type, ats_slug, overall_score, score_source, score_updated_at)
        VALUES (@id, @name, @domain, @atsType, @atsSlug, @overallScore, @scoreSource,
                CASE WHEN @overallScore IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            domain = COALESCE(excluded.domain, companies.domain),
            ats_type = excluded.ats_type,
            ats_slug = COALESCE(excluded.ats_slug, companies.ats_slug),
            overall_score = COALESCE(excluded.overall_score, companies.overall_score),
            score_source = COALESCE(excluded.score_source, companies.score_source),
            score_updated_at = CASE
                WHEN excluded.overall_score IS NOT NULL THEN CURRENT_TIMESTAMP
                ELSE companies.score_updated_at
            END
        `
    ).run({ id, name, domain: normalizedDomain, atsType, atsSlug, overallScore: normalizeCompanyScore(overallScore), scoreSource });
    return id;
}

export function parsePostedAt(job) {
    const raw =
        job.postedAt ||
        job.date_posted ||
        job.datePosted ||
        job.posted_at ||
        job.published_at ||
        null;
    if (!raw) {
        return null;
    }
    const relative = String(raw).trim().toLowerCase();
    const relativeMatch = relative.match(/^(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago$/);
    if (relativeMatch) {
        const amount = Number(relativeMatch[1]);
        const unitMs = {
            minute: 60 * 1000,
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000
        }[relativeMatch[2]];
        return new Date(Date.now() - amount * unitMs).toISOString();
    }
    if (relative === "today" || relative === "just now") return new Date().toISOString();
    if (relative === "yesterday") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toISOString();
}

function isStaleListing(job) {
    const postedAt = parsePostedAt(job);
    if (!postedAt) {
        return false;
    }
    const ageMs = Date.now() - new Date(postedAt).getTime();
    const maxAgeMs = env.ingestion.maxJobAgeDays * 24 * 60 * 60 * 1000;
    return ageMs > maxAgeMs;
}

function isAgencyListing(job) {
    const haystack = `${job.company || ""} ${job.title || ""} ${String(job.description || "").slice(0, 500)}`;
    return AGENCY_PATTERN.test(haystack);
}

const AGGREGATOR_SOURCES = new Set([
    "naukri",
    "instahyre",
    "jobspy",
    "hirist",
    "cutshort",
    "wellfound",
    "firecrawl"
]);

function isAggregatorSource(source) {
    return AGGREGATOR_SOURCES.has(source) || String(source || "").startsWith("jobspy:");
}

/**
 * Dedup: URL first, then company+title. Dice similarity only for aggregator clones, not ATS.
 */
function findGhostDuplicate(job) {
    const db = getDb();
    const url = String(job.url || "").trim();
    if (url) {
        const byUrl = findExistingJobByUrl(url, db);
        if (byUrl) {
            return { id: byUrl.id, reason: "exact url" };
        }
    }

    const titleKey = normalizeText(job.title);
    const companyKey = normalizeText(job.company);
    const byTitle = db
        .prepare(
            `
            SELECT j.id, j.title, c.name AS company_name
            FROM jobs j
            LEFT JOIN companies c ON c.id = j.company_id
            WHERE j.status != 'ARCHIVED'
            ORDER BY j.created_at DESC
            LIMIT 500
            `
        )
        .all();

    for (const row of byTitle) {
        if (normalizeText(row.title) === titleKey && normalizeText(row.company_name) === companyKey) {
            return { id: row.id, reason: "exact company+title" };
        }
    }

    if (!isAggregatorSource(job.source)) {
        return null;
    }

    const descSample = String(job.description || "").slice(0, 4000);
    if (descSample.length < 80) {
        return null;
    }
    const existing = db
        .prepare(
            `
            SELECT id, description, source FROM jobs
            WHERE (source IN ('naukri','instahyre','jobspy','hirist','cutshort','wellfound','firecrawl')
                   OR source LIKE 'jobspy:%')
              AND status != 'ARCHIVED'
            ORDER BY created_at DESC
            LIMIT 250
            `
        )
        .all();

    for (const row of existing) {
        if (String(row.description || "").length < 80) continue;
        const score = diceCoefficient(descSample, row.description.slice(0, 4000));
        if (score >= env.ingestion.duplicateSimilarityThreshold) {
            return { id: row.id, reason: `aggregator description similarity ${(score * 100).toFixed(1)}%` };
        }
    }

    return null;
}

function isFakeJobUrl(url = "") {
    const value = String(url).trim().toLowerCase();
    if (!/^https?:\/\//.test(value)) {
        return true;
    }
    // Placeholder / demo hosts used by old mock feeds
    if (
        value.includes("example.com") ||
        value.includes("example.org") ||
        value.includes("northwindlabs.example") ||
        value.includes("cedarsystems.example") ||
        /naukri\.com\/job-listings\/(flipkart|razorpay|swiggy|zomato|paytm|agency)/.test(value) ||
        /instahyre\.com\/job\/(flipkart|razorpay|swiggy|zomato|paytm|agency)/.test(value)
    ) {
        return true;
    }
    return false;
}

function recordRawSnapshot(jobId, job, db = getDb()) {
    const snapshot = rawJobSnapshot(job);
    db.prepare(`INSERT OR IGNORE INTO job_raw_snapshots
        (id, job_id, source, source_url, raw_text, payload_json, content_hash, parser_version, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .run(crypto.randomUUID(), jobId, String(job.source || "unknown"), canonicalJobUrl(job.url),
            snapshot.rawText, JSON.stringify(snapshot.payload), snapshot.contentHash, snapshot.parserVersion);
}

export function shouldIngestJob(job) {
    if (!job.title || !job.url || !job.company) {
        return { ok: false, reason: "missing required fields" };
    }
    if (isFakeJobUrl(job.url)) {
        return { ok: false, reason: "fake/placeholder url blocked" };
    }
    if (!isIndiaLocation(job.location)) {
        return { ok: false, reason: `non-India location (${job.location})` };
    }
    if (!classifyJobTitle(job.title).family) {
        return { ok: false, reason: `outside supported professional-engineering market (${job.title})` };
    }
    if (isAgencyListing(job)) {
        return { ok: false, reason: "consultancy/staffing filter" };
    }
    if (isStaleListing(job)) {
        return { ok: false, reason: `older than ${env.ingestion.maxJobAgeDays} days` };
    }
    const deadline = normalizeJobForRegistry(job).explicitDeadline;
    if (deadline && new Date(deadline).getTime() <= Date.now()) {
        return { ok: false, reason: "explicit application deadline has passed" };
    }
    const ghost = findGhostDuplicate(job);
    if (ghost) {
        return { ok: false, reason: `ghost duplicate of ${ghost.id} (${ghost.reason})` };
    }
    return { ok: true };
}

export function upsertJob(job, _options = {}) {
    const db = getDb();
    const existing = job.url && !isFakeJobUrl(job.url)
        ? findExistingJobByUrl(job.url, db)
        : null;
    if (existing) {
        const postedAt = parsePostedAt(job);
        if (isStaleListing(job)) {
            db.prepare(`UPDATE jobs SET last_scraped_at = CURRENT_TIMESTAMP,
                last_seen_at = CURRENT_TIMESTAMP, discovery_count = COALESCE(discovery_count, 0) + 1
                WHERE id = ?`).run(existing.id);
            recordRawSnapshot(existing.id, job, db);
            return {
                id: existing.id,
                inserted: false,
                skipped: true,
                queuedForScoring: false,
                source: existing.source || job.source,
                postedAt: postedAt || existing.posted_at,
                reason: `exact url (older than ${env.ingestion.maxJobAgeDays} days; not rescored)`
            };
        }
        const existingDescription = String(existing.description || "").trim();
        const incomingDescription = String(job.description || "").trim();
        // Do not replace a complete description with a short listing-card excerpt.
        // Same-size edits and employer corrections are still detected and rescored.
        const acceptedDescription = incomingDescription.length >= Math.max(80, existingDescription.length * 0.8)
            ? incomingDescription
            : existingDescription;
        const nextJob = {
            ...job,
            title: job.title || existing.title,
            location: job.location || existing.location,
            description: acceptedDescription
        };
        const nextFingerprint = jobContentFingerprint(nextJob);
        const priorFingerprint = existing.content_fingerprint || jobContentFingerprint(existing);
        const contentChanged = nextFingerprint !== priorFingerprint;
        const incomingTags = extractJobTags({ ...job, description: acceptedDescription });
        const normalizedJob = normalizeJobForRegistry(nextJob);
        const nextMatchFingerprint = jobMatchFingerprint(nextJob, normalizedJob);
        const materialMatchChanged = existing.match_fingerprint
            ? nextMatchFingerprint !== existing.match_fingerprint
            : contentChanged;
        const previousExperienceUnknown = existing.yoe_min == null
            || (Number(existing.yoe_min) === 0 && /experience requirement:\s*not specified/i.test(existing.description || ""));
        const newlyDiscoveredExperience = previousExperienceUnknown && incomingTags.yoeMin != null;
        const stillSupported = Boolean(classifyJobTitle(nextJob.title).family);
        const needsRescore = stillSupported && (newlyDiscoveredExperience || materialMatchChanged)
            && ["MATCHED", "CLOSE", "PREFILTERED", "REJECTED"].includes(existing.status);
        db.prepare(`
            UPDATE jobs
            SET posted_at = CASE
                    WHEN ? IS NOT NULL AND (? > COALESCE(posted_at, '')) THEN ?
                    ELSE posted_at
                END,
                title = ?,
                location = ?,
                description = ?,
                canonical_url = ?,
                content_fingerprint = ?,
                yoe_min = COALESCE(?, yoe_min),
                ctc_min_lpa = COALESCE(?, ctc_min_lpa),
                ctc_max_lpa = COALESCE(?, ctc_max_lpa),
                work_mode = COALESCE(?, work_mode),
                has_esops = ?, has_bond = ?,
                career_family = ?, career_track = ?, employment_type = ?, seniority_level = ?,
                country_code = ?, remote_scope = ?, sponsorship_policy = ?, relocation_policy = ?,
                travel_requirement = ?, bond_policy = ?, primary_stack = ?,
                required_skills_json = ?, secondary_skills_json = ?, explicit_deadline = ?,
                match_fingerprint = ?,
                match_version = CASE WHEN ? = 1 THEN COALESCE(match_version, 1) + 1 ELSE COALESCE(match_version, 1) END,
                posting_series_key = ?, normalizer_version = ?,
                status = CASE
                    WHEN ? = 1 THEN 'PENDING'
                    ELSE status
                END,
                last_changed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE last_changed_at END,
                last_scraped_at = CURRENT_TIMESTAMP,
                last_seen_at = CURRENT_TIMESTAMP,
                discovery_count = COALESCE(discovery_count, 0) + 1
            WHERE id = ?
        `).run(postedAt, postedAt, postedAt, nextJob.title, nextJob.location,
            acceptedDescription, canonicalJobUrl(job.url), nextFingerprint, incomingTags.yoeMin,
            normalizedJob.ctcMinLpa, normalizedJob.ctcMaxLpa, normalizedJob.workMode,
            normalizedJob.hasEsops ? 1 : 0, normalizedJob.hasBond ? 1 : 0,
            normalizedJob.careerFamily, normalizedJob.careerTrack, normalizedJob.employmentType,
            normalizedJob.seniorityLevel, normalizedJob.countryCode, normalizedJob.remoteScope,
            normalizedJob.sponsorshipPolicy, normalizedJob.relocationPolicy, normalizedJob.travelRequirement,
            normalizedJob.bondPolicy, normalizedJob.primaryStack, JSON.stringify(normalizedJob.requiredSkills),
            JSON.stringify(normalizedJob.secondarySkills), normalizedJob.explicitDeadline, nextMatchFingerprint,
            materialMatchChanged ? 1 : 0, jobPostingSeriesKey(nextJob, normalizedJob), normalizedJob.normalizerVersion,
            needsRescore ? 1 : 0, contentChanged ? 1 : 0, existing.id);
        recordRawSnapshot(existing.id, nextJob, db);
        observeJobAvailable(existing.id, {
            db, source: String(job.source || existing.source || "INGESTION").toUpperCase(),
            explicitDeadline: normalizedJob.explicitDeadline
        });
        const companyScore = normalizeCompanyScore(job.companyScore ?? job.companyRating ?? job.company_rating ?? null);
        if (companyScore !== null && existing.company_id) {
            db.prepare(`
                UPDATE companies
                SET overall_score = ?, score_source = ?, score_updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                companyScore,
                job.companyScoreSource || job.source || "job source",
                existing.company_id
            );
        }
        return {
            id: existing.id,
            inserted: false,
            skipped: true,
            queuedForScoring: needsRescore,
            source: existing.source || job.source,
            postedAt: parsePostedAt(job) || existing.posted_at,
            reason: needsRescore
                ? "exact url (material job detail changed; queued for rescoring)"
                : contentChanged
                    ? "exact url (material detail changed; current status retained)"
                    : "exact url (unchanged; last-seen metadata refreshed)"
        };
    }

    const gate = shouldIngestJob(job);
    if (!gate.ok) {
        return { id: null, inserted: false, skipped: true, reason: gate.reason };
    }

    const companyId = upsertCompany({
        name: job.company,
        domain: job.domain || null,
        atsType: job.atsType || "unknown",
        atsSlug: job.atsSlug || null,
        overallScore: job.companyScore ?? job.companyRating ?? job.company_rating ?? null,
        scoreSource: job.companyScoreSource || (job.companyScore != null || job.companyRating != null || job.company_rating != null ? job.source : null)
    });

    const id = hashJob({
        source: job.source,
        company: job.company,
        title: job.title,
        url: job.url
    });

    const normalizedTitle = String(job.title).toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedLocation = String(job.location).toLowerCase().replace(/[^a-z0-9]/g, "");
    const dedupHash = crypto.createHash("md5").update(`${companyId}:${normalizedTitle}:${normalizedLocation}`).digest("hex");
    
    const existingDedup = db.prepare("SELECT id FROM jobs WHERE dedup_hash = ? AND status != 'ARCHIVED' ORDER BY created_at ASC LIMIT 1").get(dedupHash);
    const duplicateOfJobId = existingDedup ? existingDedup.id : null;

    const postedAt = parsePostedAt(job);
    let freshnessScore = null;
    if (postedAt) {
        const daysSince = (Date.now() - new Date(postedAt).getTime()) / (1000 * 60 * 60 * 24);
        freshnessScore = daysSince < 0 ? 100 : Math.max(0, Math.floor(100 - (daysSince * 7)));
    }

    const normalizedJob = normalizeJobForRegistry(job);
    const tags = extractJobTags(job);
    const classification = classifyJobTitle(job.title);
    const matchFingerprint = jobMatchFingerprint(job, normalizedJob);
    const result = db
        .prepare(
            `
            INSERT OR IGNORE INTO jobs (
                id, company_id, title, location, description, url, canonical_url, source, posted_at,
                yoe_min, ctc_min_lpa, ctc_max_lpa, work_mode, has_esops, has_bond,
                location_label, dedup_hash, posting_velocity_score, duplicate_of_job_id,
                career_family, career_track, content_fingerprint, first_seen_at,
                last_seen_at, last_changed_at, last_scraped_at, discovery_count, status,
                lifecycle_status, lifecycle_reason, lifecycle_confidence, explicit_deadline,
                last_verified_at, next_check_at, employment_type, seniority_level, country_code,
                remote_scope, sponsorship_policy, relocation_policy, travel_requirement, bond_policy,
                primary_stack, required_skills_json, secondary_skills_json, match_fingerprint,
                match_version, posting_series_key, normalizer_version
            ) VALUES (
                @id, @companyId, @title, @location, @description, @url, @canonicalUrl, @source, @postedAt,
                @yoeMin, @ctcMinLpa, @ctcMaxLpa, @workMode, @hasEsops, @hasBond,
                @locationLabel, @dedupHash, @freshnessScore, @duplicateOfJobId,
                @careerFamily, @careerTrack, @contentFingerprint, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1, 'PENDING',
                'ACTIVE', 'SOURCE_CONFIRMED_AVAILABLE', 0.82, @explicitDeadline,
                CURRENT_TIMESTAMP, datetime('now', '+12 hours'), @employmentType, @seniorityLevel, @countryCode,
                @remoteScope, @sponsorshipPolicy, @relocationPolicy, @travelRequirement, @bondPolicy,
                @primaryStack, @requiredSkillsJson, @secondarySkillsJson, @matchFingerprint,
                1, @postingSeriesKey, @normalizerVersion
            )
            `
        )
        .run({
            id,
            companyId,
            title: job.title,
            location: job.location || "Not specified",
            description: job.description || "",
            url: job.url,
            canonicalUrl: canonicalJobUrl(job.url),
            source: job.source,
            postedAt: parsePostedAt(job),
            yoeMin: tags.yoeMin,
            ctcMinLpa: tags.ctcMinLpa,
            ctcMaxLpa: tags.ctcMaxLpa,
            workMode: tags.workMode,
            hasEsops: tags.hasEsops,
            hasBond: tags.hasBond,
            locationLabel: locationLabel(job.location),
            dedupHash,
            freshnessScore,
            duplicateOfJobId,
            careerFamily: classification.family,
            careerTrack: classification.track,
            contentFingerprint: jobContentFingerprint(job)
            ,explicitDeadline: normalizedJob.explicitDeadline,
            employmentType: normalizedJob.employmentType,
            seniorityLevel: normalizedJob.seniorityLevel,
            countryCode: normalizedJob.countryCode,
            remoteScope: normalizedJob.remoteScope,
            sponsorshipPolicy: normalizedJob.sponsorshipPolicy,
            relocationPolicy: normalizedJob.relocationPolicy,
            travelRequirement: normalizedJob.travelRequirement,
            bondPolicy: normalizedJob.bondPolicy,
            primaryStack: normalizedJob.primaryStack,
            requiredSkillsJson: JSON.stringify(normalizedJob.requiredSkills),
            secondarySkillsJson: JSON.stringify(normalizedJob.secondarySkills),
            matchFingerprint,
            postingSeriesKey: jobPostingSeriesKey(job, normalizedJob),
            normalizerVersion: normalizedJob.normalizerVersion
        });

    if (result.changes > 0) {
        recordRawSnapshot(id, job, db);
        observeJobAvailable(id, {
            db, source: String(job.source || "INGESTION").toUpperCase(),
            explicitDeadline: normalizedJob.explicitDeadline
        });
    }

    return {
        id,
        inserted: result.changes > 0,
        skipped: result.changes === 0,
        queuedForScoring: result.changes > 0,
        source: job.source,
        postedAt,
        reason: result.changes > 0 ? null : "insert ignored"
    };
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            "User-Agent": "job-hunter-agent/1.0",
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`);
    }

    return response.json();
}

function stripHtml(html = "") {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Ensure JobSpy CLI always targets India even if JOBSPY_COMMAND omits --country.
 */
export function buildJobSpyCommand(rawCommand = env.jobspy.command, { searchTerm = null } = {}) {
    const country = env.jobspy.country || "india";
    let command = String(rawCommand || "").trim();

    if (!command) {
        command = `./.venv/bin/python scripts/jobspy_cli.py --site linkedin,indeed --search_term "backend engineer" --results_wanted 25 --country ${country} --location "Bengaluru"`;
    }

    // Migrate legacy `python -m jobspy` commands to the project CLI wrapper.
    if (/\bpython(?:3(?:\.\d+)?)?\s+-m\s+jobspy\b/i.test(command)) {
        command = command.replace(
            /\bpython(?:3(?:\.\d+)?)?\s+-m\s+jobspy\b/i,
            "./.venv/bin/python scripts/jobspy_cli.py"
        );
    }

    if (!/--country\b/i.test(command)) {
        command = `${command} --country ${country}`;
    } else {
        command = command.replace(/--country\s+\S+/i, `--country ${country}`);
    }

    if (searchTerm) {
        const escaped = String(searchTerm).replace(/["\\]/g, " ").trim();
        if (/--search[_-]term\s+(?:"[^"]*"|'[^']*'|\S+)/i.test(command)) {
            command = command.replace(/--search[_-]term\s+(?:"[^"]*"|'[^']*'|\S+)/i, `--search_term "${escaped}"`);
        } else {
            command = `${command} --search_term "${escaped}"`;
        }
    }

    const freshnessHours = Math.max(24, Math.round(env.ingestion.maxJobAgeDays * 24));
    if (/--hours[_-]old\s+\d+/i.test(command)) {
        command = command.replace(/--hours[_-]old\s+\d+/i, `--hours_old ${freshnessHours}`);
    } else {
        command = `${command} --hours_old ${freshnessHours}`;
    }

    // Prefer LinkedIn India + Indeed India when site list is a bare "linkedin".
    if (/--site\s+linkedin\b/i.test(command) && !/--site\s+linkedin\s*,/i.test(command)) {
        command = command.replace(/--site\s+linkedin\b/i, "--site linkedin,indeed");
    }

    return command;
}

/**
 * Greenhouse + Lever. India locations only — keeps Postman but drops SF/London roles.
 */
export async function fetchDirectAtsJobs() {
    const jobs = [];

    for (const board of env.greenhouseBoards) {
        try {
            const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
            const data = await fetchJson(url);
            const listings = Array.isArray(data.jobs) ? data.jobs : [];
            let kept = 0;

            for (const item of listings) {
                const location = item.location?.name || "Not specified";
                if (!isIndiaLocation(location)) {
                    continue;
                }
                kept += 1;
                jobs.push({
                    company: data.name || board,
                    domain: null,
                    title: item.title,
                    location,
                    description: stripHtml(item.content || ""),
                    url: item.absolute_url,
                    source: "direct_ats",
                    atsType: "greenhouse",
                    atsSlug: board,
                    postedAt: item.updated_at || null
                });
            }
            console.log(`[ingestion:greenhouse:${board}] ${listings.length} listings, ${kept} India`);
        } catch (error) {
            console.error(`[ingestion:greenhouse:${board}]`, error.message);
        }
    }

    for (const company of env.leverCompanies) {
        try {
            const url = `https://api.lever.co/v0/postings/${company}?mode=json`;
            const listings = await fetchJson(url);

            for (const item of Array.isArray(listings) ? listings : []) {
                const location = item.categories?.location || "Not specified";
                if (!isIndiaLocation(location)) continue;
                jobs.push({
                    company: company,
                    domain: null,
                    title: item.text,
                    location,
                    description: stripHtml(
                        [item.descriptionPlain, item.lists?.map((l) => l.text).join("\n")]
                            .filter(Boolean)
                            .join("\n")
                    ),
                    url: item.hostedUrl || item.applyUrl,
                    source: "direct_ats",
                    atsType: "lever",
                    atsSlug: company,
                    postedAt: item.createdAt || null
                });
            }
        } catch (error) {
            console.error(`[ingestion:lever:${company}]`, error.message);
        }
    }

    return jobs.filter((job) => job.url && !isFakeJobUrl(job.url));
}

export async function fetchAshbyJobs() {
    const jobs = [];
    for (const board of env.ashbyBoards) {
        try {
            const url = `https://api.ashbyhq.com/posting-api/job-board/${board}`;
            const data = await fetchJson(url);
            const listings = Array.isArray(data.jobs) ? data.jobs : [];
            for (const item of listings) {
                const location = item.location || item.address?.postalAddress?.addressLocality || "Not specified";
                if (!isIndiaLocation(location)) continue;
                jobs.push({
                    company: data.organizationName || board,
                    title: item.title,
                    location,
                    description: stripHtml(item.descriptionHtml || item.descriptionPlain || ""),
                    url: item.jobUrl || item.applyUrl || "",
                    source: "ashby",
                    atsType: "ashby",
                    atsSlug: board,
                    postedAt: item.publishedAt || item.createdAt || null
                });
            }
        } catch (error) {
            console.error(`[ingestion:ashby:${board}]`, error.message);
        }
    }
    return jobs.filter((job) => job.url && !isFakeJobUrl(job.url));
}

/**
 * JobSpy CLI bridge targeting LinkedIn India + Indeed India (+ optional Naukri).
 * Live results only — never inserts mock jobs.
 */
export async function fetchJobSpyJobs() {
    if (!env.jobspy.enabled) {
        console.warn("[ingestion:jobspy] Disabled — skipping (set JOBSPY_ENABLED=true)");
        return [];
    }

    const terms = [...new Set([
        ...GLOBAL_SEARCH_TITLES,
        ...searchTermsForCareerProfiles(GLOBAL_CAREER_PROFILES)
    ])].slice(0, 8);
    const collected = [];
    const seen = new Set();
    for (const term of terms.length ? terms : [null]) {
        const command = buildJobSpyCommand(env.jobspy.command, { searchTerm: term });
        console.log(`[ingestion:jobspy] Running: ${command}`);
        try {
            const { stdout } = await execAsync(command, {
                timeout: 180000,
                maxBuffer: 8 * 1024 * 1024
            });
            const parsed = JSON.parse(stdout);
            const listings = Array.isArray(parsed) ? parsed : parsed.jobs || [];
            for (const item of listings) {
                const job = {
                company: item.company || item.company_name || "Unknown Company",
                domain: item.company_url || null,
                title: item.title || item.job_title || "Untitled role",
                location: item.location || "Not specified",
                description: stripHtml(item.description || item.job_description || ""),
                url: item.job_url || item.url || "",
                source: item.site ? `jobspy:${String(item.site).toLowerCase()}` : "jobspy",
                atsType: "unknown",
                date_posted: item.date_posted || item.datePosted || item.posted_at || null,
                companyScore: item.company_rating || item.companyRating || null,
                    companyScoreSource:
                        item.company_rating || item.companyRating ? `${item.site || "jobspy"} rating` : null
                };
                const dedupe = canonicalJobUrl(job.url);
                if (!job.url || isFakeJobUrl(job.url) || seen.has(dedupe)) continue;
                seen.add(dedupe);
                collected.push(job);
            }
        } catch (error) {
            console.error(`[ingestion:jobspy:${term || "default"}] Failed — skipping:`, error.message);
        }
    }
    return collected;
}

/**
 * Naukri.com via Firecrawl JSON extraction of search/listing pages.
 */
export async function fetchNaukriJobs() {
    if (!env.indiaAggregators.naukriEnabled) {
        return [];
    }
    if (!env.firecrawl.enabled || !env.firecrawl.apiKey) {
        console.warn("[ingestion:naukri] NAUKRI_ENABLED requires FIRECRAWL_ENABLED=true and FIRECRAWL_API_KEY — skipping");
        return [];
    }

    const urls = buildNaukriSearchUrls({ titles: GLOBAL_SEARCH_TITLES });
    const jobs = await scrapeJobListings(urls, {
        source: "naukri",
        limit: env.firecrawl.maxJobs
    });
    console.log(`[ingestion:naukri] Firecrawl extracted ${jobs.length} job(s)`);
    return jobs;
}

/**
 * Instahyre via Firecrawl JSON extraction of search/listing pages.
 */
export async function fetchInstahyreJobs() {
    if (!env.indiaAggregators.instahyreEnabled) {
        return [];
    }
    if (!env.firecrawl.enabled || !env.firecrawl.apiKey) {
        console.warn("[ingestion:instahyre] INSTAHYRE_ENABLED requires FIRECRAWL_ENABLED=true and FIRECRAWL_API_KEY — skipping");
        return [];
    }

    const urls = buildInstahyreSearchUrls({ titles: GLOBAL_SEARCH_TITLES });
    const listedJobs = await scrapeJobListings(urls, {
        source: "instahyre",
        limit: env.firecrawl.maxJobs
    });
    const jobs = await enrichJobDetails(listedJobs, {
        source: "instahyre",
        limit: Math.min(10, env.firecrawl.maxJobs)
    });
    console.log(`[ingestion:instahyre] Firecrawl extracted ${jobs.length} job(s)`);
    return jobs;
}

/**
 * Custom Firecrawl listing URLs from FIRECRAWL_URLS (company careers, custom searches).
 */
export async function fetchFirecrawlJobs() {
    if (!env.firecrawl.urls.length) {
        return [];
    }
    if (!env.firecrawl.enabled || !env.firecrawl.apiKey) {
        console.warn("[ingestion:firecrawl] FIRECRAWL_URLS requires FIRECRAWL_ENABLED=true and FIRECRAWL_API_KEY — skipping");
        return [];
    }

    const jobs = await scrapeJobListings(env.firecrawl.urls, {
        source: "firecrawl",
        limit: env.firecrawl.maxJobs
    });
    console.log(`[ingestion:firecrawl] Extracted ${jobs.length} job(s) from custom URLs`);
    return jobs;
}

async function firecrawlBoard(flag, urls, source) {
    if (!flag) return [];
    if (!env.firecrawl.enabled || !env.firecrawl.apiKey) {
        console.warn(`[ingestion:${source}] requires FIRECRAWL_ENABLED=true and FIRECRAWL_API_KEY — skipping`);
        return [];
    }
    const jobs = await scrapeJobListings(urls, { source, limit: env.firecrawl.maxJobs });
    console.log(`[ingestion:${source}] Firecrawl extracted ${jobs.length} job(s)`);
    return jobs;
}

export async function fetchHiristJobs() {
    return firecrawlBoard(env.indiaAggregators.hiristEnabled, buildHiristSearchUrls({
        careerProfiles: GLOBAL_CAREER_PROFILES
    }), "hirist");
}

export async function fetchCutshortJobs() {
    return firecrawlBoard(env.indiaAggregators.cutshortEnabled, buildCutshortSearchUrls({
        careerProfiles: GLOBAL_CAREER_PROFILES
    }), "cutshort");
}

export async function fetchWellfoundJobs() {
    return firecrawlBoard(env.indiaAggregators.wellfoundEnabled, buildWellfoundSearchUrls({
        careerProfiles: GLOBAL_CAREER_PROFILES
    }), "wellfound");
}

export function pendingScoringCandidates(db = getDb(), {
    maxAgeDays = env.ingestion.maxJobAgeDays,
    limit = 5000
} = {}) {
    const boundedAge = Math.max(1, Math.min(90, Number(maxAgeDays) || env.ingestion.maxJobAgeDays));
    const boundedLimit = Math.max(1, Math.min(20000, Number(limit) || 5000));
    return db.prepare(`SELECT id, source,
        COALESCE(NULLIF(posted_at, ''), created_at) AS postedAt
        FROM jobs
        WHERE status = 'PENDING'
          AND lifecycle_status != 'CLOSED'
          AND COALESCE(NULLIF(posted_at, ''), created_at) >= datetime('now', '-' || ? || ' days')
        ORDER BY COALESCE(NULLIF(posted_at, ''), created_at) DESC
        LIMIT ?`).all(boundedAge, boundedLimit);
}

export async function runIngestion({ selectionLimit = null } = {}) {
    const db = getDb();
    const runId = crypto.randomUUID();
    const collectors = [
        ["jobspy", fetchJobSpyJobs],
        ["naukri", fetchNaukriJobs],
        ["instahyre", fetchInstahyreJobs],
        ["hirist", fetchHiristJobs],
        ["cutshort", fetchCutshortJobs],
        ["wellfound", fetchWellfoundJobs],
        ["firecrawl", fetchFirecrawlJobs],
        ["direct_ats", fetchDirectAtsJobs],
        ["ashby", fetchAshbyJobs]
    ];
    db.prepare("INSERT INTO ingestion_runs (id, selection_limit) VALUES (?, ?)")
        .run(runId, selectionLimit == null ? null : Number(selectionLimit));

    const collectorResults = await Promise.all(collectors.map(async ([name, collector]) => {
        const started = Date.now();
        try {
            return { name, jobs: await collector(), durationMs: Date.now() - started, error: null };
        } catch (error) {
            console.error(`[ingestion] Collector ${name} failed:`, error.message);
            return { name, jobs: [], durationMs: Date.now() - started, error: error.message };
        }
    }));

    let fetched = 0;
    let inserted = 0;
    let skipped = 0;
    let eligible = 0;
    const insertedIds = [];
    const scoringCandidates = [];
    const sourceMetrics = new Map();
    const metric = (source) => {
        const key = String(source || "unknown");
        if (!sourceMetrics.has(key)) sourceMetrics.set(key, {
            source: key, fetched: 0, eligible: 0, inserted: 0, duplicates: 0,
            selected: 0, failed: 0, durationMs: 0, newestPostedAt: null, error: null
        });
        return sourceMetrics.get(key);
    };

    for (const result of collectorResults) {
        if (result.error) {
            const item = metric(result.name);
            item.failed = 1;
            item.error = result.error;
            item.durationMs += result.durationMs;
        }
        for (const job of result.jobs) {
            fetched += 1;
            const item = metric(job.source || result.name);
            item.fetched += 1;
            item.durationMs += Math.round(result.durationMs / Math.max(1, result.jobs.length));
            const postedAt = parsePostedAt(job);
            if (postedAt && (!item.newestPostedAt || postedAt > item.newestPostedAt)) item.newestPostedAt = postedAt;
            try {
                const outcome = upsertJob(job);
                const duplicate = outcome.skipped && /(?:exact|duplicate|metadata refreshed|insert ignored)/i.test(outcome.reason || "");
                if (outcome.inserted || outcome.queuedForScoring || duplicate) {
                    item.eligible += 1;
                    eligible += 1;
                }
                if (outcome.inserted) {
                    inserted += 1;
                    item.inserted += 1;
                    insertedIds.push(outcome.id);
                } else if (outcome.skipped) {
                    skipped += 1;
                    if (duplicate) item.duplicates += 1;
                    console.warn(`[ingestion] Skipped (${outcome.reason}): ${job.company} — ${job.title}`);
                }
                if (outcome.queuedForScoring) scoringCandidates.push({
                    id: outcome.id,
                    source: outcome.source || job.source || result.name,
                    postedAt: outcome.postedAt || postedAt
                });
            } catch (error) {
                skipped += 1;
                console.error("[ingestion] Upsert failed:", error.message);
            }
        }
    }

    const candidatePool = selectionLimit == null
        ? scoringCandidates
        : [...new Map([
            ...pendingScoringCandidates(db),
            ...scoringCandidates
        ].map((candidate) => [candidate.id, candidate])).values()];
    const selection = adaptiveSourceSelection(
        candidatePool,
        selectionLimit == null ? candidatePool.length : Number(selectionLimit),
        ingestionHistory(db)
    );
    const selectedIds = selection.selected.map((candidate) => candidate.id);
    for (const candidate of selection.selected) metric(candidate.source).selected += 1;
    for (const [source, quota] of Object.entries(selection.quotas || {})) {
        const item = metric(source);
        const diagnostic = selection.diagnostics?.[source] || {};
        item.quota = Number(quota || 0);
        item.weight = Number(selection.weights?.[source] || 0);
        item.quality = Number(selection.qualities?.[source] || 0);
        item.compatiblePosterior = Number(diagnostic.compatiblePosterior || 0);
        item.uniquePosterior = Number(diagnostic.uniquePosterior || 0);
    }

    const insertSourceRun = db.prepare(`INSERT INTO ingestion_source_runs
        (run_id, source, fetched_count, eligible_count, inserted_count, duplicate_count,
         selected_count, failed, duration_ms, newest_posted_at, error_message,
         quota_count, allocation_weight, quality_score, compatible_posterior, unique_posterior)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const upsertState = db.prepare(`INSERT INTO ingestion_source_state
        (source, newest_posted_at, last_selected_at, total_fetched, total_inserted, total_selected)
        VALUES (?, ?, CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
          newest_posted_at = CASE WHEN excluded.newest_posted_at > COALESCE(ingestion_source_state.newest_posted_at, '')
            THEN excluded.newest_posted_at ELSE ingestion_source_state.newest_posted_at END,
          last_selected_at = CASE WHEN excluded.total_selected > 0 THEN CURRENT_TIMESTAMP ELSE ingestion_source_state.last_selected_at END,
          total_fetched = ingestion_source_state.total_fetched + excluded.total_fetched,
          total_inserted = ingestion_source_state.total_inserted + excluded.total_inserted,
          total_selected = ingestion_source_state.total_selected + excluded.total_selected,
          updated_at = CURRENT_TIMESTAMP`);
    const persist = db.transaction(() => {
        for (const item of sourceMetrics.values()) {
            insertSourceRun.run(runId, item.source, item.fetched, item.eligible, item.inserted,
                item.duplicates, item.selected, item.failed, item.durationMs, item.newestPostedAt, item.error,
                item.quota || 0, item.weight || null, item.quality || null,
                item.compatiblePosterior || null, item.uniquePosterior || null);
            upsertState.run(item.source, item.newestPostedAt, item.selected, item.fetched, item.inserted, item.selected);
        }
        db.prepare(`UPDATE ingestion_runs SET fetched_count=?, eligible_count=?, inserted_count=?,
            selected_count=?, completed_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(fetched, eligible, inserted, selectedIds.length, runId);
    });
    persist();

    return {
        runId, fetched, eligible, inserted, skipped, insertedIds, selectedIds,
        quotas: selection.quotas, weights: selection.weights
    };
}

export function finalizeIngestionRun(runId, jobIds = [], db = getDb()) {
    if (!runId || !jobIds.length) return { updated: 0 };
    const placeholders = jobIds.map(() => "?").join(",");
    const outcomes = db.prepare(`SELECT source, status, COUNT(*) AS count FROM jobs
        WHERE id IN (${placeholders}) GROUP BY source, status`).all(...jobIds);
    const bySource = new Map();
    for (const row of outcomes) {
        if (!bySource.has(row.source)) bySource.set(row.source, { matched: 0, close: 0, rejected: 0 });
        const item = bySource.get(row.source);
        if (["MATCHED", "APPROVED", "APPLIED"].includes(row.status)) item.matched += Number(row.count);
        else if (row.status === "CLOSE") item.close += Number(row.count);
        else item.rejected += Number(row.count);
    }
    const updateRun = db.prepare(`UPDATE ingestion_source_runs SET matched_count=?, close_count=?, rejected_count=?
        WHERE run_id=? AND source=?`);
    const updateState = db.prepare(`UPDATE ingestion_source_state SET total_matched=total_matched+?,
        total_close=total_close+?, updated_at=CURRENT_TIMESTAMP WHERE source=?`);
    const persist = db.transaction(() => {
        for (const [source, item] of bySource) {
            updateRun.run(item.matched, item.close, item.rejected, runId, source);
            updateState.run(item.matched, item.close, source);
        }
    });
    persist();
    return { updated: outcomes.length };
}
