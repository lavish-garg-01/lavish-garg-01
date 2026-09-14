import type {
  IdentityAccount,
  IdentityService,
  IdentityTokenVerifier,
  VerifiedIdentity
} from "@job-hunter-v2/auth";
import type { CandidateTruthService } from "@job-hunter-v2/candidate-truth";
import { randomUUID } from "node:crypto";
import { type Clock, systemClock } from "@job-hunter-v2/domain";

export const ONBOARDING_STAGES = ["WELCOME", "RESUME", "REVIEW", "PROFILE", "READY"] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export interface CandidateBootstrapState {
  accountId: string;
  candidateId: string;
  stage: OnboardingStage;
  completed: boolean;
  isNewCandidate: boolean;
  version: number;
  startedAt: Date;
  completedAt: Date | null;
}

export interface CandidateBootstrapRepository {
  ensureState(input: {
    accountId: string;
    candidateId: string;
    observedAt: Date;
  }): Promise<CandidateBootstrapState>;
}

export interface AuthenticatedCandidateSession {
  identity: Pick<VerifiedIdentity, "provider" | "providerSubject" | "email" | "expiresAt">;
  account: IdentityAccount;
  candidate: CandidateBootstrapState;
}

export interface CandidateSessionAuthenticator {
  authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedCandidateSession>;
}

export class CandidateSessionService implements CandidateSessionAuthenticator {
  constructor(
    private readonly tokenVerifier: IdentityTokenVerifier,
    private readonly identityService: Pick<IdentityService, "ensureNormalAccount">,
    private readonly candidateTruth: Pick<CandidateTruthService, "ensureCandidate">,
    private readonly candidateRepository: CandidateBootstrapRepository,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedCandidateSession> {
    const verified = await this.tokenVerifier.verifyAuthorizationHeader(authorizationHeader);
    const account = await this.identityService.ensureNormalAccount(verified);
    const proposedCandidateId = this.newId();
    const candidateId = await this.candidateTruth.ensureCandidate({
      accountId: account.accountId,
      candidateId: proposedCandidateId
    });
    const candidate = await this.candidateRepository.ensureState({
      accountId: account.accountId,
      candidateId,
      observedAt: this.clock.now()
    });
    return {
      identity: {
        provider: verified.provider,
        providerSubject: verified.providerSubject,
        email: verified.email,
        expiresAt: verified.expiresAt
      },
      account,
      candidate
    };
  }
}

export * from "./resume.js";
export * from "./confirmation.js";
export * from "./profile.js";
export * from "./documents.js";
export * from "./generation.js";
export * from "./application-documents.js";
