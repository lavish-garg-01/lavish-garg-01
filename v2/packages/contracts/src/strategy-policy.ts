import { z } from "zod";

export const StrategyKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,90}@[1-9][0-9]{0,5}$/);
export const BuiltinStrategyKeySchema = z.enum([
  "NATIVE_VALUE_SETTER@1", "DIRECT_PROPERTY_EVENTS_FALLBACK@1", "CONTENTEDITABLE_TEXT@1",
  "NATIVE_SELECT_EXACT@1", "NATIVE_MULTISELECT_EXACT@1", "NATIVE_CHECKED_SETTER@1",
  "NATIVE_RADIO_EXACT_LABEL@1", "ARIA_COMBOBOX_EXACT_OPTION@1", "ARIA_RADIO_EXACT_LABEL@1", "ARIA_TOGGLE@1"
]);
// No selectors, literal values, arbitrary keys, network, navigation, submission or code.
// These native text primitives use only K's already-authorized target/representation.
export const StrategyPrimitiveSchema = z.enum(["FOCUS", "SET_NATIVE_VALUE", "SET_DIRECT_VALUE", "INPUT", "CHANGE", "BLUR"]);
export const StrategyPlanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BUILTIN"), implementation: BuiltinStrategyKeySchema }).strict(),
  z.object({ kind: z.literal("TARGET_TEXT"), steps: z.array(StrategyPrimitiveSchema).min(3).max(8) }).strict()
]);
export const StrategySelectionSchema = z.object({
  policyVersion: z.literal("Q1-2026-09"),
  revision: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime().optional(),
  cluster: z.string().regex(/^[a-f0-9]{64}$/),
  experimentId: z.uuid().nullable(),
  arm: z.enum(["STABLE", "CONTROL", "TREATMENT"]),
  strategies: z.array(z.object({ key: StrategyKeySchema, plan: StrategyPlanSchema }).strict()).max(10)
}).strict();
export type StrategySelection = z.infer<typeof StrategySelectionSchema>;
export type StrategyPlan = z.infer<typeof StrategyPlanSchema>;
export const StrategyFeedbackSchema = z.object({
  pattern: z.array(z.enum(["FOCUS", "TYPE", "OPTIONS_APPEARED", "ARROW_DOWN", "ENTER", "BLUR"])).max(12),
  committed: z.boolean(), feedback: z.enum(["NONE", "KEPT", "OVERWRITTEN"])
}).strict();
export type StrategyFeedback = z.infer<typeof StrategyFeedbackSchema>;

// Metadata authority; executor classes retain mechanics, not a second priority list.
export const BUILTIN_STRATEGIES = [
  { key: "NATIVE_VALUE_SETTER@1", priority: 100, capabilities: ["NATIVE_TEXT", "NATIVE_TEXTAREA", "NATIVE_NUMBER", "NATIVE_DATE", "NATIVE_MONTH"], representations: ["TEXT", "DATE"] },
  { key: "DIRECT_PROPERTY_EVENTS_FALLBACK@1", priority: 40, capabilities: ["NATIVE_TEXT", "NATIVE_TEXTAREA", "NATIVE_NUMBER", "NATIVE_DATE", "NATIVE_MONTH"], representations: ["TEXT", "DATE"] },
  { key: "CONTENTEDITABLE_TEXT@1", priority: 90, capabilities: ["CONTENTEDITABLE"], representations: ["TEXT"] },
  { key: "NATIVE_SELECT_EXACT@1", priority: 100, capabilities: ["NATIVE_SELECT"], representations: ["SINGLE_OPTION"] },
  { key: "NATIVE_MULTISELECT_EXACT@1", priority: 100, capabilities: ["NATIVE_MULTISELECT"], representations: ["MULTI_OPTION"] },
  { key: "NATIVE_CHECKED_SETTER@1", priority: 100, capabilities: ["NATIVE_CHECKBOX", "TOGGLE"], representations: ["BOOLEAN"] },
  { key: "NATIVE_RADIO_EXACT_LABEL@1", priority: 100, capabilities: ["NATIVE_RADIO"], representations: ["SINGLE_OPTION"] },
  { key: "ARIA_COMBOBOX_EXACT_OPTION@1", priority: 95, capabilities: ["ARIA_COMBOBOX", "SEARCHABLE_SELECT", "CUSTOM_LISTBOX"], representations: ["SINGLE_OPTION"] },
  { key: "ARIA_RADIO_EXACT_LABEL@1", priority: 90, capabilities: ["CUSTOM_RADIO_GROUP"], representations: ["SINGLE_OPTION"] },
  { key: "ARIA_TOGGLE@1", priority: 80, capabilities: ["TOGGLE"], representations: ["BOOLEAN"] }
] as const;

export function safeStrategyPlan(plan: unknown): StrategyPlan | null {
  const parsed = StrategyPlanSchema.safeParse(plan);
  if (!parsed.success) return null;
  if (parsed.data.kind === "BUILTIN") return parsed.data;
  const steps = parsed.data.steps;
  const setters = steps.filter((step) => step === "SET_NATIVE_VALUE" || step === "SET_DIRECT_VALUE");
  if (setters.length !== 1 || new Set(steps).size !== steps.length) return null;
  const setter = Math.max(steps.indexOf("SET_NATIVE_VALUE"), steps.indexOf("SET_DIRECT_VALUE"));
  if (!steps.includes("INPUT") || !steps.includes("CHANGE") || setter > steps.indexOf("INPUT") || steps.indexOf("INPUT") > steps.indexOf("CHANGE")) return null;
  if (steps.includes("FOCUS") && steps[0] !== "FOCUS") return null;
  if (steps.includes("BLUR") && steps.at(-1) !== "BLUR") return null;
  return parsed.data;
}
