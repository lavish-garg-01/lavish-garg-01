import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { applyExperienceEligibility } from "../src/services/experienceEligibility.js";
import { CANDIDATE_PERSONAS } from "./fixtures/candidate-personas.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAJOR_PORTALS = [
    "rippling", "greenhouse", "workday", "keka", "lever", "ashby",
    "smartrecruiters", "pinpoint", "phenom", "naukri", "instahyre", "wellfound", "linkedin", "generic"
];

function registry() {
    const sandbox = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, "extension/adapters/registry.js"), "utf8"), sandbox);
    return sandbox.JobHunterAdapterRegistry;
}

test("eight personas cross fourteen portal engines with owned Form A/B regression locks", () => {
    const adapters = registry();
    assert.equal(CANDIDATE_PERSONAS.length, 8);
    assert.equal(MAJOR_PORTALS.length, 14);
    assert.equal(CANDIDATE_PERSONAS.length * MAJOR_PORTALS.length, 112);
    for (const portal of MAJOR_PORTALS) {
        assert.ok(adapters.PORTALS.some((entry) => entry.id === portal), portal);
        assert.ok(fs.existsSync(path.join(root, `test/fixtures/form-a-${portal}.html`)), `${portal} Form A`);
        assert.ok(fs.existsSync(path.join(root, `test/fixtures/form-b-${portal}-cover-trap.html`)), `${portal} Form B`);
    }
});

test("white-labelled Phenom forms are identified from stable engine structure", () => {
    const adapters = registry();
    const result = adapters.resolveForPage(
        { hostname: "careers.example-company.test" },
        { querySelector: (selector) => selector.includes("phenompeople") ? {} : null }
    );
    assert.equal(result.portalKind, "phenom");
    assert.equal(result.hostname, "careers.example-company.test");
});

test("white-labelled Pinpoint forms are identified from stable engine structure", () => {
    const adapters = registry();
    const result = adapters.resolveForPage(
        { hostname: "careers.example-company.test" },
        { querySelector: (selector) => selector.includes("application_form[application]") ? {} : null }
    );
    assert.equal(result.portalKind, "pinpoint");
    assert.equal(result.hostname, "careers.example-company.test");
});

test("persona eligibility matrix hard-rejects impossible experience while preserving eligible and unknown roles", () => {
    for (const persona of CANDIDATE_PERSONAS) {
        const years = Number(persona.totalExperienceYears || 0);
        const impossible = applyExperienceEligibility(
            { matchScore: 92, recommendation: "pursue", explanation: "Strong skills." },
            { title: "Principal Engineer", description: `${years + 5}+ years of relevant experience required.` },
            persona
        );
        assert.equal(impossible.recommendation, "skip", persona.id);
        assert.ok(impossible.matchScore <= 35, persona.id);

        const eligibleMinimum = years > 0 ? Math.max(0, Math.floor(years) - 1) : 0;
        const eligible = applyExperienceEligibility(
            { matchScore: 84, recommendation: "pursue", explanation: "Strong skills." },
            { title: "Matched role", description: `${eligibleMinimum}+ years of relevant experience preferred.` },
            persona
        );
        assert.equal(eligible.recommendation, "pursue", persona.id);

        const unknown = applyExperienceEligibility(
            { matchScore: 72, recommendation: "maybe", explanation: "Needs review." },
            { title: "Unspecified role", description: "Strong engineering fundamentals." },
            persona
        );
        assert.equal(unknown.recommendation, "maybe", persona.id);
    }
});
