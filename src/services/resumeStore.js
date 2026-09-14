import fs from "fs";
import path from "path";
import { env } from "../config/environment.js";
import { getDb } from "../database/connection.js";

function uniqueList(values = []) {
    const seen = new Set();
    const out = [];
    for (const raw of values) {
        const item = String(raw || "").trim();
        if (!item) continue;
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

export function splitList(value) {
    if (Array.isArray(value)) {
        return uniqueList(value.flatMap((item) => splitList(item)));
    }
    return uniqueList(
        String(value || "")
            .split(/[\n,;]+/)
            .map((part) => part.trim())
    );
}

export function splitLines(value) {
    if (Array.isArray(value)) {
        return uniqueList(value.map((item) => String(item || "").trim()));
    }
    return String(value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

export function scoringTerms(resume = {}) {
    return uniqueList([...(resume.skills || []), ...(resume.keywords || [])]);
}

export function loadResume() {
    const raw = fs.readFileSync(env.paths.masterResume, "utf8");
    const resume = JSON.parse(raw);
    if (!Array.isArray(resume.skills)) resume.skills = [];
    if (!Array.isArray(resume.keywords)) resume.keywords = [];
    if (!resume.skillGroups || typeof resume.skillGroups !== "object") resume.skillGroups = {};
    if (!Array.isArray(resume.experience)) resume.experience = [];
    if (!Array.isArray(resume.projects)) resume.projects = [];
    if (!Array.isArray(resume.education)) resume.education = [];
    return resume;
}

function asIndexedArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return Object.keys(value)
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]);
}

export function resumeFromForm(body = {}) {
    const skillGroups = {};
    const groupRows = asIndexedArray(body.skillGroup);
    if (groupRows.length) {
        for (const row of groupRows) {
            const name = String(row?.name || "").trim();
            if (!name) continue;
            skillGroups[name] = splitList(row.values);
        }
    } else if (body.skillGroups && typeof body.skillGroups === "object" && !Array.isArray(body.skillGroups)) {
        for (const [name, values] of Object.entries(body.skillGroups)) {
            const key = String(name || "").trim();
            if (!key) continue;
            skillGroups[key] = splitList(values);
        }
    }

    const experience = asIndexedArray(body.experience)
        .map((role) => ({
            company: String(role?.company || "").trim(),
            title: String(role?.title || "").trim(),
            startDate: String(role?.startDate || "").trim(),
            endDate: String(role?.endDate || "").trim() || "Present",
            location: String(role?.location || "").trim(),
            bullets: splitLines(role?.bullets)
        }))
        .filter((role) => role.company || role.title || role.bullets.length);

    const projects = asIndexedArray(body.project)
        .map((project) => ({
            name: String(project?.name || "").trim(),
            bullets: splitLines(project?.bullets)
        }))
        .filter((project) => project.name || project.bullets.length);

    const education = asIndexedArray(body.education)
        .map((edu) => ({
            school: String(edu?.school || "").trim(),
            degree: String(edu?.degree || "").trim(),
            startDate: String(edu?.startDate || "").trim(),
            endDate: String(edu?.endDate || "").trim()
        }))
        .filter((edu) => edu.school || edu.degree);

    const notice = Number(body.noticePeriodDays);
    return {
        fullName: String(body.fullName || "").trim(),
        email: String(body.email || "").trim(),
        phone: String(body.phone || "").trim(),
        location: String(body.location || "").trim(),
        linkedin: String(body.linkedin || "").trim(),
        github: String(body.github || "").trim(),
        portfolio: String(body.portfolio || "").trim(),
        noticePeriodDays: Number.isFinite(notice) ? notice : 0,
        summary: String(body.summary || "").trim(),
        skills: splitList(body.skills),
        keywords: splitList(body.keywords),
        skillGroups,
        experience,
        projects,
        education
    };
}

export function validateResume(resume) {
    if (!resume.fullName) throw new Error("Full name is required");
    if (!resume.email) throw new Error("Email is required");
    if (!resume.summary) throw new Error("Summary is required");
    if (!resume.skills.length) throw new Error("Add at least one skill — the matcher uses this list");
    if (!resume.experience.length) throw new Error("Add at least one experience role");
    return resume;
}

export function resumeToText(resume) {
    const skillGroupLines = Object.entries(resume.skillGroups || {})
        .map(([name, items]) => `${name}: ${(items || []).join(", ")}`)
        .join("\n");

    const experience = (resume.experience || [])
        .map((role) => {
            const header = `${String(role.title || "").toUpperCase()}, ${String(role.company || "").toUpperCase()} ${role.startDate || ""} – ${role.endDate || ""}`;
            const bullets = (role.bullets || []).map((line) => `• ${line}`).join("\n");
            return `${header}\n${bullets}`;
        })
        .join("\n\n");

    const education = (resume.education || [])
        .map((edu) => `${edu.degree || ""}, ${edu.school || ""} ${edu.startDate || ""} – ${edu.endDate || ""}`)
        .join("\n");

    const projects = (resume.projects || [])
        .map((project) => {
            const bullets = (project.bullets || []).map((line) => `• ${line}`).join("\n");
            return `${project.name || ""}\n${bullets}`.trim();
        })
        .filter(Boolean)
        .join("\n\n");

    return [
        String(resume.fullName || "").toUpperCase(),
        [resume.email, resume.phone, resume.location, resume.linkedin, resume.github].filter(Boolean).join(" • "),
        "",
        "SUMMARY",
        resume.summary || "",
        "",
        "SKILLS",
        skillGroupLines || (resume.skills || []).join(", "),
        resume.keywords?.length ? `\nMATCH KEYWORDS\n${resume.keywords.join(", ")}` : "",
        "",
        "EXPERIENCE",
        experience,
        projects ? `\nPROJECTS\n${projects}` : "",
        "",
        "EDUCATION",
        education,
        ""
    ]
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function saveResume(resume) {
    const next = validateResume(resume);
    const jsonPath = env.paths.masterResume;
    const txtPath = path.join(path.dirname(jsonPath), "master_resume.txt");
    const backupPath = path.join(path.dirname(jsonPath), "master_resume.backup.json");

    if (fs.existsSync(jsonPath)) {
        fs.copyFileSync(jsonPath, backupPath);
    }

    const tmp = `${jsonPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, jsonPath);
    fs.writeFileSync(txtPath, `${resumeToText(next)}\n`, "utf8");
    // Every tailored PDF is derived from the master resume. Keep only the
    // compact deltas and force a fresh on-demand render after profile edits.
    getDb().prepare("UPDATE jobs SET generated_resume_path = NULL WHERE generated_resume_path IS NOT NULL").run();
    return next;
}

export function collectGapInsights(resume = loadResume(), { limit = 16 } = {}) {
    const db = getDb();
    const rows = db
        .prepare(
            `
            SELECT title, status, ai_analysis
            FROM jobs
            WHERE ai_analysis IS NOT NULL
              AND status IN ('CLOSE', 'REJECTED', 'PREFILTERED')
            ORDER BY created_at DESC
            LIMIT 250
            `
        )
        .all();

    const owned = new Set(scoringTerms(resume).map((item) => item.toLowerCase()));
    const counts = new Map();

    for (const row of rows) {
        let analysis;
        try {
            analysis = JSON.parse(row.ai_analysis);
        } catch {
            continue;
        }
        const missing = Array.isArray(analysis.missingSkills) ? analysis.missingSkills : [];
        for (const skill of missing) {
            const label = String(skill || "").trim();
            if (!label || owned.has(label.toLowerCase())) continue;
            const current = counts.get(label.toLowerCase()) || { label, count: 0 };
            current.count += 1;
            counts.set(label.toLowerCase(), current);
        }
    }

    return [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}

export function requeueForRescoring() {
    const db = getDb();
    const result = db
        .prepare(
            `
            UPDATE jobs
            SET status = 'PENDING',
                match_score = -1
            WHERE status IN ('PREFILTERED', 'REJECTED', 'CLOSE')
            `
        )
        .run();
    return result.changes;
}
