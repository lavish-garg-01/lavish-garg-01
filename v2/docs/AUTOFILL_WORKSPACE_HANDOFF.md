# Autofill and V1-style workspace handoff

Updated 2026-09-12. Active code is V2; the parent V1 website remains a read-only design reference.

## Latest: application journeys (extension 2.0.4)

Document generation follow-up: the grounding validator previously discarded tokens shorter than four characters, so the deterministic safe fallback rejected exact verified claims such as `Yes`, `AWS` and `C++`. Exact normalized text from a cited claim is now accepted while paraphrases still require factual word overlap; invented skills and numbers remain blocked. Targeted AI-fallback/generation tests and the full **361-test** gate passed, followed by web and extension builds. Restart the API before retrying Tailor résumé or Create cover letter.

Implemented the application-journey direction from the referenced “Explain Bosch Fix” conversation. This is a conservative local classifier, not an AI universal-page interpreter or a calibrated accuracy score.

- Distinguishes unrelated, job list, job detail, uncertain, application entry, authentication, form, review and success-marker surfaces. Detects visible actions and employment context without reading input values. Normal job lists stay quiet; job details and entry/review screens receive compact guidance, not automatic employer clicks.
- Unknown career forms offer **Use Copilot on this page**. A real click re-inspects the current page and enables existing safe filling only when form evidence supports it. Login, payment/contact exclusions, declarations, ownership and execution guards remain in force. This click is a per-tab/per-path hint, not a learned global site allowlist or new canonical answer.
- Retains value-free, expiring journey hints in extension session storage. A clicked link's exact destination origin can retain the journey ID through navigation; it does not transfer application/run authority, automatically grant site access, or persist full URLs/job text/candidate values. Existing same-application step continuity and verified submission learning remain separate.
- Existing résumé-first execution remains, with additional employer “autocomplete your application” recognition. Social-profile sharing is never clicked automatically. LinkedIn/native entry is detected and guided, **not automatically filled or submitted**. Platforms with hidden/closed controls, arbitrary redirect chains, popups/new tabs, or ungranted origins still require platform-specific validation or user help. There is no claim of profile/résumé readiness on a one-click page without evidence.
- Browser regression: real extension manual-fallback click → safe email fill; zero-click/dynamic autofill and exclusions; 47 execution plans including multistep continuity; verified submission/reuse/corrections/Undo; 11 journey DOM cases including shadow controls and native-modal no-write. Full gate: **360 tests passed**, architecture/lint/typecheck and builds passed. Fictional fixtures only; no real submissions.

Reload **2.0.4** from `apps/extension/dist`, refresh employer tabs, and grant individual site access when needed. Sites without access cannot display the fallback. A confirmation message is not proof that learning saved answers; the existing verified-learning receipt remains authoritative.

## Previous remediation: large forms, discovery, browsing and learning (extension 2.0.3)

- Meesho's timeout exposed sequential AI enrichment behind an eight-second client deadline. Field Intelligence now resolves deterministic/cached fields first, bounds concurrent enrichment and its waiting budget, shares in-flight requests, and reuses completed enrichment on bounded automatic rescans. Resolve/plan have separate larger transport deadlines. Missing or ambiguous answers still require attention; longer forms no longer have to wait for every AI response before receiving known answers.
- Application detection recognizes SmartRecruiters' company-independent `oneclick-ui/company/.../publication/...` route and known ATS application surfaces without a native form. Open-shadow controls, late shadow-root creation, shadow-local labels, `aria-labelledby`, and shared question labels/radio options are covered. No Bosch/Meesho-specific answer selectors were introduced.
- Jobs select the first available result, retain a valid selection during refresh, and support whole-card clicks. Search/filter controls collapse behind a toggle, leaving more room for the list/detail workspace. The mini Copilot includes an accessible side-panel icon; its message opens the sender's panel directly within the click gesture.
- Learning retains manually opened application identity through confirmation, recognizes custom submission controls and same-page confirmation after form exit, and clears prior submission state for a different application. Clicking Submit alone is not learning authorization. Confirmed reusable answers enter the existing scoped, verified-learning pipeline; acknowledgements and protected answers remain excluded. This is answer reuse, not model retraining.

Browser verification refreshed: automatic safe-fill suite; all 47 K/N/R execution plans; ATS surface/shadow/radio and mini-icon click tests; desktop/mobile job workspace; verified submission → reuse on differently worded form → correction → same-page confirmation, abandoned/failed submission exclusions, repeatable identity and Undo. Tests use fictional local fixtures. Live Meesho and Bosch were inspected to diagnose the issues; **post-fix live-employer completion and native side-panel opening in the user's Chrome profile remain unverified**. No real applications were submitted.

Final gate: **357 tests passed, zero failures/skips** with architecture/lint/typecheck and web/extension builds. The final overflow-rescan refinement additionally passed all 54 Field Intelligence corpus/regression tests. The first sandboxed gate had one localhost-listener permission failure; the authorized rerun passed. The packaged manifest is 2.0.3, development channel, API 3100 and website 3000.

Activation: restart the API, reload Job Hunter Copilot **2.0.3** from `apps/extension/dist` in Chrome's extensions page, then refresh existing application tabs. Test builds use separate folders and ports. Your running project was not stopped or restarted by these tests.

## Previous: automatic application workspace (extension 2.0.2)

- On a recognized, permitted, foreground application, Copilot starts safe filling without a Fill button once authenticated. An initial pre-login scan resumes after connection. Directly opened employer forms now acquire a durable application/run before resolving answers. Dynamic fields receive bounded continuation, with a 12-iteration execution limit and a 50-fingerprint automatic-attempt limit per page.
- The on-page, closed-shadow-root progress card appears without needing Chrome's side-panel gesture permission. The native panel offers Autofill / Profile / Documents, counts, per-field status, explicit reasons, clickable focus, and pause/resume. Focusing a field yields ownership to the candidate. Pause stops at operation boundaries and cancels execution of a still-pending plan; an already dispatched interaction may finish. Reload resets pause.
- Recognizable ATS résumé-first behavior remains in use; parser-populated fields are tagged ATS_AUTOFILLED. Unknown questions stay numbered and clickable rather than copying potentially private labels into persisted progress. Acknowledgements are excluded from automatic operations even if a policy plan prepares them. Submission remains manual.
- Global side-panel enablement was removed. Dashboard and unrelated/contact pages show no automatic UI or filling. Known employer routes enable the panel per tab; confirmed application iframe evidence can also enable it. New launches join “Job Hunter · Applying” in their window without absorbing unrelated user groups. Group creation is serialized. Chrome still requires a gesture to open its native panel; the on-page card does not depend on that.
- Resolve failures are now durable and actionable instead of silently appearing “ready.” Failed-state retries recover correctly. Stale page progress and intelligence are rejected. Execution-evidence failures are surfaced instead of claiming the learning service recorded a successful batch.
- Job browsing uses a stable list/detail split instead of the large overlay drawer. About, Match and Documents have separate sections; employer paragraphs/lists are rendered as safe text, with restrained type and readable line length. Document controls now fit narrow panes and mobile screens. Existing tailoring, edit/exit, approval and template behavior remains intact.

Verification: **354 unit/integration tests passed, zero failures/skips**, architecture/lint/typecheck and web/development-extension builds passed. `npm run test:autofill:browser` passed (zero-click, dynamic fields, durable run, progress/focus, manual edit preservation, pause during planning, resume, simulated resolve failure/retry, unchecked privacy, no submission, dashboard/contact exclusion); `npm run test:execution:browser` passed (47 K/N/R plans); `npm run test:workspace:browser` passed (About/Match/Documents, desktop/mobile no-overflow, existing navigation). Tests use fictional accounts and local fixtures; these results are not a live-ATS accuracy benchmark. Screenshots are in `.local-data/qa`.

Reload **Job Hunter Copilot 2.0.2** in `chrome://extensions`, accept the tab-group permission if Chrome requests it, and refresh existing employer tabs. The rebuilt development extension belongs in `apps/extension/dist` with API port 3100 and website port 3000. Isolated test output remains separate. No employer submissions or real profile changes were made for these tests.

Design evidence: [Simplify's documented application flow](https://help.simplify.jobs/articles/2415391-using-copilot-to-autofill-applications) informed field/status organization, not a claim of superior coverage; [Chrome side-panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) informed tab-specific visibility and the on-page fallback; [GOV.UK task lists](https://design-system.service.gov.uk/components/task-list/) and [readable layouts](https://design-system.service.gov.uk/styles/layout/) informed action-oriented status and description width. The Sites skill kept this an in-place, responsive local implementation without deployment.

The sections below record the preceding implementation and its historical verification.

## Product decisions

- Prefer V1's sidebar, compact job listing, attention-first workflow, document library and progressive onboarding. Keep V2's verified facts, scoped answers, explicit consent and immutable document versions. Do not restore V1's backend or shared answer memory.
- Ordinary reusable answers resolve from application → job → company → search → global. Missing narrower answers fall back globally. A stale/conflicting narrower answer still requires review rather than silently contradicting it. Consent, declarations and country-specific legal eligibility retain their safety restrictions.
- Profile saves and reviewed résumé facts are global by default. First verified learned ordinary answers use global scope; a correction to an existing scoped answer preserves that scope. Unverified ATS output does not become trusted truth.

## Shipped in this change

- Policy version 3 and migration 0022 enable ordinary global fallback and contextual overrides. Existing candidate values are not rewritten.
- Added LAST_WORKING_DAY and AI_CODING_EXPERIENCE and aliases for joining availability, notice period, source/referral and native résumé parsing.
- Positive verified notice days make an explicitly immediate-joining-only last-working-day question NOT_APPLICABLE. A universally required last-working-day field is not falsely completed or assigned a fabricated date.
- Safe execution prefers an authorized native employer résumé-autofill input, waits for parsing, labels newly populated fields ATS_AUTOFILLED, preserves user edits, then rescans remaining fields.
- Plans distinguish ALREADY_COMPLETED, DEPENDENCY_BLOCKED, USER_OWNED, HIDDEN_OR_DISABLED, NOT_APPLICABLE and missing/uncertain answers.
- Gemini/OpenAI receive provider-compatible structured-output schemas; original local validation remains strict. Model retirement, schema rejection, truncation, rate limiting and other AI failures retain their specific reason codes.
- Neutral résumé headings no longer produce false source-grounding failures. Unsupported skills, employers, titles and numbers remain rejected.
- Three-step India-focused profile setup covers notice days, current/expected INR LPA, work mode, relocation, links, AI coding experience and referral source. Unknown booleans remain unanswered. Exact LPA arithmetic avoids floating-point money errors. Save globally or for a specific job; existing scoped overrides remain editable.
- V1-style responsive navigation exposes Jobs, Documents, Attention and Profile. Attention shows actual profile gaps, stale answers and draft counts; it explicitly does not claim to be a consolidated live-application blocker queue.
- Job documents support light/focused tailoring, classic/compact PDF layouts, multi-page output, preview, edit, exit and explicit approval. Editing creates another immutable, source-validated, unapproved version. Existing application pins do not change. Older generated documents without an editable sidecar need regeneration before editing.
- Extension tabs expose Autofill, Profile and Documents. Candidate values are fetched only for the authenticated side panel, are not persisted into runtime/telemetry, and are cleared from the panel on disconnection.

## Canonical-field lifecycle

1. An unresolved, ambiguous or medium-confidence non-declaration field creates a value-free proposal during the resolve request. The queue stores a descriptor fingerprint, known candidate keys, reason and status—not raw labels, HTML or answers.
2. Migration 0023 supplies a tenant-isolated, bounded, deduplicated queue. Authenticated `GET /v1/field-intelligence/proposals` lists the candidate's proposals. Frequent observations do not activate a definition.
3. A maintainer obtains an explicitly sanitized question fixture and decides whether an existing canonical merely needs an alias. Never copy candidate answers into the shared ontology.
4. A genuinely new canonical needs a typed definition, scope/freshness/safety policy, database migration, normalization and representation support, and at least two positive and two negative passing fixtures. `canonicalPromotionChecks` defines these review gates. Sensitive or consent-like fields require explicit policy review.
5. Add reviewed definitions in a code release; migrate, test and rebuild the API/extension. This is a reviewed release workflow, not an autonomous schema-writing model or an operator auto-promotion endpoint. The two new definitions above demonstrate this path.

## Verification

- Full regression suite: 351 passed, zero failures or skips. Architecture check, lint, typecheck and web/development-extension builds passed.
- Extension K/N/R browser suite passed with 47 transient plans: ordinary fields, exact/hidden/rejected uploads, conditional/nested/options-dependent fields, repeatable groups, requiredness, validation, multi-step transitions, manual ownership, re-rendering, recovery and cycles.
- `scripts/passport-browser-smoke.ts` passed: desktop/mobile setup, exact LPA, blank boolean preservation, global saves, native parser detection, delayed parser changes, user ownership and existing-value preservation.
- `scripts/workspace-browser-smoke.ts` passed: V1-style job rows, detail drawer, document library, attention, profile, hash navigation, mobile width and no browser errors. These use fictional accounts, not real profile writes.
- Document tests cover authenticated draft access, invalid IDs, tenant spoofing, immutable/idempotent revisions, cross-account rejection and invented metrics. Proposal queue tests cover deduplication and tenant isolation.

## Live AI check and remaining limits

The authorized local Gemini configuration is now `gemini-3.6-flash`, with input/output guards 0.75/3.75 micro-USD per token. Synthetic extraction passed after one invalid-output attempt; Gemini tailoring returned HTTP 503 high demand and is not certified as passing. Independent OpenAI extraction and tailoring passed. Provider fallback and deterministic grounded-document fallback remain available where configured. No live key or real résumé text is included in test fixtures.

The configured Gemini rates were verified against Google's published pricing; recheck the guard before the advertised January 2027 price change. Model availability and quota are account-dependent.

This is not evidence of universally excellent extraction or superiority to Simplify. OCR/scanned PDFs, arbitrary custom upload widgets, long-running/re-rendered ATS parsers, cross-origin frames without permission, employer-specific questions and comprehensive live-ATS coverage still need benchmarks. The résumé-first detector currently requires a recognizable native file input; its bounded parser wait is eight seconds. A general job-specific willingness default does not prove consent to every constraint hidden in a long question: the candidate still reviews.

No real employer application was submitted during this implementation. The website Attention page does not yet aggregate every extension application blocker or V1's cross-job schema predictions. V1's billing promotions and application tracker were not copied as nonfunctional placeholders.

## Handoff

Migrations 0022/0023 were applied to the local development database. Restart your API to load the changed environment and compiled packages. The website at port 3000 was reachable and reused; no second server was left running. Reload Job Hunter in Chrome's extensions page, then refresh employer tabs before testing. The production development extension remains in `apps/extension/dist`; isolated browser builds use `.local-data/extension-test` and do not overwrite its port configuration.

Design references: V1 `web/app/components/app-shell.tsx`, jobs/attention/documents/onboarding pages. The Sites skill guided local-only, responsive verification without changing frameworks or deploying. The OpenAI Docs skill guided provider wire-schema compatibility while preserving strict local validation.

Provider references: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
