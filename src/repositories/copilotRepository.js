import crypto from "crypto";
import { getDb } from "../database/connection.js";
import { loadResume } from "../services/resumeStore.js";
import { syncCandidateFacts } from "./candidateFactRepository.js";
import { normalizeCareerProfiles } from "../services/roleTaxonomy.js";
import {
    extractCandidateSearchPatch,
    getCandidateSearchProfile,
    saveCandidateSearchProfile,
    toCandidateProfileSearchFields
} from "./candidateSearchProfileRepository.js";

export const LOCAL_USER_ID = "local-user";

export function normalizeProfilePhone(value = "") {
    const text = String(value || "").trim();
    if (!text) return "";
    const digits = text.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";
    return `${text.startsWith("+") ? "+" : ""}${digits}`;
}

function normalizeProfileEmail(value = "") {
    const text = String(value || "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) ? text : "";
}

function normalizeProfileUrl(value = "", expectedHost = null) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
        if (!/^https?:$/.test(url.protocol)) return "";
        if (!url.hostname.includes(".") && url.hostname !== "localhost") return "";
        if (expectedHost && !url.hostname.toLowerCase().endsWith(expectedHost)) return "";
        return url.href.replace(/\/$/, "");
    } catch { return ""; }
}

function parseJson(value, fallback = []) {
    try {
        return JSON.parse(value ?? "") ?? fallback;
    } catch {
        return fallback;
    }
}

function profileRow(row) {
    if (!row) return null;
    return {
        userId: row.user_id,
        name: row.name,
        email: row.email,
        phone: normalizeProfilePhone(row.phone),
        preferredFirstName: row.preferred_first_name || "",
        preferredLastName: row.preferred_last_name || "",
        legalFirstName: row.legal_first_name || "",
        legalMiddleName: row.legal_middle_name || "",
        legalLastName: row.legal_last_name || "",
        country: row.country || "",
        aiProcessingConsent: Boolean(row.ai_processing_consent),
        reusableAnswerConsent: Boolean(row.reusable_answer_consent),
        reusableAnswerConsentedAt: row.reusable_answer_consented_at || null,
        currentLocation: row.current_location || "",
        addressLine1: row.address_line1 || "",
        addressLine2: row.address_line2 || "",
        addressCity: row.address_city || "",
        addressState: row.address_state || "",
        postalCode: row.postal_code || "",
        linkedinUrl: row.linkedin_url || "",
        githubUrl: row.github_url || "",
        portfolioUrl: row.portfolio_url || "",
        currentCompany: row.current_company || "",
        currentTitle: row.current_title || "",
        currentIndustry: row.current_industry || "",
        preferredLocations: parseJson(row.preferred_locations),
        currentCTC: row.current_ctc,
        expectedCTC: row.expected_ctc,
        noticePeriodDays: row.notice_period_days,
        lastWorkingDate: row.last_working_date || "",
        totalExperienceYears: row.total_experience_years,
        skills: parseJson(row.skills),
        preferredSkills: parseJson(row.preferred_skills),
        excludedSkills: parseJson(row.excluded_skills),
        targetRoles: parseJson(row.target_roles),
        careerProfiles: normalizeCareerProfiles(parseJson(row.career_profiles)),
        preferredWorkModes: parseJson(row.preferred_work_modes),
        minimumSalary: row.minimum_salary,
        willingToRelocate: Boolean(row.willing_to_relocate),
        workAuthorization: row.work_authorization || "",
        sponsorshipRequired: row.sponsorship_required || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export function getCandidateProfile() {
    const db = getDb();
    let row = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(LOCAL_USER_ID);
    const resume = loadResume();
    if (!row) {
        db.prepare(`
            INSERT INTO candidate_profiles (
                user_id, name, email, phone, current_location, preferred_locations,
                notice_period_days, skills, target_roles, preferred_work_modes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            LOCAL_USER_ID,
            resume.fullName || "Local User",
            resume.email || "local@example.com",
            resume.phone || "",
            resume.location || "",
            JSON.stringify([]),
            Number(resume.noticePeriodDays || 0),
            JSON.stringify(resume.skills || []),
            JSON.stringify([]),
            JSON.stringify([])
        );
        row = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(LOCAL_USER_ID);
    }
    const storedPhone = normalizeProfilePhone(row.phone);
    const canonicalPhone = normalizeProfilePhone(resume.phone);
    if (!storedPhone && canonicalPhone) {
        db.prepare("UPDATE candidate_profiles SET phone = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
            .run(canonicalPhone, LOCAL_USER_ID);
        row = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(LOCAL_USER_ID);
    }
    const activeRole = Array.isArray(resume.experience)
        ? resume.experience.find((role) => /present|current/i.test(String(role.endDate || ""))) || resume.experience[0]
        : null;
    const resumeSkills = Array.isArray(resume.skills) ? resume.skills.filter(Boolean) : [];
    const resumeExperienceYears = (() => {
        const explicit = Number(resume.totalExperienceYears);
        return Number.isFinite(explicit) && explicit > 0 ? explicit : null;
    })();
    const needsResumeBackfill = (!row.name && resume.fullName)
        || (!row.email && resume.email)
        || (!row.phone && resume.phone)
        || (!row.current_location && resume.location)
        || (!row.country && resume.country)
        || (!row.linkedin_url && resume.linkedin)
        || (!row.github_url && resume.github)
        || (!row.portfolio_url && resume.portfolio)
        || (!row.current_company && activeRole?.company)
        || (!parseJson(row.skills).length && resumeSkills.length)
        || (row.total_experience_years == null && resumeExperienceYears != null);
    if (needsResumeBackfill) {
        db.prepare(`UPDATE candidate_profiles SET
            name = COALESCE(NULLIF(name, ''), ?),
            email = COALESCE(NULLIF(email, ''), ?),
            phone = COALESCE(NULLIF(phone, ''), ?),
            current_location = COALESCE(NULLIF(current_location, ''), ?),
            country = COALESCE(NULLIF(country, ''), ?),
            linkedin_url = COALESCE(NULLIF(linkedin_url, ''), ?),
            github_url = COALESCE(NULLIF(github_url, ''), ?),
            portfolio_url = COALESCE(NULLIF(portfolio_url, ''), ?),
            current_company = COALESCE(NULLIF(current_company, ''), ?),
            skills = CASE WHEN skills IS NULL OR skills = '' OR skills = '[]' THEN ? ELSE skills END,
            total_experience_years = COALESCE(total_experience_years, ?),
            updated_at = CURRENT_TIMESTAMP WHERE user_id = ?
        `).run(
            resume.fullName || "", resume.email || "", resume.phone || "", resume.location || "", resume.country || "",
            resume.linkedin || "", resume.github || "", resume.portfolio || "", activeRole?.company || "",
            JSON.stringify(resumeSkills), resumeExperienceYears, LOCAL_USER_ID
        );
        row = db.prepare("SELECT * FROM candidate_profiles WHERE user_id = ?").get(LOCAL_USER_ID);
    }
    return {
        ...profileRow(row),
        ...toCandidateProfileSearchFields(getCandidateSearchProfile(LOCAL_USER_ID, { db }))
    };
}

export function saveCandidateProfile(profile = {}) {
    const current = getCandidateProfile();
    const numberOrNull = (value) => value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    const requestedEmail = String(profile.email ?? current.email).trim();
    const requestedPhone = String(profile.phone ?? current.phone).trim();
    const requestedLinkedin = String(profile.linkedinUrl ?? current.linkedinUrl).trim();
    const requestedGithub = String(profile.githubUrl ?? current.githubUrl).trim();
    const requestedPortfolio = String(profile.portfolioUrl ?? current.portfolioUrl).trim();
    const email = normalizeProfileEmail(requestedEmail);
    const phone = normalizeProfilePhone(requestedPhone);
    const linkedinUrl = normalizeProfileUrl(requestedLinkedin, "linkedin.com");
    const githubUrl = normalizeProfileUrl(requestedGithub, "github.com");
    const portfolioUrl = normalizeProfileUrl(requestedPortfolio);
    if (requestedEmail && !email) throw new Error("Enter a valid email address.");
    if (requestedPhone && !phone) throw new Error("Enter a valid phone number with 7–15 digits.");
    if (requestedLinkedin && !linkedinUrl) throw new Error("Enter a valid LinkedIn URL.");
    if (requestedGithub && !githubUrl) throw new Error("Enter a valid GitHub URL.");
    if (requestedPortfolio && !portfolioUrl) throw new Error("Enter a valid portfolio URL.");
    const postalCode = String(profile.postalCode ?? current.postalCode).trim();
    const country = String(profile.country ?? current.country).trim();
    if (postalCode && /^(?:india|in)$/i.test(country) && !/^\d{6}$/.test(postalCode)) {
        throw new Error("Enter a valid 6-digit Indian PIN code.");
    }
    const next = {
        name: String(profile.name ?? current.name).trim(),
        email,
        phone,
        preferredFirstName: String(profile.preferredFirstName ?? current.preferredFirstName).trim(),
        preferredLastName: String(profile.preferredLastName ?? current.preferredLastName).trim(),
        legalFirstName: String(profile.legalFirstName ?? current.legalFirstName).trim(),
        legalMiddleName: String(profile.legalMiddleName ?? current.legalMiddleName).trim(),
        legalLastName: String(profile.legalLastName ?? current.legalLastName).trim(),
        country,
        aiProcessingConsent: profile.aiProcessingConsent === undefined ? current.aiProcessingConsent : Boolean(profile.aiProcessingConsent),
        reusableAnswerConsent: profile.reusableAnswerConsent === undefined ? current.reusableAnswerConsent : Boolean(profile.reusableAnswerConsent),
        currentLocation: String(profile.currentLocation ?? current.currentLocation).trim(),
        addressLine1: String(profile.addressLine1 ?? current.addressLine1).trim(),
        addressLine2: String(profile.addressLine2 ?? current.addressLine2).trim(),
        addressCity: String(profile.addressCity ?? current.addressCity).trim(),
        addressState: String(profile.addressState ?? current.addressState).trim(),
        postalCode,
        linkedinUrl,
        githubUrl,
        portfolioUrl,
        currentCompany: String(profile.currentCompany ?? current.currentCompany).trim(),
        currentTitle: String(profile.currentTitle ?? current.currentTitle).trim(),
        currentIndustry: String(profile.currentIndustry ?? current.currentIndustry).trim(),
        preferredLocations: profile.preferredLocations ?? current.preferredLocations,
        currentCTC: numberOrNull(profile.currentCTC ?? current.currentCTC),
        expectedCTC: numberOrNull(profile.expectedCTC ?? current.expectedCTC),
        noticePeriodDays: numberOrNull(profile.noticePeriodDays ?? current.noticePeriodDays) || 0,
        lastWorkingDate: String(profile.lastWorkingDate ?? current.lastWorkingDate).trim(),
        totalExperienceYears: numberOrNull(profile.totalExperienceYears ?? current.totalExperienceYears),
        skills: profile.skills ?? current.skills,
        preferredSkills: profile.preferredSkills ?? current.preferredSkills,
        excludedSkills: profile.excludedSkills ?? current.excludedSkills,
        targetRoles: profile.targetRoles ?? current.targetRoles,
        careerProfiles: (profile.careerProfiles ?? current.careerProfiles)?.length
            ? normalizeCareerProfiles(profile.careerProfiles ?? current.careerProfiles) : [],
        preferredWorkModes: profile.preferredWorkModes ?? current.preferredWorkModes,
        minimumSalary: numberOrNull(profile.minimumSalary ?? current.minimumSalary),
        willingToRelocate: profile.willingToRelocate === undefined
            ? current.willingToRelocate
            : Boolean(profile.willingToRelocate),
        workAuthorization: String(profile.workAuthorization ?? current.workAuthorization).trim(),
        sponsorshipRequired: String(profile.sponsorshipRequired ?? current.sponsorshipRequired).trim()
    };
    if (!next.name || !next.email) throw new Error("Name and email are required.");
    getDb().prepare(`
        UPDATE candidate_profiles SET
            name = @name, email = @email, phone = @phone,
            preferred_first_name = @preferredFirstName, preferred_last_name = @preferredLastName,
            legal_first_name = @legalFirstName, legal_middle_name = @legalMiddleName, legal_last_name = @legalLastName,
            country = @country,
            ai_processing_consent = @aiProcessingConsent,
            ai_processing_consented_at = CASE WHEN @aiProcessingConsent = 1 THEN COALESCE(ai_processing_consented_at, CURRENT_TIMESTAMP) ELSE NULL END,
            reusable_answer_consent = @reusableAnswerConsent,
            reusable_answer_consented_at = CASE WHEN @reusableAnswerConsent = 1 THEN COALESCE(reusable_answer_consented_at, CURRENT_TIMESTAMP) ELSE NULL END,
            current_location = @currentLocation, postal_code = @postalCode,
            address_line1 = @addressLine1, address_line2 = @addressLine2,
            address_city = @addressCity, address_state = @addressState,
            linkedin_url = @linkedinUrl, github_url = @githubUrl, portfolio_url = @portfolioUrl,
            current_company = @currentCompany, current_title = @currentTitle, current_industry = @currentIndustry,
            preferred_locations = @preferredLocations,
            current_ctc = @currentCTC, expected_ctc = @expectedCTC,
            notice_period_days = @noticePeriodDays, last_working_date = @lastWorkingDate,
            total_experience_years = @totalExperienceYears, skills = @skills,
            preferred_skills = @preferredSkills, excluded_skills = @excludedSkills,
            target_roles = @targetRoles, career_profiles = @careerProfiles,
            preferred_work_modes = @preferredWorkModes,
            minimum_salary = @minimumSalary, willing_to_relocate = @willingToRelocate,
            work_authorization = @workAuthorization, sponsorship_required = @sponsorshipRequired,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = @userId
    `).run({
        ...next,
        userId: LOCAL_USER_ID,
        preferredLocations: JSON.stringify(next.preferredLocations || []),
        skills: JSON.stringify(next.skills || []),
        preferredSkills: JSON.stringify(next.preferredSkills || []),
        excludedSkills: JSON.stringify(next.excludedSkills || []),
        targetRoles: JSON.stringify(next.targetRoles || []),
        careerProfiles: JSON.stringify(next.careerProfiles || []),
        preferredWorkModes: JSON.stringify(next.preferredWorkModes || []),
        willingToRelocate: next.willingToRelocate ? 1 : 0,
        aiProcessingConsent: next.aiProcessingConsent ? 1 : 0,
        reusableAnswerConsent: next.reusableAnswerConsent ? 1 : 0
    });
    const searchPatch = extractCandidateSearchPatch(profile);
    if (Object.keys(searchPatch).length) {
        saveCandidateSearchProfile(searchPatch, LOCAL_USER_ID, { source: "CANDIDATE_PROFILE" });
    }
    const saved = getCandidateProfile();
    syncCandidateFacts(current, saved);
    return saved;
}

export function listCandidateAnswers() {
    return getDb().prepare(`
        SELECT id, question_key AS questionKey, original_question AS originalQuestion,
               answer, confidence, source, evidence, created_at AS createdAt, updated_at AS updatedAt
        FROM candidate_answers WHERE user_id = ? ORDER BY updated_at DESC
    `).all(LOCAL_USER_ID);
}

export function findCandidateAnswer(questionKey) {
    return getDb().prepare("SELECT * FROM candidate_answers WHERE user_id = ? AND question_key = ?")
        .get(LOCAL_USER_ID, questionKey);
}

export function saveCandidateAnswer({ id, questionKey, originalQuestion, answer, confidence = 1, source = "USER", evidence = "" }) {
    if (!String(questionKey || "").trim()) throw new Error("Question key is required.");
    if (!String(answer ?? "").trim()) throw new Error("Answer is required.");
    const answerId = id || crypto.randomUUID();
    getDb().prepare(`
        INSERT INTO candidate_answers (id, user_id, question_key, original_question, answer, confidence, source, evidence)
        VALUES (@id, @userId, @questionKey, @originalQuestion, @answer, @confidence, @source, @evidence)
        ON CONFLICT(user_id, question_key) DO UPDATE SET
            original_question = excluded.original_question,
            answer = excluded.answer,
            confidence = excluded.confidence,
            source = excluded.source,
            evidence = excluded.evidence,
            updated_at = CURRENT_TIMESTAMP
    `).run({
        id: answerId,
        userId: LOCAL_USER_ID,
        questionKey,
        originalQuestion,
        answer: String(answer).trim(),
        confidence,
        source,
        evidence: String(evidence || "").trim()
    });
    return findCandidateAnswer(questionKey);
}

export function deleteCandidateAnswer(id) {
    return getDb().prepare("DELETE FROM candidate_answers WHERE id = ? AND user_id = ?").run(id, LOCAL_USER_ID).changes;
}

export function getAutoApplySettings() {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO auto_apply_settings (user_id) VALUES (?)").run(LOCAL_USER_ID);
    const row = db.prepare("SELECT * FROM auto_apply_settings WHERE user_id = ?").get(LOCAL_USER_ID);
    const search = getCandidateSearchProfile(LOCAL_USER_ID, { db });
    return {
        userId: row.user_id,
        enabled: Boolean(row.enabled),
        mode: row.mode,
        minimumMatchScore: row.minimum_match_score,
        maxApplicationsPerDay: row.max_applications_per_day,
        maxApplicationsPerWeek: row.max_applications_per_week,
        targetRoles: search.targetRoles,
        preferredLocations: search.preferredLocations,
        excludedCompanies: search.excludedCompanies,
        minimumSalary: search.minimumSalary,
        searchProfileVersion: search.profileVersion
    };
}

export function saveAutoApplySettings(settings = {}) {
    const current = getAutoApplySettings();
    const mode = "REVIEW_ONLY";
    getDb().prepare(`
        UPDATE auto_apply_settings SET
            enabled = @enabled, mode = @mode, minimum_match_score = @minimumMatchScore,
            max_applications_per_day = @maxApplicationsPerDay,
            max_applications_per_week = @maxApplicationsPerWeek,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = @userId
    `).run({
        userId: LOCAL_USER_ID,
        enabled: settings.enabled === undefined ? Number(current.enabled) : Number(Boolean(settings.enabled)),
        mode,
        minimumMatchScore: Number(settings.minimumMatchScore ?? current.minimumMatchScore),
        maxApplicationsPerDay: Number(settings.maxApplicationsPerDay ?? current.maxApplicationsPerDay),
        maxApplicationsPerWeek: Number(settings.maxApplicationsPerWeek ?? current.maxApplicationsPerWeek)
    });
    const searchPatch = extractCandidateSearchPatch(settings);
    if (Object.keys(searchPatch).length) {
        saveCandidateSearchProfile(searchPatch, LOCAL_USER_ID, { source: "AUTO_APPLY_SETTINGS" });
    }
    return getAutoApplySettings();
}

export function jsonList(value) {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}
