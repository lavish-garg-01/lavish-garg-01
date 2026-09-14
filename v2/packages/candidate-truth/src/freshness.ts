export type AnswerFreshness =
  | { state: "FRESH"; reusable: true; expiresAt: string | null; reason: "NO_EXPIRY" | "WITHIN_WINDOW" }
  | { state: "STALE"; reusable: false; expiresAt: string; reason: "NEEDS_RECONFIRMATION" }
  | { state: "REVIEW"; reusable: false; expiresAt: string | null; reason: "NOT_CONFIRMED" }
  | { state: "REMOVED"; reusable: false; expiresAt: null; reason: "ANSWER_REMOVED" };

export function evaluateAnswerFreshness(input: {
  trustState: "REVIEW" | "TRUSTED" | "REMOVED";
  confirmedAt: Date | null;
  freshnessDays: number | null;
  evaluatedAt: Date;
}): AnswerFreshness {
  if (input.trustState === "REMOVED") {
    return { state: "REMOVED", reusable: false, expiresAt: null, reason: "ANSWER_REMOVED" };
  }
  if (input.trustState === "REVIEW" || !input.confirmedAt) {
    return { state: "REVIEW", reusable: false, expiresAt: null, reason: "NOT_CONFIRMED" };
  }
  if (input.freshnessDays === null) {
    return { state: "FRESH", reusable: true, expiresAt: null, reason: "NO_EXPIRY" };
  }
  if (!Number.isSafeInteger(input.freshnessDays) || input.freshnessDays <= 0) {
    throw new Error("Freshness days must be a positive safe integer or null.");
  }
  const expiresAt = new Date(input.confirmedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + input.freshnessDays);
  if (expiresAt.getTime() <= input.evaluatedAt.getTime()) {
    return {
      state: "STALE",
      reusable: false,
      expiresAt: expiresAt.toISOString(),
      reason: "NEEDS_RECONFIRMATION"
    };
  }
  return {
    state: "FRESH",
    reusable: true,
    expiresAt: expiresAt.toISOString(),
    reason: "WITHIN_WINDOW"
  };
}

export function evaluateReviewTrialFreshness(input: {
  confirmedAt: Date | null;
  freshnessDays: number | null;
  evaluatedAt: Date;
}): { reusable: boolean; expiresAt: string | null; reason: "WITHIN_WINDOW" | "NO_EXPIRY" | "NEEDS_RECONFIRMATION" | "NOT_CONFIRMED" } {
  if (!input.confirmedAt) return { reusable: false, expiresAt: null, reason: "NOT_CONFIRMED" };
  if (input.freshnessDays === null) return { reusable: true, expiresAt: null, reason: "NO_EXPIRY" };
  if (!Number.isSafeInteger(input.freshnessDays) || input.freshnessDays <= 0) {
    throw new Error("Freshness days must be a positive safe integer or null.");
  }
  const expiresAt = new Date(input.confirmedAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + input.freshnessDays);
  return {
    reusable: expiresAt.getTime() > input.evaluatedAt.getTime(),
    expiresAt: expiresAt.toISOString(),
    reason:
      expiresAt.getTime() > input.evaluatedAt.getTime()
        ? "WITHIN_WINDOW"
        : "NEEDS_RECONFIRMATION"
  };
}
