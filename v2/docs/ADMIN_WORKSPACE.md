# Local admin workspace

Implemented and verified September 15, 2026. Open `http://127.0.0.1:3000/#admin` (or `/admin`). A link is also available in the candidate workspace sidebar.

## Login and setup

The local project's `v2/.env` now has `ADMIN_EMAIL=admin@jobhunter.local` and a generated `ADMIN_PASSWORD`. Read the password from that file; it is intentionally not copied into documentation, screenshots, frontend environment variables or chat. The file is ignored by Git. Change either credential and restart the API to rotate access.

For another checkout, add these **server-only** variables:

```dotenv
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-unique-password-of-at-least-12-characters
```

Then run from `v2`:

```sh
npm run db:migrate
npm run dev:api
npm run dev:web
```

The project’s database, candidate fingerprint secret and resume-encryption key remain required. Supabase/OIDC and `ENABLE_OPERATOR_REVIEW` are **not** required for this separate admin login. Existing candidate development login settings are unchanged. All scripts use the pinned Node 24.8.0 wrapper.

This temporary authentication requires a loopback API host and non-production mode. Do not expose it through a public tunnel. The API rejects production activation. Session tokens are random, held hashed server-side, stored in browser session storage, expire after eight hours, and are revoked by logout or process restart. Login attempts are rate-limited. There is one administrator identity, not multi-admin RBAC or MFA.

## Available controls

- **Overview:** database counts, active runs, unresolved review counts and 24-hour AI calls/acceptance/latency. Optional 15-second refresh pauses while editing.
- **People & knowledge:** all candidates; current answers grouped by scope/entity; source, trust, freshness, latest entity attributes and the latest 100 answer-history entries. Add/revise supported answers, restore prior answers as new versions, suspend/reactivate account access. Private graph access is audited.
- **Canonical registry:** built-in definitions and current reuse/safety policies; editable administrative descriptions and additional aliases. Existing semantic scope, negative-pattern and type guards remain in force. Alias edits invalidate semantic caches.
- **Canonical proposals:** review actual unresolved descriptor records; create and edit proposed definitions through `PROPOSED`, `IN_REVIEW`, `APPROVED_FOR_IMPLEMENTATION`, or `REJECTED`. Resolving a queue item is triage, not a runtime activation.
- **Representation lab:** per-canonical enable/disable; missing-unit defaults for INR CTC (rupees/lakhs) and total experience (months/years); sample field/typed-value preview through the actual resolver. Explicit employer units take precedence. Immutable candidate values are not converted in storage. Output IDs identify administrative representation revisions.
- **Strategy control:** inspect all definitions and per-pattern state; propose immutable strategy versions, attach independently attested offline proofs, start eligible canaries, evaluate evidence, disable, reject, retire or roll back. The existing strategy service owns every gate; admin cannot fabricate offline approval or bypass a stable-fallback requirement.
- **Applications and runs:** inspect application/run state; abort an authorized/active/paused run. Cannot falsely mark applications submitted or manufacture a successful checkpoint.
- **Field execution and learning:** inspect canonical/answer references, representation IDs, verification failures, strategy IDs, observation origins, attribution and checkpoint references. No direct edit of measured evidence.
- **Failure review:** investigate, resolve, dismiss or reopen a case with revision checks. Closing a case does not deploy a fix.
- **AI usage:** provider/model profile, tokens, latency, acceptance/rejection code and estimated cost metadata. API keys, prompts and provider environment configuration are not editable here.
- **Job catalog:** search/inspect records; change active/stale/closed/expired state with correct terminal timestamps.
- **Documents:** read document lifecycle metadata. No raw storage keys, private download links, file replacement or document approval bypass.
- **Background jobs:** inspect attempts, lease expiry and error codes; retry a dead strategy job with three additional attempts. Cannot steal a live lease or mark work successful.
- **Audit trail:** append-only change/reason/actor/revision records and private graph access. Configuration records retain before/after values for recovery. Candidate answer text is not duplicated into these audit records.

Advanced edits use a validated JSON editor, with a mandatory human-readable reason. Preserve `expectedRevision` or `expectedCurrentVersionId`: stale writes return a conflict rather than overwrite someone else’s work. Most database edits and audit inserts share a transaction. Strategy commands have requested/applied/failed admin audit entries plus the strategy repository's authoritative idempotent transition history.

## Runtime behavior and boundaries

Saved configuration is loaded at startup and refreshed before field-resolution and execution-plan requests. It persists independently of whether the admin login remains enabled. Refresh/rescan the application to use new rules; an already issued execution plan is not rewritten.

Disabling a canonical prevents new execution operations for it, including résumé/cover-letter upload operations, not only text representations.

New canonical keys are **not** arbitrary runtime code. Approval means ready for implementation; a reviewed registry/type/scope/safety change plus migration/tests must still precede activation. Existing answer policies, legal/consent/protected-field confirmation requirements, arbitrary representation algorithms, provider credentials and strategy fixture signers remain code/environment authorities. Admin profile edits cannot impersonate candidate legal confirmation. You can inspect these policies but cannot silently weaken them.

Account suspension affects authenticated candidate access; it does not remotely delete forms already entered in a browser. Aborting a run invalidates subsequent server-authorized work but cannot undo an in-flight browser DOM action. Catalog edits can be superseded by later ingestion. Administrative control does not imply verified autofill quality or passive-learning accuracy.

Use synthetic fixtures for experimental answers; do not put invented facts into real candidate knowledge. Full production identity, multi-admin roles, managed session storage, least-privilege admin database roles, retention/export policy and governed arbitrary runtime releases remain future production work.

## Verification

Final verification on September 15, 2026: the full automated suite passed **502/502 tests**, lint passed, and the production web build passed. Both the isolated admin browser workflow and the read-only live local admin browser smoke test passed. These results verify the admin workspace; they are not a claim that employer autofill or production authentication is universally verified.

```sh
npm run test:admin
npm run test:admin:browser
npm run test:admin:live
npm run build:web
```

`test:admin` uses an isolated complete PostgreSQL-compatible schema and checks auth/rate/expiry/logout, all resource queries, versioning/restoration/idempotency, stale writes, private/immutable audit, protected-field restrictions, proposal transitions, strategy gates, account/job/run/worker controls and representation preview. `test:admin:browser` exercises the real admin API against an isolated synthetic database in Chromium: wrong/right login, every section, profile create/edit/restore, live representation configuration/preview, concurrent-edit rejection, desktop/mobile layout and logout. No employer pages or real profile writes are involved.

`test:admin:live` is a read-only Chromium smoke test of the running local website/API using the server environment credentials; it signs out afterward. Screenshots from synthetic UI testing are under `.local-data/qa/admin-*.png`. Live API endpoint checks returned 200 across all admin lists. The ordered migration/idempotency suite reaches `0034_admin_workspace`; the migration is applied to the local database.

## Main implementation files

- `apps/api/src/admin-auth.ts`: temporary, isolated credential/session authority.
- `apps/api/src/admin-routes.ts`: authenticated API boundary and validation/error handling.
- `apps/api/src/admin-workspace.ts`: bounded allowlisted queries, validated lifecycle commands and audit.
- `apps/api/src/admin-runtime.ts`: guarded aliases and representation configuration.
- `apps/web/src/AdminDashboard.tsx`, `admin.css`: dashboard, inspectors and editors.
- `database/migrations/0034_admin_workspace.sql`: configuration and immutable audit tables.

The older `#operator` workspace is a separate OIDC/MFA/restricted-database review flow. It remains available when configured; this local admin implementation does not replace its production identity requirements.
