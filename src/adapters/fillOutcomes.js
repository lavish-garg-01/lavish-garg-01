export const FILL_OUTCOMES = Object.freeze({
    DETECTED: "DETECTED",
    NOT_ATTEMPTED: "NOT_ATTEMPTED",
    FILL_ATTEMPTED: "FILL_ATTEMPTED",
    FILLED: "FILLED",
    FILL_FAILED: "FILL_FAILED",
    SNAPSHOT_LIE: "SNAPSHOT_LIE",
    LEGAL_BLOCK: "LEGAL_BLOCK",
    USER_CORRECTED: "USER_CORRECTED",
    HIDDEN: "HIDDEN",
    UNCHANGED: "UNCHANGED",
    BLOCKED: "BLOCKED",
    INVALID: "INVALID"
});

export const LEGACY_FIELD_STATES = Object.freeze([
    "DETECTED", "FILLED", "UNCHANGED", "INVALID", "HIDDEN", "BLOCKED", "USER_EDITED"
]);

const HONEST = new Set(Object.values(FILL_OUTCOMES));

export function honestFillOutcome(field = {}) {
    const legal = Boolean(field.legal || field.isLegal || field.is_legal);
    const filled = field.filled === true || String(field.finalState || "").toUpperCase() === "FILLED";
    if (legal && !filled) return FILL_OUTCOMES.LEGAL_BLOCK;

    const reported = String(field.fillOutcome || field.fill_outcome || "").toUpperCase();
    if (HONEST.has(reported)) return reported;

    const intended = String(field.intendedAction || field.intended_action || "").toUpperCase();
    const finalState = String(field.finalState || field.final_state || "").toUpperCase();
    if (finalState === "USER_EDITED") return FILL_OUTCOMES.USER_CORRECTED;
    if (intended === "FILL" && field.claimedFilled === true && field.filled === false) return FILL_OUTCOMES.SNAPSHOT_LIE;
    if (intended === "FILL" && !filled && finalState !== "FILLED") return FILL_OUTCOMES.FILL_FAILED;
    if (!intended && (finalState === "UNCHANGED" || finalState === "DETECTED" || !finalState)) return FILL_OUTCOMES.NOT_ATTEMPTED;
    if (finalState === "USER_EDITED") return FILL_OUTCOMES.USER_CORRECTED;
    if (HONEST.has(finalState)) return finalState;
    return FILL_OUTCOMES.DETECTED;
}

export function legacyFinalState(outcome, field = {}) {
    const value = String(outcome || "").toUpperCase();
    if (value === FILL_OUTCOMES.LEGAL_BLOCK) return "BLOCKED";
    if (value === FILL_OUTCOMES.FILL_FAILED) return LEGACY_FIELD_STATES.includes(String(field.finalState || "").toUpperCase())
        ? String(field.finalState).toUpperCase()
        : "UNCHANGED";
    if (value === FILL_OUTCOMES.SNAPSHOT_LIE) return "INVALID";
    if (value === FILL_OUTCOMES.USER_CORRECTED) return "USER_EDITED";
    if (value === FILL_OUTCOMES.NOT_ATTEMPTED) return "UNCHANGED";
    if (value === FILL_OUTCOMES.FILL_ATTEMPTED) return "UNCHANGED";
    const reported = String(field.finalState || "").toUpperCase();
    if (LEGACY_FIELD_STATES.includes(reported)) return reported;
    if (LEGACY_FIELD_STATES.includes(value)) return value;
    return "DETECTED";
}

export function mappingOutcomeFromFill(outcome) {
    const value = String(outcome || "").toUpperCase();
    // A user correction is a neutral observation. It may mean the candidate
    // answer, representation, semantic mapping, or browser strategy changed;
    // only the checkpoint classifier can attribute it safely.
    if (value === "FILLED") return "success";
    if (["FILL_FAILED", "SNAPSHOT_LIE", "BLOCKED", "INVALID"].includes(value)) return "failure";
    return null;
}
