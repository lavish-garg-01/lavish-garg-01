import { z } from "zod";

export const JourneyStageSchema = z.enum(["UNRELATED", "JOB_LIST", "JOB_DETAIL", "UNCERTAIN", "APPLICATION_ENTRY", "AUTH_REQUIRED", "APPLICATION_FORM", "APPLICATION_REVIEW", "APPLICATION_SUCCESS"]);
export const JourneyMethodSchema = z.enum(["UNKNOWN", "GENERIC_FORM", "ATS_RESUME", "SOCIAL_PROFILE", "NATIVE_APPLY"]);
export const JourneyEvidenceSchema = z.object({
  stage: JourneyStageSchema, method: JourneyMethodSchema, confidence: z.number().min(0).max(1),
  canFill: z.boolean(), reasons: z.array(z.string().regex(/^[A-Z_]+$/)).max(20)
}).strict();
export type JourneyEvidence = z.infer<typeof JourneyEvidenceSchema>;
export const JourneySessionSchema = z.object({
  sessionId: z.uuid(), startedAt: z.number(), updatedAt: z.number(),
  origin: z.string().url(), targetOrigin: z.string().url().nullable(), pathHash: z.string().length(8),
  userInitiated: z.boolean(), manualPathHash: z.string().length(8).nullable(),
  evidence: JourneyEvidenceSchema
}).strict();

export interface JourneySignals {
  career: boolean; job: boolean; knownRoute: boolean; application: boolean;
  controls: number; resume: boolean; personal: boolean; applyActions: number;
  social: boolean; native: boolean; review: boolean; success: boolean;
  login: boolean; excluded: boolean; manual: boolean; active: boolean;
}

/** Classification is evidence, never submission proof or permission to share a profile. */
export function classifyJourney(s: JourneySignals): JourneyEvidence {
  const method = s.native ? "NATIVE_APPLY" : s.resume ? "ATS_RESUME" : s.social ? "SOCIAL_PROFILE" : s.controls > 0 ? "GENERIC_FORM" : "UNKNOWN";
  const result = (stage: JourneyEvidence["stage"], confidence: number, reasons: string[], canFill = false): JourneyEvidence => ({ stage, method, confidence, reasons, canFill });
  if (s.excluded) return result("UNRELATED", 1, ["NON_EMPLOYMENT_CONTEXT"]);
  const context = s.job || s.career || s.knownRoute || s.application;
  if (s.login) return result(context || s.active ? "AUTH_REQUIRED" : "UNRELATED", .95, ["CREDENTIALS_REQUIRE_USER"]);
  if (s.success && context && !s.controls) return result("APPLICATION_SUCCESS", .9, ["SUCCESS_MARKER_NOT_VERIFICATION"]);
  if (s.review && context) return result("APPLICATION_REVIEW", .9, ["REVIEW_REQUIRES_USER"]);
  if (s.native) return result(context ? "APPLICATION_ENTRY" : "UNRELATED", .9, ["NATIVE_PLATFORM_REQUIRES_USER"]);
  if (context && (s.controls > 0 || s.resume) && ((s.application && (s.personal || s.job)) || (s.resume && (s.personal || s.job)) || (s.knownRoute && s.controls >= 2) || (s.manual && s.personal))) {
    return result("APPLICATION_FORM", .95, [s.manual ? "USER_CONFIRMED_FORM" : "EMPLOYMENT_FORM_EVIDENCE"], true);
  }
  if (s.knownRoute || (context && (s.social || s.resume || (s.application && s.applyActions > 0)))) return result("APPLICATION_ENTRY", .85, ["APPLICATION_ACTIONS_PRESENT"]);
  if (context && s.applyActions > 1 && !s.controls) return result("JOB_LIST", .85, ["MULTIPLE_JOB_ACTIONS"]);
  if (s.job && s.applyActions > 0) return result("JOB_DETAIL", .85, ["JOB_WITH_APPLY_ACTION"]);
  if (context && (s.controls > 0 || s.manual)) return result("UNCERTAIN", .55, ["MORE_APPLICATION_EVIDENCE_NEEDED"]);
  if (context && !s.controls) return result("JOB_LIST", .65, ["CAREER_CONTEXT_ONLY"]);
  return result("UNRELATED", .95, ["NO_APPLICATION_EVIDENCE"]);
}

export function journeyRoots(document: Document): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < roots.length; i++) for (const host of roots[i]!.querySelectorAll("*")) if (host.shadowRoot?.mode === "open") roots.push(host.shadowRoot);
  return roots;
}
export function journeyVisible(element: Element): boolean {
  return !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}
export function applicationAction(element: Element): boolean {
  const label = (element.getAttribute("aria-label") || element.textContent || (element instanceof HTMLInputElement ? element.value : "")).trim();
  return /^(?:(?:easy|quick) apply|apply(?: now| for (?:this|the) (?:job|role)| with (?:linkedin|indeed|seek|profile))?|(?:start|continue|submit|send|review) (?:your |my )?application)$/i.test(label);
}

export function detectJourney(url: URL, document: Document, knownRoute: boolean, manual = false, active = false): JourneyEvidence {
  const roots = journeyRoots(document);
  const query = (selector: string) => roots.flatMap((root) => [...root.querySelectorAll(selector)]).filter(journeyVisible);
  const headings = query('h1,h2,[role="heading"]').map((e) => e.textContent ?? "").join(" ").slice(0, 6000);
  // Text only from visible semantic elements: never read field values or body-wide user content.
  const text = query('h1,h2,h3,legend,label,p,[role="heading"],button,a').map((e) => e.textContent ?? "").join(" ").slice(0, 24000);
  const controls = query('input:not([type="hidden"]):not([type="password"]):not([type="search"]):not([type="submit"]):not([type="button"]),select,textarea,[role="combobox"],[role="textbox"]');
  const labels = controls.map((e) => `${e.getAttribute("name") ?? ""} ${e.getAttribute("autocomplete") ?? ""} ${e.getAttribute("aria-label") ?? ""} ${e instanceof HTMLInputElement ? [...e.labels ?? []].map((l) => l.textContent ?? "").join(" ") : ""}`).join(" ");
  const career = /(?:^|[./_-])(?:jobs?|careers?|recruitment)(?:[./_-]|$)/i.test(url.hostname + url.pathname);
  const job = /engineer|developer|designer|analyst|manager|technician|nurse|hiring|vacanc|employment|job description/i.test(headings);
  const application = (job && /\bapplication\b/i.test(headings)) || /(?:job|employment|role) application|submit (?:your )?application|personal information|employment history|apply for (?:this|the) (?:job|role)/i.test(text);
  const excluded = /contact us|contact sales|checkout|credit card application|loan application|university admission|scholarship application/i.test(headings)
    || query('input[autocomplete^="cc-"]').length > 0;
  const native = /(^|\.)linkedin\.com$/i.test(url.hostname);
  return classifyJourney({ career, job, knownRoute, application, controls: controls.length,
    resume: /r[ée]sum[ée]|curriculum vitae|\bCV\b/i.test(text) && roots.some((r) => r.querySelector('input[type="file"]')),
    personal: /first.?name|full.?name|last.?name|\bemail\b|\bphone\b/i.test(labels + " " + text),
    applyActions: query('button,a,[role="button"],input[type="submit"]').filter(applicationAction).length,
    social: /apply with (?:linkedin|indeed|seek)/i.test(text), native,
    review: /review (?:your )?application/i.test(headings),
    success: /application (?:has been )?(?:submitted|received)|thank you for applying/i.test(headings),
    login: query('input[type="password"]').length > 0, excluded, manual, active });
}
