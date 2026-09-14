import crypto from "crypto";
import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";
import { classifyJobTitle } from "../services/roleTaxonomy.js";

const CATEGORIES = [
    { key: "BACKEND_API", name: "Backend & APIs", description: "Node.js, APIs, services and backend systems", pattern: /backend|node\.?js|api|microservice|server/i },
    { key: "FULL_STACK", name: "Full-stack", description: "Frontend plus backend product engineering", pattern: /full[ -]?stack|react|frontend|front-end/i },
    { key: "DATA_PLATFORM", name: "Data & Platform", description: "Data systems, analytics and distributed platforms", pattern: /data engineer|data platform|analytics|etl|kafka|spark/i },
    { key: "CLOUD_DEVOPS", name: "Cloud & DevOps", description: "Cloud infrastructure, SRE and delivery systems", pattern: /devops|site reliability|\bsre\b|cloud|kubernetes|infrastructure/i },
    { key: "LEADERSHIP", name: "Engineering leadership", description: "Lead, staff and engineering management roles", pattern: /staff|principal|lead|manager|architect/i },
    { key: "FINTECH", name: "Fintech backend", description: "Payments, banking and financial infrastructure", pattern: /fintech|payment|banking|finance|ledger|expense/i },
    { key: "MOBILE", name: "Mobile engineering", description: "Android, iOS and cross-platform mobile", pattern: /android|ios|mobile|flutter|react native/i },
    { key: "DATA_SCIENCE", name: "Data science & ML", description: "Machine learning, experimentation and applied data science", pattern: /data scientist|machine learning|\bml\b|applied scientist/i },
    { key: "DATA_ANALYTICS", name: "Data analytics", description: "SQL, product analytics, BI and decision support", pattern: /data analyst|analytics|business intelligence|power bi|tableau/i },
    { key: "PRODUCT", name: "Product management", description: "Product discovery, roadmaps, metrics and cross-functional delivery", pattern: /product manager|product owner|product lead/i },
    { key: "GENERAL", name: "General software engineering", description: "Broad software engineering applications", pattern: /.*/i }
];

function parse(value, fallback = {}) {
    try { return JSON.parse(value || "") || fallback; } catch { return fallback; }
}

function meaningful(modifications = {}) {
    return Boolean(String(modifications.resumeSummary || "").trim()
        || modifications.modifiedBullets?.length || modifications.modifiedBulletsByRole?.length
        || modifications.extraSkills?.length || modifications.keywordsToEmphasize?.length);
}

export function resumeCategory(job = {}) {
    const text = `${job.title || ""} ${job.description || ""}`;
    const classification = classifyJobTitle(job.title);
    const byTrack = {
        DATA_SCIENCE: "DATA_SCIENCE", MACHINE_LEARNING: "DATA_SCIENCE",
        DATA_ANALYTICS: "DATA_ANALYTICS", BUSINESS_INTELLIGENCE: "DATA_ANALYTICS",
        DATA_ENGINEERING: "DATA_PLATFORM",
        PRODUCT_MANAGER: "PRODUCT", TECHNICAL_PRODUCT: "PRODUCT",
        GROWTH_PRODUCT: "PRODUCT", PRODUCT_LEADERSHIP: "PRODUCT",
        MOBILE: "MOBILE", PLATFORM_DEVOPS: "CLOUD_DEVOPS",
        ENGINEERING_LEADERSHIP: "LEADERSHIP", FULL_STACK: "FULL_STACK", BACKEND: "BACKEND_API"
    };
    const classifiedKey = byTrack[classification.track];
    if (classifiedKey) return CATEGORIES.find((category) => category.key === classifiedKey);
    // Leadership is intentionally checked first so senior variants remain distinct.
    const order = [CATEGORIES[4], CATEGORIES[5], ...CATEGORIES.filter((_, index) => ![4, 5].includes(index))];
    return order.find((category) => category.pattern.test(text)) || CATEGORIES.at(-1);
}

function publicVariant(row) {
    if (!row) return null;
    return {
        id: row.id, categoryKey: row.category_key, name: row.name, description: row.description,
        modifications: parse(row.modifications_json), sourceJobId: row.source_job_id,
        active: Boolean(row.active), useCount: Number(row.use_count || 0), lastUsedAt: row.last_used_at,
        createdAt: row.created_at, updatedAt: row.updated_at
    };
}

export function listActiveResumeVariants() {
    return getDb().prepare(`SELECT * FROM resume_variants WHERE user_id = ? AND active = 1
        ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC LIMIT 8`)
        .all(LOCAL_USER_ID).map(publicVariant);
}

export function getResumeVariant(id) {
    return publicVariant(getDb().prepare("SELECT * FROM resume_variants WHERE id = ? AND user_id = ? AND active = 1")
        .get(id, LOCAL_USER_ID));
}

export function upsertResumeVariantForJob(job, modifications, { replace = false } = {}) {
    if (!job || !meaningful(modifications)) return null;
    const category = resumeCategory(job);
    const existing = getDb().prepare("SELECT * FROM resume_variants WHERE user_id = ? AND category_key = ?")
        .get(LOCAL_USER_ID, category.key);
    if (existing && !replace) {
        if (!existing.active) {
            getDb().prepare(`UPDATE resume_variants SET active=1, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
                .run(existing.id);
        }
        return getResumeVariant(existing.id);
    }
    const id = existing?.id || crypto.randomUUID();
    getDb().prepare(`INSERT INTO resume_variants
        (id,user_id,category_key,name,description,modifications_json,source_job_id,active)
        VALUES (?,?,?,?,?,?,?,1)
        ON CONFLICT(user_id,category_key) DO UPDATE SET name=excluded.name, description=excluded.description,
            modifications_json=excluded.modifications_json, source_job_id=excluded.source_job_id, active=1,
            updated_at=CURRENT_TIMESTAMP`)
        .run(id, LOCAL_USER_ID, category.key, category.name, category.description,
            JSON.stringify(modifications), job.id || null);
    return getResumeVariant(id);
}

export function seedResumeVariantsFromJobs() {
    const rows = getDb().prepare(`SELECT j.*, c.name AS company_name FROM jobs j
        LEFT JOIN companies c ON c.id=j.company_id
        WHERE j.resume_modifications IS NOT NULL AND j.resume_modifications != ''
        ORDER BY COALESCE(j.applied_at,j.created_at) DESC LIMIT 100`).all();
    for (const job of rows) upsertResumeVariantForJob(job, parse(job.resume_modifications));
    return listActiveResumeVariants();
}

export function bestResumeVariantForJob(job) {
    const category = resumeCategory(job);
    const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
    return listActiveResumeVariants().map((variant) => {
        const keywords = [
            ...(variant.modifications?.keywordsToEmphasize || []),
            ...(variant.modifications?.extraSkills || [])
        ];
        const keywordMatches = keywords.filter((keyword) => text.includes(String(keyword).toLowerCase())).length;
        const categoryScore = variant.categoryKey === category.key ? 100 : variant.categoryKey === "GENERAL" ? 20 : 0;
        const reuseScore = Math.min(10, Math.log2(Number(variant.useCount || 0) + 1) * 3);
        return { variant, score: categoryScore + keywordMatches * 4 + reuseScore };
    }).sort((a, b) => b.score - a.score)[0]?.variant || null;
}

export function assignResumeVariant(jobId, variantId) {
    const variant = getResumeVariant(variantId);
    if (!variant) throw new Error("Active resume variant not found.");
    const result = getDb().prepare(`UPDATE jobs SET resume_variant_id=?, resume_modifications=?, generated_resume_path=NULL
        WHERE id=?`).run(variant.id, JSON.stringify(variant.modifications), jobId);
    if (!result.changes) throw new Error("Job not found.");
    getDb().prepare(`UPDATE resume_variants SET use_count=use_count+1,last_used_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(variant.id);
    return variant;
}

export function assignBestResumeVariant(job) {
    seedResumeVariantsFromJobs();
    const variant = bestResumeVariantForJob(job);
    return variant ? assignResumeVariant(job.id, variant.id) : null;
}
