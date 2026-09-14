import type { ExecutionFailureClass, ExecutionRequest, FieldCapability, FieldRepresentation, RepresentationOption } from "@job-hunter-v2/contracts";
import { BUILTIN_STRATEGIES, safeStrategyPlan, type StrategyPlan } from "@job-hunter-v2/contracts";
import { detectFieldCapabilities } from "./capabilities.js";
import { composedVisible, radioMembers, radioOptionLabel } from "./radio-group.js";
import { associatedPopups } from "./associated-popup.js";

export class FieldExecutionError extends Error {
  constructor(readonly failureClass: ExecutionFailureClass, readonly retryable = false,
    readonly safetyViolation: "OUTSIDE_TARGET" | "NAVIGATION" | "POLICY_VIOLATION" | null = null) { super(failureClass); this.name = "FieldExecutionError"; }
}

export interface FieldExecutionStrategy {
  readonly strategyId: string;
  readonly priority: number;
  readonly capabilities: readonly FieldCapability[];
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean;
  execute(element: HTMLElement, representation: FieldRepresentation, abortReason?: () => ExecutionFailureClass | null): Promise<void>;
}

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const optionTokens = (option: RepresentationOption) => new Set([option.key, option.label, ...option.aliases].filter((value): value is string => Boolean(value)).map(normalize));

function uniqueOption<T>(matches: T[]): T {
  if (matches.length === 0) throw new FieldExecutionError("OPTION_NOT_FOUND", true);
  if (matches.length > 1) throw new FieldExecutionError("OPTION_AMBIGUOUS");
  const selected = matches[0];
  if (!selected) throw new FieldExecutionError("OPTION_NOT_FOUND", true);
  return selected;
}

function nativeSetter(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
  setter.call(element, value);
}

function commitInput(element: HTMLElement): void {
  element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function expectedText(representation: FieldRepresentation): string {
  if (representation.kind === "TEXT") return representation.text;
  if (representation.kind === "DATE") return representation.rendered;
  throw new FieldExecutionError("REPRESENTATION_INVALID");
}

function exactNativeOptions(select: HTMLSelectElement, expected: RepresentationOption): HTMLOptionElement[] {
  const tokens = optionTokens(expected);
  return [...select.options].filter((item) => tokens.has(normalize(item.value)) || tokens.has(normalize(item.label || item.textContent || "")));
}

function exactDomOptions(root: ParentNode, expected: RepresentationOption): HTMLElement[] {
  const tokens = optionTokens(expected);
  return [...root.querySelectorAll<HTMLElement>("[role=option],[data-option]")]
    .filter((item) => tokens.has(normalize(item.getAttribute("data-value") ?? "")) || tokens.has(normalize(item.textContent ?? "")));
}

class NativeTextStrategy implements FieldExecutionStrategy {
  readonly strategyId = "NATIVE_VALUE_SETTER@1"; readonly priority = 100;
  readonly capabilities = ["NATIVE_TEXT", "NATIVE_TEXTAREA", "NATIVE_NUMBER", "NATIVE_DATE", "NATIVE_MONTH"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && (representation.kind === "TEXT" || representation.kind === "DATE"); }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    element.focus(); nativeSetter(element, expectedText(representation)); commitInput(element);
  }
}

class DirectPropertyFallbackStrategy implements FieldExecutionStrategy {
  readonly strategyId = "DIRECT_PROPERTY_EVENTS_FALLBACK@1"; readonly priority = 40;
  readonly capabilities = ["NATIVE_TEXT", "NATIVE_TEXTAREA", "NATIVE_NUMBER", "NATIVE_DATE", "NATIVE_MONTH"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && (representation.kind === "TEXT" || representation.kind === "DATE"); }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    element.value = expectedText(representation); commitInput(element);
  }
}

class ContentEditableStrategy implements FieldExecutionStrategy {
  readonly strategyId = "CONTENTEDITABLE_TEXT@1"; readonly priority = 90; readonly capabilities = ["CONTENTEDITABLE"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return element.isContentEditable && representation.kind === "TEXT"; }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (representation.kind !== "TEXT") throw new FieldExecutionError("REPRESENTATION_INVALID");
    element.focus(); element.textContent = representation.text; commitInput(element);
  }
}

class NativeSelectStrategy implements FieldExecutionStrategy {
  readonly strategyId = "NATIVE_SELECT_EXACT@1"; readonly priority = 100; readonly capabilities = ["NATIVE_SELECT"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return element instanceof HTMLSelectElement && !element.multiple && representation.kind === "SINGLE_OPTION"; }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLSelectElement) || representation.kind !== "SINGLE_OPTION") throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    element.value = uniqueOption(exactNativeOptions(element, representation.option)).value;
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

class NativeMultiSelectStrategy implements FieldExecutionStrategy {
  readonly strategyId = "NATIVE_MULTISELECT_EXACT@1"; readonly priority = 100; readonly capabilities = ["NATIVE_MULTISELECT"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return element instanceof HTMLSelectElement && element.multiple && representation.kind === "MULTI_OPTION"; }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLSelectElement) || representation.kind !== "MULTI_OPTION") throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    const selected = new Set(representation.options.map((item) => uniqueOption(exactNativeOptions(element, item)).value));
    for (const item of element.options) item.selected = selected.has(item.value);
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

class CheckboxStrategy implements FieldExecutionStrategy {
  readonly strategyId = "NATIVE_CHECKED_SETTER@1"; readonly priority = 100; readonly capabilities = ["NATIVE_CHECKBOX", "TOGGLE"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return element instanceof HTMLInputElement && element.type === "checkbox" && representation.kind === "BOOLEAN"; }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLInputElement) || representation.kind !== "BOOLEAN") throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    if (!setter) throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    setter.call(element, representation.checked);
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

class RadioStrategy implements FieldExecutionStrategy {
  readonly strategyId = "NATIVE_RADIO_EXACT_LABEL@1"; readonly priority = 100; readonly capabilities = ["NATIVE_RADIO"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return element instanceof HTMLInputElement && element.type === "radio" && representation.kind === "SINGLE_OPTION"; }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLInputElement) || representation.kind !== "SINGLE_OPTION") throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    const tokens = optionTokens(representation.option);
    const candidates = radioMembers(element).filter((input): input is HTMLInputElement => input instanceof HTMLInputElement
      && composedVisible(input) && !input.matches(":disabled,[aria-disabled=true]")
      && (tokens.has(normalize(input.value)) || tokens.has(normalize(radioOptionLabel(input)))));
    uniqueOption(candidates).click();
  }
}

async function waitForExactOption(element: HTMLElement, expected: RepresentationOption, abortReason: () => ExecutionFailureClass | null): Promise<HTMLElement> {
  const deadline = performance.now() + 800;
  let associationSeen = false;
  do {
    const abort = abortReason();
    if (abort) throw new FieldExecutionError(abort);
    const popups = associatedPopups(element);
    associationSeen ||= popups.length > 0;
    const matches = [...new Set(popups.flatMap(root => exactDomOptions(root, expected)))]
      .filter(item => composedVisible(item) && !item.matches('[aria-disabled="true"],:disabled') && item.getClientRects().length > 0);
    if (matches.length) return uniqueOption(matches);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  } while (performance.now() < deadline);
  throw new FieldExecutionError(associationSeen ? "OPTION_NOT_FOUND" : "POPUP_ASSOCIATION_UNPROVEN", true);
}

class ComboboxStrategy implements FieldExecutionStrategy {
  readonly strategyId = "ARIA_COMBOBOX_EXACT_OPTION@1"; readonly priority = 95;
  readonly capabilities = ["ARIA_COMBOBOX", "SEARCHABLE_SELECT", "CUSTOM_LISTBOX"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return representation.kind === "SINGLE_OPTION" && (element.getAttribute("role") === "combobox" || element.getAttribute("aria-autocomplete") !== null); }
  async execute(element: HTMLElement, representation: FieldRepresentation, abortReason = () => null): Promise<void> {
    if (representation.kind !== "SINGLE_OPTION") throw new FieldExecutionError("REPRESENTATION_INVALID");
    element.focus(); element.click();
    if (element instanceof HTMLInputElement) { nativeSetter(element, representation.option.label); element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" })); }
    const option = await waitForExactOption(element, representation.option, abortReason);
    const abort = abortReason();
    if (abort) throw new FieldExecutionError(abort);
    option.click();
  }
}

class CustomRadioStrategy implements FieldExecutionStrategy {
  readonly strategyId = "ARIA_RADIO_EXACT_LABEL@1"; readonly priority = 90; readonly capabilities = ["CUSTOM_RADIO_GROUP"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return representation.kind === "SINGLE_OPTION" && ["radio", "radiogroup"].includes(element.getAttribute("role") ?? ""); }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (representation.kind !== "SINGLE_OPTION") throw new FieldExecutionError("REPRESENTATION_INVALID");
    const expected = optionTokens(representation.option);
    const candidates = radioMembers(element).filter(item => composedVisible(item) && !item.matches('[aria-disabled=true],:disabled')
      && (expected.has(normalize(item.getAttribute("data-value") ?? "")) || expected.has(normalize(radioOptionLabel(item)))));
    uniqueOption(candidates).click();
  }
}

class AriaToggleStrategy implements FieldExecutionStrategy {
  readonly strategyId = "ARIA_TOGGLE@1"; readonly priority = 80; readonly capabilities = ["TOGGLE"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean { return representation.kind === "BOOLEAN" && ["switch", "checkbox"].includes(element.getAttribute("role") ?? ""); }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (representation.kind !== "BOOLEAN") throw new FieldExecutionError("REPRESENTATION_INVALID");
    if ((element.getAttribute("aria-checked") === "true") !== representation.checked) element.click();
  }
}

class NativeFileStrategy implements FieldExecutionStrategy {
  readonly strategyId = "NATIVE_FILE_DATATRANSFER@1"; readonly priority = 110;
  readonly capabilities = ["FILE_INPUT"] as const;
  compatible(element: HTMLElement, representation: FieldRepresentation): boolean {
    return element instanceof HTMLInputElement && element.type === "file" && representation.kind === "FILE";
  }
  async execute(element: HTMLElement, representation: FieldRepresentation): Promise<void> {
    if (!(element instanceof HTMLInputElement) || element.type !== "file" || representation.kind !== "FILE") {
      throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    }
    if (element.multiple || element.disabled) throw new FieldExecutionError("DOCUMENT_UPLOAD_TO_ATS_FAILED");
    const accepted = element.accept.split(",").map((item) => item.trim().toLocaleLowerCase()).filter(Boolean);
    if (accepted.length && !accepted.some((item) => item === representation.mimeType.toLocaleLowerCase()
      || item === ".pdf" && representation.fileName.toLocaleLowerCase().endsWith(".pdf")
      || item === "application/*" || item === "*/*")) {
      throw new FieldExecutionError("DOCUMENT_UPLOAD_TO_ATS_FAILED");
    }
    const bytes = decodeBase64(representation.bytesBase64);
    if (bytes.byteLength !== representation.byteSize || await sha256Bytes(bytes) !== representation.contentSha256) {
      throw new FieldExecutionError("REPRESENTATION_INVALID", false, "POLICY_VIOLATION");
    }
    const file = new File([bytes as BlobPart], representation.fileName, { type: representation.mimeType, lastModified: Date.now() });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    element.files = transfer.files;
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
}

const strategies: readonly FieldExecutionStrategy[] = [new NativeFileStrategy(), new NativeTextStrategy(), new NativeSelectStrategy(), new NativeMultiSelectStrategy(), new CheckboxStrategy(), new RadioStrategy(), new ComboboxStrategy(), new CustomRadioStrategy(), new ContentEditableStrategy(), new AriaToggleStrategy(), new DirectPropertyFallbackStrategy()];

class TargetTextPlanStrategy implements FieldExecutionStrategy {
  readonly priority = 0;
  readonly capabilities = ["NATIVE_TEXT", "NATIVE_TEXTAREA"] as const;
  constructor(readonly strategyId: string, private readonly plan: Extract<StrategyPlan, { kind: "TARGET_TEXT" }>) {}
  compatible(element: HTMLElement, representation: FieldRepresentation) {
    return representation.kind === "TEXT" && (element instanceof HTMLTextAreaElement
      || (element instanceof HTMLInputElement && ["text", "email", "tel", "url", "search"].includes(element.type)));
  }
  async execute(element: HTMLElement, representation: FieldRepresentation, abortReason = () => null as ExecutionFailureClass | null) {
    if (!this.compatible(element, representation) || !safeStrategyPlan(this.plan)) throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    const target = element as HTMLInputElement | HTMLTextAreaElement;
    for (const step of this.plan.steps) {
      const abort = abortReason();
      if (abort) throw new FieldExecutionError(abort);
      if (!target.isConnected) throw new FieldExecutionError("FIELD_DETACHED");
      if (target.matches(":disabled,[aria-disabled=true]")) throw new FieldExecutionError("INTERACTION_REJECTED");
      if (step === "FOCUS") target.focus();
      else if (step === "SET_NATIVE_VALUE") nativeSetter(target, expectedText(representation));
      else if (step === "SET_DIRECT_VALUE") target.value = expectedText(representation);
      else if (step === "INPUT") target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText" }));
      else if (step === "CHANGE") target.dispatchEvent(new Event("change", { bubbles: true }));
      else if (step === "BLUR") target.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    }
  }
}

export class ExecutionStrategyRegistry {
  constructor(private readonly available: readonly FieldExecutionStrategy[] = strategies) {}
  candidates(element: HTMLElement, request: ExecutionRequest): FieldExecutionStrategy[] {
    if (request.strategySelection?.expiresAt && Date.parse(request.strategySelection.expiresAt) < Date.now()) return [];
    const live = new Set(detectFieldCapabilities(element)); const allowed = new Set(request.capabilityHints);
    let available = [...this.available];
    if (request.strategySelection && !request.declarationAuthorization) {
      available = request.strategySelection.strategies.flatMap((selection): FieldExecutionStrategy[] => {
        const plan = safeStrategyPlan(selection.plan);
        if (!plan) return [];
        if (plan.kind === "TARGET_TEXT") return [new TargetTextPlanStrategy(selection.key, plan)];
        const implementation = this.available.find((s) => s.strategyId === plan.implementation);
        return implementation ? [{ strategyId: selection.key, priority: implementation.priority, capabilities: implementation.capabilities,
          compatible: implementation.compatible.bind(implementation), execute: implementation.execute.bind(implementation) }] : [];
      });
    }
    const compatible = available.filter((item) => item.capabilities.some((capability) => live.has(capability) && allowed.has(capability)))
      .filter((item) => item.compatible(element, request.representation))
      ;
    if (request.strategySelection && !request.declarationAuthorization) return compatible;
    const priority = (s: FieldExecutionStrategy) => BUILTIN_STRATEGIES.find((d) => d.key === s.strategyId)?.priority ?? s.priority;
    return compatible.sort((left, right) => priority(right) - priority(left) || left.strategyId.localeCompare(right.strategyId));
  }
  async execute(strategy: FieldExecutionStrategy, element: HTMLElement, request: ExecutionRequest, abortReason = () => null as ExecutionFailureClass | null): Promise<{ strategyId: string; capability: FieldCapability }> {
    const abort = abortReason();
    if (abort) throw new FieldExecutionError(abort);
    if (!element.isConnected) throw new FieldExecutionError("FIELD_DETACHED");
    if (element.matches(":disabled,[aria-disabled=true],[readonly],[aria-readonly=true]") || element.closest('[inert]')) throw new FieldExecutionError("INTERACTION_REJECTED");
    // Native file inputs may intentionally be visually hidden behind upload UI.
    if (!(element instanceof HTMLInputElement && element.type === "file") && !composedVisible(element)) throw new FieldExecutionError("INTERACTION_REJECTED");
    const guardedCandidate = strategy.strategyId.startsWith("Q_");
    const url = element.ownerDocument.location.href;
    const values = guardedCandidate ? [...element.ownerDocument.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")]
      .filter((control) => control !== element).map((control) => ({ control, value: control.value, checked: control instanceof HTMLInputElement ? control.checked : null })) : [];
    await strategy.execute(element, request.representation, abortReason);
    if (guardedCandidate && element.ownerDocument.location.href !== url) throw new FieldExecutionError("PAGE_TRANSITIONED", false, "NAVIGATION");
    if (values.some(({ control, value, checked }) => control.isConnected && (control.value !== value || (control instanceof HTMLInputElement && control.checked !== checked)))) {
      throw new FieldExecutionError("DOM_REJECTED", false, "OUTSIDE_TARGET");
    }
    const capability = strategy.capabilities.find((item) => detectFieldCapabilities(element).includes(item));
    if (!capability) throw new FieldExecutionError("STRATEGY_UNSUPPORTED");
    return { strategyId: strategy.strategyId, capability };
  }
}
