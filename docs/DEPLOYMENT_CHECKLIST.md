# Pre-deployment checklist

Run this before shipping any Job Hunter server or Chrome extension build. Automated tests catch contracts; this list catches the candidate-facing flows those tests cannot click.

**Current extension version:** `1.15.8`  
**Local dashboard:** `http://127.0.0.1:3001`

## 0. Always before you start

- [ ] `npm test` is green (live unpacked diagnostic may skip if an application is already SUCCESS).
- [ ] Restart `npm run dev` so server mapping packs, API, and EJS views reload.
- [ ] Chrome → Extensions → Job Hunter → **Reload**. Confirm the card shows **1.15.8**.
- [ ] Open the dashboard in a normal Chrome tab (not an incognito profile that cannot see the unpacked extension).

## 1. AI answers toggle

The stored flag is still `aiProcessingConsent`. The UI means: **use AI-generated leftover answers on the employer form**. Verified profile/resume facts still fill locally either way. The candidate still reviews and submits. Paid-only is reserved (`requirePaidForAiAnswers` is currently `false`).

- [ ] Side Panel footer label is **AI answers**, not “AI data enhancement”.
- [ ] Toggle **off**: leftover writing (motivation, “describe a project”) is not drafted by AI. Name, email, Node.js years, and other verified facts still fill.
- [ ] Toggle **on** (and `AI_PROCESSING_ENABLED=true` in `.env`): leftover writing can be drafted from the resume. Nothing is submitted.
- [ ] Onboarding and COPILOT profile checkbox use the same meaning.
- [ ] Reloading the Side Panel keeps the last toggle state.
- [ ] Protected fields (CAPTCHA, OTP, legal, visa, password) never fill regardless of the toggle.
- [ ] **Ask AI** remains available with or without a prepared application; direct profile facts are answered locally.
- [ ] With an application open, Ask AI can explain unresolved fields and document failures from value-free attempt evidence.
- [ ] Ask AI never writes to the employer form, never submits, and never chooses a legal, consent, demographic, OTP, CAPTCHA, or password answer.
- [ ] Ask AI requests and token use appear in usage/AI telemetry without storing the raw question or candidate values.

## 2. Platform tags

Every job/application from a known board or ATS family must show a tag. Host wins over source, so a JobSpy row with a `linkedin.com` URL is **LinkedIn**.

Expected tags: LinkedIn, Indeed, Naukri, Wellfound, Instahyre, Hirist, Cutshort, Greenhouse, Lever, Ashby, Workday, Rippling, Keka.

- [ ] Dashboard job **list**: tag under company/location.
- [ ] Dashboard job **detail**: tag next to source; Partial/Assist jobs show a mode badge and a reason before Open with Extension.
- [ ] COPILOT qualified-jobs list and application cards show the tag.
- [ ] Attention Center session cards show a dark platform tag.
- [ ] Side Panel job header shows the tag while applying.
- [ ] Unknown/direct career sites show **no** fake tag.
- [ ] A JobSpy LinkedIn URL is tagged LinkedIn, not a generic “jobspy” label.

## 3. Grouped application tabs

- [ ] Dashboard **Open with Extension** opens **one new grouped tab** titled `Job Hunter · Applying`.
- [ ] Employer `_blank` hops stay in that **same** application tab (login popups may stay separate).
- [ ] Starting a second job from the dashboard while one is active moves the first session to Attention; the new job uses the grouped apply tab.
- [ ] Side Panel **Attention / Profile / document dashboard links** reuse the **same grouped dashboard tab**. They must not spawn a new ungrouped Chrome tab.
- [ ] Document **Open** creates a dedicated tab inside `Job Hunter · Applying`; COPILOT there shows only **Go to application tab**.
- [ ] **Go to application tab** closes only the document tab, focuses the employer tab, returns COPILOT to Documents, and replaces the selected resume when a compatible field exists (otherwise it records Attach pending).
- [ ] COPILOT Side Panel stays **off** on the dashboard tab and **on** only on the application tab.
- [ ] Confirming submitted / closing the apply tab focuses the dashboard and leaves unfinished work in Attention.

## 4. Review-only safety

- [ ] COPILOT never clicks the employer Submit / Agree & Submit control.
- [ ] Kill switch / stop / pause still halt fill.
- [ ] Password, OTP, CAPTCHA, government-ID, demographic, and declaration controls stay empty in the current build.
- [ ] Side Panel learning never blocks autofill and exposes **Do not learn from this application** when the global preference is on.
- [ ] Turning application learning off prevents future-memory promotion for that application without clearing the employer form.
- [ ] Declaration copy explains that it is application-specific authorization, not reusable candidate memory. High-impact actions remain direct/per-item.
- [ ] Existing employer values are not overwritten without a candidate choice.
- [ ] LinkedIn Easy Apply is not treated as a fillable employer form.

## 5. Support modes (Autofill / Partial / Assist)

Every known board or ATS shows a mode **before** Apply. Unsupported chat or Easy Apply must never look empty.

- [ ] Greenhouse / Lever / Ashby / Workday / Rippling / Keka / Wellfound job cards show **Autofill**.
- [ ] Naukri, LinkedIn, Instahyre, Indeed, Hirist, Cutshort job cards show **Partial**.
- [ ] Job detail for Partial/Assist explains the hop or copy path before the candidate opens the listing.
- [ ] Naukri **chat apply** (“Type message here…”): Side Panel says **Assist mode**, shows the current question, and a **Copy** button for the profile answer. “Years in Backend Development” copies **total** experience; Node.js/React/Kafka stay unanswered. It does not pretend to have filled the chat box.
- [ ] LinkedIn **Easy Apply modal**: Assist mode with copyable answers scraped from modal labels/legends (education, work authorization, tech years). LinkedIn listing without the modal stays Partial and prefers “Apply on company website”.
- [ ] Instant-apply boards still do not click bare Apply; Assist cards appear instead of an empty “user action required”.

## 6. Listing-to-employer hops

- [ ] On a Naukri or LinkedIn **listing**, the Apply control chosen belongs to the open job, not to a “similar jobs” rail.
- [ ] Where an employer-site hop exists (“Apply on company website”), that hop is preferred over an on-board apply.
- [ ] Naukri **Apply on company site**: when Naukri opens an employer child tab and replaces the listing with `/myapply/showAcp`, the employer URL wins, returns to the controlled grouped application tab, and records `redirectRecovered` without treating the receipt as submission proof.
- [ ] On Naukri and Instahyre, a bare **Apply** is **not** clicked. The Side Panel explains that the board would send the saved profile instantly and asks the candidate to click it.
- [ ] After the candidate clicks Apply, the session continues on the employer form in the same grouped tab.

## 7. Portal fill quality

- [ ] Workday employment-history dates fill as one field: month and year sections both populate (`MM/YYYY`).
- [ ] A date control with a declared mask (`dd/MM/yyyy`, `MM/YYYY`, native date) receives the value in that shape; a non-date answer such as “Immediately” is left as typed.
- [ ] Wellfound/Greenhouse **Location** combobox: a suggestion is selected (`aria-activedescendant` or ArrowDown+Enter). If nothing matches, the field is left as the page had it (never typed-but-unselected) and appears in Attention.
- [ ] Location and years-of-experience come from the profile, never from AI, even when phrased as a question.
- [ ] Rippling resume upload: the file survives the control swapping/clearing it (retry), and the panel reports honestly if it truly fails.
- [ ] Greenhouse/Lever/Ashby **iframe** apply: fill and resume attach happen inside the embedded form, not only on the host page.
- [ ] Workday resume/cover inputs with `data-automation-id` attach to the correct control.
- [ ] SmartRecruiters emits one verified resume-upload operation for one document selection; mutation rescans do not replay the upload and the page receives only the adapter-approved `change` event.
- [ ] SmartRecruiters Experience and Education entries are expanded and filled record-by-record; internal section Save controls may be used, but the final application submit remains untouched.
- [ ] Cisco/Phenom is identified as **Phenom**, not Generic; the first visible Experience row fills job title, company, dates, current-role state, and skills from structured resume facts. React-cleared values are reported as failed/review, never completed.
- [ ] Side Panel live progress distinguishes detected, started, filled, skipped/review, and failed operations without showing raw field values.
- [ ] After promoting a pack to CANARY, the **next** fill on that host uses the CANARY pack (not a stale DEFAULT cache).

## 8. Learning hygiene and adapter ops

- [ ] `/admin/adapters` → **Learning hygiene** card shows counts and any skipped clusters.
- [ ] `/admin/adapters` → Mapping packs shows Form A **PASS** or **FAIL** with a reason (never “skipped”).
- [ ] Promoting SHADOW → CANARY for a pack that collides resume/cover (or drops the resume test id) is blocked until Form A PASSes for that ATS.
- [ ] A SHADOW pack does not override the seeded DEFAULT pack on the hot path; a CANARY pack does.
- [ ] A proposal with no structural selector or a `CUSTOM_FIELD` key shows **Cannot promote** with a reason and no promote button.
- [ ] Promoting a valid proposal still writes a `LOCAL_DRAFT` pack and never a content-script patch.
- [ ] No new `portal_field_patterns` rows with empty `selector_candidates_json` after a fill run.
- [ ] `npm run campaign:seed -- 5000` maintains the observed career-page inventory without duplicate tracking URLs.
- [ ] The certification queue rotates across portal kinds, skips PASS/LIVE_VERIFIED targets on the same extension + adapter + page fingerprint, and reopens them only for a changed build, changed fingerprint, or explicit failure.
- [ ] Discovery-only engines remain backlog items and are never shown as supported Autofill adapters.
- [ ] Random test data is used only in owned fixtures. Real employer pages use verified candidate facts and stop at login, CAPTCHA, legal attestation, or final submission.

## 9. Chrome restart session restore

- [ ] With an application mid-flow, quit and reopen Chrome with the apply tab restored: the session rebinds to that tab and the Side Panel still works.
- [ ] With the apply tab **not** restored: the application appears in the Attention Center as “Continue this application after the browser restart?” and the local session is cleared.
- [ ] An already-submitted application is never reopened by a restart.
- [ ] The application timeline shows a `SESSION_RECOVERED` event.

## 10. Core apply loop (smoke one Autofill portal and one Assist surface)

Pick one Autofill portal (Greenhouse, Lever, Wellfound, or the local `/extension-diagnostic`) **and** one Assist surface (Naukri chat apply or LinkedIn Easy Apply modal).

- [ ] Autofill: form is detected; safe fields fill; resume attaches; cover letter fills if present.
- [ ] Attention items appear for leftovers.
- [ ] Documents tab: fitted full-page Quick Look has no black tail; Download works; Attach appears only for a compatible live target; dragging either the preview or the blue drag bar highlights and attaches to the correct field.
- [ ] Resume preview: summary, first-role bullets, included master skills, and additional truthful skills save as a job-specific delta; the master resume remains unchanged and the regenerated PDF still passes A4/ATS checks.
- [ ] Profile tab: facts match the dashboard; **Edit profile** opens `/copilot#profile` in the grouped dashboard tab.
- [ ] After a hop (SPA or next page), the same job session continues.
- [ ] Assist: Side Panel shows **Assist mode** with copyable answers for the current question; it does not claim the chat/modal was filled.

## 11. Do not block this release on

These are product intents, not implemented in 1.15.8. Do not block ship on them, and do not reopen the dropped fill-reliability extras:

- A paid paywall for AI answers
- ASSISTED / AUTOPILOT autonomy levels
- Cloud or Postgres migration
- A new queue / multi-job state machine beyond Attention + one active apply tab
- Splitting remaining `content.js`, 15-persona mock ATS lab, Indeed-as-ATS pack, version bump for its own sake

## 12. Ship gate

- [ ] Checklist above is done for the build you are shipping.
- [ ] No `.env`, credentials, or `.cursor/mcp.json` in the commit.
- [ ] Extension zip / unpacked folder is **1.15.8** and matches `extension/manifest.json`.
