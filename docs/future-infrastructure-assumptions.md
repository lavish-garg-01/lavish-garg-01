# Job Hunter AI — provisional infrastructure assumptions

Status: early planning assumptions saved on 2026-08-19. They are not an approved architecture, vendor commitment, security review, or current price sheet. Validate pricing, regional availability, quotas, terms, privacy posture, and production suitability at the point of adoption.

## Operating principle

Keep fixed infrastructure spend low while keeping browser execution on the candidate's own device:

`cloud decisioning, data, AI, orchestration → Chrome extension → candidate browser → job portal`

This avoids running a fleet of cloud browsers, proxies, browser sessions, and CAPTCHA infrastructure. It also remains subject to the product's review-only policy and platform rules: no CAPTCHA/OTP/security-control bypass and no autonomous application submission.

## Proposed early stack

- **Edge and web:** Cloudflare Registrar, DNS, CDN, Pages, Workers, Turnstile, Email Routing, and R2.
- **Application data and identity:** Supabase Postgres and Auth. Use it as the structured-data source of truth; move paid production to a backed-up production plan rather than relying on an inactive free project.
- **Files:** Cloudflare R2 for private resume PDFs and generated assets, with database records storing object keys. Use short-lived signed access and retention/deletion controls.
- **Compute:** Prefer Workers for short APIs. If Node compatibility or durable worker needs make this awkward, use a modest Node runtime such as Railway rather than distorting the architecture. Do not use free hobby hosting for production.
- **Async work:** Postgres-backed task table initially; use row locking for workers. Add QStash for scheduled/retry delivery if needed. Defer Redis/Upstash until a measured need for high-rate queues, locks, caching, or rate limits.
- **Email and payments:** Resend SMTP for transactional mail (including Supabase Auth production mail) and Razorpay for payments.
- **Delivery and secrets:** GitHub, Actions, Dependabot, isolated development/staging/production secrets. Introduce a secrets manager such as Doppler once automation/agents need narrowly scoped credentials.
- **AI:** OpenAI API is the principal variable technology cost. Prefer deterministic filters and lower-cost models for classification/ranking, use stronger models only for complex work, use Batch for eligible background work, and apply per-user/per-feature budgets.

## Operations split

- **PostHog:** product analytics, session replay only with sensitive areas masked, and normal rollout flags. It is never the system of record.
- **New Relic:** backend APM, logs, traces, and adapter telemetry.
- **Sentry:** web and extension exceptions/source maps, not duplicated backend logging.
- **UptimeRobot:** independent external availability monitoring.
- **Healthchecks.io:** scheduled-task completion monitoring.
- **PostHog flags are not emergency controls.** Keep independently controlled application, submission, and adapter kill switches in the application data/configuration layer.

## Privacy, diagnostics, and observability boundaries

- Never send resumes, salary, phone, email, application answers, portal credentials, cookies, tokens, OTPs, or full page dumps to analytics/logging systems by default.
- Log behavioral metadata such as application ID, field type, answer source, adapter/version, and failure class instead of raw user content.
- Mask input, password, resume, and salary areas in replay; disable replay within job-portal/extension execution contexts.
- Sanitize diagnostics before issue creation or AI-assisted repair. Group failures by adapter/version/step/error signature/DOM fingerprint before escalation; one grouped incident may justify one bounded repair job, rather than an AI call for each exception.
- Keep Codex/automation credentials least-privilege and environment-specific; never provide a blanket production environment file.

## Architecture and cost heuristics

- Early beta should be able to run on mostly free tiers plus a domain and variable AI spend; the pasted planning model estimated about INR 100–600/month fixed cost before paid production requirements.
- Once users pay, prioritize reliable compute and database backups before discretionary tools; the pasted model estimated about INR 3,000/month fixed infrastructure as an initial paid-production target, excluding AI and payment fees.
- AI usage and browser/adapter execution cost per application are the costs to watch continuously. Cloud browser execution changes the economics materially and should be avoided unless a later product decision justifies it.
- Avoid at MVP: Kubernetes, Kafka, Elasticsearch/OpenSearch, paid Redis, cloud-browser/proxy infrastructure, expensive observability suites, paid PDF APIs, and multiple overlapping auth/feature-flag/analytics products.

## Future administrative capability

After the core local MVP is safely hardened, consider an internal `cost_usage` and `system_health` module that combines AI usage and estimated cost, plan usage, storage, application counts, adapter health, error counts, and subscription revenue. Its purpose is to measure cost per user, cost per prepared application, and contribution margin from real data.

## Adoption checklist

Before adopting any named provider, record the current plan and price, data-processing terms, region/residency implications, deletion/export behavior, backup/restore plan, access controls, failure mode, vendor lock-in/exit path, and an alertable usage budget. Treat the source document's numerical quotas and INR conversions as historical estimates, not implementation facts.
