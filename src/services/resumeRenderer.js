import fs from "fs";
import path from "path";
import { env } from "../config/environment.js";
import { resumeLayoutMarkup } from "./resumeLayout.js";

export const RESUME_TEMPLATES = [
    {
        id: "classic",
        name: "Classic",
        blurb: "Centered, polished, single-column layout with standard ATS headings.",
        atsSafe: true
    },
    {
        id: "split",
        name: "Structured",
        blurb: "A modern single-column layout with clear role and company hierarchy.",
        atsSafe: true
    },
    {
        id: "ats",
        name: "ATS Safe",
        blurb: "Plain single-column text for Workday, Taleo, and Greenhouse uploads.",
        atsSafe: true
    },
    {
        id: "compact",
        name: "Compact",
        blurb: "Space-efficient single-column layout with restrained navy rules.",
        atsSafe: true
    }
];

const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SKILL_GROUP_LABELS = {
    languages: "Languages",
    frameworksAndArchitecture: "Frameworks & Architecture",
    databasesAndStorage: "Databases & Storage",
    streamingAndProtocols: "Streaming & Protocols",
    devopsAndCloud: "DevOps & Cloud",
    performanceAndObservability: "Performance & Observability",
    csFundamentals: "CS Fundamentals"
};

export function resolveTemplateId(value) {
    const id = String(value || "classic").toLowerCase();
    return RESUME_TEMPLATES.some((item) => item.id === id) ? id : "classic";
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderList(items = []) {
    return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
}

function normalizeKey(value = "") {
    return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function formatMonthYear(raw, { short = false, present = "present" } = {}) {
    const value = String(raw || "").trim();
    if (!value || /^present$/i.test(value)) return present;
    const iso = value.match(/^(\d{4})-(\d{2})/);
    if (iso) {
        const month = Number(iso[2]);
        const year = iso[1];
        const names = short ? MONTHS_SHORT : MONTHS;
        return `${names[month - 1] || iso[2]} ${year}`;
    }
    return value;
}

function experienceDates(role) {
    const start = formatMonthYear(role.startDate, { present: "Present" });
    const end = formatMonthYear(role.endDate, { present: "Present" });
    return `${start} - ${end}`;
}

function educationDates(edu) {
    const start = formatMonthYear(edu.startDate, { present: "Present" });
    const end = formatMonthYear(edu.endDate, { short: true, present: "Present" });
    return `${start} - ${end}`;
}

function displayLinkedIn(url = "") {
    return String(url)
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/$/, "");
}

function displayUrl(url = "") {
    return String(url)
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/$/, "");
}

function safeContactHref(value = "", kind = "url") {
    const text = String(value || "").trim();
    if (!text) return "";
    if (kind === "email") return `mailto:${encodeURIComponent(text)}`;
    if (kind === "phone") return `tel:${text.replace(/[^+\d]/g, "")}`;
    return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function contactLink(label, href) {
    if (!label || !href) return "";
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function bulletsForRole(role, index, modifications = {}) {
    const byRole = modifications.modifiedBulletsByRole;
    if (Array.isArray(byRole) && byRole.length) {
        const match = byRole.find(
            (item) =>
                normalizeKey(item.company) === normalizeKey(role.company) &&
                normalizeKey(item.title) === normalizeKey(role.title)
        );
        if (match?.bullets?.length) return match.bullets;
    }
    if (index === 0 && modifications.modifiedBullets?.length) {
        return modifications.modifiedBullets;
    }
    return role.bullets || [];
}

function groupedSkillItems(skills = []) {
    const result = [];
    let pending = "";
    for (const item of skills || []) {
        const text = String(item || "").trim();
        if (!text) continue;
        pending = pending ? `${pending}, ${text}` : text;
        const opens = (pending.match(/\(/g) || []).length;
        const closes = (pending.match(/\)/g) || []).length;
        if (opens <= closes) {
            result.push(pending);
            pending = "";
        }
    }
    if (pending) result.push(pending);
    return result;
}

function displaySkillGroups(resume, modifications = {}) {
    const groups = Object.fromEntries(Object.entries(resume.skillGroups || {})
        .map(([key, skills]) => [key, groupedSkillItems(skills)]));
    const excluded = new Set((modifications.excludedSkills || []).map((item) => String(item).toLowerCase()));
    for (const [key, skills] of Object.entries(groups)) {
        groups[key] = (skills || []).filter((skill) => !excluded.has(String(skill).toLowerCase()));
    }
    const extras = [...(modifications.extraSkills || [])].filter(Boolean).slice(0, 4);
    const owned = new Set(
        Object.values(groups)
            .flat()
            .map((item) => String(item).toLowerCase())
    );
    const addTo = groups.frameworksAndArchitecture ? "frameworksAndArchitecture" : Object.keys(groups)[0];
    for (const skill of extras) {
        if (owned.has(skill.toLowerCase()) || !addTo) continue;
        groups[addTo] = [...(groups[addTo] || []), skill];
        owned.add(skill.toLowerCase());
    }
    return groups;
}

function schoolParts(school = "") {
    const text = String(school);
    const idx = text.lastIndexOf(",");
    if (idx === -1) return { name: text.trim(), city: "" };
    return { name: text.slice(0, idx).trim(), city: text.slice(idx + 1).trim() };
}

function chunkFns(data) {
    const { resume, modifications, groups } = data;
    const roles = resume.experience || [];
    const education = resume.education || [];

    return {
        classicExperience: roles
            .map((role, index) => {
                const title = `${String(role.title || "").toUpperCase()}, ${String(role.company || "").toUpperCase()}`;
                return `<section class="role">
  <div class="role-head"><span>${escapeHtml(title)}</span><span>${escapeHtml(experienceDates(role))}</span></div>
  <ul>${renderList(bulletsForRole(role, index, modifications))}</ul>
</section>`;
            })
            .join("\n"),
        splitExperience: roles
            .map((role, index) => {
                return `<section class="role">
  <div class="role-head"><strong>${escapeHtml(role.title || "")}</strong><span>${escapeHtml(experienceDates(role))}</span></div>
  <div class="role-company">${escapeHtml(role.company || "")}</div>
  <ul>${renderList(bulletsForRole(role, index, modifications))}</ul>
</section>`;
            })
            .join("\n"),
        atsExperience: roles
            .map((role, index) => {
                return `<section class="role">
  <div class="role-head"><strong>${escapeHtml(role.title || "")}</strong><span>${escapeHtml(experienceDates(role))}</span></div>
  <div class="company">${escapeHtml(role.company || "")}</div>
  <ul>${renderList(bulletsForRole(role, index, modifications))}</ul>
</section>`;
            })
            .join("\n"),
        classicSkills: Object.entries(groups)
            .map(([key, items]) => {
                if (!items?.length) return "";
                const label = SKILL_GROUP_LABELS[key] || key;
                return `<p class="skill-line"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(items.join(", "))}</p>`;
            })
            .join("\n"),
        splitSkills: Object.entries(groups)
            .map(([key, items]) => {
                if (!items?.length) return "";
                const label = SKILL_GROUP_LABELS[key] || key;
                const chips = items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("");
                return `<div class="skill-cat"><div class="skill-cat-name">${escapeHtml(label)}</div><div class="chips">${chips}</div></div>`;
            })
            .join("\n"),
        classicEducation: education
            .map((edu) => {
                const { name, city } = schoolParts(edu.school);
                const place = city ? `${name}, ${city}` : name;
                return `<section class="edu-line"><span>${escapeHtml(edu.degree || "")}, ${escapeHtml(place)}</span><span>${escapeHtml(educationDates(edu))}</span></section>`;
            })
            .join("\n"),
        splitEducation: education
            .map((edu) => {
                const { name, city } = schoolParts(edu.school);
                return `<section class="edu">
  <div class="edu-degree">${escapeHtml(edu.degree || "")}</div>
  <div class="edu-school">${escapeHtml(name)}</div>
  <div class="meta-line">${escapeHtml(educationDates(edu))}${city ? ` | ${escapeHtml(city)}` : ""}</div>
</section>`;
            })
            .join("\n"),
        projects: (resume.projects || []).length
            ? `<section class="resume-section"><h2>Projects</h2>${(resume.projects || [])
                  .map(
                      (project) =>
                          `<section class="role"><div class="role-head"><strong>${escapeHtml(project.name || "")}</strong></div><ul>${renderList(project.bullets || [])}</ul></section>`
                  )
                  .join("\n")}</section>`
            : ""
    };
}

function fill(template, map) {
    let html = template;
    for (const [key, value] of Object.entries(map)) {
        html = html.replaceAll(`{{${key}}}`, value ?? "");
    }
    return html;
}

export function renderResumeHtml(resume, modifications = {}, { templateId = "classic" } = {}) {
    const id = resolveTemplateId(templateId);
    const groups = displaySkillGroups(resume, modifications);
    const summary = modifications.resumeSummary || resume.summary || "";
    const headline = resume.experience?.[0]?.title || "Backend Developer";
    const linkedinHref = resume.linkedin || "";
    const linkedinDisplay = displayLinkedIn(linkedinHref);
    const githubDisplay = displayUrl(resume.github || "");
    const chunks = chunkFns({ resume, modifications, groups });

    const file = path.join(env.rootDir, "src", "templates", "resumes", `${id}.html`);
    const template = fs.readFileSync(file, "utf8");

    const contactClassic = [resume.email, resume.phone, linkedinDisplay, githubDisplay]
        .filter(Boolean)
        .join(" | ");

    const contactHtml = [
        contactLink(resume.email, safeContactHref(resume.email, "email")),
        contactLink(resume.phone, safeContactHref(resume.phone, "phone")),
        contactLink(linkedinDisplay, safeContactHref(linkedinHref)),
        contactLink(githubDisplay, safeContactHref(resume.github || ""))
    ]
        .filter(Boolean)
        .join('<span class="contact-separator" aria-hidden="true"> | </span>');

    let html = fill(template, {
        FULL_NAME: escapeHtml(resume.fullName || ""),
        HEADLINE: escapeHtml(headline),
        EMAIL: escapeHtml(resume.email || ""),
        PHONE: escapeHtml(resume.phone || ""),
        LINKEDIN_DISPLAY: escapeHtml(linkedinDisplay),
        LINKEDIN_HREF: escapeHtml(linkedinHref),
        CONTACT_LINE: escapeHtml(contactClassic),
        CONTACT_HTML: contactHtml,
        CONTACT_SPLIT: contactHtml,
        SUMMARY: escapeHtml(summary),
        SKILL_GROUPS: chunks.classicSkills,
        SKILL_CHIPS: chunks.splitSkills,
        EXPERIENCE_CLASSIC: chunks.classicExperience,
        EXPERIENCE_SPLIT: chunks.splitExperience,
        EXPERIENCE_ATS: chunks.atsExperience,
        EDUCATION_CLASSIC: chunks.classicEducation,
        EDUCATION_SPLIT: chunks.splitEducation,
        PROJECTS: chunks.projects
    });

    const layout = resumeLayoutMarkup(id);
    html = html.replace("</head>", `${layout.head}\n</head>`);
    html = html.replace("</body>", `${layout.body}\n</body>`);
    return html;
}
