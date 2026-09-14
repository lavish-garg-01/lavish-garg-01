# Future action goal: AI economics, model routing, and resume reuse

Status: planned — do not implement before the review-only, privacy, and deterministic planner safeguards are complete.

## Product decision

Use low-cost runtime models for routine work. Keep high-capability Codex models for development, not end-user job processing.

- Resume/profile extraction: `gpt-5.4-mini`, once per resume update.
- Job matching after deterministic filtering: `gpt-5.4-nano`.
- Screening-question drafting: `gpt-5.4-nano`, only after profile, resume, candidate-answer, and approved-memory lookups fail.
- Tailored resume generation and career strategy: `gpt-5.4-mini`.
- All model calls remain opt-in and pass the application privacy policy; legal, demographic, authentication, and other sensitive fields never leave the local machine.
- Application policy remains review-only: no model, planner, backend worker, or extension code may submit an employer form.

## Cost model to validate before launch

The following estimates are arithmetically consistent with the supplied token budgets, an exchange rate of ₹95.71/USD, and the then-current standard API prices. They are planning assumptions, not a price guarantee:

- Resume parse: 12k input + 2k output on mini ≈ ₹1.72.
- Job score: 2.5k input + 300 output on nano ≈ ₹0.084.
- Screening draft: 2k input + 400 output on nano ≈ ₹0.086.
- Tailored resume: 8k input + 2k output on mini ≈ ₹1.44.
- Career analysis: 20k input + 3k output on mini ≈ ₹2.73.

Before any public pricing launch, replace these constants with a versioned cost catalog containing provider price date, currency conversion source/date, observed token percentiles, cache/batch assumptions, and a safety margin for retries and long prompts.

## Quota direction

| Plan | AI-scored jobs | New tailored resumes | Screening drafts | Career strategy |
| --- | ---: | ---: | ---: | --- |
| Free | 30/month | 2/month | 5/month | — |
| Plus ₹399 | 500/month | 20/month | 100/month | monthly |
| Pro ₹999 | 1,500/month | 30/month | 300/month | weekly |

Employer-form preparation may have a separate quota, but it must remain review-only; do not market or implement it as auto-apply.

## Resume clustering milestone

Do not produce one new resume per application. Create a reusable resume-variant layer:

1. Classify a qualified job into a candidate-owned role cluster, such as Backend, Node.js, Platform, or Fintech.
2. Reuse the best approved variant when its job similarity meets a measured threshold.
3. Generate a new variant only when no approved variant is sufficiently similar, the role is unusually valuable, or the candidate explicitly asks.
4. Keep variants editable, versioned, attributable to their source resume, and eligible for deletion.

Target: cap Pro at roughly 30 newly generated variants per month, with unlimited reuse of already-approved variants.

## Delivery gates

1. Add provider/model routing configuration and a versioned cost catalog.
2. Add per-feature metering, quota enforcement, and visible candidate usage history.
3. Build resume clusters and similarity evaluation using an offline evaluation set before enabling automatic reuse suggestions.
4. Measure quality, acceptance, retry rate, tokens, and cost per successful outcome.
5. Reprice only after observing production usage; include payment, storage, contact-data, support, tax, and infrastructure costs—not AI alone.

## Verification source

OpenAI API pricing for `gpt-5.4-mini` and `gpt-5.4-nano` must be rechecked at each pricing-model update: <https://platform.openai.com/pricing>.
