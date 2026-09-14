import type { ExecutionFailureClass, ExecutionRequest, VerificationStatus } from "@job-hunter-v2/contracts";
import type { FieldRegistry } from "./scanner.js";
import { composedVisible, radioOptionLabel, selectedRadio } from "./radio-group.js";

export interface VerificationResult {
  status: VerificationStatus;
  failureClass: ExecutionFailureClass | null;
  /** A DOM readback is not proof of the employer's internal model or submission. */
  evidenceLevel?: "DOM_READBACK" | "NONE";
}

export function hasValidationError(element: HTMLElement): boolean | null {
  if (element.getAttribute("aria-invalid") === "true") return true;
  let unknown = false;
  // Some employer forms ship legacy `pattern` expressions that Chrome cannot
  // compile with its current RegExp grammar. Evaluating the `:invalid` pseudo
  // class then throws instead of returning a boolean. That page defect must not
  // abort Copilot's entire verification pass; the explicit error surfaces below
  // still fail the field closed when the application renders an error.
  try {
    if (element.matches(":invalid")) return true;
  } catch {
    // Treat an uninspectable native validity state as unknown, not as a runtime
    // failure or proof that the candidate value was accepted.
    unknown = true;
  }
  const root = element.getRootNode() as Document | ShadowRoot;
  const ids = [element.getAttribute("aria-errormessage"), element.getAttribute("aria-describedby")]
    .flatMap(value => (value ?? "").split(/\s+/)).filter(Boolean);
  const explicitError = ids.some(id => {
    const node = root.getElementById(id);
    return node instanceof HTMLElement && composedVisible(node) && Boolean(node.textContent?.trim())
      && (node.matches('[role="alert"],.field-error,.validation-error,[data-invalid="true"]') || element.getAttribute("aria-errormessage")?.split(/\s+/).includes(id));
  });
  return explicitError ? true : unknown ? null : false;
}

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function inputValue(element: HTMLElement): string | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? "";
  return element.getAttribute("data-value") ?? element.getAttribute("aria-valuetext") ?? element.textContent;
}

function tokens(option: { key: string | null; label: string; aliases: string[] }): Set<string> {
  return new Set([option.key, option.label, ...option.aliases].filter((value): value is string => Boolean(value)).map(normalize));
}

function readback(element: HTMLElement, request: ExecutionRequest): boolean | null {
  const representation = request.representation;
  const validationError = hasValidationError(element);
  if (validationError === true) return false;
  if (validationError === null) return null;
  if (representation.kind === "FILE") {
    if (!(element instanceof HTMLInputElement) || element.type !== "file" || !element.files) return null;
    const file = element.files[0];
    if (element.files.length !== 1 || !file) return false;
    const container = element.closest(".field,.form-field,.question,[data-field],fieldset,[role=group]") ?? element.parentElement;
    const visibleError = container ? [...container.querySelectorAll<HTMLElement>('[role="alert"],.field-error,.validation-error,[data-invalid="true"]')]
      .some((candidate) => candidate.getClientRects().length > 0 && Boolean(candidate.textContent?.trim())) : false;
    if (visibleError) return false;
    return file.name === representation.fileName
      && file.size === representation.byteSize
      && (!file.type || file.type === representation.mimeType);
  }
  if (representation.kind === "TEXT" || representation.kind === "DATE") {
    const expected = representation.kind === "TEXT" ? representation.text : representation.rendered;
    const actual = inputValue(element);
    return actual === null ? null : normalize(actual) === normalize(expected);
  }
  if (representation.kind === "BOOLEAN") {
    if (element instanceof HTMLInputElement && element.type === "checkbox") return element.checked === representation.checked;
    const state = element.getAttribute("aria-checked");
    return state === null ? null : (state === "true") === representation.checked;
  }
  if (representation.kind === "SINGLE_OPTION") {
    const expected = tokens(representation.option);
    if (element instanceof HTMLSelectElement) {
      const selected = element.selectedOptions[0];
      return Boolean(selected && (expected.has(normalize(selected.value)) || expected.has(normalize(selected.label))));
    }
    if (element instanceof HTMLInputElement && element.type === "radio") {
      const selected = selectedRadio(element);
      if (!(selected instanceof HTMLInputElement)) return false;
      return expected.has(normalize(selected.value)) || expected.has(normalize(radioOptionLabel(selected)));
    }
    if (["radio", "radiogroup"].includes(element.getAttribute("role") ?? "")) {
      const selected = selectedRadio(element);
      return selected ? expected.has(normalize(selected.getAttribute("data-value") ?? "")) || expected.has(normalize(radioOptionLabel(selected))) : false;
    }
    const expanded = element.getAttribute("aria-expanded");
    const committed = inputValue(element);
    if (expanded === "true") return false;
    return committed === null ? null : expected.has(normalize(committed));
  }
  if (representation.kind === "MULTI_OPTION") {
    if (!(element instanceof HTMLSelectElement)) return null;
    const actual = new Set([...element.selectedOptions].flatMap((selected) => [normalize(selected.value), normalize(selected.label)]));
    return representation.options.every((expected) => [...tokens(expected)].some((item) => actual.has(item))) && element.selectedOptions.length === representation.options.length;
  }
  return null;
}

export class IndependentFieldVerifier {
  constructor(
    private readonly registry: FieldRegistry,
    private readonly currentPageInstanceId: () => string,
    private readonly refreshBindings: (() => void) | null = null
  ) {}

  async verify(request: ExecutionRequest): Promise<VerificationResult> {
    const delays = [0, 40, 120, 250];
    let unverifiable = false;
    let verified = false;
    let validationFailed = false;
    for (const delay of delays) {
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (this.currentPageInstanceId() !== request.pageInstanceId) return { status: "PAGE_TRANSITIONED", failureClass: "PAGE_TRANSITIONED" };
      let element = this.registry.get(request.fieldRuntimeId);
      if (!element && this.refreshBindings) {
        this.refreshBindings();
        element = this.registry.get(request.fieldRuntimeId);
      }
      if (!element) continue;
      validationFailed = hasValidationError(element) === true;
      const result = readback(element, request);
      verified = result === true;
      if (result === null) unverifiable = true;
    }
    if (!this.registry.get(request.fieldRuntimeId)) return { status: "STALE_FIELD", failureClass: "FIELD_DETACHED" };
    if (validationFailed) return { status: "FAILED", failureClass: "CONTROL_VALIDATION_FAILED", evidenceLevel: "NONE" };
    if (verified) return { status: "VERIFIED", failureClass: null, evidenceLevel: "DOM_READBACK" };
    if (unverifiable) return { status: "UNVERIFIABLE", failureClass: "VERIFICATION_FAILED" };
    return { status: "FAILED", failureClass: "VERIFICATION_FAILED" };
  }
}
