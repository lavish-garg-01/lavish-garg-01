(() => {
    if (globalThis.JobHunterRepeatables) return;
    const state = { route: "", experience: { index: 0, status: "IDLE" }, education: { index: 0, status: "IDLE" } };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deepAll = (selector, root = document) => globalThis.JobHunterShadow?.queryAll?.(selector, root)
        || [...(root?.querySelectorAll?.(selector) || [])];
    const text = (element) => String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
    function visible(element) {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && (rect.width > 0 || rect.height > 0);
    }
    function resetForRoute() {
        const route = `${location.origin}${location.pathname}${location.search}${location.hash}`;
        if (state.route === route) return;
        state.route = route;
        state.experience = { index: 0, status: "IDLE" };
        state.education = { index: 0, status: "IDLE" };
    }
    function rows(profile, kind) {
        const list = kind === "experience" ? profile?.experience : profile?.education;
        return Array.isArray(list) ? list.filter((row) => row && Object.values(row).some((value) =>
            Array.isArray(value) ? value.some(Boolean) : String(value ?? "").trim())) : [];
    }
    function sectionFor(kind) {
        return deepAll(`[data-test="${kind}"], oc-${kind}`).find((element) => element.isConnected) || null;
    }
    function addButton(kind) {
        const host = deepAll(`oc-button[data-test="add-${kind}"]`).find((element) => element.isConnected);
        return host ? deepAll("spl-button, button", host).find(visible) || host : null;
    }
    function editorControls(kind) {
        const section = sectionFor(kind);
        return section ? deepAll("input:not([type=hidden]):not([type=file]), textarea, select, [role=combobox]", section).filter(visible) : [];
    }
    function exactSaveButton(kind) {
        const section = sectionFor(kind);
        return section ? deepAll("button, spl-button, oc-button", section).find((button) => visible(button)
            && /^save$/i.test(text(button)) && !/submit|application/i.test(text(button))) : null;
    }
    function editorReadyToSave(kind) {
        const controls = editorControls(kind);
        if (!controls.length || controls.some((control) => control.getAttribute("aria-invalid") === "true")) return false;
        const section = sectionFor(kind);
        if (deepAll(".error, [role=alert]", section).some((node) => visible(node) && text(node))) return false;
        return controls.filter((control) => control.required || control.getAttribute("aria-required") === "true")
            .every((control) => control.type === "checkbox" ? control.checked : String(control.value || "").trim());
    }
    function openRecord(profile, kind, index) {
        if (!rows(profile, kind)[index]) return false;
        const button = addButton(kind);
        if (!button || !visible(button)) return false;
        state[kind] = { index, status: "OPENING" };
        button.click();
        state[kind].status = "OPEN";
        return true;
    }
    function expandSmartRecruiters(profile = {}) {
        resetForRoute();
        let expanded = 0;
        for (const kind of ["experience", "education"]) {
            if (!rows(profile, kind).length || state[kind].status !== "IDLE") continue;
            if (editorControls(kind).length) state[kind] = { index: 0, status: "OPEN" };
            else if (openRecord(profile, kind, 0)) expanded += 1;
        }
        return expanded;
    }
    async function advanceSmartRecruiters(profile = {}) {
        resetForRoute();
        const result = { advanced: false, saved: [], opened: [], review: [] };
        for (const kind of ["experience", "education"]) {
            const item = state[kind];
            if (item.status !== "OPEN") continue;
            const save = exactSaveButton(kind);
            if (!save) continue;
            if (!editorReadyToSave(kind)) {
                result.review.push({ kind, index: item.index, reason: "Structured record still has empty or invalid required fields." });
                continue;
            }
            item.status = "SAVING";
            save.click();
            result.saved.push({ kind, index: item.index });
            result.advanced = true;
            await wait(350);
            const nextIndex = item.index + 1;
            if (rows(profile, kind)[nextIndex] && openRecord(profile, kind, nextIndex)) result.opened.push({ kind, index: nextIndex });
            else state[kind] = { index: nextIndex, status: "COMPLETE" };
        }
        return result;
    }
    function expand({ portalKind, profile } = {}) {
        return String(portalKind || "").toLowerCase() === "smartrecruiters" ? expandSmartRecruiters(profile) : 0;
    }
    async function advance({ portalKind, profile } = {}) {
        return String(portalKind || "").toLowerCase() === "smartrecruiters"
            ? advanceSmartRecruiters(profile) : { advanced: false, saved: [], opened: [], review: [] };
    }
    function recordIndexFor(element, kind) {
        resetForRoute();
        const inSection = sectionFor(kind)?.contains?.(element)
            || globalThis.JobHunterShadow?.closest?.(element, `[data-test="${kind}"], oc-${kind}`);
        return kind && inSection ? state[kind]?.index ?? 0 : null;
    }
    globalThis.JobHunterRepeatables = { expand, advance, recordIndexFor, state: () => structuredClone(state) };
})();
