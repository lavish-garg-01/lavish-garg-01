import test from "node:test";
import assert from "node:assert/strict";
import { analyzeResumeReadiness } from "../src/services/resumeAnalyzer.js";

const resume = {
    fullName: "Sam Example",
    email: "sam@example.com",
    phone: "+91 98765 43210",
    linkedin: "https://linkedin.com/in/samexample",
    summary: "Backend engineer",
    skillGroups: { languages: ["Node.js", "Python"] },
    experience: [
        { title: "Backend Engineer", company: "Example Labs", bullets: ["Built reliable APIs."] }
    ],
    education: [{ degree: "B.Tech Computer Science", school: "Example University" }]
};

const healthyDiagnostics = {
    pageSize: "A4",
    pageWidthMm: 210,
    pageHeightMm: 297,
    pageCount: 1,
    fillPercent: 94,
    overflow: false,
    clipped: false,
    minFontPt: 10.25,
    marginMm: 14,
    pdfBytes: 120_000,
    tagged: true,
    textLayerPresent: true,
    pdfTextRecall: 1,
    profile: { minimumReadableFontPt: 10 },
    hasMultiColumnLayout: false,
    hasTable: false,
    hasImage: false,
    hasSvg: false,
    headings: ["Sam Example", "Professional Summary", "Skills", "Professional Experience", "Education"],
    plainText: [
        "Sam Example",
        "sam@example.com | +91 98765 43210",
        "Professional Summary",
        "Backend engineer",
        "Skills",
        "Node.js, Python",
        "Professional Experience",
        "Backend Engineer",
        "Example Labs",
        "Education",
        "B.Tech Computer Science, Example University"
    ].join("\n")
};

test("healthy one-page resume receives full readiness credit", () => {
    const report = analyzeResumeReadiness({
        resume,
        modifications: { keywordsToEmphasize: ["Node.js", "Python", "Kubernetes"] },
        job: { ai_analysis: JSON.stringify({ matchedSkills: ["Node JS"], missingSkills: ["Kubernetes"] }) },
        templateId: "ats",
        diagnostics: healthyDiagnostics
    });

    assert.equal(report.readiness.score, 100);
    assert.equal(report.fit.pageCount, 1);
    assert.deepEqual(report.jobMatch.matched, ["Node.js", "Python"]);
    assert.deepEqual(report.jobMatch.missing, ["Kubernetes"]);
    assert.equal(report.jobMatch.score, 67);
    assert.ok(report.checks.every((check) => !Object.hasOwn(check, "earned")));
});

test("overflow and parser-risk structure produce actionable failures", () => {
    const report = analyzeResumeReadiness({
        resume,
        modifications: {},
        job: {},
        diagnostics: {
            ...healthyDiagnostics,
            pageCount: 2,
            fillPercent: 118,
            overflow: true,
            clipped: true,
            minFontPt: 8,
            marginMm: 7,
            tagged: false,
            hasMultiColumnLayout: true,
            hasTable: true,
            hasImage: true,
            headings: [],
            plainText: "MongoDB"
        }
    });

    assert.ok(report.readiness.score < 30);
    assert.equal(report.checks.find((check) => check.id === "a4-one-page-fit").status, "fail");
    assert.equal(report.checks.find((check) => check.id === "parser-structure").status, "fail");
});

test("keyword matching uses phrase boundaries instead of substrings", () => {
    const report = analyzeResumeReadiness({
        resume,
        job: { ai_analysis: JSON.stringify({ missingSkills: ["Go"] }) },
        diagnostics: { ...healthyDiagnostics, plainText: "MongoDB database experience" }
    });

    assert.deepEqual(report.jobMatch.matched, []);
    assert.deepEqual(report.jobMatch.missing, ["Go"]);
});

test("job-match score is unavailable rather than zero when no target keywords exist", () => {
    const report = analyzeResumeReadiness({ resume, diagnostics: healthyDiagnostics });

    assert.equal(report.jobMatch.score, null);
    assert.equal(report.jobMatch.label, "No target keywords available");
    assert.equal(report.checks.find((check) => check.id === "job-keywords").status, "info");
});

test("critical page-integrity failures force page-fit failure and cap readiness", async (t) => {
    const cases = [
        ["multiple PDF pages", { pageCount: 2 }],
        ["layout overflow", { overflow: true }],
        ["clipped content", { clipped: true }]
    ];

    for (const [name, overrides] of cases) {
        await t.test(name, () => {
            const report = analyzeResumeReadiness({
                resume,
                diagnostics: { ...healthyDiagnostics, ...overrides }
            });

            assert.equal(report.checks.find((check) => check.id === "a4-one-page-fit").status, "fail");
            assert.ok(report.readiness.score <= 49);
            assert.ok(report.readiness.criticalFailures.length > 0);
        });
    }
});

test("a PDF without selectable text never falls back to source data", () => {
    const report = analyzeResumeReadiness({
        resume,
        diagnostics: {
            ...healthyDiagnostics,
            plainText: "",
            textLayerPresent: false,
            pdfTextRecall: 0,
            clipped: false
        }
    });

    assert.equal(report.plainText, "");
    assert.ok(report.readiness.score <= 20);
    assert.equal(report.checks.find((check) => check.id === "parser-structure").status, "fail");
    assert.equal(report.checks.find((check) => check.id === "a4-one-page-fit").status, "fail");
});

test("incomplete final-PDF text recall is scored as an integrity failure", () => {
    const report = analyzeResumeReadiness({
        resume,
        diagnostics: { ...healthyDiagnostics, pdfTextRecall: 0.72, clipped: false }
    });

    assert.ok(report.readiness.score <= 49);
    assert.equal(report.checks.find((check) => check.id === "parser-structure").status, "fail");
    assert.equal(report.checks.find((check) => check.id === "a4-one-page-fit").status, "fail");
    assert.match(report.readiness.summary, /72% of source text/);
});

test("tagging and the active fit profile affect parser and readability scores", () => {
    const untagged = analyzeResumeReadiness({
        resume,
        diagnostics: { ...healthyDiagnostics, tagged: false }
    });
    assert.equal(untagged.checks.find((check) => check.id === "parser-structure").status, "warning");
    assert.ok(untagged.readiness.score < 100);

    const stricterProfile = analyzeResumeReadiness({
        resume,
        diagnostics: {
            ...healthyDiagnostics,
            minFontPt: 10.25,
            profile: { minimumReadableFontPt: 10.5 }
        }
    });
    assert.equal(stricterProfile.fit.minimumReadableFontPt, 10.5);
    assert.equal(stricterProfile.checks.find((check) => check.id === "readable-type").status, "warning");
});

test("missing critical contact methods cannot receive an excellent readiness score", () => {
    const report = analyzeResumeReadiness({
        resume: { ...resume, email: "", phone: "" },
        diagnostics: {
            ...healthyDiagnostics,
            plainText: healthyDiagnostics.plainText
                .replace("sam@example.com | +91 98765 43210", "linkedin.com/in/samexample")
        }
    });

    assert.equal(report.checks.find((check) => check.id === "contact-details").status, "fail");
    assert.ok(report.readiness.score <= 69);
    assert.equal(report.readiness.contentFailures.length, 1);
});
