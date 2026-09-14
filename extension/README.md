# Job Hunter COPILOT Chrome extension

This Manifest V3 extension runs inside the candidate's existing Chrome/Edge profile. It does not copy browser cookies or passwords to the Job Hunter backend.

## Install locally

1. Start Job Hunter Agent on `http://127.0.0.1:3001`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `extension` directory.
5. Pin **Job Hunter COPILOT**. Clicking its toolbar icon toggles the native Chrome side panel.
6. Open a qualified job from the dashboard. The pet application agent follows supported application pages automatically.
7. Use **Scan & fill safe fields** in the side panel when a portal needs a manual retry. Review the employer form and submit manually.

After changing extension files, return to `chrome://extensions` and click **Reload** on Job Hunter COPILOT, then reload the job/application tab. Version 1.8 opens the native side panel directly from the toolbar, groups Greenhouse multi-select questions correctly, recognizes company-specific Apply labels, keeps CAPTCHA values local to the employer page, records uploads only after attachment, and preserves Workday/Keka recovery controls. Manual **Mark as filled** remains available from the dashboard fallback.

## Answer safety and learning

The extension reads the employer's visible question label, field type, and offered choices. It sends those to the local dashboard, which resolves answers in this order:

1. Verified candidate profile facts (for example current/expected CTC).
2. Candidate-approved reusable answers saved in the dashboard.
3. Resume-derived technical experience or a grounded, job-specific motivation draft.
4. Candidate review when a value is missing, volatile, sensitive, or does not exactly match an employer's choice.

It never uses an AI narrative for CTC, start date, current employer, legal/sensitive questions, or an unknown short input. It also refuses to guess between employer radio options (for example 3 versus 4 years when the profile says 3.5 years).

It does not train a model on your data. The global Profile preference enables quiet reusable-answer learning; it does not interrupt every application. Each application also offers **Do not learn from this application**, which never blocks normal autofill. Low-risk facts are eligible only after verified completion, while compensation, authorization, scoped facts and suspicious changes require review before future reuse.

Each application attempt keeps a local, reviewable timeline and field outcomes. Passwords, OTPs, declaration values, identity documents, and other protected values are never stored as reusable candidate memory. Declarations are application-specific authorization; the current build leaves them on the employer form for the candidate until revision-bound grouped authorization exists. A submission is recorded only from an employer confirmation page or an explicit candidate verification after a detected Submit action.

AI processing is off by default and requires both the local `AI_PROCESSING_ENABLED=true` switch and explicit consent in COPILOT Profile. Direct identifiers are minimized before an AI request. Sensitive and legal fields are never sent through AI or saved into vector memory.

The extension sends page text only after the candidate clicks an extension action. It blocks an application when the destination page reveals an experience requirement above the candidate's confirmed total experience.

The extension is review-only. Its deterministic plan can fill verified safe fields, but the plan is incapable of submitting and the candidate must use the employer's submit control directly.
