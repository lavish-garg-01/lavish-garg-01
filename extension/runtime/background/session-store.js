(() => {
    const ACTIVE_KEYS = Object.freeze([
        "activeJob", "activeApplication", "activeTabId", "activeRunAuthorization",
        "pendingDashboardApplication", "pendingSubmission", "navigation", "isPaused",
        "isStopped", "activeApplicationUrl"
    ]);

    function create({ storage, defaultApi }) {
        async function extensionState() {
            const keys = [
                "activeJob", "activeApplication", "activeTabId", "pendingSubmission",
                "pendingSubmissionReview", "pendingResumeReplacement", "navigation", "apiBase",
                "teachModeGlobal", "teachModeSites", "isPaused", "isStopped"
            ];
            const state = await storage.get(keys);
            return {
                ...state,
                apiBase: state.apiBase || defaultApi,
                isPaused: Boolean(state.isPaused),
                isStopped: Boolean(state.isStopped)
            };
        }

        return Object.freeze({
            extensionState,
            clearActive: () => storage.remove(ACTIVE_KEYS),
            activeKeys: ACTIVE_KEYS
        });
    }

    globalThis.JobHunterBackgroundSessionStore = Object.freeze({ create, ACTIVE_KEYS });
})();
