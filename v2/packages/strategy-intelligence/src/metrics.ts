import type { ExecutionAttemptReceipt, ExecutionReceipt } from "@job-hunter-v2/contracts";
import type { Attribution, StrategyEvidence } from "./model.js";

/** Unknown causal evidence remains unknown. Readback mismatch is NOT proof of a bad strategy. */
export function attribute(attempt: ExecutionAttemptReceipt, receipt: ExecutionReceipt): Attribution {
  const failure = attempt.failureClass ?? receipt.failureClass;
  if (receipt.declaration || failure?.startsWith("DECLARATION_") || failure === "POLICY_AUTHORIZATION_REQUIRED") return "POLICY";
  if (failure === "USER_OWNERSHIP" || attempt.verificationStatus === "USER_MODIFIED") return "USER";
  if (failure?.startsWith("GRAPH_") || ["DEPENDENCY_UNRESOLVED", "VALIDATION_GATE_BLOCKED"].includes(failure ?? "")) return "GRAPH";
  if (["FIELD_STALE", "FIELD_DETACHED", "PAGE_TRANSITIONED", "FRAME_INACCESSIBLE", "RUNTIME_INVALIDATED"].includes(failure ?? "")) return "SCANNER_RUNTIME";
  if (failure === "REPRESENTATION_INVALID") return "REPRESENTATION";
  if (attempt.structuralChange) return "SITE_CHANGE";
  if (attempt.executionStatus === "EXECUTED" && attempt.verificationStatus === "VERIFIED" && !failure) return "NONE";
  if (["INTERACTION_REJECTED", "DOM_REJECTED", "STRATEGY_UNSUPPORTED"].includes(failure ?? "")) return "EXECUTION";
  if (failure === "VERIFICATION_FAILED" || attempt.verificationStatus === "FAILED") return "VERIFIER";
  return "UNKNOWN";
}

export function metrics(events: readonly StrategyEvidence[], key: string, now = Date.now()) {
  const all = events.filter((e) => e.key === key);
  // One candidate cannot manufacture unlimited evidence weight. Deduplicate operation attempts.
  const deduped = [...new Map(all.map((e) => [`${e.accountId}:${e.operationId}:${e.evidenceKind}:${e.attempt}`, e])).values()];
  const summarize = (rows: StrategyEvidence[]) => {
    const eligible = rows.filter((e) => e.evidenceKind !== "FEEDBACK" && ["NONE", "EXECUTION", "VERIFIER"].includes(e.attribution));
    const successes = eligible.filter((e) => e.executed && e.verified && e.attribution === "NONE").length;
    return { attempts: eligible.length, verifiedSuccesses: successes,
      verifierFailures: eligible.filter((e) => e.verifierFailed).length,
      executionFailures: eligible.filter((e) => e.attribution === "EXECUTION").length,
      retrySuccesses: eligible.filter((e) => e.attempt > 1 && e.executed && e.verified).length,
      overwrites: rows.filter((e) => e.feedback === "OVERWRITTEN").length,
      feedbackScore: rows.reduce((sum, e) => sum + (e.feedback === "KEPT" ? 1 : e.feedback === "OVERWRITTEN" ? -2 : 0), 0),
      users: new Set(eligible.map((e) => `${e.accountId}:${e.candidateId}`)).size,
      meanLatency: eligible.length ? eligible.reduce((sum, e) => sum + e.durationMs, 0) / eligible.length : 0,
      fallbackRate: eligible.length ? eligible.filter((e) => e.fallback).length / eligible.length : 0,
      userRate: rows.length ? new Set(rows.filter((e) => e.attribution === "USER" || e.feedback === "OVERWRITTEN").map((e) => e.operationId)).size / new Set(rows.map((e) => e.operationId)).size : 0,
      successRate: eligible.length ? successes / eligible.length : 0,
      severe: rows.filter((e) => e.severe !== "NONE").length };
  };
  return { lifetime: summarize(deduped), recent: summarize(deduped.filter((e) => Date.parse(e.occurredAt) >= now - 7 * 86400_000)) };
}

export function wilson(successes: number, total: number): [number, number] {
  if (!total) return [0, 1];
  const z = 1.96, p = successes / total, denominator = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return [centre - margin, centre + margin];
}

export function opportunity(events: readonly StrategyEvidence[], key: string, now = Date.now()) {
  const recent = events.filter((e) => e.key === key && Date.parse(e.occurredAt) >= now - 7 * 86400_000);
  const failures = [...new Map(recent.filter((e) => e.evidenceKind !== "FEEDBACK" && e.attribution === "EXECUTION").map((e) => [e.operationId, e])).values()];
  const units = new Set(failures.map((e) => `${e.accountId}:${e.candidateId}`));
  if (failures.length < 5 || units.size < 3) return null;
  return { key, failures: failures.length, users: units.size,
    sourceEvents: failures.slice(-20).map((e) => e.eventId),
    manualPattern: recent.find((e) => failures.some((f) => f.operationId === e.operationId) && e.manualCommitted && e.manualPattern.length)?.manualPattern ?? [] };
}
