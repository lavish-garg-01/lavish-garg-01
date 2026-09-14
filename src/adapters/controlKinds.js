/** Canonical control kinds shared by adapters, mapping packs, and evidence. */
export const CONTROL_KINDS = Object.freeze([
    "text",
    "textarea",
    "email",
    "tel",
    "number",
    "select",
    "combobox",
    "choice-group",
    "checkbox",
    "file",
    "date",
    "location"
]);

const ALIASES = {
    "select-one": "select",
    "select-multiple": "select",
    radio: "choice-group",
    radiogroup: "choice-group",
    likert: "choice-group",
    "likert-4": "choice-group",
    "checkbox-group": "checkbox",
    consent: "checkbox",
    phone: "tel",
    url: "text",
    search: "text",
    "location-search": "location",
    "date-parts": "date",
    month: "date",
    password: "text"
};

export function normalizeControlKind(value = "") {
    const raw = String(value || "text").trim().toLowerCase();
    if (CONTROL_KINDS.includes(raw)) return raw;
    return ALIASES[raw] || "text";
}
