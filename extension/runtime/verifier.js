(() => {
    function create({ delay, selectedComboboxDisplay, optionMatchScore, textVerifyDelay }) {
        async function verifyText(element, expected) {
            await delay(Number(textVerifyDelay?.()) || 120);
            const observed = String(element?.value ?? "").trim();
            const wanted = String(expected ?? "").trim();
            if (!observed || element?.getAttribute?.("aria-invalid") === "true") return false;
            if (typeof element?.checkValidity === "function" && !element.checkValidity()) return false;
            if (element?.type === "tel") {
                const observedDigits = observed.replace(/\D/g, "");
                const wantedDigits = wanted.replace(/\D/g, "");
                return Boolean(observedDigits && wantedDigits
                    && (observedDigits === wantedDigits || observedDigits.endsWith(wantedDigits) || wantedDigits.endsWith(observedDigits)));
            }
            return observed === wanted;
        }

        async function verifyCombobox(element, answer, selectedText) {
            for (const wait of [140, 420]) {
                await delay(wait);
                if (!element?.isConnected || element.getAttribute("aria-invalid") === "true") return false;
                const observed = selectedComboboxDisplay(element);
                if (optionMatchScore(observed, selectedText) >= 4 || optionMatchScore(observed, answer) >= 4) return true;
            }
            return false;
        }

        return Object.freeze({ verifyText, verifyCombobox });
    }

    globalThis.JobHunterRuntimeVerifier = Object.freeze({ create });
})();
