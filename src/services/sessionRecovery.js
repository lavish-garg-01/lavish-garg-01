import { addApplicationEvent, getApplicationByJobId, updateApplicationStatus } from "../repositories/applicationRepository.js";
import { recordLearningEvent, upsertAttentionItem } from "../repositories/attentionRepository.js";
import { completeApplicationAttempt } from "../repositories/learningRepository.js";

/**
 * A browser restart destroys Chrome tab ids while the local session survives in
 * extension storage. Either the application tab comes back and is rebound, or
 * the application is parked in the Attention Center so it is never silently
 * lost while still looking active.
 */
export function recoverExtensionSession({ jobId, pageUrl = "", rebound = false } = {}) {
    const application = getApplicationByJobId(jobId);
    if (!application) throw new Error("Application not found.");
    if (application.status === "SUCCESS") return { recovered: false, alreadySubmitted: true };
    const page = String(pageUrl || "");
    const wasRebound = rebound === true;
    const reason = wasRebound
        ? "Chrome restarted and the open application tab was rebound to this session."
        : "Chrome restarted without the application tab, so this application is waiting in the Attention Center.";

    addApplicationEvent(application.id, "SESSION_RECOVERED", reason, {
        metadata: { pageUrl: page, rebound: wasRebound, reason: "CHROME_RESTARTED", automationEligible: false }
    });
    recordLearningEvent({
        type: "SESSION_RECOVERED",
        applicationId: application.id,
        metadata: { source: "CHROME_RESTART", reason }
    });

    if (!wasRebound) {
        updateApplicationStatus(application.id, "WAITING_FOR_USER", reason, {
            metadata: { pageUrl: page, reason: "CHROME_RESTARTED" }
        });
        completeApplicationAttempt(application.id, {
            status: "PENDING_REVIEW",
            confirmationSource: "CHROME_RESTARTED",
            pageUrl: page
        });
        upsertAttentionItem(application.id, {
            fieldId: "__session_recovery__",
            type: "SUBMISSION_REVIEW",
            title: "Continue this application after the browser restart?",
            reason: "The browser restarted before submission could be verified. Reopen the application or confirm what happened.",
            semanticKey: "APPLICATION_SUBMISSION_STATUS",
            answerScope: "APPLICATION_ONLY",
            priority: 90,
            blocking: true,
            pageUrl: page
        });
    }

    return { recovered: true, rebound: wasRebound, applicationId: application.id };
}
