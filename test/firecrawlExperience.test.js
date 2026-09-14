import assert from "node:assert/strict";
import test from "node:test";
import { mergeJobDetail, normalizeJob } from "../src/services/firecrawl.js";
import { extractJobTags } from "../src/utils/jobTags.js";

test("missing explicit experience remains unknown instead of becoming zero years", () => {
    assert.equal(extractJobTags({ title: "Backend Engineer", description: "Experience requirement: Not specified", minimumExperienceYears: null }).yoeMin, null);
});

test("Firecrawl keeps an explicit experience requirement outside a short listing summary", () => {
    const job = normalizeJob({
        title: "Staff Backend Engineer",
        company: "Deutsche Telekom Digital Labs",
        url: "https://www.instahyre.com/job-434257-staff-backend-engineer-at-deutsche-telekom-digital-labs-gurgaon/",
        description: "Lead backend development with focus on C++, Java, and microservices.",
        experienceRequirement: "8-12 years of solid experience in backend engineering.",
        minimumExperienceYears: 8
    }, "instahyre");

    assert.match(job.description, /8-12 years/);
    assert.equal(extractJobTags(job).yoeMin, 8);
});

test("Instahyre detail enrichment replaces an impoverished listing summary", () => {
    const listing = normalizeJob({
        title: "Backend Engineer",
        company: "Alora Advisors",
        url: "https://www.instahyre.com/job-413920-backend-engineer-at-alora-advisors-gurgaon/",
        location: "Gurgaon",
        description: "Skills required: Java, Microservices, Python. Experience requirement: Not specified"
    }, "instahyre");
    const detail = normalizeJob({
        title: "Backend Engineer",
        company: "Alora Advisors",
        url: listing.url,
        location: "Gurgaon",
        description: "1-3 years of experience in backend development. Strong proficiency in Python / Node.js / Java / Go (any one is fine). Experience building REST APIs, payment gateway integrations, scalable systems, MySQL, PostgreSQL, MongoDB, AWS, Docker, CI/CD and message queues.",
        experienceRequirement: "1-3 years of experience in backend development.",
        minimumExperienceYears: 1
    }, "instahyre");
    const merged = mergeJobDetail(listing, detail);
    assert.equal(merged.minimumExperienceYears, 1);
    assert.match(merged.description, /Node\.js/);
    assert.match(merged.description, /payment gateway/);
    assert.doesNotMatch(merged.description, /Not specified/);
});
