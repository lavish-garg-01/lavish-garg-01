import crypto from "node:crypto";
import { getDb } from "../database/connection.js";
import { CAREER_PROFILE_DEFINITIONS, classifyJobTitle } from "./roleTaxonomy.js";

export const ANSWER_CONTEXT_REGISTRY_VERSION = 1;
const initializedDatabases = new WeakSet();

const COUNTRY_ROWS = [
    ["IN", "India", ["india", "bharat", "in"]], ["US", "United States", ["united states", "usa", "us", "u.s."]],
    ["GB", "United Kingdom", ["united kingdom", "uk", "gb", "great britain"]], ["CA", "Canada", ["canada", "ca"]],
    ["AU", "Australia", ["australia", "au"]], ["SG", "Singapore", ["singapore", "sg"]],
    ["AE", "United Arab Emirates", ["united arab emirates", "uae", "ae"]], ["DE", "Germany", ["germany", "de"]],
    ["NL", "Netherlands", ["netherlands", "nl"]], ["FR", "France", ["france", "fr"]],
    ["JP", "Japan", ["japan", "jp"]]
];
const EMPLOYMENT_ROWS = [
    ["FULL_TIME", "Full-time", ["full time", "full-time", "permanent"]],
    ["CONTRACT", "Contract", ["contract", "contractor", "freelance"]],
    ["PART_TIME", "Part-time", ["part time", "part-time"]],
    ["INTERNSHIP", "Internship", ["internship", "intern"]],
    ["TEMPORARY", "Temporary", ["temporary", "fixed term", "fixed-term"]]
];
const LOCATION_ROWS = [
    ["REMOTE_INDIA", "Remote — India", ["remote", "remote india", "wfh", "work from home"]],
    ["BENGALURU", "Bengaluru", ["bengaluru", "bangalore"]], ["GURUGRAM", "Gurugram", ["gurugram", "gurgaon"]],
    ["DELHI_NCR", "Delhi NCR", ["delhi", "new delhi", "ncr"]], ["NOIDA", "Noida", ["noida"]],
    ["MUMBAI", "Mumbai", ["mumbai", "bombay"]], ["PUNE", "Pune", ["pune"]],
    ["HYDERABAD", "Hyderabad", ["hyderabad"]], ["CHENNAI", "Chennai", ["chennai", "madras"]],
    ["KOLKATA", "Kolkata", ["kolkata", "calcutta"]], ["AHMEDABAD", "Ahmedabad", ["ahmedabad"]],
    ["KOCHI", "Kochi", ["kochi", "cochin"]], ["JAIPUR", "Jaipur", ["jaipur"]],
    ["CHANDIGARH", "Chandigarh", ["chandigarh"]]
];

function normalized(value = "") {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/^https?:\/\//, "")
        .replace(/^www\./, "").replace(/\/$/, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function identifier(prefix, value) {
    return `${prefix}:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24)}`;
}

function upsertContextRows(db, dimension, rows) {
    const statement = db.prepare(`INSERT INTO answer_context_registry
        (dimension, context_key, label, aliases_json, status) VALUES (?, ?, ?, ?, 'ACTIVE')
        ON CONFLICT(dimension, context_key) DO UPDATE SET label = excluded.label,
            aliases_json = excluded.aliases_json, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP`);
    for (const [key, label, aliases] of rows) {
        statement.run(dimension, key, label, JSON.stringify([...new Set([key, label, ...aliases].map(normalized).filter(Boolean))]));
    }
}

export function syncEmployerContextRegistry() {
    const db = getDb();
    const groups = db.prepare(`INSERT INTO employer_entity_groups
        (id, normalized_name, display_name, status) VALUES (?, ?, ?, 'ACTIVE')
        ON CONFLICT(normalized_name) DO UPDATE SET display_name = excluded.display_name,
            status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP`);
    const entities = db.prepare(`INSERT INTO employer_entities
        (id, employer_group_id, company_id, normalized_name, normalized_domain, legal_name, status)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
        ON CONFLICT(company_id) DO UPDATE SET normalized_name = excluded.normalized_name,
            normalized_domain = excluded.normalized_domain, legal_name = excluded.legal_name,
            status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP`);
    const companies = db.prepare("SELECT id, name, domain FROM companies WHERE TRIM(COALESCE(name, '')) != ''").all();
    const write = db.transaction(() => {
        for (const company of companies) {
            const name = normalized(company.name);
            if (!name) continue;
            const groupId = identifier("employer-group", name);
            groups.run(groupId, name, company.name);
            entities.run(identifier("employer", company.id), groupId, company.id, name,
                normalized(company.domain), company.name);
        }
    });
    write();
    return companies.length;
}

export function ensureAnswerContextRegistry() {
    const db = getDb();
    if (initializedDatabases.has(db)) {
        return Number(db.prepare("SELECT COUNT(*) AS count FROM answer_context_registry WHERE status = 'ACTIVE'").get().count);
    }
    const roleRows = CAREER_PROFILE_DEFINITIONS.map((profile) => [profile.key, profile.label,
        [profile.key, profile.label, ...profile.tracks.map(([track]) => track)]]);
    const write = db.transaction(() => {
        upsertContextRows(db, "COUNTRY", COUNTRY_ROWS);
        upsertContextRows(db, "ROLE_FAMILY", roleRows);
        upsertContextRows(db, "EMPLOYMENT_TYPE", EMPLOYMENT_ROWS);
        upsertContextRows(db, "LOCATION", LOCATION_ROWS);
    });
    write();
    syncEmployerContextRegistry();
    initializedDatabases.add(db);
    return Number(db.prepare("SELECT COUNT(*) AS count FROM answer_context_registry WHERE status = 'ACTIVE'").get().count);
}

function contextRow(dimension, value) {
    const token = normalized(value);
    if (!token) return null;
    const rows = getDb().prepare(`SELECT context_key, label, aliases_json FROM answer_context_registry
        WHERE dimension = ? AND status = 'ACTIVE'`).all(dimension);
    return rows.find((row) => {
        try { return JSON.parse(row.aliases_json || "[]").includes(token); } catch { return false; }
    }) || null;
}

function employerGroup(input = {}) {
    const db = getDb();
    if (input.employerGroupId) {
        return db.prepare("SELECT id, display_name AS label FROM employer_entity_groups WHERE id = ? AND status = 'ACTIVE'")
            .get(String(input.employerGroupId)) || null;
    }
    if (input.companyId) {
        return db.prepare(`SELECT g.id, g.display_name AS label FROM employer_entities e
            JOIN employer_entity_groups g ON g.id = e.employer_group_id
            WHERE e.company_id = ? AND e.status = 'ACTIVE' AND g.status = 'ACTIVE'`).get(String(input.companyId)) || null;
    }
    const name = normalized(input.companyName);
    const domain = normalized(input.companyDomain);
    if (!name && !domain) return null;
    const rows = domain
        ? db.prepare(`SELECT DISTINCT g.id, g.display_name AS label FROM employer_entities e
            JOIN employer_entity_groups g ON g.id = e.employer_group_id
            WHERE e.normalized_domain = ? AND e.status = 'ACTIVE' AND g.status = 'ACTIVE'`).all(domain)
        : db.prepare(`SELECT DISTINCT g.id, g.display_name AS label FROM employer_entities e
            JOIN employer_entity_groups g ON g.id = e.employer_group_id
            WHERE e.normalized_name = ? AND e.status = 'ACTIVE' AND g.status = 'ACTIVE'`).all(name);
    return rows.length === 1 ? rows[0] : null;
}

function applicationExists(id) {
    return id && getDb().prepare("SELECT id FROM applications WHERE id = ?").get(String(id)) ? String(id) : null;
}

function contentRevisionExists(id) {
    if (!id) return null;
    try {
        return getDb().prepare("SELECT id FROM application_content_revisions WHERE id = ?").get(String(id)) ? String(id) : null;
    } catch { return null; }
}

/** Exact, controlled context normalization. No fuzzy entity/legal matching. */
export function normalizeAnswerContext(input = {}, { policy = null } = {}) {
    ensureAnswerContextRegistry();
    const context = {};
    const unknownDimensions = [];
    const reasonCodes = [];
    const application = applicationExists(input.applicationId || input.application);
    const contentRevision = contentRevisionExists(input.applicationContentRevisionId || input.applicationContentRevision);
    if (application) context.application = application;
    else if (input.applicationId || input.application) unknownDimensions.push("APPLICATION");
    if (contentRevision) context.applicationContentRevision = contentRevision;
    else if (input.applicationContentRevisionId || input.applicationContentRevision) unknownDimensions.push("APPLICATION_CONTENT_REVISION");

    const group = employerGroup(input);
    if (group) context.companyGroup = group.id;
    else if (input.employerGroupId || input.companyId || input.companyName || input.companyDomain) unknownDimensions.push("COMPANY_GROUP");

    const country = contextRow("COUNTRY", input.countryCode || input.country);
    if (country) context.country = country.context_key;
    else if (input.countryCode || input.country) unknownDimensions.push("COUNTRY");

    let role = contextRow("ROLE_FAMILY", input.roleFamily);
    if (!role && input.roleTitle) {
        const classified = classifyJobTitle(input.roleTitle);
        if (classified.family) role = contextRow("ROLE_FAMILY", classified.family);
    }
    if (role) context.roleFamily = role.context_key;
    else if (input.roleFamily || input.roleTitle) unknownDimensions.push("ROLE_FAMILY");

    const location = contextRow("LOCATION", input.location);
    if (location) context.location = location.context_key;
    else if (input.location) unknownDimensions.push("LOCATION");

    const employment = contextRow("EMPLOYMENT_TYPE", input.employmentType);
    if (employment) context.employmentType = employment.context_key;
    else if (input.employmentType) unknownDimensions.push("EMPLOYMENT_TYPE");

    const required = new Set(policy?.requiredScopeDimensions || []);
    const dimensionProperty = {
        APPLICATION_CONTENT_REVISION: "applicationContentRevision", APPLICATION: "application",
        COMPANY_GROUP: "companyGroup", COUNTRY: "country", ROLE_FAMILY: "roleFamily",
        LOCATION: "location", EMPLOYMENT_TYPE: "employmentType"
    };
    const missingRequired = [];
    for (const dimension of required) {
        if (!context[dimensionProperty[dimension]]) unknownDimensions.push(dimension);
        if (!context[dimensionProperty[dimension]]) missingRequired.push(dimension);
    }
    const uniqueUnknown = [...new Set(unknownDimensions)];
    if (uniqueUnknown.length) reasonCodes.push("UNKNOWN_CONTROLLED_CONTEXT_IGNORED");
    if (missingRequired.length) reasonCodes.push("REQUIRED_CONTROLLED_CONTEXT_MISSING");
    return {
        registryVersion: ANSWER_CONTEXT_REGISTRY_VERSION,
        ok: !missingRequired.length,
        context: Object.freeze(context),
        unknownDimensions: uniqueUnknown,
        reasonCodes
    };
}

export function answerContextDiagnostics() {
    ensureAnswerContextRegistry();
    const db = getDb();
    return {
        registryVersion: ANSWER_CONTEXT_REGISTRY_VERSION,
        dimensions: db.prepare(`SELECT dimension, COUNT(*) AS count FROM answer_context_registry
            WHERE status = 'ACTIVE' GROUP BY dimension ORDER BY dimension`).all(),
        employerGroups: Number(db.prepare("SELECT COUNT(*) AS count FROM employer_entity_groups WHERE status = 'ACTIVE'").get().count),
        employerEntities: Number(db.prepare("SELECT COUNT(*) AS count FROM employer_entities WHERE status = 'ACTIVE'").get().count)
    };
}
