(() => {
    function create({ emit, getJob, adapterPayload, evidenceSignature, pageUrl, operationScope = pageUrl }) {
        const operationIds = new Map();
        const lastOperationIds = new Map();

        function recordOperation(payload = {}) {
            if (!getJob?.()) return;
            void emit({
                type: "RECORD_OPERATION",
                jobId: getJob().id,
                payload: {
                    ...payload,
                    clientTimeMs: Date.now(),
                    pageUrl: pageUrl(),
                    metadata: { ...adapterPayload(), ...(payload.metadata || {}) }
                }
            }).catch(() => null);
        }

        function fieldOperation(field, phase, status, { semanticKey = "", reason = "", durationMs = null, metadata = {} } = {}) {
            if (!field) return null;
            const operationKey = `${operationScope()}|${phase}|${field.id}`;
            let operationId = operationIds.get(operationKey);
            if (!operationId) {
                operationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
                operationIds.set(operationKey, operationId);
            }
            lastOperationIds.set(field.id, operationId);
            recordOperation({
                operationId,
                operationKey,
                phase,
                semanticKey: semanticKey || null,
                targetSignature: evidenceSignature(field),
                status,
                durationMs,
                metadata: { reason, ...metadata }
            });
            return operationId;
        }

        return Object.freeze({
            recordOperation,
            fieldOperation,
            lastOperationId: (fieldId) => lastOperationIds.get(fieldId) || null,
            resetOperations() {
                operationIds.clear();
                lastOperationIds.clear();
            }
        });
    }

    globalThis.JobHunterRuntimeTelemetry = Object.freeze({ create });
})();
