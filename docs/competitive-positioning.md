# Competitive positioning and product decision record

Status: active strategy reference as of 2026-08-20. Revisit when competitor capabilities, compliance constraints, or candidate evidence changes.

## Positioning

Job Hunter should not compete on the generic promise of “AI autofill.” Simplify, myjobb, Jobright, Huntr, and similar products already cover parts of discovery, profile filling, tailored documents, question drafting, tracking, and automated application workflows.

The product promise to build toward is:

> Job Hunter learns how a candidate completes applications, handles verified work safely, explains every decision, and surfaces only the decisions that genuinely need the candidate.

This is a quality-and-trust product, not a raw-application-volume product. The current submission policy remains **review-only**.

## Competitive implications

- **Simplify-style baseline:** reliable common-field fill, document selection/upload, profile quick-copy on unsupported pages, granular field controls, and a clear review-before-submit flow are table stakes.
- **myjobb-style baseline:** Indian-market preferences (location, CTC, notice period), pause-on-uncertainty, job freshness, daily caps, and a per-application timeline are required context. Server-side session capture and auto-submit are explicitly out of scope for the current review-only build.
- **Job Hunter differentiation:** semantic—not exact-question—memory; typed answer scope and freshness; provenance; correction learning with approval; a cross-application Attention Center; and reliability evidence by adapter and field category.

## Product invariants

1. No fabricated candidate facts, silent overwrite, legal acceptance, CAPTCHA/OTP handling, or employer-form submission.
2. Every filled or proposed answer must expose a human-readable source: profile, verified resume, approved memory, calculation, AI draft, or manual step.
3. Candidate-approved reusable memory is typed, scoped, deduplicated, reviewable, and deletable.
4. A failure becomes actionable work (attention item, retry guidance, or quick-copy fallback), never a dead end.
5. Portal mechanics are adapters; core candidate policy and answer resolution must remain independent of a site selector.

## Current product foundation

Already present locally: review-only extension sidecar, structured profile and resume data, semantic field ontology, privacy-gated AI, scoped candidate facts and answers, structural portal pattern learning, provenance-aware plans, resume/cover-letter preparation, quick-copy profile view, session retention, Attention Center, job scoring, India-specific CTC and notice concepts, and reliability metrics.

## Highest-priority missing capabilities

### P0 — Earn trust on real forms

1. **Adapter support matrix and portal contracts.** Publish Autofill / Partial / Assist status by ATS on job cards and in COPILOT. Maintain sanitized fixtures, versioned fingerprints, canaries, selector overrides, and per-adapter health/error budgets.
2. **Complete provenance UI.** Show a compact source chip plus “why?” explanation on every completed, proposed, and skipped field; link it to editable source data without exposing protected values.
3. **True manual-assist fallback.** Unsupported/failed pages are a first-class Assist mode with labelled quick-copy blocks (current question plus profile facts). Remaining: document handoff from Assist, “focus this field” on chat UIs, and a one-click anonymized support report.
4. **Attention Center as a task inbox.** Prioritize by number of blocked applications, show one answer’s blast radius, allow safe bulk resolution beyond conflicts, and provide a clear retry/resume path.
5. **Outcome instrumentation.** Record adapter/version, failure class, time-to-ready, fill verification, candidate edits, and session-resume events. The local reliability dashboard is the starting point, not the complete operations surface.

### P1 — Make semantic learning visibly better than exact reuse

6. **Field-policy UX.** Expose durable, understandable per-category controls (contact, links, education, employment, compensation, availability, authorization, demographic/legal) and separate “fill,” “ask,” and “never use AI.”
7. **Scoped memory management.** Let the candidate choose and later edit/delete: everywhere, role cluster, company, portal, or one application. Add expiry and review dates for volatile facts.
8. **Correction-learning loop.** Detect recurring candidate edits; propose an explicit update with scope and evidence rather than silently changing profile data or mappings.
9. **Resume variant library.** Build approved, editable role-cluster variants and select/preview the recommended resume and cover letter before attachment. Do not generate a new document for every job.
10. **Application timeline and recovery.** A candidate should see each page, fill attempt, upload outcome, manual action, and recovery state in one trustworthy timeline.

### P2 — Build the product around outcomes, not application count

11. **Application outcome tracker.** Add candidate-recorded recruiter response, rejection, interview, offer, source, and follow-up outcomes. The north-star metric is interviews per qualified application.
12. **Job-quality intelligence.** Extend India-specific scoring with verified salary/notice/role-level signals, duplicate employer handling, company evidence, and a transparent “why this is a match” explanation.
13. **Experiment and beta operations.** Feature flags, kill switches, redacted diagnostics, consent/audit events, feedback intake, and staged adapter rollouts are needed before a real multi-user beta.
14. **Account, storage, and migration boundary.** Build repository interfaces and migration tests before moving the local MVP to Supabase/Auth/private storage; do not mix this with browser reliability work.

## Sequencing decision

Build P0 fully before adding autonomous submission. The staged product direction is:

`review-only COPILOT → future ASSISTED concept → future AUTOPILOT concept`

ASSISTED/AUTOPILOT require a separate governance decision, platform/legal review, explicit consent, flags, hard operational reliability gates, and account/session security design. They are not an automatic next milestone.

## Verification sources

- Simplify says its Copilot supports common fields, resume/cover-letter handling, exact-question reuse, manual profile quick-copy on unsupported sites, and candidate submission: <https://help.simplify.jobs/articles/2415391-using-copilot-to-autofill-applications>.
- Simplify documents granular field settings and an optional continuous multi-page flow: <https://help.simplify.jobs/articles/8686025-manage-autofill-settings-in-the-simplify-extension>.
- myjobb publicly describes server-side submissions through Naukri, Foundit, Hirist, and Instahyre, with a pause for mandatory low-confidence questions: <https://myjobb.ai/features/auto-apply>.
