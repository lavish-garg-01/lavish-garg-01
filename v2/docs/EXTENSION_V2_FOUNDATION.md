# Extension V2 foundation

Phase I establishes one Manifest V3 runtime under `apps/extension`. It is the only V2 extension implementation. The external V1 extension is a frozen migration reference and is never imported or executed by V2.

## Runtime boundaries

```text
Job Hunter web
  -> configured-origin website bridge
  -> strict background message router
  -> Phase G session validation

Employer page/frame
  -> page observer
  -> structural scanner
  -> field registry + ownership
  -> Phase-I executor/verifier ports (fail closed; no writes)
  -> strict background message router

Background service worker
  -> auth session (chrome.storage.session)
  -> value-free runtime registry (chrome.storage.session)
  -> bounded structural telemetry (chrome.storage.local)
  -> per-origin site access registration
```

The scanner discovers structure only. It does not resolve Candidate Truth, choose a canonical, mutate a field or write candidate data. Phase J owns field meaning, Phase K owns safe representation/execution/verification, and Phase L owns verified learning.

## Identity and state

Runtime identity separates `tabSessionId`, Chrome `tabId`, `frameId`, `pageInstanceId`, `formInstanceId`, `applicationRunId` and `applicationKey`. A URL or DOM element reference is never the sole application identity.

One guarded state machine owns lifecycle state:

`IDLE -> PAGE_DETECTED -> APPLICATION_DETECTED -> SCANNING -> READY`

Future execution states already have explicit boundaries (`INTERACTING`, `VERIFYING`, `WAITING_FOR_USER`, `CHECKPOINT`), while `UNSUPPORTED`, `RECOVERING` and `FAILED` remain non-contradictory recovery states.

## Permissions and configuration

Required permissions are `activeTab`, `scripting`, `sidePanel` and `storage`. Exact configured Job Hunter web/API origins are generated as required host permissions. Employer HTTP(S) access is optional and granted one origin at a time from an explicit side-panel user action.

`extension.config.mjs` generates public `config.json`; it contains origins and channel only. No secret or bearer token is built into the extension. The website may provide its existing bearer session over the configured-origin bridge; the worker validates it through `/v1/auth/session` and stores it only in `chrome.storage.session`. Expiry erases the token.

## Messaging, privacy and recovery

Every request/response is a strict protocol-versioned Zod discriminated union with a message ID, correlation ID, source, data class and bounded payload. The router validates the Chrome sender and claimed frame origin. Message receipts make retries idempotent; malformed messages fail closed.

Telemetry is value-private by schema: candidate answers, access tokens, resumes, contact information, raw DOM/HTML and field values are rejected. Only bounded structural diagnostics are durable locally.

MV3 listeners register synchronously. Durable runtime metadata is sufficient to re-establish a page after service-worker termination, reload, refresh, SPA navigation or online recovery. Meaningful DOM mutations are coalesced; a cheap isolated-world-safe URL watcher catches page-owned SPA routing without rescanning on every mutation. User-trusted events claim field ownership so later execution cannot fight manual edits.

## Legacy retirement

No V1 path was copied into V2 and no shadow execution exists. Deleting `/Users/mac/projects/job-hunter-agent/extension` is intentionally deferred until J/K/L provide semantic, execution and verified-learning parity. Final deletion belongs to the Z-extension cutover after zero V1 read/write proof.
