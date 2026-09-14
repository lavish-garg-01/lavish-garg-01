function normalized(value, kind = "text") {
    const text = String(value ?? "").trim();
    if (kind === "email") return text.toLowerCase();
    if (kind === "phone") {
        const digits = text.replace(/\D/g, "");
        return digits.length > 10 ? digits.slice(-10) : digits;
    }
    if (kind === "url") return text.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (kind === "number") return text === "" ? "" : String(Number(text));
    return text.toLowerCase().replace(/\s+/g, " ");
}

export function reconcileResumeProfile(profile = {}, resume = {}) {
    const activeRole = Array.isArray(resume.experience)
        ? resume.experience.find((role) => /present|current/i.test(String(role.endDate || ""))) || resume.experience[0]
        : null;
    const checks = [
        ["FULL_NAME", "Full name", profile.name, resume.fullName, "text"],
        ["EMAIL", "Email", profile.email, resume.email, "email"],
        ["PHONE", "Phone", profile.phone, resume.phone, "phone"],
        ["CURRENT_LOCATION", "Current location", profile.currentLocation, resume.location, "text"],
        ["LINKEDIN_URL", "LinkedIn", profile.linkedinUrl, resume.linkedin, "url"],
        ["PORTFOLIO_URL", "Portfolio", profile.portfolioUrl, resume.portfolio, "url"],
        ["CURRENT_COMPANY", "Current company", profile.currentCompany, activeRole?.company, "text"],
        ["NOTICE_PERIOD", "Notice period", profile.noticePeriodDays, resume.noticePeriodDays, "number"]
    ];
    const conflicts = [];
    const missingFromProfile = [];
    const missingFromResume = [];
    for (const [semanticKey, label, profileValue, resumeValue, kind] of checks) {
        const left = normalized(profileValue, kind);
        const right = normalized(resumeValue, kind);
        if (!left && !right) continue;
        if (!left) {
            missingFromProfile.push({ semanticKey, label, resumeValue, decisionRequired: true });
        } else if (!right) {
            missingFromResume.push({ semanticKey, label, profileValue, decisionRequired: false });
        } else if (left !== right) {
            conflicts.push({ semanticKey, label, profileValue, resumeValue, decisionRequired: true });
        }
    }
    return Object.freeze({
        status: conflicts.length || missingFromProfile.length ? "REVIEW_REQUIRED" : "ALIGNED",
        conflicts,
        missingFromProfile,
        missingFromResume,
        summary: {
            reviewed: checks.length,
            conflicts: conflicts.length,
            missingFromProfile: missingFromProfile.length,
            missingFromResume: missingFromResume.length
        },
        autoUpdated: false
    });
}
