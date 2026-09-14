import type { FieldSemanticResolution } from "@job-hunter-v2/contracts";

export interface CanonicalReviewProposal {
  descriptorFingerprint: string;
  reason: "NEW_CANONICAL_REVIEW" | "ALIAS_REVIEW";
  candidateKeys: string[];
  status: "PENDING_REVIEW";
  containsCandidateValue: false;
}
/** No candidate values, labels, HTML or model-invented keys enter this queue.
 * A reviewer supplies a sanitized fixture and chooses a known alias or proposes
 * a typed definition + policy + migration. Nothing auto-promotes from frequency. */
export function proposeCanonicalReview(semantic: FieldSemanticResolution): CanonicalReviewProposal | null {
  if (!["UNRESOLVED", "AMBIGUOUS", "RESOLVED_MEDIUM"].includes(semantic.state)
    || semantic.declarationHint.state !== "NOT_DECLARATION") return null;
  const candidateKeys = [...new Set(semantic.candidates.map((item) => item.canonicalKey))].slice(0, 8);
  return { descriptorFingerprint: semantic.descriptorFingerprint, reason: candidateKeys.length ? "ALIAS_REVIEW" : "NEW_CANONICAL_REVIEW", candidateKeys, status: "PENDING_REVIEW", containsCandidateValue: false };
}

export function canonicalPromotionChecks(input: {
  canonicalKey: string; definitionRegistered: boolean; policyReviewed: boolean;
  migrationIncluded: boolean; positiveFixtures: number; negativeFixtures: number;
  fixturesPassed: boolean; reviewer: string;
}): string[] {
  const failures: string[] = [];
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(input.canonicalKey)) failures.push("INVALID_CANONICAL_KEY");
  if (!input.definitionRegistered) failures.push("TYPED_DEFINITION_REQUIRED");
  if (!input.policyReviewed) failures.push("SCOPE_AND_SAFETY_REVIEW_REQUIRED");
  if (!input.migrationIncluded) failures.push("DATABASE_MIGRATION_REQUIRED");
  if (input.positiveFixtures < 2 || input.negativeFixtures < 2 || !input.fixturesPassed) failures.push("POSITIVE_AND_NEGATIVE_FIXTURES_REQUIRED");
  if (!input.reviewer.trim()) failures.push("REVIEWER_REQUIRED");
  return failures;
}
