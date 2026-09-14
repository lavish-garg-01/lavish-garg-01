(() => {
    const DEFAULT_PACK = {
        skipSelectors: [],
        skipAncestorSelectors: [],
        neverFill: ["password", "otp", "captcha", "legal"],
        fileFields: {},
        overlays: {
            embeddedFrameSelector: "#grnhse_iframe, iframe[src*='greenhouse.io'], iframe[src*='job_app'], iframe[src*='lever.co'], iframe[src*='ashbyhq.com']",
            formContainers: "form, [role=\"dialog\"], #application_form, #grnhse_app"
        }
    };

    let current = {
        portalKind: "generic",
        killed: false,
        stage: "DEFAULT",
        version: 1,
        pack: DEFAULT_PACK
    };

    function pack() {
        return current.pack || DEFAULT_PACK;
    }

    function overlay(name, fallback) {
        const value = pack().overlays?.[name];
        return value == null || value === "" ? fallback : value;
    }

    function matchesSkip(element, selectors) {
        if (!element || !Array.isArray(selectors)) return false;
        return selectors.some((selector) => {
            try { return element.matches?.(selector); } catch { return false; }
        });
    }

    function testPattern(pattern, value) {
        if (!pattern) return false;
        try {
            return new RegExp(pattern, "i").test(String(value || ""));
        } catch {
            return false;
        }
    }

    globalThis.JobHunterAdapterRuntime = {
        current() { return current; },
        apply(runtime) {
            if (runtime && typeof runtime === "object") {
                const nextPack = runtime.pack || current.pack || DEFAULT_PACK;
                current = {
                    ...current,
                    ...runtime,
                    pack: {
                        ...DEFAULT_PACK,
                        ...nextPack,
                        skipSelectors: Array.isArray(nextPack.skipSelectors) ? nextPack.skipSelectors : DEFAULT_PACK.skipSelectors,
                        skipAncestorSelectors: Array.isArray(nextPack.skipAncestorSelectors) ? nextPack.skipAncestorSelectors : DEFAULT_PACK.skipAncestorSelectors,
                        neverFill: Array.isArray(nextPack.neverFill) ? nextPack.neverFill : DEFAULT_PACK.neverFill,
                        fileFields: nextPack.fileFields || DEFAULT_PACK.fileFields,
                        overlays: { ...DEFAULT_PACK.overlays, ...(nextPack.overlays || {}) }
                    }
                };
            }
            return current;
        },
        overlay,
        skipElement(element) {
            if (matchesSkip(element, pack().skipSelectors)) return true;
            const ancestors = pack().skipAncestorSelectors;
            if (!Array.isArray(ancestors) || !ancestors.length) return false;
            return ancestors.some((selector) => Boolean(globalThis.JobHunterShadow?.closest?.(element, selector)));
        },
        fileTestIds(kind) {
            return pack().fileFields?.[kind]?.testIds || [];
        },
        fileLabelPatterns(kind) {
            return pack().fileFields?.[kind]?.labelPatterns || [];
        },
        fileEventRecipe(kind) {
            const configured = pack().fileFields?.[kind]?.eventRecipe;
            return Array.isArray(configured) && configured.length ? configured : ["input", "change", "blur", "drop"];
        },
        fileAttachAttempts(kind) {
            return Math.max(1, Math.min(3, Number(pack().fileFields?.[kind]?.attachAttempts) || 3));
        },
        fileVerifyDelayMs(kind) {
            return Math.max(100, Math.min(2000, Number(pack().fileFields?.[kind]?.verifyDelayMs) || 150));
        },
        textVerifyDelayMs() {
            return Math.max(80, Math.min(1000, Number(pack().textVerifyDelayMs) || 120));
        },
        embeddedFrameSelector() {
            return overlay("embeddedFrameSelector", DEFAULT_PACK.overlays.embeddedFrameSelector);
        },
        formContainerSelector() {
            return overlay("formContainers", DEFAULT_PACK.overlays.formContainers);
        },
        isApplicationRoute(locationLike) {
            const host = locationLike?.hostname || "";
            const path = locationLike?.pathname || "";
            const hostPattern = overlay("applicationHost", "");
            const pathPattern = overlay("applicationRoute", "");
            if (!pathPattern) return false;
            if (hostPattern && !testPattern(hostPattern, host)) return false;
            return testPattern(pathPattern, path);
        },
        isSuccessRoute(locationLike) {
            const host = locationLike?.hostname || "";
            const path = locationLike?.pathname || "";
            const hostPattern = overlay("successHost", overlay("applicationHost", ""));
            const pathPattern = overlay("successRoute", "");
            if (!pathPattern) return false;
            if (hostPattern && !testPattern(hostPattern, host)) return false;
            return testPattern(pathPattern, path);
        },
        isPortalSubmit(locationLike, buttonText) {
            const pathPattern = overlay("submitPath", "");
            if (!pathPattern) return false;
            const hostPattern = overlay("submitHost", overlay("applicationHost", ""));
            if (hostPattern && !testPattern(hostPattern, locationLike?.hostname || "")) return false;
            if (!testPattern(pathPattern, locationLike?.pathname || "")) return false;
            const textPattern = overlay("submitButtonText", "apply|submit");
            return testPattern(textPattern, buttonText);
        }
    };
})();
