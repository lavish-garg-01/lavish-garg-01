# Extension delivery recovery — checkpoint 10

## What is delivered

Private-note saves and the existing RESOLVE/PLAN outcome reports now use a bounded background queue. The queue is a transport mechanism only: no automatic truth promotion, canonical creation, employer submission or rule activation.

- **Private notes:** Chrome extension `storage.session`, restricted to TRUSTED_CONTEXTS. Answers are not written to extension local disk storage. Pending notes survive employer-page reloads and service-worker suspension/recreation in the same browser session, but **not Chrome shutdown/restart or extension reload**. The explicit save prompt explains this retention and retry behavior, and the private request must include `allowSessionRetry: true`; old requests without that consent use immediate delivery only.
- **Diagnostics:** `storage.local`, also restricted to TRUSTED_CONTEXTS. Strict allowlisted outcome schema; no field labels, answers, credentials or free-form error metadata. Pending diagnostics can survive browser restart and send after reconnecting to the same verified candidate/API origin.
- Each store retains up to 200 entries for 24 hours, including small acknowledgement/rejection receipts. Pending overflow rejects and increments a dropped counter. Diagnostic completed receipts may be evicted for capacity; private-note receipts are retained to preserve repeat-save identity. The private queue therefore can require waiting for expiry even if many prior entries were delivered.

## Identity and retry safety

Candidate binding comes from a successfully validated server `/v1/auth/session` response, never email, token decoding or content-page claims. Session offers reset the binding. Serialized auth writes prevent a late validation from restoring an old token. Queue owner identity is a hash of API origin and candidate ID (candidate UUID is the server's globally unique candidate identity); tokens are not persisted in delivery entries.

Before a flush, the queue validates the server session again and pins all sends to that exact token. Token/candidate changes stop delivery. API ownership checks remain the authority for every run/application. Opening delivery status or flushing after switching candidate/API origin discards the old owner's queue rather than exposing or delivering it under the new identity. Counters are retained-owner history, not cross-account totals.

Stable diagnostic event IDs survive retries. Private-note semantic identity includes application, run, question, answer and source, but excludes newly generated transport item IDs and page-instance IDs. Repeating the same note within the retained session/run reuses the original server item ID. Changed answers get distinct IDs. A new application run is not deduplicated against an older run. Explicit repeated saves of delivered notes recheck the server tombstone; deleted/expired notes cannot be resurrected by replay.

Attempts are persisted before sending. If the worker crashes after server commit but before local acknowledgement, the original ID is retried against the server's existing idempotency path. Up to six attempts, exponential backoff (60 seconds initially, capped at one hour), and at most five sends per flush. HTTP 408, 429 and 5xx are retryable; authentication blocks delivery until reconnect; non-retryable errors and exhausted attempts become rejected. Payloads are removed after acknowledgement, rejection, discard or expiry.

The worker creates a one-minute Chrome alarm and also flushes after enqueue/reconnect/startup. Alarm timing is best-effort, not a delivery SLA: Chrome may delay or suspend execution. Expiry is enforced on the next queue access/wake, including when disconnected; no process runs while Chrome is closed. A network flush serializes queue access to avoid lost updates, so status/discard may wait for current requests. No ongoing external automation was installed by the coding task; this is extension runtime code.

## Honest user feedback

The save button checks the response type and success acknowledgement. ERROR_RESPONSE no longer displays “Saved.” Queued text says to open the panel for delivery status; only an actual immediate server acknowledgement says saved. Missing/old acknowledgement details say delivery is unconfirmed.

The side panel displays queued notes/diagnostics, acknowledged, rejected and expired/dropped counts. Counts reflect retained queue records, not all application failures, lifetime metrics, per-field coverage or autofill accuracy. A discard button requires confirmation and removes unsent local payloads; it cannot cancel an already-sent request or delete server notes. Manage server notes in Attention. Rejected note payloads are not kept in a dead-letter viewer; the candidate may need to re-enter the answer or use Profile directly.

## Activation and verification limits

Rebuild and reload the extension, approve its new `alarms` permission if prompted, reload existing employer tabs, and reconnect from Job Hunter so the verified candidate binding is populated. This task built a separate temporary test artifact only; it did not replace/reload the installed extension, submit applications or modify candidate data. No new DB migration; previous checkpoints still require migrations through 0028.

Tests cover synthetic queue storage/restarts, duplicate identity, backoff, capacity, expiry, account/token changes, discard, rejection, request-token pinning, crash-after-server-ack and transient HTTP limits. Synthetic browsers exercise the production save method and side-panel UI. Real installed MV3 suspension/alarm timing and live employer verification remain pending. Loss before successful local persistence and browser-session termination are not fully measured. Detailed per-note retry controls, disk-encrypted private persistence with explicit consent/key lifecycle, historical HMAC/checkpoint reconciliation and broader field-event coverage remain future work.
