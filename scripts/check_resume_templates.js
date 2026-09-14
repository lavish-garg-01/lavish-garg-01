import assert from "node:assert/strict";
import { loadMasterResume } from "../src/services/openai.js";
import {
    MIN_RESUME_TEXT_RECALL,
    renderResumePdf
} from "../src/services/pdfGenerator.js";
import { RESUME_TEMPLATES, renderResumeHtml } from "../src/services/resumeRenderer.js";

const resume = loadMasterResume();
const mods = { resumeSummary: resume.summary, extraSkills: [] };
const banned = ["Tailored for", "Gurugram", "Delhi NCR", "SolarWinds"];
const expectedHeadings = ["Professional Summary", "Skills", "Professional Experience", "Education"];

for (const template of RESUME_TEMPLATES) {
    const html = renderResumeHtml(resume, mods, { templateId: template.id });
    const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
    const hits = banned.filter((word) => html.includes(word));
    const hasEducation = html.includes("B.E. in Computer Science") && html.includes("Thapar");

    assert.equal(leftover, null, `${template.id}: unresolved template placeholder`);
    assert.deepEqual(hits, [], `${template.id}: found banned PDF-only text`);
    assert.equal(hasEducation, true, `${template.id}: education was omitted`);
    assert.equal(
        /<svg\b|<table\b|grid-template-columns\s*:/i.test(html),
        false,
        `${template.id}: parser-risk layout found`
    );
    assert.equal(html.includes('class="resume-page"'), true, `${template.id}: fixed A4 wrapper is missing`);

    // Render and inspect in memory so this checker never touches real application assets.
    const { buffer, layout } = await renderResumePdf(html, { strict: true });
    assert.ok(buffer.length > 10_000 && buffer.length < 2_500_000, `${template.id}: unexpected PDF size ${buffer.length}`);
    assert.equal(layout.pageSize, "A4", `${template.id}: final PDF page size is not A4`);
    assert.ok(Math.abs(layout.pageWidthMm - 210) <= 2, `${template.id}: PDF width was ${layout.pageWidthMm}mm`);
    assert.ok(Math.abs(layout.pageHeightMm - 297) <= 2, `${template.id}: PDF height was ${layout.pageHeightMm}mm`);
    assert.equal(layout.pageCount, 1, `${template.id}: final PDF is not exactly one page`);
    assert.equal(layout.overflow, false, `${template.id}: content overflowed the A4 page`);
    assert.equal(layout.clipped, false, `${template.id}: final PDF text was clipped or lost`);
    assert.equal(layout.tagged, true, `${template.id}: final PDF is not tagged`);
    assert.equal(layout.textLayerPresent, true, `${template.id}: final PDF has no selectable text`);
    assert.ok(
        layout.pdfTextRecall >= MIN_RESUME_TEXT_RECALL,
        `${template.id}: final PDF text recall was ${layout.pdfTextRecall}`
    );
    assert.ok(layout.fillPercent >= 86 && layout.fillPercent <= 100, `${template.id}: page fill was ${layout.fillPercent}%`);
    assert.ok(
        layout.domMinFontPt >= layout.profile.minimumReadableFontPt,
        `${template.id}: body font was ${layout.domMinFontPt}pt`
    );
    assert.ok(
        layout.minFontPt >= layout.profile.minimumReadableFontPt,
        `${template.id}: smallest final PDF font was ${layout.minFontPt}pt`
    );
    assert.ok(layout.marginMm >= 12.7, `${template.id}: margin was ${layout.marginMm}mm`);
    assert.equal(layout.hasSvg, false, `${template.id}: SVG found in rendered output`);
    assert.equal(layout.hasTable, false, `${template.id}: table found in rendered output`);
    assert.equal(layout.hasImage, false, `${template.id}: image/canvas found in rendered output`);
    assert.equal(layout.hasMultiColumnLayout, false, `${template.id}: multi-column layout found`);

    const normalizedText = String(layout.plainText || "").toLowerCase();
    const headingPositions = expectedHeadings.map((heading) => normalizedText.indexOf(heading.toLowerCase()));
    assert.ok(headingPositions.every((position) => position >= 0), `${template.id}: PDF heading missing`);
    assert.deepEqual([...headingPositions].sort((a, b) => a - b), headingPositions, `${template.id}: PDF reading order is incorrect`);
    for (const anchor of [resume.fullName, resume.email, "Vidyakul", "Thapar"]) {
        assert.ok(normalizedText.includes(String(anchor).toLowerCase()), `${template.id}: PDF text lost ${anchor}`);
    }

    console.log(
        JSON.stringify({
            id: template.id,
            pdfBytes: layout.pdfBytes,
            pages: layout.pageCount,
            pageSize: `${layout.pageWidthMm}x${layout.pageHeightMm}mm`,
            fillPercent: layout.fillPercent,
            bodyFontPt: layout.domMinFontPt,
            smallestPdfFontPt: layout.minFontPt,
            textRecall: layout.pdfTextRecall,
            tagged: layout.tagged
        })
    );
}

// A deliberately dense ATS fixture must fail closed before any clipped PDF can be accepted.
const denseHtml = renderResumeHtml(
    resume,
    {
        resumeSummary: Array.from(
            { length: 120 },
            () => "Dense fixture content must remain selectable, readable, and entirely inside the A4 page."
        ).join(" "),
        extraSkills: []
    },
    { templateId: "ats" }
);
let denseFailure = null;
try {
    await renderResumePdf(denseHtml, { strict: true });
} catch (error) {
    denseFailure = error;
}
assert.ok(denseFailure, "ats dense fixture: strict rendering accepted an overflowing resume");
assert.match(
    String(denseFailure.code || ""),
    /^RESUME_(OVERFLOW|POSTFLIGHT)$/,
    "ats dense fixture: strict rendering failed for an unexpected reason"
);
assert.equal(denseFailure.layout?.overflow, true, "ats dense fixture: overflow was not reported");
assert.equal(denseFailure.layout?.clipped, false, "ats dense fixture: overflow was hidden by clipping");

// Keep this fixture intentionally sparse while exercising long, wrapping contact details.
const sparseResume = structuredClone(resume);
sparseResume.fullName = "Alexandria Montgomery-Singh";
sparseResume.email = "alexandria.montgomery.singh+platform@examplecareers.com";
sparseResume.phone = "+91 98765 43210";
sparseResume.linkedin = "https://www.linkedin.com/in/alexandria-montgomery-singh-platform-engineer";
sparseResume.github = "https://github.com/alexandria-montgomery-singh-platform";
sparseResume.summary = "Backend engineer building reliable APIs and maintainable services.";
sparseResume.skillGroups = {
    languages: ["JavaScript", "Python"],
    frameworksAndArchitecture: ["Node.js"]
};
sparseResume.experience = [
    {
        ...sparseResume.experience[0],
        company: "Example Systems",
        title: "Backend Engineer",
        bullets: ["Built reliable API services for production workloads."]
    }
];
sparseResume.projects = [];
sparseResume.education = sparseResume.education.slice(0, 1);

const sparseHtml = renderResumeHtml(
    sparseResume,
    { resumeSummary: sparseResume.summary, extraSkills: [] },
    { templateId: "ats" }
);
const { layout: sparseLayout } = await renderResumePdf(sparseHtml, { strict: true });
assert.equal(sparseLayout.pageSize, "A4", "ats sparse fixture: final PDF page size is not A4");
assert.equal(sparseLayout.pageCount, 1, "ats sparse fixture: final PDF is not exactly one page");
assert.equal(sparseLayout.overflow, false, "ats sparse fixture: long contact details overflowed");
assert.equal(sparseLayout.clipped, false, "ats sparse fixture: long contact details were clipped");
assert.equal(sparseLayout.textLayerPresent, true, "ats sparse fixture: final PDF has no selectable text");
assert.ok(
    sparseLayout.pdfTextRecall >= MIN_RESUME_TEXT_RECALL,
    `ats sparse fixture: final PDF text recall was ${sparseLayout.pdfTextRecall}`
);
assert.ok(
    sparseLayout.domMinFontPt >= sparseLayout.profile.minimumReadableFontPt,
    `ats sparse fixture: DOM font was ${sparseLayout.domMinFontPt}pt`
);
assert.ok(
    sparseLayout.minFontPt >= sparseLayout.profile.minimumReadableFontPt,
    `ats sparse fixture: final PDF font was ${sparseLayout.minFontPt}pt`
);
assert.ok(
    sparseLayout.fillPercent < sparseLayout.profile.targetFillPercent,
    `ats sparse fixture: expected honest underfill, got ${sparseLayout.fillPercent}%`
);
console.log(
    JSON.stringify({
        id: "ats-edge-fixtures",
        denseRejected: denseFailure.code,
        sparsePageSize: `${sparseLayout.pageWidthMm}x${sparseLayout.pageHeightMm}mm`,
        sparseFillPercent: sparseLayout.fillPercent,
        sparseTextRecall: sparseLayout.pdfTextRecall,
        sparseOverflow: sparseLayout.overflow,
        sparseClipped: sparseLayout.clipped
    })
);
