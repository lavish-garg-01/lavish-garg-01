import {
  FormGraphObservationSchema,
  type FormGraphEdge,
  type FormGraphNode
} from "@job-hunter-v2/contracts";
import {
  FormGraphRuntime,
  createGraphEdgeId,
  createGraphNodeId,
  formGraphHash
} from "@job-hunter-v2/form-graph";
import { FieldCandidateSchema, ScanResultSchema, type FieldCandidate, type FieldOwnership, type ScanResult } from "../shared/contracts.js";
import { detectApplicationSurface, formInstanceId, structuralHash } from "../shared/identity.js";
import { resumeUploadLabel } from "./ats-autofill.js";
import { associatedPopups } from "./associated-popup.js";
import { composedVisible, radioMembers, radioOptionLabel, selectedRadio } from "./radio-group.js";

export interface FieldOwnershipReader {
  ownershipOf(fieldRuntimeId: string): FieldOwnership;
  bind(fieldRuntimeId: string, element: HTMLElement): void;
}

export class FieldRegistry {
  private readonly elements = new Map<string, WeakRef<HTMLElement>>();
  private readonly fingerprints = new Map<string, string>();

  bind(fieldRuntimeId: string, element: HTMLElement, controlFingerprint?: string): void {
    this.elements.set(fieldRuntimeId, new WeakRef(element));
    if (controlFingerprint) this.fingerprints.set(fieldRuntimeId, controlFingerprint);
  }
  get(fieldRuntimeId: string): HTMLElement | null {
    const element = this.elements.get(fieldRuntimeId)?.deref() ?? null;
    if (!element?.isConnected) { this.elements.delete(fieldRuntimeId); return null; }
    return element;
  }
  retain(fieldRuntimeIds: ReadonlySet<string>): void {
    for (const key of this.elements.keys()) if (!fieldRuntimeIds.has(key)) { this.elements.delete(key); this.fingerprints.delete(key); }
  }
  matches(fieldRuntimeId: string, controlFingerprint: string): boolean { return this.fingerprints.get(fieldRuntimeId) === controlFingerprint; }
}

export class GraphElementRegistry {
  private readonly elements = new Map<string, WeakRef<HTMLElement>>();
  private readonly nodeIds = new WeakMap<HTMLElement, string>();
  bind(graphNodeId: string, element: HTMLElement): void { this.elements.set(graphNodeId, new WeakRef(element)); this.nodeIds.set(element, graphNodeId); }
  get(graphNodeId: string): HTMLElement | null {
    const element = this.elements.get(graphNodeId)?.deref() ?? null;
    if (!element?.isConnected) { this.elements.delete(graphNodeId); return null; }
    return element;
  }
  retain(graphNodeIds: ReadonlySet<string>): void {
    for (const key of this.elements.keys()) if (!graphNodeIds.has(key)) this.elements.delete(key);
  }
  nodeIdFor(element: HTMLElement): string | null { return this.nodeIds.get(element) ?? null; }
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLElement;

const controlSelector = "input:not([type=hidden]):not([type=password]),select,textarea,button,[role=combobox],[role=radio],[role=checkbox],[role=switch],[role=textbox],[contenteditable=true]";

function bounded(value: string | null | undefined, maximum = 180): string | null {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function roots(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const found: Array<Document | ShadowRoot> = [root];
  for (let index = 0; index < found.length; index += 1) {
    const current = found[index];
    if (!current) continue;
    for (const element of current.querySelectorAll("*")) if (element.shadowRoot?.mode === "open") found.push(element.shadowRoot);
  }
  return found;
}

function allControls(document: Document): Control[] {
  return roots(document).flatMap((root) => [...root.querySelectorAll<HTMLElement>(controlSelector)]);
}

function controlType(element: Control): FieldCandidate["controlType"] {
  const role = element.getAttribute("role");
  if (role === "combobox") return "COMBOBOX";
  if (role === "radio") return "RADIO";
  if (role === "checkbox" || role === "switch") return "CHECKBOX";
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return "TEXTAREA";
  if (element instanceof HTMLSelectElement) return element.multiple ? "MULTISELECT" : "SELECT";
  if (element instanceof HTMLButtonElement) return "BUTTON";
  if (!(element instanceof HTMLInputElement)) return "UNKNOWN";
  const type = element.type.toLowerCase();
  if (["text", "search", "url"].includes(type)) return "TEXT";
  if (type === "email") return "EMAIL";
  if (type === "tel") return "TEL";
  if (type === "number" || type === "range") return "NUMBER";
  if (["date", "month", "week", "datetime-local", "time"].includes(type)) return "DATE";
  if (type === "file") return "FILE";
  if (type === "checkbox") return "CHECKBOX";
  if (type === "radio") return "RADIO";
  return "UNKNOWN";
}

function isDecorativeFieldHint(value: string): boolean {
  return /^(?:type here|enter here|enter text|hello@example\.com|you@example\.com|name@example\.com|e\.?g\.?\b|example\b).*/i.test(value.trim());
}

// textContent/innerText omit text distributed through nested label slots.
function labelText(node: Node | null | undefined, depth = 0): string {
  if (!node || depth > 20) return "";
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node instanceof HTMLSlotElement) {
    const assigned = node.assignedNodes({ flatten: true });
    return [...(assigned.length ? assigned : node.childNodes)].map(child => labelText(child, depth + 1)).join(" ");
  }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(child => labelText(child, depth + 1)).join(" ");
}

function labelEvidence(element: Control): string[] {
  if (element instanceof HTMLInputElement && element.type === "file") {
    const uploadLabel = resumeUploadLabel(element);
    if (uploadLabel) return [uploadLabel];
  }
  const group = element.closest("fieldset,[role=radiogroup],[role=group],.application-question,.question,.form-field,[data-field]");
  const groupRoot = group?.getRootNode() as Document | ShadowRoot | undefined;
  const groupReferences = (group?.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
    .map(id => groupRoot?.getElementById(id)?.textContent ?? "").join(" ");
  const groupQuestion = bounded(groupReferences) ?? bounded(group?.getAttribute("aria-label"))
    ?? bounded(group?.querySelector("legend,[role=heading],.application-label,.question-label,.field-label")?.textContent);
  const root = element.getRootNode() as Document | ShadowRoot;
  const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => root.querySelector(`#${CSS.escape(id)}`)?.textContent ?? "").join(" ");
  const directLabel = element.id ? root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`) : null;
  const direct = bounded(labelText(directLabel ?? element.closest("label")));
  const groupFirst = (element instanceof HTMLInputElement && (element.type === "radio" || (element.type === "checkbox" && direct && /^(?:yes|no|true|false|agree|decline)$/i.test(direct))))
    ? [groupQuestion, direct]
    : [direct, groupQuestion];
  const candidates = [
    controlType(element) === "RADIO" ? groupQuestion : null,
    element.getAttribute("aria-label"),
    labelledBy,
    ...groupFirst,
    element.getAttribute("placeholder"),
    element.getAttribute("title")
  ].map((value) => bounded(value)).filter((value): value is string => value !== null && !isDecorativeFieldHint(value));
  return [...new Set(candidates)].slice(0, 6);
}

function sectionLabel(element: Control): string | null {
  let current: Element | null = element;
  for (let depth = 0; current && depth < 12; depth++) {
    const container = current.closest("fieldset,section,[role=group],.form-section,.field-group");
    if (container) {
      const heading = bounded(container.querySelector("legend,h1,h2,h3,h4,h5,h6,[role=heading]")?.textContent);
      if (heading) return heading;
    }
    const root = current.getRootNode();
    current = current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return null;
}

function describedBy(element: Control): string | null {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).slice(0, 4);
  const explicit = ids.map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
  if (bounded(explicit, 300)) return bounded(explicit, 300);
  const container = element.closest(".field,.form-field,.question,[data-field],fieldset") ?? element.parentElement;
  return bounded(container?.querySelector("small,.help,.description,[role=note]")?.textContent, 300);
}

function optionEvidence(element: Control): { count: number; samples: string[] } {
  if (element instanceof HTMLSelectElement) {
    const values = [...element.options].map((option) => bounded(option.textContent, 120)).filter((value): value is string => Boolean(value));
    return { count: element.options.length, samples: [...new Set(values)].slice(0, 12) };
  }
  if (controlType(element) === "RADIO") {
    const options = radioMembers(element);
    const values = options.map(input => bounded(radioOptionLabel(input), 120)).filter((value): value is string => Boolean(value));
    return { count: options.length, samples: [...new Set(values)].slice(0, 12) };
  }
  const popups = associatedPopups(element);
  if (popups.length) {
    const values = popups.flatMap(popup => [...popup.querySelectorAll('[role=option],[data-option]')])
      .map(option => bounded(labelText(option), 120)).filter((value): value is string => Boolean(value));
    return { count: values.length, samples: [...new Set(values)].slice(0, 12) };
  }
  const group = element.closest("fieldset,[role=radiogroup],[role=listbox]");
  if (!group) return { count: 0, samples: [] };
  const values = [...group.querySelectorAll("label,[role=option]")].map((option) => bounded(option.textContent, 120)).filter((value): value is string => Boolean(value));
  return { count: values.length, samples: [...new Set(values)].slice(0, 12) };
}

function entityType(value: string): FieldCandidate["repeatableEvidence"]["entityType"] {
  const normalized = value.toLowerCase();
  if (/employment history|work experience|work history|current employment|previous employment|experience-item|\bexperience\b|\bemployment\b/.test(normalized)) return "EMPLOYMENT";
  if (/education|academic|school|college|university/.test(normalized)) return "EDUCATION";
  if (/project/.test(normalized)) return "PROJECT";
  if (/certif/.test(normalized)) return "CERTIFICATION";
  if (/language/.test(normalized)) return "LANGUAGE";
  if (/reference/.test(normalized)) return "REFERENCE";
  if (/address/.test(normalized)) return "ADDRESS";
  return null;
}

function longStructuralFingerprint(value: string): string {
  return Array.from({ length: 8 }, (_, index) => structuralHash(`${index}:${value}`)).join("");
}

function semanticRole(value: string | null): "CURRENT" | "MOST_RECENT" | "PREVIOUS" | "OTHER" | "UNKNOWN" {
  const normalized = (value ?? "").toLowerCase();
  if (/\bcurrent\b|\bpresent\b/.test(normalized)) return "CURRENT";
  if (/most recent|latest/.test(normalized)) return "MOST_RECENT";
  if (/\bprevious\b|\bprior\b|\bpast\b/.test(normalized)) return "PREVIOUS";
  return normalized ? "OTHER" : "UNKNOWN";
}

function repeatableEvidence(element: Control, pageInstanceId: string, currentFormId: string): FieldCandidate["repeatableEvidence"] {
  const container = element.closest<HTMLElement>("[data-candidate-entity-id],[data-repeatable-item],[data-item-id],[data-index],.experience-item,.education-item,.repeatable-item");
  const groupLabel = bounded(container?.querySelector("legend,h2,h3,h4,[role=heading]")?.textContent ?? sectionLabel(element));
  if (!container) return { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel, formGroup: null };
  const inferred = entityType(`${groupLabel ?? ""} ${container?.className ?? ""} ${container?.id ?? ""} ${container?.getAttribute("data-repeatable-item") ?? ""} ${container?.getAttribute("data-item-id") ?? ""}`);
  if (!inferred) return { entityType: null, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint: null, groupLabel, formGroup: null };
  const stable = ["data-item-id", "data-repeatable-item", "data-automation-id", "data-testid", "id"]
    .map((name) => bounded(name === "id" ? container.id : container.getAttribute(name), 160)).find(Boolean) ?? null;
  const siblings = container.parentElement ? [...container.parentElement.children].filter((candidate) => candidate.tagName === container.tagName && candidate.className === container.className) : [];
  const ordinal = siblings.indexOf(container);
  const ordinalHint = ordinal >= 0 ? ordinal : null;
  const candidateEntityType = inferred && ["EMPLOYMENT", "EDUCATION", "PROJECT", "CERTIFICATION", "LANGUAGE"].includes(inferred)
    ? inferred as "EMPLOYMENT" | "EDUCATION" | "PROJECT" | "CERTIFICATION" | "LANGUAGE"
    : null;
  if (!candidateEntityType) return { entityType: inferred, bindingKind: "NONE", instanceKey: null, candidateEntityId: null, ordinalHint, groupLabel, formGroup: null };
  const structuralEvidence = [container.tagName, container.className, groupLabel, stable, currentFormId].join("|");
  const structuralFingerprint = longStructuralFingerprint(structuralEvidence);
  const groupKey = stable ?? `${structuralFingerprint}:${ordinalHint ?? "unknown"}`;
  const formGroup = {
    schemaVersion: 1 as const,
    formRepeatGroupId: `repeat:${structuralHash(`${pageInstanceId}:${currentFormId}:${groupKey}`)}`,
    identityKind: stable ? "STABLE_DOM" as const : "ORDINAL_ONLY" as const,
    stableGroupKey: stable,
    structuralFingerprint,
    entityType: candidateEntityType,
    semanticRole: semanticRole(groupLabel),
    ordinalHint,
    groupLabel
  };
  return stable
    ? { entityType: inferred, bindingKind: "DOM_STABLE_KEY", instanceKey: stable, candidateEntityId: null, ordinalHint: null, groupLabel, formGroup }
    : { entityType: inferred, bindingKind: "ORDINAL_HINT", instanceKey: null, candidateEntityId: null, ordinalHint, groupLabel, formGroup };
}

function semanticGroup(section: string | null): string | null {
  return entityType(section ?? "") ?? (/contact|personal/.test((section ?? "").toLowerCase()) ? "PERSONAL" : null);
}

function pageHeading(document: Document): string | null {
  return bounded(document.querySelector("main h1,h1,[role=main] [role=heading]")?.textContent);
}

function stepEvidence(document: Document): string {
  const heading = pageHeading(document) ?? "";
  const progress = bounded(document.querySelector<HTMLElement>(
    '[aria-current="step"],[role="progressbar"],[data-current-step],.step.active,.step.current,.progress-step.active'
  )?.textContent, 160) ?? "";
  const activePanel = bounded(document.querySelector<HTMLElement>(
    '[role="tabpanel"]:not([hidden]):not([aria-hidden="true"]),[data-step]:not([hidden]),.form-step.active'
  )?.getAttribute("id") ?? document.querySelector<HTMLElement>('[data-step]:not([hidden]),.form-step.active')?.getAttribute("data-step"), 120) ?? "";
  return `${heading}|${progress}|${activePanel}`;
}

function ats(document: Document): string {
  const declared = bounded(document.documentElement.getAttribute("data-ats") ?? document.body?.getAttribute("data-ats"), 80);
  if (declared) return declared.toUpperCase();
  return detectApplicationSurface(new URL(document.location.href)).ats;
}

function visible(element: Control): boolean {
  if (element instanceof HTMLInputElement && element.type === "hidden") return false;
  return composedVisible(element);
}

/** Custom ATS uploaders commonly hide the native input behind a visible label
 * or button. The file input remains K's target; the wrapper is only evidence
 * that the control is intentionally available on the current step. */
function controllable(element: Control): boolean {
  if (visible(element)) return true;
  if (!(element instanceof HTMLInputElement) || element.type !== "file") return false;
  const labels = element.labels ? [...element.labels] : [];
  if (labels.some((label) => visible(label))) return true;
  const container = element.closest<HTMLElement>("[data-field],.field,.form-field,.question,.upload,.file-upload,[role=group]");
  if (!container || !visible(container)) return false;
  return Boolean(container.querySelector('button,[role="button"],label'));
}

function actionContext(element: Control): string {
  // Web components often expose the action's accessible name on their host.
  // Only borrow a nearby explicit label for a generic Add button, never broad
  // section text that may describe a different control.
  const own = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""}`.trim();
  if (!/^add$/i.test(own)) return own;
  let parent: Element | null = element.parentElement;
  if (!parent) { const root = element.getRootNode(); parent = root instanceof ShadowRoot ? root.host : null; }
  for (let depth = 0; parent && depth < 3; depth++) {
    const label = parent.getAttribute("aria-label") ?? "";
    if (/^add (?:another )?(?:experience|employment|education|project|certification)(?: entry)?$/i.test(label.trim())) return `${own} ${label}`;
    if (parent.matches("form,body,fieldset")) break;
    const root = parent.getRootNode();
    parent = parent.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return own;
}

function graphActionKind(element: Control): FormGraphNode["actionKind"] {
  if (!(element instanceof HTMLButtonElement) && !(element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type))) return null;
  const text = bounded(element instanceof HTMLInputElement ? element.value : element.textContent, 120)?.toLowerCase() ?? "";
  const explicit = `${element.getAttribute("data-action") ?? ""} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
  const evidence = `${text} ${explicit} ${actionContext(element).toLowerCase()}`;
  if (element instanceof HTMLInputElement && element.type === "submit" || element instanceof HTMLButtonElement && element.type === "submit") return "SUBMIT";
  if (/\b(add another|add more|add employment|add experience|add education|add project|add certification|new entry)\b/.test(evidence)) return "ADD_REPEAT";
  if (/\b(remove|delete)\b/.test(evidence)) return "REMOVE_REPEAT";
  if (/\b(next|next step)\b/.test(evidence)) return "NEXT";
  if (/\bcontinue\b/.test(evidence)) return "CONTINUE";
  if (/\bsave\b/.test(evidence)) return "SAVE";
  if (/\b(edit|change)\b/.test(evidence)) return "EDIT";
  if (element.hasAttribute("aria-expanded") || /\b(show|expand|open section)\b/.test(evidence)) return "EXPAND";
  if (/\b(submit|send application|apply now)\b/.test(evidence)) return "SUBMIT";
  return "OTHER";
}

function requiredEvidence(element: Control): boolean {
  const container = element.closest(".field,.form-field,.question,[data-field],fieldset") ?? element.parentElement;
  return element.matches(":required,[aria-required=true],[data-required=true]")
    || Boolean(container?.matches(".required,[data-required=true],[aria-required=true]"))
    || Boolean(container?.querySelector("[aria-label*=required i],.required-indicator"));
}

function validationEvidence(root: ParentNode): { state: FormGraphNode["validationState"]; count: number } {
  const invalid = [...root.querySelectorAll<HTMLElement>('[aria-invalid="true"],[data-invalid="true"],[role="alert"],.field-error,.validation-error')]
    .filter((element) => visible(element));
  return invalid.length ? { state: "INVALID", count: Math.min(invalid.length, 1_000) } : { state: "NONE", count: 0 };
}

function controlCompleted(element: Control): boolean {
  if (controlType(element) === "RADIO") return selectedRadio(element) !== null;
  if (element instanceof HTMLSelectElement) {
    return element.multiple ? element.selectedOptions.length > 0 : Boolean(element.value && element.selectedIndex >= 0);
  }
  if (element instanceof HTMLTextAreaElement) return element.value.trim().length > 0;
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return element.checked;
    if (element.type === "file") return element.files !== null && element.files.length > 0;
    return element.value.trim().length > 0;
  }
  if (element.isContentEditable) return Boolean((element.textContent ?? "").trim());
  return false;
}

function observationSource(reason: ScanResult["reason"]): "INITIAL_SCAN" | "MUTATION_BATCH" | "RECOVERY" | "NAVIGATION" {
  if (reason === "INITIAL") return "INITIAL_SCAN";
  if (reason === "RECOVERY") return "RECOVERY";
  if (reason === "SPA_NAVIGATION") return "NAVIGATION";
  return "MUTATION_BATCH";
}

interface ControlIdentity {
  element: Control;
  members: HTMLElement[];
  formInstanceId: string;
  controlFingerprint: string;
  fieldRuntimeId: string;
  occurrence: number;
  type: FieldCandidate["controlType"];
  labels: string[];
}

export class DomScanner {
  private readonly graphRuntime = new FormGraphRuntime();

  constructor(
    private readonly registry: FieldRegistry,
    private readonly ownership: FieldOwnershipReader,
    private readonly graphRegistry = new GraphElementRegistry()
  ) {}

  resetGraph(): void { this.graphRuntime.reset(); }
  graphSnapshot() { return this.graphRuntime.snapshot(); }
  recordObservedTransition(sourceGraphNodeId: string, delta: ScanResult["graphDelta"], origin: "COPILOT" | "CANDIDATE" | "BROWSER" | "UNKNOWN") {
    return this.graphRuntime.recordObservedTransition(sourceGraphNodeId, delta, origin);
  }

  scan(document: Document, pageInstanceId: string, reason: ScanResult["reason"], applicationRunId: string | null = null): ScanResult {
    const started = performance.now();
    if (this.graphRuntime.snapshot()?.pageInstanceId !== pageInstanceId) this.graphRuntime.reset();
    const foundForms = roots(document).flatMap(root => [...root.querySelectorAll<HTMLFormElement>("form")]);
    const forms = foundForms.slice(0, 100);
    const formIds = forms.map((form, index) => formInstanceId(form, index, pageInstanceId));
    if (!formIds.length && document.querySelector(controlSelector)) formIds.push(formInstanceId(null, 0, pageInstanceId));
    const occurrences = new Map<string, number>();
    const foundControls = allControls(document);
    const scopeRoots=roots(document);
    const memberIds=new WeakMap<HTMLElement,string>();
    foundControls.forEach((control,index)=>memberIds.set(control,`member:${structuralHash(`${pageInstanceId}:${index}`)}`));
    const all = foundControls.filter(element => {
      const owner = element instanceof HTMLInputElement ? element.form : element.closest("form");
      return !owner || forms.includes(owner);
    }).slice(0, 800);
    const identities: ControlIdentity[] = [];
    const grouped = new Set<HTMLElement>();

    for (const element of all) {
      if (grouped.has(element)) continue;
      const type = controlType(element);
      const members = type === "RADIO" ? radioMembers(element) : [element];
      for (const member of members) grouped.add(member);
      const form = element instanceof HTMLInputElement ? element.form : element.closest("form");
      const formIndex = form ? forms.indexOf(form) : 0;
      const currentFormId = formIds[Math.max(0, formIndex)] ?? formInstanceId(null, 0, pageInstanceId);
      const labels = labelEvidence(element);
      const identityEvidence = [element.tagName, type, element.id, element.getAttribute("name"), element.getAttribute("autocomplete"), labels[0], currentFormId].join("|");
      const controlFingerprint = `control:${structuralHash(identityEvidence)}`;
      const occurrence = occurrences.get(controlFingerprint) ?? 0;
      occurrences.set(controlFingerprint, occurrence + 1);
      identities.push({
        element,
        members,
        formInstanceId: currentFormId,
        controlFingerprint,
        fieldRuntimeId: `field:${structuralHash(`${pageInstanceId}:${controlFingerprint}:${occurrence}`)}`,
        occurrence,
        type,
        labels
      });
    }

    const visibleCandidates = identities.filter(({ element, members }) => members.some(controllable) && graphActionKind(element) === null);
    const visibleIdentities = visibleCandidates.slice(0, 500);
    const fields: FieldCandidate[] = [];

    for (let index = 0; index < visibleIdentities.length; index += 1) {
      const identity = visibleIdentities[index];
      if (!identity) continue;
      const { element, formInstanceId: currentFormId, labels, type, controlFingerprint, occurrence, fieldRuntimeId } = identity;
      const previous = visibleIdentities[index - 1]?.element;
      const next = visibleIdentities[index + 1]?.element;
      const descriptor = FieldCandidateSchema.parse({
        schemaVersion: 2,
        evidenceVersion: 1,
        question:{version:1,questionId:fieldRuntimeId,pageInstanceId,formInstanceId:currentFormId,treeScopeId:`tree:${structuralHash(`${pageInstanceId}:${scopeRoots.indexOf(element.getRootNode() as Document|ShadowRoot)}`)}`,kind:type==="RADIO"?"SINGLE_CHOICE":"SINGLE_CONTROL",memberIds:identity.members.slice(0,100).map(member=>memberIds.get(member)!),memberCount:identity.members.length,membershipComplete:identity.members.length<=100,containsCandidateValue:false},
        fieldRuntimeId,
        pageInstanceId,
        formInstanceId: currentFormId,
        sectionFingerprint: `section:${structuralHash(sectionLabel(element) ?? currentFormId)}`,
        controlFingerprint,
        controlType: type,
        labelEvidence: labels,
        contextEvidence: {
          section: sectionLabel(element),
          previousLabel: previous ? labelEvidence(previous)[0] ?? null : null,
          nextLabel: next ? labelEvidence(next)[0] ?? null : null,
          semanticGroup: semanticGroup(sectionLabel(element)),
          pageHeading: pageHeading(document),
          formHeading: bounded((element.closest("form")?.querySelector("legend,h1,h2,h3,[role=heading]")?.textContent)),
          nearbyDescription: describedBy(element)
        },
        locatorEvidence: {
          contentEditable: element.isContentEditable,
          tagName: element.tagName.toLowerCase(),
          type: bounded(element instanceof HTMLInputElement?element.type:element.getAttribute("type"), 40),
          ariaAutocomplete:element.hasAttribute("aria-autocomplete"),
          name: bounded(element.getAttribute("name"), 160),
          id: bounded(element.id, 160),
          autocomplete: bounded(element.getAttribute("autocomplete"), 100),
          ariaLabel: bounded(element.getAttribute("aria-label")),
          placeholder: bounded(element.getAttribute("placeholder")),
          role: bounded(element.getAttribute("role"), 80),
          accessibleDescription: describedBy(element),
          occurrence
        },
        optionEvidence: optionEvidence(element),
        repeatableEvidence: repeatableEvidence(element, pageInstanceId, currentFormId),
        required: identity.members.some(requiredEvidence) || Boolean(element.closest('[role=radiogroup][aria-required=true]')),
        disabled: identity.members.every(member => !controllable(member) || member.matches(":disabled,[aria-disabled=true]")),
        ownership: this.ownership.ownershipOf(fieldRuntimeId)
      });
      this.registry.bind(fieldRuntimeId, element, controlFingerprint);
      for (const member of identity.members) this.ownership.bind(fieldRuntimeId, member);
      fields.push(descriptor);
    }
    this.registry.retain(new Set(fields.map((field) => field.fieldRuntimeId)));

    const graphResult = this.buildGraph(document, pageInstanceId, applicationRunId, reason, forms, formIds, identities);

    let inaccessibleFrameCount = 0;
    for (const frame of document.querySelectorAll("iframe")) {
      try { if (!frame.contentDocument) inaccessibleFrameCount += 1; }
      catch { inaccessibleFrameCount += 1; }
    }
    return ScanResultSchema.parse({
      schemaVersion: 2, reason, pageInstanceId, formInstanceIds: formIds,
      pageContext: { host: document.location.hostname, ats: ats(document), pageHeading: pageHeading(document) },
      fields, graph: graphResult.graph, graphDelta: graphResult.delta,
      inaccessibleFrameCount: Math.min(100, inaccessibleFrameCount),
      scanLimits: { controlLimitReached: foundControls.length > 800, fieldLimitReached: visibleCandidates.length > 500, formLimitReached: foundForms.length > 100 },
      durationMs: Math.round(performance.now() - started)
    });
  }

  private buildGraph(
    document: Document,
    pageInstanceId: string,
    applicationRunId: string | null,
    reason: ScanResult["reason"],
    forms: HTMLFormElement[],
    formIds: string[],
    identities: ControlIdentity[]
  ) {
    const nodes: FormGraphNode[] = [];
    const edges: FormGraphEdge[] = [];
    const nodeElements = new Map<string, HTMLElement>();
    const elementNodes = new Map<HTMLElement, string>();
    const targetNodes = new Map<string, string>();
    const routeFingerprint = formGraphHash(`${document.location.origin}${document.location.pathname}`);
    const bodyText = (document.body?.innerText ?? "").toLowerCase().slice(0, 40_000);
    const review = /review (?:your )?(?:application|answers)|application summary/.test(bodyText)
      && Boolean(document.querySelector('button[type="submit"],input[type="submit"]'));
    const stepLogical = formGraphHash(`${routeFingerprint}:${review ? "REVIEW" : "INPUT"}:${stepEvidence(document)}`);
    const stepNodeId = createGraphNodeId("STEP", `${pageInstanceId}:${stepLogical}`);
    nodes.push({
      graphNodeId: stepNodeId, nodeType: "STEP", pageInstanceId, formInstanceId: null,
      logicalFingerprint: stepLogical, parentGraphNodeId: null, fieldRuntimeId: null, controlFingerprint: null,
      formRepeatGroupId: null, actionKind: null, semanticRole: review ? "REVIEW" : "INPUT",
      state: "REACHABLE", visible: true, enabled: true, required: false, currentStep: true, technical: false,
      optionFingerprint: null, optionCount: 0, validationState: "NONE", validationErrorCount: 0,
      declaredTargetKeys: [], evidence: ["STRUCTURAL_INFERENCE"], confidence: 0.9,
      valuePrivate: true, containsCandidateValue: false
    });

    const sectionByForm = new Map<string, string>();
    for (let index = 0; index < Math.max(forms.length, formIds.length); index += 1) {
      const form = forms[index] ?? null;
      const currentFormId = formIds[index] ?? formInstanceId(null, index, pageInstanceId);
      const sectionLogical = formGraphHash(`${routeFingerprint}:${currentFormId}:${form?.id ?? "root"}:${form?.getAttribute("name") ?? ""}`);
      const sectionId = createGraphNodeId("SECTION", `${pageInstanceId}:${sectionLogical}`);
      const formVisible = form ? visible(form) : true;
      const formEnabled = form ? !form.matches("[inert],[aria-disabled=true]") : true;
      nodes.push({
        graphNodeId: sectionId, nodeType: "SECTION", pageInstanceId, formInstanceId: currentFormId,
        logicalFingerprint: sectionLogical, parentGraphNodeId: stepNodeId, fieldRuntimeId: null, controlFingerprint: null,
        formRepeatGroupId: null, actionKind: null, semanticRole: null,
        state: !formVisible ? "HIDDEN" : !formEnabled ? "DISABLED" : "REACHABLE",
        visible: formVisible, enabled: formEnabled, required: false, currentStep: true, technical: false,
        optionFingerprint: null, optionCount: 0, validationState: "NONE", validationErrorCount: 0,
        declaredTargetKeys: [], evidence: ["STRUCTURAL_INFERENCE"], confidence: 0.95,
        valuePrivate: true, containsCandidateValue: false
      });
      sectionByForm.set(currentFormId, sectionId);
      if (form) {
        elementNodes.set(form, sectionId);
        nodeElements.set(sectionId, form);
        if (form.id) targetNodes.set(form.id, sectionId);
      }
      edges.push(this.edge("CONTAINS", stepNodeId, sectionId, "STRUCTURAL_INFERENCE", 1, true));
    }

    const repeatNodes = new Map<string, string>();
    for (const identity of identities) {
      const evidence = repeatableEvidence(identity.element, pageInstanceId, identity.formInstanceId).formGroup;
      if (!evidence || repeatNodes.has(evidence.formRepeatGroupId)) continue;
      const repeatId = createGraphNodeId("REPEAT_GROUP", `${pageInstanceId}:${evidence.formRepeatGroupId}`);
      const parent = sectionByForm.get(identity.formInstanceId) ?? stepNodeId;
      const repeatContainer = identity.element.closest<HTMLElement>("[data-repeatable-item],[data-item-id],[data-index],.experience-item,.education-item,.repeatable-item");
      const isVisible = repeatContainer ? visible(repeatContainer) : controllable(identity.element);
      nodes.push({
        graphNodeId: repeatId, nodeType: "REPEAT_GROUP", pageInstanceId, formInstanceId: identity.formInstanceId,
        logicalFingerprint: evidence.structuralFingerprint, parentGraphNodeId: parent,
        fieldRuntimeId: null, controlFingerprint: null, formRepeatGroupId: evidence.formRepeatGroupId,
        actionKind: null, semanticRole: evidence.semanticRole,
        state: isVisible ? "REACHABLE" : "HIDDEN", visible: isVisible, enabled: true, required: false,
        currentStep: true, technical: false, optionFingerprint: null, optionCount: 0,
        validationState: "NONE", validationErrorCount: 0, declaredTargetKeys: [],
        evidence: [evidence.identityKind === "STABLE_DOM" ? "DECLARED_DOM_RELATION" : "STRUCTURAL_INFERENCE"],
        confidence: evidence.identityKind === "STABLE_DOM" ? 0.95 : 0.65,
        valuePrivate: true, containsCandidateValue: false
      });
      repeatNodes.set(evidence.formRepeatGroupId, repeatId);
      if (repeatContainer) {
        elementNodes.set(repeatContainer, repeatId);
        nodeElements.set(repeatId, repeatContainer);
        if (repeatContainer.id) targetNodes.set(repeatContainer.id, repeatId);
      }
      edges.push(this.edge("CONTAINS", parent, repeatId, "STRUCTURAL_INFERENCE", 0.9, true));
    }

    for (const identity of identities) {
      const { element } = identity;
      const actionKind = graphActionKind(element);
      const nodeType = actionKind ? "ACTION" as const : "FIELD" as const;
      const repeat = repeatableEvidence(element, pageInstanceId, identity.formInstanceId).formGroup;
      const parent = repeat ? repeatNodes.get(repeat.formRepeatGroupId) ?? sectionByForm.get(identity.formInstanceId) ?? stepNodeId
        : sectionByForm.get(identity.formInstanceId) ?? stepNodeId;
      const stableKey = [element.id, element.getAttribute("name"), element.getAttribute("data-testid"), element.getAttribute("data-automation-id")].filter(Boolean).join("|");
      const logicalFingerprint = formGraphHash(`${identity.formInstanceId}:${nodeType}:${identity.controlFingerprint}:${identity.occurrence}:${stableKey}:${actionKind ?? ""}`);
      const graphNodeId = createGraphNodeId(nodeType, `${pageInstanceId}:${logicalFingerprint}`);
      const isVisible = identity.members.some(controllable);
      const enabled = identity.members.some(member => controllable(member) && !member.matches(":disabled,[aria-disabled=true],[inert]"));
      const options = optionEvidence(element);
      const declaredTargets = [element.getAttribute("aria-controls"), element.getAttribute("aria-owns"), element.getAttribute("data-controls")]
        .flatMap((value) => (value ?? "").split(/\s+/)).filter(Boolean).map((value) => formGraphHash(value)).slice(0, 20);
      nodes.push({
        graphNodeId, nodeType, pageInstanceId, formInstanceId: identity.formInstanceId,
        logicalFingerprint, parentGraphNodeId: parent,
        fieldRuntimeId: nodeType === "FIELD" ? identity.fieldRuntimeId : null,
        controlFingerprint: nodeType === "FIELD" ? identity.controlFingerprint : null,
        formRepeatGroupId: repeat?.formRepeatGroupId ?? null,
        actionKind,
        semanticRole: actionKind === "ADD_REPEAT" ? entityType(`${actionContext(element)} ${sectionLabel(element) ?? ""}`) : null,
        state: !isVisible ? "HIDDEN" : !enabled ? "DISABLED" : nodeType === "FIELD" && controlCompleted(element) ? "COMPLETED" : "REACHABLE",
        visible: isVisible, enabled, required: nodeType === "FIELD" && (identity.members.some(requiredEvidence) || Boolean(element.closest('[role=radiogroup][aria-required=true]'))), currentStep: true,
        technical: false,
        optionFingerprint: options.count ? formGraphHash(options.samples.map((sample) => sample.normalize("NFKC").trim().toLowerCase()).sort().join("|") + `:${options.count}`) : null,
        optionCount: options.count,
        validationState: element.getAttribute("aria-invalid") === "true" ? "INVALID" : "NONE",
        validationErrorCount: element.getAttribute("aria-invalid") === "true" ? 1 : 0,
        declaredTargetKeys: declaredTargets,
        evidence: [stableKey ? "DECLARED_DOM_RELATION" : "STRUCTURAL_INFERENCE"], confidence: stableKey ? 0.95 : 0.8,
        valuePrivate: true, containsCandidateValue: false
      });
      for (const member of identity.members) {
        elementNodes.set(member, graphNodeId);
        if (member.id) targetNodes.set(member.id, graphNodeId);
      }
      nodeElements.set(graphNodeId, element);
      if (element.id) targetNodes.set(element.id, graphNodeId);
      edges.push(this.edge("CONTAINS", parent, graphNodeId, "STRUCTURAL_INFERENCE", 0.9, true));
    }

    for (let index = 0; index < Math.max(forms.length, formIds.length); index += 1) {
      const form = forms[index] ?? document;
      const currentFormId = formIds[index] ?? formInstanceId(null, index, pageInstanceId);
      const validation = validationEvidence(form);
      if (validation.count === 0) continue;
      const validationId = createGraphNodeId("VALIDATION_GATE", `${pageInstanceId}:${currentFormId}:validation`);
      const parent = sectionByForm.get(currentFormId) ?? stepNodeId;
      nodes.push({
        graphNodeId: validationId, nodeType: "VALIDATION_GATE", pageInstanceId, formInstanceId: currentFormId,
        logicalFingerprint: formGraphHash(`${currentFormId}:validation`), parentGraphNodeId: parent,
        fieldRuntimeId: null, controlFingerprint: null, formRepeatGroupId: null, actionKind: null, semanticRole: null,
        state: "BLOCKED", visible: true, enabled: true, required: true, currentStep: true, technical: false,
        optionFingerprint: null, optionCount: 0, validationState: validation.state, validationErrorCount: validation.count,
        declaredTargetKeys: [], evidence: ["OBSERVED_TRANSITION"], confidence: 1,
        valuePrivate: true, containsCandidateValue: false
      });
      edges.push(this.edge("CONTAINS", parent, validationId, "STRUCTURAL_INFERENCE", 1, true));
      for (const node of nodes.filter((candidate) => candidate.nodeType === "ACTION" && candidate.formInstanceId === currentFormId && ["NEXT", "CONTINUE"].includes(candidate.actionKind ?? ""))) {
        edges.push(this.edge("REQUIRES_VALID", node.graphNodeId, validationId, "OBSERVED_TRANSITION", 1, true));
      }
    }

    for (const [sourceId, element] of nodeElements) {
      const action = nodes.find((node) => node.graphNodeId === sourceId)?.actionKind ?? null;
      const refs = [element.getAttribute("aria-controls"), element.getAttribute("aria-owns"), element.getAttribute("data-controls")]
        .flatMap((value) => (value ?? "").split(/\s+/)).filter(Boolean);
      for (const reference of refs) {
        const targetId = targetNodes.get(reference);
        if (!targetId || targetId === sourceId) continue;
        const edgeType = action === "ADD_REPEAT" ? "CREATES_REPEAT_GROUP" : action === "EXPAND" ? "REVEALS" : "ENABLES";
        edges.push(this.edge(edgeType, sourceId, targetId, "DECLARED_DOM_RELATION", 0.95, true));
      }
      const dependency = element.getAttribute("data-depends-on") ?? element.getAttribute("data-controlled-by");
      if (dependency) {
        const targetId = targetNodes.get(dependency.replace(/^#/, ""));
        if (targetId && targetId !== sourceId) edges.push(this.edge("OPTIONS_DEPEND_ON", targetId, sourceId, "DECLARED_DOM_RELATION", 0.95, true));
      }
    }

    const dedupedEdges = [...new Map(edges.map((edge) => [edge.graphEdgeId, edge])).values()];
    this.graphRegistry.retain(new Set(nodes.map((node) => node.graphNodeId)));
    for (const [graphNodeId, element] of nodeElements) this.graphRegistry.bind(graphNodeId, element);
    const observation = FormGraphObservationSchema.parse({
      schemaVersion: 1,
      observationId: crypto.randomUUID(),
      applicationRunId,
      pageInstanceId,
      routeFingerprint,
      observedAt: new Date().toISOString(),
      nodes,
      edges: dedupedEdges,
      source: observationSource(reason),
      valuePrivate: true,
      containsCandidateValue: false
    });
    return this.graphRuntime.reconcile(observation);
  }

  private edge(
    edgeType: FormGraphEdge["edgeType"],
    sourceGraphNodeId: string,
    targetGraphNodeId: string,
    evidence: FormGraphEdge["evidence"][number],
    confidence: number,
    executable: boolean
  ): FormGraphEdge {
    return {
      graphEdgeId: createGraphEdgeId(edgeType, sourceGraphNodeId, targetGraphNodeId),
      edgeType,
      sourceGraphNodeId,
      targetGraphNodeId,
      predicate: { kind: "ALWAYS", expectedBoolean: null, normalizedOperandHash: null },
      evidence: [evidence],
      confidence,
      scope: "RUNTIME",
      executable,
      valuePrivate: true,
      containsCandidateValue: false
    };
  }
}
