import { getDb, getSetting } from "../database/connection.js";
import { getCandidateProfile, LOCAL_USER_ID } from "../repositories/copilotRepository.js";
import { loadResume, resumeToText } from "./resumeStore.js";
import { buildCandidateResumeProfile, parsedResumeProfile } from "./candidateProfileBuilder.js";
import { applicationReadinessSummary } from "./applicationSchemaRegistry.js";
import { getCandidateSearchProfile } from "../repositories/candidateSearchProfileRepository.js";

const LEGACY_SETTING_KEY = "onboarding.local-user";

function parseJson(value, fallback = {}) {
    try { return JSON.parse(value || "") || fallback; } catch { return fallback; }
}

function storedRow(userId = LOCAL_USER_ID) {
    const db = getDb();
    let row = db.prepare("SELECT * FROM onboarding_states WHERE user_id = ?").get(userId);
    if (!row) {
        const legacy = parseJson(getSetting(LEGACY_SETTING_KEY, "{}"));
        db.prepare(`INSERT INTO onboarding_states (user_id, status, last_step, state_json)
            VALUES (?, 'NOT_STARTED', 'intent', ?)`).run(userId, JSON.stringify(legacy));
        row = db.prepare("SELECT * FROM onboarding_states WHERE user_id = ?").get(userId);
    }
    return row;
}

function storedState(userId = LOCAL_USER_ID) {
    const row = storedRow(userId);
    return {
        ...parseJson(row.state_json),
        status: row.status,
        lastStep: row.last_step,
        completedAt: row.completed_at || null
    };
}

export function updateOnboardingState(patch = {}, userId = LOCAL_USER_ID) {
    const current = storedState(userId);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const status = String(patch.status || current.status || "NOT_STARTED").toUpperCase();
    const lastStep = String(patch.lastStep || current.lastStep || "intent").slice(0, 80);
    const persisted = { ...next };
    delete persisted.status;
    delete persisted.lastStep;
    delete persisted.completedAt;
    getDb().prepare(`INSERT INTO onboarding_states (user_id, status, last_step, state_json, completed_at)
        VALUES (?, ?, ?, ?, CASE WHEN ? = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END)
        ON CONFLICT(user_id) DO UPDATE SET
            status = excluded.status, last_step = excluded.last_step, state_json = excluded.state_json,
            completed_at = CASE WHEN excluded.status = 'ACTIVE' THEN COALESCE(onboarding_states.completed_at, CURRENT_TIMESTAMP)
                ELSE onboarding_states.completed_at END,
            updated_at = CURRENT_TIMESTAMP`).run(userId, status, lastStep, JSON.stringify(persisted), status);
    return onboardingState(userId);
}

function present(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

function candidateProfileReadiness(profile = {}) {
    const required = [
        ["Full name", present(profile.name)],
        ["Email", present(profile.email)],
        ["Phone", present(profile.phone)],
        ["Current location", present(profile.currentLocation)],
        ["Country", present(profile.country)],
        ["Experience", present(profile.totalExperienceYears)],
        ["Core skills", Array.isArray(profile.skills) && profile.skills.length > 0]
    ];
    const recommended = [
        ["Current company", present(profile.currentCompany)],
        ["LinkedIn URL", present(profile.linkedinUrl)],
        ["Postal / PIN code", present(profile.postalCode)]
    ];
    return {
        missingRequired: required.filter(([, ready]) => !ready).map(([label]) => label),
        missingRecommended: recommended.filter(([, ready]) => !ready).map(([label]) => label)
    };
}

export function onboardingState(userId = LOCAL_USER_ID) {
    const db = getDb();
    const stored = storedState(userId);
    const profile = getCandidateProfile();
    const searchProfile = getCandidateSearchProfile(userId, { db });
    const resume = loadResume();
    const latestResumeVersion = db.prepare(`SELECT id, parsed_profile_json, parser_version,
        parse_confidence, candidate_confirmed, file_path, created_at FROM resume_versions
        WHERE user_id = ? AND type = 'MASTER' ORDER BY created_at DESC LIMIT 1`).get(userId);
    const importedProfile = parsedResumeProfile(latestResumeVersion);
    const resumeProfile = importedProfile || buildCandidateResumeProfile({ text: resumeToText(resume), existingResume: resume });
    resumeProfile.resumeVersionId = latestResumeVersion?.id || null;
    resumeProfile.candidateConfirmed = Boolean(latestResumeVersion?.candidate_confirmed);
    // Older clients could leave both flags true by confirming an existing
    // resume after choosing the manual path. Confirmation is the later,
    // stronger signal and repairs that contradictory state without data loss.
    const confirmedResumeSelected = Boolean(latestResumeVersion?.candidate_confirmed && stored.resumeProfileReviewed);
    const resumeSkipped = Boolean(stored.resumeSkipped && !confirmedResumeSelected);
    const hasManualFoundation = Boolean(stored.manualProfileReviewed
        && present(profile.name) && present(profile.email)
        && (Number(profile.totalExperienceYears) > 0 || profile.skills?.length));

    const steps = [
        {
            id: "intent", label: "Choose your next move", href: "#intent",
            description: "Tell Copilot which roles you want now—not every role your resume could match.",
            complete: Boolean(stored.intentReviewed && searchProfile.targetRoles.length)
        },
        {
            id: "resume", label: "Add career evidence", href: "#resume",
            description: "Upload a master resume, or enter the minimum career profile manually.",
            complete: Boolean(latestResumeVersion || resumeSkipped)
        },
        {
            id: "verify", label: "Verify what we found", href: "#verify",
            description: "Only candidate-confirmed facts may become trusted autofill knowledge.",
            complete: resumeSkipped ? hasManualFoundation : Boolean(latestResumeVersion?.candidate_confirmed)
        },
        {
            id: "search", label: "Set search essentials", href: "#search",
            description: "Locations, work mode, employment type and optional deal-breakers.",
            complete: Boolean(stored.searchReviewed && searchProfile.preferredLocations.length && searchProfile.preferredWorkModes.length)
        }
    ];
    const completed = steps.filter((step) => step.complete).length;
    const searchSignals = {
        intent: Boolean(searchProfile.targetRoles.length),
        location: Boolean(searchProfile.preferredLocations.length),
        workMode: Boolean(searchProfile.preferredWorkModes.length),
        careerEvidence: resumeSkipped
            ? hasManualFoundation
            : Boolean(latestResumeVersion?.candidate_confirmed)
    };
    const searchReadinessPercent = Math.round(Object.values(searchSignals).filter(Boolean).length * 25);
    const searchReady = Object.values(searchSignals).every(Boolean);
    const availableMatches = db.prepare(`SELECT COUNT(*) AS count FROM jobs
        WHERE status IN ('MATCHED', 'CLOSE', 'APPROVED') AND match_score >= 0`).get().count;
    const extensionApplications = db.prepare("SELECT COUNT(*) AS count FROM applications WHERE user_id = ? AND adapter = 'EXTENSION'").get(userId).count;
    const applicationCount = db.prepare("SELECT COUNT(*) AS count FROM applications WHERE user_id = ?").get(userId).count;
    // Search readiness means activation is allowed; only the explicit complete
    // action should move the user into the active workspace.
    const stateComplete = stored.status === "ACTIVE";
    return {
        userId,
        status: stored.status,
        lastStep: stored.lastStep,
        profile,
        searchProfile,
        resumeProfile,
        resume: latestResumeVersion ? {
            id: latestResumeVersion.id,
            candidateConfirmed: Boolean(latestResumeVersion.candidate_confirmed),
            parseConfidence: Number(latestResumeVersion.parse_confidence || 0),
            createdAt: latestResumeVersion.created_at
        } : null,
        steps,
        completed,
        total: steps.length,
        percent: Math.round((completed / steps.length) * 100),
        complete: stateComplete,
        next: steps.find((step) => !step.complete) || null,
        searchReadiness: {
            ready: searchReady,
            percent: searchReadinessPercent,
            signals: searchSignals
        },
        profileReadiness: candidateProfileReadiness(profile),
        applicationReadiness: applicationReadinessSummary(userId),
        activation: {
            availableMatches,
            valueShown: Boolean(stored.valueShown),
            extensionConnected: Boolean(stored.extensionReady || extensionApplications),
            applicationStarted: Boolean(applicationCount)
        },
        stored
    };
}
