import { createHash, randomUUID } from "node:crypto";
import {
  DECLARATION_POLICY_VERSION,
  DeclarationReviewItemSchema,
  RecordDeclarationEvidenceRequestSchema,
  RecordDeclarationEvidenceResponseSchema,
  type DeclarationContext,
  type DeclarationPolicyDecision,
  type DeclarationReviewItem,
  type RecordDeclarationEvidenceRequest
} from "@job-hunter-v2/contracts";
import { DeclarationPolicyEngine } from "./policy.js";

export interface DeclarationEvidenceCommand {
  accountId: string;
  candidateId: string;
  request: RecordDeclarationEvidenceRequest;
  idempotencyKey: string;
  requestFingerprint: string;
  recordedAt: Date;
}

export interface DeclarationEvidenceRepository {
  record(command: DeclarationEvidenceCommand): Promise<{ evidenceId: string; idempotentReplay: boolean }>;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class DeclarationPolicyService {
  constructor(
    private readonly engine = new DeclarationPolicyEngine(),
    private readonly repository: DeclarationEvidenceRepository | null = null,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID
  ) {}

  async evaluate(input: {
    accountId: string;
    candidateId: string;
    context: DeclarationContext;
  }): Promise<{ decision: DeclarationPolicyDecision; reviewItem: DeclarationReviewItem }> {
    const decision = this.engine.decide(input.context);
    const reviewItem = DeclarationReviewItemSchema.parse(this.engine.reviewItem(input.context, decision));
    if (this.repository && input.context.applicationId) {
      const occurredAt = this.now();
      const request = RecordDeclarationEvidenceRequestSchema.parse({
        schemaVersion: 1,
        requestId: this.newId(),
        evidenceEventId: this.newId(),
        applicationId: input.context.applicationId,
        applicationRunId: input.context.applicationRunId,
        pageInstanceId: input.context.pageInstanceId,
        formInstanceId: input.context.formInstanceId,
        fieldRuntimeId: input.context.fieldRuntimeId,
        controlFingerprint: input.context.controlFingerprint,
        descriptorFingerprint: input.context.semantic.descriptorFingerprint,
        graphGuard: input.context.graphGuard,
        declarationType: decision.classification.declarationType,
        semanticConfidence: decision.classification.semanticConfidence,
        policyVersion: DECLARATION_POLICY_VERSION,
        policyDecision: decision.outcome,
        decisionFingerprint: decision.decisionFingerprint,
        eventType: "POLICY_DECIDED",
        actionOrigin: "POLICY_ENGINE",
        operationId: null,
        executionStatus: null,
        verificationStatus: null,
        failureCode: decision.failureCode,
        required: input.context.required,
        candidateModified: false,
        finalReviewState: "NOT_PRESENTED",
        checkpointId: null,
        occurredAt: occurredAt.toISOString(),
        valuePrivate: true,
        containsCandidateValue: false
      });
      await this.repository.record({
        accountId: input.accountId,
        candidateId: input.candidateId,
        request,
        idempotencyKey: `decision:${decision.decisionFingerprint}`,
        requestFingerprint: fingerprint({ candidateId: input.candidateId, request: { ...request, requestId: null, evidenceEventId: null } }),
        recordedAt: occurredAt
      });
    }
    return { decision, reviewItem };
  }

  async recordEvidence(input: {
    accountId: string;
    candidateId: string;
    request: RecordDeclarationEvidenceRequest;
  }) {
    const request = RecordDeclarationEvidenceRequestSchema.parse(input.request);
    const result = this.repository
      ? await this.repository.record({
          accountId: input.accountId,
          candidateId: input.candidateId,
          request,
          idempotencyKey: `event:${request.evidenceEventId}`,
          requestFingerprint: fingerprint({ candidateId: input.candidateId, request }),
          recordedAt: this.now()
        })
      : { evidenceId: request.evidenceEventId, idempotentReplay: false };
    return RecordDeclarationEvidenceResponseSchema.parse({
      schemaVersion: 1,
      requestId: request.requestId,
      ...result,
      valuePrivate: true,
      containsCandidateValue: false
    });
  }
}
