import type {
  CandidateConfirmationService,
  CandidateProfileService,
  CandidateSessionAuthenticator,
  ManualCandidateAnswer,
  ProposalReviewDecision,
  ResumeOnboardingService,
  DocumentIntelligenceService,
  DocumentGenerationService
  ,GeneratedDocumentDraft
} from "@job-hunter-v2/onboarding";
import { ValidationError } from "@job-hunter-v2/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface PhaseGApiServices {
  sessions: CandidateSessionAuthenticator;
  resumes?: Pick<ResumeOnboardingService, "upload" | "extract" | "getReview">;
  confirmations?: Pick<CandidateConfirmationService, "confirm">;
  profiles?: Pick<CandidateProfileService, "get" | "save" | "history" | "readiness" | "complete" | "undo" | "restore" | "reversalHistory">;
  documents?: Pick<DocumentIntelligenceService, "list" | "download">;
  generation?: Pick<DocumentGenerationService, "generate" | "approve"> & Partial<Pick<DocumentGenerationService, "editable" | "revise">>;
}

const sessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "account", "candidate", "onboarding"],
  properties: {
    email: { anyOf: [{ type: "string", format: "email" }, { type: "null" }] },
    account: {
      type: "object",
      additionalProperties: false,
      required: ["type", "role"],
      properties: {
        type: { enum: ["NORMAL", "TEST", "INTERNAL"] },
        role: { enum: ["OWNER", "ADMIN", "MEMBER"] }
      }
    },
    candidate: {
      type: "object",
      additionalProperties: false,
      required: ["id", "new"],
      properties: {
        id: { type: "string", format: "uuid" },
        new: { type: "boolean" }
      }
    },
    onboarding: {
      type: "object",
      additionalProperties: false,
      required: ["stage", "completed", "version", "startedAt"],
      properties: {
        stage: { enum: ["WELCOME", "RESUME", "REVIEW", "PROFILE", "READY"] },
        completed: { type: "boolean" },
        version: { type: "integer", minimum: 1 },
        startedAt: { type: "string", format: "date-time" },
        completedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }
      }
    }
  }
} as const;

async function sessionFor(request: FastifyRequest, services: PhaseGApiServices) {
  return services.sessions.authenticate(request.headers.authorization);
}

function publicSession(session: Awaited<ReturnType<typeof sessionFor>>) {
  return {
    email: session.identity.email,
    account: {
      type: session.account.accountType,
      role: session.account.membershipRole
    },
    candidate: {
      id: session.candidate.candidateId,
      new: session.candidate.isNewCandidate
    },
    onboarding: {
      stage: session.candidate.stage,
      completed: session.candidate.completed,
      version: session.candidate.version,
      startedAt: session.candidate.startedAt.toISOString(),
      completedAt: session.candidate.completedAt?.toISOString() ?? null
    }
  };
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["x-idempotency-key"];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("An X-Idempotency-Key header is required.");
  }
  return value;
}

function publicReview(review: Awaited<ReturnType<ResumeOnboardingService["getReview"]>>) {
  return {
    document: {
      id: review.document.documentId,
      fileName: review.document.originalFileName,
      byteSize: review.document.byteSize,
      mimeType: review.document.mimeType,
      createdAt: review.document.createdAt.toISOString()
    },
    extraction: review.extraction
      ? {
          id: review.extraction.extractionId,
          status: review.extraction.status,
          attempt: review.extraction.attempt,
          errorCode: review.extraction.errorCode,
          startedAt: review.extraction.startedAt.toISOString(),
          completedAt: review.extraction.completedAt?.toISOString() ?? null
        }
      : null,
    proposals: review.proposals.map((proposal) => ({
      id: proposal.proposalId,
      field: proposal.canonicalKey,
      entityType: proposal.entityType,
      entityGroupKey: proposal.entityGroupKey,
      value: proposal.normalizedValue,
      confidence: proposal.confidence,
      comparison: proposal.comparison,
      decision: proposal.decision,
      existingAnswerVersionId: proposal.existingAnswerVersionId,
      sourceSection: proposal.sourceSection
    }))
  };
}

function publicDocument(document: Awaited<ReturnType<DocumentGenerationService["generate"]>>) {
  return {
    id: document.documentId,
    type: document.purpose,
    version: document.documentVersion,
    status: document.status,
    fileName: document.originalFileName,
    mimeType: document.mimeType,
    byteSize: document.byteSize,
    sourceDocumentId: document.sourceDocumentId,
    jobId: document.jobId,
    applicationId: document.applicationId,
    isCurrentMaster: document.isCurrentMaster,
    failureCode: document.failureCode,
    createdAt: document.createdAt.toISOString(),
    readyAt: document.readyAt?.toISOString() ?? null,
    uses: document.applicationUses.map((use) => ({
      applicationId: use.applicationId,
      applicationRunId: use.applicationRunId,
      documentKind: use.documentKind,
      selectedAt: use.selectedAt.toISOString()
    }))
  };
}

export async function registerPhaseGRoutes(
  app: FastifyInstance,
  services: PhaseGApiServices
): Promise<void> {
  const response = { 200: sessionResponseSchema };
  app.post(
    "/v1/auth/bootstrap",
    { schema: { tags: ["authentication", "onboarding"], response } },
    async (request) => publicSession(await sessionFor(request, services))
  );
  app.get(
    "/v1/auth/session",
    { schema: { tags: ["authentication"], response } },
    async (request) => publicSession(await sessionFor(request, services))
  );
  app.post(
    "/v1/auth/logout",
    {
      schema: {
        tags: ["authentication"],
        response: { 204: { type: "null" } }
      }
    },
    async (request, reply) => {
      await sessionFor(request, services);
      return reply.status(204).send();
    }
  );
  app.get(
    "/v1/onboarding",
    { schema: { tags: ["onboarding"], response } },
    async (request) => publicSession(await sessionFor(request, services))
  );

  if (services.resumes) {
    app.post("/v1/onboarding/resume", { schema: { tags: ["onboarding", "resume"] } }, async (request, reply) => {
      const session = await sessionFor(request, services);
      const upload = await request.file();
      if (!upload) throw new ValidationError("Choose a PDF resume to upload.");
      const bytes = await upload.toBuffer();
      const document = await services.resumes!.upload({
        accountId: session.account.accountId,
        candidateId: session.candidate.candidateId,
        fileName: upload.filename,
        mimeType: upload.mimetype,
        bytes,
        idempotencyKey: idempotencyKey(request)
      });
      return reply.status(201).send({
        document: {
          id: document.documentId,
          fileName: document.originalFileName,
          byteSize: document.byteSize,
          mimeType: document.mimeType,
          createdAt: document.createdAt.toISOString()
        }
      });
    });
    app.post<{
      Params: { documentId: string };
    }>(
      "/v1/onboarding/resume/:documentId/extract",
      {
        schema: {
          tags: ["onboarding", "resume"],
          params: {
            type: "object", additionalProperties: false, required: ["documentId"],
            properties: { documentId: { type: "string", format: "uuid" } }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        return publicReview(await services.resumes!.extract({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          documentId: request.params.documentId,
          idempotencyKey: idempotencyKey(request)
        }));
      }
    );
    app.get<{ Querystring: { documentId?: string } }>(
      "/v1/onboarding/resume/review",
      {
        schema: {
          tags: ["onboarding", "resume"],
          querystring: {
            type: "object", additionalProperties: false,
            properties: { documentId: { type: "string", format: "uuid" } }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        return publicReview(await services.resumes!.getReview({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          ...(request.query.documentId ? { documentId: request.query.documentId } : {})
        }));
      }
    );
  }
  if (services.documents) {
    app.get("/v1/documents", { schema: { tags: ["documents"] } }, async (request) => {
      const session = await sessionFor(request, services);
      const documents = await services.documents!.list(session.account.accountId, session.candidate.candidateId);
      return { documents: documents.map((document) => ({
        id: document.documentId,
        type: document.purpose,
        version: document.documentVersion,
        status: document.status,
        fileName: document.originalFileName,
        mimeType: document.mimeType,
        byteSize: document.byteSize,
        sourceDocumentId: document.sourceDocumentId,
        jobId: document.jobId,
        applicationId: document.applicationId,
        isCurrentMaster: document.isCurrentMaster,
        failureCode: document.failureCode,
        createdAt: document.createdAt.toISOString(),
        readyAt: document.readyAt?.toISOString() ?? null,
        uses: document.applicationUses.map((use) => ({
          applicationId: use.applicationId,
          applicationRunId: use.applicationRunId,
          documentKind: use.documentKind,
          selectedAt: use.selectedAt.toISOString()
        }))
      })) };
    });
    app.get<{ Params: { documentId: string } }>(
      "/v1/documents/:documentId/download",
      {
        schema: {
          tags: ["documents"],
          params: { type: "object", additionalProperties: false, required: ["documentId"], properties: { documentId: { type: "string", format: "uuid" } } }
        }
      },
      async (request, reply) => {
        const session = await sessionFor(request, services);
        const result = await services.documents!.download({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          documentId: request.params.documentId
        });
        const safeName = (result.document.originalFileName ?? `document-${result.document.documentVersion}.pdf`)
          .replace(/["\r\n]/g, "_");
        return reply
          .header("content-type", result.document.mimeType)
          .header("content-disposition", `attachment; filename="${safeName}"`)
          .header("cache-control", "private, no-store")
          .send(Buffer.from(result.bytes));
      }
    );
    app.get<{ Params: { documentId: string } }>(
      "/v1/documents/:documentId/preview",
      {
        schema: {
          tags: ["documents"],
          params: { type: "object", additionalProperties: false, required: ["documentId"], properties: { documentId: { type: "string", format: "uuid" } } }
        }
      },
      async (request, reply) => {
        const session = await sessionFor(request, services);
        const result = await services.documents!.download({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          documentId: request.params.documentId
        });
        const safeName = (result.document.originalFileName ?? `document-${result.document.documentVersion}.pdf`)
          .replace(/["\r\n]/g, "_");
        return reply.header("content-type", result.document.mimeType)
          .header("content-disposition", `inline; filename="${safeName}"`)
          .header("cache-control", "private, no-store")
          .send(Buffer.from(result.bytes));
      }
    );
  }
  if (services.generation) {
    if (services.generation.editable && services.generation.revise) {
      const draftParams = { type: "object", required: ["documentId"], properties: { documentId: { type: "string", format: "uuid" } } };
      app.get<{ Params: { documentId: string } }>("/v1/documents/:documentId/draft", { schema: { params: draftParams } }, async (request, reply) => {
        const session = await sessionFor(request, services);
        const draft = await services.generation!.editable!({ accountId: session.account.accountId, candidateId: session.candidate.candidateId, documentId: request.params.documentId });
        return reply.header("cache-control", "private, no-store").send({ draft });
      });
      app.put<{ Params: { documentId: string }; Body: { draft: GeneratedDocumentDraft; template?: "CLASSIC" | "COMPACT" } }>("/v1/documents/:documentId/draft", {
        schema: { params: draftParams, body: { type: "object", additionalProperties: false, required: ["draft"], properties: { draft: { type: "object" }, template: { enum: ["CLASSIC", "COMPACT"] } } } }
      }, async (request, reply) => {
        const session = await sessionFor(request, services);
        const document = await services.generation!.revise!({ accountId: session.account.accountId, candidateId: session.candidate.candidateId,
          documentId: request.params.documentId, draft: request.body.draft, template: request.body.template ?? "CLASSIC", idempotencyKey: idempotencyKey(request) });
        return reply.status(201).send({ document: publicDocument(document) });
      });
    }
    app.post<{
      Body: { jobId: string; applicationId?: string | null; type: "TAILORED_RESUME" | "COVER_LETTER"; strength?: "LIGHT" | "FOCUSED"; template?: "CLASSIC" | "COMPACT" };
    }>(
      "/v1/documents/generate",
      {
        schema: {
          tags: ["documents", "jobs"],
          body: {
            type: "object", additionalProperties: false, required: ["jobId", "type"],
            properties: {
              jobId: { type: "string", format: "uuid" },
              applicationId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
              type: { enum: ["TAILORED_RESUME", "COVER_LETTER"] },
              strength: { enum: ["LIGHT", "FOCUSED"] },
              template: { enum: ["CLASSIC", "COMPACT"] }
            }
          }
        }
      },
      async (request, reply) => {
        const session = await sessionFor(request, services);
        const document = await services.generation!.generate({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          jobId: request.body.jobId,
          applicationId: request.body.applicationId ?? null,
          purpose: request.body.type,
          strength: request.body.strength ?? "LIGHT",
          template: request.body.template ?? "CLASSIC",
          idempotencyKey: idempotencyKey(request)
        });
        return reply.status(201).send({ document: publicDocument(document) });
      }
    );
    app.post<{ Params: { documentId: string } }>(
      "/v1/documents/:documentId/approve",
      {
        schema: {
          tags: ["documents"],
          params: { type: "object", additionalProperties: false, required: ["documentId"], properties: { documentId: { type: "string", format: "uuid" } } }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        const approved = await services.generation!.approve({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          documentId: request.params.documentId,
          idempotencyKey: idempotencyKey(request)
        });
        return { document: publicDocument(approved.document), replay: approved.idempotentReplay };
      }
    );
  }
  if (services.confirmations) {
    app.post<{
      Body: {
        documentId?: string;
        decisions: ProposalReviewDecision[];
        manualAnswers?: ManualCandidateAnswer[];
      };
    }>(
      "/v1/onboarding/review/confirm",
      {
        schema: {
          tags: ["onboarding", "profile"],
          body: {
            type: "object", additionalProperties: false, required: ["decisions"],
            properties: {
              documentId: { type: "string", format: "uuid" },
              decisions: { type: "array", maxItems: 50, items: { type: "object" } },
              manualAnswers: { type: "array", maxItems: 50, items: { type: "object" } }
            }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        const result = await services.confirmations!.confirm({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          ...(request.body.documentId ? { documentId: request.body.documentId } : {}),
          decisions: request.body.decisions,
          ...(request.body.manualAnswers ? { manualAnswers: request.body.manualAnswers } : {}),
          idempotencyKey: idempotencyKey(request)
        });
        return {
          changeSetId: result.changeSetId,
          accepted: result.accepted,
          corrected: result.corrected,
          removed: result.removed,
          skipped: result.skipped,
          unchangedMatches: result.unchangedMatches,
          replay: result.idempotentReplay,
          savedAt: result.createdAt.toISOString()
        };
      }
    );
  }
  if (services.profiles) {
    app.get("/v1/profile", { schema: { tags: ["profile"] } }, async (request) => {
      const session = await sessionFor(request, services);
      return services.profiles!.get(session.account.accountId, session.candidate.candidateId);
    });
    app.put<{ Body: { items: Parameters<CandidateProfileService["save"]>[0]["items"] } }>(
      "/v1/profile",
      {
        schema: {
          tags: ["profile"],
          body: {
            type: "object", additionalProperties: false, required: ["items"],
            properties: { items: { type: "array", minItems: 1, maxItems: 50, items: { type: "object" } } }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        const saved = await services.profiles!.save({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          items: request.body.items,
          idempotencyKey: idempotencyKey(request)
        });
        return { changeSetId: saved.changeSetId, fields: saved.items, replay: saved.idempotentReplay };
      }
    );
    app.get<{ Querystring: { field?: string; entityId?: string; limit?: number } }>(
      "/v1/profile/history",
      {
        schema: {
          tags: ["profile"],
          querystring: {
            type: "object", additionalProperties: false,
            properties: {
              field: { type: "string", minLength: 1, maxLength: 140 },
              entityId: { type: "string", format: "uuid" },
              limit: { type: "integer", minimum: 1, maximum: 100 }
            }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        return {
          entries: await services.profiles!.history({
            accountId: session.account.accountId,
            candidateId: session.candidate.candidateId,
            ...(request.query.field ? { canonicalKey: request.query.field } : {}),
            ...(request.query.entityId ? { entityId: request.query.entityId } : {}),
            ...(request.query.limit ? { limit: request.query.limit } : {})
          })
        };
      }
    );
    app.get("/v1/onboarding/readiness", { schema: { tags: ["onboarding", "profile"] } }, async (request) => {
      const session = await sessionFor(request, services);
      return services.profiles!.readiness(session.account.accountId, session.candidate.candidateId);
    });
    app.post<{ Body: { expectedOnboardingVersion: number } }>(
      "/v1/onboarding/complete",
      {
        schema: {
          tags: ["onboarding"],
          body: {
            type: "object", additionalProperties: false, required: ["expectedOnboardingVersion"],
            properties: { expectedOnboardingVersion: { type: "integer", minimum: 1 } }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        return services.profiles!.complete({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          expectedOnboardingVersion: request.body.expectedOnboardingVersion,
          idempotencyKey: idempotencyKey(request)
        });
      }
    );
    app.post<{ Params: { changeSetId: string } }>(
      "/v1/profile/changes/:changeSetId/undo",
      {
        schema: {
          tags: ["profile"],
          params: {
            type: "object", additionalProperties: false, required: ["changeSetId"],
            properties: { changeSetId: { type: "string", format: "uuid" } }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        return services.profiles!.undo({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          changeSetId: request.params.changeSetId,
          idempotencyKey: idempotencyKey(request)
        });
      }
    );
    app.post<{
      Params: { versionId: string };
      Body: { expectedCurrentVersionId: string | null };
    }>(
      "/v1/profile/versions/:versionId/restore",
      {
        schema: {
          tags: ["profile"],
          params: {
            type: "object", additionalProperties: false, required: ["versionId"],
            properties: { versionId: { type: "string", format: "uuid" } }
          },
          body: {
            type: "object", additionalProperties: false, required: ["expectedCurrentVersionId"],
            properties: {
              expectedCurrentVersionId: {
                anyOf: [{ type: "string", format: "uuid" }, { type: "null" }]
              }
            }
          }
        }
      },
      async (request) => {
        const session = await sessionFor(request, services);
        return services.profiles!.restore({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId,
          versionId: request.params.versionId,
          expectedCurrentVersionId: request.body.expectedCurrentVersionId,
          idempotencyKey: idempotencyKey(request)
        });
      }
    );
    app.get("/v1/profile/reversals", { schema: { tags: ["profile"] } }, async (request) => {
      const session = await sessionFor(request, services);
      return {
        reversals: await services.profiles!.reversalHistory({
          accountId: session.account.accountId,
          candidateId: session.candidate.candidateId
        })
      };
    });
  }
}
