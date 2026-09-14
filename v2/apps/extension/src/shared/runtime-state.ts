import { z } from "zod";
import { ExtensionRuntimeError, failure } from "./errors.js";

export const RuntimeStateSchema = z.enum([
  "IDLE",
  "PAGE_DETECTED",
  "APPLICATION_DETECTED",
  "SCANNING",
  "READY",
  "INTERACTING",
  "VERIFYING",
  "WAITING_FOR_USER",
  "CHECKPOINT",
  "UNSUPPORTED",
  "RECOVERING",
  "FAILED"
]);
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

const transitions: Readonly<Record<RuntimeState, ReadonlySet<RuntimeState>>> = {
  IDLE: new Set(["PAGE_DETECTED", "RECOVERING", "FAILED"]),
  PAGE_DETECTED: new Set(["APPLICATION_DETECTED", "SCANNING", "UNSUPPORTED", "FAILED", "RECOVERING"]),
  APPLICATION_DETECTED: new Set(["SCANNING", "WAITING_FOR_USER", "FAILED", "RECOVERING"]),
  SCANNING: new Set(["READY", "APPLICATION_DETECTED", "UNSUPPORTED", "FAILED", "RECOVERING"]),
  READY: new Set(["SCANNING", "INTERACTING", "WAITING_FOR_USER", "CHECKPOINT", "RECOVERING", "FAILED"]),
  INTERACTING: new Set(["VERIFYING", "WAITING_FOR_USER", "RECOVERING", "FAILED"]),
  VERIFYING: new Set(["READY", "WAITING_FOR_USER", "CHECKPOINT", "RECOVERING", "FAILED"]),
  WAITING_FOR_USER: new Set(["SCANNING", "READY", "CHECKPOINT", "RECOVERING", "FAILED"]),
  CHECKPOINT: new Set(["READY", "SCANNING", "RECOVERING", "FAILED"]),
  UNSUPPORTED: new Set(["PAGE_DETECTED", "SCANNING", "RECOVERING", "FAILED"]),
  RECOVERING: new Set(["PAGE_DETECTED", "APPLICATION_DETECTED", "SCANNING", "READY", "UNSUPPORTED", "FAILED"]),
  FAILED: new Set(["RECOVERING", "PAGE_DETECTED"])
};

export interface RuntimeTransition {
  from: RuntimeState;
  to: RuntimeState;
  reason: string;
  occurredAt: string;
}

export class RuntimeStateMachine {
  private currentState: RuntimeState;
  private readonly historyEntries: RuntimeTransition[] = [];

  constructor(initial: RuntimeState = "IDLE") {
    this.currentState = RuntimeStateSchema.parse(initial);
  }

  get state(): RuntimeState { return this.currentState; }
  get history(): readonly RuntimeTransition[] { return this.historyEntries; }

  canTransition(to: RuntimeState): boolean {
    return to === this.currentState || transitions[this.currentState].has(to);
  }

  transition(to: RuntimeState, reason: string, occurredAt = new Date().toISOString()): RuntimeTransition {
    RuntimeStateSchema.parse(to);
    if (to === this.currentState) return { from: to, to, reason, occurredAt };
    if (!this.canTransition(to)) {
      throw new ExtensionRuntimeError(failure("RUNTIME_STATE_INVALID", `Cannot transition runtime from ${this.currentState} to ${to}.`, {
        metadata: { from: this.currentState, to }
      }));
    }
    const transition = { from: this.currentState, to, reason: reason.slice(0, 120), occurredAt };
    this.currentState = to;
    this.historyEntries.push(transition);
    if (this.historyEntries.length > 50) this.historyEntries.shift();
    return transition;
  }
}
