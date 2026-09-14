import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";
import { normalizeCompanyDomain } from "../utils/companyDomain.js";

const INDIA_TA_TITLE =
    /\b(talent acquisition|technical recruiter|recruiter|talent partner|sourcer)\b/i;
let hunterKeyCursor = 0;

function indiaRecruiterScore(person) {
    const title = `${person.recruiterTitle || ""} ${person.title || ""}`;
    let score = 0;

    if (INDIA_TA_TITLE.test(title)) score += 3;
    if (/\btalent acquisition india\b/i.test(title)) score += 5;
    if (/\btechnical recruiter\b/i.test(title)) score += 4;
    if (person.recruiterEmail) score += 1;
    if (person.linkedinUrl) score += 1;
    return score;
}

function hunterErrorMessage(status, body, statusText) {
    try {
        const parsed = JSON.parse(body);
        const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
        const detail = errors.map((error) => error.details || error.id).filter(Boolean).join("; ");
        if (detail) return `HTTP ${status}: ${detail}`;
        if (parsed.error) return `HTTP ${status}: ${parsed.error}`;
    } catch {
        // Use the bounded response text below.
    }
    return `HTTP ${status}: ${body.slice(0, 500) || statusText}`;
}

export function mapHunterRecruiters(payload, titleHint = "Recruiter") {
    const emails = Array.isArray(payload?.data?.emails) ? payload.data.emails : [];
    return emails
        .map((person) => ({
            recruiterName:
                [person.first_name, person.last_name].filter(Boolean).join(" ") || "Unknown",
            recruiterEmail: person.value || null,
            recruiterTitle: person.position || person.position_raw || titleHint,
            linkedinUrl: person.linkedin
                ? person.linkedin.startsWith("http")
                    ? person.linkedin
                    : `https://www.linkedin.com/in/${person.linkedin.replace(/^\/+|\/+$/g, "")}`
                : null,
            confidence: Number(person.confidence || 0),
            verificationStatus: person.verification?.status || "unknown"
        }))
        .filter((person) => person.recruiterEmail)
        .sort((a, b) => indiaRecruiterScore(b) - indiaRecruiterScore(a) || b.confidence - a.confidence);
}

function rotatedHunterKeys(apiKeys) {
    const keys = apiKeys.filter(Boolean);
    if (!keys.length) return [];
    const start = hunterKeyCursor % keys.length;
    hunterKeyCursor = (hunterKeyCursor + 1) % keys.length;
    return keys.map((_, index) => keys[(start + index) % keys.length]);
}

function hunterSearchParams({ companyName, companyDomain, limit }) {
    const params = new URLSearchParams({
        limit: String(limit),
        type: "personal",
        job_titles: [
            "technical recruiter",
            "recruiter",
            "talent acquisition",
            "talent partner",
            "sourcer"
        ].join(","),
        required_field: "full_name,position",
        verification_status: "valid,accept_all"
    });
    if (companyDomain) params.set("domain", companyDomain);
    else params.set("company", companyName);
    return params;
}

export async function searchHunterRecruiters({
    companyName,
    domain,
    titleHint = "Recruiter",
    apiKeys = env.hunterApiKeys,
    limit = env.hunterRecruiterLimit,
    fetchImpl = fetch
} = {}) {
    const keys = rotatedHunterKeys(apiKeys);
    if (!keys.length) {
        throw new Error("Hunter recruiter search is unavailable: HUNTER_API_KEYS is missing");
    }

    const companyDomain = normalizeCompanyDomain(domain);
    if (!companyDomain && !companyName) {
        throw new Error("Hunter recruiter search needs a company name or corporate domain");
    }

    const params = hunterSearchParams({ companyName, companyDomain, limit });
    let lastQuotaError = null;

    for (let index = 0; index < keys.length; index += 1) {
        const response = await fetchImpl(`https://api.hunter.io/v2/domain-search?${params}`, {
            headers: {
                Accept: "application/json",
                "Cache-Control": "no-cache",
                "X-API-KEY": keys[index]
            }
        });

        if (!response.ok) {
            const body = await response.text();
            const message = hunterErrorMessage(response.status, body, response.statusText);
            if (response.status === 429) {
                lastQuotaError = message;
                console.warn(`[enrichment] Hunter key ${index + 1}/${keys.length} is quota-limited; trying next key`);
                continue;
            }
            throw new Error(message);
        }

        const data = await response.json();
        const mapped = mapHunterRecruiters(data, titleHint).slice(0, limit);
        if (!mapped.length) {
            const target = companyDomain || companyName || "the selected company";
            throw new Error(`No Hunter recruiter contacts were found for ${target}; no fake contacts were saved`);
        }
        return mapped.map(({ confidence, verificationStatus, ...rest }) => rest);
    }

    throw new Error(
        `All ${keys.length} configured Hunter keys are out of credits or rate-limited. Last error: ${lastQuotaError}`
    );
}

/**
 * Hunter Domain Search for recruiters / talent partners at the selected company.
 * Results are limited to conserve credits and errors are propagated to the dashboard.
 */
export async function findRecruiters({ companyName, domain, titleHint = "Recruiter" } = {}) {
    try {
        return await searchHunterRecruiters({ companyName, domain, titleHint });
    } catch (error) {
        console.error("[enrichment] Hunter failed:", error.message);
        throw new Error(`Hunter recruiter search failed: ${error.message}`, { cause: error });
    }
}

export async function enrichJobOutreach(jobId, { emailBody = null } = {}) {
    const db = getDb();
    const job = db
        .prepare(
            `
            SELECT j.*, c.name AS company_name, c.domain AS company_domain
            FROM jobs j
            LEFT JOIN companies c ON c.id = j.company_id
            WHERE j.id = ?
            `
        )
        .get(jobId);

    if (!job) {
        throw new Error(`Job not found: ${jobId}`);
    }

    let outreachEmail = emailBody;
    if (!outreachEmail && job.resume_modifications) {
        try {
            outreachEmail = JSON.parse(job.resume_modifications).outreachEmail || null;
        } catch {
            outreachEmail = null;
        }
    }

    const recruiters = await findRecruiters({
        companyName: job.company_name,
        domain: job.company_domain
    });

    const insert = db.prepare(
        `
        INSERT INTO outreach (
            job_id, recruiter_name, recruiter_email, recruiter_title,
            linkedin_url, generated_email_body, status, updated_at
        ) VALUES (
            @jobId, @recruiterName, @recruiterEmail, @recruiterTitle,
            @linkedinUrl, @generatedEmailBody, 'DRAFT', CURRENT_TIMESTAMP
        )
        `
    );

    // Replace previous draft contacts for this job on re-approve
    db.prepare("DELETE FROM outreach WHERE job_id = ?").run(jobId);

    const saved = [];
    for (const recruiter of recruiters) {
        const info = insert.run({
            jobId,
            recruiterName: recruiter.recruiterName,
            recruiterEmail: recruiter.recruiterEmail,
            recruiterTitle: recruiter.recruiterTitle,
            linkedinUrl: recruiter.linkedinUrl,
            generatedEmailBody: outreachEmail
        });
        saved.push({ id: info.lastInsertRowid, ...recruiter, generatedEmailBody: outreachEmail });
    }

    return saved;
}
