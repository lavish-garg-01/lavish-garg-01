import type { JobResult } from "./api.js";

export function humanJobValue(value: string | null): string {
  return value
    ? value.toLowerCase().split("_").map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ")
    : "Not specified";
}

export function formatJobCompensation(compensation: JobResult["compensation"]): string | null {
  if (!compensation) return null;
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: compensation.currency,
    maximumFractionDigits: 0
  });
  const minimum = compensation.minimumMinor === null ? null : formatter.format(compensation.minimumMinor / 100);
  const maximum = compensation.maximumMinor === null ? null : formatter.format(compensation.maximumMinor / 100);
  return minimum && maximum ? `${minimum}–${maximum}` : maximum ? `Up to ${maximum}` : minimum ? `From ${minimum}` : null;
}

export function primaryMatchMessage(match: JobResult["match"]): string {
  return match.reasons[0]?.message
    ?? match.unknowns[0]?.message
    ?? "Open the role to review available evidence.";
}
