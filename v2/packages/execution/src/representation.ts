import type { PersistableNormalizedValue } from "@job-hunter-v2/candidate-truth";
import { AnswerUnitError, convertMoney, exactScale, moneyUnits } from "@job-hunter-v2/domain";
import {
  FieldRepresentationSchema,
  type FieldEvidenceInput,
  type FieldRepresentation
} from "@job-hunter-v2/contracts";

export class RepresentationError extends Error {
  constructor(readonly code: "REPRESENTATION_UNSUPPORTED" | "REPRESENTATION_INVALID", readonly reasonCode: string = code) {
    super(code);
    this.name = "RepresentationError";
  }
}

function textContext(field: FieldEvidenceInput): string {
  return [
    ...field.labelEvidence,
    field.contextEvidence.nearbyDescription,
    field.locatorEvidence.placeholder
  ].filter(Boolean).join(" ").toLowerCase();
}

function option(key: string | null, label: string, aliases: readonly string[] = []) {
  return { key, label, aliases: [...new Set([label, ...aliases].filter(Boolean))] };
}

function text(sourceKind: FieldRepresentation["sourceKind"], representationId: string, value: string): FieldRepresentation {
  return FieldRepresentationSchema.parse({
    kind: "TEXT", sourceKind, representationId, policyVersion: 1,
    text: value, containsCandidateValue: true
  });
}

function formatDate(isoDate: string, precision: "DAY" | "MONTH" | "YEAR", field: FieldEvidenceInput): FieldRepresentation {
  const context = textContext(field);
  const requestedPrecision = field.controlType === "DATE" && field.locatorEvidence.type === "month"
    ? "MONTH"
    : field.controlType === "DATE" || /dd[/-]mm|mm[/-]dd/.test(context) ? "DAY"
    : /\byear\b/.test(context) && !/date/.test(context)
      ? "YEAR"
      : precision;
  const rank = { YEAR: 0, MONTH: 1, DAY: 2 };
  if (rank[requestedPrecision] > rank[precision]) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "DATE_PRECISION_INSUFFICIENT");
  const rendered = requestedPrecision === "YEAR" ? isoDate.slice(0, 4)
    : requestedPrecision === "MONTH" ? isoDate.slice(0, 7)
      : isoDate;
  return FieldRepresentationSchema.parse({
    kind: "DATE", sourceKind: "DATE", representationId: `ISO_DATE_${requestedPrecision}@1`,
    policyVersion: 1, isoDate, precision: requestedPrecision, rendered, containsCandidateValue: true
  });
}

export class RepresentationResolver {
  /** Runtime configuration may withdraw a field from future plans, including document flows. */
  isEnabled(canonicalKey: string): boolean { void canonicalKey; return true; }
  resolve(value: PersistableNormalizedValue, field: FieldEvidenceInput, meaning: { canonicalKey?: string; temporalAnchor?: "OFFER_ACCEPTANCE" } = {}): FieldRepresentation {
    try { return this.render(value, field, meaning); }
    catch (error) {
      if (error instanceof AnswerUnitError) throw new RepresentationError("REPRESENTATION_INVALID", error.reasonCode);
      throw error;
    }
  }

  private render(value: PersistableNormalizedValue, field: FieldEvidenceInput, meaning: { canonicalKey?: string; temporalAnchor?: "OFFER_ACCEPTANCE" }): FieldRepresentation {
    const context = textContext(field);
    const choice = ["SELECT", "COMBOBOX", "RADIO"].includes(field.controlType);
    const freeText = ["TEXT", "TEXTAREA", "UNKNOWN"].includes(field.controlType);
    if (field.controlType === "DATE" && value.kind !== "DATE") throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "DATE_REQUIRES_CONFIRMED_ANCHOR");
    switch (value.kind) {
      case "STRING": {
        if (choice) {
          return FieldRepresentationSchema.parse({
            kind: "SINGLE_OPTION", sourceKind: "STRING", representationId: "STRING_EXACT_OPTION@1",
            policyVersion: 1, option: option(null, value.value), containsCandidateValue: true
          });
        }
        return text("STRING", "STRING_TEXT@1", value.value);
      }
      case "RICH_TEXT": return text("RICH_TEXT", "RICH_TEXT_PLAIN@1", value.value);
      case "URL": return text("URL", "URL_TEXT@1", value.value);
      case "ENTITY_REF": {
        if (choice) {
          return FieldRepresentationSchema.parse({
            kind: "SINGLE_OPTION", sourceKind: "ENTITY_REF", representationId: "ENTITY_EXACT_OPTION@1",
            policyVersion: 1, option: option(value.entityId, value.displayLabel), containsCandidateValue: true
          });
        }
        return text("ENTITY_REF", "ENTITY_DISPLAY_LABEL@1", value.displayLabel);
      }
      case "INTEGER": {
        if (meaning.canonicalKey === "NOTICE_PERIOD" || /\bnotice period\b|when can you join|joining availability/i.test(context)) {
          if (!Number.isSafeInteger(value.value) || value.value < 0) throw new RepresentationError("REPRESENTATION_INVALID");
          if (/\bdate\b|dd[/-]mm|yyyy/.test(context)) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "DATE_REQUIRES_CONFIRMED_ANCHOR");
          if (/\bmonths?\b/.test(context)) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "CALENDAR_MONTH_NOTICE_AMBIGUOUS");
          const weeks = /\bweeks?\b/.test(context);
          const explicitUnit = /\b(?:days?|weeks?)\b/.test(context);
          if (field.controlType === "NUMBER" && !explicitUnit) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "NOTICE_UNIT_AMBIGUOUS");
          const amount = weeks ? exactScale(String(value.value), 1n, 7n) : String(value.value);
          if (choice) {
            let matches = field.optionEvidence.samples.filter(label => label.trim().toLowerCase() === `${amount} ${weeks ? 'weeks' : 'days'}` || (explicitUnit && label.trim() === amount) || (value.value === 0 && /^immediate(?: joiner)?$/i.test(label.trim())));
            if (!matches.length) {
              const upperBounds = field.optionEvidence.samples.flatMap(label => {
                const match = label.trim().match(/^less than (\d+) days?$/i);
                return match && value.value < Number(match[1]) ? [{ label, bound: Number(match[1]) }] : [];
              }).sort((a, b) => a.bound - b.bound);
              if (upperBounds.length) matches = upperBounds.filter(item => item.bound === upperBounds[0]!.bound).map(item => item.label);
              else matches = field.optionEvidence.samples.filter(label => {
                if (/^immediate(?: joiner)?$/i.test(label.trim())) return value.value === 0;
                const range = label.trim().match(/^(\d+)\s*(?:to|[-–])\s*(\d+)\s*days?$/i);
                return range !== null && value.value >= Number(range[1]) && value.value <= Number(range[2]);
              });
            }
            if (matches.length !== 1) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "NOTICE_OPTION_AMBIGUOUS");
            return FieldRepresentationSchema.parse({ kind: "SINGLE_OPTION", sourceKind: "INTEGER", representationId: "NOTICE_EXACT_OPTION@2", policyVersion: 1, option: option(null, matches[0]!), containsCandidateValue: true });
          }
          const rendered = !freeText || explicitUnit ? amount
            : meaning.temporalAnchor === "OFFER_ACCEPTANCE" ? `${value.value} days after offer acceptance` : `${value.value} days' notice`;
          return text("INTEGER", "NOTICE_QUALIFIED_TEXT@2", rendered);
        }
        return text("INTEGER", "INTEGER_TEXT@1", String(value.value));
      }
      case "DECIMAL": return text("DECIMAL", "DECIMAL_EXACT_TEXT@1", value.valueExact);
      case "BOOLEAN": {
        if (field.controlType === "CHECKBOX") {
          return FieldRepresentationSchema.parse({
            kind: "BOOLEAN", sourceKind: "BOOLEAN", representationId: "BOOLEAN_CHECKED@1",
            policyVersion: 1, checked: value.value, containsCandidateValue: true
          });
        }
        const label = value.value ? "Yes" : "No";
        if (freeText) return text("BOOLEAN", "BOOLEAN_YES_NO_TEXT@2", label);
        if (!choice) throw new RepresentationError("REPRESENTATION_UNSUPPORTED");
        return FieldRepresentationSchema.parse({
          kind: "SINGLE_OPTION", sourceKind: "BOOLEAN", representationId: "BOOLEAN_YES_NO_OPTION@1",
          policyVersion: 1, option: option(value.value ? "true" : "false", label, value.value ? ["Y", "True"] : ["N", "False"]),
          containsCandidateValue: true
        });
      }
      case "DURATION": {
        if (!Number.isSafeInteger(value.months) || value.months < 0 || value.months > 1200) throw new RepresentationError("REPRESENTATION_INVALID");
        if (choice) {
          const matches = field.optionEvidence.samples.filter(label => {
            const unit = /\b(?:years?|yrs?)\b/i.test(label) ? 12 : /\bmonths?\b/i.test(label) ? 1 : null;
            if (!unit) return false;
            const range = label.match(/^\s*(\d+)\s*(?:to|[-–])\s*(\d+)\s*(?:years?|yrs?|months?)\s*$/i);
            if (range) return value.months >= Number(range[1]) * unit && value.months <= Number(range[2]) * unit;
            const over = label.match(/^\s*(\d+)\+\s*(?:years?|yrs?|months?)\s*$/i);
            if (over) return value.months >= Number(over[1]) * unit;
            const exact = label.match(/^\s*(\d+)\s*(?:years?|yrs?|months?)\s*$/i);
            return exact !== null && value.months === Number(exact[1]) * unit;
          });
          if (matches.length !== 1) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "DURATION_OPTION_AMBIGUOUS");
          return FieldRepresentationSchema.parse({ kind: "SINGLE_OPTION", sourceKind: "DURATION", representationId: "DURATION_EXACT_BUCKET@2", policyVersion: 1, option: option(null, matches[0]!), containsCandidateValue: true });
        }
        const years = /\b(?:years?|yrs?)\b/.test(context), months = /\bmonths?\b/.test(context);
        if (years && /\b(?:completed|whole|full)\b/.test(context)) return text("DURATION", "DURATION_COMPLETED_YEARS@2", String(Math.floor(value.months / 12)));
        if (months && !years) return text("DURATION", "DURATION_MONTHS@2", String(value.months));
        if (field.controlType === "NUMBER") {
          if (!years || months) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "DURATION_UNIT_AMBIGUOUS");
          return text("DURATION", "DURATION_EXACT_YEARS@2", exactScale(String(value.months), 1n, 12n));
        }
        return text("DURATION", "DURATION_QUALIFIED_TEXT@2", `${Math.floor(value.months / 12)} years ${value.months % 12} months`);
      }
      case "MONEY": {
        if (choice) throw new RepresentationError("REPRESENTATION_UNSUPPORTED", "MONEY_OPTION_REQUIRES_EXACT_MAPPING");
        const units = moneyUnits(context);
        if (units.currency && units.currency !== value.currency) throw new AnswerUnitError("CURRENCY_CONVERSION_NOT_AUTHORIZED");
        if (units.scale !== 1n && value.currency !== "INR") throw new AnswerUnitError("MONEY_SCALE_CURRENCY_CONFLICT");
        if (!units.period && !/\bctc\b/.test(context)) {
          if (!freeText) throw new AnswerUnitError("MONEY_PERIOD_AMBIGUOUS");
          const amount = exactScale(value.amountExact, 1n, units.scale);
          const scaleLabel = units.scale === 100_000n ? " lakhs" : units.scale === 10_000_000n ? " crores" : "";
          const periodLabel = value.period === "ONE_TIME" ? "one-time" : `per ${value.period.toLowerCase()}`;
          return text("MONEY", "MONEY_QUALIFIED_TEXT@2", `${value.currency} ${amount}${scaleLabel} ${periodLabel}`);
        }
        const period = units.period ?? (/\bctc\b/.test(context) ? "YEAR" : value.period);
        return text("MONEY", `MONEY_${value.currency}_${period}_${units.scale}@2`, convertMoney(value.amountExact, value.period, period, units.scale));
      }
      case "PHONE": {
        const extension = value.extension ? ` ext ${value.extension}` : "";
        return text("PHONE", "PHONE_E164_TEXT@1", `${value.countryCode}${value.nationalNumber}${extension}`);
      }
      case "ADDRESS": {
        const rendered = [value.line1, value.line2, value.city, value.region, value.postalCode, value.countryCode]
          .filter(Boolean).join(", ");
        return text("ADDRESS", "ADDRESS_SINGLE_LINE@1", rendered);
      }
      case "ENUM": {
        if (freeText) return text("ENUM", "ENUM_LABEL_TEXT@2", value.value.label);
        if (!choice) throw new RepresentationError("REPRESENTATION_UNSUPPORTED");
        return FieldRepresentationSchema.parse({
          kind: "SINGLE_OPTION", sourceKind: "ENUM", representationId: "ENUM_EXACT_OPTION@1",
          policyVersion: 1, option: option(value.value.key, value.value.label, [value.value.key]),
          containsCandidateValue: true
        });
      }
      case "MULTI_ENUM": {
        if (field.controlType === "MULTISELECT" || field.controlType === "COMBOBOX") {
          return FieldRepresentationSchema.parse({
            kind: "MULTI_OPTION", sourceKind: "MULTI_ENUM", representationId: "MULTI_ENUM_EXACT_OPTIONS@1",
            policyVersion: 1,
            options: value.values.map((item) => option(item.key, item.label, [item.key])),
            containsCandidateValue: true
          });
        }
        return text("MULTI_ENUM", "MULTI_ENUM_COMMA_TEXT@1", value.values.map((item) => item.label).join(", "));
      }
      case "DATE": return formatDate(value.value.isoDate, value.value.precision, field);
      case "DATE_RANGE": {
        const start = value.start?.isoDate ?? "";
        const end = value.current ? "Present" : value.end?.isoDate ?? "";
        return text("DATE_RANGE", "DATE_RANGE_TEXT@1", [start, end].filter(Boolean).join(" – "));
      }
      case "DECLINE_TO_ANSWER": {
        return FieldRepresentationSchema.parse({
          kind: "SINGLE_OPTION", sourceKind: "DECLINE_TO_ANSWER", representationId: "DECLINE_STANDARD_OPTION@1",
          policyVersion: 1,
          option: option(null, "Prefer not to answer", ["Decline to self-identify", "I do not wish to answer"]),
          containsCandidateValue: true
        });
      }
      case "FILE_REF": throw new RepresentationError("REPRESENTATION_UNSUPPORTED");
      default: throw new RepresentationError("REPRESENTATION_UNSUPPORTED");
    }
  }
}
