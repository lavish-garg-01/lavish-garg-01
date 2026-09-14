import { getDb } from "../database/connection.js";
import { finalizeIngestionRun, runIngestion } from "./ingestion.js";
import { processPendingJobs } from "./openai.js";
import { refreshLifecycleBatch } from "./jobLifecycle.js";

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
let running = false;
let latestRun = null;

export function parseProcessLimit(value, fallback = 10) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
        throw new Error(`Number to process must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}.`);
    }
    return parsed;
}

export function archiveStaleJobs(db = getDb()) {
    // Compatibility name for existing dashboard callers. Discovery age now
    // controls visibility; it must never mutate the scoring workflow status.
    return refreshLifecycleBatch(db).closedByDeadline;
}

async function exclusiveRun(work) {
    if (running) {
        throw new Error("A dashboard processing run is already in progress. Please wait for it to finish.");
    }
    running = true;
    try {
        return await work();
    } finally {
        running = false;
    }
}

export async function processPendingFromDashboard(limit) {
    return exclusiveRun(async () => {
        const archived = archiveStaleJobs();
        const scoring = await processPendingJobs({ limit });
        return { archived, scoring };
    });
}

export async function searchAndProcessFromDashboard(limit) {
    return exclusiveRun(async () => {
        const archived = archiveStaleJobs();
        const ingestion = await runIngestion({ selectionLimit: limit });
        const scoring = await processPendingJobs({ limit, jobIds: ingestion.selectedIds });
        finalizeIngestionRun(ingestion.runId, ingestion.selectedIds);
        return { archived, ingestion, scoring };
    });
}

function publicRun(run = latestRun) {
    if (!run) return { status: "IDLE" };
    return {
        id: run.id, kind: run.kind, limit: run.limit, status: run.status,
        startedAt: run.startedAt, completedAt: run.completedAt || null,
        result: run.result || null, error: run.error || null
    };
}

export function getPipelineRunState() {
    return publicRun();
}

export function launchPipelineRun(kind, limit, runners = {}) {
    const safeKind = String(kind || "").toUpperCase();
    const safeLimit = parseProcessLimit(limit);
    if (running) throw new Error("A dashboard processing run is already in progress. Please wait for it to finish.");
    if (!new Set(["PENDING", "SEARCH"]).has(safeKind)) throw new Error("Unknown pipeline run type.");
    const pendingRunner = runners.pending || (async () => {
        const archived = archiveStaleJobs();
        const scoring = await processPendingJobs({ limit: safeLimit });
        return { archived, scoring };
    });
    const searchRunner = runners.search || (async () => {
        const archived = archiveStaleJobs();
        const ingestion = await runIngestion({ selectionLimit: safeLimit });
        const scoring = await processPendingJobs({ limit: safeLimit, jobIds: ingestion.selectedIds });
        finalizeIngestionRun(ingestion.runId, ingestion.selectedIds);
        return { archived, ingestion, scoring };
    });
    latestRun = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: safeKind, limit: safeLimit, status: "RUNNING", startedAt: new Date().toISOString()
    };
    running = true;
    const active = latestRun;
    void (async () => {
        try {
            active.result = await (safeKind === "PENDING" ? pendingRunner() : searchRunner());
            active.status = "COMPLETE";
        } catch (error) {
            active.status = "FAILED";
            active.error = String(error?.message || error);
        } finally {
            active.completedAt = new Date().toISOString();
            running = false;
        }
    })();
    return publicRun(active);
}
