(() => {
    const STORAGE_KEY = "jobHunterDurableOutboxV1";
    const VERSION = 1;
    const MAX_PENDING = 300;
    const MAX_TERMINAL = 50;
    const MAX_RETRIES = 5;
    const MAX_BYTES = 1_500_000;
    const TTL_MS = 3 * 24 * 60 * 60 * 1000;
    const ALLOWED_KINDS = new Set(["FIELD_REVISION", "EDIT_SESSION", "CHECKPOINT_RECEIPT", "TELEMETRY_BATCH"]);
    let flushPromise = null;
    let enqueuePromise = Promise.resolve();

    const emptyState = () => ({
        version: VERSION,
        nextSequenceByRun: {},
        acknowledgedSequenceByRun: {},
        pending: [],
        terminal: []
    });

    async function readState() {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const state = stored[STORAGE_KEY];
        return state?.version === VERSION && Array.isArray(state.pending) ? state : emptyState();
    }

    async function writeState(state) {
        const compact = {
            ...state,
            terminal: state.terminal.slice(-MAX_TERMINAL),
            pending: state.pending.slice(-MAX_PENDING)
        };
        const bytes = new TextEncoder().encode(JSON.stringify(compact)).byteLength;
        if (bytes > MAX_BYTES) throw new Error("COPILOT_OFFLINE_QUEUE_FULL");
        await chrome.storage.local.set({ [STORAGE_KEY]: compact });
    }

    async function enqueueOnce({ runId, operationId = null, kind, ownership, request }) {
        if (!runId || !ALLOWED_KINDS.has(kind)) throw new Error("OUTBOX_EVENT_NOT_ALLOWED");
        if (!request?.path || request.method !== "POST") throw new Error("OUTBOX_REQUEST_NOT_ALLOWED");
        const state = await readState();
        if (state.pending.length >= MAX_PENDING) throw new Error("COPILOT_OFFLINE_QUEUE_FULL");
        const sequence = Number(state.nextSequenceByRun[runId] || 0) + 1;
        state.nextSequenceByRun[runId] = sequence;
        const eventId = `outbox:${crypto.randomUUID()}`;
        const envelope = {
            schemaVersion: VERSION,
            eventId,
            runId,
            sequence,
            operationId,
            idempotencyKey: eventId,
            ownership: {
                tabId: Number(ownership?.tabId || 0),
                frameId: Number(ownership?.frameId || 0),
                documentId: String(ownership?.documentId || "unknown").slice(0, 160)
            },
            dataClass: "VALUE_FREE_TELEMETRY",
            kind,
            createdAt: Date.now(),
            expiresAt: Date.now() + TTL_MS,
            retryCount: 0,
            request,
            lastReasonCode: null
        };
        state.pending.push(envelope);
        await writeState(state);
        return envelope;
    }

    function enqueue(input) {
        const task = enqueuePromise.then(() => enqueueOnce(input));
        enqueuePromise = task.catch(() => null);
        return task;
    }

    async function performFlush(deliver) {
        const state = await readState();
        const delivered = [];
        const remaining = [];
        const now = Date.now();
        for (const envelope of state.pending.sort((left, right) => left.sequence - right.sequence)) {
            if (envelope.expiresAt <= now || envelope.retryCount >= MAX_RETRIES) {
                state.terminal.push({ ...envelope, request: undefined, terminalReason: envelope.expiresAt <= now ? "EXPIRED" : "RETRY_LIMIT" });
                continue;
            }
            try {
                const result = await deliver(envelope);
                state.acknowledgedSequenceByRun[envelope.runId] = Math.max(
                    Number(state.acknowledgedSequenceByRun[envelope.runId] || 0), envelope.sequence
                );
                delivered.push({ eventId: envelope.eventId, result });
            } catch (error) {
                const retryable = error?.retryable !== false;
                const failed = { ...envelope, retryCount: envelope.retryCount + 1, lastReasonCode: String(error?.reasonCode || "DELIVERY_FAILED").slice(0, 120) };
                if (!retryable || failed.retryCount >= MAX_RETRIES) {
                    state.terminal.push({ ...failed, request: undefined, terminalReason: retryable ? "RETRY_LIMIT" : "NON_RETRYABLE" });
                } else {
                    remaining.push(failed);
                }
                // Preserve ordering within a run. Later events wait behind the
                // first unavailable predecessor instead of overtaking it.
                remaining.push(...state.pending.filter((candidate) =>
                    candidate.eventId !== envelope.eventId
                    && candidate.runId === envelope.runId
                    && candidate.sequence > envelope.sequence));
                break;
            }
        }
        const deliveredIds = new Set(delivered.map((item) => item.eventId));
        const remainingIds = new Set(remaining.map((item) => item.eventId));
        for (const envelope of state.pending) {
            if (!deliveredIds.has(envelope.eventId) && !remainingIds.has(envelope.eventId)
                && envelope.expiresAt > now && envelope.retryCount < MAX_RETRIES) remaining.push(envelope);
        }
        state.pending = [...new Map(remaining.map((item) => [item.eventId, item])).values()];
        await writeState(state);
        return { delivered, pending: state.pending.length, terminal: state.terminal.length };
    }

    async function flush(deliver) {
        if (flushPromise) return flushPromise;
        flushPromise = performFlush(deliver).finally(() => { flushPromise = null; });
        return flushPromise;
    }

    async function status() {
        const state = await readState();
        return {
            pending: state.pending.length,
            terminal: state.terminal.length,
            acknowledgedSequenceByRun: { ...state.acknowledgedSequenceByRun }
        };
    }

    globalThis.JobHunterDurableOutbox = Object.freeze({ enqueue, flush, status, constants: { MAX_PENDING, MAX_RETRIES, TTL_MS } });
})();
