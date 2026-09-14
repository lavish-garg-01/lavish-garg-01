import crypto from "node:crypto";
import { z } from "zod";
import { canonicalContractJson, sha256Schema, stableContractHash } from "../contracts/contractPrimitives.js";
import { normalizedValueSchema } from "../contracts/normalizedValue.js";
import { fieldInteractionObservationSchema } from "../contracts/fieldInteractionObservation.js";
import { getDb } from "../database/connection.js";
import {
    CandidateAnswerConflictError,
    getActiveCandidateAnswerVersion,
    saveCandidateAnswerVersionInTransaction
} from "../repositories/candidateAnswerVersionRepository.js";
import {
    getCandidateAnswerChangeSet,
    listCandidateAnswerChangeSets
} from "../repositories/candidateAnswerChangeSetRepository.js";
import { getActiveAnswerPolicy } from "./answerPolicyRegistry.js";
import { normalizeAnswerContext } from "./answerContextNormalization.js";
import { scopeQualifiersForPolicy } from "./scopeRankPolicy.js";
import { fieldLearningClassificationSchema } from "./fieldLearningClassifier.js";
import {
    preferredOverrideScope,
    reviewOriginPromotable,
    scopedCandidateAnswerLearningPolicy
} from "./scopedCandidateAnswerLearning.js";

const contextValue = z.union([z.string().max(240), z.number().finite(), z.boolean(), z.null()]);
const boundedContext = z.record(z.string().max(80), contextValue)
    .refine((value) => Object.keys(value).length <= 16, "TOO_MANY_CONTEXT_DIMENSIONS");
const boundedScope = z.record(z.string().max(80), z.string().max(240))
    .refine((value) => Object.keys(value).length <= 8, "TOO_MANY_SCOPE_QUALIFIERS");

export const candidateAnswerLearningProposalSchema = z.object({
    observationId: z.string().min(1).max(160),
    fieldLogicalId: z.string().min(1).max(240),
    canonicalKey: z.string().min(1).max(140).transform((value) => value.trim().toUpperCase()),
    normalizedValue: normalizedValueSchema,
    finalValueHash: sha256Schema,
    context: boundedContext.default({}),
    scopeQualifiers: boundedScope.default({}),
    expectedActiveVersionId: z.string().min(1).max(160).nullable(),
    usedAnswerVersionId: z.string().min(1).max(160).nullable().default(null),
    reasonCodes: z.array(z.string().min(1).max(120)).max(12).default([])
}).strict();

export const candidateAnswerChangeSetCommitSchema = z.object({
    applicationId: z.string().min(1).max(160),
    runId: z.string().min(1).max(160),
    checkpointId: z.string().min(1).max(160),
    proposals: z.array(candidateAnswerLearningProposalSchema).min(1).max(50)
}).strict();

function cleanReasons(...groups) {
    return [...new Set(groups.flat().filter(Boolean).map((reason) => String(reason)
        .trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 120)).filter(Boolean))].slice(0, 16);
}

function candidateRenderedForms(value) {
    if (!value) return [];
    if (["STRING", "RICH_TEXT", "URL"].includes(value.kind)) return [String(value.value), String(value.value).trim()];
    if (value.kind === "INTEGER") return [String(value.value), `${value.value} day`, `${value.value} days`];
    if (value.kind === "DECIMAL") return [String(value.valueExact)];
    if (value.kind === "BOOLEAN") return value.value ? ["true", "True", "TRUE", "yes", "Yes", "YES", "1"]
        : ["false", "False", "FALSE", "no", "No", "NO", "0"];
    if (value.kind === "ENUM") return [value.value.key, value.value.label];
    if (value.kind === "DATE") return [value.value.isoDate];
    if (value.kind === "PHONE") {
        const compact = `${value.countryCode}${value.nationalNumber}`;
        return [compact, `${value.countryCode} ${value.nationalNumber}`, value.nationalNumber,
            `${value.nationalNumber.slice(0, 5)} ${value.nationalNumber.slice(5)}`,
            `${value.nationalNumber.slice(0, 5)}-${value.nationalNumber.slice(5)}`];
    }
    if (value.kind === "MONEY") {
        const amount = Number(value.amountExact);
        const forms = [String(value.amountExact), `${value.amountExact} ${value.currency}/${value.period.toLowerCase()}`];
        if (value.currency === "INR" && value.period === "YEAR" && Number.isFinite(amount) && amount % 100000 === 0) {
            const lpa = String(amount / 100000);
            forms.push(lpa, `${lpa} LPA`, `${lpa}L`, `₹${lpa}L`, `₹${lpa} LPA`);
        }
        return forms;
    }
    if (value.kind === "DURATION") return [String(value.months), String(value.months / 12), `${value.months} months`,
        `${value.months / 12} years`, `${value.months / 12} year`];
    if (value.kind === "MULTI_ENUM") {
        return [value.values.map((item) => item.key).join(","), value.values.map((item) => item.label).join(", ")];
    }
    return [];
}

function normalizedValueBoundToFinalInput(normalizedValue, finalValueHash) {
    return candidateRenderedForms(normalizedValue).some((rendered) =>
        crypto.createHash("sha256").update(String(rendered)).digest("hex") === finalValueHash);
}

function checkpointRow(db, applicationId, runId, checkpointId) {
    return db.prepare(`SELECT * FROM application_checkpoint_receipts
        WHERE checkpoint_id = ? AND application_id = ? AND attempt_id = ?`)
        .get(checkpointId, applicationId, runId);
}

function usedVersionObserved(db, proposal, applicationId, runId) {
    if (!proposal.usedAnswerVersionId) return false;
    const rows = db.prepare(`SELECT contract_json FROM field_revision_events
        WHERE application_id = ? AND attempt_id = ? ORDER BY sequence DESC, created_at DESC`)
        .all(applicationId, runId);
    return rows.some((row) => {
        try {
            const revision = JSON.parse(row.contract_json);
            return revision.answerVersionId === proposal.usedAnswerVersionId
                && revision.canonicalKey === proposal.canonicalKey;
        } catch { return false; }
    });
}

function verifiedCandidateClassification(db, proposal, applicationId, runId) {
    const row = db.prepare(`SELECT contract_json FROM field_interaction_observations
        WHERE observation_id = ? AND application_id = ? AND attempt_id = ?`)
        .get(proposal.observationId, applicationId, runId);
    if (!row) return { ok: false, reasonCode: "CANDIDATE_OBSERVATION_NOT_FOUND" };
    const observation = fieldInteractionObservationSchema.parse(JSON.parse(row.contract_json));
    if (observation.protected) return { ok: false, reasonCode: "PROTECTED_OBSERVATION_CANNOT_LEARN" };
    if (observation.logicalFieldId !== proposal.fieldLogicalId) return { ok: false, reasonCode: "LOGICAL_FIELD_ID_MISMATCH" };
    if (String(observation.semantic.canonicalKey || "").toUpperCase() !== proposal.canonicalKey) {
        return { ok: false, reasonCode: "OBSERVATION_CANONICAL_MISMATCH" };
    }
    if (observation.answer.finalValueHash !== proposal.finalValueHash) {
        return { ok: false, reasonCode: "FINAL_VALUE_HASH_MISMATCH" };
    }
    if (!normalizedValueBoundToFinalInput(proposal.normalizedValue, proposal.finalValueHash)) {
        return { ok: false, reasonCode: "NORMALIZED_VALUE_NOT_BOUND_TO_FINAL_INPUT" };
    }
    const classifications = db.prepare(`SELECT classification_json FROM field_learning_shadow_classifications
        WHERE observation_id = ? ORDER BY created_at DESC, rowid DESC`).all(proposal.observationId)
        .map((entry) => fieldLearningClassificationSchema.parse(JSON.parse(entry.classification_json)));
    const accepted = classifications.find((classification) => classification.acceptance.outcome === "VERIFIED"
        && classification.learningEligibility.candidateAnswer);
    if (!accepted) return { ok: false, reasonCode: "VERIFIED_CANDIDATE_ANSWER_CLASSIFICATION_REQUIRED" };
    const directCandidate = observation.answer.completedByUser
        && String(observation.answer.source || "").toUpperCase().includes("USER")
        && accepted.answer.outcome === "CORRECTED";
    const unchangedReuse = accepted.answer.outcome === "CONFIRMED_UNCHANGED"
        && observation.answer.intendedValueHash
        && observation.answer.intendedValueHash === observation.answer.finalValueHash
        && usedVersionObserved(db, proposal, applicationId, runId);
    if (!directCandidate && !unchangedReuse) {
        return { ok: false, reasonCode: "DIRECT_CANDIDATE_OR_PROVEN_REUSE_REQUIRED" };
    }
    return { ok: true, observation, classification: accepted, directCandidate, unchangedReuse };
}

function policyEligibility(policy, checkpointKind) {
    if (!policy) return { eligible: false, reasonCode: "ANSWER_POLICY_MISSING" };
    if (policy.learningMode === "NEVER" || ["APPLICATION_ACTION", "SUBMISSION_ACTION", "SECURITY_CHALLENGE"].includes(policy.answerKind)
        || policy.riskTier === "PROHIBITED") {
        return { eligible: false, reasonCode: "POLICY_FORBIDS_CANDIDATE_TRUTH" };
    }
    if (checkpointKind === "SUBMISSION") {
        if (policy.learningMode !== "AUTO_VERSION") return { eligible: false, reasonCode: "EXPLICIT_CONFIRMATION_REQUIRED" };
        if (policy.riskTier !== "LOW") return { eligible: false, reasonCode: "ONLY_LOW_RISK_AUTO_VERSION_ENABLED" };
    }
    return { eligible: true, reasonCode: checkpointKind === "SUBMISSION"
        ? "LOW_RISK_AUTO_VERSION_AT_VERIFIED_SUBMISSION" : "EXPLICIT_SAVE_AUTHORIZES_VERSION" };
}

function applicationLearningAuthority(db, userId, applicationId, checkpointKind) {
    const row = db.prepare(`SELECT a.user_id, a.reusable_answer_decision,
            COALESCE(p.reusable_answer_consent, 0) AS global_consent
        FROM applications a LEFT JOIN candidate_profiles p ON p.user_id = a.user_id
        WHERE a.id = ?`).get(applicationId);
    if (!row || row.user_id !== userId) return { allowed: false, reasonCode: "APPLICATION_CANDIDATE_MISMATCH" };
    if (row.reusable_answer_decision === "DECLINED") return { allowed: false, reasonCode: "APPLICATION_LEARNING_DISABLED" };
    if (checkpointKind === "SUBMISSION" && !Boolean(row.global_consent)) {
        return { allowed: false, reasonCode: "GLOBAL_REUSABLE_LEARNING_DISABLED" };
    }
    return { allowed: true, reasonCode: checkpointKind === "SUBMISSION"
        ? "GLOBAL_REUSABLE_LEARNING_ENABLED" : "EXPLICIT_SAVE_GESTURE" };
}

function planProposal(db, proposal, { userId, applicationId, runId, checkpointKind }) {
    const evidence = verifiedCandidateClassification(db, proposal, applicationId, runId);
    if (!evidence.ok) return { proposal, decision: "BLOCKED", reasonCodes: [evidence.reasonCode] };
    const policy = getActiveAnswerPolicy(proposal.canonicalKey);
    if (!policy) return { proposal, decision: "BLOCKED", reasonCodes: ["ANSWER_POLICY_MISSING"] };
    const normalizedContext = normalizeAnswerContext(proposal.context, { policy });
    if (!normalizedContext.ok) return { proposal, policy, decision: "REVIEW_REQUIRED", reasonCodes: ["REQUIRED_CONTEXT_UNKNOWN"] };
    const scopedPolicy = scopedCandidateAnswerLearningPolicy(proposal.canonicalKey);
    let requestedScope = proposal.scopeQualifiers;
    if (scopedPolicy && evidence.directCandidate) {
        const preferred = preferredOverrideScope(scopedPolicy, normalizedContext.context);
        if (!preferred.ok) return { proposal, policy, decision: "REVIEW_REQUIRED", reasonCodes: preferred.reasonCodes };
        requestedScope = preferred.qualifiers;
    }
    const scope = scopeQualifiersForPolicy(policy, requestedScope, normalizedContext.context, { forWrite: true });
    if (!scope.ok) return { proposal, policy, decision: "REVIEW_REQUIRED", reasonCodes: scope.reasonCodes };
    const active = getActiveCandidateAnswerVersion(userId, proposal.canonicalKey, scope.scopeHash);
    if ((active?.id || null) !== proposal.expectedActiveVersionId) throw new CandidateAnswerConflictError();
    const normalizedHash = stableContractHash(proposal.normalizedValue);

    if (evidence.unchangedReuse) {
        if (!scopedPolicy || active?.learningState !== "REVIEW" || proposal.usedAnswerVersionId !== active.id
            || active.normalizedHash !== normalizedHash || !reviewOriginPromotable(active.originKind)) {
            return { proposal, policy, scope, active, normalizedHash, decision: "REVIEW_REQUIRED",
                reasonCodes: ["REVIEW_PROMOTION_PROOF_INCOMPLETE"] };
        }
        return {
            proposal: { ...proposal, scopeQualifiers: scope.qualifiers }, policy, scope, active, normalizedHash,
            decision: "PROMOTE_TRUSTED", learningState: "TRUSTED", originKind: "USER_ACCEPTED_REUSE",
            presentationMode: "AUTO_QUIET",
            reasonCodes: cleanReasons("REVIEW_VALUE_SURVIVED_EXACT_CONTEXT_REUSE",
                evidence.classification.answer.reasonCodes, policy.reasonCode, proposal.reasonCodes)
        };
    }

    if (scopedPolicy && evidence.directCandidate) {
        if (active?.normalizedHash === normalizedHash) {
            return { proposal, policy, scope, active, normalizedHash, decision: "NO_CHANGE",
                reasonCodes: ["EQUIVALENT_ACTIVE_TRUTH_ALREADY_EXISTS"] };
        }
        const global = getActiveCandidateAnswerVersion(userId, proposal.canonicalKey, stableContractHash({}));
        const removesOverride = Boolean(active && Object.keys(scope.qualifiers).length && global?.normalizedHash === normalizedHash);
        return {
            proposal: { ...proposal, scopeQualifiers: scope.qualifiers }, policy, scope, active, global, normalizedHash,
            decision: removesOverride ? "REMOVE_OVERRIDE" : "CREATE_REVIEW",
            learningState: removesOverride ? "REMOVED" : "REVIEW",
            originKind: checkpointKind === "EXPLICIT_SAVE" ? "USER_EXPLICIT_SAVE"
                : evidence.observation.answer.intendedValueHash ? "USER_CORRECTION" : "USER_MANUAL",
            presentationMode: "AUTO_PROMINENT",
            reasonCodes: cleanReasons(removesOverride ? "CANDIDATE_RETURNED_TO_GLOBAL_DEFAULT" : "CANDIDATE_CREATED_EXACT_SCOPED_REVIEW",
                evidence.classification.answer.reasonCodes, policy.reasonCode, proposal.reasonCodes)
        };
    }

    const policyDecision = policyEligibility(policy, checkpointKind);
    if (!policyDecision.eligible) return { proposal, policy, decision: "REVIEW_REQUIRED", reasonCodes: [policyDecision.reasonCode] };
    if (active?.normalizedHash === normalizedHash) {
        return { proposal, policy, scope, active, normalizedHash, decision: "NO_CHANGE",
            reasonCodes: ["EQUIVALENT_ACTIVE_TRUTH_ALREADY_EXISTS"] };
    }
    return {
        proposal, policy, scope, active, normalizedHash, decision: "CREATE_TRUSTED",
        learningState: "TRUSTED",
        originKind: checkpointKind === "EXPLICIT_SAVE" ? "USER_EXPLICIT_SAVE" : "USER_MANUAL",
        presentationMode: policy.learningPresentation === "QUIET_SUMMARY" ? "AUTO_QUIET" : "AUTO_PROMINENT",
        reasonCodes: cleanReasons(policyDecision.reasonCode, evidence.classification.answer.reasonCodes,
            policy.reasonCode, proposal.reasonCodes)
    };
}

function replay(db, userId, idempotencyKey, payloadHash) {
    const receipt = db.prepare(`SELECT * FROM candidate_answer_change_set_receipts
        WHERE user_id = ? AND idempotency_key = ?`).get(userId, idempotencyKey);
    if (!receipt) return null;
    if (receipt.payload_hash !== payloadHash) {
        const error = new CandidateAnswerConflictError("Idempotency key was reused with a different learning change set.");
        error.code = "CHANGE_SET_IDEMPOTENCY_CONFLICT";
        throw error;
    }
    const changeSet = getCandidateAnswerChangeSet(userId, receipt.change_set_id);
    return { ...changeSet, held: changeSet?.summary?.heldItems || [], idempotentReplay: true };
}

/**
 * Commits every eligible answer version, dependency invalidation, immutable
 * change-set item, receipt, and value-free outbox notification atomically.
 */
export function commitCandidateAnswerChangeSet({ userId, idempotencyKey, input }) {
    if (!userId) throw new Error("Candidate identity is required.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/.test(String(idempotencyKey || ""))) {
        throw new Error("A bounded idempotency key is required.");
    }
    const parsed = candidateAnswerChangeSetCommitSchema.parse(input);
    const duplicateCanonicals = parsed.proposals.map((proposal) => proposal.canonicalKey)
        .filter((key, index, values) => values.indexOf(key) !== index);
    if (duplicateCanonicals.length) {
        const error = new Error("A learning change set may contain only one scoped value per canonical.");
        error.code = "DUPLICATE_CHANGE_SET_CANONICAL";
        throw error;
    }
    const payloadHash = stableContractHash(parsed);
    const db = getDb();
    return db.transaction(() => {
        const existing = replay(db, String(userId), String(idempotencyKey), payloadHash);
        if (existing) return existing;
        const checkpoint = checkpointRow(db, parsed.applicationId, parsed.runId, parsed.checkpointId);
        if (!checkpoint || checkpoint.status !== "VERIFIED" || !["SUBMISSION", "EXPLICIT_SAVE"].includes(checkpoint.checkpoint_type)) {
            const error = new Error("A verified submission or explicit-save checkpoint is required.");
            error.code = "STRONG_LEARNING_CHECKPOINT_REQUIRED";
            throw error;
        }
        const authority = applicationLearningAuthority(db, String(userId), parsed.applicationId, checkpoint.checkpoint_type);
        if (!authority.allowed) {
            const error = new Error("Reusable answer learning is disabled for this application.");
            error.code = authority.reasonCode;
            error.status = 409;
            throw error;
        }
        const planned = parsed.proposals.map((proposal) => planProposal(db, proposal, {
            userId: String(userId), applicationId: parsed.applicationId, runId: parsed.runId,
            checkpointKind: checkpoint.checkpoint_type
        }));
        const learningDecisions = new Set(["CREATE_TRUSTED", "CREATE_REVIEW", "PROMOTE_TRUSTED", "REMOVE_OVERRIDE"]);
        const learn = planned.filter((item) => learningDecisions.has(item.decision));
        const unchanged = planned.filter((item) => item.decision === "NO_CHANGE").map((item) => ({
            canonicalKey: item.proposal.canonicalKey,
            decision: item.decision,
            reasonCodes: item.reasonCodes
        }));
        const held = planned.filter((item) => !learningDecisions.has(item.decision) && item.decision !== "NO_CHANGE").map((item) => ({
            canonicalKey: item.proposal.canonicalKey,
            decision: item.decision,
            reasonCodes: item.reasonCodes
        }));
        if (!learn.length) return {
            id: null,
            status: "NO_ELIGIBLE_CHANGES",
            itemCount: 0,
            idempotentReplay: false,
            held,
            unchanged
        };
        const scopeKeys = learn.map((item) => `${item.proposal.canonicalKey}:${item.scope.scopeHash}`);
        if (new Set(scopeKeys).size !== scopeKeys.length) {
            const error = new Error("A learning change set contains duplicate canonical scope targets.");
            error.code = "DUPLICATE_CHANGE_SET_SCOPE";
            throw error;
        }
        const changeSetId = `answer_change_set_${crypto.randomUUID()}`;
        const presentationCounts = learn.reduce((counts, item) => ({
            ...counts,
            [item.presentationMode]: (counts[item.presentationMode] || 0) + 1
        }), {});
        const summary = {
            learned: learn.length,
            held: held.length,
            unchanged: unchanged.length,
            heldItems: held,
            autoQuiet: presentationCounts.AUTO_QUIET || 0,
            autoProminent: presentationCounts.AUTO_PROMINENT || 0,
            canonicalKeys: learn.map((item) => item.proposal.canonicalKey).sort(),
            transitions: learn.reduce((counts, item) => ({
                ...counts, [item.decision]: (counts[item.decision] || 0) + 1
            }), {})
        };
        db.prepare(`INSERT INTO candidate_answer_change_sets
            (id, user_id, application_id, run_id, checkpoint_id, checkpoint_kind,
             checkpoint_revision, source, payload_hash, item_count, summary_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(changeSetId, String(userId), parsed.applicationId, parsed.runId, parsed.checkpointId,
                checkpoint.checkpoint_type, Number(checkpoint.observed_at_ms),
                checkpoint.checkpoint_type === "SUBMISSION" ? "VERIFIED_SUBMISSION" : "EXPLICIT_CANDIDATE_SAVE",
                payloadHash, learn.length, canonicalContractJson(summary));
        const excludeCanonicals = learn.map((item) => item.proposal.canonicalKey);
        for (let index = 0; index < learn.length; index += 1) {
            const item = learn[index];
            const learned = saveCandidateAnswerVersionInTransaction(db, {
                userId: String(userId),
                canonicalKey: item.proposal.canonicalKey,
                normalizedValue: item.proposal.normalizedValue,
                context: item.proposal.context,
                scopeQualifiers: item.proposal.scopeQualifiers,
                source: "USER_ENTERED",
                sourceVersionId: changeSetId,
                expectedActiveVersionId: item.proposal.expectedActiveVersionId,
                idempotencyKey: `change-set:${stableContractHash({ changeSetId, index }).slice(0, 48)}`,
                confirmedAt: new Date(Number(checkpoint.observed_at_ms)).toISOString(),
                candidateApproved: true,
                dependencyInvalidationExcludeCanonicals: excludeCanonicals,
                learningState: item.learningState,
                originKind: item.originKind,
                activate: item.decision !== "REMOVE_OVERRIDE",
                inactiveReason: item.decision === "REMOVE_OVERRIDE" ? "OVERRIDE_MATCHED_GLOBAL_FALLBACK" : null
            });
            if (learned.anomaly?.suspicious && checkpoint.checkpoint_type !== "EXPLICIT_SAVE") {
                const error = new Error("A suspicious answer change requires explicit review before saving.");
                error.code = "CHANGE_SET_ANOMALY_REQUIRES_REVIEW";
                throw error;
            }
            db.prepare(`INSERT INTO candidate_answer_change_set_items
                (id, change_set_id, observation_id, field_logical_id, canonical_key, scope_hash,
                 previous_version_id, learned_version_id, normalized_hash, presentation_mode,
                 reason_codes_json, transition_kind, learning_state_before, learning_state_after,
                 used_answer_version_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(`answer_change_item_${crypto.randomUUID()}`, changeSetId, item.proposal.observationId,
                    item.proposal.fieldLogicalId, item.proposal.canonicalKey, learned.scopeHash,
                    learned.supersedesId, learned.id, learned.normalizedHash,
                    learned.anomaly?.suspicious ? "AUTO_PROMINENT" : item.presentationMode,
                    canonicalContractJson(cleanReasons(item.reasonCodes, learned.anomaly?.reasonCodes || [])),
                    item.decision, item.active?.learningState || null, learned.learningState,
                    item.proposal.usedAnswerVersionId);
        }
        db.prepare(`INSERT INTO candidate_answer_change_set_receipts
            (user_id, idempotency_key, payload_hash, change_set_id) VALUES (?, ?, ?, ?)`)
            .run(String(userId), String(idempotencyKey), payloadHash, changeSetId);
        db.prepare(`INSERT INTO extension_backend_outbox
            (id, candidate_id, run_id, event_type, aggregate_id, payload_json, available_at_ms)
            VALUES (?, ?, ?, 'CANDIDATE_ANSWER_CHANGE_SET_COMMITTED', ?, ?, ?)`)
            .run(crypto.randomUUID(), String(userId), parsed.runId, changeSetId,
                canonicalContractJson({ changeSetId, itemCount: learn.length, presentationCounts }), Date.now());
        return {
            ...getCandidateAnswerChangeSet(String(userId), changeSetId),
            idempotentReplay: false,
            held,
            unchanged
        };
    })();
}

export function candidateAnswerChangeSetHistory(userId, options = {}) {
    return listCandidateAnswerChangeSets(userId, options);
}
