(() => {
    function create({ ownership, setStatus }) {
        function dispatch(element, eventTypes = ["input", "change", "blur"]) {
            return ownership.withProgrammaticMutation(element, () => {
                for (const type of eventTypes) {
                    const event = type === "input" && typeof InputEvent === "function"
                        ? new InputEvent("input", {
                            bubbles: true, composed: true, inputType: "insertReplacementText",
                            data: String(element.value ?? "")
                        })
                        : new Event(type, { bubbles: true, composed: true });
                    element.dispatchEvent(event);
                }
            });
        }

        function setNativeValue(element, value) {
            let prototype = null;
            if (element instanceof HTMLInputElement) prototype = HTMLInputElement.prototype;
            else if (element instanceof HTMLTextAreaElement) prototype = HTMLTextAreaElement.prototype;
            else if (element instanceof HTMLSelectElement) prototype = HTMLSelectElement.prototype;
            else return false;
            try {
                const previous = String(element.value ?? "");
                const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
                if (setter) setter.call(element, String(value));
                else element.value = String(value);
                element._valueTracker?.setValue?.(previous);
                return true;
            } catch {
                try { element.value = String(value); return true; }
                catch { return false; }
            }
        }

        async function execute(field, options, operation) {
            if (!ownership.canAutomate(field?.id, options)) {
                setStatus?.(`Paused on “${field?.label || "this field"}” while you are editing it.`, "warning");
                return false;
            }
            return operation();
        }

        return Object.freeze({ dispatch, setNativeValue, execute });
    }

    globalThis.JobHunterRuntimeExecutor = Object.freeze({ create });
})();
