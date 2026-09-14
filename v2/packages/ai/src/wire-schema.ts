/** Provider schema subset only. The original Zod schema still validates every
 * response locally, including constraints omitted from the generation schema. */
export function providerWireSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "anyOf", "$ref", "$defs", "definitions", "enum", "description"]);
  function convert(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(convert);
    if (!input || typeof input !== "object") return input;
    const source = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === "const") result.enum = [value];
      else if (key === "oneOf") result.anyOf = convert(value);
      else if (allowed.has(key)) {
        result[key] = ["properties", "$defs", "definitions"].includes(key)
          ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, convert(child)]))
          : convert(value);
      }
    }
    if (result.type === "object" && result.properties) {
      const required = new Set((source.required as string[] | undefined) ?? []);
      const properties = result.properties as Record<string, unknown>;
      for (const key of Object.keys(properties)) if (!required.has(key)) {
        properties[key] = { anyOf: [properties[key], { type: "null" }] };
      }
      result.required = Object.keys(properties);
      result.additionalProperties = false;
    }
    return result;
  }
  return convert(schema) as Record<string, unknown>;
}
