(() => {
    function create({ durableOutbox, request, rememberLearningSummary }) {
        async function deliver(envelope) {
            const result = await request(envelope.request.path, {
                method: "POST",
                headers: { "Idempotency-Key": envelope.idempotencyKey },
                body: JSON.stringify(envelope.request.body || {})
            });
            const jobId = envelope.kind === "CHECKPOINT_RECEIPT"
                ? envelope.request.path.match(/\/jobs\/([^/]+)\/checkpoint-receipt/)?.[1] : null;
            if (jobId) await rememberLearningSummary(decodeURIComponent(jobId), result);
            return result;
        }

        async function flush() {
            return durableOutbox?.flush?.(deliver) || { delivered: [], pending: 0, terminal: 0 };
        }

        async function post({ runId, operationId = null, kind, ownership, path, body }) {
            const envelope = await durableOutbox.enqueue({
                runId, operationId, kind, ownership,
                request: { path, method: "POST", body }
            });
            const result = await flush().catch(() => ({ delivered: [], pending: 1 }));
            const delivered = result.delivered?.find((item) => item.eventId === envelope.eventId);
            return delivered ? delivered.result : { queued: true, eventId: envelope.eventId, pending: result.pending || 1 };
        }

        return Object.freeze({ deliver, flush, post });
    }

    globalThis.JobHunterBackgroundOutboxTransport = Object.freeze({ create });
})();
