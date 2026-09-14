(() => {
    if (globalThis.JobHunterShadow) return;

    function queryAll(selector, root = document) {
        const matches = [];
        const seen = new Set();
        const visit = (scope) => {
            if (!scope?.querySelectorAll) return;
            if (scope.nodeType === Node.ELEMENT_NODE) {
                try {
                    if (scope.matches(selector) && !seen.has(scope)) {
                        seen.add(scope);
                        matches.push(scope);
                    }
                } catch { return; }
            }
            let elements = [];
            try { elements = [...scope.querySelectorAll("*")]; } catch { return; }
            for (const element of elements) {
                try {
                    if (element.matches(selector) && !seen.has(element)) {
                        seen.add(element);
                        matches.push(element);
                    }
                } catch { /* Invalid selectors are handled by the caller. */ }
                if (element.shadowRoot?.mode === "open") visit(element.shadowRoot);
            }
        };
        visit(root);
        return matches;
    }

    function query(selector, root = document) {
        return queryAll(selector, root)[0] || null;
    }

    function getById(id, root = document) {
        const value = String(id || "").trim();
        if (!value) return null;
        try { return query(`#${CSS.escape(value)}`, root); } catch { return null; }
    }

    function parent(element) {
        if (!element) return null;
        return element.parentElement || element.getRootNode?.()?.host || null;
    }

    function closest(element, selector) {
        for (let current = element; current; current = parent(current)) {
            try { if (current.matches?.(selector)) return current; } catch { return null; }
        }
        return null;
    }

    function text(element) {
        if (!element) return "";
        const chunks = [];
        const add = (value) => {
            const normalized = String(value || "").replace(/\s+/g, " ").trim();
            if (normalized && !chunks.includes(normalized)) chunks.push(normalized);
        };
        add(element.innerText || element.textContent);
        if (element.shadowRoot?.mode === "open") add(element.shadowRoot.textContent);
        return chunks.join(" ").replace(/\s+/g, " ").trim();
    }

    function openRoots(root = document) {
        const roots = [];
        const visit = (scope) => {
            if (!scope?.querySelectorAll) return;
            for (const element of scope.querySelectorAll("*")) {
                if (element.shadowRoot?.mode !== "open") continue;
                roots.push(element.shadowRoot);
                visit(element.shadowRoot);
            }
        };
        visit(root);
        return roots;
    }

    globalThis.JobHunterShadow = { queryAll, query, getById, parent, closest, text, openRoots };
})();
