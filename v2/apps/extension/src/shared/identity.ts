import { z } from "zod";
import { detectJourney, type JourneyEvidence } from "./application-journey.js";

export const RuntimeIdentitySchema = z.object({
  tabSessionId: z.uuid(),
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  pageInstanceId: z.uuid(),
  applicationId: z.uuid().nullable(),
  applicationRunId: z.uuid().nullable(),
  formInstanceIds: z.array(z.string().min(8).max(100)).max(100),
  applicationKey: z.string().min(8).max(128).nullable()
}).strict();
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

export type ApplicationAtsFamily = "ASHBY" | "GREENHOUSE" | "LEVER" | "WORKDAY" | "SMARTRECRUITERS" | "GENERIC";

export interface ApplicationSurface {
  ats: ApplicationAtsFamily;
  applicationRoute: boolean;
  knownApplicationRoute: boolean;
}

const FILLABLE_SELECTOR = "input:not([type=hidden]):not([type=password]),select,textarea,[contenteditable=true],[role=combobox],[role=textbox]";

export function isInjectableApplicationFrame(href: string, origin: string): boolean {
  if (origin === "null") return false;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function structuralHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function detectApplicationSurface(url: URL): ApplicationSurface {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const applicationRoute = /(?:^|\/)(?:apply|application|applications)(?:\/|$)/i.test(path);
  if (host === "jobs.ashbyhq.com" || host.endsWith(".ashbyhq.com")) {
    const ashbyJob = /^\/[^/]+\/[0-9a-f-]{36}(?:\/application)?\/?$/i.test(path);
    return { ats: "ASHBY", applicationRoute, knownApplicationRoute: ashbyJob && applicationRoute };
  }
  if (host.includes("greenhouse")) {
    return { ats: "GREENHOUSE", applicationRoute, knownApplicationRoute: applicationRoute };
  }
  if (host.includes("lever.co") || host.startsWith("jobs.lever.")) {
    return { ats: "LEVER", applicationRoute, knownApplicationRoute: applicationRoute };
  }
  if (host.includes("myworkdayjobs") || host.includes("workday")) {
    return { ats: "WORKDAY", applicationRoute, knownApplicationRoute: applicationRoute };
  }
  if (host.includes("smartrecruiters")) {
    const oneClick = /^\/oneclick-ui\/company\/[^/]+\/publication\/[^/]+(?:\/(?:screening|review|summary|confirmation))?\/?$/i.test(path);
    return { ats: "SMARTRECRUITERS", applicationRoute: applicationRoute || oneClick, knownApplicationRoute: applicationRoute || oneClick };
  }
  return { ats: "GENERIC", applicationRoute, knownApplicationRoute: /(?:^|\/)(?:application|applications)(?:\/|$)/i.test(path) };
}

export function applicationKeyFromEvidence(input: {
  origin: string;
  applicationPath: string;
  actionEvidence: string;
  applicationFormCount: number;
  standaloneControlCount: number;
  applicationRoute: boolean;
  knownApplicationRoute: boolean;
}): string | null {
  if (!input.applicationFormCount && !input.knownApplicationRoute && !(input.applicationRoute && input.standaloneControlCount > 0)) {
    return null;
  }
  return `app:${structuralHash(`${input.origin}|${input.applicationPath}|${input.actionEvidence}`)}`;
}

function openRoots(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const found: Array<Document | ShadowRoot> = [root];
  for (let index = 0; index < found.length; index += 1) {
    const current = found[index];
    if (!current) continue;
    for (const element of current.querySelectorAll("*")) if (element.shadowRoot?.mode === "open") found.push(element.shadowRoot);
  }
  return found;
}

function fillableControls(root: ParentNode): HTMLElement[] {
  const immediate = [...root.querySelectorAll<HTMLElement>(FILLABLE_SELECTOR)];
  const nested = [...root.querySelectorAll("*")].flatMap((element) => (
    element.shadowRoot?.mode === "open" ? fillableControls(element.shadowRoot) : []
  ));
  return [...immediate, ...nested];
}

export function pageIdentity(url: URL, document: Document, manual = false, active = false): {
  pageInstanceId: string;
  applicationKey: string | null;
  hasForms: boolean;
  pathHash: string;
  journey: JourneyEvidence;
} {
  const normalizeApplicationPath = (path: string): string => path
    .replace(/\/(?:step|page)\/\d+\/?$/i, "")
    .replace(/\/(?:step|page)[-_]?\d+\/?$/i, "")
    .replace(/\/(?:review|summary|confirmation)\/?$/i, "") || "/";
  const surface = detectApplicationSurface(url);
  const oneClickPublication = surface.ats === "SMARTRECRUITERS" && surface.knownApplicationRoute
    ? url.pathname.match(/^(\/oneclick-ui\/company\/[^/]+\/publication\/[^/]+)(?:\/(?:screening|review|summary|confirmation))?\/?$/i)?.[1] : null;
  const journey = detectJourney(url, document, surface.knownApplicationRoute, manual, active);
  const forms = openRoots(document).flatMap((root) => [...root.querySelectorAll("form")]);
  const applicationForms = forms.filter((form) => {
    const controls = fillableControls(form);
    if (!controls.length) return false;
    const searchable = controls.every((control) => control instanceof HTMLInputElement && control.type === "search");
    const loginLike = Boolean(form.querySelector("input[type=password]")) && controls.length <= 2;
    const hiringEvidence = /(?:job|employment|engineer|developer|role) application|apply for|résumé|resume|employment history/i.test(`${document.querySelector("h1")?.textContent ?? ""} ${form.textContent ?? ""}`);
    return !searchable && !loginLike && (surface.applicationRoute || hiringEvidence || (surface.ats !== "GENERIC" && controls.length >= 3));
  });
  const standaloneControls = fillableControls(document).filter((control) => !control.closest("form"));
  const actionEvidence = applicationForms.map((form) => {
    const action = form.getAttribute("action") || "";
    try { return action ? normalizeApplicationPath(new URL(action, url).pathname) : ""; } catch { return ""; }
  }).sort().join("|");
  const applicationPath = oneClickPublication ?? normalizeApplicationPath(url.pathname);
  return {
    pageInstanceId: crypto.randomUUID(),
    journey,
    applicationKey: ["UNRELATED", "JOB_LIST", "JOB_DETAIL", "UNCERTAIN", "AUTH_REQUIRED", "APPLICATION_SUCCESS"].includes(journey.stage) ? null : applicationKeyFromEvidence({
      origin: url.origin,
      applicationPath,
      actionEvidence: oneClickPublication ? "" : actionEvidence,
      applicationFormCount: applicationForms.length || Number(journey.canFill),
      standaloneControlCount: standaloneControls.length,
      applicationRoute: surface.applicationRoute || (surface.ats !== "GENERIC" && standaloneControls.length >= 3 && /easy apply|submit your application|personal information/i.test(document.body?.textContent ?? "")),
      knownApplicationRoute: surface.knownApplicationRoute || journey.stage === "APPLICATION_ENTRY" || journey.stage === "APPLICATION_REVIEW"
    }),
    hasForms: applicationForms.length > 0,
    pathHash: structuralHash(`${url.origin}${url.pathname}`)
  };
}

export function formInstanceId(form: HTMLFormElement | null, index: number, pageInstanceId: string): string {
  if (!form) return `form:${structuralHash(`${pageInstanceId}:root:${index}`)}`;
  const evidence = [form.id, form.getAttribute("name"), form.getAttribute("action"), String(index)].filter(Boolean).join("|");
  return `form:${structuralHash(`${pageInstanceId}:${evidence}`)}`;
}
