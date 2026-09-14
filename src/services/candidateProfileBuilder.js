import { extractKnownSkills } from "./skillOntology.js";
import { profileForTargets } from "./roleTaxonomy.js";

const PARSER_VERSION = "resume-profile-v3-layout-evidence";

const SKILL_LEXICON = [
    "JavaScript", "TypeScript", "Node.js", "Express.js", "React", "Angular", "Vue.js",
    "Python", "Java", "Kotlin", "Go", "PHP", "C#", ".NET", "Ruby", "Rust",
    "MySQL", "PostgreSQL", "MongoDB", "Redis", "ClickHouse", "DynamoDB", "Elasticsearch",
    "REST", "GraphQL", "WebSocket", "WebRTC", "Kafka", "RabbitMQ", "Microservices",
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "CI/CD", "GitHub Actions",
    "Prometheus", "Grafana", "SQL Tuning", "System Design", "Data Structures & Algorithms",
    "Machine Learning", "Generative AI", "LLM", "NLP", "Spark", "Airflow"
];

function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
    const seen = new Set();
    return values.map(clean).filter((value) => {
        const key = value.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function monthValue(value, presentAsNow = true) {
    const text = clean(value);
    if (!text) return null;
    if (/present|current|now/i.test(text)) {
        const now = new Date();
        return presentAsNow ? now.getUTCFullYear() * 12 + now.getUTCMonth() : null;
    }
    const iso = text.match(/(19|20)\d{2}[\/-](1[0-2]|0?[1-9])/);
    if (iso) return Number(iso[0].slice(0, 4)) * 12 + Number(iso[2]) - 1;
    const year = text.match(/\b(19|20)\d{2}\b/);
    if (!year) return null;
    const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = names.findIndex((name) => text.toLowerCase().includes(name));
    return Number(year[0]) * 12 + Math.max(0, month);
}

export function totalExperienceYears(experience = []) {
    const ranges = experience.map((role) => [monthValue(role.startDate), monthValue(role.endDate)])
        .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
        .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
        const prior = merged.at(-1);
        if (!prior || range[0] > prior[1] + 1) merged.push([...range]);
        else prior[1] = Math.max(prior[1], range[1]);
    }
    const months = merged.reduce((sum, [start, end]) => sum + end - start + 1, 0);
    return months ? Math.round((months / 12) * 10) / 10 : null;
}

function contactFromText(text) {
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
    const phone = text.match(/(?:\+?91[\s-]?)?[6-9]\d(?:[\s-]?\d){8}/)?.[0]?.replace(/[^+\d]/g, "") || "";
    const linkedin = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Z0-9_%./-]+/i)?.[0] || "";
    const github = text.match(/https?:\/\/(?:www\.)?github\.com\/[A-Z0-9_.-]+/i)?.[0] || "";
    const portfolio = text.match(/https?:\/\/(?![^\s]*(?:linkedin|github)\.com)[^\s<>]+/i)?.[0] || "";
    return { email, phone, linkedin, github, portfolio };
}

function nameFromText(text, contact) {
    const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean).slice(0, 10);
    return lines.find((line) => line.length >= 3 && line.length <= 70
        && !line.includes("@") && !/resume|curriculum|linkedin|github|\d{5}/i.test(line)
        && /^[A-Za-z][A-Za-z .'-]+$/.test(line)) || "";
}

function skillsFromText(text, existing = {}) {
    const haystack = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ")} `;
    const detected = SKILL_LEXICON.filter((skill) => {
        const token = skill.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
        return token && haystack.includes(` ${token} `);
    });
    // Prefer the canonical flat skill list. Group labels can contain display-only
    // fragments such as "AWS (EC2" / "CloudFront)" and must not become facts.
    const canonicalSkills = Array.isArray(existing.skills) && existing.skills.length
        ? existing.skills
        : Object.values(existing.skillGroups || {}).flat();
    const existingSkills = canonicalSkills
        .filter((skill) => haystack.includes(clean(skill).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim()));
    return unique([...extractKnownSkills(text), ...detected, ...existingSkills]);
}

const SECTION_HEADING = /^(?:professional\s+)?(summary|profile|skills?|technical skills?|core competencies|work experience|professional experience|employment(?: history)?|career history|education|academic(?: background|qualifications?)?|projects?|certifications?|achievements?)$/i;
const EXPERIENCE_HEADING = /work experience|professional experience|employment(?: history)?/i;
const EDUCATION_HEADING = /education|academic(?: background|qualifications?)?/i;
const DATE_TOKEN = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*[ .'-]+(?:19|20)?\\d{2,4}|(?:0?[1-9]|1[0-2])[./-](?:19|20)\\d{2}|(?:19|20)\\d{2}(?:[-/]\\d{1,2})?";
const DATE_RANGE = new RegExp(`(${DATE_TOKEN})\\s*(?:[-–—]|to)\\s*(present|current|now|${DATE_TOKEN})`, "i");
const ROLE_WORD = /engineer|developer|scientist|analyst|manager|lead|architect|consultant|designer|owner|intern|specialist|administrator/i;
const DEGREE_WORD = /b\.?tech|m\.?tech|b\.?e\.?|m\.?e\.?|b\.?sc|m\.?sc|bachelor|master|mba|ph\.?d|diploma|computer science|engineering/i;
const INSTITUTION_WORD = /university|college|institute|school|academy|iit\b|nit\b/i;

function meaningfulLines(text) {
    return String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
}

function sectionRanges(lines) {
    const headings = lines.map((line, index) => SECTION_HEADING.test(line) ? { index, line } : null).filter(Boolean);
    return headings.map((heading, index) => ({
        heading: heading.line,
        start: heading.index + 1,
        end: headings[index + 1]?.index ?? lines.length
    }));
}

function linesForSection(lines, matcher) {
    const range = sectionRanges(lines).find((section) => matcher.test(section.heading));
    return range ? lines.slice(range.start, range.end) : [];
}

function splitRoleHeading(value = "") {
    const parts = String(value).split(/\s+(?:at|@|\||—|–|-)\s+|\s*,\s*/).map(clean).filter(Boolean);
    if (parts.length < 2) return null;
    const titleIndex = parts.findIndex((part) => ROLE_WORD.test(part));
    if (titleIndex < 0) return null;
    return { title: parts[titleIndex], company: parts.find((_, index) => index !== titleIndex) || "" };
}

function parseExperienceFromText(text) {
    const allLines = meaningfulLines(text);
    const scoped = linesForSection(allLines, EXPERIENCE_HEADING);
    const lines = scoped.length ? scoped : allLines;
    const roles = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const range = line.match(DATE_RANGE);
        if (!range) continue;
        const prefix = clean(line.replace(range[0], ""));
        const prior = [lines[index - 1], lines[index - 2]].filter(Boolean).filter((item) => !DATE_RANGE.test(item));
        const combined = splitRoleHeading(prefix) || prior.map(splitRoleHeading).find(Boolean);
        const title = combined?.title || prior.find((item) => ROLE_WORD.test(item)) || (ROLE_WORD.test(prefix) ? prefix : "");
        const company = combined?.company || prior.find((item) => item !== title && !SECTION_HEADING.test(item)) || "";
        if (!title && !company) continue;
        const bullets = [];
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            if (DATE_RANGE.test(lines[cursor]) || SECTION_HEADING.test(lines[cursor])) break;
            const bullet = clean(lines[cursor].replace(/^[•●▪◦*-]+\s*/, ""));
            if (bullet.length >= 20) bullets.push(bullet);
            if (bullets.length >= 10) break;
        }
        roles.push({
            title, company, location: "", startDate: clean(range[1]), endDate: clean(range[2]),
            description: "", bullets: unique(bullets),
            confidence: title && company ? 0.82 : 0.62,
            evidence: { heading: [prefix, ...prior].filter(Boolean).join(" | "), dateRange: range[0] }
        });
    }
    return roles.filter((role, index, rows) => rows.findIndex((other) =>
        other.title.toLowerCase() === role.title.toLowerCase()
        && other.company.toLowerCase() === role.company.toLowerCase()
        && other.startDate === role.startDate) === index);
}

function parseEducationFromText(text) {
    const allLines = meaningfulLines(text);
    const scoped = linesForSection(allLines, EDUCATION_HEADING);
    const lines = scoped.length ? scoped : allLines;
    const entries = [];
    for (let index = 0; index < lines.length; index += 1) {
        const range = lines[index].match(DATE_RANGE);
        if (!range) continue;
        const candidates = [clean(lines[index].replace(range[0], "")), lines[index - 1], lines[index - 2]]
            .map(clean).filter(Boolean);
        const degree = candidates.find((item) => DEGREE_WORD.test(item)) || "";
        const institution = candidates.find((item) => INSTITUTION_WORD.test(item)) || "";
        if (!degree && !institution) continue;
        entries.push({
            institution, degree, field: "", location: "", startDate: clean(range[1]), endDate: clean(range[2]),
            description: "", confidence: degree && institution ? 0.84 : 0.64,
            evidence: { heading: candidates.join(" | "), dateRange: range[0] }
        });
    }
    return entries;
}

function identityMatches(text, resume = {}) {
    const normalized = String(text || "").toLowerCase();
    return Boolean((resume.email && normalized.includes(String(resume.email).toLowerCase()))
        || (resume.fullName && normalized.includes(String(resume.fullName).toLowerCase())));
}

function normalizedExperience(rows = []) {
    return rows.map((role) => ({
        title: clean(role.title), company: clean(role.company), location: clean(role.location),
        startDate: clean(role.startDate), endDate: clean(role.endDate),
        description: clean(role.description), bullets: unique(role.bullets || []),
        confidence: 1, evidence: { source: "VERIFIED_MASTER_RESUME" }
    })).filter((role) => role.title || role.company);
}

function normalizedEducation(rows = []) {
    return rows.map((item) => ({
        institution: clean(item.institution || item.school), degree: clean(item.degree),
        field: clean(item.field || item.fieldOfStudy), location: clean(item.location),
        startDate: clean(item.startDate), endDate: clean(item.endDate), description: clean(item.description),
        confidence: 1, evidence: { source: "VERIFIED_MASTER_RESUME" }
    })).filter((item) => item.institution || item.degree);
}

function suggestedRoles(experience, skills) {
    const titles = unique(experience.map((role) => role.title).map((title) => {
        if (/^team lead$/i.test(title)) return "Engineering Team Lead";
        if (/^backend developer$/i.test(title)) return "Backend Engineer";
        if (/^(?:developer|freelancer|consultant)$/i.test(title)) return "";
        return title;
    })).slice(0, 5);
    const lower = skills.join(" ").toLowerCase();
    const inferred = [];
    if (/node|express|java|python|go|microservices|rest/.test(lower)) inferred.push("Backend Engineer");
    if (/react|angular|vue|javascript|typescript/.test(lower)) inferred.push("Full-stack Engineer");
    if (/aws|gcp|azure|docker|kubernetes|terraform/.test(lower)) inferred.push("Cloud / Platform Engineer");
    if (/lead|manager|architect/.test(titles.join(" ").toLowerCase())) inferred.push("Engineering Lead");
    return unique([...titles, ...inferred]).slice(0, 8);
}

export function buildCandidateResumeProfile({ text = "", existingResume = {} } = {}) {
    const plainText = String(text || "").replace(/\u0000/g, "");
    const contact = contactFromText(plainText);
    const sameCandidate = identityMatches(plainText, existingResume);
    const parsedExperience = parseExperienceFromText(plainText);
    const parsedEducation = parseEducationFromText(plainText);
    const canonicalExperience = sameCandidate ? normalizedExperience(existingResume.experience) : [];
    const canonicalEducation = sameCandidate ? normalizedEducation(existingResume.education) : [];
    const experience = parsedExperience.length ? parsedExperience : canonicalExperience;
    const education = parsedEducation.length ? parsedEducation : canonicalEducation;
    const experienceSource = parsedExperience.length ? "PDF_LAYOUT_TEXT" : canonicalExperience.length ? "VERIFIED_MASTER_FALLBACK" : "MISSING";
    const educationSource = parsedEducation.length ? "PDF_LAYOUT_TEXT" : canonicalEducation.length ? "VERIFIED_MASTER_FALLBACK" : "MISSING";
    const skills = skillsFromText(plainText, sameCandidate ? existingResume : {});
    const fullName = nameFromText(plainText, contact) || (sameCandidate ? clean(existingResume.fullName) : "");
    const summary = sameCandidate ? clean(existingResume.summary) : "";
    const years = totalExperienceYears(experience);
    const currentRole = experience.find((role) => /present|current/i.test(role.endDate)) || experience[0] || null;
    const completenessSignals = [fullName, contact.email, contact.phone, skills.length, experience.length, education.length];
    const completeness = Math.round((completenessSignals.filter(Boolean).length / completenessSignals.length) * 100);
    const structuralConfidence = (() => {
        const rowConfidence = [...experience, ...education].map((row) => Number(row.confidence || 0.5));
        return rowConfidence.length ? rowConfidence.reduce((sum, value) => sum + value, 0) / rowConfidence.length : 0.35;
    })();
    const confidence = Math.min(0.99, Math.max(0.2, (completeness / 100) * 0.55 + structuralConfidence * 0.45));
    const targetRoles = suggestedRoles(experience, skills);
    const warnings = [];
    if (!experience.length) warnings.push("No reliable experience date ranges were extracted.");
    if (!education.length) warnings.push("No reliable education entry was extracted.");
    if (experienceSource === "VERIFIED_MASTER_FALLBACK") warnings.push("Experience was recovered from the verified master profile because this PDF text did not expose reliable role boundaries.");
    if (educationSource === "VERIFIED_MASTER_FALLBACK") warnings.push("Education was recovered from the verified master profile because this PDF text did not expose a reliable education boundary.");
    if (!sameCandidate) warnings.push("This PDF was parsed independently; verify every inferred role and date before promotion.");
    return {
        parserVersion: PARSER_VERSION,
        confidence,
        completeness,
        source: sameCandidate ? "PDF_TEXT_PLUS_VERIFIED_MASTER" : "PDF_TEXT",
        contact: {
            fullName, email: contact.email || (sameCandidate ? existingResume.email || "" : ""),
            phone: contact.phone || (sameCandidate ? existingResume.phone || "" : ""),
            location: sameCandidate ? clean(existingResume.location) : "",
            linkedin: contact.linkedin || (sameCandidate ? existingResume.linkedin || "" : ""),
            github: contact.github || (sameCandidate ? existingResume.github || "" : ""),
            portfolio: contact.portfolio || (sameCandidate ? existingResume.portfolio || "" : "")
        },
        summary,
        skills,
        skillGroups: sameCandidate ? existingResume.skillGroups || {} : { detected: skills },
        preferredSkills: skills.slice(0, 12),
        experience,
        education,
        projects: sameCandidate ? existingResume.projects || [] : [],
        career: {
            totalExperienceYears: years,
            roleCount: experience.length,
            educationCount: education.length,
            currentTitle: currentRole?.title || "",
            currentCompany: currentRole?.company || ""
        },
        searchSuggestions: {
            targetRoles,
            careerProfiles: profileForTargets(targetRoles),
            skills: skills.slice(0, 16)
        },
        evidence: {
            identityMatchedCanonicalResume: sameCandidate,
            contact: contact,
            sectionSources: { experience: experienceSource, education: educationSource },
            experienceRows: experience.map((row) => row.evidence || null),
            educationRows: education.map((row) => row.evidence || null)
        },
        extraction: {
            mode: plainText.trim() ? "LAYOUT_TEXT" : "OCR_REQUIRED",
            parsedExperienceCount: parsedExperience.length,
            parsedEducationCount: parsedEducation.length,
            canonicalFallbackUsed: experienceSource === "VERIFIED_MASTER_FALLBACK"
                || educationSource === "VERIFIED_MASTER_FALLBACK"
        },
        warnings,
        reviewRequired: !sameCandidate || completeness < 80 || confidence < 0.8
    };
}

export function parsedResumeProfile(row) {
    try { return row?.parsed_profile_json ? JSON.parse(row.parsed_profile_json) : null; }
    catch { return null; }
}

export { PARSER_VERSION };
