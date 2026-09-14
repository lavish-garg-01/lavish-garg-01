import crypto from "crypto";
import { loadEnvironment } from "./config/environment.js";
import { getDb, closeDb } from "./database/connection.js";
import { finalizeIngestionRun, runIngestion } from "./services/ingestion.js";
import { processPendingJobs } from "./services/openai.js";

async function main() {
    const started = Date.now();
    const sessionId = crypto.randomUUID();

    // Validate optional keys softly; pipeline can run with mocks.
    loadEnvironment();
    getDb();

    console.log(`[pipeline] start session=${sessionId}`);

    try {
        const ingestion = await runIngestion({ selectionLimit: 50 });
        console.log(
            `[pipeline] ingestion fetched=${ingestion.fetched} inserted=${ingestion.inserted}`
        );

        const scoring = await processPendingJobs({ limit: 50, jobIds: ingestion.selectedIds });
        finalizeIngestionRun(ingestion.runId, ingestion.selectedIds);
        console.log(
            `[pipeline] scoring scanned=${scoring.scanned} matched=${scoring.matched} close=${scoring.close} prefiltered=${scoring.prefiltered} rejected=${scoring.rejected}`
        );

        console.log(`[pipeline] done ms=${Date.now() - started}`);
    } catch (error) {
        console.error("[pipeline] fatal:", error);
        process.exitCode = 1;
    } finally {
        closeDb();
    }
}

main();
