import assert from "node:assert/strict";
import test from "node:test";
import {
  DECLARATION_POLICY_VERSION,
  type DeclarationContext,
  type DeclarationSemanticHint
} from "@job-hunter-v2/contracts";
import { DeclarationPolicyEngine } from "./policy.js";
import { DeclarationPolicyService, type DeclarationEvidenceCommand, type DeclarationEvidenceRepository } from "./service.js";

const ids = {
  application: "10000000-0000-4000-8000-000000000001",
  run: "20000000-0000-4000-8000-000000000001",
  page: "30000000-0000-4000-8000-000000000001",
  authorization: "40000000-0000-4000-8000-000000000001",
  account: "50000000-0000-4000-8000-000000000001",
  candidate: "60000000-0000-4000-8000-000000000001"
};

function hint(state: DeclarationSemanticHint["state"] = "KNOWN_DECLARATION", textEvidence: DeclarationSemanticHint["textEvidence"] = "FULL", confidence = 0.96): DeclarationSemanticHint {
  return {
    state,
    confidence,
    textEvidence,
    sourceEvidence: state === "KNOWN_DECLARATION" ? ["CANONICAL_MATCH", "LABEL"] : ["LABEL"],
    reasonCodes: [state === "KNOWN_DECLARATION" ? "J_DECLARATION_CANONICAL_MATCH" : "J_AMBIGUOUS_DECLARATION_LANGUAGE"],
    valuePrivate: true,
    containsCandidateValue: false
  };
}

function context(canonicalKey: string | null, overrides: Partial<DeclarationContext> = {}): DeclarationContext {
  return {
    schemaVersion: 1,
    applicationId: ids.application,
    applicationRunId: ids.run,
    pageInstanceId: ids.page,
    formInstanceId: "form:declarations",
    fieldRuntimeId: "field:declaration",
    controlFingerprint: "control:declaration",
    graphGuard: { pageInstanceId: ids.page, graphRevision: 4, graphFingerprint: "a".repeat(64) },
    semantic: {
      state: canonicalKey ? "RESOLVED_HIGH" : "UNRESOLVED",
      canonicalKey,
      confidence: canonicalKey ? 0.96 : 0,
      descriptorFingerprint: "d".repeat(64),
      declarationHint: canonicalKey ? hint() : hint("DECLARATION_LIKE", "PARTIAL", 0.55)
    },
    controlType: "CHECKBOX",
    required: false,
    disabled: false,
    visible: true,
    enabled: true,
    currentStep: true,
    ownership: "UNKNOWN",
    materialTermsInspectable: true,
    finalReviewGuaranteed: true,
    valuePrivate: true,
    containsCandidateValue: false,
    ...overrides
  };
}

const engine = new DeclarationPolicyEngine(
  () => new Date("2026-09-10T00:00:00.000Z"),
  () => ids.authorization
);

test("O1 maps declaration canonicals to an inspectable, non-reusable taxonomy", () => {
  const matrix = [
    ["CERTIFY_INFORMATION_ACCURATE", "ACCURACY_CERTIFICATION"],
    ["PRIVACY_ACKNOWLEDGEMENT", "PRIVACY_ACKNOWLEDGEMENT"],
    ["TERMS_ACKNOWLEDGEMENT", "TERMS_ACKNOWLEDGEMENT"],
    ["BACKGROUND_CHECK_AUTHORIZATION", "BACKGROUND_CHECK_CONSENT"],
    ["DATA_PROCESSING_CONSENT", "DATA_PROCESSING_CONSENT"],
    ["APPLICANT_CERTIFICATION", "APPLICANT_CERTIFICATION"],
    ["EEO_ACKNOWLEDGEMENT", "EEO_ACKNOWLEDGEMENT"],
    ["APPLICATION_SPECIFIC_ACKNOWLEDGEMENT", "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT"]
  ] as const;
  for (const [canonicalKey, declarationType] of matrix) {
    const classification = engine.classify(context(canonicalKey));
    assert.equal(classification.declarationType, declarationType);
    assert.equal(classification.reusePolicy, "NEVER");
    assert.equal(classification.candidateReviewRequired, true);
    assert.equal(classification.automaticInteractionAllowed, false);
    assert.equal(classification.containsCandidateValue, false);
  }
});

test("O2 prepares only configured acknowledgements and never silently auto-consents", () => {
  for (const canonicalKey of ["CERTIFY_INFORMATION_ACCURATE", "PRIVACY_ACKNOWLEDGEMENT"]) {
    const decision = engine.decide(context(canonicalKey));
    assert.equal(decision.outcome, "PREPARE_FOR_REVIEW");
    assert.equal(decision.authorization?.policyDecision, "PREPARE_FOR_REVIEW");
    assert.equal(decision.authorization?.reviewRequirement, "FINAL_REVIEW");
    assert.equal(decision.policyVersion, DECLARATION_POLICY_VERSION);
  }
  for (const canonicalKey of [
    "TERMS_ACKNOWLEDGEMENT",
    "BACKGROUND_CHECK_AUTHORIZATION",
    "DATA_PROCESSING_CONSENT",
    "APPLICANT_CERTIFICATION",
    "EEO_ACKNOWLEDGEMENT",
    "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT"
  ]) {
    const decision = engine.decide(context(canonicalKey));
    assert.equal(decision.outcome, "REQUIRES_EXPLICIT_USER_ACTION", canonicalKey);
    assert.equal(decision.authorization, null);
  }
  assert.equal([
    "CERTIFY_INFORMATION_ACCURATE",
    "PRIVACY_ACKNOWLEDGEMENT",
    "TERMS_ACKNOWLEDGEMENT",
    "BACKGROUND_CHECK_AUTHORIZATION"
  ].some((key) => engine.decide(context(key)).outcome === "AUTO_ALLOWED"), false);
});

test("durable policy matrix records execution, review, reuse and evidence expectations", () => {
  const matrix = [
    { canonicalKey: "CERTIFY_INFORMATION_ACCURATE", required: true, text: "FULL", outcome: "PREPARE_FOR_REVIEW", authorized: true, review: "REVIEW_BEFORE_SUBMIT" },
    { canonicalKey: "PRIVACY_ACKNOWLEDGEMENT", required: false, text: "FULL", outcome: "PREPARE_FOR_REVIEW", authorized: true, review: "REVIEW_BEFORE_SUBMIT" },
    { canonicalKey: "TERMS_ACKNOWLEDGEMENT", required: true, text: "FULL", outcome: "REQUIRES_EXPLICIT_USER_ACTION", authorized: false, review: "NEEDS_CANDIDATE_ACTION" },
    { canonicalKey: "BACKGROUND_CHECK_AUTHORIZATION", required: true, text: "FULL", outcome: "REQUIRES_EXPLICIT_USER_ACTION", authorized: false, review: "NEEDS_CANDIDATE_ACTION" },
    { canonicalKey: "DATA_PROCESSING_CONSENT", required: false, text: "FULL", outcome: "REQUIRES_EXPLICIT_USER_ACTION", authorized: false, review: "NEEDS_CANDIDATE_ACTION" },
    { canonicalKey: "APPLICANT_CERTIFICATION", required: false, text: "FULL", outcome: "REQUIRES_EXPLICIT_USER_ACTION", authorized: false, review: "NEEDS_CANDIDATE_ACTION" },
    { canonicalKey: "EEO_ACKNOWLEDGEMENT", required: false, text: "FULL", outcome: "REQUIRES_EXPLICIT_USER_ACTION", authorized: false, review: "NEEDS_CANDIDATE_ACTION" },
    { canonicalKey: "APPLICATION_SPECIFIC_ACKNOWLEDGEMENT", required: false, text: "FULL", outcome: "REQUIRES_EXPLICIT_USER_ACTION", authorized: false, review: "NEEDS_CANDIDATE_ACTION" }
  ] as const;
  for (const fixture of matrix) {
    const current = context(fixture.canonicalKey, { required: fixture.required });
    current.semantic.declarationHint = hint("KNOWN_DECLARATION", fixture.text, 0.96);
    const decision = engine.decide(current);
    const review = engine.reviewItem(current, decision);
    assert.equal(decision.outcome, fixture.outcome, fixture.canonicalKey);
    assert.equal(Boolean(decision.authorization), fixture.authorized, fixture.canonicalKey);
    assert.equal(review.status, fixture.review, fixture.canonicalKey);
    assert.equal(decision.classification.reusePolicy, "NEVER", fixture.canonicalKey);
    assert.equal(decision.classification.textEvidence, fixture.text, fixture.canonicalKey);
    assert.equal(decision.policyVersion, "O1-2026-09", fixture.canonicalKey);
    assert.equal(decision.containsCandidateValue, false, fixture.canonicalKey);
  }
});

test("previous or similar declaration decisions never authorize another application", () => {
  const first = engine.decide(context("PRIVACY_ACKNOWLEDGEMENT"));
  const secondContext = context("PRIVACY_ACKNOWLEDGEMENT", { applicationId: "10000000-0000-4000-8000-000000000002" });
  const second = engine.decide(secondContext);
  const materiallyDifferent = engine.decide(context("BACKGROUND_CHECK_AUTHORIZATION", { applicationId: "10000000-0000-4000-8000-000000000002" }));
  assert.notEqual(first.decisionFingerprint, second.decisionFingerprint);
  assert.equal(second.outcome, "PREPARE_FOR_REVIEW");
  assert.equal(materiallyDifferent.outcome, "REQUIRES_EXPLICIT_USER_ACTION");
  assert.equal(materiallyDifferent.authorization, null);
});

test("requiredness never escalates declaration authorization", () => {
  const optional = engine.decide(context("BACKGROUND_CHECK_AUTHORIZATION", { required: false }));
  const required = engine.decide(context("BACKGROUND_CHECK_AUTHORIZATION", { required: true }));
  assert.equal(optional.outcome, "REQUIRES_EXPLICIT_USER_ACTION");
  assert.equal(required.outcome, optional.outcome);
  assert.notEqual(required.decisionFingerprint, optional.decisionFingerprint);
});

test("ambiguous wording, unavailable text and insufficient confidence fail safely", () => {
  const ambiguous = engine.decide(context(null));
  assert.equal(ambiguous.outcome, "UNRESOLVED");
  assert.equal(ambiguous.failureCode, "DECLARATION_POLICY_AMBIGUOUS");
  assert.equal(ambiguous.authorization, null);

  const unavailable = context("PRIVACY_ACKNOWLEDGEMENT");
  unavailable.semantic.declarationHint = hint("KNOWN_DECLARATION", "UNAVAILABLE", 0.96);
  unavailable.materialTermsInspectable = false;
  const unavailableDecision = engine.decide(unavailable);
  assert.equal(unavailableDecision.outcome, "REQUIRES_EXPLICIT_USER_ACTION");
  assert.equal(unavailableDecision.failureCode, "DECLARATION_TEXT_UNAVAILABLE");

  const medium = context("CERTIFY_INFORMATION_ACCURATE");
  medium.semantic.state = "RESOLVED_MEDIUM";
  medium.semantic.confidence = 0.8;
  medium.semantic.declarationHint = hint("KNOWN_DECLARATION", "FULL", 0.8);
  assert.equal(engine.decide(medium).outcome, "REQUIRES_EXPLICIT_USER_ACTION");
});

test("application identity, current graph state and candidate ownership are fail-closed inputs", () => {
  assert.equal(engine.decide(context("PRIVACY_ACKNOWLEDGEMENT", { applicationId: null })).outcome, "BLOCKED");
  assert.equal(engine.decide(context("PRIVACY_ACKNOWLEDGEMENT", { visible: false })).outcome, "BLOCKED");
  const radio = engine.decide(context("PRIVACY_ACKNOWLEDGEMENT", { controlType: "RADIO" }));
  assert.equal(radio.outcome, "REQUIRES_EXPLICIT_USER_ACTION");
  assert.equal(radio.failureCode, "DECLARATION_USER_ACTION_REQUIRED");
  assert.equal(radio.authorization, null);
  const candidateOwned = engine.decide(context("PRIVACY_ACKNOWLEDGEMENT", { ownership: "USER_OWNED" }));
  assert.equal(candidateOwned.outcome, "REQUIRES_EXPLICIT_USER_ACTION");
  assert.equal(candidateOwned.failureCode, "DECLARATION_MODIFIED_BY_USER");
});

test("policy decisions persist only value-private application evidence", async () => {
  const commands: DeclarationEvidenceCommand[] = [];
  const repository: DeclarationEvidenceRepository = {
    record: async (command) => {
      commands.push(command);
      return { evidenceId: "70000000-0000-4000-8000-000000000001", idempotentReplay: false };
    }
  };
  const service = new DeclarationPolicyService(
    engine,
    repository,
    () => new Date("2026-09-10T00:00:00.000Z"),
    (() => {
      const generated = [
        "80000000-0000-4000-8000-000000000001",
        "90000000-0000-4000-8000-000000000001"
      ];
      return () => generated.shift() ?? "90000000-0000-4000-8000-000000000001";
    })()
  );
  const result = await service.evaluate({ accountId: ids.account, candidateId: ids.candidate, context: context("PRIVACY_ACKNOWLEDGEMENT") });
  assert.equal(result.decision.outcome, "PREPARE_FOR_REVIEW");
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.request.eventType, "POLICY_DECIDED");
  assert.equal(commands[0]?.request.containsCandidateValue, false);
  assert.equal(JSON.stringify(commands[0]).toLowerCase().includes("privacy notice"), false);
});
