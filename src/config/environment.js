import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { CONNECTED_JOBS_POLICY } from "./connectedJobsPolicy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootDir, ".env") });

const DEFAULT_GREENHOUSE_BOARDS = "postman";
const DEFAULT_LEVER_COMPANIES = "";
const DEFAULT_ASHBY_BOARDS = "";

const DEFAULT_JOBSPY_COMMAND =
    './.venv/bin/python scripts/jobspy_cli.py --site linkedin,indeed --search_term "backend engineer" --results_wanted 25 --country india';

function splitCsv(value = "") {
    return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
}

function requireWhen(condition, key) {
    if (condition && !process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

function policyLockedNumber(key, expected) {
    const configured = process.env[key];
    if (configured === undefined || configured === "") return expected;
    const parsed = Number(configured);
    if (parsed !== expected) {
        throw new Error(`${key} is locked to ${expected} by Connected Jobs policy v${CONNECTED_JOBS_POLICY.version}; received ${configured}.`);
    }
    return expected;
}

export function loadEnvironment({ requireOpenAI = false, requireHunter = false } = {}) {
    requireWhen(requireOpenAI, "OPENAI_API_KEY");
    if (requireHunter && !process.env.HUNTER_API_KEYS && !process.env.HUNTER_API_KEY) {
        throw new Error("Missing required environment variable: HUNTER_API_KEYS or HUNTER_API_KEY");
    }

    const greenhouseRaw = process.env.GREENHOUSE_BOARDS;
    const leverRaw = process.env.LEVER_COMPANIES;

    const config = {
        rootDir,
        port: Number(process.env.PORT || 3000),
        host: process.env.HOST || "127.0.0.1",
        appMode: process.env.APP_MODE || "local",
        frontendOrigins: splitCsv(process.env.FRONTEND_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000"),
        extensionOrigins: splitCsv(process.env.EXTENSION_ORIGINS || ""),
        applicationSchema: {
            freshDays: Math.max(1, Number(process.env.APPLICATION_SCHEMA_FRESH_DAYS || 3)),
            expiryDays: Math.max(3, Number(process.env.APPLICATION_SCHEMA_EXPIRY_DAYS || 7))
        },
        matchThreshold: Number(process.env.MATCH_THRESHOLD || 80),
        closeMinScore: Number(process.env.CLOSE_MIN_SCORE || 70),
        prefilterMinScore: Number(process.env.PREFILTER_MIN_SCORE || 40),
        openaiApiKey: process.env.OPENAI_API_KEY || "",
        openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
        market: {
            region: "india",
            currency: "INR",
            salaryUnit: "LPA",
            lpaToInr: 100000
        },
        /** 0 = do not filter by notice period. */
        candidateNoticeDays: Number(process.env.CANDIDATE_NOTICE_DAYS ?? 0),
        candidateEmail: process.env.CANDIDATE_EMAIL || "",
        ingestion: {
            maxJobAgeDays: policyLockedNumber("MAX_JOB_AGE_DAYS", CONNECTED_JOBS_POLICY.discovery.eligibleThroughDays),
            duplicateSimilarityThreshold: Number(process.env.DUPLICATE_SIMILARITY_THRESHOLD || 0.95)
        },
        hunterApiKeys: splitCsv(process.env.HUNTER_API_KEYS || process.env.HUNTER_API_KEY || ""),
        hunterRecruiterLimit: Math.min(5, Math.max(1, Number(process.env.HUNTER_RECRUITER_LIMIT || 2))),
        copilot: {
            allowRealSubmission: false,
            allowRealPreparation: String(process.env.ALLOW_REAL_APPLICATION_PREPARATION || process.env.ALLOW_REAL_SUBMISSION || "false").toLowerCase() === "true",
            maxRealApplicationsPerDay: Math.max(1, Number(process.env.MAX_REAL_APPLICATIONS_PER_DAY || 5)),
            playwrightHeadless: String(process.env.PLAYWRIGHT_HEADLESS || "false").toLowerCase() === "true",
            workerPollMs: Math.max(500, Number(process.env.AGENT_WORKER_POLL_MS || 2000))
        },
        privacy: {
            aiProcessingEnabled: String(process.env.AI_PROCESSING_ENABLED || "false").toLowerCase() === "true"
        },
        canonicalization: {
            semanticSearchEnabled: String(process.env.CANONICAL_SEMANTIC_SEARCH_ENABLED || "true").toLowerCase() === "true",
            embeddingsEnabled: String(process.env.CANONICAL_EMBEDDINGS_ENABLED || "false").toLowerCase() === "true",
            aiEnabled: String(process.env.CANONICAL_AI_ENABLED || process.env.AI_PROCESSING_ENABLED || "false").toLowerCase() === "true",
            newProposalsEnabled: String(process.env.CANONICAL_NEW_PROPOSALS_ENABLED || "true").toLowerCase() === "true",
            aiDailyLimit: Math.max(0, Number(process.env.CANONICAL_AI_DAILY_LIMIT || 200)),
            deterministicAcceptConfidence: Math.min(1, Math.max(0.5, Number(process.env.CANONICAL_DETERMINISTIC_CONFIDENCE || 0.9))),
            semanticAcceptConfidence: Math.min(1, Math.max(0.5, Number(process.env.CANONICAL_SEMANTIC_CONFIDENCE || 0.88))),
            aiAcceptConfidence: Math.min(1, Math.max(0.5, Number(process.env.CANONICAL_AI_CONFIDENCE || 0.85)))
        },
        greenhouseBoards: splitCsv(
            greenhouseRaw !== undefined && greenhouseRaw !== ""
                ? greenhouseRaw
                : DEFAULT_GREENHOUSE_BOARDS
        ),
        leverCompanies: splitCsv(
            leverRaw !== undefined && leverRaw !== "" ? leverRaw : DEFAULT_LEVER_COMPANIES
        ),
        ashbyBoards: splitCsv(process.env.ASHBY_BOARDS || DEFAULT_ASHBY_BOARDS),
        indiaAggregators: {
            naukriEnabled: String(process.env.NAUKRI_ENABLED || "false").toLowerCase() === "true",
            instahyreEnabled: String(process.env.INSTAHYRE_ENABLED || "false").toLowerCase() === "true",
            hiristEnabled: String(process.env.HIRIST_ENABLED || "false").toLowerCase() === "true",
            cutshortEnabled: String(process.env.CUTSHORT_ENABLED || "false").toLowerCase() === "true",
            wellfoundEnabled: String(process.env.WELLFOUND_ENABLED || "false").toLowerCase() === "true"
        },
        firecrawl: {
            apiKey: process.env.FIRECRAWL_API_KEY || "",
            enabled: String(process.env.FIRECRAWL_ENABLED || "false").toLowerCase() === "true",
            urls: splitCsv(process.env.FIRECRAWL_URLS || ""),
            maxJobs: Number(process.env.FIRECRAWL_MAX_JOBS || 40),
            // Hobby plans are ~15 req/min. Shared limiter keeps concurrent collectors under that.
            minIntervalMs: Number.isFinite(Number(process.env.FIRECRAWL_MIN_INTERVAL_MS))
                ? Math.max(0, Number(process.env.FIRECRAWL_MIN_INTERVAL_MS))
                : 4500,
            maxRetries: Number.isFinite(Number(process.env.FIRECRAWL_MAX_RETRIES))
                ? Math.max(0, Number(process.env.FIRECRAWL_MAX_RETRIES))
                : 2
        },
        jobspy: {
            enabled: String(process.env.JOBSPY_ENABLED || "false").toLowerCase() === "true",
            country: process.env.JOBSPY_COUNTRY || "india",
            command: process.env.JOBSPY_COMMAND || DEFAULT_JOBSPY_COMMAND
        },
        targetTitles: splitCsv(
            process.env.TARGET_TITLES || "Backend Engineer,Node.js Engineer,Software Engineer"
        ),
        targetLocations: splitCsv(
            process.env.TARGET_LOCATIONS ||
                "Remote,Gurugram,Delhi,Noida,Pune,Hyderabad,Bengaluru"
        ),
        paths: {
            db: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(rootDir, "data", "jobs.db"),
            schema: path.join(rootDir, "src", "database", "schema.sql"),
            masterResume: path.join(rootDir, "data", "master_resume.json"),
            output: path.join(rootDir, "output"),
            storage: process.env.STORAGE_PATH ? path.resolve(process.env.STORAGE_PATH) : path.join(rootDir, "storage"),
            resumeTemplate: path.join(rootDir, "src", "templates", "resumes", "ats.html")
        }
    };

    return config;
}

export const env = loadEnvironment();
