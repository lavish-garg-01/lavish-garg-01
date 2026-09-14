import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { TASKS } from "./registry.js";
import { providerWireSchema } from "./wire-schema.js";

test("every AI task has a strict provider-compatible schema without weakening local validators", () => {
  for (const task of Object.values(TASKS)) {
    const source = z.toJSONSchema(task.output, { target: "draft-7" });
    const wire = providerWireSchema(source);
    const serialized = JSON.stringify(wire);
    assert.ok(!serialized.includes('"const":'));
    assert.ok(!serialized.includes('"oneOf":'));
    assert.ok(!serialized.includes('"pattern":'));
    assert.ok(task.output.safeParse({ invented: "value" }).success === false);
    function inspect(value: unknown): void {
      if (!value || typeof value !== "object") return;
      const schema = value as Record<string, unknown>;
      if (schema.type === "object" && schema.properties) {
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(schema.required, Object.keys(schema.properties));
      }
      for (const nested of Object.values(value)) inspect(nested);
    }
    inspect(wire);
  }
});
