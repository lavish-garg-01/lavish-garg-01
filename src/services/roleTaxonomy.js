const CAREER_PROFILES = Object.freeze([
    {
        key: "SOFTWARE_ENGINEERING",
        label: "Software engineering",
        description: "Backend, frontend, full-stack, mobile, platform, QA and engineering leadership",
        tracks: [
            ["BACKEND", /backend|back-end|node\.?js|api engineer|server(?:-side)?|distributed systems|java engineer|golang|python engineer/i],
            ["FRONTEND", /frontend|front-end|ui engineer|web engineer|react|angular|vue/i],
            ["FULL_STACK", /full[ -]?stack/i],
            ["MOBILE", /android|ios|mobile|flutter|react native/i],
            ["PLATFORM_DEVOPS", /platform engineer|devops|site reliability|\bsre\b|cloud engineer|infrastructure/i],
            ["QA_AUTOMATION", /quality assurance|\bqa\b|test automation|sdet/i],
            ["ENGINEERING_LEADERSHIP", /engineering manager|technical lead|tech lead|staff engineer|principal engineer|software architect/i],
            ["GENERAL_SOFTWARE", /software engineer|software developer|\bsde\b|programmer|application developer|salesforce developer|crm developer/i]
        ]
    },
    {
        key: "DATA_AI",
        label: "Data, analytics & AI",
        description: "Data science, analytics, data engineering, machine learning and business intelligence",
        tracks: [
            ["DATA_SCIENCE", /data scientist|data science manager|applied scientist|decision scientist|research scientist/i],
            ["DATA_ANALYTICS", /data analyst|business analyst|analytics (?:analyst|manager|consultant)|product analyst|reporting analyst/i],
            ["DATA_ENGINEERING", /data engineer|analytics engineer|etl engineer|data platform/i],
            ["MACHINE_LEARNING", /machine learning|\bml engineer|ai engineer|nlp engineer|computer vision/i],
            ["BUSINESS_INTELLIGENCE", /business intelligence|\bbi developer|power bi|tableau developer/i]
        ]
    },
    {
        key: "PRODUCT_MANAGEMENT",
        label: "Product management",
        description: "Product, technical product, platform product and growth product roles",
        tracks: [
            ["PRODUCT_MANAGER", /product manager|associate product manager|\bapm\b|product owner/i],
            ["TECHNICAL_PRODUCT", /technical product manager|platform product manager|api product manager/i],
            ["GROWTH_PRODUCT", /growth product|product growth/i],
            ["PRODUCT_LEADERSHIP", /head of product|director of product|group product manager|vp product/i]
        ]
    }
]);

const NEGATIVE_TITLES = /\b(?:recruiter|talent acquisition|account executive|sales (?:manager|representative|executive)|legal counsel|graphic designer|content writer|marketing manager)\b/i;

export function careerProfiles() {
    return CAREER_PROFILES.map(({ tracks, ...profile }) => ({
        ...profile,
        tracks: tracks.map(([key]) => key)
    }));
}

export function normalizeCareerProfiles(values = []) {
    const requested = new Set((Array.isArray(values) ? values : [values])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean));
    const supported = CAREER_PROFILES.map((profile) => profile.key).filter((key) => requested.has(key));
    return supported.length ? supported : ["SOFTWARE_ENGINEERING"];
}

export function classifyJobTitle(title = "") {
    const text = String(title || "").trim();
    if (!text || NEGATIVE_TITLES.test(text)) {
        return { family: null, track: null, confidence: 0, label: "Outside selected career profiles" };
    }
    for (const profile of CAREER_PROFILES) {
        for (const [track, pattern] of profile.tracks) {
            if (pattern.test(text)) {
                return { family: profile.key, track, confidence: 0.98, label: profile.label };
            }
        }
    }
    return { family: null, track: null, confidence: 0.2, label: "Unclassified" };
}

export function isTargetJobTitle(title = "", selectedProfiles = ["SOFTWARE_ENGINEERING"]) {
    const classification = classifyJobTitle(title);
    return Boolean(classification.family && normalizeCareerProfiles(selectedProfiles).includes(classification.family));
}

export function profileForTargets(targetRoles = []) {
    const families = new Set();
    for (const role of targetRoles || []) {
        const classified = classifyJobTitle(role);
        if (classified.family) families.add(classified.family);
    }
    return normalizeCareerProfiles([...families]);
}

export function searchTermsForCareerProfiles(selectedProfiles = []) {
    const terms = {
        SOFTWARE_ENGINEERING: ["software engineer", "backend engineer", "full stack engineer", "platform engineer"],
        DATA_AI: ["data scientist", "data analyst", "data engineer", "machine learning engineer"],
        PRODUCT_MANAGEMENT: ["product manager", "technical product manager", "product owner"]
    };
    return normalizeCareerProfiles(selectedProfiles).flatMap((profile) => terms[profile] || []);
}

export const CAREER_PROFILE_DEFINITIONS = CAREER_PROFILES;
