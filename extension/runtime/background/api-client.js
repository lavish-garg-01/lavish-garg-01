(() => {
    function create({ chromeApi, fetchImpl = fetch, defaultApi, timeoutMs = 30000 }) {
        async function base() {
            const stored = await chromeApi.storage.local.get("apiBase");
            return String(stored.apiBase || defaultApi).replace(/\/$/, "");
        }

        async function request(path, options = {}) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const { skipRunAuth = false, ...fetchOptions } = options;
                const runAuthorization = skipRunAuth
                    ? null
                    : (await chromeApi.storage.local.get("activeRunAuthorization")).activeRunAuthorization || null;
                const response = await fetchImpl(`${await base()}${path}`, {
                    ...fetchOptions,
                    signal: controller.signal,
                    headers: {
                        "Content-Type": "application/json",
                        ...(runAuthorization?.runId ? {
                            "X-Job-Hunter-Run-Id": runAuthorization.runId,
                            "X-Job-Hunter-Run-Token": runAuthorization.sessionToken,
                            "X-Job-Hunter-Target-Origin": runAuthorization.targetOrigin
                        } : {}),
                        ...(fetchOptions.headers || {})
                    }
                });
                const contentType = response.headers.get("content-type") || "";
                const body = contentType.includes("application/json") ? await response.json() : await response.text();
                if (!response.ok) {
                    const failure = new Error(body?.error || body?.eligibility?.reason || body || `HTTP ${response.status}`);
                    failure.httpStatus = response.status;
                    failure.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
                    failure.reasonCode = response.status === 401 || response.status === 403
                        ? "RUN_AUTHORIZATION_REJECTED" : `HTTP_${response.status}`;
                    throw failure;
                }
                return body;
            } catch (error) {
                if (error?.name === "AbortError") throw new Error("The local Job Hunter service did not respond within 30 seconds.");
                throw error;
            } finally {
                clearTimeout(timeout);
            }
        }

        async function setBase(value) {
            const apiBase = String(value || defaultApi).replace(/\/$/, "");
            await chromeApi.storage.local.set({ apiBase });
            return apiBase;
        }

        return Object.freeze({ base, request, setBase });
    }

    globalThis.JobHunterBackgroundApiClient = Object.freeze({ create });
})();
