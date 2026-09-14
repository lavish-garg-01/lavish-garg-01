(() => {
    const PORTALS = [
        { id: "rippling", version: "1.0.0", label: "Rippling", hosts: ["rippling.com"] },
        { id: "greenhouse", version: "1.0.0", label: "Greenhouse", hosts: ["greenhouse.io", "boards.greenhouse.io", "job-boards.greenhouse.io"] },
        { id: "workday", version: "1.0.0", label: "Workday", hosts: ["myworkdayjobs.com", "workday.com"] },
        { id: "keka", version: "1.0.0", label: "Keka", hosts: ["keka.com"] },
        { id: "lever", version: "1.0.0", label: "Lever", hosts: ["lever.co", "jobs.lever.co"] },
        { id: "ashby", version: "1.0.0", label: "Ashby", hosts: ["ashbyhq.com", "jobs.ashbyhq.com"] },
        { id: "smartrecruiters", version: "1.0.0", label: "SmartRecruiters", hosts: ["smartrecruiters.com", "jobs.smartrecruiters.com"] },
        { id: "pinpoint", version: "1.0.0", label: "Pinpoint", hosts: ["pinpointhq.com"] },
        { id: "phenom", version: "1.0.0", label: "Phenom", hosts: ["phenompeople.com", "careers.cisco.com"] },
        { id: "naukri", version: "1.0.0", label: "Naukri", hosts: ["naukri.com"] },
        { id: "instahyre", version: "1.0.0", label: "Instahyre", hosts: ["instahyre.com"] },
        { id: "wellfound", version: "1.0.0", label: "Wellfound", hosts: ["wellfound.com", "angel.co"] },
        { id: "linkedin", version: "1.0.0", label: "LinkedIn", hosts: ["linkedin.com"] },
        { id: "generic", version: "1.0.0", label: "Generic ATS", hosts: [] }
    ];

    // Small structural fallbacks keep a known ATS safe if the local API is
    // temporarily unavailable or still serving an older mapping-pack catalog.
    // Tenant-specific mappings remain data-driven on the backend.
    const RUNTIME_FALLBACKS = {
        smartrecruiters: {
            skipSelectors: ['input[type="file"][aria-label*="profile image" i]'],
            skipAncestorSelectors: ["oc-apply-with-resume"],
            fileFields: {
                resume: { testIds: ["file-input"], labelPatterns: ["resume", "curriculum", "cv"] },
                coverLetter: { testIds: [], labelPatterns: ["cover letter"] }
            },
            overlays: {
                applicationHost: "(?:^|\\.)smartrecruiters\\.com$",
                applicationRoute: "^/oneclick-ui/",
                formContainers: "oc-oneclick-form, oc-oneclick-form-root, main",
                openShadowDom: true
            }
        },
        pinpoint: {
            fileFields: {
                resume: {
                    testIds: ["application_form[application][cv]"],
                    labelPatterns: ["résumé", "resume", "curriculum", "cv"],
                    eventRecipe: ["input", "change", "blur"],
                    attachAttempts: 1,
                    verifyDelayMs: 350
                },
                coverLetter: { testIds: ["pinpoint-cover-letter"], labelPatterns: ["cover letter"] }
            },
            overlays: {
                applicationRoute: "^/(?:[a-z]{2}/)?postings/[^/]+/applications/new$",
                formContainers: "form.external-form, #application-form"
            }
        },
        phenom: {
            textVerifyDelayMs: 350,
            skipSelectors: [
                "#typehead", "#language-selector", "#vendor-search-handler",
                "[id^='ot-group-id-']", "#select-all-hosts-groups-handler",
                "#select-all-vendor-groups-handler", "#select-all-vendor-leg-handler"
            ],
            fileFields: {
                resume: {
                    testIds: ["phenom-resume"],
                    labelPatterns: ["resume", "curriculum", "cv", "upload from pc"],
                    eventRecipe: ["input", "change", "blur"],
                    attachAttempts: 1,
                    verifyDelayMs: 400
                },
                coverLetter: { testIds: ["phenom-cover-letter"], labelPatterns: ["cover letter"] }
            },
            overlays: {
                applicationRoute: "^/(?:[^/]+/){2}apply$",
                formContainers: "form.rjsf, form[class*='rjsf']"
            }
        }
    };

    function hostnameOf(value) {
        const raw = String(value || "").trim().toLowerCase();
        if (!raw) return "";
        try {
            if (raw.includes("://")) return new URL(raw).hostname.toLowerCase();
        } catch { /* ignore */ }
        return raw.replace(/^www\./, "").split("/")[0];
    }

    function hostMatches(hostname, pattern) {
        const host = String(hostname || "").replace(/^www\./, "");
        const needle = String(pattern || "").replace(/^www\./, "").toLowerCase();
        return host === needle || host.endsWith(`.${needle}`);
    }

    function resolve(hostnameOrUrl) {
        const hostname = hostnameOf(hostnameOrUrl);
        const match = PORTALS.find((portal) => portal.id !== "generic" && portal.hosts.some((host) => hostMatches(hostname, host)))
            || PORTALS.find((portal) => portal.id !== "generic" && portal.id === hostname);
        const portal = match || PORTALS.find((item) => item.id === "generic");
        return {
            id: portal.id,
            portalKind: portal.id,
            version: portal.version,
            label: portal.label,
            hostname: hostname || "unknown-site"
        };
    }

    function resolveForPage(locationLike = globalThis.location, root = globalThis.document) {
        const byHost = resolve(locationLike?.hostname || "");
        if (byHost.portalKind !== "generic") return byHost;
        const pinpoint = Boolean(root?.querySelector?.(
            'form.external-form[action*="/postings/"][action$="/applications"], input[name^="application_form[application]"]'
        ));
        if (pinpoint) return { ...resolve("pinpoint"), hostname: locationLike?.hostname || byHost.hostname };
        const phenom = Boolean(root?.querySelector?.(
            'script[src*="phenompeople"], script[src*="phenomapptrack"], form.rjsf [id^="experienceData["], form.rjsf #cntryFields\\.firstName'
        ));
        return phenom ? { ...resolve("phenom"), hostname: locationLike?.hostname || byHost.hostname } : byHost;
    }

    globalThis.JobHunterAdapterRegistry = {
        PORTALS,
        resolve,
        resolveForPage,
        runtimeFallback(value) {
            const portalKind = typeof value === "string" ? resolve(value).portalKind : resolveForPage(value).portalKind;
            return RUNTIME_FALLBACKS[portalKind] || null;
        },
        portalKindFor(value) { return resolve(value).portalKind; }
    };
})();
