import test from "node:test";
import assert from "node:assert/strict";
import { renderCoverLetterHtml } from "../src/services/pdfGenerator.js";

test("cover-letter HTML is A4-ready, escaped, and preserves clean line breaks", () => {
    const html = renderCoverLetterHtml({
        resume: {
            fullName: "Sam Example",
            email: "sam@example.com",
            phone: "+91 99999 99999",
            linkedin: "https://linkedin.com/in/sam"
        },
        job: { company_name: "Example & Co" },
        coverLetter: "Dear Hiring Team,\\n\\nBuilt <reliable> systems."
    });

    assert.match(html, /@page \{ size: A4/);
    assert.match(html, /Example &amp; Co/);
    assert.match(html, /Dear Hiring Team,\n\nBuilt &lt;reliable&gt; systems\./);
    assert.doesNotMatch(html, /\\n/);
});
