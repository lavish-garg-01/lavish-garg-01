import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RESUME_TEMPLATES, renderResumeHtml, resolveTemplateId } from "../src/services/resumeRenderer.js";
import { getResumeFitProfile } from "../src/services/resumeLayout.js";
import { env } from "../src/config/environment.js";

const resume = {
    fullName: "Sam Example",
    email: "sam@example.com",
    phone: "+91 98765 43210",
    linkedin: "https://www.linkedin.com/in/samexample",
    github: "https://github.com/samexample",
    summary: "Backend engineer focused on reliable distributed systems.",
    skillGroups: { languages: ["JavaScript", "Python"], databasesAndStorage: ["PostgreSQL"] },
    experience: [
        {
            title: "Backend Engineer",
            company: "Example Labs",
            startDate: "2023-01",
            endDate: "Present",
            bullets: ["Improved API latency by 35%."]
        }
    ],
    projects: [{ name: "Queue Inspector", bullets: ["Built a searchable event debugger."] }],
    education: [
        {
            degree: "B.Tech Computer Science",
            school: "Example University, Pune",
            startDate: "2019-08",
            endDate: "2023-06"
        }
    ]
};

test("all resume options are single-column, complete, and use the shared A4 fitter", () => {
    for (const template of RESUME_TEMPLATES) {
        const html = renderResumeHtml(resume, {}, { templateId: template.id });
        assert.equal(template.atsSafe, true);
        assert.equal(/\{\{[A-Z_]+\}\}/.test(html), false, `${template.id}: unresolved placeholder`);
        assert.equal(/<svg\b|<table\b|grid-template-columns\s*:/i.test(html), false, `${template.id}: parser-risk markup`);
        assert.match(html, /class="resume-page"/);
        assert.match(html, /id="resume-fit-runtime"/);
        assert.match(html, /Professional Summary/);
        assert.match(html, /Professional Experience/);
        assert.match(html, /Queue Inspector/);
        assert.match(html, /github\.com\/samexample/);
        assert.equal(html.includes("–"), false, `${template.id}: non-ASCII date dash`);
    }
});

test("template resolution and fit profiles have safe defaults", () => {
    assert.equal(resolveTemplateId("ATS"), "ats");
    assert.equal(resolveTemplateId("unknown"), "classic");
    const profile = getResumeFitProfile("unknown");
    assert.ok(profile.minFontPt >= 10);
    assert.ok(profile.minMarginMm >= 12.7);
    assert.ok(profile.targetFill <= profile.maxTargetFill);
});

test("tailored bullets are matched by employer and title, never array position", () => {
    const twoRoleResume = {
        ...resume,
        experience: [
            ...resume.experience,
            {
                title: "Platform Engineer",
                company: "Second Company",
                startDate: "2021-01",
                endDate: "2022-12",
                bullets: ["Maintained the event platform."]
            }
        ]
    };
    const tailoredBullet = "Reduced platform recovery time by 40%.";
    const html = renderResumeHtml(
        twoRoleResume,
        {
            modifiedBulletsByRole: [
                {
                    company: "Second Company",
                    title: "Platform Engineer",
                    bullets: [tailoredBullet]
                }
            ]
        },
        { templateId: "ats" }
    );

    assert.match(html, /Improved API latency by 35%/);
    assert.equal(html.split(tailoredBullet).length - 1, 1);
    assert.doesNotMatch(html, /Maintained the event platform/);
});

test("legacy template configuration cannot silently clip or disclose tailoring metadata", () => {
    assert.match(env.paths.resumeTemplate, /src\/templates\/resumes\/ats\.html$/);
    const legacyTemplate = fs.readFileSync(new URL("../src/templates/resume.html", import.meta.url), "utf8");
    assert.doesNotMatch(legacyTemplate, /overflow\s*:\s*hidden/i);
    assert.doesNotMatch(legacyTemplate, /Tailored for|TARGET_ROLE|TARGET_COMPANY/i);
});
