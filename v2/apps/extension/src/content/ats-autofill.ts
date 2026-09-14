import type { ExecutionPlanResponse } from "@job-hunter-v2/contracts";
import { journeyRoots } from "../shared/application-journey.js";

function parentAcrossShadow(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

/** Keep upload evidence local even when the input is inside a web component. */
export function resumeUploadLabel(element: HTMLElement | null): string | null {
  let parent: Element | null = element;
  for (let depth = 0; parent && depth < 8; depth++, parent = parentAcrossShadow(parent)) {
    const markers = [parent.getAttribute("data-test"), parent.getAttribute("data-testid"), parent.getAttribute("aria-label")].filter(Boolean).join(" ");
    if (/apply[-_ ]with[-_ ]resume|autofill[-_ ](?:from[-_ ])?resume/i.test(markers)) return "Autofill from resume";
    if (/^resume[-_ ]upload$/i.test(markers.trim())) return "Resume";
    if (parent.querySelectorAll('input[type="file"]').length > 1) return null;
    const text = parent.textContent ?? "";
    if (text.length < 1200 && /auto\s*fill\s+(?:from|with|using)\s+(?:your\s+)?r[ée]sum[ée]|parse\s+(?:your\s+)?r[ée]sum[ée]|autocomplete your application/i.test(text)) return "Autofill from resume";
  }
  return null;
}

export function isResumeAutofillControl(element: HTMLElement | null): boolean {
  return resumeUploadLabel(element) === "Autofill from resume";
}

export function resumeFirstPlan(plan: ExecutionPlanResponse, lookup: (id: string) => HTMLElement | null): ExecutionPlanResponse {
  const upload = plan.operations.find((op) => op.canonicalKey === "RESUME" && op.representation.kind === "FILE" && isResumeAutofillControl(lookup(op.fieldRuntimeId)));
  return upload ? { ...plan, operations: [upload], actions: [], summary: { ...plan.summary, planned: 1, plannedActions: 0 } } : plan;
}

/** Page-local only. ATS output is not verified candidate truth or learning. */
export function emptyAutofillTargets(document: Document): Set<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  return new Set(journeyRoots(document).flatMap(root => [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type=password]):not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea,select'
  )]).filter((element) => !element.value.trim()));
}

export async function waitForResumeParser(targets: ReturnType<typeof emptyAutofillTargets>, canLabel: (element: HTMLElement) => boolean): Promise<number> {
  let previous = "";
  let stable = 0;
  for (let tick = 0; tick < 20; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const signature = [...targets].map((element) => element.isConnected ? element.value : "").join("\u0000");
    stable = signature === previous ? stable + 1 : 0;
    previous = signature;
    if (tick >= 7 && stable >= 4 && [...targets].some((element) => element.value.trim())) break;
  }
  let count = 0;
  for (const element of targets) if (element.isConnected && element.value.trim() && canLabel(element)) {
    element.dataset.jobHunterFillSource = "ATS_AUTOFILLED";
    element.title = `${element.title ? element.title + " · " : ""}ATS autofilled — please review`;
    count++;
  }
  return count;
}
