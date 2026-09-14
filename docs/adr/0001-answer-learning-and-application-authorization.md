# ADR 0001 — Answer learning and application authorization

Status: accepted  
Policy version: 1  
Date: 2026-08-30

## Context

Answer learning, field-semantic learning, employer-form interaction and legal/application authorization are separate systems. A candidate editing an employer field does not by itself prove that the semantic mapping, saved candidate truth, rendered representation or browser strategy was wrong. Likewise, agreeing to one employer declaration is not reusable consent for another application.

## Decision

1. `USER_CORRECTED` is a neutral browser observation. Only the versioned correction classifier may attribute evidence to semantic meaning, candidate truth, representation, interaction strategy or checkpoint acceptance.
2. Local validity and page advance support runtime recovery only. They do not finalize reusable memory.
3. Review creates a pending change set. Verified submission finalizes eligible low-risk learning. When submission cannot be verified, a future explicit `Done — save these answers` checkpoint is required.
4. Stable, low-risk identity/contact/professional facts may become a new reversible candidate-memory version after a verified commit. The product summarizes changes and must support Undo before this policy is enabled beyond shadow mode.
5. Compensation, work authorization, sponsorship, government affiliation, non-compete status, entity-scoped facts, suspicious changes and ambiguous scope are `REVIEW_TO_SAVE`.
6. Job/company prose and application-specific writing remain application-scoped. Passwords, OTPs, CAPTCHA, government identifiers, credentials and protected values are `NEVER_LEARN`.
7. The global profile preference enables quiet reusable-answer learning. Every application exposes `Do not learn from this application`; opting out never blocks normal autofill.
8. Employer declarations use application-specific authorization, never reusable candidate-answer memory. Compatible ordinary declarations may later be itemized and authorized once for the current content revision. Background checks, arbitration/waivers, biometrics, medical/genetic disclosures, electronic signatures and similar high-impact actions remain separate/direct. Optional marketing and talent-pool choices remain neutral and separate.
9. Phase 0 keeps all declaration controls manual until the revision-bound authorization receipt is implemented and verified. This temporary runtime restriction does not redefine declarations as candidate memory.
10. Final employer submission always remains a separate candidate action.

## Enforcement

- `src/services/answerLearningPolicy.js` is the versioned Phase 0A category policy.
- `src/services/fieldLearningClassifier.js` is the only five-layer attribution authority and remains SHADOW-only.
- `src/repositories/learningRepository.js` combines the global preference with a per-application opt-out; it never prompts on every application.
- Browser field handlers cannot write semantic, answer, representation or strategy ledgers directly.
- Parts 0B–0D must preserve these decisions in contracts, persistence, RLS and protocol behavior.
