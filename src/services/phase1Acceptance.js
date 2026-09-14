import { getDb } from "../database/connection.js";
import { reliabilityReport } from "./reliabilityReport.js";

export function phase1AcceptanceReport(options = {}) {
    const db = getDb();
    const report = reliabilityReport(options);
    // Safety is deliberately all-history. A new build baseline must never hide
    // a sensitive-value leak, duplicate submission, or unproven success.
    const evidence = db.prepare(`SELECT
        SUM(CASE WHEN is_sensitive = 1 AND application_value IS NOT NULL AND trim(application_value) != '' THEN 1 ELSE 0 END) AS sensitiveLeaks,
        SUM(CASE WHEN is_legal = 1 AND application_value IS NOT NULL AND trim(application_value) != '' THEN 1 ELSE 0 END) AS legalLeaks
        FROM application_field_evidence`).get();
    const realSuccessWithoutProof = db.prepare(`SELECT COUNT(*) AS count FROM applications a
        WHERE a.status = 'SUCCESS' AND a.adapter IN ('EXTENSION','REAL_WEB')
          AND NOT EXISTS (SELECT 1 FROM application_attempts aa WHERE aa.application_id = a.id
            AND aa.status IN ('SUCCESS','COMPLETED')
            AND aa.confirmation_source IN ('EMPLOYER_CONFIRMATION_PAGE','CANDIDATE_VERIFIED'))`).get().count;
    const duplicateVerified = db.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT job_id FROM applications WHERE status = 'SUCCESS' GROUP BY user_id, job_id HAVING COUNT(*) > 1
    )`).get().count;
    const safety = {
        sensitiveValuesStored: Number(evidence.sensitiveLeaks || 0),
        legalValuesStored: Number(evidence.legalLeaks || 0),
        duplicateVerifiedApplications: Number(duplicateVerified || 0),
        realSuccessWithoutProof: Number(realSuccessWithoutProof || 0)
    };
    const safetyPassed = Object.values(safety).every((value) => value === 0);
    const gates = {
        knownFieldMappingTarget: 97,
        fieldVerificationTarget: 97,
        resumeUploadTarget: 95,
        multiStepRecoveryTarget: 95,
        minimumRealAcceptanceRuns: 8,
        enoughRealAcceptanceRuns: report.applications.total >= 8,
        phase1SafetyPassed: safetyPassed
    };
    gates.releaseReady = safetyPassed
        && gates.enoughRealAcceptanceRuns
        && report.mappings.successRate != null && report.mappings.successRate >= gates.knownFieldMappingTarget
        && report.verification.successRate != null && report.verification.successRate >= gates.fieldVerificationTarget
        && report.uploads.successRate != null && report.uploads.successRate >= gates.resumeUploadTarget
        && report.sessions.recoveryRate != null && report.sessions.recoveryRate >= gates.multiStepRecoveryTarget;
    return {
        generatedAt: new Date().toISOString(),
        scope: report.scope,
        safety: { ...safety, passed: safetyPassed },
        reliability: {
            mappingOutcomeRate: report.mappings.successRate,
            mappingOutcomeSamples: report.mappings.succeeded + report.mappings.failed,
            fieldVerificationRate: report.verification.successRate,
            fieldSamples: report.verification.attempted,
            notAttemptedFields: report.autofill.notAttempted,
            resumeUploadRate: report.uploads.successRate,
            resumeUploadSamples: report.uploads.receipts,
            resumeUploadsNotAttempted: report.uploads.notAttempted,
            multiStepRecoveryRate: report.sessions.recoveryRate,
            multiStepSamples: report.sessions.multiPageSessions,
            applications: report.applications
        },
        gates
    };
}

