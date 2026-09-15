# Live Copilot one-form checkpoint — 2026-09-15

Status: **live Copilot launched on Bosch SAP BTP; fill not verified.** No application submitted. No consents accepted. No PAN entered.

## What ran

Job Hunter Copilot was launched from the local Jobs dashboard with **Apply with Copilot** onto the live SmartRecruiters OneClick form:

`https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/2caf2350-8844-4aba-a8cb-86c8d5e956db`

This used a headed Playwright Chromium loaded with a **copy** of `apps/extension/dist` (Job Hunter only; Simplify/FastApply not present). The installed Chrome profile was not driven: computer-use control of the user’s Chrome still failed after the permission grant (likely the running `cursor-agent-worker` process needs those TCC rights and a restart). Playwright is not a Copilot fill; it only clicked dashboard Apply. Subsequent resolve/plan calls came from the extension.

Local API accepted:

- `POST /v1/learning/runs` 200
- `POST /v1/field-intelligence/resolve` 200 (twice)
- `POST /v1/execution/plan` 200
- `POST /v1/execution/document-evidence` 200

## Observed on the form (before the bot wall)

Mini-card: **Finding your saved answers… · 0 of 14 scanned questions populated.**

Visible empty controls: first name, last name, email, confirm email, city, phone (+91). Resume dropzone empty. Experience/Education collapsed. This is Copilot scanning, not a manual fill.

## Side panel after ~40s (unassisted)

Connected. **Some questions still need you.** Some controls/frames could not be scanned.

- 14 structural fields / 1 form
- Understood 11 · 7 answers ready · 3 need attention
- Last fill: **0 verified · 1 need attention · 8 safely skipped**
- Counts: 0 completed · 9 to review · 5 remaining

Field outcomes (labels only):

- Resume — document upload verification failed
- First Name * — Add an answer to your profile
- Last Name * — Add an answer to your profile
- Email * — pending (two email fields; confirmation email is the second)
- Linkedin Url — pending
- Phone * — pending
- Current Location — Waiting for another field
- Resume (second) — pending
- Portfolio Url / Cover Letter / unlabeled questions 7, 8, 13 — graph node blocked

**0 verified fills.** Do not treat “7 answers ready” as committed DOM values. Emails/LinkedIn/phone stayed pending; first/last name were not in profile as split canonicals.

## Bot-wall interruption

About 40s after launch, SmartRecruiters replaced the form with **Verification Required** (slide-to-unlock), citing automated/bot activity. Copilot mini-card then still showed **0 of 14 populated**. The slider was **not** solved. Automated Chromium is not a substitute for the user’s existing Chrome session on this ATS.

## Computer use

Accessibility/Screen Recording grant did not make `computerUse` able to control the existing Chrome window. Do not restart the `macbook-chrome` worker from this run (it would kill the agent). If retrying native Chrome: confirm TCC is granted to **cursor-agent-worker** / Cursor Agent, then start a **new** worker/session.

## Code

- `v2/scripts/live-copilot-one-form.ts` — dashboard → Apply with Copilot harness. Uses an isolated extension **copy** so production `dist` is unchanged. Does not bypass anti-bot checks.
- Temporary API spawn hook used to start that script was removed from `apps/api/src/server.ts`.

## Next

1. Retest this same Bosch OneClick URL in the **user Chrome profile** (not Playwright) so the bot wall is less likely.
2. Generic follow-ups only after that, in owner order: first/last name from verified full name; resume upload verification; email/LinkedIn/phone commitment vs pending; city suggestion commit; graph-blocked unlabeled questions.
3. Do not submit this role from this checkpoint (qualification vs SAP BTP not established; fill unverified; captcha).
