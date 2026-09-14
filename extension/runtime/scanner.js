(() => {
    function dynamicControlId(value) {
        return /^(?:field|input|select|react-select)-?\d+(?:-|$)/i.test(String(value || ""));
    }

    function durableControlIdentity(value) {
        const candidate = String(value || "").trim();
        return candidate && !dynamicControlId(candidate) ? candidate : "";
    }

    function create({ deepQueryAll, visible, genericControlLabel = () => false }) {
        let elementByFieldId = new Map();
        let fieldIdByElement = new WeakMap();
        let usedIds = new Map();

        function beginScan() {
            elementByFieldId = new Map();
            fieldIdByElement = new WeakMap();
            usedIds = new Map();
        }

        function stableId(element, type, label, sectionKind = "", sectionIndex = null) {
            const rawId = element?.id || "";
            const durableId = dynamicControlId(rawId) ? "" : rawId;
            const rawAria = element?.getAttribute?.("aria-label") || "";
            const aria = genericControlLabel(rawAria) ? "" : rawAria;
            const named = durableControlIdentity(element?.name)
                || durableControlIdentity(element?.getAttribute?.("data-testid"))
                || durableControlIdentity(element?.getAttribute?.("data-qa"));
            const identity = String((type === "choice-group" && label ? label : "")
                || named || element?.getAttribute?.("autocomplete") || aria || label || durableId || "field")
                .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "field";
            const base = `ext:${sectionKind ? `${sectionKind}:${sectionIndex ?? 0}:` : ""}${identity}:${type}`;
            const occurrence = usedIds.get(base) || 0;
            usedIds.set(base, occurrence + 1);
            return occurrence ? `${base}:${occurrence + 1}` : base;
        }

        function bind(fieldId, element, related = []) {
            if (!fieldId || !element) return;
            elementByFieldId.set(fieldId, element);
            fieldIdByElement.set(element, fieldId);
            for (const item of related || []) {
                if (item) fieldIdByElement.set(item, fieldId);
            }
        }

        function control(field) {
            if (!field?.id) return null;
            const bound = elementByFieldId.get(field.id);
            if (bound?.isConnected) return bound;
            for (const selector of field.selectorCandidates || []) {
                try {
                    const matches = deepQueryAll(selector).filter((element) => visible(element) || element.type === "file");
                    if (matches.length !== 1) continue;
                    bind(field.id, matches[0]);
                    return matches[0];
                } catch {
                    // A portal deployment can invalidate a previously safe selector.
                }
            }
            return null;
        }

        function fieldIdForElement(element) {
            return element ? fieldIdByElement.get(element) || null : null;
        }

        function collect(selector, container, predicate = null) {
            const items = deepQueryAll(selector, container);
            return typeof predicate === "function" ? items.filter(predicate) : items;
        }

        return Object.freeze({
            beginScan,
            stableId,
            bind,
            control,
            fieldIdForElement,
            collect,
            dynamicControlId,
            durableControlIdentity
        });
    }

    globalThis.JobHunterRuntimeScanner = Object.freeze({ create, dynamicControlId, durableControlIdentity });
})();
