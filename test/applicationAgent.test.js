import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    classifyAgentField,
    mappingPrompt,
    readinessStatus,
    safeStructuralMapping
} from "../src/services/applicationAgent.js";
import { APPLICATION_STATUSES } from "../src/repositories/applicationRepository.js";
import { structuralMappingInput } from "../src/routes/extension.js";

test("Teach Mode presents a one-field yes/no mapping confirmation", () => {
    const prompt = mappingPrompt("Current(or last) CTC", "CURRENT_CTC");
    assert.match(prompt, /I found a required field labelled:/);
    assert.match(prompt, /Current\(or last\) CTC/);
    assert.match(prompt, /Does this field represent:/);
    assert.match(prompt, /Current CTC/);
});

test("current build keeps legal consent manual and never stores it as candidate memory", () => {
    const result = classifyAgentField({ label: "I accept the privacy consent", type: "checkbox" }, "PRIVACY_CONSENT");
    assert.deepEqual(result, { kind: "legal", scope: "NEVER_PERSIST", autoFill: false });
});

test("CAPTCHA challenges are protected and never autofilled or persisted", () => {
    const result = classifyAgentField({ label: "Captcha", name: "captcha", type: "text" }, "CUSTOM_FIELD");
    assert.deepEqual(result, { kind: "sensitive", scope: "NEVER_PERSIST", autoFill: false });
});

test("missing start date remains application-only", () => {
    const result = classifyAgentField({ label: "Available start date", type: "date" }, "START_DATE");
    assert.equal(result.kind, "volatile");
    assert.equal(result.scope, "APPLICATION_ONLY");
    assert.equal(result.autoFill, false);
});

test("job-specific travel and role compensation choices remain application-only", () => {
    assert.equal(classifyAgentField({ label: "Up to 10%", type: "checkbox" }, "UP_TO_10").scope, "APPLICATION_ONLY");
    assert.equal(classifyAgentField({ label: "How much are you willing to travel?", type: "checkbox-group" }, "TRAVEL").scope, "APPLICATION_ONLY");
    assert.equal(classifyAgentField({ label: "Compensation expectations for this role", type: "text" }, "EXPECTED_CTC").scope, "APPLICATION_ONLY");
});

test("readiness becomes automatic only after successful validation", () => {
    const incomplete = readinessStatus({ fields: [{ id: "name", required: true, filled: false, valid: true }] });
    assert.equal(incomplete.status, "WAITING_FOR_USER");
    const legal = readinessStatus({ fields: [{ id: "consent", required: true, legal: true, confirmed: false, filled: false }] });
    assert.equal(legal.status, "USER_ACTION_REQUIRED");
    const ready = readinessStatus({ fields: [{ id: "name", required: true, filled: true, valid: true, exactOptionMatch: true }] });
    assert.equal(ready.status, "READY_TO_SUBMIT");
    assert.equal(ready.state, "READY_FOR_REVIEW");
});

test("application persistence accepts the deterministic plan-ready state", () => {
    assert.equal(APPLICATION_STATUSES.has("PLAN_READY"), true);
});

test("shared structural mappings cannot contain raw candidate values", () => {
    const mapping = safeStructuralMapping({
        id: "m1", siteHost: "jobs.lever.co", fieldSignature: "ctc|textarea", fieldLabel: "Current(or last) CTC",
        semanticKey: "CURRENT_CTC", status: "LOCAL_DRAFT", answer: "14", rawValue: "14"
    });
    assert.equal(mapping.semanticKey, "CURRENT_CTC");
    assert.equal(mapping.status, "LOCAL_DRAFT");
    assert.equal("answer" in mapping, false);
    assert.equal("rawValue" in mapping, false);
});

test("mapping save has structural fallbacks for embedded forms", () => {
    assert.deepEqual(structuralMappingInput({}, { field_id: "ext:city", prompt: "Location (City)" }), {
        siteHost: "unknown-site",
        fieldSignature: "field-id|ext:city",
        fieldLabel: "Location (City)"
    });
});

test("Yes and custom No teaching paths create LOCAL_DRAFT structural mappings", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-agent-teach-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb } = await import("../src/database/connection.js");
    const { saveLocalDraftMapping } = await import("../src/repositories/agentRepository.js");
    try {
        const lever = saveLocalDraftMapping({
            siteHost: "jobs.lever.co", fieldSignature: "ctc|textarea|current(or last) ctc",
            fieldLabel: "Current(or last) CTC", semanticKey: "CURRENT_CTC"
        });
        assert.equal(lever.semanticKey, "CURRENT_CTC");
        assert.equal(lever.status, "LOCAL_DRAFT");
        const custom = saveLocalDraftMapping({
            siteHost: "jobs.example.com", fieldSignature: "screening|text|desired package",
            fieldLabel: "Desired package", semanticKey: "EXPECTED_CTC"
        });
        assert.equal(custom.semanticKey, "EXPECTED_CTC");
        assert.equal(custom.status, "LOCAL_DRAFT");
        assert.equal("answer" in custom, false);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
