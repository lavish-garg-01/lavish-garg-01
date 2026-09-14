import assert from "node:assert/strict";
import test from "node:test";
import { hasValidationError, IndependentFieldVerifier } from "./verifier.js";
import type { ExecutionRequest } from "@job-hunter-v2/contracts";
import type { FieldRegistry } from "./scanner.js";

function control(input: { ariaInvalid?: string; invalidThrows?: boolean; invalid?: boolean } = {}): HTMLElement {
  return {
    getAttribute(name: string) {
      if (name === "aria-invalid") return input.ariaInvalid ?? null;
      return null;
    },
    matches(selector: string) {
      if (selector === ":invalid" && input.invalidThrows) throw new SyntaxError("invalid pattern supplied by employer page");
      return selector === ":invalid" && Boolean(input.invalid);
    },
    getRootNode() {
      return { getElementById: () => null };
    }
  } as unknown as HTMLElement;
}

test("malformed employer patterns cannot abort field verification", () => {
  assert.equal(hasValidationError(control({ invalidThrows: true })), null);
});

test("uninspectable validity cannot produce a verified execution result", async () => {
  const element = control({ invalidThrows: true });
  const registry = { get: () => element } as unknown as FieldRegistry;
  const verifier = new IndependentFieldVerifier(registry, () => "page");
  const result = await verifier.verify({ pageInstanceId: "page", fieldRuntimeId: "field", representation: { kind: "TEXT", text: "value" } } as ExecutionRequest);
  assert.equal(result.status, "UNVERIFIABLE");
  assert.equal(result.failureClass, "VERIFICATION_FAILED");
});

test("explicit and native validation failures still fail closed", () => {
  assert.equal(hasValidationError(control({ ariaInvalid: "true", invalidThrows: true })), true);
  assert.equal(hasValidationError(control({ invalid: true })), true);
});
