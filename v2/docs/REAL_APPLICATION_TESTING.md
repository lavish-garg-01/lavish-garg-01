# Local application testing handoff — 2026-09-14

## Prepared

- Accepted roadmap: [derived answers and passive candidate learning](PASSIVE_CANDIDATE_LEARNING_PLAN.md). This is planned work; passive prediction is not enabled. The referenced coverage estimates are not executed benchmarks.
- Local PostgreSQL database backed up to `.local-data/backups/pre-testing-20260914.5ktSQH` (private permissions, custom-format dump).
- Applied migrations 0024–0033 to the configured local `job_hunter_v2` database. Earlier migrations were already current.
- Built API packages, web and extension using Node 24.8.0.
- API running on http://127.0.0.1:3100 and web running on http://127.0.0.1:3000. Both returned successful HTTP responses during preparation. Both listener processes were reconfirmed at handoff; the final repeated HTTP check was blocked by automatic approval review due to the usage limit.
- Authenticated profile endpoint returned HTTP 200. One ready master resume, `lavish garg backend resume2.pdf`, has an accessible stored file. Database contains 99 jobs; this does not establish that every listing is still open.
- Read-only learning-key inventory: all recorded versions configured; four pending observations use version 1. No key rotation performed.
- Existing checkpoint 14 evidence: 485 tests passed and disposable PostgreSQL race/security verification passed. Those tests were not unnecessarily rerun during deployment preparation.

## AI smoke results

Bounded synthetic requests were sent through the existing provider smoke script. OpenAI `gpt-5.6-luna` passed extraction and resume tailoring. Gemini `gemini-3.6-flash` failed extraction with AI_SCHEMA_INVALID and tailoring with HTTP 503 / AI_PROVIDER_UNAVAILABLE. Gemini readiness is unresolved. Production bridge requests allow fallback, but this smoke run tested providers individually and does not certify production fallback end to end. OpenAI is configured to allow private tasks; Groq is configured for non-private tasks and was not live-tested here. Provider settings were preserved.

## Finish Chrome setup

The Mac was locked when browser access was attempted. Unlock it and use the existing Chrome profile with Job Hunter installed. In `chrome://extensions`, reload Job Hunter Copilot. The rebuilt unpacked directory is `/Users/mac/projects/job-hunter-agent/v2/apps/extension/dist`; verify that this is the installed copy's path. Then open http://127.0.0.1:3000, reconnect Copilot if prompted, and reload application tabs so they receive the new content script. If Chrome requests additional site access, review that request directly.

The existing extension was rebuilt on disk; its loaded Chrome instance was not verified or reloaded. Browser testing remains the final preparation step.

## First supervised test sequence

1. Open a fresh Ashby application from Jobs. Check name, contact details, master resume selection, salary units, experience units and joining questions. Keep submission under your review.
2. Test a Lever radio-heavy form: each option group should be one question; verify selected options and remaining-field counts.
3. Test SmartRecruiters, then Workday multi-step forms: detection, resume import, dynamic sections, selects and navigation.
4. Correct a known answer or explicitly save an unknown answer. Verify the saved acknowledgement and scope in Attention/Profile. Check reuse in a second application and ensure application-only commitments do not leak.
5. Inspect every required field before submission. An unchanged field or DOM readback alone does not prove the ATS accepted the answer. Declarations remain yours to review.

For failures, record ATS, question label/control type, expected versus actual representation, displayed error, and approximate time/request ID. Avoid copying private answers into shared logs. Distinguish detected, populated, verified, corrected, unanswered and submitted counts; do not treat every populated field as correct.

The current baseline can be tested now after Chrome reload. Joining-date preferences and passive predictions remain roadmap work; missing reasoning answers should be recorded for that implementation.
