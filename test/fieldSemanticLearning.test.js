import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    buildFieldSemanticDescriptor,
    compactCanonicalizationPayload,
    richCanonicalizationPayload,
    semanticTextForEmbedding
} from "../src/contracts/fieldSemanticDescriptor.js";

test("field semantic descriptors are bounded, contextual and value-free", () => {
    const field = {
        id: "current-company",
        label: "Organization with which you are presently engaged",
        type: "text",
        name: "candidate.organization",
        value: "Private Employer Pvt Ltd",
        rawHtml: "<input value='Private Employer Pvt Ltd'>",
        semanticContext: {
            section: "Current employment details",
            previous: { label: "Current job title", value: "Staff Engineer" },
            next: { label: "Annual compensation", value: "₹40 LPA" }
        }
    };
    const descriptor = buildFieldSemanticDescriptor(field, {
        ats: "workday", host: "careers.example.com", adapterVersion: "2"
    });
    const serialized = JSON.stringify(descriptor);
    assert.equal(descriptor.source.normalizedLabel, "organization with which you are current engaged");
    assert.equal(descriptor.context.previous.label, "Current job title");
    assert.equal(descriptor.context.next.label, "Annual compensation");
    assert.equal(descriptor.fingerprints.exact.length, 64);
    assert.doesNotMatch(serialized, /Private Employer|Staff Engineer|40 LPA|rawHtml|value/i);
    assert.doesNotMatch(semanticTextForEmbedding(descriptor), /Private Employer|Staff Engineer|40 LPA/i);

    const candidates = [{ key: "CURRENT_COMPANY", description: "Candidate's current employer", similarity: 0.91 }];
    const compact = compactCanonicalizationPayload(descriptor, candidates);
    const rich = richCanonicalizationPayload(descriptor, candidates);
    assert.deepEqual(Object.keys(compact.field), ["label", "type"]);
    assert.equal(compact.context.section, "Current employment details");
    assert.equal(rich.environment.ats, "workday");
    assert.doesNotMatch(JSON.stringify(rich), /Private Employer|Staff Engineer|40 LPA/i);

    const interpolatedIdentifier = buildFieldSemanticDescriptor({
        label: "Contact jane.candidate@example.com or +91 98765 43210",
        type: "text"
    });
    assert.doesNotMatch(JSON.stringify(interpolatedIdentifier), /jane\.candidate|98765|43210/i,
        "shared semantic descriptors must redact interpolated candidate identifiers");
});

test("canonical mappings reuse exact knowledge locally and require admin approval after SHADOW evidence", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-hunter-field-semantics-"));
    process.env.DATABASE_PATH = path.join(directory, "test.db");
    const { closeDb, getDb } = await import("../src/database/connection.js");
    const { canonicalizeField, canonicalizeFieldSync, toSharedFieldSemanticResult } = await import("../src/services/fieldCanonicalizer.js");
    const {
        findSemanticMapping,
        recordSemanticMappingEvidence,
        remapSemanticMapping,
        proposeCanonical,
        saveSemanticMapping,
        semanticLearningDiagnostics,
        setSemanticMappingStatus
    } = await import("../src/repositories/fieldSemanticRepository.js");
    const { setFeatureFlag } = await import("../src/repositories/featureFlagRepository.js");
    const { recordExplicitSemanticDecision } = await import("../src/services/semanticMappingEvidenceService.js");
    const {
        getCachedCanonicalizationDecision,
        getCachedSemanticEmbedding,
        saveCachedCanonicalizationDecision,
        saveCachedSemanticEmbedding,
        semanticCacheDiagnostics
    } = await import("../src/repositories/canonicalSemanticCacheRepository.js");

    try {
        const db = getDb();
        assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='field_semantic_mappings'").get());
        assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_semantic_cache'").get());

        const obvious = canonicalizeFieldSync({ label: "Current company", type: "text" }, {
            ats: "workday", host: "a.example", adapterVersion: "1"
        });
        assert.equal(obvious.decision, "RESOLVED");
        assert.equal(obvious.canonicalKey, "CURRENT_COMPANY");
        assert.equal(obvious.inference.obvious, true);
        const sharedResult = toSharedFieldSemanticResult(obvious);
        assert.equal(sharedResult.status, "RESOLVED");
        assert.equal(sharedResult.canonicalKey, "CURRENT_COMPANY");
        assert.equal(sharedResult.valueFree, true);
        assert.equal(Object.hasOwn(sharedResult, "answer"), false);

        let protectedSemanticCalls = 0;
        let protectedAiCalls = 0;
        const protectedResult = await canonicalizeField({
            label: "I consent to a background check", type: "checkbox"
        }, { ats: "greenhouse", host: "safe.example" }, {
            semanticSearch: async () => { protectedSemanticCalls += 1; return []; },
            aiFallback: async () => { protectedAiCalls += 1; return { result: null }; }
        });
        assert.equal(toSharedFieldSemanticResult(protectedResult).status, "PROTECTED");
        assert.equal(protectedSemanticCalls, 0, "legal fields must not enter semantic retrieval or embeddings");
        assert.equal(protectedAiCalls, 0, "legal fields must not enter canonicalization AI");

        const semanticResult = await canonicalizeField({
            label: "Professional affiliation record", type: "text"
        }, { ats: "greenhouse", host: "semantic.example" }, {
            semanticSearch: async () => [{
                key: "CURRENT_COMPANY", label: "Current company",
                description: "Candidate's current employer", similarity: 0.94
            }],
            aiFallback: async () => { throw new Error("semantic acceptance must not call AI"); }
        });
        assert.equal(semanticResult.source, "SEMANTIC");
        assert.equal(semanticResult.decision, "NEEDS_CONFIRMATION");
        assert.equal(semanticResult.mapping.status, "CANDIDATE");

        const aiField = { label: "Current organizational affiliation", type: "text" };
        const aiContext = { ats: "generic", host: "ai.example" };
        const aiResult = await canonicalizeField(aiField, aiContext, {
            semanticSearch: async () => [],
            aiFallback: async () => ({ attempted: true, result: {
                decision: "EXISTING_CANONICAL", canonical: "CURRENT_COMPANY", confidence: 0.93,
                reasonCodes: ["COMPACT_CONTEXT_MATCH"], needsMoreContext: false, proposed: null
            } })
        });
        assert.equal(aiResult.source, "AI");
        assert.equal(aiResult.decision, "NEEDS_CONFIRMATION");
        assert.equal(canonicalizeFieldSync(aiField, aiContext).mapping.id, aiResult.mapping.id,
            "an accepted AI mapping must become an exact local cache hit on the next request");

        const newConceptField = { label: "Preferred on-call rotation cadence", type: "select-one",
            options: ["Never", "Monthly", "Weekly"] };
        const proposedResult = await canonicalizeField(newConceptField, {
            ats: "generic", host: "proposal.example"
        }, {
            semanticSearch: async () => [],
            aiFallback: async () => ({ attempted: true, result: {
                decision: "NEW_CANONICAL_REQUIRED", canonical: null, confidence: 0.91,
                reasonCodes: ["NO_EXISTING_CONCEPT"], needsMoreContext: false,
                proposed: {
                    canonicalName: "ON_CALL_ROTATION_CADENCE", label: "Preferred on-call rotation cadence",
                    description: "Candidate preference for recurring on-call duty", semanticGroup: "availability",
                    dataType: "ENUM", answerType: "ENUM", sensitivity: "STANDARD",
                    displayQuestion: "How often are you willing to be on call?"
                }
            } })
        });
        assert.equal(proposedResult.decision, "NEW_CONCEPT_PROPOSED");
        assert.equal(proposedResult.canonical.status, "PROPOSED");
        assert.equal(proposedResult.mapping.status, "CANDIDATE");
        assert.equal(canonicalizeFieldSync(newConceptField, {
            ats: "generic", host: "proposal.example"
        }).decision, "NEEDS_CONFIRMATION", "a proposal must be reused locally without becoming globally active");

        const uncertainField = {
            label: "Organization with which you are presently engaged",
            type: "text",
            semanticContext: { section: "Employment", previous: { label: "Current job title" }, next: { label: "Annual compensation" } }
        };
        const descriptor = buildFieldSemanticDescriptor(uncertainField, { ats: "workday", host: "a.example" });
        const cacheInput = semanticTextForEmbedding(descriptor);
        saveCachedSemanticEmbedding({ semanticFingerprint: descriptor.fingerprints.semantic,
            inputText: cacheInput, model: "test-embedding", embedding: [0.1, 0.2] });
        assert.deepEqual(getCachedSemanticEmbedding({ semanticFingerprint: descriptor.fingerprints.semantic,
            inputText: cacheInput, model: "test-embedding" }), [0.1, 0.2]);
        const unresolvedDecision = { decision: "UNRESOLVED", canonical: null, confidence: 0.2,
            reasonCodes: ["AMBIGUOUS"], needsMoreContext: false, proposed: null };
        saveCachedCanonicalizationDecision({ semanticFingerprint: descriptor.fingerprints.semantic,
            inputText: cacheInput, model: "test-model", promptVersion: "v1", decision: unresolvedDecision });
        assert.deepEqual(getCachedCanonicalizationDecision({ semanticFingerprint: descriptor.fingerprints.semantic,
            inputText: cacheInput, model: "test-model", promptVersion: "v1" }), unresolvedDecision);
        assert.equal(semanticCacheDiagnostics().embeddingHits, 1);
        assert.equal(semanticCacheDiagnostics().decisionHits, 1);
        const candidate = saveSemanticMapping({ descriptor, canonicalFieldKey: "CURRENT_COMPANY",
            source: "AI", confidence: 0.91, status: "CANDIDATE" });
        const requiresConfirmation = canonicalizeFieldSync(uncertainField, { ats: "workday", host: "a.example" });
        assert.equal(requiresConfirmation.decision, "NEEDS_CONFIRMATION");
        assert.equal(requiresConfirmation.canonicalKey, "CURRENT_COMPANY");
        const localReuse = canonicalizeFieldSync(uncertainField, {
            ats: "workday", host: "a.example", knownSemanticKey: "CURRENT_COMPANY"
        });
        assert.equal(localReuse.decision, "RESOLVED");
        assert.equal(localReuse.source, "USER_LOCAL_MAPPING");
        const duplicateProposal = proposeCanonical({
            canonicalName: "present_employer",
            label: "Present employer",
            description: "Candidate's current employer"
        });
        assert.equal(duplicateProposal.created, false);
        assert.equal(duplicateProposal.duplicate, true);
        assert.equal(duplicateProposal.canonical.key, "CURRENT_COMPANY");

        const answerKept = recordSemanticMappingEvidence({ mappingId: candidate.id, fieldSignature: "one", eventType: "ANSWER_KEPT" });
        const answerOverwritten = recordSemanticMappingEvidence({ mappingId: candidate.id, fieldSignature: "two", eventType: "ANSWER_OVERWRITTEN" });
        assert.equal(answerKept.evidenceScore, 0);
        assert.equal(answerOverwritten.evidenceScore, 0);
        assert.equal(answerOverwritten.status, "CANDIDATE");
        const quarantined = recordSemanticMappingEvidence({ mappingId: candidate.id, fieldSignature: "three", eventType: "MAPPING_CORRECTED" });
        assert.equal(quarantined.evidenceScore, -2);
        assert.equal(quarantined.status, "CANDIDATE", "evidence must not mutate live semantic status");

        const promotedField = { label: "City of residence", type: "text", semanticContext: { section: "Contact details" } };
        const promotedDescriptor = buildFieldSemanticDescriptor(promotedField, { ats: "greenhouse", host: "first.example" });
        const promoted = saveSemanticMapping({ descriptor: promotedDescriptor, canonicalFieldKey: "CURRENT_LOCATION",
            source: "SEMANTIC", confidence: 0.9, status: "CANDIDATE" });
        db.prepare("INSERT INTO companies (id, name) VALUES ('semantic-company', 'Semantic Co')").run();
        db.prepare(`INSERT INTO jobs (id, company_id, title, description, url, source, status)
            VALUES ('semantic-job', 'semantic-company', 'Engineer', 'Role', 'https://first.example/job', 'test', 'MATCHED')`).run();
        for (let index = 1; index <= 20; index += 1) {
            const applicationId = `semantic-app-${index}`;
            db.prepare(`INSERT INTO applications (id, user_id, job_id, adapter, status)
                VALUES (?, ?, 'semantic-job', 'EXTENSION', 'SUCCESS')`).run(applicationId, `semantic-user-${index}`);
            const attemptId = `semantic-attempt-${index}`;
            db.prepare(`INSERT INTO application_attempts (id, application_id, status)
                VALUES (?, ?, 'SUCCESS')`).run(attemptId, applicationId);
            const result = index === 1 ? (() => {
                setFeatureFlag({ key: "learning.phase0_classifier", enabled: true });
                setFeatureFlag({ key: "adaptive_evidence.shadow", enabled: true });
                return recordExplicitSemanticDecision({
                    mappingId: promoted.id,
                    canonicalKey: "CURRENT_LOCATION",
                    applicationId,
                    attemptId,
                    fieldId: "city",
                    fieldSignature: `location-${index}`,
                    decision: "CONFIRMED",
                    extensionVersion: "test-extension"
                }).mapping;
            })() : recordSemanticMappingEvidence({ mappingId: promoted.id, applicationId,
                attemptId, fieldSignature: `location-${index}`, eventType: "MAPPING_CONFIRMED" });
            assert.equal(result.status, "CANDIDATE");
        }
        assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM adaptive_evidence_shadow_events
            WHERE layer = 'SEMANTIC_MAPPING' AND subject_key = ? AND direction = 'POSITIVE'`)
            .get(`${promoted.id}:CURRENT_LOCATION`).count, 1);

        const remapDescriptor = buildFieldSemanticDescriptor({
            label: "Relationship with this organization", type: "radio"
        }, { ats: "greenhouse", host: "first.example" });
        const oldMeaning = saveSemanticMapping({ descriptor: remapDescriptor, canonicalFieldKey: "CURRENT_EMPLOYEE",
            source: "AI", confidence: 0.86, status: "CANDIDATE" });
        setSemanticMappingStatus(oldMeaning.id, "VALIDATED");
        setSemanticMappingStatus(oldMeaning.id, "TRUSTED");
        recordExplicitSemanticDecision({
            mappingId: oldMeaning.id, canonicalKey: "CURRENT_EMPLOYEE",
            applicationId: "semantic-app-1", attemptId: "semantic-attempt-1",
            fieldId: "relationship", fieldSignature: "relationship-radio", decision: "CORRECTED",
            correctedTo: "PREVIOUS_EMPLOYEE", extensionVersion: "test-extension"
        });
        const correctedMeaning = saveSemanticMapping({ descriptor: remapDescriptor, canonicalFieldKey: "PREVIOUS_EMPLOYEE",
            source: "USER_CONFIRMED", confidence: 1, status: "CANDIDATE" });
        assert.equal(correctedMeaning.id, oldMeaning.id, "descriptor identity remains stable across remapping");
        assert.equal(correctedMeaning.conflict, true, "trusted mappings must not be overwritten without operator approval");
        assert.equal(correctedMeaning.canonicalFieldKey, "CURRENT_EMPLOYEE");
        assert.equal(correctedMeaning.suggestedCanonicalFieldKey, "PREVIOUS_EMPLOYEE");
        recordExplicitSemanticDecision({
            mappingId: correctedMeaning.id, canonicalKey: "PREVIOUS_EMPLOYEE",
            applicationId: "semantic-app-1", attemptId: "semantic-attempt-1",
            fieldId: "relationship", fieldSignature: "relationship-radio", decision: "CONFIRMED",
            alternative: true, extensionVersion: "test-extension"
        });
        const remapSubjects = db.prepare(`SELECT subject_key, direction FROM adaptive_evidence_shadow_events
            WHERE layer = 'SEMANTIC_MAPPING' AND subject_key LIKE ? ORDER BY direction`).all(`${oldMeaning.id}:%`);
        assert.deepEqual(new Set(remapSubjects.map((row) => row.subject_key)), new Set([
            `${oldMeaning.id}:CURRENT_EMPLOYEE`, `${oldMeaning.id}:PREVIOUS_EMPLOYEE`
        ]), "old and corrected meanings must never share one adaptive subject");
        const historicalCorrection = JSON.parse(db.prepare(`SELECT metadata_json FROM semantic_mapping_evidence
            WHERE mapping_id = ? AND event_type = 'MAPPING_CORRECTED' ORDER BY created_at DESC LIMIT 1`)
            .get(oldMeaning.id).metadata_json);
        assert.equal(historicalCorrection.canonicalFieldKey, "CURRENT_EMPLOYEE");
        assert.equal(historicalCorrection.correctedTo, "PREVIOUS_EMPLOYEE");
        const suggested = semanticLearningDiagnostics().reviewQueue.find((row) => row.id === oldMeaning.id);
        assert.equal(suggested.suggestedCanonicalFieldKey, "PREVIOUS_EMPLOYEE");
        const remapped = remapSemanticMapping(oldMeaning.id, "PREVIOUS_EMPLOYEE");
        assert.equal(remapped.canonicalFieldKey, "PREVIOUS_EMPLOYEE");
        assert.equal(remapped.status, "CANDIDATE", "an approved remap must collect fresh evidence before trust");

        setSemanticMappingStatus(promoted.id, "VALIDATED");
        setSemanticMappingStatus(promoted.id, "TRUSTED");
        const otherHost = buildFieldSemanticDescriptor(promotedField, { ats: "greenhouse", host: "second.example" });
        const globalReuse = findSemanticMapping(otherHost);
        assert.equal(globalReuse.canonicalFieldKey, "CURRENT_LOCATION");
        assert.equal(globalReuse.status, "TRUSTED");
        assert.equal(globalReuse.lookupSource, "GLOBAL_NORMALIZED_MAPPING");

        const diagnostics = semanticLearningDiagnostics();
        assert.ok(diagnostics.mappingsByStatus.some((row) => row.status === "TRUSTED"));
        assert.ok(diagnostics.reviewQueue.some((row) => row.id === candidate.id && row.status === "CANDIDATE"));
        assert.ok(diagnostics.reviewQueue.some((row) => row.id === candidate.id && row.correctedCount === 1));
        assert.equal(JSON.stringify(diagnostics).includes("Private Employer"), false);
    } finally {
        closeDb();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
