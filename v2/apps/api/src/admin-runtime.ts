import { z } from "zod";
import { RepresentationResolver, RepresentationError } from "@job-hunter-v2/execution";
import { aliasRules, canonicalDefinitionFor, configureCanonicalAliases } from "@job-hunter-v2/field-intelligence";
import { candidateAnswerPolicy } from "@job-hunter-v2/candidate-truth";

export const canonicalSettings = z.object({ description: z.string().max(2000), aliases: z.array(z.string().trim().min(3).max(160)).max(40) }).strict();
export const representationSettings = z.object({ enabled: z.boolean(), moneyScale: z.enum(["AUTO", "RUPEES", "LAKHS"]).default("AUTO"), experienceUnit: z.enum(["AUTO", "YEARS", "MONTHS"]).default("AUTO"), notes: z.string().max(2000).default("") }).strict();
export const proposalSettings = z.object({ description: z.string().min(1).max(2000), valueType: z.enum(["STRING","INTEGER","DECIMAL","BOOLEAN","DATE","URL","MONEY","DURATION","ENUM","MULTI_ENUM","RICH_TEXT"]), aliases: z.array(z.string().min(3).max(160)).max(40), status: z.enum(["PROPOSED","IN_REVIEW","APPROVED_FOR_IMPLEMENTATION","REJECTED"]), notes: z.string().max(2000) }).strict();
export interface AdminConfiguration { kind: string; key: string; revision: number; value: unknown }

export function validateAdminConfiguration(kind: string, key: string, value: unknown): unknown {
  if (kind === "PROPOSAL") return proposalSettings.parse(value);
  if (!canonicalDefinitionFor(key)) throw new Error("UNKNOWN_CANONICAL");
  if (kind === "CANONICAL") {
    const parsed = canonicalSettings.parse(value), policy = candidateAnswerPolicy(key);
    if (parsed.aliases.length && ["LEGAL_FACT","CONSENT","PROTECTED"].includes(policy.answerClass)) throw new Error("Protected field aliases require a code-reviewed policy change.");
    if(parsed.aliases.length && !aliasRules().some(r=>r.canonicalKey===key)) throw new Error("Protected field: this canonical needs a code-reviewed semantic rule before aliases can be added.");
    return parsed;
  }
  const parsed = representationSettings.parse(value);
  if (parsed.moneyScale !== "AUTO" && !["CURRENT_CTC","EXPECTED_CTC"].includes(key)) throw new Error("Money scale applies only to compensation fields.");
  if (parsed.experienceUnit !== "AUTO" && key !== "TOTAL_EXPERIENCE") throw new Error("Experience units apply only to total experience.");
  return parsed;
}

export class AdminRepresentationResolver extends RepresentationResolver {
  private rules = new Map<string, { revision: number; value: z.infer<typeof representationSettings> }>();
  override isEnabled(canonicalKey: string): boolean { return this.rules.get(canonicalKey)?.value.enabled ?? true; }
  load(rows: AdminConfiguration[]) {
    const next = new Map<string, { revision: number; value: z.infer<typeof representationSettings> }>(), aliases = new Map<string, string[]>();
    for (const row of rows) {
      if (row.kind === "REPRESENTATION") next.set(row.key, { revision: row.revision, value: representationSettings.parse(validateAdminConfiguration(row.kind, row.key, row.value)) });
      if (row.kind === "CANONICAL") aliases.set(row.key, canonicalSettings.parse(validateAdminConfiguration(row.kind, row.key, row.value)).aliases);
    }
    this.rules = next; configureCanonicalAliases(aliases);
  }
  override resolve(...[value, field, meaning = {}]: Parameters<RepresentationResolver["resolve"]>) {
    const rule = meaning.canonicalKey ? this.rules.get(meaning.canonicalKey) : undefined;
    if (!rule) return super.resolve(value, field, meaning);
    if (!rule.value.enabled) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "ADMIN_REPRESENTATION_DISABLED");
    const context = [...field.labelEvidence, field.locatorEvidence.placeholder, field.contextEvidence.nearbyDescription].join(" ").toLowerCase();
    let hint = "";
    // Site-specified units take precedence; overrides only supply missing display units.
    if (value.kind === "MONEY" && !/lakh|lpa|crore|million|thousand|rupee|\binr\b|\busd\b|\beur\b|[₹$€]|monthly|annual|yearly|per month|per year/.test(context)) {
      hint = rule.value.moneyScale === "RUPEES" ? "amount in rupees" : rule.value.moneyScale === "LAKHS" ? "amount in lakhs" : "";
      if (hint && value.currency !== "INR") hint = "";
    }
    if (value.kind === "DURATION" && !/years?|months?|days?|weeks?/.test(context)) hint = rule.value.experienceUnit === "AUTO" ? "" : rule.value.experienceUnit.toLowerCase();
    const result = super.resolve(value, hint ? { ...field, contextEvidence: { ...field.contextEvidence, nearbyDescription: `${field.contextEvidence.nearbyDescription ?? ""} ${hint}` } } : field, meaning);
    return hint ? { ...result, representationId: result.representationId.replace(/@\d+$/, `_ADMIN@${rule.revision}`) } : result;
  }
}
