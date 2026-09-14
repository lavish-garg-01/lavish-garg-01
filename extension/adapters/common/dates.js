(() => {
    const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    // A mask is the format the employer control expects, e.g. MM/YYYY on
    // Workday or dd/MM/yyyy on Keka. Only masks we can read are applied, so a
    // free-text answer is never silently rewritten.
    const MASK = /\b(?:y{2,4}|m{1,4}|d{1,2})(?:\s*[\/\-.\s]\s*(?:y{2,4}|m{1,4}|d{1,2})){1,2}\b/i;
    const MONTH_WORD = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i;
    const SECTION_KINDS = { month: "month", day: "day", year: "year" };

    function monthFromWord(value) {
        const match = String(value || "").trim().match(MONTH_WORD);
        if (!match) return null;
        const needle = match[1].toLowerCase().slice(0, 3);
        const index = MONTH_NAMES.findIndex((name) => name.toLowerCase().startsWith(needle));
        return index < 0 ? null : index + 1;
    }

    function fullYear(value) {
        const year = Number(value);
        if (!Number.isFinite(year)) return null;
        if (year >= 1000) return year;
        if (year >= 0 && year <= 99) return year >= 70 ? 1900 + year : 2000 + year;
        return null;
    }

    function parts(year, month, day) {
        if (!year || !month || month < 1 || month > 12) return null;
        return { year, month, day: day && day >= 1 && day <= 31 ? day : null };
    }

    /**
     * Reads a candidate answer into calendar parts. Returns null when the answer
     * is not a date, which keeps non-date answers on the plain text path.
     */
    function parseDateParts(answer) {
        const value = String(answer == null ? "" : answer).trim();
        if (!value) return null;

        const iso = value.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
        if (iso) return parts(fullYear(iso[1]), Number(iso[2]), iso[3] ? Number(iso[3]) : null);

        const triple = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
        if (triple) {
            const [, first, second, third] = triple;
            // Day-first when the first group cannot be a month.
            return Number(first) > 12
                ? parts(fullYear(third), Number(second), Number(first))
                : parts(fullYear(third), Number(first), Number(second));
        }

        // Two-part numeric dates are a month and a year on ATS forms.
        const pair = value.match(/^(\d{1,4})[-/.](\d{1,4})$/);
        if (pair) {
            const [, first, second] = pair;
            if (second.length === 4) return parts(fullYear(second), Number(first), null);
            if (first.length === 4) return parts(fullYear(first), Number(second), null);
            return Number(first) > 12
                ? parts(fullYear(first), Number(second), null)
                : parts(fullYear(second), Number(first), null);
        }

        const wordFirst = value.match(/^([a-z]+)\.?\s+(?:(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+)?(\d{2,4})$/i);
        if (wordFirst && monthFromWord(wordFirst[1])) {
            const month = monthFromWord(wordFirst[1]);
            const third = fullYear(wordFirst[3]);
            const second = wordFirst[2] ? Number(wordFirst[2]) : null;
            return parts(third, month, second);
        }

        const dayFirstWord = value.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{2,4})$/i);
        if (dayFirstWord && monthFromWord(dayFirstWord[2])) {
            return parts(fullYear(dayFirstWord[3]), monthFromWord(dayFirstWord[2]), Number(dayFirstWord[1]));
        }

        return null;
    }

    function maskFor(hints = {}) {
        const inputType = String(hints.inputType || "").toLowerCase();
        if (inputType === "date") return "YYYY-MM-DD";
        if (inputType === "month") return "YYYY-MM";
        for (const source of [hints.format, hints.placeholder, hints.pattern, hints.ariaLabel, hints.label, hints.title]) {
            const match = String(source || "").match(MASK);
            if (match) return match[0].replace(/\s*([\/\-.])\s*/g, "$1");
        }
        return null;
    }

    function pad(value, size) {
        return String(value).padStart(size, "0");
    }

    function applyMask(dateParts, mask) {
        if (!dateParts || !mask) return null;
        const day = dateParts.day || 1;
        return mask.replace(/y{2,4}|m{1,4}|d{1,2}/gi, (token) => {
            const lower = token.toLowerCase();
            if (lower.startsWith("y")) return lower.length <= 2 ? pad(dateParts.year % 100, 2) : String(dateParts.year);
            if (lower.startsWith("m")) {
                if (lower.length === 3) return MONTH_NAMES[dateParts.month - 1].slice(0, 3);
                if (lower.length === 4) return MONTH_NAMES[dateParts.month - 1];
                return lower.length === 1 ? String(dateParts.month) : pad(dateParts.month, 2);
            }
            return lower.length === 1 ? String(day) : pad(day, 2);
        });
    }

    /**
     * The value to type into a date control, or null when the control does not
     * declare a format we can honour.
     */
    function formatForField(answer, hints = {}) {
        const mask = maskFor(hints);
        if (!mask) return null;
        const dateParts = parseDateParts(answer);
        if (!dateParts) return null;
        return applyMask(dateParts, mask);
    }

    /** Workday and similar portals split one date into month/day/year sections. */
    function sectionKind(identity = "") {
        const value = String(identity || "").toLowerCase();
        const match = value.match(/datesection(month|day|year)/);
        if (match) return SECTION_KINDS[match[1]];
        if (/^(?:date)?month(?:-input)?$/.test(value)) return SECTION_KINDS.month;
        if (/^(?:date)?day(?:-input)?$/.test(value)) return SECTION_KINDS.day;
        if (/^(?:date)?year(?:-input)?$/.test(value)) return SECTION_KINDS.year;
        return null;
    }

    function sectionValues(dateParts) {
        if (!dateParts) return null;
        return {
            month: pad(dateParts.month, 2),
            day: dateParts.day ? pad(dateParts.day, 2) : null,
            year: String(dateParts.year)
        };
    }

    
    /** DOM helpers for Workday-style month/day/year spin sections. */
    function sectionKindFromElement(element) {
        if (!element || element.tagName !== "INPUT" || element.type === "file") return null;
        for (const token of [element.getAttribute("data-automation-id"), element.name,
            element.getAttribute("aria-label"), element.getAttribute("data-testid"), element.id]) {
            const kind = sectionKind(token);
            if (kind) return kind;
        }
        return null;
    }

    function sectionInputs(element) {
        if (!element) return {};
        const group = element.closest("[data-automation-id*='date' i], [role=group], fieldset, .form-group, .field")
            || element.parentElement;
        const sections = {};
        for (const input of [...(group?.querySelectorAll?.("input") || [])]) {
            const kind = sectionKindFromElement(input);
            if (kind && !sections[kind]) sections[kind] = input;
        }
        return sections;
    }

    function sectionValue(sections = {}) {
        const month = String(sections.month?.value || "").trim();
        const year = String(sections.year?.value || "").trim();
        const day = String(sections.day?.value || "").trim();
        if (!month || !year) return "";
        return day ? `${month}/${day}/${year}` : `${month}/${year}`;
    }

    function pickSectionLabel(candidates = [], isGenericLabel = () => false) {
        const label = (candidates || []).find((value) => {
            const text = String(value || "").trim();
            return text && !isGenericLabel(text) && !/^\d{1,4}$/.test(text) && !/^(?:month|day|year)$/i.test(text);
        });
        return String(label || "Date").replace(/\s+/g, " ").trim();
    }

    globalThis.JobHunterDates = {
        parseDateParts, maskFor, applyMask, formatForField, sectionKind, sectionValues,
        sectionKindFromElement, sectionInputs, sectionValue, pickSectionLabel
    };
})();
