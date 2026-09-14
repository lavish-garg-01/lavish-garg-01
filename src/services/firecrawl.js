import { env } from "../config/environment.js";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";

/** JSON Schema for listing pages — title, company, url, description (+ location). */
export const JOB_LISTING_SCHEMA = {
    type: "object",
    properties: {
        jobs: {
            type: "array",
            description: "Job postings visible on this listing / search page",
            items: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Job title" },
                    company: { type: "string", description: "Hiring company name" },
                    url: {
                        type: "string",
                        description: "Absolute URL to the original job posting detail page"
                    },
                    description: {
                        type: "string",
                        description: "Complete job requirements: every required/preferred skill, backend language option, responsibility, qualification, years-of-experience requirement, compensation and notice constraint shown. Do not reduce this to a skill teaser."
                    },
                    experienceRequirement: {
                        type: "string",
                        description: "Exact experience requirement text, for example '8-12 years of solid experience'; omit only when not shown"
                    },
                    minimumExperienceYears: {
                        type: "number",
                        description: "Lower bound of an explicitly shown experience range; never infer from the title"
                    },
                    location: {
                        type: "string",
                        description: "Job location if shown (e.g. Bengaluru, Remote India)"
                    },
                    postedAt: {
                        type: "string",
                        description: "Posting or publication date exactly as shown; omit when unavailable"
                    },
                    companyRating: {
                        type: "number",
                        description: "Company rating shown by the source, usually 0-5; omit when unavailable and never infer"
                    }
                },
                required: ["title", "company", "url"]
            }
        }
    },
    required: ["jobs"]
};

const EXTRACTION_PROMPT = [
    "Extract every distinct job posting from this Indian tech job listing, search result, or job detail page.",
    "Return absolute https URLs to the real job detail pages (not javascript: or #).",
    "Prefer product-company roles over recruitment consultancies when both appear.",
    "Include location and the posting/publication date when visible.",
    "Never omit an explicit years-of-experience requirement. Preserve its exact text in experienceRequirement and put the lower bound in minimumExperienceYears (8 for 8-12 years). Never infer experience from a title.",
    "On listing pages keep each description compact. On a job detail page preserve the complete Responsibilities, Requirements, and Preferred Qualifications, including every either/or language and technology option; never reduce the detail page to its visible skill chips.",
    "Include a company rating only when the page explicitly displays one; never estimate or infer a rating.",
    "If the page has no jobs, return an empty jobs array."
].join(" ");

function slugifySearchTerm(value = "") {
    return String(value)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

/**
 * Default Naukri search URLs for configured titles × India hubs.
 */
export function buildNaukriSearchUrls({
    titles = env.targetTitles,
    locations = ["gurgaon", "noida", "pune", "hyderabad"]
} = {}) {
    const selectedTitles = [...new Set((titles || []).filter(Boolean))].slice(0, 4);
    return (selectedTitles.length ? selectedTitles : ["software engineer"]).flatMap((role) => locations.map(
        (city) => `https://www.naukri.com/${slugifySearchTerm(role)}-jobs-in-${slugifySearchTerm(city)}`
    ));
}

/**
 * Default Instahyre listing URLs (SEO landing pages render better than the SPA search).
 */
export function buildInstahyreSearchUrls({
    titles = env.targetTitles,
    locations = ["gurgaon", "noida", "bangalore"]
} = {}) {
    const selectedTitles = [...new Set((titles || []).filter(Boolean))].slice(0, 4);
    return (selectedTitles.length ? selectedTitles : ["software engineer"]).flatMap((role) => locations.map(
        (city) => `https://www.instahyre.com/${slugifySearchTerm(role)}-jobs-in-${slugifySearchTerm(city)}/`
    ));
}

export function buildHiristSearchUrls({ careerProfiles = ["SOFTWARE_ENGINEERING"] } = {}) {
    const urls = [
        "https://www.hirist.tech/c/jobs-backend",
        "https://www.hirist.tech/j/backend-developer-jobs-in-gurgaon",
        "https://www.hirist.tech/j/backend-developer-jobs-in-noida"
    ];
    if (careerProfiles.includes("DATA_AI")) urls.push("https://www.hirist.tech/c/jobs-data-science");
    if (careerProfiles.includes("PRODUCT_MANAGEMENT")) urls.push("https://www.hirist.tech/c/jobs-product-management");
    return urls;
}

export function buildCutshortSearchUrls({ careerProfiles = ["SOFTWARE_ENGINEERING"] } = {}) {
    const urls = [
        "https://cutshort.io/jobs/backend-developer-jobs",
        "https://cutshort.io/profile/jobs"
    ];
    if (careerProfiles.includes("DATA_AI")) urls.push("https://cutshort.io/jobs/data-science-jobs");
    if (careerProfiles.includes("PRODUCT_MANAGEMENT")) urls.push("https://cutshort.io/jobs/product-manager-jobs");
    return urls;
}

export function buildWellfoundSearchUrls({ careerProfiles = ["SOFTWARE_ENGINEERING"] } = {}) {
    const urls = [
        "https://wellfound.com/role/l/backend-engineer/india",
        "https://wellfound.com/role/l/software-engineer/india"
    ];
    if (careerProfiles.includes("DATA_AI")) urls.push(
        "https://wellfound.com/role/l/data-scientist/india",
        "https://wellfound.com/role/l/data-analyst/india"
    );
    if (careerProfiles.includes("PRODUCT_MANAGEMENT")) urls.push("https://wellfound.com/role/l/product-manager/india");
    return urls;
}

const MAX_RETRY_WAIT_MS = 120000;
const DEFAULT_RETRY_WAIT_MS = 60000;

let nextAllowedAt = 0;
let firecrawlMutex = Promise.resolve();

export class FirecrawlRateLimitError extends Error {
    constructor(message, retryAfterMs = DEFAULT_RETRY_WAIT_MS) {
        super(message);
        this.name = "FirecrawlRateLimitError";
        this.status = 429;
        this.retryAfterMs = retryAfterMs;
    }
}

export function resetFirecrawlRateLimiterForTests() {
    nextAllowedAt = 0;
    firecrawlMutex = Promise.resolve();
}

function headerValue(headers, name) {
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
    return headers[name] || headers[name.toLowerCase()] || "";
}

function clampWaitMs(value) {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_RETRY_WAIT_MS;
    return Math.min(MAX_RETRY_WAIT_MS, Math.max(1000, Math.ceil(value)));
}

export function parseFirecrawlRetryAfterMs(response, bodyText = "", nowImpl = Date.now) {
    const header = String(headerValue(response?.headers, "Retry-After") || "").trim();
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds)) return clampWaitMs(seconds * 1000);
        const until = Date.parse(header);
        if (Number.isFinite(until)) return clampWaitMs(until - nowImpl());
    }

    const text = String(bodyText || "");
    const afterSeconds = text.match(/retry after\s+(\d+(?:\.\d+)?)\s*s/i);
    if (afterSeconds) return clampWaitMs(Number(afterSeconds[1]) * 1000);

    const resetsAt = text.match(/resets at\s+([^.,]+)/i);
    if (resetsAt) {
        const until = Date.parse(resetsAt[1]);
        if (Number.isFinite(until)) return clampWaitMs(until - nowImpl());
    }

    return DEFAULT_RETRY_WAIT_MS;
}

async function withFirecrawlLock(fn) {
    let release;
    const previous = firecrawlMutex;
    firecrawlMutex = new Promise((resolve) => {
        release = resolve;
    });
    await previous;
    try {
        return await fn();
    } finally {
        release();
    }
}

function firecrawlRequestOptions(options = {}) {
    return {
        source: options.source || "firecrawl",
        timeoutMs: options.timeoutMs || 120000,
        fetchImpl: options.fetchImpl || fetch,
        sleepImpl: options.sleepImpl || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        nowImpl: options.nowImpl || Date.now,
        minIntervalMs: Number.isFinite(Number(options.minIntervalMs))
            ? Math.max(0, Number(options.minIntervalMs))
            : env.firecrawl.minIntervalMs,
        maxRetries: Number.isFinite(Number(options.maxRetries))
            ? Math.max(0, Number(options.maxRetries))
            : env.firecrawl.maxRetries
    };
}

function parseExtractedJobs(payload, source) {
    const data = payload.data || payload;
    const extracted = data.json || data.extract || payload.json || {};
    const jobsRaw = Array.isArray(extracted.jobs)
        ? extracted.jobs
        : Array.isArray(extracted)
            ? extracted
            : [];
    return jobsRaw
        .map((item) => normalizeJob(item, source))
        .filter(Boolean);
}

export function normalizeJob(raw, source, fallbackLocation = "India") {
    const url = String(raw.url || raw.job_url || "").trim();
    const title = String(raw.title || "").trim();
    const company = String(raw.company || raw.company_name || "").trim();
    if (!url || !title || !company) {
        return null;
    }
    if (!/^https?:\/\//i.test(url)) {
        return null;
    }

    const explicitExperience = String(raw.experienceRequirement || raw.experience_requirement || "").trim();
    const baseDescription = String(raw.description || "").trim();
    const description = explicitExperience && !baseDescription.toLowerCase().includes(explicitExperience.toLowerCase())
        ? `${baseDescription}${baseDescription ? "\n" : ""}Experience requirement: ${explicitExperience}`
        : baseDescription;
    const minimumExperienceYears = Number(raw.minimumExperienceYears ?? raw.minimum_experience_years);

    return {
        company,
        domain: null,
        title,
        location: String(raw.location || fallbackLocation).trim() || fallbackLocation,
        description,
        minimumExperienceYears: Number.isFinite(minimumExperienceYears) && minimumExperienceYears >= 0 && minimumExperienceYears <= 40
            ? minimumExperienceYears
            : null,
        url,
        source,
        atsType: "unknown",
        postedAt: raw.postedAt || raw.posted_at || raw.datePosted || raw.date_posted || null,
        companyScore: raw.companyRating ?? raw.company_rating ?? null,
        companyScoreSource: raw.companyRating != null || raw.company_rating != null ? `${source} rating` : null
    };
}

/**
 * Scrape one listing URL via Firecrawl v2 JSON extraction.
 * Concurrent collectors share one lock, wait on HTTP 429 retry-after, and pace successes.
 */
export async function scrapeJobListing(url, options = {}) {
    const {
        source,
        timeoutMs,
        fetchImpl,
        sleepImpl,
        nowImpl,
        minIntervalMs,
        maxRetries
    } = firecrawlRequestOptions(options);

    if (!env.firecrawl.apiKey && fetchImpl === fetch) {
        throw new Error("FIRECRAWL_API_KEY is required");
    }

    return withFirecrawlLock(async () => {
        const maxAttempts = Math.max(1, maxRetries + 1);
        let lastRateLimit = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const waitMs = Math.max(0, nextAllowedAt - nowImpl());
            if (waitMs > 0) {
                console.warn(`[firecrawl] Waiting ${Math.ceil(waitMs / 1000)}s for rate-limit window before ${url}`);
                await sleepImpl(waitMs);
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetchImpl(FIRECRAWL_SCRAPE_URL, {
                    method: "POST",
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${env.firecrawl.apiKey}`
                    },
                    body: JSON.stringify({
                        url,
                        onlyMainContent: true,
                        waitFor: 2500,
                        timeout: Math.min(timeoutMs, 120000),
                        formats: [
                            {
                                type: "json",
                                prompt: EXTRACTION_PROMPT,
                                schema: JOB_LISTING_SCHEMA
                            }
                        ]
                    })
                });

                const bodyText = await response.text();
                if (response.status === 429) {
                    const retryAfterMs = parseFirecrawlRetryAfterMs(response, bodyText, nowImpl);
                    nextAllowedAt = Math.max(nextAllowedAt, nowImpl() + retryAfterMs);
                    lastRateLimit = new FirecrawlRateLimitError(
                        `Firecrawl HTTP 429: ${bodyText.slice(0, 240)}`,
                        retryAfterMs
                    );
                    console.warn(
                        `[firecrawl] HTTP 429 on ${url}; retry after ${Math.ceil(retryAfterMs / 1000)}s `
                        + `(attempt ${attempt}/${maxAttempts})`
                    );
                    continue;
                }

                let payload;
                try {
                    payload = JSON.parse(bodyText);
                } catch {
                    throw new Error(`Firecrawl non-JSON response HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
                }

                if (!response.ok) {
                    const message = payload?.error || payload?.message || bodyText.slice(0, 200);
                    throw new Error(`Firecrawl HTTP ${response.status}: ${message}`);
                }

                nextAllowedAt = Math.max(nextAllowedAt, nowImpl() + minIntervalMs);
                return parseExtractedJobs(payload, source);
            } finally {
                clearTimeout(timer);
            }
        }

        throw lastRateLimit || new FirecrawlRateLimitError(`Firecrawl HTTP 429: rate limited ${url}`);
    });
}

/**
 * Scrape multiple listing URLs sequentially (credit-friendly).
 * HTTP 429 waits and retries the same URL; a persistent rate limit stops the rest of this batch.
 */
export async function scrapeJobListings(urls = [], options = {}) {
    const { source = "firecrawl", limit = 50 } = options;
    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    const jobs = [];
    const seen = new Set();

    for (const url of uniqueUrls) {
        try {
            console.log(`[firecrawl] Scraping ${url}`);
            const batch = await scrapeJobListing(url, options);
            for (const job of batch) {
                const key = `${job.company}|${job.title}|${job.url}`.toLowerCase();
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                jobs.push(job);
                if (jobs.length >= limit) {
                    return jobs;
                }
            }
        } catch (error) {
            if (error instanceof FirecrawlRateLimitError) {
                console.warn(`[firecrawl] Stopping remaining URLs in this batch after rate-limit: ${url}`);
                break;
            }
            console.error(`[firecrawl] Failed ${url}:`, error.message);
        }
    }

    return jobs;
}

export function mergeJobDetail(listingJob, detailJob) {
    if (!detailJob) return listingJob;
    const listingDescription = String(listingJob.description || "").trim();
    const detailDescription = String(detailJob.description || "").trim();
    const useDetail = detailDescription.length > listingDescription.length;
    return {
        ...listingJob,
        ...(useDetail ? { description: detailDescription } : {}),
        minimumExperienceYears: detailJob.minimumExperienceYears ?? listingJob.minimumExperienceYears ?? null,
        location: detailJob.location && detailJob.location !== "India" ? detailJob.location : listingJob.location,
        postedAt: detailJob.postedAt || listingJob.postedAt,
        companyScore: detailJob.companyScore ?? listingJob.companyScore,
        companyScoreSource: detailJob.companyScoreSource || listingJob.companyScoreSource
    };
}

export async function enrichJobDetails(jobs = [], options = {}) {
    const { source = "firecrawl", limit = 10 } = options;
    const enriched = [];
    for (const job of jobs) {
        if (enriched.length >= limit || (!/not specified/i.test(job.description || "") && String(job.description || "").length >= 1200 && job.minimumExperienceYears != null)) {
            enriched.push(job);
            continue;
        }
        try {
            const detail = (await scrapeJobListing(job.url, { ...options, source }))[0] || null;
            enriched.push(mergeJobDetail(job, detail));
        } catch (error) {
            if (error instanceof FirecrawlRateLimitError) {
                console.warn(`[firecrawl] Stopping detail enrichment after rate-limit: ${job.url}`);
                enriched.push(job);
                for (const remaining of jobs.slice(jobs.indexOf(job) + 1)) {
                    if (enriched.length >= limit) break;
                    enriched.push(remaining);
                }
                break;
            }
            console.warn(`[firecrawl] Detail enrichment failed ${job.url}: ${error.message}`);
            enriched.push(job);
        }
    }
    return enriched;
}

/**
 * Collect jobs from configured Firecrawl listing URLs (custom + optional aggregators).
 * Prefer the dedicated ingestion collectors; this helper is for one-shot scripts/tests.
 */
export async function fetchFirecrawlJobs() {
    if (!env.firecrawl.enabled) {
        console.warn("[firecrawl] FIRECRAWL_ENABLED is not true — skipping");
        return [];
    }
    if (!env.firecrawl.apiKey) {
        console.warn("[firecrawl] Missing FIRECRAWL_API_KEY — skipping");
        return [];
    }

    const urls = [...env.firecrawl.urls];
    if (env.indiaAggregators.naukriEnabled) {
        urls.push(...buildNaukriSearchUrls());
    }
    if (env.indiaAggregators.instahyreEnabled) {
        urls.push(...buildInstahyreSearchUrls());
    }

    if (!urls.length) {
        console.warn(
            "[firecrawl] No listing URLs configured. Set FIRECRAWL_URLS and/or NAUKRI_ENABLED / INSTAHYRE_ENABLED / HIRIST_ENABLED / CUTSHORT_ENABLED / WELLFOUND_ENABLED."
        );
        return [];
    }

    const jobs = await scrapeJobListings(urls, {
        source: "firecrawl",
        limit: env.firecrawl.maxJobs
    });

    console.log(`[firecrawl] Extracted ${jobs.length} job(s) from ${urls.length} listing URL(s)`);
    return jobs;
}
