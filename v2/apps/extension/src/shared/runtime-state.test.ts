import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionRuntimeError } from "./errors.js";
import { RuntimeStateMachine } from "./runtime-state.js";

test("runtime state machine accepts the Phase I discovery lifecycle", () => {
  const machine = new RuntimeStateMachine();
  machine.transition("PAGE_DETECTED", "page");
  machine.transition("APPLICATION_DETECTED", "application");
  machine.transition("SCANNING", "scan");
  machine.transition("READY", "ready");
  machine.transition("INTERACTING", "future-boundary");
  machine.transition("VERIFYING", "future-boundary");
  machine.transition("CHECKPOINT", "accepted");
  assert.equal(machine.state, "CHECKPOINT");
  assert.equal(machine.history.length, 7);
});

test("unsupported pages can be rescanned after dynamic form insertion", () => {
  const machine = new RuntimeStateMachine("UNSUPPORTED");
  machine.transition("SCANNING", "structural-mutation");
  machine.transition("READY", "fields-discovered");
  assert.equal(machine.state, "READY");
});

test("empty scans on a known application stay detected instead of unsupported", () => {
  const machine = new RuntimeStateMachine("SCANNING");
  machine.transition("APPLICATION_DETECTED", "application-fields-pending");
  machine.transition("SCANNING", "structural-mutation");
  machine.transition("READY", "fields-discovered");
  assert.equal(machine.state, "READY");
});

test("invalid transitions fail closed", () => {
  const machine = new RuntimeStateMachine("IDLE");
  assert.throws(() => machine.transition("VERIFYING", "invalid"), ExtensionRuntimeError);
  assert.equal(machine.state, "IDLE");
});
