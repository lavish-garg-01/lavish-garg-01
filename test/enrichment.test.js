import test from "node:test";
import assert from "node:assert/strict";
import { mapHunterRecruiters, searchHunterRecruiters } from "../src/services/enrichment.js";

test("maps and ranks Hunter recruiter contacts without inventing data", () => {
    const people = mapHunterRecruiters({
        data: {
            emails: [
                {
                    value: "hr@example.com",
                    first_name: "Asha",
                    last_name: "Rao",
                    position: "HR Generalist",
                    confidence: 98,
                    verification: { status: "valid" }
                },
                {
                    value: "recruiter@example.com",
                    first_name: "Neha",
                    last_name: "Singh",
                    position: "Technical Recruiter",
                    confidence: 90,
                    linkedin: "neha-singh"
                }
            ]
        }
    });

    assert.equal(people[0].recruiterName, "Neha Singh");
    assert.equal(people[0].recruiterEmail, "recruiter@example.com");
    assert.equal(people[0].linkedinUrl, "https://www.linkedin.com/in/neha-singh");
    assert.equal(people[1].linkedinUrl, null);
});

test("does not create contacts when Hunter returns no emails", () => {
    assert.deepEqual(mapHunterRecruiters({ data: { emails: [] } }), []);
});

function hunterSuccess(email) {
    return {
        ok: true,
        async json() {
            return {
                data: {
                    emails: [
                        {
                            value: email,
                            first_name: "Test",
                            last_name: "Recruiter",
                            position: "Technical Recruiter",
                            confidence: 95,
                            verification: { status: "valid" }
                        }
                    ]
                }
            };
        }
    };
}

test("rotates successful requests across authorized Hunter keys", async () => {
    const usedKeys = [];
    const fetchImpl = async (_url, options) => {
        usedKeys.push(options.headers["X-API-KEY"]);
        return hunterSuccess("recruiter@example.com");
    };

    const options = {
        companyName: "Example",
        domain: "example.com",
        apiKeys: ["user-one", "user-two"],
        limit: 1,
        fetchImpl
    };
    await searchHunterRecruiters(options);
    await searchHunterRecruiters(options);

    assert.equal(new Set(usedKeys).size, 2);
});

test("tries the next Hunter key after a quota response", async () => {
    let attempts = 0;
    const people = await searchHunterRecruiters({
        companyName: "Example",
        domain: "example.com",
        apiKeys: ["quota-limited-user", "available-user"],
        limit: 1,
        fetchImpl: async () => {
            attempts += 1;
            if (attempts === 1) {
                return {
                    ok: false,
                    status: 429,
                    statusText: "Too Many Requests",
                    async text() {
                        return JSON.stringify({ errors: [{ details: "Insufficient credits" }] });
                    }
                };
            }
            return hunterSuccess("recruiter@example.com");
        }
    });

    assert.equal(attempts, 2);
    assert.equal(people[0].recruiterEmail, "recruiter@example.com");
});
