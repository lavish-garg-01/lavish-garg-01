# Job Hunter COPILOT — Canonical Project Context

V2 entry point: [current context index](../v2/docs/CONTEXT_INDEX.md) and [authoritative checkpoint](../v2/docs/IMPLEMENTATION_CHECKPOINT.md). This document preserves V1 product/history context; its “current” runtime and roadmap statements do not supersede V2.

**Status:** living handoff document.  
**Last consolidated:** 2026-08-31.  
**Current increment:** Phase 1 P0 acceptance is **implemented and regression-locked**. Version 1.15.8 starts build-scoped reliability baselines without deleting historical evidence, separates NOT_ATTEMPTED from FILL_FAILED, stamps document receipts with extension/adapter versions, and records confirmed resume/cover attachment evidence. It retains 1.15.7's two-phase combobox execution and the PhonePe Greenhouse Form A lock. Coverage is reported in explicit REGRESSION_LOCKED, DISCOVERY_ONLY, and GENERIC_FALLBACK tiers; a discovered engine is never advertised as supported until it has an adapter pack and Form A/B locks.  
**Connected Jobs delivery:** build-order points 1–6 are implemented locally. Runtime/policy, global job truth, CandidateSearchProfile, deterministic MatchingPolicy, the disposable feed/API, and version-aware saved/dismissed/repost behaviour are regression-locked. Operational Admin is next; Supabase remains after that.  
**Parts 1–3 foundation:** Phase 0A–0G, Part 1, Part 2A and the Part 2C capture/review slice are implemented and regression-locked as a local, single-candidate foundation. Phase 0G splits content state into scanner/ownership/executor/verifier/telemetry/orchestrator modules and background concerns into message/API/session/outbox modules; Form A/B remain certification fixtures, never runtime branches. Part 2B includes the frozen page-sized `FieldAnswerContract`, policy-safe legacy migration, value-redacted staged resolver parity, immutable application learning change sets, exact-scope contextual `REVIEW → TRUSTED` reuse and append-only conflict-safe Undo/Restore. The legacy resolver remains the default production read authority. Change sets require verified final evidence, exact semantic/scope/final-value/version binding and one ACID commit across answer versions, dependency invalidations, immutable audit items, idempotency and outbox. Low-risk facts may commit directly; configured contextual preferences start in REVIEW and promote only after unchanged verified reuse. Undo restores only still-current items and never clobbers later answers. Part 2C stages raw normalized values only in the candidate-private backend store, never in the extension durable queue; verified submission or explicit Save is required to commit. The side panel shows a value-free completion summary with Undo and Profile groups consequential items for Save/Keep application-only review. Eventual primary cutover remains Part 2B. Value-free edit timelines, checkpoints, neutral attribution, single-use website/extension launch authorization, exact-origin run binding, incremental field deltas, offline delivery and layer-specific adaptive SHADOW evidence are active. Future Supabase files are deployment contracts only; live multi-user auth/RLS deployment still requires a Supabase project.  
**Audience:** the founder, Cursor/Codex agents, and future engineering collaborators.

The certification campaign is persisted in `career_test_targets` and `career_test_runs`. Seed it with `npm run campaign:seed -- 5000`. It is deliberately fingerprint- and build-aware: a passing target is not rerun for the same extension version, adapter version, and page fingerprint. Batches rotate across portal kinds so high-volume boards cannot starve less common ATS engines. Real employer pages use only verified candidate facts; synthetic/random values, security challenges, government IDs, and legal attestations remain fixture-only or candidate actions.

This is the primary working context for this repository. It consolidates the product decisions, technical direction, safeguards, roadmap, and current implementation status. When a decision changes, update this file and link the detailed decision record rather than relying on chat history.

## 1. Product mission

Job Hunter is an India-focused job-search and application-preparation product. It should help candidates find **better** jobs, prepare accurate applications, and achieve more interviews—not maximize raw application volume.

Primary funnel:

```text
qualified jobs → prepared applications → verified submissions → recruiter responses → interviews → offers
```

North-star metric:

```text
interviews generated / qualified applications
```

The current product is a **review-only COPILOT**. It can discover, score, tailor documents, navigate, detect forms, fill safe verified fields, attach documents, and explain what remains. The candidate always submits manually.

Future concepts, not current authorization:

```text
COPILOT (current) → ASSISTED (future) → AUTOPILOT (future governance decision)
```

ASSISTED/AUTOPILOT cannot be introduced merely because the extension becomes technically capable. They need explicit product approval, platform/legal review, consent, operational controls, and separate reliability gates.

## 2. Target user and positioning

The initial user is an Indian professional applying to software/product roles through job boards and employer ATS pages. The product must handle India-specific realities: CTC, notice period, work mode, preferred cities, relocation, and a fragmented mix of portals.

The differentiator is not generic “AI autofill.” Job Hunter should:

- learn safely how an individual candidate completes applications;
- distinguish stable facts, volatile facts, one-application answers, and writing preferences;
- show provenance for every proposed or filled value;
- fail safely and route unresolved work to the Attention Center;
- use semantic, scoped learning rather than exact-text copying;
- optimize for trusted, qualified applications and outcomes.

Simplify-like common-field fill, document handling, profile quick-copy, and review-before-submit are baseline expectations. The strategic details are in [competitive-positioning.md](competitive-positioning.md).

## 3. Non-negotiable policies

1. **Review-only submission.** Never click or simulate final employer-form submission.
2. **Truthfulness.** Never fabricate candidate facts, experience, salary, eligibility, or answers.
3. **No security-control bypass.** Never bypass CAPTCHA, OTP, login, cookies, portal access limits, or other security controls.
4. **No silent overwrite.** Existing employer-form values and profile conflicts require a clear candidate choice, except deterministic repair of values proven to have been inserted incorrectly by the current extension run.
5. **Sensitive and authorization separation.** Passwords, OTPs, CAPTCHA, government IDs, health/demographic information, authentication details, portal cookies, and credentials are never learned or filled. Employer declarations are never reusable candidate memory; the current build leaves them manual until revision-bound, itemized application authorization is implemented. High-impact authorizations remain direct/per-item.
6. **Privacy-gated AI.** AI is opt-in; only the minimum safe context is sent. Sensitive fields and raw protected values never go to AI, embeddings, analytics, or diagnostics.
7. **Checkpointed, reversible memory.** The global Profile preference enables quiet learning, and every application has a non-blocking **Do not learn from this application** control. Eligible low-risk facts wait for verified completion; consequential/scoped changes require review. A field edit alone is never memory approval.
8. **Every bug becomes a test.** Every reproduced portal/scoring/redirect/field/upload/learning defect requires a focused regression test before the fix is complete.

## 4. Current architecture

```text
Dashboard / Job Discovery / Career Intelligence
                    ↓
Application Engine (policy, planner, answer resolver, state)
                    ↓
Adapter registry (hostname → portal_kind) + mapping packs
                    ↓
Chrome MV3 Extension (grouped application tab + Side Panel + content script)
                    ↓
Employer ATS / job board / redirect chain
                    ↓
Append-only field timeline + Attention Center + adapter health
```

Hot path (browser, no LLM on identity/files): hostname → `portal_kind` → merged mapping pack (generic + portal + host + optional board slug) → fill name/email/resume. The extension **awaits a fresh pack** on `GET_HOT_PATH` / `GET_ADAPTER_RUNTIME`, so a pack promoted to CANARY is used on the **next** fill rather than a stale hostname cache of DEFAULT. Evidence appends asynchronously. Off path: cluster failures → scoped mapping proposal → LOCAL_DRAFT → SHADOW → CANARY → DEFAULT. Kill switch is portal-level. Learned patches never rewrite `content.js` live. SHADOW never overrides a seeded DEFAULT pack. CANARY is a **stage name**, not a traffic split: it is the first stage that can override DEFAULT.

Adapter layers in this repo:

1. **Universal controls** orchestrated from `extension/content.js`, with shared mechanics under `extension/adapters/common/` (`identity.js`, `dates.js`, `uploads.js`, `hops.js`). Wellfound dropzones and Naukri hidden-file skips live in the uploads module.
2. **ATS adapters** as hostname registry + JSON packs: Rippling, Greenhouse, Workday, Keka, Naukri, Instahyre, Wellfound, Lever, Ashby, LinkedIn, plus generic. No per-company JavaScript.
3. **Company skins** are hostname suffix matches only (for example `alaan.rippling.com` → Rippling).
4. **Tenant overlays** are data keyed by hostname or `hostname/board-slug`, merged on top of the portal pack at lookup. Form A/B are **owned certification fixtures** enforced for every seeded ATS file overlay; they prove, among other things, that resume and cover letter stay on distinct controls. They never select a separate runtime resolver/filler. CANARY is a stage name, not a live percentage: it is the first stage that can override DEFAULT. SHADOW never overrides a seeded DEFAULT pack.

Current foundation task: Phase 0G extension modularization is complete and behavior-locked. The next feature phase is Phase 2D representation resolution/learning; it must preserve the extracted scanner → ownership → executor → verifier → telemetry/orchestrator path. Legacy answer code remains an instrumented compatibility path until the verified browser-outcome gate and staged primary cutover pass; removal order is frozen in `docs/LEGACY_RETIREMENT_PLAN.md`. Still skipped as goals: 15-persona mock ATS lab, Indeed-as-ATS pack, and version bump for its own sake. The Form A/B promote gate remains a certification/contract lock only. Live-fill misses are locked in `test/fixtures/live-*.html` plus `test/liveFillLoop.test.js`.

### Local implementation stack

- Node.js + Express, EJS views.
- SQLite (`better-sqlite3`, WAL) for the local MVP.
- Chrome Manifest V3 extension.
- Native Chrome Side Panel as the main COPILOT UI.
- Content scripts for form detection, navigation assistance, fills, uploads, SPA mutation handling, and evidence capture.
- Playwright for document generation, PDF checks, browser fixtures, and synthetic adapter tests.
- OpenAI API only behind privacy/model-routing policy.
- Native Node test runner: `npm test`.

### Important repository locations

| Area | Primary files |
| --- | --- |
| API/server | `src/server.js`, `src/routes/` |
| Application policy/planning | `src/services/applicationAgent.js`, `applicationPlanner.js`, `questionResolver.js`, `fieldOntology.js` |
| Persistence | `src/repositories/`, `src/database/schema.sql`, `src/database/connection.js` |
| Dashboard/resumes | `src/routes/dashboard.js`, `src/services/resumeRenderer.js`, `pdfGenerator.js` |
| Adapter registry / packs | `src/adapters/`, `extension/adapters/` |
| Mapping packs / flags / meters | `src/repositories/mappingPackRepository.js`, `featureFlagRepository.js`, `usageMeterRepository.js` |
| Learn proposer / adapter health | `src/services/learnProposer.js`, `adapterHealth.js` |
| Ops dashboard | `/admin/adapters`, `src/views/adapters.ejs` |
| Form detection/fill/upload | bootstrap `extension/content.js`; extraction target `extension/runtime/{scanner,ownership,executor,verifier,telemetry,orchestrator}.js`; existing mechanics `extension/adapters/common/{identity,dates,uploads,hops}.js` |
| Side-panel UI | `extension/sidepanel.html`, `extension/sidepanel.js` |
| Regression corpus | `test/`, especially `test/fixtures/` |

## 5. Application lifecycle and browser UX

### Grouped application session

When the candidate opens a job from the dashboard:

1. Prepare/recover the application record.
2. Open the employer page in a Chrome tab group with the dashboard.
3. Reuse the same application tab through redirects and employer steps whenever possible.
4. Restrict COPILOT visibility to the active application tab.
5. If the candidate opens another application while one remains in progress, move the old session into Attention Center and switch cleanly to the new job.

The dashboard can show a small status strip when an application is active elsewhere. A closed or abandoned application remains recoverable as pending, with a candidate-facing “Mark submitted” action.

### Submission and recovery

- Employer confirmation page detected → mark success, return focus to dashboard, close/deactivate application tab appropriately.
- Candidate reports submission when detection failed → record as candidate-verified submission.
- Tab closes or user returns to dashboard without a confirmation → retain a pending Attention Center entry, gently ask whether it was submitted, never assume success.
- Sessions are retained/recovered for three days. Attention Center defaults to the last three days.
- Chrome restart: Chrome issues new tab IDs, so the stored session is rebound to the surviving application tab when that page is still open, and otherwise parked in Attention Center as “Continue this application after the browser restart?”. Either path records `SESSION_RECOVERED`; a submitted application is never reopened.

### Portal navigation

Support redirect chains such as job board → safety redirect → employer ATS → final application form. If a click/redirect cannot be followed safely, explain the exact employer action required and present **Process this form** after the candidate reaches it.

Apply-control selection on a listing page: ignore controls inside “similar / recommended jobs” rails, prefer the employer-site hop (“Apply on company website”) over an on-board apply, and never click a bare **Apply** on a board that submits the saved board profile instantly (currently Naukri and Instahyre). That click belongs to the candidate; the extension explains why and waits.

Every known board or ATS advertises a support mode before Apply: **Autofill** (employer ATS forms), **Partial** (listing hop, then fill), or **Assist** (copy answers; never pretend a chat or Easy Apply box was filled). Naukri chat apply and LinkedIn Easy Apply are Assist. Domain experience (“Backend Development”) copies **total** years; technology-specific years (Node.js, React, Kafka) stay unanswered. LinkedIn Easy Apply scrapes modal labels and legends. A Partial/Assist page always offers profile facts to copy (years of experience, CTC, notice, location) so the candidate is never left with an empty “user action required”.

Support full navigations, embedded forms, iframes, React/SPA route changes, DOM mutations, and Workday application routes. A page must not be treated as static after its first form scan.

Embedded ATS frames (Greenhouse `#grnhse_iframe`, Lever, Ashby): the **child frame** applies the mapping pack, silent frames are re-injected then probed, and side-panel attach/replace targets the selected application frame—not the top listing page. Workday file inputs are identified by `data-automation-id` and pack `fileFields.testIds` / `labelPatterns`, not `data-testid` alone.

## 6. Form semantics, filling, and learning

### Field identity rule

Do **not** use dynamic DOM IDs such as `field-12`, `input-12`, `select-12`, or React-generated numeric IDs as durable portal mappings.

Field semantic identity priority:

1. contextual accessible label / `aria-labelledby`;
2. `<label for>` and enclosing label;
3. stable `name`, `data-testid`, `data-qa`, `data-automation-id`, or `autocomplete` attributes;
4. nearby fieldset/legend/question/container label;
5. durable portal ID only when non-dynamic;
6. generic fallback only for display, never reusable learning (`skipLearning`; “Application field N” and Rippling `field-N` names never become mapping keys).

Generic labels such as `Select`, `Search`, `textbox`, `input`, `Application field N`, and `Drop or select (.pdf)` are not semantic identities. Failure clusters with those labels never become mapping proposals.

### Resolution order

```text
candidate profile
→ approved candidate-answer library
→ verified resume facts
→ typed/scope-filtered vector memory
→ privacy-gated grounded AI draft
→ candidate attention item
```

AI must not invent facts. It may only draft non-sensitive job-specific writing after verified sources and candidate memory fail.

### Planner and safe filling

- Fill verified, non-sensitive profile fields as soon as the form is safely available.
- Preserve active user edits and user-entered form values.
- Validate type/semantic fit before filling: email, phone, names, URL, select/radio options, etc.
- Never force an answer into a select/radio if it does not exactly match an option.
- Comboboxes only accept a value the widget selected. Retry with the full answer and then its leading segment ("Gurugram, Haryana, India" → "Gurugram"); match `[role=option]`, listbox items, `aria-activedescendant`, and ArrowDown+Enter when the widget highlights a suggestion. If nothing matches, restore the page value rather than leaving typed-but-unselected text.
- Dates follow the format the control declares (`MM/YYYY`, `dd/MM/yyyy`, native date/month), including portals that split one date into month/day/year sections. A non-date answer is never reshaped into a date.
- Document uploads are retried against a control that swaps or clears the file, and are confirmed from either the control or the visible receipt before being reported as attached.
- Protected fields remain manual. Declarations are application-specific authorization and stay manual in the current build until revision-bound grouped confirmation is implemented.
- Every fill records source/provenance: profile, resume, approved memory, AI draft, candidate input, or manual action.

### Typed learning boundaries

- Candidate learning: confirmed facts/preferences.
- Application learning: per-application answers, events, outcomes, corrections.
- Portal learning: structural mappings, selectors, sanitized pattern outcomes; never answer values.

The authoritative answer-learning and declaration policy is [ADR 0001](adr/0001-answer-learning-and-application-authorization.md). `USER_CORRECTED` is neutral; verified submission or an explicit save checkpoint is required before reusable memory can change. Final employer submission remains candidate-only.
- Learning hygiene gates: a portal pattern without a structural selector is never stored, `CUSTOM_FIELD` rows that keep failing are cleaned up, and failure clusters with no reusable semantic key or no real label never become mapping proposals. A proposal cannot be promoted without a structural selector, and a dismissed proposal stays dismissed. `/admin/adapters` shows these counts and the reason a proposal cannot be promoted.
- Reusable answer memory: requires candidate approval, semantic key, compatible field type, scope, non-sensitive classification, deduplication, and deletion capability.

### Required failure handling

If current page semantics conflict with a learned mapping or prior saved answer:

- reject/invalidate the stale mapping or answer;
- record `FIELD_MAPPING_REJECTED` or `STALE_APPLICATION_ANSWER_REJECTED`;
- increment safe portal-pattern failure evidence;
- never replay the value;
- place unresolved work in Attention Center.

Generic unresolved controls must become `UNKNOWN_MAPPING`; do not call AI or vector memory for them.

## 7. Fill-reliability increment — implemented (2026-08-23)

This increment closed the revised “do next” loop. Contracts are in code and `test/liveFillLoop.test.js` (`npm test`: 182 pass / 1 skip). Browser-level verification on a real portal is still required before telling a candidate a live ATS is fixed (policy §17.6).

### What shipped

1. **Live fill defects**
   - Iframes: child-frame mapping pack, re-inject silent frames, attach/replace into the selected application frame.
   - Combobox: `aria-activedescendant`, broader option selectors, keyboard confirm, longer suggestion debounce.
   - Uploads: Workday `data-automation-id` plus pack `testIds` / `labelPatterns`.
   - Mapping: ordinal `field-N` / “Application field N” is display-only (`skipLearning`); not learned.
2. **Learning loop:** after LOCAL_DRAFT → SHADOW → CANARY, the **next** fill uses the CANARY pack (fresh `GET_HOT_PATH`, not a stale DEFAULT cache).
3. **Assist quality:** Naukri chat “years in Backend Development” copies **total** experience; Node.js/React/Kafka stay unanswered. LinkedIn Easy Apply scrapes modal labels/legends (education, authorization, tech years) and stays Assist.
4. **Owned miss fixtures:** `test/fixtures/live-greenhouse-iframe-host.html` and `live-greenhouse-iframe-inner.html`, `live-combobox-activedescendant.html`, `live-rippling-ordinal.html`, `live-naukri-chat.html`, `live-linkedin-easy-apply.html`, plus existing Form A Workday `data-automation-id` uploads.

### Rippling identity incident (resolved in product policy)

The Alaan/Rippling application had replayed dynamic `field-N` identities across renders (name/email/phone swapped, generic widgets treated as questions, uploads missed). Durable identity now prefers contextual labels and stable attributes; numeric `field-N` IDs and “Application field N” labels never become reusable mappings. Regression: `test/ripplingResumeReliability.test.js` plus the ordinal live fixture.

**Still a human check, not a code task:** reload the unpacked extension, open one real Autofill ATS and one Assist surface (Naukri chat or LinkedIn Easy Apply), confirm fill/copy, then tick [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) §7–§8 and §10.

## 8. Documents and resume variants

### Product decision

Do not create or permanently keep a separate full PDF for every job application.

- The master resume remains the canonical stored document/structured source.
- Maintain approximately 5–8 active candidate-owned resume variants by role cluster.
- A variant stores compact tailoring deltas (`modifications_json`), metadata, source job, and usage history—not a duplicate master resume PDF.
- Render/cache the PDF only when a variant is selected for a job or attached to a form.
- Cover letters remain job-specific.

Suggested active clusters:

- Backend & APIs
- Full-stack
- Data & Platform
- Cloud & DevOps
- Engineering leadership
- Fintech backend
- Mobile
- General software engineering

Selection:

1. Deterministically categorize the job from title/description.
2. Reuse a suitable active variant.
3. Generate a fresh tailored variant only if none fits sufficiently, a role is unusually valuable, or the candidate explicitly requests it.
4. Candidate may preview, select, archive, or request a fresh version.

The side-panel Documents tab should show:

- an inline, fit-to-width PDF **Quick Look** preview (not overflowing raw resume HTML);
- an enlarged in-panel Quick Look modal;
- external Open action;
- tailored cover-letter preview;
- “Your active resumes (N)” with meaningful categories and selection;
- automatic replacement of the selected resume in the open employer form after selection.

Current new table/repository direction:

- `resume_variants` table;
- `src/repositories/resumeVariantRepository.js`;
- job `resume_variant_id` points to selected variant;
- template/layout is separate from variant content.

## 9. Attention Center

Attention Center is a primary selling feature and recovery inbox, not an error dump.

It needs to show one application/session entry with:

- pages seen and current status;
- blocked/unknown/invalid fields;
- conflicts and candidate decisions needed;
- upload failures;
- session recovery state;
- pending submission confirmation;
- current documents and resume choice;
- retry/focus/manual-assist actions;
- timeline of safe, value-free events.

It must prioritize the candidate’s next useful action and support safe batch actions only where scope/approval permits.

## 10. Onboarding

Recommended onboarding flow:

1. Account and verification.
2. Resume upload and structured extraction.
3. Candidate reviews/corrects profile facts.
4. Preferences, target roles, locations, exclusions, experience, CTC, notice period, and work mode.
5. Common application answers and policies.
6. Explain COPILOT review-only behavior and the AI answers toggle (leftover writing drafts; future paid entitlement).
7. Install extension and request broad optional job-site access once.
8. Candidate logs in to supported portals in their own browser.
9. Run a prepare-only test application.
10. Show dashboard, Attention Center, document variants, and recovery behavior.

## 11. Permissions and extension UX

The desired permission flow is one clear broad optional Chrome permission for `https://*/*` and `http://*/*`, requested when the candidate enables autofill. Do not repeatedly ask per employer site.

Explain honestly:

- Full access is required for detecting fields, attaching documents, and following employer redirects.
- COPILOT activates only in a Job Hunter-opened application tab.
- COPILOT never submits for the candidate.
- Access can be revoked in Chrome extension settings.

UI rule: Native Side Panel is the detailed interface. The floating robot is only a launcher/attention indicator and should not compete with the Side Panel. Keep only Autofill, Documents, Profile tabs plus settings icon. Use a small bottom **AI answers** toggle: when on, leftover writing may be drafted from the resume; when off, only verified local facts fill. Paid-only later. Dashboard surfaces opened from the panel reuse the grouped dashboard tab. Job cards show a major-platform tag (LinkedIn, Indeed, Naukri, Wellfound, Greenhouse, and other known boards).

Pre-ship checklist: [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).

## 12. Outcomes, analytics, and reliability

Candidate-recorded application outcomes required:

- recruiter response;
- screening call;
- interview stage(s);
- rejected;
- offer;
- withdrawn;
- follow-up sent;
- candidate-confirmed source.

The reliability/admin dashboard should show:

- autofill success rate;
- fields requiring review;
- upload failures;
- unknown mappings;
- session recovery rate;
- learned mapping success/failure rate;
- AI calls and estimated cost.

Use application attempts and field evidence, not raw answers, for metrics. Keep diagnostics redacted: no resume, contact data, salary, credentials, cookies, tokens, or full raw DOM/page dumps by default.

## 13. Evaluation and synthetic-user strategy

Before broad beta, build a Reliability Lab—not fake real applicants.

Allowed/desired:

- 100 synthetic candidate profiles with varied Indian names, address/phone formats, experience, career breaks, CTC, notice, documents, preferences, and editing behavior;
- thousands of sanitized/local form fixtures for ATS families and custom React pages;
- Playwright/extension harness that compares actual vs expected field-level outcomes;
- failures automatically clustered and turned into regression fixtures.

Do not create fake accounts, submit fake applications, or repeatedly automate production employer sites without explicit permission.

Measure separate gates rather than one vague “95%” number:

- identity/contact mapping accuracy ≥99%;
- wrong-field fills = 0%;
- sensitive/legal auto-fills = 0%;
- supported upload success ≥98%;
- semantic mapping accuracy ≥95% by supported portal family;
- unknown-field safe fallback = 100%;
- session recovery ≥98%;
- polluted reusable-memory promotion = 0%;
- automatic employer submissions = 0%.

Model-routing direction for this evaluation workload, subject to current pricing verification:

- high-volume fixture/persona generation: lower-cost model tier;
- routine simulation/routing: balanced tier;
- complex failure analysis and portal-adapter design: frontier reasoning tier.

Do not let an LLM directly decide that an event becomes reusable learning. Deterministic privacy/type/scope/validation gates make that decision.

## 14. AI economics and model direction

Use deterministic filters before model calls. AI remains variable spend and all calls are metered by user, feature, model, tokens, job/application, and estimated INR/USD cost.

Planned routing principle:

- extraction/resume tailoring: capable economical model;
- high-volume job scoring and routine drafts: lower-cost model;
- difficult diagnosis/complex reasoning: stronger model only when evaluation proves value;
- batch eligible background work where it lowers cost safely.

Do not hardcode model prices or model IDs as product truth; maintain a versioned cost catalog and re-check provider documentation before billing launch. See [future-actions-ai-economics.md](future-actions-ai-economics.md).

## 15. Production technology plan

### Local MVP now

- Express/Node/SQLite/EJS/Chrome extension/Playwright.

### Production target

- Next.js + TypeScript web app.
- Node.js + TypeScript API/workers for long-running work.
- Supabase Postgres, Auth, RLS, and private Storage.
- Chrome extension with short-lived user-bound access tokens.
- Cloudflare for DNS/CDN/edge/R2 where appropriate.
- Private object storage with signed URLs for resumes/assets.
- Razorpay payments, Resend/SES transactional email.
- GitHub Actions/Dependabot, isolated dev/staging/prod secrets.
- PostHog for product analytics with sensitive masking; Sentry for client/extension errors; New Relic or equivalent backend observability; independent uptime and scheduled-job monitoring.

Keep browser execution on the candidate’s device. Do not build a cloud-browser/proxy/CAPTCHA fleet for this product. Do not add Redis/Kafka/Kubernetes until measured scale requires them. Full provisional details: [future-infrastructure-assumptions.md](future-infrastructure-assumptions.md).

## 16. Roadmap and phases

### Phase 1 — local MVP reliability (current)

**This increment (fill reliability) is implemented:** iframe pack + attach, combobox keyboard/activedescendant, Workday automation-id uploads, ordinal `skipLearning`, fresh CANARY on next fill, Naukri/LinkedIn Assist scrape quality, owned live-miss fixtures. Rippling `field-N` replay is gated in product policy and tests.

**Still Phase 1 (not more architecture):** browser verification on real portals; Attention Center polish; remaining Workday/Keka/LinkedIn hop edge cases found in live use; onboarding completeness. Do not start Phase 2 until [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) is ticked for the build you ship.

Already in the local MVP (do not re-litigate):

- Review-only policy and privacy boundaries.
- Job scraping, normalization, hard experience eligibility, deterministic + AI scoring.
- Candidate profile/resume extraction and document generation.
- Chrome grouped application sessions, redirects, SPA/iframe detection.
- Safe field planner, provenance, typed memory, mapping learning, candidate approval.
- Supported ATS Form A/B packs, document attachment retry, Attention Center recovery.
- Autofill / Partial / Assist badges plus Assist copy cards.
- Reliability dashboard (`/admin/adapters`), regression fixture corpus.

Exit criteria:

- no automatic submit;
- correct sensitive/legal pause behavior;
- robust supported-form preparation and attachment evidence;
- zero known stale mapping replay defects;
- comprehensive regression suite and local start check;
- defined supported/partial/manual-assist portal matrix (Autofill / Partial / Assist badges plus Assist copy cards);
- CANARY pack used on the fill after promote; Assist surfaces never look empty.

### Phase 2 — production foundations and closed beta

- Repository migration boundary from SQLite to Supabase/Postgres.
- Auth, RLS, private storage, consent/audits, account export/deletion.
- Extension authentication, environment separation, feature flags, kill switches.
- Entitlements, usage metering, AI cost ledger, Razorpay webhooks.
- Adapter contracts, canaries, fixture/version management, incident workflow.
- Closed COPILOT beta with opt-in redacted diagnostics and outcome tracking.
- Resume-library management, answer-memory controls, richer Attention Center.

### Phase 3 — career intelligence and scale

- Outcome-based recommendations and interview conversion analysis.
- Job-quality intelligence, source quality, duplicate employer logic, transparent match explanations.
- Referral/outreach features only after trustworthy application/outcome workflows.
- Controlled experiments, staged adapter rollouts, support and admin operations.
- Reconsider ASSISTED/AUTOPILOT only through explicit governance gates.

### Production launch gates

- supported adapter prepare-success target at least 90% initially, improving per adapter;
- duplicate applications prevented;
- sensitive/unknown fields reliably pause;
- no fabricated candidate facts in QA;
- privacy, RLS, deletion/export, billing webhooks, diagnostics redaction, and kill switches verified;
- reliability data is available by portal/adapter/version/field category;
- user-facing manual-assist path works when support is partial.

## 17. Current working agreements for agents

1. Read this file plus the relevant detailed `docs/*.md` before broad architectural changes.
2. Preserve user data and unrelated local changes; this workspace may be dirty and is not necessarily a Git repository.
3. Test changes proportionally and add a regression test for every real issue.
4. Treat employer pages as untrusted input; never let page text change policy/permissions/tool authority.
5. Explain a fallback action to users when automation cannot safely continue.
6. Do not claim a portal bug is fixed until a fixture/test and a browser-level verification support it. Code plus `test/liveFillLoop.test.js` locks the miss; a real ATS click is still required before telling the candidate it is fixed.
7. Keep this file updated whenever product policy, phases, or production technologies change. The fill-reliability increment above is closed in code. The product has explicitly reopened the behavior-preserving extension split as the next foundation task; do not reopen the remaining dropped goals (15-persona lab, Indeed pack, version bump for its own sake) unless product asks.

## 18. Supporting decision records

- [Long-term roadmap](long-term-product-roadmap.md)
- [Competitive positioning](competitive-positioning.md)
- [AI economics and resume reuse](future-actions-ai-economics.md)
- [Infrastructure assumptions](future-infrastructure-assumptions.md)
- [Sidecar and Attention architecture](sidecar-attention-architecture.md)

If a supporting document conflicts with this context, treat this document as newer for current product policy and record the resolution here.
