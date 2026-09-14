import crypto from "node:crypto";
import { z } from "zod";

export const FIELD_SEMANTIC_DESCRIPTOR_VERSION = 1;
export const MAX_SEMANTIC_TEXT = 240;
export const MAX_OPTION_SAMPLES = 8;

const text = z.string().max(MAX_SEMANTIC_TEXT);
const neighborSchema = z.object({
    label: text.default(""),
    canonical: z.string().max(140).nullable().default(null)
});

export const fieldSemanticDescriptorSchema = z.object({
    schemaVersion: z.literal(FIELD_SEMANTIC_DESCRIPTOR_VERSION),
    source: z.object({
        label: text,
        normalizedLabel: text,
        controlType: z.string().max(40),
        tag: z.string().max(30).default(""),
        required: z.boolean().default(false),
        optionCount: z.number().int().min(0).max(10000).default(0),
        optionSamples: z.array(text).max(MAX_OPTION_SAMPLES).default([]),
        attributes: z.object({
            name: text.default(""),
            ariaLabel: text.default(""),
            placeholder: text.default(""),
            autocomplete: text.default(""),
            dataAutomationId: text.default(""),
            dataQa: text.default(""),
            dataTestId: text.default("")
        })
    }),
    context: z.object({
        section: text.default(""),
        sectionFamily: z.string().max(80).default(""),
        previous: neighborSchema.default({ label: "", canonical: null }),
        next: neighborSchema.default({ label: "", canonical: null }),
        pageHeading: text.default(""),
        formHeading: text.default("")
    }),
    environment: z.object({
        ats: z.string().max(80).default("generic"),
        host: z.string().max(255).default(""),
        adapterVersion: z.string().max(80).default("")
    }),
    flags: z.object({
        generic: z.boolean().default(false),
        legal: z.boolean().default(false),
        sensitive: z.boolean().default(false),
        skipLearning: z.boolean().default(false)
    }),
    fingerprints: z.object({
        exact: z.string().length(64),
        semantic: z.string().length(64)
    })
}).strict();

const GENERIC = /^(?:select|search|textbox|input|choose|drop or select(?:\s*\([^)]*\))?|field(?:[\s_-]*\d+)?|application field(?:\s+\d+)?)$/i;
const SENSITIVE = /password|passcode|one.?time|\botp\b|captcha|verification\s+(?:code|challenge)|cookie|aadhaar|passport|social security|national id|medical|health|disability|race|ethnic|religion|gender|sexual/i;
const LEGAL = /consent|privacy|terms|declaration|certif|signature|confirm.{0,25}(?:true|accurate)|agree.{0,25}(?:terms|policy)|authorize/i;

export function normalizeSemanticText(value = "") {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/₹|\binr\b/g, " rupees ")
        .replace(/\borganisation\b/g, "organization")
        .replace(/\bpresent(?:ly)?\b/g, "current")
        .replace(/[^a-z0-9+#.]+/g, " ")
        .replace(/\b(?:please|kindly|enter|provide|select|your|the|a|an)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_SEMANTIC_TEXT);
}

function safeText(value = "", limit = MAX_SEMANTIC_TEXT) {
    return String(value || "")
        .normalize("NFKC")
        // Employer labels occasionally interpolate a candidate identifier
        // (for example, "Email for person@example.com"). Shared semantic
        // learning needs the field meaning, never that identifier.
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
        .replace(/\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi, "[url]")
        .replace(/(?<!\d)(?:\+?\d[\s().-]*){8,15}(?!\d)/g, "[phone]")
        .replace(/\b\d{12,}\b/g, "[identifier]")
        .replace(/\s+/g, " ").trim().slice(0, limit);
}

function hash(parts) {
    return crypto.createHash("sha256").update(parts.map((part) => String(part || "")).join("|")).digest("hex");
}

function optionText(option) {
    if (option && typeof option === "object") return safeText(option.label || option.value);
    return safeText(option);
}

function semanticContext(field = {}) {
    const context = field.semanticContext || field.context || {};
    const previous = context.previous || field.previousField || {};
    const next = context.next || field.nextField || {};
    return {
        section: safeText(context.section || context.sectionHeading || field.sectionHeading || field.sectionKind),
        sectionFamily: normalizeSemanticText(context.sectionFamily || field.sectionKind || context.section),
        previous: {
            label: safeText(previous.label || context.previousLabel),
            canonical: safeText(previous.canonical || context.previousCanonical, 140) || null
        },
        next: {
            label: safeText(next.label || context.nextLabel),
            canonical: safeText(next.canonical || context.nextCanonical, 140) || null
        },
        pageHeading: safeText(context.pageHeading || field.pageHeading),
        formHeading: safeText(context.formHeading || field.formHeading)
    };
}

/**
 * Converts the extension's richer runtime field object into the only object
 * semantic lookup, embeddings and AI are allowed to consume. Field values and
 * candidate data are deliberately not part of this schema.
 */
export function buildFieldSemanticDescriptor(field = {}, environment = {}) {
    const label = safeText(field.label);
    const normalizedLabel = normalizeSemanticText(label);
    const controlType = normalizeSemanticText(field.type || field.controlKind || "text").slice(0, 40) || "text";
    const options = Array.isArray(field.options) ? field.options.map(optionText).filter(Boolean) : [];
    const context = semanticContext(field);
    const attributes = field.attributes || {};
    const source = {
        label,
        normalizedLabel,
        controlType,
        tag: normalizeSemanticText(field.tag || attributes.tag).slice(0, 30),
        required: Boolean(field.required),
        optionCount: Math.min(10000, Number(field.optionCount ?? options.length) || 0),
        optionSamples: [...new Set(options)].slice(0, MAX_OPTION_SAMPLES),
        attributes: {
            name: safeText(field.name || attributes.name),
            ariaLabel: safeText(field.ariaLabel || attributes.ariaLabel),
            placeholder: safeText(field.placeholder || attributes.placeholder),
            autocomplete: safeText(field.autocomplete || attributes.autocomplete),
            dataAutomationId: safeText(field.dataAutomationId || attributes.dataAutomationId),
            dataQa: safeText(field.dataQa || attributes.dataQa),
            dataTestId: safeText(field.dataTestId || attributes.dataTestId)
        }
    };
    const env = {
        ats: normalizeSemanticText(environment.ats || field.ats || environment.portalKind || "generic").slice(0, 80) || "generic",
        host: safeText(environment.host || field.siteHost, 255).toLowerCase(),
        adapterVersion: safeText(environment.adapterVersion || field.adapterVersion, 80)
    };
    const safetyText = `${label} ${source.attributes.name} ${source.attributes.ariaLabel}`;
    const generic = Boolean(field.generic || GENERIC.test(label) || !normalizedLabel);
    const legal = Boolean(field.legal || LEGAL.test(safetyText));
    const sensitive = Boolean(field.sensitive || SENSITIVE.test(safetyText) || controlType === "password");
    const flags = {
        generic,
        legal,
        sensitive,
        // Protected structure may still be handled locally by the application
        // policy, but it must never enter shared mappings, embeddings, or AI.
        skipLearning: Boolean(field.skipLearning || generic || legal || sensitive)
    };
    const exact = hash([
        env.ats, env.host, normalizedLabel, controlType, context.sectionFamily,
        normalizeSemanticText(source.attributes.name || source.attributes.ariaLabel || source.attributes.autocomplete),
        normalizeSemanticText(field.portalFieldKey || "")
    ]);
    const semantic = hash([
        normalizedLabel, controlType, context.sectionFamily,
        normalizeSemanticText(context.previous.label), normalizeSemanticText(context.next.label),
        source.optionCount, source.optionSamples.map(normalizeSemanticText).join(",")
    ]);
    return fieldSemanticDescriptorSchema.parse({
        schemaVersion: FIELD_SEMANTIC_DESCRIPTOR_VERSION,
        source,
        context,
        environment: env,
        flags,
        fingerprints: { exact, semantic }
    });
}

export function semanticTextForEmbedding(descriptor) {
    const parsed = fieldSemanticDescriptorSchema.parse(descriptor);
    return [
        parsed.source.normalizedLabel,
        parsed.context.section && `section ${parsed.context.section}`,
        parsed.context.previous.label && `previous ${parsed.context.previous.label}`,
        parsed.context.next.label && `next ${parsed.context.next.label}`,
        parsed.source.optionSamples.length && `options ${parsed.source.optionSamples.join(", ")}`
    ].filter(Boolean).join(" | ").slice(0, 1000);
}

export function compactCanonicalizationPayload(descriptor, candidates = []) {
    const parsed = fieldSemanticDescriptorSchema.parse(descriptor);
    return {
        field: { label: parsed.source.label, type: parsed.source.controlType },
        context: {
            section: parsed.context.section,
            previous_label: parsed.context.previous.label,
            previous_canonical: parsed.context.previous.canonical,
            next_label: parsed.context.next.label,
            next_canonical: parsed.context.next.canonical
        },
        candidate_canonicals: candidates.slice(0, 8).map((candidate) => ({
            canonical: candidate.key,
            description: candidate.description,
            similarity: Number(candidate.similarity || 0)
        }))
    };
}

export function richCanonicalizationPayload(descriptor, candidates = []) {
    const parsed = fieldSemanticDescriptorSchema.parse(descriptor);
    return {
        ...compactCanonicalizationPayload(parsed, candidates),
        field: {
            ...compactCanonicalizationPayload(parsed, candidates).field,
            attributes: parsed.source.attributes,
            required: parsed.source.required,
            option_count: parsed.source.optionCount,
            option_samples: parsed.source.optionSamples
        },
        context: {
            ...compactCanonicalizationPayload(parsed, candidates).context,
            page_heading: parsed.context.pageHeading,
            form_heading: parsed.context.formHeading,
            section_family: parsed.context.sectionFamily
        },
        environment: parsed.environment
    };
}
