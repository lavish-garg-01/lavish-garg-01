import assert from "node:assert/strict";
import test from "node:test";
import { reconcileResumeProfile } from "../src/services/resumeProfileReconciliation.js";

test("resume reconciliation reports conflicts without silently changing either source", () => {
    const result = reconcileResumeProfile({
        name: "Asha Rao", email: "asha@example.com", phone: "+91 99999 11111",
        currentLocation: "Bengaluru", currentCompany: "NewCo", noticePeriodDays: 30
    }, {
        fullName: "Asha Rao", email: "ASHA@example.com", phone: "9999911111",
        location: "Gurgaon", noticePeriodDays: 60,
        experience: [{ company: "OldCo", endDate: "Present" }]
    });
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.deepEqual(result.conflicts.map((item) => item.semanticKey), ["CURRENT_LOCATION", "CURRENT_COMPANY", "NOTICE_PERIOD"]);
    assert.equal(result.autoUpdated, false);
    assert.equal(result.conflicts[0].decisionRequired, true);
});

test("resume reconciliation normalizes harmless email, phone, and URL formatting", () => {
    const result = reconcileResumeProfile({
        name: "Asha Rao", email: "asha@example.com", phone: "+91 99999 11111",
        linkedinUrl: "https://linkedin.com/in/asha/", noticePeriodDays: 30
    }, {
        fullName: "Asha Rao", email: "ASHA@example.com", phone: "919999911111",
        linkedin: "linkedin.com/in/asha", noticePeriodDays: 30
    });
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.autoUpdated, false);
});
