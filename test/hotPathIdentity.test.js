import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { CANDIDATE_PERSONAS } from "./fixtures/candidate-personas.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("identity hot path fills profile facts and never plans legal or leftover essay fields", () => {
    const code = fs.readFileSync(path.join(root, "extension/adapters/common/identity.js"), "utf8");
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox);
    const planned = sandbox.JobHunterIdentity.plan([
        { id: "email", label: "Email", type: "email", value: "" },
        { id: "first", label: "First name", type: "text", value: "" },
        { id: "phone", label: "Mobile number", type: "tel", value: "" },
        { id: "why", label: "Why do you want to join?", type: "textarea", value: "" },
        { id: "consent", label: "I agree", type: "checkbox", legal: true, value: "" },
        { id: "resume", label: "Resume", type: "file", value: "" }
    ], {
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "9999999999"
    });
    assert.equal(JSON.stringify([...planned.filledIds].sort()), JSON.stringify(["email", "first", "phone"]));
    assert.equal(planned.actions.find((action) => action.fieldId === "email").value, "ada@example.com");
    assert.equal(planned.actions.find((action) => action.fieldId === "first").value, "Ada");
    assert.equal(planned.actions.some((action) => action.fieldId === "why"), false);
    assert.equal(planned.actions.some((action) => action.fieldId === "consent"), false);
});

test("identity hot path is deterministic across the persona matrix and never invents missing facts", () => {
    const code = fs.readFileSync(path.join(root, "extension/adapters/common/identity.js"), "utf8");
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code, sandbox);
    const fields = [
        { id: "first", label: "First name", type: "text", value: "" },
        { id: "last", label: "Last name", type: "text", value: "" },
        { id: "email", label: "Email", type: "email", value: "" },
        { id: "confirm-email", label: "Confirm your email", type: "email", value: "" },
        { id: "phone", label: "Phone number", type: "tel", value: "" },
        { id: "linkedin", label: "LinkedIn", type: "text", value: "" },
        { id: "facebook", label: "Facebook", type: "text", value: "" },
        { id: "twitter", label: "X (fka Twitter)", type: "text", value: "" },
        { id: "website", label: "Website", type: "text", value: "" },
        { id: "legal", label: "I certify this application", type: "checkbox", legal: true, value: "" }
    ];
    for (const persona of CANDIDATE_PERSONAS) {
        const planned = sandbox.JobHunterIdentity.plan(fields, persona);
        const byId = new Map(planned.actions.map((action) => [action.fieldId, action]));
        assert.equal(byId.get("first")?.value, persona.preferredFirstName || persona.name.split(/\s+/)[0], persona.id);
        assert.equal(byId.get("email")?.value, persona.email, persona.id);
        assert.equal(byId.get("phone")?.value, persona.phone, persona.id);
        assert.equal(byId.has("last"), Boolean(persona.preferredLastName || persona.name.split(/\s+/).length > 1), persona.id);
        assert.equal(byId.has("linkedin"), Boolean(persona.linkedinUrl), persona.id);
        assert.equal(byId.has("facebook"), false, persona.id);
        assert.equal(byId.has("twitter"), false, persona.id);
        assert.equal(byId.has("website"), false, persona.id);
        assert.equal(byId.has("legal"), false, persona.id);
    }
});

test("skipLlmOn blocks model calls for identity keys and allows leftover writing", async () => {
    const { allowAiForSemanticKey, DEFAULT_SKIP_LLM_ON } = await import("../src/adapters/hotPath.js");
    assert.equal(allowAiForSemanticKey("EMAIL"), false);
    assert.equal(allowAiForSemanticKey("RESUME", { hotPath: { skipLlmOn: DEFAULT_SKIP_LLM_ON } }), false);
    assert.equal(allowAiForSemanticKey("WEBSITE_URL", { hotPath: { skipLlmOn: [] } }), false);
    assert.equal(allowAiForSemanticKey("SOCIAL_FACEBOOK_URL"), false);
    assert.equal(allowAiForSemanticKey("SOCIAL_TWITTER_URL"), false);
    assert.equal(allowAiForSemanticKey("WHY_JOIN"), true);
    assert.equal(allowAiForSemanticKey("CUSTOM_FIELD"), true);
});

test("resolveQuestion with allowAi false never invents identity leftovers", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-hotpath-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { resolveQuestion } = await import("../src/services/questionResolver.js");
    try {
        getDb();
        const profileHit = await resolveQuestion("Email", {
            profile: { email: "ada@example.com" },
            resume: {},
            allowAi: false
        });
        assert.equal(profileHit.answer, "ada@example.com");
        assert.equal(profileHit.source, "PROFILE");
        const leftover = await resolveQuestion("Why do you want this role?", {
            profile: { email: "ada@example.com" },
            resume: {},
            allowAi: false
        });
        assert.equal(leftover.answer, null);
        assert.equal(leftover.source, "LOCAL_ONLY");
        const social = await resolveQuestion("Facebook", {
            profile: {}, resume: {}, allowAi: false
        });
        assert.equal(social.normalizedKey, "SOCIAL_FACEBOOK_URL");
        assert.equal(social.answer, null);
        assert.equal(social.source, "LOCAL_ONLY");
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
