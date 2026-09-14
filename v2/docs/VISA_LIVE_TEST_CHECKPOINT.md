# Visa live browser test — 2026-09-14

Selected from the saved jobs dashboard: **Sr. SW Engineer (3-5 years, GenAI, Java/Python full stack)**, requisition **REF087773W**. Different employer and ATS from the preceding Bosch test: Visa / Workday.

## Observed in the user's Chrome profile

- Dashboard's Apply with Copilot opened the correct live job and placed its tab in `Job Hunter · Applying`.
- On the job description, Copilot displayed `Job recognized` and directed the user to the employer's Apply action; it did not attempt to fill the description page.
- Employer Apply opened a choice of Autofill with Resume, Apply Manually, Use My Last Application, and LinkedIn.
- Selected Autofill with Resume. Workday opened its seven-step journey, currently at Create Account/Sign In.
- Copilot displayed `Sign in to continue` and correctly left password, password confirmation, consent, and the robot-only website input untouched.

## Blocking condition and next step

The user must sign in or create their Visa Workday account in the open tab. Chrome profile sign-in does not authenticate this employer's Workday account.

After login, resume testing through résumé import, My Information, My Experience, Application Questions, and Review. Check field accuracy, dropdown commitment, preservation of manual edits, and remaining-field explanations.

No application fields were tested beyond this authentication boundary. No résumé was uploaded, no application was submitted, and no learning improvement is claimed. No production code changes were made for this test.
