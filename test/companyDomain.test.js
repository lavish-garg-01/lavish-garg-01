import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyDomain } from "../src/utils/companyDomain.js";

test("normalizes employer websites to bare enrichment-provider domains", () => {
    assert.equal(normalizeCompanyDomain("https://www.phonepe.com/about/"), "phonepe.com");
    assert.equal(normalizeCompanyDomain("example.co.in/jobs"), "example.co.in");
});

test("rejects LinkedIn company URLs and malformed values", () => {
    assert.equal(normalizeCompanyDomain("https://in.linkedin.com/company/phonepe-internet"), null);
    assert.equal(normalizeCompanyDomain("not a domain"), null);
    assert.equal(normalizeCompanyDomain(""), null);
});
