import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJobUrl, normalizeCompanyScore, parsePostedAt } from "../src/services/ingestion.js";

test("normalizes sourced company ratings to a consistent 0-100 score", () => {
    assert.equal(normalizeCompanyScore(4.2), 84);
    assert.equal(normalizeCompanyScore("3.75"), 75);
    assert.equal(normalizeCompanyScore(82), 82);
    assert.equal(normalizeCompanyScore(0), 0);
    assert.equal(normalizeCompanyScore(101), null);
    assert.equal(normalizeCompanyScore("unknown"), null);
});

test("normalizes absolute and relative job posting dates", () => {
    assert.equal(parsePostedAt({ postedAt: "2026-08-15" }), "2026-08-15T00:00:00.000Z");
    const before = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const parsed = new Date(parsePostedAt({ date_posted: "2 days ago" })).getTime();
    assert.ok(Math.abs(parsed - before) < 2000);
    assert.equal(parsePostedAt({ postedAt: "not a date" }), null);
});

test("canonical job URLs deduplicate trailing slashes and tracking parameters", () => {
    assert.equal(
        canonicalJobUrl("https://www.instahyre.com/job-413920-backend-engineer/?utm_source=test#apply"),
        canonicalJobUrl("https://www.instahyre.com/job-413920-backend-engineer")
    );
});
