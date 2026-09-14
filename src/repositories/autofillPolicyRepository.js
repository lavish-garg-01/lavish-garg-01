import { getDb } from "../database/connection.js";
import { LOCAL_USER_ID } from "./copilotRepository.js";

export const AUTOFILL_MODES = Object.freeze(["AUTO_VERIFIED", "ASK_EACH_TIME", "NEVER"]);
export const PROTECTED_AUTOFILL_CATEGORIES = Object.freeze(["SENSITIVE", "LEGAL"]);
export const DEFAULT_AUTOFILL_POLICIES = Object.freeze({
    IDENTITY: "AUTO_VERIFIED",
    CONTACT: "AUTO_VERIFIED",
    PROFESSIONAL: "AUTO_VERIFIED",
    COMPENSATION: "ASK_EACH_TIME",
    AVAILABILITY: "ASK_EACH_TIME",
    PREFERENCE: "ASK_EACH_TIME",
    WRITING: "ASK_EACH_TIME",
    SENSITIVE: "NEVER",
    LEGAL: "NEVER"
});

function normalizeCategory(value) {
    const category = String(value || "").trim().toUpperCase();
    if (!(category in DEFAULT_AUTOFILL_POLICIES)) throw new Error("Unknown autofill category.");
    return category;
}

export function getAutofillPolicies() {
    const rows = getDb().prepare(`SELECT category, mode, candidate_approved AS candidateApproved,
        approved_at AS approvedAt, updated_at AS updatedAt
        FROM autofill_category_policies WHERE user_id = ?`).all(LOCAL_USER_ID);
    const persisted = Object.fromEntries(rows.map((row) => [row.category, row]));
    return Object.entries(DEFAULT_AUTOFILL_POLICIES).map(([category, defaultMode]) => ({
        category,
        mode: PROTECTED_AUTOFILL_CATEGORIES.includes(category) ? "NEVER" : (persisted[category]?.mode || defaultMode),
        candidateApproved: Boolean(persisted[category]?.candidateApproved),
        approvedAt: persisted[category]?.approvedAt || null,
        isProtected: PROTECTED_AUTOFILL_CATEGORIES.includes(category)
    }));
}

export function autofillPolicyMap() {
    return Object.freeze(Object.fromEntries(getAutofillPolicies().map(({ category, mode }) => [category, mode])));
}

export function saveAutofillPolicy({ category, mode, candidateApproved = false } = {}) {
    const safeCategory = normalizeCategory(category);
    const safeMode = String(mode || "").trim().toUpperCase();
    if (!AUTOFILL_MODES.includes(safeMode)) throw new Error("Invalid autofill policy mode.");
    if (!candidateApproved) throw new Error("Candidate approval is required to change autofill policy.");
    if (PROTECTED_AUTOFILL_CATEGORIES.includes(safeCategory) && safeMode !== "NEVER") {
        throw new Error(`${safeCategory.toLowerCase()} fields can never be autofilled.`);
    }
    getDb().prepare(`INSERT INTO autofill_category_policies
        (user_id, category, mode, candidate_approved, approved_at)
        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, category) DO UPDATE SET
            mode = excluded.mode, candidate_approved = 1,
            approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`)
        .run(LOCAL_USER_ID, safeCategory, safeMode);
    return getAutofillPolicies().find((item) => item.category === safeCategory);
}
