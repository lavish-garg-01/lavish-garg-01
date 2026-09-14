import { env } from "../config/environment.js";
import {
    claimNextTask,
    failTask,
    finishTask,
    getApplication,
    updateApplicationStatus
} from "../repositories/applicationRepository.js";
import { cleanupDebugScreenshots, runApplication } from "./applicationEngine.js";

let timer = null;
let busy = false;

async function tick() {
    if (busy) return;
    const task = claimNextTask();
    if (!task) return;
    busy = true;
    try {
        if (["PREPARE_APPLICATION", "RESUME_APPLICATION"].includes(task.type)) {
            await runApplication(task.payload.applicationId);
        } else {
            throw new Error(`Unsupported agent task type: ${task.type}`);
        }
        finishTask(task.id);
    } catch (error) {
        failTask(task, error);
        const application = task.payload.applicationId ? getApplication(task.payload.applicationId) : null;
        if (application && application.status !== "FAILED") {
            updateApplicationStatus(application.id, "FAILED", "Background task failed.", { failureReason: error.message });
        }
        console.error(`[agent-worker:${task.type}]`, error.message);
    } finally {
        busy = false;
    }
}

export function startAgentWorker() {
    if (timer) return timer;
    cleanupDebugScreenshots();
    timer = setInterval(() => void tick(), env.copilot.workerPollMs);
    timer.unref?.();
    return timer;
}

export function stopAgentWorker() {
    if (timer) clearInterval(timer);
    timer = null;
}

export async function runWorkerOnce() {
    await tick();
}
