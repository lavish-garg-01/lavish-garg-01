import { createHash, randomUUID } from "node:crypto";
import { ConflictError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { z } from "zod";
import { CandidateSearchPreferencesSchema, type CandidateSearchPreferences } from "./contracts.js";

const IdempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/);

export const DEFAULT_CANDIDATE_SEARCH_PREFERENCES: CandidateSearchPreferences = CandidateSearchPreferencesSchema.parse({
  version: 1,
  targetRoleFamilies: [],
  acceptableRoleFamilies: [],
  preferredWorkModes: [],
  preferredCountryCodes: [],
  excludedCompanyNames: [],
  minimumCompensationMinor: null,
  compensationCurrencyCode: null,
  dealBreakers: {
    mandatoryRelocation: false,
    nightShift: false,
    heavyTravel: false,
    employmentBond: false
  }
});

export interface StoredCandidateSearchProfile {
  candidateId: string;
  version: number;
  preferences: CandidateSearchPreferences;
  updatedAt: Date | null;
}

export interface CandidateSearchProfileRepository {
  get(input: { accountId: string; candidateId: string }): Promise<StoredCandidateSearchProfile | null>;
  save(input: {
    receiptId: string;
    accountId: string;
    candidateId: string;
    expectedVersion: number;
    preferences: CandidateSearchPreferences;
    idempotencyKey: string;
    requestFingerprint: string;
    updatedAt: Date;
  }): Promise<StoredCandidateSearchProfile & { idempotentReplay: boolean }>;
}

export class CandidateSearchProfileService {
  constructor(
    private readonly repository: CandidateSearchProfileRepository,
    private readonly clock: Clock = systemClock,
    private readonly newId: () => string = randomUUID
  ) {}

  async get(accountId: string, candidateId: string): Promise<StoredCandidateSearchProfile> {
    return (await this.repository.get({ accountId, candidateId })) ?? {
      candidateId, version: 0, preferences: DEFAULT_CANDIDATE_SEARCH_PREFERENCES, updatedAt: null
    };
  }

  async save(input: {
    accountId: string;
    candidateId: string;
    expectedVersion: number;
    preferences: CandidateSearchPreferences;
    idempotencyKey: string;
  }) {
    const preferences = CandidateSearchPreferencesSchema.parse(input.preferences);
    const expectedVersion = z.number().int().min(0).parse(input.expectedVersion);
    const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
    if (preferences.minimumCompensationMinor !== null && !preferences.compensationCurrencyCode) {
      throw new ConflictError("A compensation currency is required with a minimum compensation preference.");
    }
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      candidateId: input.candidateId,
      expectedVersion,
      preferences
    })).digest("hex");
    return this.repository.save({
      receiptId: this.newId(), accountId: input.accountId, candidateId: input.candidateId,
      expectedVersion, preferences, idempotencyKey, requestFingerprint, updatedAt: this.clock.now()
    });
  }
}
