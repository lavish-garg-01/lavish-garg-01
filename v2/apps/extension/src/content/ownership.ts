import type { FieldOwnership } from "../shared/contracts.js";
import type { StrategyFeedback } from "@job-hunter-v2/contracts";

export class FieldOwnershipTracker {
  private readonly ownership = new Map<string, FieldOwnership>();
  private readonly fields = new WeakMap<HTMLElement, string>();
  private readonly programmatic = new WeakSet<HTMLElement>();
  private installed = false;
  private readonly patterns = new Map<string, StrategyFeedback["pattern"]>();
  interactionPattern(fieldRuntimeId: string): StrategyFeedback["pattern"] { return [...(this.patterns.get(fieldRuntimeId) ?? [])]; }
  private readonly candidateChangeListeners = new Set<(fieldRuntimeId: string, event: Event) => void>();

  onCandidateChange(listener: (fieldRuntimeId: string, event: Event) => void): () => void {
    this.candidateChangeListeners.add(listener);
    return () => this.candidateChangeListeners.delete(listener);
  }

  bind(fieldRuntimeId: string, element: HTMLElement): void {
    this.fields.set(element, fieldRuntimeId);
    if (!this.ownership.has(fieldRuntimeId)) this.ownership.set(fieldRuntimeId, "UNKNOWN");
  }

  install(document: Document): void {
    if (this.installed) return;
    this.installed = true;
    const observe = (event: Event) => {
      if (!event.isTrusted) return;
      // Custom radio/toggle labels may contain spans. Attribute a trusted event
      // to the nearest registered control in its composed path, not only its leaf.
      const target = event.composedPath().find(node => node instanceof HTMLElement && this.fields.has(node));
      // Browser-dispatched Copilot events are untrusted. A trusted event must
      // always transfer ownership to the candidate, even while an async
      // Copilot operation currently has the element marked programmatic.
      if (!(target instanceof HTMLElement)) return;
      const fieldRuntimeId = this.fields.get(target);
      if (fieldRuntimeId) {
        const pattern = this.patterns.get(fieldRuntimeId) ?? [];
        const step = event.type === "pointerdown" ? "FOCUS" : event.type === "input" ? "TYPE"
          : event instanceof KeyboardEvent && event.key === "ArrowDown" ? "ARROW_DOWN"
            : event instanceof KeyboardEvent && event.key === "Enter" ? "ENTER" : null;
        if (step && pattern.at(-1) !== step && pattern.length < 12) pattern.push(step);
        if (this.patterns.size < 500 || this.patterns.has(fieldRuntimeId)) this.patterns.set(fieldRuntimeId, pattern);
        this.ownership.set(fieldRuntimeId, "USER_OWNED");
        if (event.type === "change") for (const listener of this.candidateChangeListeners) listener(fieldRuntimeId, event);
      }
    };
    // pointerdown captures an intentional focus before a strategy can act;
    // programmatic HTMLElement.focus() may itself produce a trusted focus event
    // in Chromium and therefore is not used as an ownership signal.
    for (const type of ["pointerdown", "beforeinput", "input", "change", "click", "keydown", "paste"]) document.addEventListener(type, observe, true);
  }

  ownershipOf(fieldRuntimeId: string): FieldOwnership { return this.ownership.get(fieldRuntimeId) ?? "UNKNOWN"; }
  canAutomate(fieldRuntimeId: string): boolean { return this.ownershipOf(fieldRuntimeId) !== "USER_OWNED"; }
  markShared(fieldRuntimeId: string): void { if (this.ownershipOf(fieldRuntimeId) !== "USER_OWNED") this.ownership.set(fieldRuntimeId, "SHARED"); }
  markCopilotOwned(fieldRuntimeId: string): void { if (this.canAutomate(fieldRuntimeId)) this.ownership.set(fieldRuntimeId, "COPILOT_OWNED"); }
  markUserOwned(fieldRuntimeId: string): void { this.ownership.set(fieldRuntimeId, "USER_OWNED"); }

  async withCopilotMutation<T>(fieldRuntimeId: string, element: HTMLElement, operation: () => T | Promise<T>): Promise<T> {
    if (!this.canAutomate(fieldRuntimeId)) throw new Error("FIELD_USER_OWNED");
    this.programmatic.add(element);
    this.markCopilotOwned(fieldRuntimeId);
    try { return await operation(); }
    finally { queueMicrotask(() => this.programmatic.delete(element)); }
  }
}
