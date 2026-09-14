import assert from "node:assert/strict";
import test from "node:test";
import {
    jobMatchFingerprint,
    jobPostingSeriesKey,
    normalizeJobForRegistry,
    rawJobSnapshot
} from "../src/services/jobNormalizer.js";

test("job normalization creates deterministic matching evidence without candidate data", () => {
    const job = {
        company: "Acme India",
        title: "Senior Backend Engineer",
        location: "Remote - India",
        description: "Full-time role. Must have Node.js and PostgreSQL. Nice to have Kafka. No visa sponsorship. Occasional travel.",
        url: "https://jobs.acme.in/backend-42?utm_source=test",
        source: "direct_ats",
        postedAt: "2026-08-28T00:00:00.000Z"
    };
    const normalized = normalizeJobForRegistry(job);
    assert.equal(normalized.employmentType, "FULL_TIME");
    assert.equal(normalized.seniorityLevel, "SENIOR");
    assert.equal(normalized.countryCode, "IN");
    assert.equal(normalized.remoteScope, "INDIA_ONLY");
    assert.equal(normalized.sponsorshipPolicy, "NOT_AVAILABLE");
    assert.equal(normalized.travelRequirement, "SOME");
    assert.ok(normalized.requiredSkills.includes("Node.js"));
    assert.ok(normalized.secondarySkills.includes("Kafka"));

    const snapshot = rawJobSnapshot(job);
    assert.equal(snapshot.payload.company, "Acme India");
    assert.equal(Object.hasOwn(snapshot.payload, "candidate"), false);
    assert.equal(Object.hasOwn(snapshot.payload, "answers"), false);
    assert.equal(snapshot.contentHash.length, 40);
});

test("match versions can ignore source metadata while detecting material job changes", () => {
    const base = {
        company: "Acme India",
        title: "Backend Engineer",
        location: "Pune, India",
        description: "Node.js and PostgreSQL are required.",
        url: "https://jobs.acme.in/backend-42",
        source: "direct_ats"
    };
    assert.equal(jobMatchFingerprint(base), jobMatchFingerprint({ ...base, source: "naukri" }));
    assert.notEqual(jobMatchFingerprint(base), jobMatchFingerprint({ ...base, description: `${base.description} Java is required.` }));
    assert.equal(jobPostingSeriesKey(base), jobPostingSeriesKey({ ...base, description: "A completely updated description." }));
});
