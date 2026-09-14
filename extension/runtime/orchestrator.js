(() => {
    function create({ timeoutMs, isPaused, begin, end }) {
        let running = false;

        async function run(label, operation) {
            if (running || isPaused()) return null;
            running = true;
            begin(label);
            let timeout = null;
            try {
                return await Promise.race([
                    operation(),
                    new Promise((_, reject) => {
                        timeout = setTimeout(() => reject(new Error("I could not finish checking this page within 30 seconds.")), timeoutMs);
                    })
                ]);
            } finally {
                clearTimeout(timeout);
                end();
                running = false;
            }
        }

        return Object.freeze({
            run,
            isRunning: () => running,
            cancel() {
                running = false;
                end();
            }
        });
    }

    globalThis.JobHunterRuntimeOrchestrator = Object.freeze({ create });
})();
