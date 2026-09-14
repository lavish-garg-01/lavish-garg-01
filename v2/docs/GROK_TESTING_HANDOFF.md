# Grok / Cursor handoff: Job Hunter V2

Prepared 2026-09-15. Copy this prompt into the agent working in this checkout. This is a working brief, not a claim of universal ATS compatibility.

## Your assignment and product goal

Continue improving the existing Job Hunter V2, not rebuilding it. My goal is to outperform Simplify Copilot in measured correct autofill, contextual reasoning, useful answer reuse, Indian application coverage, and review experience. The desired journey is: find suitable job → open application → prefer employer résumé parsing → automatically fill remaining supported questions → clearly review gaps/corrections → submit accurately. Consent/acknowledgements are separate from ordinary reusable facts. I prefer V1's compact website, job list/detail layout, onboarding, attention workflow and document UX, with V2's stronger architecture.

You must test actual employer application pages in a browser with our extension loaded. Unit tests, mocked API results, and manually entering fields do not prove Copilot works. Diagnose failures, implement generic repairs, rebuild/reload the affected components, retest the original failure, then test a different application. Evaluate correctness and retained values, not merely whether a textbox briefly contains text. Do not stop at screenshots saying “8 filled.”

## Workspace and source-of-truth order

On this Mac, repository root is `/Users/mac/projects/job-hunter-agent`; active project is `v2/`. In another checkout use the equivalent paths. V1 at the root is a reference/behavior oracle, not a runtime dependency for V2. Preserve unrelated work. Read applicable AGENTS.md if present.

Start with these files, resolving paths relative to v2:

1. `docs/GROK_TESTING_HANDOFF.md` — this brief.
2. `docs/CONTEXT_INDEX.md` — retrieval map. It contains historical sections labelled “current”; newest dated evidence wins, not an old heading.
3. `docs/ADMIN_WORKSPACE.md` — newly implemented local admin control plane and boundaries.
4. `docs/ADAPTIVE_AUTOFILL_ARCHITECTURE.md` and newest sections of `docs/ADAPTIVE_AUTOFILL_PROGRESS.md` — ownership and incomplete architecture work.
5. `docs/BOSCH_LIVE_TEST_CHECKPOINT.md` and `docs/VISA_LIVE_TEST_CHECKPOINT.md` — real-site observations, interventions and unresolved issues. These contain successive historical entries; verify the current browser/build before assuming a failure remains.
6. `docs/REAL_APPLICATION_TESTING.md` and `docs/AUTOFILL_WORKSPACE_HANDOFF.md` — environment, UX and testing history.
7. `docs/PASSIVE_CANDIDATE_LEARNING_PLAN.md` — accepted roadmap, NOT an implemented general passive-prediction engine.
8. `docs/AI_ORCHESTRATOR.md`, `docs/STRATEGY_INTELLIGENCE.md`, `docs/REVIEWED_EXPORTS.md`, `docs/SUPPORT_REVIEW.md`, `docs/LEARNING_KEY_ROTATION.md`, and relevant package READMEs as needed.

Inspect source/tests before editing. Older README phase labels and historical passing-test counts do not describe the entire current state. Record code present, configuration enabled, build installed, synthetic test passed, live employer verified, and submission verified as separate facts.

## What exists

V2 is a TypeScript modular monolith with web, API, worker, extension and PostgreSQL, using typed contracts, explicit domain owners and migration history. Modules include:

- `packages/contracts` and `domain`: shared types/contracts and registry concepts.
- `candidate-truth`: typed candidate answers, provenance, contextual/global resolution, versions, optimistic concurrency, undo/restore. It owns truth; AI/DOM/telemetry must not write around it.
- `onboarding`: résumé extraction/import proposals, reviewed profile facts and Indian employment preferences.
- `job-intelligence`: ingestion, normalization, deduplication, lifecycle and matching. Matching is guidance, not proof of eligibility.
- `field-intelligence`: semantic field classification, canonical mapping, deterministic/AI-assisted resolution and unresolved proposals.
- `form-graph`, `repeatable-entities`, `execution`: field dependencies, question groups, repeated history, guarded plans, representations and execution evidence.
- `declaration-policy`: separate legal/consent/sensitive handling; ordinary global fallback must not bypass this.
- `verified-learning` and `application-intelligence`: scoped observations, submission/checkpoint evidence, candidate-approved recovery and reuse. This is not automatic model retraining.
- `ai`: central provider adapters/routing, schema and grounding validation, privacy restrictions, quota/cost/time limits, fallback and rejection telemetry.
- `strategy-engine` and `strategy-intelligence`: deterministic strategies, measured proposals, offline approval/canary/rollback controls. Do not fabricate evaluation proof.
- `telemetry` and `database`: value-private diagnostics, persistence, migrations, tenant boundaries and audit.
- `apps/extension`: application-journey detection, scanning including some shadow/frame/dynamic controls, résumé-first behavior, automatic safe fill, mini Copilot, native side panel, field focus/attention, pause/resume, user ownership and grouped application tabs.
- `apps/web`: V1-inspired Jobs list/detail with About/Match/Documents, profile/onboarding, documents/tailoring and Attention. It is not a complete universal blocker queue.

Ordinary applicable answers generally resolve application → job → company → search → global under policy. Reviewed profile/résumé facts are normally global. Explicit narrower answers win; stale/conflicting answers require resolution rather than being silently overwritten. Do not treat a company-specific willingness answer as unlimited relocation consent.

The local admin workspace is at `http://127.0.0.1:3000/#admin`. Credentials are server-only ADMIN_EMAIL/ADMIN_PASSWORD in `v2/.env`; Supabase is not required. It exposes users/scoped knowledge/history, aliases/canonical proposals, representation defaults and real previews, strategy lifecycle, applications/runs, execution/learning/failures, AI, jobs/documents/workers and append-only audit. Runtime aliases/defaults refresh on new resolve/plan requests. New canonical activation, arbitrary runtime code and protected policies still require reviewed code/migrations/tests. This temporary login is local-only, not production RBAC/MFA.

Latest verification: full suite 502/502 passed during admin completion; subsequent login fixes passed four admin tests, typecheck and lint. Actual browser wrong-password feedback and successful login were verified. Those later changes add a test, so run the suite for a new total rather than repeating 502 as current. Fixed an expired-session login “Signing in…” deadlock and split bad-credential 401 from rate-limit 429. The new expiry regression was added to the browser script; do not claim that entire script was rerun after this last edit. Migration 0034 was applied locally. None of these admin results certifies employer autofill.

## Setup and browser reality

- Website `http://127.0.0.1:3000/`; API `http://127.0.0.1:3100/health`.
- Use existing processes when healthy. Do not create competing servers or silently switch ports to3001.
- `npm run dev:api`, `npm run dev:web`, migrations, builds and tests use pinned Node24.8.0 wrappers. Check package.json; plain Node/npm dependency commands may use the shell runtime.
- Read `.env.example` for configuration names. Actual `.env`, `apps/web/.env.local`, database, PDFs and private logs are confidential. Never print or commit provider keys, passwords, tokens or encryption material. Do not rotate shared secrets casually.
- Development extension output is `v2/apps/extension/dist`. After rebuilding, reload the exact unpacked extension in the browser and refresh employer tabs; new disk files do not replace existing content scripts. Verify API3100/web3000 configuration, host permissions, connection and application/run identity.
- The user permits their existing `lavishgarg.tech@gmail.com` Chrome profile. A separate test browser/profile is acceptable if it has the unpacked extension, local-project connectivity and correct Job Hunter test-user login. Chrome account login does not authenticate Visa/Workday or other employer accounts. Ask for login/CAPTCHA help when required.
- In cloud/remote Cursor, loopback points to the remote machine, not this Mac. Run a suitable isolated project/database in that environment, or use a specifically authorized secure connection. Do not expose the local admin publicly or copy all production secrets into a remote browser.

## ATS scope and job selection

Code currently names five ATS families: ASHBY, GREENHOUSE, LEVER, WORKDAY, SMARTRECRUITERS; GENERIC is the sixth classifier value, a fallback, not another vendor. See `apps/extension/src/shared/identity.ts`. The live-sync script also enables these five source families. This does NOT mean there are only five ATS products worldwide, or every widget on these five works. LinkedIn/native Easy Apply currently has entry guidance, not certified automatic fill/submission.

### Additional user-requested coverage — not yet certified integrations

Extend discovery and application-journey testing to **Cutshort, Instahyre, Hirist, Wellfound, The Product Folks, NextLeap, Airtribe, LinkedIn Jobs, and Naukri.com**. These nine names are requested coverage targets, not nine newly implemented ATS adapters. Distinguish job portals, recruiting platforms, community/career opportunity sources and the downstream employer ATS. Inspect the actual current product and flow before assigning capabilities; course enrollment, community signup and contact forms must not be mistaken for job applications.

For every target, record discovery availability, sign-in requirements, native versus external application destinations, résumé/profile reuse, screening questions, submission confirmation, duplicate detection, and measurable learning outcomes. Capabilities stay UNKNOWN or UNVERIFIED until inspected and tested; no public API or scraping permission is assumed.

- **Cutshort, Instahyre, Hirist, Wellfound, Naukri.com:** test available job discovery, profile-backed application flows, additional questions, salary/notice/location representations, and any external employer redirects. Verify each individually rather than assuming a common portal form.
- **LinkedIn Jobs:** test external Apply and native Easy Apply as separate journeys. Entry detection is not native application execution support. Preserve platform-profile versus Job Hunter truth distinctions; never interpret an Apply click as confirmed submission.
- **The Product Folks, NextLeap, Airtribe:** first establish which current pages actually offer relevant jobs/opportunities. Follow legitimate employer application destinations where present. Keep learning-program enrollment, paid offerings and general community forms outside automatic employment autofill.

Keep source identity separate from execution identity: an opportunity discovered on a portal may ultimately execute on an already supported ATS. Preserve source provenance, employer posting identity, application/run continuity and required host permission through redirects; deduplicate the same role across sources. A no-form/profile-based apply flow requires review of what will be transmitted and confirmation evidence, not invented DOM fields or fabricated fill counts. Site-wide access must not automatically enable filling on unrelated account/profile/contact pages.

Implement through existing ingestion ports, journey classification and capability-based execution. Add an isolated platform adapter only when a real reusable capability requires it, with fixtures and negative cases. Respect access controls, rate limits and platform terms; use permitted APIs or user-driven browsing where appropriate, and do not bypass anti-bot checks. Test one representative eligible journey per available target first, then expand to multiple employers and held-out variants. Blocked/login-only/unavailable sources remain explicitly unverified.

Discovery reference: [Cutshort's official job search](https://cutshort.io/search-jobs) and [profile-based application explanation](https://cutshort.io/collections/remote-jobs) demonstrate why a recruiting platform's discovery/profile flow must be distinguished from an employer ATS. This brief does not certify the other targets' current workflows.

Choose fresh active listings from the website's saved Jobs/dashboard backed by our database. Inspect detail/match, experience, skills, location and prior application state before applying. Latest documented inventory was99 stored jobs on Sep14, not a fresh count and not99 still-open forms. Count again and deduplicate by employer posting/application identity. Admin Job catalog helps inspect state. Do not invent SQL schemas or source URLs; use current repository services/contracts.

When the existing sample lacks coverage, inspect `scripts/sync-live-jobs.ts` and `npm run jobs:sync-live` parameters before fetching a bounded batch. Respect source limits and pagination; do not mistake expired pages for autofill defects. Job fetching is not application submission.

Start with a currently active Bosch/SmartRecruiters form to verify the known regressions; then use a fresh Lever/Meesho or Ashby/Plane role, then Greenhouse and Workday. The recorded Visa REF087773W journey stopped at employer authentication; do not claim later pages tested. A Meesho browser tab has shown “Application already received”; treat that as a duplicate warning, not proof that our learning persisted. Avoid re-submitting it. After initial breadth, sample randomly within untested ATS/control families and suitable roles; don't cherry-pick only easy forms.

## Required experiment loop

1. Establish a baseline before edits: build identity, job/ATS/step, detected logical questions, actual values/validation, expected answers from verified facts, and failure/request IDs.
2. Let the extension run without manually helping first. Separate ATS-autofilled, Copilot-filled and manually filled values. Pause before interventions and preserve user edits.
3. For each failure trace detection → scan/group/context → canonical → truth/source/scope → representation → graph/plan → widget execution → framework commitment → validation → progress/evidence → learning. Find the first incorrect boundary.
4. Manually test the legitimate expected answer/widget operation where appropriate: select a real city suggestion, blur, wait for validation, navigate next/back. A browser automation tool filling a field directly is diagnosis, not Copilot success.
5. Reproduce with sanitized realistic DOM/control fixtures, including framework rerender/delays/shadow boundaries. Add a failing regression, positive variants and negative/conflicting contexts.
6. Implement the smallest generic owner-level repair; run focused tests. Never weaken stale-plan, ownership, policy, grounding, privacy or verification guards to increase fill counts.
7. Rebuild/reload the relevant components, return to the actual site, and retest persistence, validation, navigation and manual-edit protection. Test another employer/variant to check generalization.
8. For a valid, suitable application with accurate reviewed answers, submit only within current user authorization and applicable tool rules. Ask for missing consequential facts, authentication, CAPTCHA or required agreement approval. Otherwise record the precise blocker and move on. Never submit invented qualifications or identifier experiments.
9. Verify employer confirmation AND the backend submission/checkpoint/learning receipt. Inspect exact learned fact, source, scope and version. In a second fresh application verify automatic reuse, different wording/units, corrections and non-leakage. Submission UI alone does not prove learning.
10. Save a concise resumable checkpoint after each meaningful batch: jobs attempted, stages reached, changes, regression commands/results, live before/after, remaining blockers and next applications. Work in broad coherent batches, not a long series of cosmetic microsteps.

## Known high-priority cases

- Bosch: confirmation email; personal City autocomplete; LinkedIn; hiring-team message; retained values after rerender; both résumé uploaders and parser completion; screening-step detection/identity; qualification/notice/experience/salary; repeatable history. Old fixes exist—trace the installed behavior instead of adding the same alias again.
- Confirm-email should reuse EMAIL with the actual form's confirmation semantics. It is not a new candidate fact.
- Personal City usually maps to verified CURRENT_LOCATION with context. Gurugram must commit the correct geographic suggestion, not merely leave text in a search input. Employment/school/preferred-job city are different facts.
- A hiring-team message needs grounded job-specific narrative support. Recognizing COVER_LETTER does not itself generate or approve a message. Do not invent skills, tenure, motivation facts or metrics. Correct false grounding rejections without removing factual checks.
- Salary14LPA means INR1,400,000/year. Use14 only when explicitly requesting lakhs/LPA; preserve salary currency and period. Never output bare14 as rupees. Expected CTC is not current CTC.
- Distinguish notice duration, offer-relative availability, committed joining date, earliest calculated date, preferred/predicted date and last working day. “45” without units is inadequate for a narrative availability answer. A date needs an established anchor; do not add notice days to today and silently assert a commitment.
- Experience duration must have units;44months is not44years. Skill-specific experience cannot be inferred from total experience. Avoid overlapping employment double-counting; verify ATS résumé dates against the actual document.
- Lever radio options must form one logical question with options, not multiple questions. Preserve the question's label, qualifiers and group binding.
- Malformed employer regexes must not crash verification. Native custom controls, asynchronous options, country-code phone inputs, open shadow DOM/frames, hidden/honeypot fields, conditional questions and multi-step SPA navigation need realistic coverage.
- Manual edits must not be cleared or overwritten by delayed parser output/retry. Keep field ownership and readback semantics; do not declare success on a transient value.

## What counts as a generic solution

Use structural/semantic contracts and capability-based adapters. No Bosch/Meesho IDs, hardcoded candidate answers, giant site-specific condition chains, arbitrary selectors copied from one page, or “ignore validation” patches. A genuinely ATS-specific widget adapter can be valid when isolated behind a reusable capability contract, documented and tested across multiple employers; do not pretend every ATS shares identical widgets.

AI is a bounded fallback for ambiguous intent, qualifying context or grounded generation—not a replacement for reliable email matching, arithmetic or widget commitment. Inspect actual rejection codes, task privacy permissions, provider schema/model compatibility, deadlines, quota and grounding. Do not assume configured keys prove all features healthy. Sep14 OpenAI synthetic extraction/tailoring passed; Gemini failed schema/503 checks. The Sep15 admin view showed many rejected calls; investigate their codes and sample size before calling AI broken or healthy. Reverify current models/settings without printing secrets.

For new questions, prefer an existing canonical + qualified alias when correct. A new canonical requires typed value semantics, policy/scope/freshness, normalization/representation, migration, positive and negative fixtures, and governed release. Candidate answers stay private; only sanitized structural strategies can generalize across users.

## Learning roadmap: smarter decisions without self-confirmation

Desired future: independent user-confirmed answers across applications support candidate-specific preferences and reviewable predictions on later forms. Separate FACT, DERIVED, LEARNED_PREFERENCE, PREDICTED and GENERATED with source versions, context, expiry and uncertainty. Prioritize complete question contracts, deterministic derivation, then separate hypotheses and chronological feedback, then scoped integration and gated rollout.

Example: verified30-day notice plus a valid start anchor gives a calculated date; rounding to the next month's first is only an evidenced preference/estimate. The user suggested this heuristic, not a universal rule. Repeated unchanged auto-generated answers must not bootstrap themselves into trusted facts. Corrections, contradictions, scope, recency and independence matter. Failed/abandoned/duplicate submissions cannot become confirmed learning; an explicit profile save is a separate user-authorized source.

The prior320-case coverage figures were design estimates, not executed live results. Build independently labelled holdouts and chronological1/3/5/10/20-application sequences. Start predictions in shadow/review mode. Do not claim this entire roadmap is shipped.

## Measurements and acceptance

For each logical question distinguish detection, semantic correctness, correct source/scope, representation, successful framework commitment, validation, manual correction, abstention, submission and persisted reuse. Report field precision (correct committed automatic answers / attempted automatic answers), autonomous coverage (correct automatic answers / eligible questions), required-field readiness, correction/overwrite rate, latency, AI calls/cost, and cross-application reuse correctness. Keep consent/unknown-sensitive exclusions visible rather than hiding them from totals. Break out ATS parser vs Copilot attribution and per-ATS/control-family results.

No universal superiority claim without comparable held-out evidence. Critical incorrect salary/date/eligibility answers and user-edit loss are worse than honest abstention. Test failures/outages, ambiguous labels, conflicting scopes, stale answers, partial resumes, optional blanks, expired jobs, auth/captcha, duplicate applications and delayed validation—not only happy paths.

Use `npm run check`, targeted owner tests and relevant scripts from package.json: `test:ats-surface:browser`, `test:autofill:browser`, `test:execution:browser`, `test:form-graph:browser`, `test:learning:browser`, `test:learning:journey`, `test:adaptive-autofill`, `test:workspace:browser`, and admin tests when changed. Verify script names/options before running. Isolated test extension outputs must not replace the installed development build. Keep provider-costly tests bounded.

## Candidate data and autonomy

On this Mac the separate ignored file `.local-data/handoffs/CANDIDATE_TESTING_CONTEXT.md` contains user-supplied facts, conflicts and sensitive-data cautions. Read it only when authorized for this candidate. The actual verified profile and résumé are authoritative; chat history is a source with dates/scope, not permission to overwrite newer values. Do not copy candidate values into shared fixtures or reports. Read credentials from local environment only when needed; never paste secrets into prompts.

I want few interruptions and broad progress. Make engineering/testing decisions autonomously inside this scope, but do not impersonate unknown factual answers. Invented values belong only in disposable synthetic fixtures, never real employer submissions or candidate truth. Keep me informed of concrete blockers rather than claiming unverified work complete.

Start by inspecting the current browser/build, saved profile, relevant failure evidence and newest checkpoint. State a short baseline and choose the first bounded batch. Then execute the diagnose → generic fix → regression → real-browser retest → cross-application reuse loop.
