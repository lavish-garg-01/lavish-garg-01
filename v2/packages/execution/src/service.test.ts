import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ExecutionPlanRequestSchema, ExecutionRequestSchema, type ExecutionPlanRequest, type FieldEvidenceInput, type FormGraphNode } from "@job-hunter-v2/contracts";
import type { FieldIntelligenceService, PrivateFieldIntelligenceResult } from "@job-hunter-v2/field-intelligence";
import { createGraphNodeId, formGraphHash, reconcileFormGraph } from "@job-hunter-v2/form-graph";
import { capabilityHints, ExecutionPlanningService } from "./service.js";

const pageInstanceId = crypto.randomUUID();
const applicationRunId = crypto.randomUUID();
const field: FieldEvidenceInput = {
  evidenceVersion: 1, fieldRuntimeId: "field:12345678", pageInstanceId,
  formInstanceId: "form:12345678", sectionFingerprint: "section:12345678",
  controlFingerprint: "control:12345678", controlType: "EMAIL", labelEvidence: ["Email"],
  contextEvidence: { section: "Contact", previousLabel: null, nextLabel: null, semanticGroup: "PERSONAL", pageHeading: null, formHeading: null, nearbyDescription: null },
  locatorEvidence: { tagName: "input", type: "email", name: "email", id: "email", autocomplete: "email", ariaLabel: null, placeholder: null, role: null, accessibleDescription: null, occurrence: 0 },
  optionEvidence: { count: 0, samples: [] },
  repeatableEvidence: { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel: null },
  required: true, disabled: false, ownership: "UNKNOWN"
};
test("planner requires explicit rich-text capability evidence", () => {
  const richText: FieldEvidenceInput = { ...field, controlType: "TEXTAREA", locatorEvidence: { ...field.locatorEvidence, tagName: "div", type: null, contentEditable: true } };
  assert.deepEqual(capabilityHints(richText), ["CONTENTEDITABLE"]);
  assert.deepEqual(capabilityHints({ ...richText, locatorEvidence: { ...richText.locatorEvidence, contentEditable: false } }), ["UNSUPPORTED"]);
  assert.deepEqual(capabilityHints({ ...richText, locatorEvidence: { ...richText.locatorEvidence, tagName: "textarea", contentEditable: false } }), ["NATIVE_TEXTAREA"]);
  assert.deepEqual(capabilityHints({ ...field, controlType: "RADIO", locatorEvidence: { ...field.locatorEvidence, tagName: "div", type: null, role: "radio" } }), ["CUSTOM_RADIO_GROUP"]);
});

const graphNode: FormGraphNode = {
  graphNodeId: createGraphNodeId("FIELD", `${pageInstanceId}:${field.fieldRuntimeId}`), nodeType: "FIELD", pageInstanceId,
  formInstanceId: field.formInstanceId, logicalFingerprint: formGraphHash(field.fieldRuntimeId), parentGraphNodeId: null,
  fieldRuntimeId: field.fieldRuntimeId, controlFingerprint: field.controlFingerprint, formRepeatGroupId: null,
  actionKind: null, semanticRole: null, state: "REACHABLE", visible: true, enabled: true, required: true,
  currentStep: true, technical: false, optionFingerprint: null, optionCount: 0, validationState: "NONE",
  validationErrorCount: 0, declaredTargetKeys: [], evidence: ["STRUCTURAL_INFERENCE"], confidence: 1,
  valuePrivate: true, containsCandidateValue: false
};
const graph = reconcileFormGraph(null, {
  schemaVersion: 1, observationId: crypto.randomUUID(), applicationRunId, pageInstanceId,
  routeFingerprint: formGraphHash("/apply"), observedAt: new Date().toISOString(), nodes: [graphNode], edges: [],
  source: "INITIAL_SCAN", valuePrivate: true, containsCandidateValue: false
}).graph;
const request: ExecutionPlanRequest = {
  schemaVersion: 1, requestId: crypto.randomUUID(), pageInstanceId,
  graph,
  intelligence: {
    schemaVersion: 1, requestId: crypto.randomUUID(), applicationRunId,
    pageContext: { host: "example.test", ats: "GENERIC", pageHeading: null, jobId: null, applicationId: null, countryCode: null, roleFamily: null, companyId: null },
    fields: [field]
  }
};

function declarationFixture(input: {
  canonicalKey: string | null;
  label: string;
  required?: boolean;
  ownership?: FieldEvidenceInput["ownership"];
  applicationId?: string | null;
  semanticState?: "RESOLVED_HIGH" | "RESOLVED_MEDIUM" | "AMBIGUOUS";
  hintState?: "KNOWN_DECLARATION" | "DECLARATION_LIKE";
  textEvidence?: "FULL" | "PARTIAL" | "UNAVAILABLE";
}) {
  const declarationField: FieldEvidenceInput = {
    ...field,
    controlType: "CHECKBOX",
    labelEvidence: [input.label],
    locatorEvidence: { ...field.locatorEvidence, tagName: "input", type: "checkbox", autocomplete: null },
    required: input.required ?? true,
    ownership: input.ownership ?? "UNKNOWN"
  };
  const declarationNode: FormGraphNode = { ...graphNode, required: declarationField.required };
  const declarationGraph = reconcileFormGraph(null, {
    schemaVersion: 1, observationId: crypto.randomUUID(), applicationRunId, pageInstanceId,
    routeFingerprint: formGraphHash("/declaration"), observedAt: new Date().toISOString(),
    nodes: [declarationNode], edges: [], source: "INITIAL_SCAN", valuePrivate: true, containsCandidateValue: false
  }).graph;
  const declarationRequest: ExecutionPlanRequest = {
    ...request,
    graph: declarationGraph,
    intelligence: {
      ...request.intelligence,
      pageContext: { ...request.intelligence.pageContext, applicationId: input.applicationId === undefined ? crypto.randomUUID() : input.applicationId },
      fields: [declarationField]
    }
  };
  const state = input.semanticState ?? (input.canonicalKey ? "RESOLVED_HIGH" : "AMBIGUOUS");
  const hintState = input.hintState ?? (input.canonicalKey ? "KNOWN_DECLARATION" : "DECLARATION_LIKE");
  const privateResult: PrivateFieldIntelligenceResult = {
    request: declarationRequest.intelligence,
    pageContext: declarationRequest.intelligence.pageContext,
    items: [{
      semantic: {
        fieldRuntimeId: declarationField.fieldRuntimeId, descriptorFingerprint: "d".repeat(64), state,
        canonicalKey: input.canonicalKey, confidence: state === "RESOLVED_HIGH" ? 0.99 : 0.7,
        resolver: input.canonicalKey ? "EXACT_ALIAS" : "NONE", candidates: [], reasonCodes: [], errorCodes: [],
        declarationHint: {
          state: hintState, confidence: state === "RESOLVED_HIGH" ? 0.99 : 0.7,
          textEvidence: input.textEvidence ?? "FULL", sourceEvidence: input.canonicalKey ? ["CANONICAL_MATCH", "LABEL"] : ["LABEL"],
          reasonCodes: [], valuePrivate: true, containsCandidateValue: false
        },
        evidence: { alias: 1, fieldType: 1, section: 1, neighbor: 0, attribute: 1, candidateMargin: 1 },
        contextHints: { countryCode: null }, entityBinding: declarationField.repeatableEvidence,
        valuePrivate: true, containsCandidateValue: false
      },
      answerResolution: null
    }],
    aiRequests: 0, cacheHits: 0, durationMs: 1
  };
  const intelligence = { resolvePrivate: async () => privateResult } as unknown as Pick<FieldIntelligenceService, "resolvePrivate">;
  return { declarationRequest, intelligence };
}

test("planner reuses authoritative private resolution and returns a transient operation", async () => {
  const privateResult: PrivateFieldIntelligenceResult = {
    request: request.intelligence, pageContext: request.intelligence.pageContext,
    items: [{
      semantic: {
        fieldRuntimeId: field.fieldRuntimeId, descriptorFingerprint: "a".repeat(64), state: "RESOLVED_HIGH",
        canonicalKey: "EMAIL", confidence: 0.99, resolver: "EXACT_ALIAS", candidates: [], reasonCodes: [], errorCodes: [],
        declarationHint: {
          state: "NOT_DECLARATION", confidence: 0, textEvidence: "UNAVAILABLE", sourceEvidence: [],
          reasonCodes: [], valuePrivate: true, containsCandidateValue: false
        },
        evidence: { alias: 1, fieldType: 1, section: 0, neighbor: 0, attribute: 1, candidateMargin: 1 },
        contextHints: { countryCode: null }, entityBinding: field.repeatableEvidence, valuePrivate: true, containsCandidateValue: false
      },
      answerResolution: {
        status: "RESOLVED", canonicalKey: "EMAIL", answerVersionId: crypto.randomUUID(),
        normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "STRING", value: "candidate@example.test" },
        scope: { scopeType: "GLOBAL", scopeKey: "scope=GLOBAL", scopeFingerprint: createHash("sha256").update("scope=GLOBAL").digest("hex"), precedence: 100 },
        trustState: "TRUSTED", trialReuse: false, requiresUserReview: false, autofillMode: "AUTO",
        expiresAt: null, reasonCodes: ["BEST_COMPATIBLE_SCOPE", "ANSWER_HAS_NO_EXPIRY"], candidateVersionIds: []
      }
    }], aiRequests: 0, cacheHits: 0, durationMs: 1
  };
  const intelligence = { resolvePrivate: async () => privateResult } as unknown as Pick<FieldIntelligenceService, "resolvePrivate">;
  const result = await new ExecutionPlanningService(intelligence).plan({ accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request });
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0]?.canonicalKey, "EMAIL");
  assert.equal(result.operations[0]?.representation.kind, "TEXT");
  assert.equal(result.containsCandidateValue, true);
  const question={version:1 as const,questionId:field.fieldRuntimeId,pageInstanceId,formInstanceId:field.formInstanceId,treeScopeId:"tree:12345",kind:"SINGLE_CONTROL" as const,memberIds:["member:12345"],memberCount:1,membershipComplete:true,containsCandidateValue:false as const};
  for(const changed of [{...question,questionId:"field:wrong"},{...question,pageInstanceId:crypto.randomUUID()},{...question,formInstanceId:"form:wrong"},{...question,kind:"SINGLE_CHOICE" as const},{...question,kind:"SINGLE_CHOICE" as const,memberCount:105,membershipComplete:false}]){
    const blocked=await new ExecutionPlanningService(intelligence).plan({accountId:crypto.randomUUID(),candidateId:crypto.randomUUID(),request:{...request,intelligence:{...request.intelligence,fields:[{...field,question:changed}]}}});
    assert.equal(blocked.operations.length,0);assert.equal(blocked.skipped[0]?.reason,"QUESTION_CONTRACT_INVALID");
  }
  const compatible=await new ExecutionPlanningService(intelligence).plan({accountId:crypto.randomUUID(),candidateId:crypto.randomUUID(),request:{...request,intelligence:{...request.intelligence,fields:[{...field,question}]}}});assert.equal(compatible.operations.length,1);
});

test("R8 J semantics drive R selection while K receives an exact file operation", async () => {
  for (const canonicalKey of ["RESUME", "COVER_LETTER"] as const) {
    const applicationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const fileField: FieldEvidenceInput = {
      ...field, controlType: "FILE", labelEvidence: [canonicalKey === "RESUME" ? "Upload CV" : "Cover letter"],
      locatorEvidence: { ...field.locatorEvidence, type: "file", autocomplete: null }
    };
    const fileRequest: ExecutionPlanRequest = {
      ...request,
      intelligence: {
        ...request.intelligence,
        pageContext: { ...request.intelligence.pageContext, applicationId, jobId },
        fields: [fileField]
      }
    };
    const privateResult: PrivateFieldIntelligenceResult = {
      request: fileRequest.intelligence,
      pageContext: fileRequest.intelligence.pageContext,
      items: [{
        semantic: {
          fieldRuntimeId: fileField.fieldRuntimeId, descriptorFingerprint: "f".repeat(64), state: "RESOLVED_HIGH",
          canonicalKey, confidence: 0.99, resolver: "EXACT_ALIAS", candidates: [], reasonCodes: [], errorCodes: [],
          declarationHint: { state: "NOT_DECLARATION", confidence: 0, textEvidence: "UNAVAILABLE", sourceEvidence: [], reasonCodes: [], valuePrivate: true, containsCandidateValue: false },
          evidence: { alias: 1, fieldType: 1, section: 0, neighbor: 0, attribute: 1, candidateMargin: 1 },
          contextHints: { countryCode: null }, entityBinding: fileField.repeatableEvidence,
          valuePrivate: true, containsCandidateValue: false
        },
        answerResolution: null
      }],
      aiRequests: 0, cacheHits: 0, durationMs: 1
    };
    const calls: string[] = [];
    const planner = new ExecutionPlanningService(
      { resolvePrivate: async () => privateResult } as unknown as Pick<FieldIntelligenceService, "resolvePrivate">,
      undefined,
      undefined,
      { resolve: async (selection) => {
        calls.push(selection.documentKind);
        const bytes = Buffer.from("%PDF-1.7\nfixture\n%%EOF");
        return {
          selectionId: crypto.randomUUID(), documentId: crypto.randomUUID(), documentKind: selection.documentKind,
          fileName: selection.documentKind === "RESUME" ? "resume.pdf" : "cover-letter.pdf",
          mimeType: "application/pdf", byteSize: bytes.byteLength,
          contentSha256: createHash("sha256").update(bytes).digest("hex"), bytesBase64: bytes.toString("base64"),
          // The production onboarding resolver also returns repository metadata.
          // It must never leak into the strict execution representation.
          selectionSource: selection.documentKind === "RESUME" ? "MASTER" : "APPROVED_COVER_LETTER",
          idempotentReplay: false
        };
      } }
    );
    const result = await planner.plan({ accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: fileRequest });
    assert.deepEqual(calls, [canonicalKey]);
    assert.equal(result.operations[0]?.representation.kind, "FILE");
    assert.equal(result.operations[0]?.documentAuthority?.documentKind, canonicalKey);
    assert.equal(result.operations[0]?.answerVersionId, null);
    assert.equal(result.operations[0]?.capabilityHints[0], "FILE_INPUT");
    assert.equal("selectionSource" in (result.operations[0]?.representation ?? {}), false);
    assert.equal("idempotentReplay" in (result.operations[0]?.representation ?? {}), false);
  }
});

test("R8 never substitutes a resume when an approved cover letter is unavailable", async () => {
  const applicationId = crypto.randomUUID();
  const fileField: FieldEvidenceInput = {
    ...field, controlType: "FILE", labelEvidence: ["Cover letter"],
    locatorEvidence: { ...field.locatorEvidence, type: "file", autocomplete: null }
  };
  const fileRequest: ExecutionPlanRequest = {
    ...request,
    intelligence: { ...request.intelligence, pageContext: { ...request.intelligence.pageContext, applicationId, jobId: crypto.randomUUID() }, fields: [fileField] }
  };
  const privateResult: PrivateFieldIntelligenceResult = {
    request: fileRequest.intelligence, pageContext: fileRequest.intelligence.pageContext,
    items: [{ semantic: {
      fieldRuntimeId: fileField.fieldRuntimeId, descriptorFingerprint: "f".repeat(64), state: "RESOLVED_HIGH", canonicalKey: "COVER_LETTER",
      confidence: 0.99, resolver: "EXACT_ALIAS", candidates: [], reasonCodes: [], errorCodes: [],
      declarationHint: { state: "NOT_DECLARATION", confidence: 0, textEvidence: "UNAVAILABLE", sourceEvidence: [], reasonCodes: [], valuePrivate: true, containsCandidateValue: false },
      evidence: { alias: 1, fieldType: 1, section: 0, neighbor: 0, attribute: 1, candidateMargin: 1 }, contextHints: { countryCode: null },
      entityBinding: fileField.repeatableEvidence, valuePrivate: true, containsCandidateValue: false
    }, answerResolution: null }], aiRequests: 0, cacheHits: 0, durationMs: 1
  };
  const planner = new ExecutionPlanningService(
    { resolvePrivate: async () => privateResult } as unknown as Pick<FieldIntelligenceService, "resolvePrivate">,
    undefined, undefined, { resolve: async () => null }
  );
  const result = await planner.plan({ accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: fileRequest });
  assert.equal(result.operations.length, 0);
  assert.equal(result.skipped[0]?.reason, "DOCUMENT_NOT_READY");
});

test("plan request rejects caller supplied canonical, selector and answer values", () => {
  const unsafe = structuredClone(request) as unknown as { intelligence: { fields: Array<Record<string, unknown>> } };
  Object.assign(unsafe.intelligence.fields[0] ?? {}, { canonicalKey: "EMAIL", selector: "#email", value: "private" });
  assert.equal(ExecutionPlanRequestSchema.safeParse(unsafe).success, false);
});

test("planner authorizes Add Another only when M reports an unbound entity", async () => {
  const completed = { ...graphNode, state: "COMPLETED" as const };
  const action: FormGraphNode = {
    ...graphNode,
    graphNodeId: createGraphNodeId("ACTION", `${pageInstanceId}:add-employment`),
    nodeType: "ACTION",
    logicalFingerprint: formGraphHash("add-employment"),
    fieldRuntimeId: null,
    controlFingerprint: null,
    actionKind: "ADD_REPEAT",
    semanticRole: "EMPLOYMENT",
    state: "REACHABLE",
    required: false
  };
  const actionGraph = reconcileFormGraph(null, {
    schemaVersion: 1, observationId: crypto.randomUUID(), applicationRunId, pageInstanceId,
    routeFingerprint: formGraphHash("/apply"), observedAt: new Date().toISOString(), nodes: [completed, action], edges: [],
    source: "INITIAL_SCAN", valuePrivate: true, containsCandidateValue: false
  }).graph;
  const privateResult: PrivateFieldIntelligenceResult = {
    request: request.intelligence,
    pageContext: request.intelligence.pageContext,
    items: [{
      semantic: {
        fieldRuntimeId: field.fieldRuntimeId, descriptorFingerprint: "a".repeat(64), state: "RESOLVED_HIGH",
        canonicalKey: "EMAIL", confidence: 1, resolver: "EXACT_ALIAS", candidates: [], reasonCodes: [], errorCodes: [],
        declarationHint: {
          state: "NOT_DECLARATION", confidence: 0, textEvidence: "UNAVAILABLE", sourceEvidence: [],
          reasonCodes: [], valuePrivate: true, containsCandidateValue: false
        },
        evidence: { alias: 1, fieldType: 1, section: 0, neighbor: 0, attribute: 1, candidateMargin: 1 },
        contextHints: { countryCode: null }, entityBinding: field.repeatableEvidence, valuePrivate: true, containsCandidateValue: false
      },
      answerResolution: null
    }],
    aiRequests: 0, cacheHits: 0, durationMs: 1,
    repeatableCapacity: [{ entityType: "EMPLOYMENT", activeCount: 2, boundCount: 1, remainingCount: 1 }]
  };
  const intelligence = { resolvePrivate: async () => privateResult } as unknown as Pick<FieldIntelligenceService, "resolvePrivate">;
  const result = await new ExecutionPlanningService(intelligence).plan({
    accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: { ...request, graph: actionGraph }
  });
  assert.equal(result.operations.length, 0);
  assert.equal(result.actions[0]?.actionKind, "ADD_REPEAT");
  assert.equal(result.actions[0]?.authorization, "AUTO_SAFE");
});

test("planner prepares only high-confidence accuracy and privacy acknowledgements for final review", async () => {
  for (const canonicalKey of ["CERTIFY_INFORMATION_ACCURATE", "PRIVACY_ACKNOWLEDGEMENT"]) {
    const fixture = declarationFixture({ canonicalKey, label: canonicalKey, required: false });
    const result = await new ExecutionPlanningService(fixture.intelligence).plan({
      accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: fixture.declarationRequest
    });
    assert.equal(result.operations.length, 1);
    assert.equal(result.operations[0]?.canonicalKey, canonicalKey);
    assert.equal(result.operations[0]?.representation.kind, "BOOLEAN");
    assert.equal(result.operations[0]?.authorization, "REVIEW_REQUIRED");
    assert.equal(result.operations[0]?.answerVersionId, null);
    assert.equal(result.operations[0]?.declarationAuthorization?.policyDecision, "PREPARE_FOR_REVIEW");
    assert.equal(result.declarations[0]?.policyVersion, "O1-2026-09");
  }
});

test("required, sensitive, local-only and ambiguous declarations never escalate to execution", async () => {
  const cases = [
    { canonicalKey: "TERMS_ACKNOWLEDGEMENT", label: "I accept the terms", reason: "DECLARATION_USER_ACTION_REQUIRED" },
    { canonicalKey: "BACKGROUND_CHECK_AUTHORIZATION", label: "I authorize a background check", reason: "DECLARATION_USER_ACTION_REQUIRED" },
    { canonicalKey: "DATA_PROCESSING_CONSENT", label: "I consent to processing my data", reason: "DECLARATION_USER_ACTION_REQUIRED" },
    { canonicalKey: null, label: "I agree", hintState: "DECLARATION_LIKE" as const, textEvidence: "PARTIAL" as const, reason: "DECLARATION_UNRESOLVED" }
  ];
  for (const declaration of cases) {
    const fixture = declarationFixture({ ...declaration, required: true });
    const result = await new ExecutionPlanningService(fixture.intelligence).plan({
      accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: fixture.declarationRequest
    });
    assert.equal(result.operations.length, 0);
    assert.equal(result.skipped[0]?.reason, declaration.reason);
  }
});

test("generic execution strategies cannot bypass declaration policy authority", () => {
  const ordinary = {
    schemaVersion: 1, operationId: crypto.randomUUID(), applicationRunId, pageInstanceId,
    formInstanceId: field.formInstanceId, fieldRuntimeId: field.fieldRuntimeId, graphNodeId: graphNode.graphNodeId,
    graphGuard: { pageInstanceId, graphRevision: graph.graphRevision, graphFingerprint: graph.graphFingerprint },
    controlFingerprint: field.controlFingerprint, canonicalKey: "TERMS_ACKNOWLEDGEMENT",
    answerVersionId: crypto.randomUUID(), answerScopeFingerprint: "e".repeat(64), trialReuse: false,
    semanticControlType: "CHECKBOX", capabilityHints: ["NATIVE_CHECKBOX"],
    representation: { representationId: "BOOLEAN@1", policyVersion: 1, sourceKind: "BOOLEAN", containsCandidateValue: true, kind: "BOOLEAN", checked: true },
    authorization: "AUTO", declarationAuthorization: null, maximumAttempts: 2
  };
  assert.equal(ExecutionRequestSchema.safeParse(ordinary).success, false);
});

test("ordinary non-declaration checkboxes still use Candidate Truth normally", async () => {
  const checkbox: FieldEvidenceInput = {
    ...field, controlType: "CHECKBOX", labelEvidence: ["I am at least 18 years old"],
    locatorEvidence: { ...field.locatorEvidence, type: "checkbox", autocomplete: null }
  };
  const checkboxRequest: ExecutionPlanRequest = {
    ...request,
    intelligence: { ...request.intelligence, fields: [checkbox] }
  };
  const privateResult: PrivateFieldIntelligenceResult = {
    request: checkboxRequest.intelligence, pageContext: checkboxRequest.intelligence.pageContext,
    items: [{
      semantic: {
        fieldRuntimeId: checkbox.fieldRuntimeId, descriptorFingerprint: "f".repeat(64), state: "RESOLVED_HIGH",
        canonicalKey: "AGE_OVER_18", confidence: 0.99, resolver: "EXACT_ALIAS", candidates: [], reasonCodes: [], errorCodes: [],
        declarationHint: { state: "NOT_DECLARATION", confidence: 0, textEvidence: "UNAVAILABLE", sourceEvidence: [], reasonCodes: [], valuePrivate: true, containsCandidateValue: false },
        evidence: { alias: 1, fieldType: 1, section: 0, neighbor: 0, attribute: 1, candidateMargin: 1 },
        contextHints: { countryCode: null }, entityBinding: checkbox.repeatableEvidence, valuePrivate: true, containsCandidateValue: false
      },
      answerResolution: {
        status: "RESOLVED", canonicalKey: "AGE_OVER_18", answerVersionId: crypto.randomUUID(),
        normalizedValue: { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE", kind: "BOOLEAN", value: true },
        scope: { scopeType: "GLOBAL", scopeKey: "scope=GLOBAL", scopeFingerprint: createHash("sha256").update("scope=GLOBAL").digest("hex"), precedence: 100 },
        trustState: "TRUSTED", trialReuse: false, requiresUserReview: false, autofillMode: "AUTO",
        expiresAt: null, reasonCodes: ["BEST_COMPATIBLE_SCOPE"], candidateVersionIds: []
      }
    }], aiRequests: 0, cacheHits: 0, durationMs: 1
  };
  const intelligence = { resolvePrivate: async () => privateResult } as unknown as Pick<FieldIntelligenceService, "resolvePrivate">;
  const result = await new ExecutionPlanningService(intelligence).plan({ accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: checkboxRequest });
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0]?.canonicalKey, "AGE_OVER_18");
  assert.equal(result.operations[0]?.declarationAuthorization, null);
});
test("plan explains completed controls and conditional immediate-only questions", async () => {
  for (const scenario of ["COMPLETED", "NOT_APPLICABLE"] as const) {
    const fixture = declarationFixture({ canonicalKey: scenario === "COMPLETED" ? "EMAIL" : "LAST_WORKING_DAY", label: scenario === "COMPLETED" ? "Email" : "If available immediately, what was your last working day?" });
    const input = { accountId: crypto.randomUUID(), candidateId: crypto.randomUUID(), request: fixture.declarationRequest.intelligence };
    const privateResult = await fixture.intelligence.resolvePrivate(input);
    privateResult.items[0]!.semantic.declarationHint = { state: "NOT_DECLARATION", confidence: 1, textEvidence: "UNAVAILABLE", sourceEvidence: [], reasonCodes: [], valuePrivate: true, containsCandidateValue: false };
    privateResult.noticePeriodDays = 30;
    const current = fixture.declarationRequest;
    const changed = { ...current, graph: { ...current.graph, nodes: current.graph.nodes.map((node) => scenario === "COMPLETED" ? { ...node, state: "COMPLETED" as const } : node) } };
    const plan = await new ExecutionPlanningService({ resolvePrivate: async () => privateResult }).plan({ accountId: input.accountId, candidateId: input.candidateId, request: changed });
    assert.equal(plan.operations.length, 0);
    assert.equal(plan.skipped[0]?.reason, scenario === "COMPLETED" ? "ALREADY_COMPLETED" : "NOT_APPLICABLE");
  }
});
