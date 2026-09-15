# Live Copilot one-form checkpoint — 2026-09-15

Status: **blocked before Copilot execution**. This is not a live fill result. No application was opened by this agent, no fields were filled, and no submission occurred.

Chosen next form when browser control is available: Bosch Group **SAP BTP Full Stack Developer**, catalog id `7e6adb8a-c329-4af9-813e-81cd69f4d7b3`, SmartRecruiters, `jobs.smartrecruiters.com/BoschGroup/744000148199029-sap-btp-full-stack-developer`. This is the known-regression target from `BOSCH_LIVE_TEST_CHECKPOINT.md`. Do not treat the listing as qualification-cleared for submission.

## What was verified (filesystem + running API, not Chrome UI)

### Local services
- API process `npm run dev:api` is listening at `http://127.0.0.1:3100` after a watch restart. Node `v24.8.0`.
- Web process `npm run dev:web` is configured for `http://127.0.0.1:3000/` (Vite ready in the existing terminal). This agent could not `curl` either port because the session Shell tool does not return.
- Last candidate dashboard traffic in the API log: `POST /v1/auth/bootstrap` 200 and `GET /v1/jobs?limit=20` 200.

### Development extension on disk
- Path: `v2/apps/extension/dist`
- Manifest name/version on disk: Job Hunter Copilot **2.0.4**
- Config: API `http://127.0.0.1:3100`, web `127.0.0.1:3000` / `localhost:3000`, channel `development`
- File mtimes (UTC): manifest/background/content **2026-09-14T14:24:02Z**
- Disk rebuild is **not** proof Chrome reloaded the service worker or content scripts.

### Installed Chrome extension (Profile 3 Secure Preferences)
- Chrome profile email on that profile is the permitted Job Hunter profile (value not copied here).
- Developer mode: true
- Unpacked extension id `kkfbmeebnklpkeeblkmjbfkkanillbpg`
- `location: 4` (unpacked), `from_webstore: false`, `disable_reasons: []` (enabled)
- Path exactly `.../v2/apps/extension/dist`
- Already granted hosts include loopback web/API plus `jobs.smartrecruiters.com`, `jobs.ashbyhq.com`, `jobs.lever.co`, `visa.wd5.myworkdayjobs.com`
- Not in that granted-host snapshot: `job-boards.greenhouse.io` (Postman). A later Greenhouse test may prompt for extra site access.
- Same profile also has **Simplify Copilot** and **FastApply** installed. Any live fill must attribute Job Hunter vs those extensions separately.
- Unpacked settings store for this id was written as recently as 2026-09-15 00:02 local. That is storage activity, not a fill score.

### Job catalog (live PostgreSQL via the running API)
- Non-fixture jobs: **66 total, 66 ACTIVE, 0 STALE** (older “99 on Sep 14” count is stale).
- ACTIVE by ATS: Ashby 7, Greenhouse 4, Lever 9, SmartRecruiters 25, Workday 21.
- Bosch SAP BTP Full Stack, Senior DevOps, and AWS DevOps listings are ACTIVE.
- Plane Backend (Node.js) Ashby application path is present.
- Meesho Backend `.../c68ee07f-0e16-455b-bc4a-87848aaf46fa/apply` is still listed ACTIVE; prior live test hit **Application already received** — do not resubmit.
- Visa REF087773W is still listed; prior journey stopped at employer auth.

## What was not done

- Reloading Job Hunter in `chrome://extensions`
- Opening the dashboard and clicking **Apply with Copilot**
- Observing Copilot scan/fill on any employer form
- Measuring confirmation email, city suggestion commit, LinkedIn, hiring message, phone shadow input, dual résumé uploaders, or screening-route activation
- Any generic code fix, regression suite, or learning verification
- Git branch / PR for this batch (session Shell also non-functional; see blocker)

Temporary API startup probe used to write `.local-data/qa/live-test-baseline.json` must be removed from `apps/api/src/server.ts` before considering this tree clean. That probe is diagnosis only.

## Blocker

Computer use failed immediately: **Remote control requires permission for Accessibility and Screen Recording.**

The `macbook-chrome` worker is running, but this agent cannot control Chrome or take screenshots until macOS grants those permissions to the Cursor Agent / `cursor-agent-worker` process.

The session **Shell tool also never returns**, so `curl`, `git`, and `npm` cannot be run from this agent. Catalog/extension facts above were gathered by a fail-safe write from the already-running `tsx --watch` API.

## Exact next step

1. Grant **Screen Recording** and **Accessibility** to Cursor Agent / `cursor-agent-worker` (System Settings → Privacy & Security). Leave the worker running.
2. Resume this run. Then: reload unpacked Job Hunter → refresh `http://127.0.0.1:3000/` → Reconnect → Apply with Copilot on Bosch SAP BTP Full Stack → let Copilot run unassisted → record committed values vs errors. Do not submit; do not accept consents; do not enter PAN.
3. Only after that observation: diagnose → generic owner-level fix → regression → live retest.

Do not claim Bosch regressions are fixed or still broken from this checkpoint. Installed path and host grants are verified; live Copilot behavior is not.
