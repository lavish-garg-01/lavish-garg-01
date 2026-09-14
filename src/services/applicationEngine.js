import fs from "fs";
import path from "path";
import { env } from "../config/environment.js";
import {
    getApplication,
    getJobForApplication,
    listApplicationQuestions,
    listPendingQuestions,
    savePendingQuestion,
    saveResolvedQuestion,
    updateApplicationStatus
} from "../repositories/applicationRepository.js";
import { getAutoApplySettings, getCandidateProfile, saveCandidateAnswer } from "../repositories/copilotRepository.js";
import { loadResume } from "./resumeStore.js";
import { applicationPage } from "./browserManager.js";
import { resolveQuestion } from "./questionResolver.js";
import { TestApplicationAdapter } from "../adapters/testApplicationAdapter.js";
import { RealApplicationAdapter } from "../adapters/realApplicationAdapter.js";
import { evaluateMatchingPolicy } from "./matchingPolicy.js";
import { currentCandidateMatchingProfile, matchBlockingReason } from "./currentCandidateMatching.js";

function screenshotPath(applicationId) {
    const directory = path.join(env.paths.storage, "screenshots");
    fs.mkdirSync(directory, { recursive: true });
    return path.join(directory, `${applicationId}_${Date.now()}.png`);
}

export function cleanupDebugScreenshots({ maxAgeDays = 7 } = {}) {
    const directory = path.join(env.paths.storage, "screenshots");
    if (!fs.existsSync(directory)) return 0;
    const cutoff = Date.now() - maxAgeDays * 86400000;
    let removed = 0;
    for (const name of fs.readdirSync(directory)) {
        const filePath = path.join(directory, name);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            removed += 1;
        }
    }
    return removed;
}

function adapterFor(application, page) {
    if (application.adapter === "REAL_WEB") return new RealApplicationAdapter(page);
    return new TestApplicationAdapter(page, `http://127.0.0.1:${env.port}`);
}

export async function runApplication(applicationId, { explicitSubmit = false } = {}) {
    const application = getApplication(applicationId);
    if (!application) throw new Error("Application not found.");
    const preflightJob = getJobForApplication(application.job_id) || {};
    const preflightProfile = getCandidateProfile();
    const preflightResume = loadResume();
    const preflightDecision = evaluateMatchingPolicy(preflightJob, preflightResume, {
        ...preflightProfile,
        ...currentCandidateMatchingProfile()
    }, { context: "APPLICATION", saved: true });
    if (preflightDecision.eligibility.status === "INELIGIBLE") {
        const reason = matchBlockingReason(preflightDecision);
        return updateApplicationStatus(applicationId, "BLOCKED", reason, {
            failureReason: reason,
            metadata: { matchingDecision: preflightDecision }
        });
    }
    const page = await applicationPage(applicationId);
    const adapter = adapterFor(application, page);

    try {
        updateApplicationStatus(applicationId, "OPENING", application.adapter === "REAL_WEB"
            ? "Opening the real job application page."
            : "Opening the local test application form.");
        await adapter.open(application);

        const initialState = adapter.pageState
            ? await adapter.pageState()
            : { captcha: /captcha/i.test(await adapter.page.locator("body").innerText()), login: false };
        if (initialState.captcha) {
            return updateApplicationStatus(applicationId, "CAPTCHA_REQUIRED", "CAPTCHA detected; complete it manually and resume.");
        }
        if (initialState.login) {
            return updateApplicationStatus(applicationId, "LOGIN_REQUIRED", "Sign in in the visible browser, then choose Retry / continue.");
        }

        const profile = preflightProfile;
        const resume = preflightResume;
        const job = preflightJob;
        const settings = getAutoApplySettings();
        const confidenceThreshold = 0.7;
        const existingAnswers = new Map(
            listApplicationQuestions(applicationId)
                .filter((question) => question.status === "ANSWERED" && question.answer != null)
                .map((question) => [question.field_id, question])
        );
        for (let step = 1; step <= 8; step += 1) {
            updateApplicationStatus(applicationId, "FORM_DETECTED", `Application form step ${step} detected.`);
            const fields = await adapter.detectFields();
            if (!fields.length) {
                return updateApplicationStatus(applicationId, "PORTAL_CHANGED", "No application fields were detected on the current page.");
            }
            updateApplicationStatus(applicationId, "FIELDS_ANALYZED", `Detected ${fields.length} field(s) on step ${step}.`, {
                metadata: { step, fieldIds: fields.map((field) => field.id) }
            });
            updateApplicationStatus(applicationId, "FILLING", `Filling step ${step} from verified candidate facts.`);

            const resumeField = fields.find((field) => field.type === "file");
            if (resumeField) {
                if (!application.generated_resume_path || !fs.existsSync(application.generated_resume_path)) {
                    throw new Error("The selected/default tailored resume PDF is missing.");
                }
                await adapter.uploadResume(application.generated_resume_path);
            }
            let unknown = 0;
            for (const field of fields) {
                if (field.type === "file") continue;
                if (field.value && !["checkbox", "radio"].includes(field.type)) {
                    saveResolvedQuestion(applicationId, field, {
                        normalizedKey: `SITE_PREFILLED_${field.id}`.slice(0, 80),
                        answer: field.value,
                        confidence: 1,
                        source: "SITE_PREFILLED",
                        evidence: "This value was already present in the candidate's job-site form."
                    });
                    continue;
                }
                if (field.type === "checkbox" && !field.required) continue;
                const previous = existingAnswers.get(field.id);
                const resolved = previous
                    ? {
                          normalizedKey: previous.question_key,
                          answer: previous.answer,
                          confidence: Number(previous.confidence || 1),
                          source: previous.source || "APPLICATION_DRAFT",
                          evidence: previous.evidence || "Saved for this application.",
                          requiresUserInput: false
                      }
                    : await resolveQuestion(field.label, { profile, resume, job, field });
                if (resolved.requiresUserInput || resolved.answer == null || resolved.confidence < confidenceThreshold) {
                    if (!field.required) continue;
                    savePendingQuestion(applicationId, field, resolved);
                    unknown += 1;
                    continue;
                }
                await adapter.fillField(field, resolved.answer);
                saveResolvedQuestion(applicationId, field, resolved);
                if (resolved.persistForReuse) {
                    saveCandidateAnswer({
                        questionKey: resolved.normalizedKey,
                        originalQuestion: field.label,
                        answer: resolved.answer,
                        confidence: resolved.confidence,
                        source: resolved.source,
                        evidence: resolved.evidence
                    });
                }
            }

            if (unknown > 0) {
                return updateApplicationStatus(
                    applicationId,
                    "WAITING_FOR_USER",
                    `${unknown} question(s) on step ${step} need your answer before preparation can continue.`,
                    { metadata: { step, pendingQuestionCount: unknown } }
                );
            }

            const remaining = listPendingQuestions(applicationId);
            if (remaining.length) {
                return updateApplicationStatus(applicationId, "WAITING_FOR_USER", `${remaining.length} question(s) are still pending.`);
            }

            const validation = await adapter.validate();
            if (!validation.valid) {
                return updateApplicationStatus(applicationId, "UNKNOWN_FIELD", "Required form fields remain incomplete.", {
                    metadata: { step, ...validation }
                });
            }
            if (!(await adapter.hasNextStep?.())) break;
            await adapter.nextStep();
            const state = await adapter.pageState?.();
            if (state?.captcha) return updateApplicationStatus(applicationId, "CAPTCHA_REQUIRED", "CAPTCHA detected; complete it manually and resume.");
            if (state?.login) return updateApplicationStatus(applicationId, "LOGIN_REQUIRED", "Sign in in the visible browser, then choose Retry / continue.");
            if (step === 8) return updateApplicationStatus(applicationId, "PORTAL_CHANGED", "The application exceeded eight form steps and was stopped for review.");
        }

        updateApplicationStatus(
            applicationId,
            "READY_TO_SUBMIT",
            application.adapter === "REAL_WEB"
                ? "All known fields and the tailored resume are filled on the real job site. Review before submitting."
                : "All known fields and the tailored resume are filled. Review the visible browser before submitting."
        );

        // Review-only policy: the automation never clicks a final submit control.
        return getApplication(applicationId);
    } catch (error) {
        let screenshot = null;
        try {
            screenshot = screenshotPath(applicationId);
            await adapter.page.screenshot({ path: screenshot, fullPage: true });
        } catch {
            screenshot = null;
        }
        updateApplicationStatus(applicationId, "FAILED", "Application preparation failed.", {
            failureReason: error.message,
            metadata: screenshot ? { screenshot } : {}
        });
        throw error;
    }
}
