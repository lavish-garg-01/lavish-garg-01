# Bosch live test checkpoint — 2026-09-14

Status: incomplete. This supersedes historical test counts as evidence for this specific live form. No applications submitted in this batch.

## Latest live continuation — September 14, 2026

### AWS DevOps screening investigation and repair

Continuation: added canonical aliases for preferred location (singular), numbered work-experience question, and expected annual salary; numbered-question tests pass. Notice representation now handles strict less-than-day choices, picks the tightest truthful upper bound (45 -> Less than 60 days; 60 -> Less than 90 days), supports explicit day ranges, and rejects overlapping range boundary matches. API/extension TypeScript build and 64 focused tests pass.

Live experiment: setting notice search input to `45` then blurring cleared it and produced a required-field error; selecting the actual Less than 60 days option persisted after blur. This reproduces ATS rejection of an uncommitted dropdown value, not a demonstrated Copilot overwrite of ordinary text. Restored the valid choice. During this continuation expected annual salary automatically filled alongside current salary; final observed count 2/18 with both annual INR amounts correct. Notice remains USER_OWNED after the experiment; it is not an autonomous fill. Preferred locations now recognized. Other screening questions, dynamic option discovery before planning, generic text retention, parser interference and learning remain incomplete. No submission or new application test in this continuation.

On publication `a8554853-afb1-4bf7-a0ff-2a105bc92ce8/screening`, direct Chrome DOM inspection confirmed native inputs inside nested `spl-input` shadow roots, question labels distributed through nested `label-content` slots, and explicit `aria-controls` targets in an enclosing shadow scope. Ordinary label innerText loses this distributed text; immediate-root-only popup lookup misses the linked menu. Implemented recursive bounded slotted-label text (excluding aria-hidden decoration), explicit-ID popup lookup through enclosing shadow scopes, and scanner option evidence from those linked popups. No unassociated document-wide option guessing added.

Added nested-slot and enclosing-popup fixtures to ATS browser regression; regression and extension build pass. Reloaded extension and refreshed live screening, then refreshed dashboard to reconnect: observed current salary automatically populated with correctly scaled annual INR value, and Notice period now recognized. Live coverage remains only 1/18; no claim of end-to-end repair. Latest option-evidence addition was built after this live measurement and still needs a fresh live reload/retest.

Manual experiments before refresh: actual notice menu offers Less than 90/60/30 days and Immediate joiner; selecting Less than 60 days for verified 45-day notice persisted across blur. Experience menu offers Fresher, 1-2, 3-6, 7-10, 10-13, 14-16, 16 plus; selected 3-6 using verified experience. Reloading the employer page cleared these unsaved test selections. These are manual evidence, not Copilot or learned successes. Unprompted clearing of ordinary manual text remains unproven/unfixed. Resume-parser overwrites and component-state synchronization require isolated reproduction. Simplify and FastApply are also enabled in this Chrome profile; interference is possible but unproven, and neither was disabled.

Remaining: dynamic option discovery before representation planning; range mapping against overlapping upper-bound choices; other missing screening labels and radio grouping; retention of manual text during parser activity/rerenders; resume attachment verification; grounded hiring-message draft path; true submitted-evidence learning. No submission, PAN entry, or consent acceptance in this investigation.

Follow-up: corrected the field-intelligence test to read `result.resolution.canonicalKey`; API TypeScript build and all 59 tests in that file passed under Node 24.8.0. Subsequent live retry recovered the direct Chrome connection. Bosch's expired session was restarted, exposing an empty 14-question form. Mini-panel launch successfully opened the side panel, which reported `The verified learning service is temporarily unavailable. Reference: API_UNAVAILABLE`. API `/health` returned HTTP 200. Dashboard refresh, Reconnect and Resume/retry did not establish successful autofill; it remained 0/14. This is a learning-request-path failure, not proof the API process is down. The client masks non-auth HTTP errors and parsing/network exceptions with the same message; the exact server response is still needed. No submission and no new-role test completed in this follow-up.

- Reloaded Job Hunter in the Lavish Chrome profile and refreshed Bosch screening. The earlier activation button did not activate Copilot. After refresh, native browser inspection no longer exposed the Bosch page body; the screening-route repair remains live-unverified. Bosch was not submitted. The Senior DevOps listing requires at least five years of software experience and three years of Kubernetes; those qualifications are not established by the verified candidate facts.
- Opened Meesho Backend publication `c68ee07f-0e16-455b-bc4a-87848aaf46fa`. Initial Copilot state requested a dashboard connection and showed 0/19. Refreshing the dashboard restored automatic filling to 9/19, including resume, contact/profile links, employer and annual salary amounts. This is an observed UI count, not an independent accuracy score.
- Manually completed current location, gender, experience range, notice-period range, Bangalore-residence answer and discovery source using supplied facts. Copilot was paused to preserve these edits; its counter remained 9/19. Whether manual changes are reflected after resuming is not yet verified. Optional unsupported profile links remained blank.
- Clicked Submit Application after reviewing the required fields. Lever redirected to `/already-received` and explicitly reported a previous application on September 14, 2026, with a six-month resubmission interval. **This attempt did not establish a new successful submission. Do not count it as successful learning evidence.** No duplicate retry was attempted.
- Returning to the dashboard exposed only Chrome controls, not page content. Refresh and a full accessibility snapshot did not recover it; screenshot capture returned a solid magenta image. Further live application testing is blocked on browser visibility, not demonstrated to be a project failure.
- Remaining: verify duplicate-result classification in the learning pipeline; automatic range-option resolution and city fill; connection recovery without dashboard refresh; post-edit counters; Bosch screening and shadow-control execution; then test a different, not-already-submitted role. No live learning improvement is claimed from this run.

## Target and observed baseline

SmartRecruiters Bosch publication `2caf2350-8844-4aba-a8cb-86c8d5e956db` (SAP BTP Full Stack Developer).

- Copilot appeared automatically; populated 3 of 14 scanned controls (email, confirmation email, LinkedIn).
- First and last names remained blank despite a trusted full name.
- Phone failed validation; its web-component host carried a value while its native shadow input was blank. Cause is not yet conclusively isolated.
- City was dependency-blocked. Both shadow-root uploaders remained empty.
- Experience and education remained collapsed. Repeated graph invalidation and widget rerendering interfered with progress.
- No next-step navigation or submission was performed. This role's qualification suitability has not been verified.

## Changes implemented and built, not live-verified

- `ats-autofill.ts`: inspect composed ancestors for native resume-parser and resume-upload labels; track parser target inputs across open shadow roots.
- `scanner.ts`: use these upload labels to distinguish the two controls.
- `executor.ts`: make standard text input and strategy INPUT events composed so they reach shadow hosts.
- `ats-surface-browser-smoke.ts`: add two separate shadow uploader fixtures with duplicate internal IDs and assert distinct labels; assert shadow target tracking.
- `npm run build:extension` passed. Updated development output is `apps/extension/dist`.

At the preceding checkpoint the browser regression had not run because approval review hit the account usage limit. That blocker is now cleared; see resumed verification below. The rebuilt extension still has not been reloaded and retested on the live form.

## Resumed verification — 2026-09-14

- The previous approval blocker cleared. ATS-surface Chromium regression passed, including shadow upload labels and target tracking.
- Fixed malformed-pattern verification to return UNVERIFIABLE rather than treating unknown native validation as success. Three focused tests pass, including the independent verifier's final outcome.
- Added nearby explicit ancestor/host labels for generic Add buttons so experience/education actions retain their semantic role. Ordinary unlabelled Add buttons are not promoted; native submit takes precedence. Browser regression passed.
- Development extension rebuilt successfully; lint passed; full unit/integration suite passed 489/489 with no skips.
- Synthetic production-repository learning benchmark: 57/80 correct, 0 wrong, 23 abstained across 20 simulated applications. Explicit confirmations seed the learning, not passive employer submission; no AI calls.
- Browser learning regression initially timed out locating application B's email input. Added a wait for the application form before sending the execution command, plus an assertion that safe fill preserves the form. The next run passed the grouped learning, reuse, correction, abandoned/failed evidence, repeatable identity and Undo scenarios. This fixture uses synthetic data/test services, not real employer acceptance.
- Existing live Bosch tab observed at 4/14 populated on its loaded extension. This is NOT a live result for the newly rebuilt extension. User was asked to reload Job Hunter and refresh Bosch; no fresh live verification or submission yet.

## Next required work

### Screening route repair

User reconfirmed Gurugram as current location. Do not infer different employment-location answers from this general fact. Root cause of screening activation: known OneClick route excluded `/screening`; generic continuation only handled numbered steps. Fixed bounded screening/review/summary/confirmation detection and normalized OneClick publication identity independent of per-step form actions. Eight identity tests, ATS-surface Chromium regression and extension build passed. Latest build has NOT been live-reloaded/retested. City option commitment remains unverified; it uses a searchable geographic choice, not only a text value. Random PAN and fabricated answers are permitted only in isolated synthetic tests, not employer submission or real candidate truth.

### Native Chrome live continuation

Browser connector still returns User unavailable, but native `cua.getApp('com.google.Chrome')` works. Continue with native AX controls rather than repeatedly requesting connector recovery.

On Senior DevOps Bosch publication aaf07bdb-43c3-479a-b4ba-599e3a1c902c, paused Copilot and manually entered confirmation email (matching existing email); validation error cleared. LinkedIn URL retained. Typed Gurugram into City; suggestions later appeared including Gurugram, Haryana, India, but selection was NOT confirmed before navigation. Added a short hiring-team message using existing backend/real-time/Node.js/Redis/SQL/ClickHouse facts without claiming additional DevOps credentials. These are manual test interventions, NOT Copilot successes or confirmed learning.

Clicked Next, verified navigation to `/screening`. Screening form rendered with qualification, notice, experience, preferred location, current/expected salary, prior Bosch association, other offers, Bosch connections, gender, PAN, automated-recruitment consent and privacy acknowledgements. Copilot is absent from the observed screening AX tree. No submission or consent performed. Pause for user answers and consent; never infer PAN, gender or employer associations. City commitment and resume-derived employment dates still require review before final submission. Next application not opened.

### Four-field follow-up (Senior DevOps publication aaf07bdb-43c3-479a-b4ba-599e3a1c902c)

Observed live after the user's screenshots: ATS populated names, four experience entries, education and resume; confirmation email, city, LinkedIn and hiring message remain blank. Copilot reports 4/14 populated. Do not count ATS resume extraction as Copilot execution or trusted learning.

Implemented: explicit confirmation-email aliases; context-gated bare City mapping; section context across open shadow roots; composed autocomplete input events; hiring-team message aliases to existing rich-text COVER_LETTER. Focused semantic suite 59/59 passed, including negative city contexts. ATS browser regression passed with a nested city-section fixture. Extension build passed.

NOT resolved/verified: email and LinkedIn already resolve deterministically in focused tests; their actual live execution failure remains untraced. City option association and final selection have not been live-verified. Hiring-message recognition is fixed, but automatic grounded narrative generation is not wired into this resolution path merely by adding an alias. It still needs an approved/scoped rich-text answer or a dedicated grounded draft workflow. No new claims of AI-provider health or live learning are justified. No next application tested or submitted during this follow-up; retain the original next-work list.

1. Reload the development extension and refresh the Bosch application; the local ATS-surface browser regression has passed.
2. Retest both uploaders and native-parser completion, then text inputs across web-component boundaries. Preserve user-entered values.
3. Diagnose national phone formatting with the separate country selector and host/native synchronization; do not assume composed events alone solve it.
4. Trace first/last-name derivation from verified full name with provenance and ambiguity handling; city autocomplete; repeated experience/education entry controls.
5. Diagnose graph-revision races and UI rerender detachment. Keep genuine stale-plan safety rather than disabling guards.
6. Malformed-pattern verification is repaired and regression-tested. Still inspect panel launch origin checks, async failure handling, and CONTENT_HELLO panel eligibility.
7. Verify learning end-to-end using isolated synthetic cases before using employer submissions as evidence; unchanged predictions must not self-confirm unverified facts.
8. Proceed to Lever/Meesho and the remaining database jobs after Bosch regression checks; track attempted, filled, incorrect, abstained, corrected and submitted separately. The hundreds-of-applications campaign is still outstanding.

Use verified candidate facts only on employer sites. Keep invented answer experiments in local fixtures. Ask for missing qualifications, login or CAPTCHA assistance. Do not accept declarations on the candidate's behalf or submit a role with unresolved factual answers.
