/** Never infer a date from notice days. Only the explicitly immediate-only
 * follow-up is inapplicable; unconditional last-working-day questions remain. */
export function noticeMakesLastDayInapplicable(canonicalKey: string | null, labels: readonly string[], noticeDays: number | null): boolean {
  return canonicalKey === "LAST_WORKING_DAY" && noticeDays !== null && noticeDays > 0
    && labels.some((label) => /if\s+(?:you\s+are\s+)?(?:available|joining|join)\s+immediately/i.test(label));
}
