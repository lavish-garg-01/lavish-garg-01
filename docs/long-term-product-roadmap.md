# Job Hunter AI — living long-term product roadmap

Status: current strategic action plan as of 2026-08-19. It is deliberately changeable; amend this document when product, legal, technical, or user-safety decisions change.

## Product north star

Build a production SaaS for Indian job seekers that improves job quality and interview outcomes—not raw application volume.

Primary funnel:

`qualified applications → verified submissions → recruiter responses → interviews → offers`

North-star metric:

`interviews generated / qualified applications`

## Decision hierarchy

1. Candidate safety, privacy, truthfulness, and platform compliance override growth or automation goals.
2. The current build policy is **review-only**: the system may discover, score, tailor, prepare, and fill verified form fields, but the candidate submits employer applications manually.
3. COPILOT is the default future production mode. ASSISTED and AUTOPILOT are future concepts only; they require a separate product decision, explicit candidate consent, legal/platform review, feature flags, operational health controls, and proven verification before any implementation or rollout.
4. Never bypass CAPTCHA, OTP, login, platform security controls, or access restrictions. Never store portal passwords, OTPs, session cookies, or permanent browser tokens.

## Target architecture

Separate these independent layers:

`Career Intelligence → Application Engine → Browser/Extension Adapters → Operations & Monitoring`

The system must also keep Job Discovery, Job Matching, Resume Generation, Billing, Analytics, and Monitoring independently deployable and testable. Browser portals will change; adapter breakage is expected operational work, not an exceptional condition.

Target production stack:

- Next.js + TypeScript web application; Node.js + TypeScript API/workers.
- Supabase Postgres, Auth, and private Storage.
- OpenAI API with privacy-gated model routing.
- Chrome extension for portal interaction; Playwright for local/synthetic adapter tests.
- Razorpay, Resend/SES, PostHog-equivalent analytics, Sentry-equivalent monitoring, Cloudflare, Vercel, and GitHub.
- Local, staging, and production environments with isolated credentials, storage, databases, analytics, and flags.

Do not use short-lived edge functions for long-running browser/worker tasks.

## Product experience

Public product: marketing, pricing, workflow, security, extension, help, legal, and contact pages. Position around “Find better jobs. Apply intelligently. Get more interviews.”

Authenticated product areas: dashboard, jobs, applications, resumes, answers, preferences, activity, insights, billing, settings, and help.

Onboarding sequence:

1. Account and verification.
2. Resume upload and structured extraction.
3. Candidate review/confirmation of extracted profile data.
4. Job preferences and exclusions.
5. Common application answers.
6. COPILOT mode selection.
7. Extension installation and portal-permission explanation.
8. Candidate logs into supported portals in their own browser.
9. A prepare-only test application.
10. Dashboard hand-off.

## Data, privacy, and security goals

- Use repository interfaces so SQLite can remain a local implementation while Supabase/Postgres becomes the production implementation.
- Use Supabase Auth and Row Level Security for every user-specific table; backend service-role access stays server-side.
- Store resumes and diagnostics privately with signed, short-lived URLs and explicit retention/deletion controls.
- Maintain consent events, audit logs, account deletion, export/deletion workflows, and redacted diagnostics.
- Store only necessary diagnostic data; never default to complete page dumps. Redact credentials, tokens, cookies, OTPs, unneeded phone/salary values, and resume content.
- Keep extension access tokens short-lived and never ship permanent API secrets in the extension.

Target production entities include user/candidate profiles, preferences, answers, global jobs and analyses, matches, resume versions, applications/events/questions, subscriptions, usage, AI usage, activity, consent, connected portals, adapter versions/health/incidents, flags, notifications, and audits.

## Application and question engine

Persist the application state machine. Required states include queued/opening/form-detected/fields-analyzed/filling/ready-for-review plus waiting-for-user, CAPTCHA/OTP/login required, unknown-field, portal-changed, blocked, failed, and cancelled.

Question resolution order:

`candidate profile → approved answer library → verified resume facts → privacy-gated safe AI interpretation → candidate`

Every answer records value, confidence, source, and evidence. AI never invents factual candidate information. Low confidence pauses for the candidate. Reusable memory must be typed, scoped, candidate-approved, deduplicated, and deletable.

Resume strategy: maintain approved, editable role clusters (for example Backend, Node.js, Platform, Fintech, Startup) and reuse them when similarity is sufficient. Generate a new variant only for poor fit, high-value roles, or an explicit candidate request.

## Entitlements, billing, and cost controls

Centralize every plan and feature decision in backend-enforced entitlement and usage services—never frontend checks. Track subscriptions, billing events, usage counters, and verified Razorpay webhooks.

Meter every AI request by user, feature, model, input/output/cached tokens, job/application association, and estimated USD/INR cost. Use deterministic filters before lower-cost models; see [AI economics roadmap](future-actions-ai-economics.md).

Current direction: Free/Plus/Pro with resume-variant reuse and capped new generations. Do not market review-only preparation as auto-apply.

The early vendor/cost assumptions and the non-negotiable observability boundaries are recorded in [provisional infrastructure assumptions](future-infrastructure-assumptions.md); validate each assumption before adoption.

## Adapter reliability and operations

Build per-portal adapters (Greenhouse, Lever, Ashby, and others) behind an application engine. Adapters contain portal mechanics, not core business policy.

Standing engineering rule: every reproduced defect—especially a real portal, redirect, field-detection, privacy, or scoring failure—must receive a focused regression test before its fix is considered complete. Keep the test corpus as living institutional memory: add a minimal fixture or deterministic contract test for each newly discovered issue, then run the full suite before handoff.

Required operational capabilities:

- Semantic selectors first: accessible role, label, name, aria/data attributes, nearby text; brittle CSS/XPath last.
- Sanitized adapter fixtures, synthetic prepare-only tests, fingerprints, versioning, canaries, temporary expiring selector overrides, and rollback.
- Health rates for opening, form/field detection, resume upload, filling, verification, unknown fields, and failures.
- Failure classes such as selector missing, layout changed, unknown field, upload failure, navigation timeout, login/CAPTCHA, rate limit, and portal blocked.
- Feature flags and kill switches by environment, user, plan, adapter, or rollout percentage.
- Admin views for users, applications, adapters, incidents, costs, tasks, flags, and audits; user-facing errors remain plain-language and actionable.

## Analytics and outcomes

Track useful onboarding, application, billing, and outcome events. Monitor the funnel from visitor/signup through profile, extension, first match, prepared application, manual submission, and payment. Track recruiter responses, interviews, rejections, and offers once users provide them.

Operational metrics: prepared/submitted/verified application rates, duplicate rate, unknown-question rate, user-intervention rate, login/CAPTCHA/portal-change rates, duration, adapter health, and AI cost per meaningful outcome.

## Delivery phases

1. Harden the existing local MVP: review-only safety, candidate profile, resume parsing/generation, matching, question resolution, persisted state/events, test adapter, supported real ATS preparation, and verification recording.
2. Clean repository boundaries only where they unlock testability or the SQLite-to-Supabase repository migration.
3. Build staging Supabase schema, RLS, Auth, private storage, consent/audit data, and production extension authentication.
4. Add entitlements, metering, billing, privacy controls, analytics, monitoring, flags, adapter fixtures, and operations dashboards.
5. Run a closed COPILOT beta; use real adapter failures and outcome data to improve reliability.
6. Launch Free/Plus only when adapter prepare success, duplicate prevention, privacy, deletion, webhook, and kill-switch acceptance criteria are met.
7. Build Career Intelligence after enough outcome data exists; referral/outreach capabilities remain later features.
8. Reconsider ASSISTED/AUTOPILOT only as a future product governance decision, not an automatic roadmap step.

## Launch gates

Before broad launch: supported adapter prepare-success at least 90%, duplicate application rate zero, sensitive/unknown questions correctly pause, no fabricated candidate facts in QA, RLS and account deletion tested, billing webhooks verified, diagnostics redacted, and application/adapter kill switches proven.

### Extension installation and website handshake

Before public testing, the website must distinguish `CONNECTED`, `NOT_INSTALLED`, `STALE_OR_DISCONNECTED`, and `UNSUPPORTED_BROWSER` instead of letting **Apply with Copilot** fail silently. Add a bounded website-to-extension ping/ready handshake, an installation modal with truthful capability and review-only copy, a Chrome Web Store destination only after a real listing exists, unpacked-extension guidance for local development, automatic reconnection detection after installation/reload, and a retry action that resumes the same prepared job without creating a duplicate application.
