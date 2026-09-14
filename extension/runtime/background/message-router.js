(() => {
    function createHandler({ consumeGesture, dispatch }) {
        return (message, sender, sendResponse) => {
            consumeGesture?.(message, sender);
            Promise.resolve()
                .then(() => dispatch(message, sender))
                .then((result) => sendResponse({ ok: true, result }))
                .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
            return true;
        };
    }

    globalThis.JobHunterBackgroundMessageRouter = Object.freeze({ createHandler });
})();
