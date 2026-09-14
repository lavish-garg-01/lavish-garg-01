# Job Hunter Copilot — Extension V2

The single V2 Manifest V3 runtime. Phase I owns runtime identity, scanning, user ownership, messaging, recovery, authentication bridging, errors and value-private telemetry.

It intentionally does **not** own Candidate Truth, semantic canonicalization, representation learning, full browser execution, application learning or automatic submission.

```text
page → scanner → ownership → controller → typed messaging → service worker → V2 API
                    │                         │
             executor/verifier ports     session recovery
```

Build with `npm run build -w @job-hunter-v2/extension`. Load `apps/extension/dist` as an unpacked extension in Chrome.

Public build configuration:

- `EXTENSION_API_ORIGIN` — defaults to `http://127.0.0.1:3100`;
- `EXTENSION_WEB_ORIGINS` — comma-separated exact web origins, defaults to port 3000 using both loopback spellings;
- `EXTENSION_CHANNEL` — `development`, `staging` or `production`.

No access token or service secret is bundled. Candidate authentication is offered by the trusted Job Hunter web origin and retained only in `chrome.storage.session`.
