import assert from "node:assert/strict";
import test from "node:test";
import { answerSidePanelQuestion } from "../src/services/sidePanelAssistant.js";

test("Ask AI returns direct profile facts locally without sending identifiers to a model", async () => {
    const answer = await answerSidePanelQuestion("What is my email address?", {
        profile: { email: "candidate@example.com", aiProcessingConsent: false }
    });
    assert.equal(answer.answer, "candidate@example.com");
    assert.equal(answer.source, "LOCAL_PROFILE");
    assert.equal(answer.copyReady, true);
});

test("Ask AI explains the latest autofill outcome from value-free application evidence", async () => {
    const answer = await answerSidePanelQuestion("Why did autofill leave fields unresolved?", {
        profile: { aiProcessingConsent: false },
        application: {
            fields: [
                { label: "First name", state: "FILLED" },
                { label: "Resume", state: "UNCHANGED" },
                { label: "Gender", state: "BLOCKED", sensitive: true }
            ],
            failures: [{ phase: "DOCUMENT", errorCode: "ATS_CLEARED_FILE" }]
        }
    });
    assert.equal(answer.source, "LOCAL_APPLICATION");
    assert.match(answer.answer, /completed 1 of 3/i);
    assert.match(answer.answer, /ATS_CLEARED_FILE/);
});

test("Ask AI never chooses a legal or sensitive answer", async () => {
    const answer = await answerSidePanelQuestion("Should I certify that this application is accurate?", {
        profile: { aiProcessingConsent: true }
    });
    assert.equal(answer.source, "SAFETY_GUARD");
    assert.equal(answer.safety, "CANDIDATE_REQUIRED");
    assert.equal(answer.copyReady, false);
    assert.equal(answer.needsCandidateInput, true);
});

test("Ask AI requires the opt-in toggle for general model questions", async () => {
    const answer = await answerSidePanelQuestion("Summarize my strongest engineering evidence.", {
        profile: { aiProcessingConsent: false },
        resume: { summary: "Backend engineer", skills: ["Node.js"] }
    });
    assert.equal(answer.source, "AI_DISABLED");
    assert.match(answer.answer, /AI enhancement is off/i);
});
