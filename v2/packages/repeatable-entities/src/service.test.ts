import assert from "node:assert/strict";
import test from "node:test";
import { FieldSemanticResolutionSchema, FormRepeatGroupEvidenceSchema, type EntityBindingReceipt } from "@job-hunter-v2/contracts";
import type { CandidateEntityDescriptor, CandidateEntityLifecycleResult, CandidateEntityReorderResult, RepeatableEntityRepository, StoredEntityBinding } from "./service.js";
import { RepeatableEntityIntelligenceService } from "./service.js";

const candidateId = "10000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000002";
const runId = "10000000-0000-4000-8000-000000000003";
const pageId = "10000000-0000-4000-8000-000000000004";
const entityA = "10000000-0000-4000-8000-000000000005";
const entityB = "10000000-0000-4000-8000-000000000006";

function descriptor(id: string, rank: number): CandidateEntityDescriptor {
  return {
    candidateEntityId: id, entityType: "EMPLOYMENT", entityVersion: 1,
    entityRevision: "a".repeat(64), status: "ACTIVE", displayOrder: rank, recencyRank: rank,
    canonicalCoverage: ["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE"], privateValueFingerprints: []
  };
}

class MemoryRepository implements RepeatableEntityRepository {
  bindings = new Map<string, StoredEntityBinding>();
  constructor(readonly entities: CandidateEntityDescriptor[]) {}
  async invalidateBindingsExcept(): Promise<void> {}
  async listCandidateEntities(): Promise<readonly CandidateEntityDescriptor[]> { return this.entities; }
  async findBinding(input: { formRepeatGroupId: string }): Promise<StoredEntityBinding | null> { return this.bindings.get(input.formRepeatGroupId) ?? null; }
  async saveBinding(input: { group: { formRepeatGroupId: string; structuralFingerprint: string }; receipt: EntityBindingReceipt }): Promise<EntityBindingReceipt> {
    this.bindings.set(input.group.formRepeatGroupId, { receipt: input.receipt, structuralFingerprint: input.group.structuralFingerprint });
    return input.receipt;
  }
  async mutateEntity(): Promise<CandidateEntityLifecycleResult> { throw new Error("not used"); }
  async reorderEntities(): Promise<CandidateEntityReorderResult> { throw new Error("not used"); }
}

function group(options: { identity?: "STABLE_DOM" | "ORDINAL_ONLY"; role?: "CURRENT" | "OTHER"; key?: string } = {}) {
  return FormRepeatGroupEvidenceSchema.parse({
    schemaVersion: 1, formRepeatGroupId: options.key ?? "repeat:group-a",
    identityKind: options.identity ?? "STABLE_DOM", stableGroupKey: "employment-alpha",
    structuralFingerprint: "b".repeat(64), entityType: "EMPLOYMENT",
    semanticRole: options.role ?? "OTHER", ordinalHint: 0, groupLabel: "Employment"
  });
}

function semantic() {
  return FieldSemanticResolutionSchema.parse({
    fieldRuntimeId: "field:employment-company", descriptorFingerprint: "c".repeat(64),
    state: "RESOLVED_HIGH", canonicalKey: "EMPLOYMENT_COMPANY", confidence: 0.98,
    resolver: "EXACT_ALIAS", candidates: [], reasonCodes: [], errorCodes: [],
    declarationHint: {
      state: "NOT_DECLARATION", confidence: 0, textEvidence: "UNAVAILABLE", sourceEvidence: [],
      reasonCodes: [], valuePrivate: true, containsCandidateValue: false
    },
    evidence: { alias: 1, fieldType: 1, section: 1, neighbor: 0, attribute: 0, candidateMargin: 1 },
    contextHints: { countryCode: null },
    entityBinding: { entityType: "EMPLOYMENT", bindingKind: "DOM_STABLE_KEY", instanceKey: "employment-alpha", candidateEntityId: null, ordinalHint: null, groupLabel: "Employment" },
    valuePrivate: true, containsCandidateValue: false
  });
}

async function bind(service: RepeatableEntityIntelligenceService, repeatGroup = group()) {
  return service.bind({
    accountId, candidateId, applicationRunId: runId, pageInstanceId: pageId,
    fields: [{ fieldRuntimeId: "field:employment-company", formInstanceId: "form:employment", group: repeatGroup, semantic: semantic() }]
  });
}

test("a sole active entity binds without relying on a form or profile index", async () => {
  const result = await bind(new RepeatableEntityIntelligenceService(new MemoryRepository([descriptor(entityA, 0)])));
  const receipt = result.byFieldRuntimeId.get("field:employment-company");
  assert.equal(receipt?.state, "BOUND_HIGH");
  assert.equal(receipt?.candidateEntityId, entityA);
  assert.ok(receipt?.evidenceCategories.includes("UNIQUE_ENTITY_OF_TYPE"));
  assert.ok(!receipt?.evidenceCategories.includes("POSITIONAL_ASSIGNMENT"));
});

test("ordinal-only repeated groups never authoritatively bind multiple entities", async () => {
  const result = await bind(
    new RepeatableEntityIntelligenceService(new MemoryRepository([descriptor(entityA, 0), descriptor(entityB, 1)])),
    group({ identity: "ORDINAL_ONLY", role: "CURRENT" })
  );
  const receipt = result.byFieldRuntimeId.get("field:employment-company");
  assert.equal(receipt?.state, "AMBIGUOUS");
  assert.equal(receipt?.candidateEntityId, null);
  assert.ok(receipt?.errorCodes.includes("ORDINAL_ONLY_NOT_AUTHORITATIVE"));
});

test("an explicit semantic role binds independently of candidate array order", async () => {
  const repository = new MemoryRepository([descriptor(entityB, 1), descriptor(entityA, 0)]);
  const result = await bind(new RepeatableEntityIntelligenceService(repository), group({ role: "CURRENT" }));
  assert.equal(result.byFieldRuntimeId.get("field:employment-company")?.candidateEntityId, entityA);
});

test("AI cannot invent an entity outside the bounded candidate list", async () => {
  const service = new RepeatableEntityIntelligenceService(
    new MemoryRepository([descriptor(entityA, 0), descriptor(entityB, 1)]),
    { resolve: async () => ({ selectedCandidateEntityId: "10000000-0000-4000-8000-000000000099", confidence: 0.99, ambiguous: false, reasonCategory: "ROLE_MATCH" }) }
  );
  const result = await bind(service);
  assert.equal(result.byFieldRuntimeId.get("field:employment-company")?.state, "AMBIGUOUS");
  assert.equal(result.byFieldRuntimeId.get("field:employment-company")?.candidateEntityId, null);
});

test("a verified binding survives descriptor ordering through its stable identity", async () => {
  const repository = new MemoryRepository([descriptor(entityB, 0), descriptor(entityA, 1)]);
  const repeatGroup = group();
  repository.bindings.set(repeatGroup.formRepeatGroupId, {
    structuralFingerprint: repeatGroup.structuralFingerprint,
    receipt: {
      schemaVersion: 1, formRepeatGroupId: repeatGroup.formRepeatGroupId, entityType: "EMPLOYMENT",
      state: "BOUND_HIGH", candidateEntityId: entityA, candidateEntityVersion: 1,
      candidateEntityRevision: "a".repeat(64), bindingVersion: 1, confidence: 0.98,
      confidenceBucket: "HIGH", evidenceCategories: ["PRIOR_VERIFIED_BINDING"], reasonCodes: ["ENTITY_BINDING_DETERMINISTIC_HIGH"],
      errorCodes: [], valuePrivate: true, containsCandidateValue: false
    }
  });
  const result = await bind(new RepeatableEntityIntelligenceService(repository), repeatGroup);
  assert.equal(result.byFieldRuntimeId.get("field:employment-company")?.candidateEntityId, entityA);
});
