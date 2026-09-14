import path from "path";
import express from "express";
import { env, loadEnvironment } from "./config/environment.js";
import { getDb } from "./database/connection.js";
import dashboardRouter from "./routes/dashboard.js";
import copilotRouter from "./routes/copilot.js";
import extensionRouter from "./routes/extension.js";
import apiV1Router from "./routes/apiV1.js";
import { startAgentWorker } from "./services/agentWorker.js";
import { backfillJobRegistry } from "./services/jobRegistryBackfill.js";
import { ensureAnswerPolicyRegistry } from "./services/answerPolicyRegistry.js";
import { ensureSafeLegacyCandidateTruthMigration } from "./services/candidateAnswerLegacyMigrationService.js";

loadEnvironment();
const database = getDb();
ensureAnswerPolicyRegistry();
try {
    const migration = ensureSafeLegacyCandidateTruthMigration();
    if (!migration.idempotentReplay && migration.migrated) {
        console.log(`[candidate-truth] Safely migrated ${migration.migrated} legacy fact(s) into SHADOW truth.`);
    }
} catch (error) {
    console.warn(`[candidate-truth] Safe legacy migration did not run (${error?.code || error?.name || "UNKNOWN_ERROR"}).`);
}
const normalizedJobs = backfillJobRegistry(database);
if (normalizedJobs) console.log(`[registry] Normalized ${normalizedJobs} legacy job record(s).`);

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(env.rootDir, "src", "views"));

app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json());
const allowedOrigins = new Set([...env.frontendOrigins, ...env.extensionOrigins]);
app.use((req, res, next) => {
    const origin = String(req.headers.origin || "");
    if (origin && req.path.startsWith("/api/v1") && !allowedOrigins.has(origin)) {
        return res.status(403).json({ error: "Origin is not allowed for the local API." });
    }
    if (origin && allowedOrigins.has(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
        res.set("Access-Control-Allow-Credentials", "true");
        res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
        res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});
app.get("/health", (_req, res) => res.json({ ok: true, service: "job-hunter-agent" }));
app.use("/api/v1", apiV1Router);
app.use(extensionRouter);
app.use(copilotRouter);
app.use(dashboardRouter);

app.use((err, _req, res, _next) => {
    console.error("[server]", err);
    res.status(500).send("Internal Server Error");
});

app.listen(env.port, env.host, () => {
    console.log(`[server] Job Hunter dashboard running at http://${env.host}:${env.port}`);
    startAgentWorker();
});
