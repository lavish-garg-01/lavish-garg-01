import type { NormalizedValue } from "./api.js";

export interface EssentialProfileAnswer {
  canonicalKey: string;
  entityId: string | null;
  scopeType: string;
  normalizedValue: NormalizedValue;
}

export interface EssentialProfileDraft {
  name: string;
  email: string;
  phone: string;
  skills: string;
}

export interface EmploymentProfileAnswer extends EssentialProfileAnswer {
  answerVersionId: string;
}

export interface EmploymentProfileDraft {
  entityId: string;
  company: string;
  title: string;
  companyVersionId: string | null;
  titleVersionId: string | null;
}

export function displayValue(value: NormalizedValue): string {
  if (value.kind === "DATE") return String((value.value as { isoDate?: string })?.isoDate ?? "");
  if (value.kind === "ENUM") return String((value.value as { label?: string })?.label ?? "");
  if (value.kind === "STRING" || value.kind === "URL" || value.kind === "RICH_TEXT") return String(value.value ?? "");
  if (value.kind === "PHONE") return `${String(value.countryCode ?? "")} ${String(value.nationalNumber ?? "")}`.trim();
  if (value.kind === "MULTI_ENUM") return ((value.values as { label: string }[] | undefined) ?? []).map((item) => item.label).join(", ");
  if (value.kind === "FILE_REF") return String(value.fileName ?? "Master resume");
  if (value.kind === "BOOLEAN") return value.value ? "Yes" : "No";
  if (value.kind === "INTEGER") return String(value.value ?? "");
  if (value.kind === "DURATION") return `${String(value.months ?? 0)} months`;
  if (value.kind === "MONEY") return `${String(value.currency ?? "")} ${String(value.amountExact ?? "")}`;
  if (value.kind === "DATE_RANGE") return `${String((value.start as { isoDate?: string } | null)?.isoDate ?? "")}${value.current ? " — Present" : ` — ${String((value.end as { isoDate?: string } | null)?.isoDate ?? "")}`}`;
  return "Saved";
}

export function essentialProfileDraft(answers: readonly EssentialProfileAnswer[]): EssentialProfileDraft {
  const current = new Map(
    answers
      .filter((answer) => !answer.entityId && answer.scopeType === "GLOBAL")
      .map((answer) => [answer.canonicalKey, answer])
  );
  const value = (canonicalKey: string) => {
    const answer = current.get(canonicalKey);
    return answer ? displayValue(answer.normalizedValue) : "";
  };
  return {
    name: value("FULL_NAME"),
    email: value("EMAIL"),
    phone: value("PHONE"),
    skills: value("SKILLS")
  };
}

export function employmentProfileDrafts(answers: readonly EmploymentProfileAnswer[]): EmploymentProfileDraft[] {
  const grouped = new Map<string, EmploymentProfileDraft>();
  for (const answer of answers) {
    if (!answer.entityId || !["EMPLOYMENT_COMPANY", "EMPLOYMENT_TITLE"].includes(answer.canonicalKey)) continue;
    const draft = grouped.get(answer.entityId) ?? {
      entityId: answer.entityId,
      company: "",
      title: "",
      companyVersionId: null,
      titleVersionId: null
    };
    if (answer.canonicalKey === "EMPLOYMENT_COMPANY") {
      draft.company = displayValue(answer.normalizedValue);
      draft.companyVersionId = answer.answerVersionId;
    } else {
      draft.title = displayValue(answer.normalizedValue);
      draft.titleVersionId = answer.answerVersionId;
    }
    grouped.set(answer.entityId, draft);
  }
  return [...grouped.values()].sort((left, right) =>
    left.company.localeCompare(right.company) || left.entityId.localeCompare(right.entityId)
  );
}

export function correctedValue(original: NormalizedValue, text: string): NormalizedValue {
  const common = { schemaVersion: 1, dataClass: "CANDIDATE_PRIVATE" };
  if (["STRING", "URL", "RICH_TEXT"].includes(original.kind)) return { ...common, kind: original.kind, value: text.trim() };
  if (original.kind === "PHONE") {
    const digits = text.replace(/\D/g, "");
    const national = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
    return { ...common, kind: "PHONE", countryCode: "+91", nationalNumber: national, extension: null };
  }
  if (original.kind === "MULTI_ENUM") {
    return {
      ...common,
      kind: "MULTI_ENUM",
      values: text.split(",").map((item) => item.trim()).filter(Boolean).map((label) => ({
        key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label
      }))
    };
  }
  return original;
}
