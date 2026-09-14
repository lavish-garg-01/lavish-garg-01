import { createHash } from "node:crypto";
import {
  FieldEvidenceInputSchema,
  type FieldEvidenceInput,
  type FieldIntelligencePageContext,
  type SemanticControlType
} from "@job-hunter-v2/contracts";

const pii = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " [email] "],
  [/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi, " [url] "],
  [/(?<!\d)(?:\+?\d[\s().-]*){8,15}(?!\d)/g, " [phone] "],
  [/\b\d{12,}\b/g, " [identifier] "]
] as const;

export function sanitizeSemanticText(value: string | null | undefined, maximum = 300): string {
  let result = String(value ?? "").normalize("NFKC");
  for (const [pattern, replacement] of pii) result = result.replace(pattern, replacement);
  return result.replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function normalizeSemanticText(value: string | null | undefined): string {
  return sanitizeSemanticText(value, 300)
    .toLowerCase()
    .replace(/₹|\binr\b/g, " rupees ")
    .replace(/\borganisation\b/g, "organization")
    .replace(/\bpresent(?:ly)?\b/g, "current")
    .replace(/\bmobile\b|\btelephone\b/g, "phone")
    .replace(/\bcompensation\b|\bctc\b/g, "salary")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9+#.[\]-]+/g, " ")
    .replace(/\b(?:please|kindly|enter|provide|select|choose|your|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countryCode(text: string): string | null {
  const normalized = normalizeSemanticText(text);
  const countries: readonly [RegExp, string][] = [
    [/\bindia\b|\bindian\b/, "IN"], [/\bunited states\b|\busa\b|\bu s\b/, "US"],
    [/\bunited kingdom\b|\buk\b/, "GB"], [/\bcanada\b/, "CA"], [/\baustralia\b/, "AU"],
    [/\bsingapore\b/, "SG"], [/\bgermany\b/, "DE"], [/\bfrance\b/, "FR"], [/\buae\b|\bunited arab emirates\b/, "AE"]
  ];
  return countries.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export interface NormalizedFieldEvidence {
  fieldRuntimeId: string;
  descriptorFingerprint: string;
  controlType: SemanticControlType;
  label: string;
  normalizedLabel: string;
  section: string;
  normalizedSection: string;
  previousLabel: string;
  nextLabel: string;
  attributes: { ariaLabel: string; placeholder: string; name: string; id: string; autocomplete: string; role: string; accessibleDescription: string };
  optionSamples: readonly string[];
  nearbyDescription: string;
  pageHeading: string;
  ats: string;
  host: string;
  countryCodeHint: string | null;
  required: boolean;
  disabled: boolean;
  repeatableEvidence: FieldEvidenceInput["repeatableEvidence"];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function normalizeFieldEvidence(raw: FieldEvidenceInput, page: FieldIntelligencePageContext): NormalizedFieldEvidence {
  const input = FieldEvidenceInputSchema.parse(raw);
  const labels = input.labelEvidence.map((value) => sanitizeSemanticText(value, 180)).filter(Boolean);
  const label = labels[0] ?? sanitizeSemanticText(input.locatorEvidence.ariaLabel ?? input.locatorEvidence.placeholder ?? input.locatorEvidence.name, 180);
  const section = sanitizeSemanticText(input.contextEvidence.section, 180);
  const attributes = {
    ariaLabel: sanitizeSemanticText(input.locatorEvidence.ariaLabel, 180),
    placeholder: sanitizeSemanticText(input.locatorEvidence.placeholder, 180),
    name: sanitizeSemanticText(input.locatorEvidence.name, 160),
    id: sanitizeSemanticText(input.locatorEvidence.id, 160),
    autocomplete: sanitizeSemanticText(input.locatorEvidence.autocomplete, 100),
    role: sanitizeSemanticText(input.locatorEvidence.role, 80),
    accessibleDescription: sanitizeSemanticText(input.locatorEvidence.accessibleDescription, 300)
  };
  const optionSamples = input.optionEvidence.samples.map((value) => sanitizeSemanticText(value, 120)).filter(Boolean);
  const context = {
    controlType: input.controlType,
    label: normalizeSemanticText(label),
    section: normalizeSemanticText(section),
    previous: normalizeSemanticText(input.contextEvidence.previousLabel),
    next: normalizeSemanticText(input.contextEvidence.nextLabel),
    attributes: Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, normalizeSemanticText(value)])),
    options: optionSamples.map(normalizeSemanticText),
    repeatable: input.repeatableEvidence,
    ats: page.ats.toUpperCase(),
    host: page.host.toLowerCase(),
    countryCode: page.countryCode
  };
  const allText = [label, section, input.contextEvidence.previousLabel, input.contextEvidence.nextLabel, attributes.ariaLabel, attributes.placeholder].join(" ");
  return {
    fieldRuntimeId: input.fieldRuntimeId,
    descriptorFingerprint: createHash("sha256").update(JSON.stringify(stable(context))).digest("hex"),
    controlType: input.controlType,
    label,
    normalizedLabel: normalizeSemanticText(label),
    section,
    normalizedSection: normalizeSemanticText(section),
    previousLabel: sanitizeSemanticText(input.contextEvidence.previousLabel, 180),
    nextLabel: sanitizeSemanticText(input.contextEvidence.nextLabel, 180),
    attributes,
    optionSamples,
    nearbyDescription: sanitizeSemanticText(input.contextEvidence.nearbyDescription, 300),
    pageHeading: sanitizeSemanticText(input.contextEvidence.pageHeading ?? page.pageHeading, 180),
    ats: page.ats.toUpperCase(),
    host: page.host.toLowerCase(),
    countryCodeHint: countryCode(allText),
    required: input.required,
    disabled: input.disabled,
    repeatableEvidence: input.repeatableEvidence
  };
}
