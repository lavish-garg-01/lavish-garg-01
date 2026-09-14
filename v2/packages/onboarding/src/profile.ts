import { createHash, randomUUID } from "node:crypto";
import {
  candidateAnswerPolicy,
  evaluateAnswerFreshness,
  type AnswerFreshness,
  type CandidateAnswerInputSource,
  type CandidateAnswerTrustState,
  type CandidateScopeContext,
  type CandidateTruthService,
  type EntityType,
  type PersistableNormalizedValue,
  type ScopeType
} from "@job-hunter-v2/candidate-truth";
import { UuidSchema } from "@job-hunter-v2/contracts";
import { ConflictError, ValidationError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import type { CandidateConfirmationRepository } from "./confirmation.js";

export interface CandidateProfileAnswer {
  answerVersionId: string;
  changeSetId: string;
  canonicalKey: string;
  label: string;
  section: string;
  entityId: string | null;
  entityType: EntityType | null;
  scopeType: ScopeType;
  scope: CandidateScopeContext;
  normalizedValue: PersistableNormalizedValue;
  trustState: CandidateAnswerTrustState;
  source: CandidateAnswerInputSource | "USER_ACCEPTED_REUSE" | "USER_UNDO" | "USER_RESTORE";
  confirmedAt: Date | null;
  createdAt: Date;
  freshness: AnswerFreshness;
}

export interface CandidateProfileHistoryEntry extends Omit<CandidateProfileAnswer, "freshness"> {
  current: boolean;
  supersedesVersionId: string | null;
  restoresVersionId: string | null;
}

export interface CandidateProfileSnapshot {
  candidateId: string;
  answers: readonly CandidateProfileAnswer[];
  pendingResumeItems: number;
  conflictingResumeItems: number;
  onboardingVersion: number;
  onboardingCompleted: boolean;
}

export interface CandidateProfileRepository {
  getSnapshot(input: { accountId: string; candidateId: string; evaluatedAt: Date }): Promise<CandidateProfileSnapshot>;
  listHistory(input: {
    accountId: string;
    candidateId: string;
    canonicalKey?: string;
    entityId?: string | null;
    limit: number;
  }): Promise<readonly CandidateProfileHistoryEntry[]>;
  markProfileStarted(input: { accountId: string; candidateId: string; observedAt: Date }): Promise<void>;
  findCompletion(input: {
    accountId: string;
    candidateId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<{ completedAt: Date; onboardingVersion: number; idempotentReplay: true } | null>;
  completeOnboarding(input: {
    receiptId: string;
    accountId: string;
    candidateId: string;
    expectedOnboardingVersion: number;
    idempotencyKey: string;
    requestFingerprint: string;
    completedAt: Date;
  }): Promise<{ completedAt: Date; onboardingVersion: number; idempotentReplay: boolean }>;
}

export interface ProfileEditItem {
  itemKey: string;
  canonicalKey: string;
  normalizedValue: PersistableNormalizedValue;
  entityId?: string | null;
  entityType?: EntityType | null;
  newEntityClientKey?: string | null;
  scopeType?: ScopeType;
  requestedScope?: CandidateScopeContext;
  context?: CandidateScopeContext;
  expectedCurrentVersionId: string | null;
}

export interface ReadinessRequirement {
  key: string;
  label: string;
  met: boolean;
  blocking: boolean;
  reason: string;
}

export interface CandidateReadiness {
  ready: boolean;
  requirements: readonly ReadinessRequirement[];
  needsConfirmation: number;
  staleItems: number;
  conflicts: number;
}

const sectionByCanonical: Readonly<Record<string, string>> = {
  EMAIL: "Contact", PHONE: "Contact", CURRENT_ADDRESS: "Contact", CURRENT_LOCATION: "Contact",
  LINKEDIN_URL: "Links", GITHUB_URL: "Links", PORTFOLIO_URL: "Links",
  CURRENT_COMPANY: "Work", CURRENT_JOB_TITLE: "Work", CURRENT_CTC: "Work", NOTICE_PERIOD: "Work",
  TOTAL_EXPERIENCE: "Work", WORK_AUTHORIZATION: "Work", SPONSORSHIP_REQUIRED: "Work",
  SKILLS: "Skills", PERSONAL_SUMMARY: "Personal", RESUME: "Documents",
  EXPECTED_CTC: "Preferences", RELOCATION: "Preferences", PREFERRED_LOCATIONS: "Preferences",
  EMPLOYMENT_COMPANY: "Experience", EMPLOYMENT_TITLE: "Experience", EMPLOYMENT_DATE_RANGE: "Experience",
  EDUCATION_INSTITUTION: "Education", EDUCATION_DEGREE: "Education",
  EDUCATION_FIELD_OF_STUDY: "Education", EDUCATION_DATE_RANGE: "Education"
};

export function profileFieldLabel(canonicalKey: string): string {
  return canonicalKey.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function profileSection(canonicalKey: string): string {
  if (/^(LEGAL_|PREFERRED_|FIRST_NAME|LAST_NAME|FULL_NAME)/.test(canonicalKey)) return "Personal";
  if (/^PROJECT_/.test(canonicalKey)) return "Projects";
  if (/^CERTIFICATION_/.test(canonicalKey)) return "Certifications";
  return sectionByCanonical[canonicalKey] ?? "Other";
}

export function calculateCandidateReadiness(snapshot: CandidateProfileSnapshot): CandidateReadiness {
  const current = new Set(snapshot.answers
    .filter((answer) => answer.trustState !== "REMOVED")
    .map((answer) => answer.canonicalKey));
  const name = current.has("FULL_NAME") || (current.has("FIRST_NAME") && current.has("LAST_NAME"));
  const requirements: ReadinessRequirement[] = [
    { key: "IDENTITY", label: "Your name", met: name, blocking: true, reason: "Needed on every application." },
    { key: "EMAIL", label: "Email", met: current.has("EMAIL"), blocking: true, reason: "Needed so employers can contact you." },
    { key: "PHONE", label: "Phone", met: current.has("PHONE"), blocking: true, reason: "Needed on most Indian application forms." },
    { key: "SKILLS", label: "Skills", met: current.has("SKILLS"), blocking: false, reason: "Improves deterministic job matching." },
    { key: "CAREER", label: "Experience or education", met: snapshot.answers.some((answer) => ["EMPLOYMENT", "EDUCATION"].includes(answer.entityType ?? "")) || current.has("TOTAL_EXPERIENCE"), blocking: false, reason: "Helps Copilot complete history sections." },
    { key: "RESUME", label: "Master resume", met: current.has("RESUME"), blocking: false, reason: "Optional now; useful for attachment fields." }
  ];
  const needsConfirmation = snapshot.answers.filter((answer) => answer.freshness.state === "REVIEW").length;
  const staleItems = snapshot.answers.filter((answer) => answer.freshness.state === "STALE").length;
  const conflicts = snapshot.conflictingResumeItems;
  return {
    ready: requirements.every((requirement) => !requirement.blocking || requirement.met) && conflicts === 0,
    requirements,
    needsConfirmation,
    staleItems,
    conflicts
  };
}

const IdempotencyKeySchema = z.string().trim().min(8).max(170).regex(/^[A-Za-z0-9._:-]+$/);

export class CandidateProfileService {
  constructor(
    private readonly repository: CandidateProfileRepository,
    private readonly truth: Pick<CandidateTruthService, "saveGroup" | "undoChangeSet" | "restoreVersion" | "reversalHistory">,
    private readonly entities: Pick<CandidateConfirmationRepository, "ensureEntity">,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async get(accountId: string, candidateId: string): Promise<CandidateProfileSnapshot> {
    return this.repository.getSnapshot({
      accountId: UuidSchema.parse(accountId),
      candidateId: UuidSchema.parse(candidateId),
      evaluatedAt: this.clock.now()
    });
  }

  async history(input: { accountId: string; candidateId: string; canonicalKey?: string; entityId?: string | null; limit?: number }) {
    return this.repository.listHistory({
      accountId: UuidSchema.parse(input.accountId),
      candidateId: UuidSchema.parse(input.candidateId),
      ...(input.canonicalKey ? { canonicalKey: input.canonicalKey.trim().toUpperCase() } : {}),
      ...(input.entityId !== undefined ? { entityId: input.entityId ? UuidSchema.parse(input.entityId) : null } : {}),
      limit: z.number().int().min(1).max(100).parse(input.limit ?? 50)
    });
  }

  async save(input: {
    accountId: string;
    candidateId: string;
    items: readonly ProfileEditItem[];
    idempotencyKey: string;
  }) {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    if (!input.items.length || input.items.length > 50) throw new ValidationError("Save between 1 and 50 profile fields at once.");
    const entityIds = new Map<string, string>();
    for (const item of input.items) {
      if (item.entityId && item.newEntityClientKey) throw new ValidationError("A history field cannot target two entities.");
      if (item.newEntityClientKey) {
        if (!item.entityType) throw new ValidationError("A new history item requires its type.");
        const sourceKey = `profile:${item.newEntityClientKey}`;
        if (!entityIds.has(sourceKey)) {
          entityIds.set(sourceKey, await this.entities.ensureEntity({
            accountId, candidateId, entityId: this.newId(), entityType: item.entityType,
            sourceKey, createdAt: this.clock.now()
          }));
        }
      }
    }
    const saved = await this.truth.saveGroup({
      accountId, candidateId, commitPoint: "EXPLICIT_SAVE", idempotencyKey: `profile:${idempotencyKey}`,
      items: input.items.map((item) => {
        const canonicalKey = item.canonicalKey.trim().toUpperCase();
        const policy = candidateAnswerPolicy(canonicalKey);
        const entityId = item.entityId
          ? UuidSchema.parse(item.entityId)
          : item.newEntityClientKey ? entityIds.get(`profile:${item.newEntityClientKey}`) ?? null : null;
        const source: CandidateAnswerInputSource = policy.answerClass === "LEGAL_FACT"
          ? item.expectedCurrentVersionId ? "USER_CORRECTION" : "USER_MANUAL"
          : "PROFILE";
        return {
          itemKey: item.itemKey,
          canonicalKey,
          normalizedValue: item.normalizedValue,
          scopeType: item.scopeType ?? "GLOBAL",
          ...(item.requestedScope ? { requestedScope: item.requestedScope } : {}),
          ...(item.context ? { context: item.context } : {}),
          entityId,
          source,
          expectedCurrentVersionId: item.expectedCurrentVersionId
        };
      })
    });
    await this.repository.markProfileStarted({ accountId, candidateId, observedAt: this.clock.now() });
    return saved;
  }

  async readiness(accountId: string, candidateId: string): Promise<CandidateReadiness> {
    return calculateCandidateReadiness(await this.get(accountId, candidateId));
  }

  async complete(input: {
    accountId: string;
    candidateId: string;
    expectedOnboardingVersion: number;
    idempotencyKey: string;
  }) {
    const accountId = UuidSchema.parse(input.accountId);
    const candidateId = UuidSchema.parse(input.candidateId);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    const expectedOnboardingVersion = z.number().int().positive().parse(input.expectedOnboardingVersion);
    const fingerprint = createHash("sha256").update(JSON.stringify({ candidateId, expectedOnboardingVersion })).digest("hex");
    const replay = await this.repository.findCompletion({
      accountId, candidateId, idempotencyKey, requestFingerprint: fingerprint
    });
    if (replay) return replay;
    const readiness = await this.readiness(accountId, candidateId);
    if (!readiness.ready) throw new ConflictError("Complete the required profile details and resolve resume conflicts first.", {
      missing: readiness.requirements.filter((item) => item.blocking && !item.met).map((item) => item.key),
      conflicts: readiness.conflicts
    });
    return this.repository.completeOnboarding({
      receiptId: this.newId(), accountId, candidateId, expectedOnboardingVersion,
      idempotencyKey, requestFingerprint: fingerprint, completedAt: this.clock.now()
    });
  }

  undo(input: { accountId: string; candidateId: string; changeSetId: string; idempotencyKey: string }) {
    return this.truth.undoChangeSet({
      accountId: input.accountId,
      candidateId: input.candidateId,
      targetChangeSetId: input.changeSetId,
      idempotencyKey: input.idempotencyKey
    });
  }

  restore(input: { accountId: string; candidateId: string; versionId: string; expectedCurrentVersionId: string | null; idempotencyKey: string }) {
    return this.truth.restoreVersion({
      accountId: input.accountId,
      candidateId: input.candidateId,
      targetVersionId: input.versionId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      idempotencyKey: input.idempotencyKey
    });
  }

  reversalHistory(input: { accountId: string; candidateId: string; limit?: number }) {
    return this.truth.reversalHistory(input);
  }
}

export function withProfilePresentation(input: Omit<CandidateProfileAnswer, "label" | "section" | "freshness">, evaluatedAt: Date): CandidateProfileAnswer {
  const policy = candidateAnswerPolicy(input.canonicalKey);
  return {
    ...input,
    label: profileFieldLabel(input.canonicalKey),
    section: profileSection(input.canonicalKey),
    freshness: evaluateAnswerFreshness({
      trustState: input.trustState,
      confirmedAt: input.confirmedAt,
      freshnessDays: policy.freshnessDays,
      evaluatedAt
    })
  };
}
