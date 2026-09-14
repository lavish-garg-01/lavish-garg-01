(() => {
    function create() {
        const programmaticElements = new WeakSet();
        const userEditedFieldIds = new Set();
        const userActiveFieldIds = new Set();
        const failedFillFieldIds = new Set();

        function withProgrammaticMutation(element, operation) {
            if (!element) return operation();
            programmaticElements.add(element);
            try { return operation(); }
            finally { programmaticElements.delete(element); }
        }

        function canAutomate(fieldId, { force = false } = {}) {
            // Preserve the existing runtime contract: active editing vetoes an
            // operation immediately. A completed manual edit remains recorded
            // for evidence/repair guards, while a later explicit Fill command
            // may still operate after focus has left the field.
            return Boolean(force || !userActiveFieldIds.has(fieldId));
        }

        return Object.freeze({
            withProgrammaticMutation,
            isProgrammatic: (element) => Boolean(element && programmaticElements.has(element)),
            markUserEdited: (fieldId) => { if (fieldId) userEditedFieldIds.add(fieldId); },
            isUserEdited: (fieldId) => Boolean(fieldId && userEditedFieldIds.has(fieldId)),
            beginUserInteraction: (fieldId) => { if (fieldId) userActiveFieldIds.add(fieldId); },
            endUserInteraction: (fieldId) => { if (fieldId) userActiveFieldIds.delete(fieldId); },
            isUserActive: (fieldId) => Boolean(fieldId && userActiveFieldIds.has(fieldId)),
            canAutomate,
            markFillFailed: (fieldId) => { if (fieldId) failedFillFieldIds.add(fieldId); },
            clearFillFailed: (fieldId) => { if (fieldId) failedFillFieldIds.delete(fieldId); },
            hasFillFailed: (fieldId) => Boolean(fieldId && failedFillFieldIds.has(fieldId)),
            releaseToCopilot(fieldId) {
                if (!fieldId) return;
                userEditedFieldIds.delete(fieldId);
                userActiveFieldIds.delete(fieldId);
            }
        });
    }

    globalThis.JobHunterRuntimeOwnership = Object.freeze({ create });
})();
