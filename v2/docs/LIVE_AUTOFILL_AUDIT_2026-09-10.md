# Live Chrome autofill audit — 2026-09-10

Status: PARTIAL — confirmed defects are fixed and automated regressions pass; final Plane/cross-site live verification is pending an unlocked Chrome session. Do not interpret Phase Q synthetic certification or this inspection as live ATS certification.

## Scope and approvals

User requested actual-user testing at http://127.0.0.1:3000/, existing forms first, more listings only if coverage insufficient. User confirmed the connected personal Chrome account and explicitly approved entering saved name/email/phone/LinkedIn/work-history data into Plane, Postman, Meesho, Visa and Bosch forms. No application submission, resume upload, legal declaration acceptance, account creation or password entry was authorized/performed. No candidate private values are stored in this report.

## Observed coverage

- Local website: jobs, match details, profile/readiness and Apply with Copilot launch. Authenticated development session label differs from the Chrome account; profile contains the intended candidate details. The apparent blank email in accessibility/DOM extraction was ruled out with a screenshot: the actual editor displays it correctly. Do not file an email-loss bug from the text snapshot.
- Plane/Ashby: https://jobs.ashbyhq.com/plane/188f905e-3f6f-4569-9a32-d8ec48dfe656/application — live form opened, extension connected, 13 structural fields/one form, nine understood/five answers ready/four need attention. Fill reproduced no visible mutation; name/email/links remained blank, no completion summary. Content-command warnings recorded at15:04:25 and15:05:07 UTC. Temporary blank side-panel render recovered by closing/reopening the existing extension; this did not fix Fill.
- Visa/Workday: live REF087773W posting → Apply → Apply Manually → mandatory account gate. Six steps shown: account/sign-in, information, experience, questions, disclosures, review. No credentials or consent entered. Downstream fill testing NOT performed.
- Postman/Greenhouse: https://job-boards.greenhouse.io/postman/jobs/7820052003 — inspected split names, email, country/phone combobox, resume/cover-letter uploads, LinkedIn and onsite-work select. Fill NOT performed yet.
- Meesho/Lever: https://jobs.lever.co/meesho/489fe662-5d28-4305-953e-91ee21e8538c/apply — inspected basic contact/current-company fields, links, experience-range radios, notice-period radios, location/relocation choices, compensation textareas and gender disclosure. Fill NOT performed yet. Sensitive disclosure/compensation/relocation choices left untouched.
- Bosch/SmartRecruiters: https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/bfd41fdb-7850-455e-b962-667be13b444b?dcr_ci=BoschGroup — inspected split names/confirmation email, phone prefix, city combobox, experience/education repeaters, social links, message and Next. Opened an empty experience draft, toggled current-employment to confirm end-date disable, then cancelled without saving. Fill NOT performed yet.

Existing listings cover four ATS systems plus major control classes. More listings were not fetched because additional identical openings would not resolve the current execution/access blockers.

## Confirmed findings

1. P1 — Live Plane Fill failed before field execution. Backend Q bindings were persisted at15:05:07.037 UTC, immediately before the15:05:07.048 content-command warning. Local database held16 bindings, four clusters, and no Q jobs at inspection. No execution receipt followed. Combined with the then-loaded page bundle predating Q's strict `strategySelection` plan field, this is the strongest explanation for the no-op: the old content runtime rejected the new plan before execution. The historical exception text was discarded, so this remains a causal diagnosis rather than a captured live error. Version2.0.1 now detects this mixed-bundle condition explicitly.
2. P1 — Negative content acknowledgement is ignored. content/messaging.ts responds accepted:false when a command fails; background/message-router.ts UI_EXECUTE_ACTIVE_TAB awaits chrome.tabs.sendMessage but discards the result and unconditionally returns accepted:true. The side panel therefore cannot distinguish successful execution from a failed content handler. The same unchecked acknowledgement pattern exists for Scan.
3. P1 — Failure details do not reach persistent user-facing status. Content command handler logs only Error.name; the execute callback does not report CONTENT_RUNTIME_ERROR on failure. The side panel handles outer failure generically, and its one-second refresh can replace the error with normal ready state. A ready badge and answer count are not proof of successful filling.
4. P2 — Dashboard is treated as a scannable application surface. With the local Jobs tab active, the side panel reported ready, three fields/one form and three needing attention. Source CONTENT_SCAN_RESULT resolves fields without excluding configured web origins. No proof of Candidate Truth pollution from this observation; it is misleading UI and unnecessary semantic processing. Website handshake must remain functional when addressing this.
5. Unconfirmed rendering issue — Copilot side panel temporarily displayed blank while its accessibility tree still contained controls. Closing/reopening restored rendering. Cause could be Chrome rendering/focus, not necessarily app code; retain as reproduction note, not a proven software defect.

Unrelated Apollo extension emitted a message-port error; do not attribute that error to Job Hunter. Copilot-specific warnings have its own content-script URL.

## Repairs implemented on 2026-09-11

- Content commands now return a strict acknowledgement. The background validates it, converts rejection/malformed responses to typed failures and does not report a false success.
- Bounded, value-free failures are stored in runtime status, survive periodic panel refreshes and clear only when the candidate explicitly retries or a new page instance is registered. Safe diagnostic identifiers are retained without retaining exception text or field values.
- The panel now shows a durable failure/reference, disables Scan and Fill while execution is active, and keeps the visible running state during timer refreshes. Verified/failed/skipped receipt summaries remain visible after completed execution.
- Configured Job Hunter website pages without an application identity are removed from employer runtime storage and are not scanned or sent for field resolution. The website authentication/launch bridge remains active. Explicit application surfaces can still run when a test or deployment hosts one on the same origin.
- Page-scoped scan, graph, intelligence, declaration and failure state is cleared across a new page instance while application-run and step history remain continuous. This removes a multi-step race where the next step briefly inherited the prior step's answer-ready status.
- The dashboard now retries its session offer when the extension bridge becomes available and once after mount. If an Apply click reaches a restarted extension with an expired/missing session, it reconnects and retries the launch instead of stranding the user at an authentication error.
- Extension version2.0.1 records the content bundle version for every application page. Scan/Fill now fails visibly with `EXTENSION_UPDATE_REQUIRED` when a reloaded background is paired with an older page bundle; the rejected command is never sent, and the panel tells the candidate to reload the application page.
- Added the missing `.nvmrc` pin for Node24.8.0. Node20 reproduces unrelated native PDF/PGlite failures and is not a valid test runtime for this repository.
- Schema, Q authority, graph guards, declaration policy and candidate-value telemetry boundaries were not weakened.

Automated verification: lint, typecheck, architecture check, 310/310 full tests, Phase I extension browser smoke, and Phase K/N/Q browser smoke all passed under Node24.8.0. This includes the stale-bundle rejection/durable-failure regression. The runner disables Wasm tier-up only on the affected Node24.8 ARM runtime after reproducing its native PGlite teardown crash. Live Chrome verification still requires an unlocked Mac and a manual unpacked-extension/page reload.

## Remaining major tests

Actual successful Fill on each accessible ATS; per-field before/after verification; first/last-name representation; phone prefix/national format; duration→experience bucket; custom combobox events; repeated entities/dates/current-role handling; candidate overwrite preserved on refill; refresh/SPA/tab isolation; declarations left manual; unknown answers not invented; duplicate Fill; recoverable failures and clear UI summaries. Uploads and final-submission learning require separate approval/controlled fixtures, not real submissions.

## Blockers and handoff

The final live verification stopped when the Mac locked. Before the lock, the personal `Lavish` Chrome profile was active and the updated panel was confirmed on the local dashboard: it showed `Waiting for this page` and no dashboard field/form counts, proving the employer-scan exclusion works in the real browser. The restarted extension then exposed a dashboard session-offer race, which is now repaired and covered by tests, but the Mac locked before that last web build and the Plane Fill could be rechecked.

No real application was submitted, no resume was uploaded and no declaration was accepted. Resume from: unlock Mac → manually reload the unpacked extension to version2.0.1 → reload the local dashboard and Plane page → click `Fill safe fields` → inspect the durable panel result and field readbacks. If Plane still fails, record the new value-free failure code/diagnostic shown in the panel before changing execution policy.
