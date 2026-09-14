import assert from "node:assert/strict";
import test from "node:test";
import {
    FirecrawlRateLimitError,
    parseFirecrawlRetryAfterMs,
    resetFirecrawlRateLimiterForTests,
    scrapeJobListing,
    scrapeJobListings
} from "../src/services/firecrawl.js";

function successResponse(title = "Backend Engineer") {
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async text() {
            return JSON.stringify({
                success: true,
                data: {
                    json: {
                        jobs: [{
                            title,
                            company: "Acme",
                            url: "https://example.com/jobs/backend"
                        }]
                    }
                }
            });
        }
    };
}

function rateLimitResponse({ retryAfterHeader, body } = {}) {
    return {
        ok: false,
        status: 429,
        headers: {
            get(name) {
                return String(name).toLowerCase() === "retry-after" ? (retryAfterHeader || null) : null;
            }
        },
        async text() {
            return body || JSON.stringify({
                error: "Rate limit exceeded. Consumed (req/min): 15, Remaining (req/min): 0. please retry after 55s"
            });
        }
    };
}

test("parses Firecrawl retry-after from the response body", () => {
    assert.equal(
        parseFirecrawlRetryAfterMs({}, "please retry after 55s, resets at Fri Aug 28 2026 15:36:02 GMT+0000"),
        55000
    );
});

test("prefers the Retry-After header when present", () => {
    assert.equal(
        parseFirecrawlRetryAfterMs({
            headers: { get: (name) => String(name).toLowerCase() === "retry-after" ? "12" : null }
        }, "please retry after 55s"),
        12000
    );
});

test("retries a listing scrape after HTTP 429 instead of skipping the URL", async () => {
    resetFirecrawlRateLimiterForTests();
    let calls = 0;
    const slept = [];
    const jobs = await scrapeJobListing("https://www.naukri.com/backend-engineer-jobs-in-noida", {
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) return rateLimitResponse();
            return successResponse();
        },
        sleepImpl: async (ms) => { slept.push(ms); },
        nowImpl: () => 1_000_000,
        minIntervalMs: 0,
        maxRetries: 2
    });

    assert.equal(calls, 2);
    assert.ok(slept.some((ms) => ms >= 55000));
    assert.equal(jobs[0].company, "Acme");
});

test("serializes concurrent Firecrawl collectors onto one request at a time", async () => {
    resetFirecrawlRateLimiterForTests();
    let inflight = 0;
    let maxInflight = 0;
    const fetchImpl = async () => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((resolve) => setTimeout(resolve, 25));
        inflight -= 1;
        return successResponse();
    };

    await Promise.all([
        scrapeJobListing("https://www.naukri.com/a", { fetchImpl, sleepImpl: async () => {}, minIntervalMs: 0, maxRetries: 0 }),
        scrapeJobListing("https://www.instahyre.com/b", { fetchImpl, sleepImpl: async () => {}, minIntervalMs: 0, maxRetries: 0 })
    ]);

    assert.equal(maxInflight, 1);
});

test("stops a listing batch after retries are exhausted so remaining URLs are not blasted", async () => {
    resetFirecrawlRateLimiterForTests();
    let calls = 0;
    const jobs = await scrapeJobListings([
        "https://www.naukri.com/one",
        "https://www.naukri.com/two"
    ], {
        fetchImpl: async () => {
            calls += 1;
            return rateLimitResponse({ retryAfterHeader: "1" });
        },
        sleepImpl: async () => {},
        nowImpl: () => 1_000_000,
        minIntervalMs: 0,
        maxRetries: 1
    });

    assert.equal(jobs.length, 0);
    assert.equal(calls, 2);
});

test("FirecrawlRateLimitError is thrown when 429 persists", async () => {
    resetFirecrawlRateLimiterForTests();
    await assert.rejects(
        () => scrapeJobListing("https://wellfound.com/role/l/backend-engineer/india", {
            fetchImpl: async () => rateLimitResponse({ retryAfterHeader: "1" }),
            sleepImpl: async () => {},
            nowImpl: () => 1_000_000,
            minIntervalMs: 0,
            maxRetries: 0
        }),
        (error) => error instanceof FirecrawlRateLimitError && error.status === 429
    );
});
