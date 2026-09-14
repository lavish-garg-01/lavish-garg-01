(() => {
    const HOT_KEYS = new Set([
        "FIRST_NAME", "LAST_NAME", "FULL_NAME", "PREFERRED_FIRST_NAME", "PREFERRED_LAST_NAME",
        "EMAIL", "PHONE", "LINKEDIN_URL", "PORTFOLIO_URL", "CURRENT_LOCATION", "TOTAL_EXPERIENCE"
    ]);
    // Suggestion widgets only accept a value they selected themselves, so these
    // keys stay on the plain-text path and leave comboboxes to the full resolver.
    const PLAIN_TEXT_ONLY_KEYS = new Set(["CURRENT_LOCATION", "TOTAL_EXPERIENCE"]);
    const TECHNOLOGY_EXPERIENCE = /node\.?js|\baws\b|kafka|\breact\b|angular|vue\b|python|golang|\bjava\b|kubernetes|docker|typescript|javascript|\bsql\b|mongo|postgres|redis|graphql|\.net|\bphp\b|ruby|rust|scala|spark|terraform/i;
    const PATTERNS = [
        [/^first\s*name$/i, "FIRST_NAME"],
        [/^given\s*name$/i, "FIRST_NAME"],
        [/^last\s*name$/i, "LAST_NAME"],
        [/^surname$/i, "LAST_NAME"],
        [/^family\s*name$/i, "LAST_NAME"],
        [/preferred\s+first\s+name/i, "PREFERRED_FIRST_NAME"],
        [/preferred\s+(?:last\s+name|surname)/i, "PREFERRED_LAST_NAME"],
        [/^(?:full\s*)?(?:candidate\s*)?name$/i, "FULL_NAME"],
        [/e-?mail(?:\s+address)?/i, "EMAIL"],
        [/phone|mobile|telephone/i, "PHONE"],
        [/linkedin(?:\s+(?:profile|url))?/i, "LINKEDIN_URL"],
        [/portfolio|personal\s+website/i, "PORTFOLIO_URL"],
        [/^location$/i, "CURRENT_LOCATION"],
        [/^city$/i, "CURRENT_LOCATION"],
        [/current\s+(?:location|city)|city\s+of\s+residence|where\s+are\s+you\s+based/i, "CURRENT_LOCATION"],
        [/^experience(?:\s*\(\s*(?:in\s+)?years?\s*\))?$/i, "TOTAL_EXPERIENCE"],
        [/how\s+many\s+years[^?]*experience|years?\s+of\s+experience|total\s+experience/i, "TOTAL_EXPERIENCE"]
    ];

    function genericLabel(value) {
        return /^(?:select|search|textbox|input|choose|drop or select(?:\s*\([^)]*\))?|field(?:[\s_-]*\d+)?)$/i.test(String(value || "").trim());
    }

    function inferKey(field = {}) {
        const label = String(field.label || field.name || "").replace(/[✱*]+/g, " ").replace(/\s+/g, " ").trim();
        if (!label || genericLabel(label)) return null;
        const match = PATTERNS.find((entry) => entry[0].test(label));
        if (!match) return null;
        if (match[1] === "TOTAL_EXPERIENCE" && TECHNOLOGY_EXPERIENCE.test(label)) return null;
        return match[1];
    }

    function profileValue(key, profile = {}) {
        const nameParts = String(profile.name || "").trim().split(/\s+/).filter(Boolean);
        const values = {
            FULL_NAME: profile.name,
            FIRST_NAME: profile.preferredFirstName || nameParts[0],
            LAST_NAME: profile.preferredLastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""),
            PREFERRED_FIRST_NAME: profile.preferredFirstName || nameParts[0],
            PREFERRED_LAST_NAME: profile.preferredLastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""),
            EMAIL: profile.email,
            PHONE: profile.phone,
            LINKEDIN_URL: profile.linkedinUrl || profile.linkedin,
            PORTFOLIO_URL: profile.portfolioUrl || profile.portfolio,
            CURRENT_LOCATION: profile.currentLocation,
            TOTAL_EXPERIENCE: profile.totalExperienceYears
        };
        const value = values[key];
        return value == null || String(value).trim() === "" ? null : String(value).trim();
    }

    function plan(fields = [], profile = {}) {
        const actions = [];
        const filledIds = [];
        for (const field of fields) {
            if (!field || field.legal || field.sensitive || field.type === "password" || field.type === "file") continue;
            if (["search", "checkbox", "checkbox-group", "choice-group", "radio"].includes(String(field.type || ""))) continue;
            if (String(field.value || "").trim()) continue;
            const key = inferKey(field);
            if (!HOT_KEYS.has(key)) continue;
            if (PLAIN_TEXT_ONLY_KEYS.has(key) && !["text", "number", "tel", "email", "textarea"].includes(String(field.type || ""))) continue;
            const value = profileValue(key, profile);
            if (!value) continue;
            actions.push({ fieldId: field.id, value, source: "PROFILE", semanticKey: key, action: "FILL" });
            filledIds.push(field.id);
        }
        return { actions, filledIds };
    }

    globalThis.JobHunterIdentity = { HOT_KEYS: [...HOT_KEYS], inferKey, profileValue, plan };
})();
