# Job Hunter Agent (India)

AI-assisted, human-in-the-loop job hunting engine tuned for the **Indian tech market**. Does **not** auto-apply.

- **Ingest** jobs from JobSpy (LinkedIn India + Indeed India), Firecrawl (Naukri / Instahyre / Hirist / Cutshort / Wellfound / custom listings), Greenhouse / Lever / Ashby (India locations only)
- **Pre-score** cheaply on keywords; OpenAI only if the pre-score is above `PREFILTER_MIN_SCORE` (default 40)
- **Score** fit with OpenAI (`gpt-4o-mini`) using INR / LPA context + Zod structured outputs
- **Review** matches, close-calls, discarded jobs, and an application tracker in a local Express + EJS dashboard
- **Prioritize** by match score, posting date, created date, CTC, or a source-provided company score
- **Approve** to enrich recruiter contacts with Hunter and generate a tailored PDF (education + all roles + extra skill keywords) plus email / two LinkedIn notes
- **COPILOT extension** runs in the candidate's current signed-in Chrome/Edge profile, follows employer Apply pages, fills grounded answers, attaches the selected resume, and stops for review

## Quick start

Node.js 24.x is required. Run `nvm use` from the project root before installing dependencies or running checks.

```bash
cd job-hunter-agent
cp .env.example .env
cp data/master_resume.example.json data/master_resume.json
# edit data/master_resume.json with your real resume
npm install
npm run ingest
npm start
```

Open [http://localhost:3001](http://localhost:3001) (or the `PORT` in your `.env`).

### Run the new candidate frontend

The React frontend lives in `web/`. It has two explicit storage modes:

- With no frontend API URL, it runs as a persistent browser-local prototype. It does not pretend to parse a resume or call AI.
- With `NEXT_PUBLIC_JOB_HUNTER_API_URL`, it uses the local Express API and SQLite database through `/api/v1`.

Run the API and frontend in separate terminals:

```bash
# terminal 1 — API and SQLite
nvm use
PORT=3011 npm start

# terminal 2 — React frontend (Node 24 from web/.nvmrc)
cd web
nvm use
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Local mode uses an opaque, HTTP-only development session cookie; it does not use ChatGPT login. The `/api/v1` contract is the future Supabase integration boundary—production identity, ownership checks, and Row Level Security still need to be added before a multi-user launch.

## Scripts

| Command | Purpose |
|---|---|
| `npm run ingest` | Fetch India-market jobs → upsert SQLite → prefilter + AI score/tailor |
| `npm start` | Local dashboard |
| `npm run dev` | Local dashboard with Node watch mode |
| `npm test` | Run deterministic renderer and ATS-analysis unit tests |
| `npm run check:start` | Start on an isolated port and verify the `/health` readiness endpoint |
| `npm run check:resumes` | Render all four PDFs and enforce A4, one-page, margin, font, fill, and reading-order checks |

## Environment

Copy `.env.example` → `.env`. Minimum useful keys:

- `OPENAI_API_KEY` — scoring + cover letter / resume / LinkedIn note tailoring
- `AI_PROCESSING_ENABLED=true` — global AI-processing switch; AI calls still require explicit consent in COPILOT Profile
- `CANONICAL_AI_ENABLED=true` — enables shared, value-free field canonicalization for unresolved form fields; this is budgeted separately from candidate-specific AI and is reusable by Free and Paid users
- `CANONICAL_AI_DAILY_LIMIT=200` — daily ceiling for compact/rich shared canonicalization calls
- `CANONICAL_EMBEDDINGS_ENABLED=true` — optional server-side semantic embeddings for the canonical registry (off by default; lexical retrieval still runs)
- `HUNTER_API_KEYS` — comma-separated keys belonging to distinct authorized users; requests rotate across keys and a quota-limited key fails over to the next
- `HUNTER_API_KEY` — backward-compatible single-user alternative
- `HUNTER_RECRUITER_LIMIT=2` — maximum contacts requested per approval to conserve credits
- `JOBSPY_ENABLED=true` — primary channel once Python JobSpy is installed
- `FIRECRAWL_API_KEY` — scrape Naukri / Instahyre / Hirist / Cutshort / Wellfound / custom listing URLs
- `GREENHOUSE_BOARDS` / `LEVER_COMPANIES` / `ASHBY_BOARDS` — optional ATS boards (India-filtered)
- `CANDIDATE_NOTICE_DAYS=0` — **no notice filtering** (notice is still extracted for tags). Any positive number enables filtering.
- `CANDIDATE_EMAIL` — used for Gmail compose / mailto helpers (never auto-sends)

Fake/mock job inserts are disabled. Sources that fail are skipped.

### Firecrawl (Naukri / Instahyre / Hirist / Cutshort / Wellfound / careers pages)

1. Create a key at [firecrawl.dev/app](https://www.firecrawl.dev/app)
2. Put it in `.env`:

```bash
FIRECRAWL_API_KEY=fc-your-key
FIRECRAWL_ENABLED=true
NAUKRI_ENABLED=true
INSTAHYRE_ENABLED=true
HIRIST_ENABLED=true
CUTSHORT_ENABLED=true
WELLFOUND_ENABLED=true
FIRECRAWL_MAX_JOBS=40
FIRECRAWL_URLS=https://boards.greenhouse.io/postman
```

Firecrawl uses the v2 scrape API with a JSON schema (`title`, `company`, `url`, `description`, `location`, `postedAt`, `companyRating`). Dates and ratings are stored only when the source exposes them; they are never invented. Only absolute `http(s)` posting URLs are kept. Extra boards consume extra credits.

### JobSpy (India)

System `pip` / macOS Python 3.9 are not enough (`python-jobspy` needs Python ≥ 3.10). Use the project venv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
# then in .env:
JOBSPY_ENABLED=true
JOBSPY_COUNTRY=india
JOBSPY_COMMAND=./.venv/bin/python scripts/jobspy_cli.py --site linkedin,indeed --search_term "backend engineer" --results_wanted 25 --country india
```

The Node ingestion layer runs `scripts/jobspy_cli.py` (JobSpy has no `python -m jobspy` CLI) and forces `--country india`.

## Workflow

1. Edit `data/master_resume.json`
2. `npm run ingest`
3. Review **Matches** (≥80) and **Close** (70–79) in the dashboard; audit **Discarded** / **Pending**
   - Every job panel has filters and sorting for match score, created date, posted date, CTC, and source-provided company score.
   - Pending processing uses the newest posting date first and falls back to the record creation date when a source omits it.
4. Edit cover letter / bullets / extra skills / cold email / two LinkedIn notes (proof-first + curiosity)
5. **Approve & Build Assets** or **Build resume** then **Download PDF**
6. One-click **Gmail compose** / **mailto** (you send it)
7. **Mark applied** sets `applied_at` and a 7-day follow-up on the tracker
8. **I refreshed Naukri** records a recency reminder (no Naukri login scrape)

## Local Application COPILOT

Open the **COPILOT** tab to maintain structured candidate facts, reusable screening answers, safety rules, manual jobs, and persistent application history. **Qualified jobs** contains only already-scored and experience-eligible records. With `ALLOW_REAL_APPLICATION_PREPARATION=true`, **Build resume & open with extension** creates the selected resume and opens the job in the current browser profile. Install the unpacked extension by opening `chrome://extensions`, enabling Developer mode, selecting **Load unpacked**, and choosing the repository's `extension/` directory.

Keep `ALLOW_REAL_APPLICATION_PREPARATION=false` while testing; set it to `true` only when real job-site preparation is intended. The application flow is **review-only**: it may prepare and fill verified fields, but it never clicks the employer's submit control. The candidate reviews and submits directly on the employer site. A visible persistent Chromium profile is stored locally under `storage/browser-profile/`; credentials are never stored in SQLite. Unknown or sensitive factual questions, login, CAPTCHA, and changed portals pause the workflow. Daily/weekly limits remain enforced. Failures store local debug screenshots that are automatically cleaned after seven days.

AI processing is disabled by default. It becomes available only when `AI_PROCESSING_ENABLED=true` and the candidate separately enables AI processing in COPILOT Profile. Direct identifiers are minimized before AI calls; legal, consent, credential, health, demographic, identity-document, and similar sensitive fields stay outside AI and reusable vector-memory paths.

Shared field canonicalization is a separate platform-intelligence path. It receives only a bounded field descriptor (label/type, section, neighboring labels, safe attributes and canonical candidates), never candidate answers, resume data, raw HTML or user identifiers. Exact, deterministic and cached semantic resolution run before AI. Candidate mappings need evidence before global reuse, and only trusted standard profile concepts can create proactive Attention gaps. Local review and quarantine controls are exposed at `/admin/semantics`.

Application questions use a grounded answer pipeline: verified profile values, approved reusable answers, conservative resume-derived facts, and finally an OpenAI answer grounded in the current job analysis and tailored resume. Learning is governed by [ADR 0001](docs/adr/0001-answer-learning-and-application-authorization.md): low-risk facts can be considered only after a verified completion, consequential changes require review, and each application can opt out without blocking autofill. Declarations are application-specific authorization—not reusable answers—and remain direct candidate actions until revision-bound grouped authorization is implemented. Final submission always remains the candidate's action.

The selected resume template is built before the application task is queued and is attached before any unknown-question pause. The review form also recognizes that server-side attachment, shows its filename, and allows an optional replacement PDF.

## One-page A4 resumes and ATS checks

Every resume option uses the same measurable `210 × 297 mm` page box and a single-column text reading order. Before export, the browser fitter adjusts body type, line height, section spacing, item spacing, and safe internal margins within bounded readability limits. Export stops with an actionable error instead of clipping content or silently dropping a second page.

The resume chooser shows one full-size selected preview plus two separate, transparent heuristics computed from the generated PDF:

- **ATS readiness** checks standard headings, extracted contact/experience/education text, parser-safe structure, one-page A4 geometry, overflow, clipping, margins, typography, and page fill.
- **Job keyword match** shows which supplied job-analysis terms are present or missing in the exact text extracted from the selected PDF.

These scores are local guidance, not a guarantee of how a particular employer ATS will rank a candidate. Downloaded PDFs are tagged, text-based, single-page A4 documents with no layout tables, SVG icons, image text, or multi-column reading order.

## India data channels

| Channel | Role |
|---|---|
| JobSpy | Primary — LinkedIn India + Indeed India |
| Firecrawl | Naukri / Instahyre / Hirist / Cutshort / Wellfound + custom `FIRECRAWL_URLS` |
| Greenhouse / Lever / Ashby | Direct careers JSON feeds, **India locations only** |
| Hunter | Recruiter / talent-acquisition contact enrichment by company domain |

## Project layout

```text
job-hunter-agent/
├── src/
│   ├── config/environment.js
│   ├── database/{connection.js,schema.sql}
│   ├── services/{ingestion,firecrawl,openai,prescore,enrichment,pdfGenerator,resumeLayout,resumeAnalyzer}.js
│   ├── utils/{indiaLocation,jobTags,textSimilarity}.js
│   ├── routes/dashboard.js
│   ├── views/index.ejs
│   ├── templates/resumes/{classic,split,ats,compact}.html
│   ├── pipeline.js
│   └── server.js
├── data/{jobs.db,master_resume.json}
└── output/
```

## Notes

- Match threshold defaults to `80` (`MATCH_THRESHOLD`); close queue is `CLOSE_MIN_SCORE` (default 70) up to the match threshold
- Keyword pre-filter defaults to `40` (`PREFILTER_MIN_SCORE`) — below that skips OpenAI (`PREFILTERED`)
- Target locations default to Remote, Gurugram, Delhi, Noida, Pune, Hyderabad, Bengaluru
- Compensation analysis uses **INR / LPA** (`1 LPA = ₹1,00,000`)
- Notice period is extracted into tags; `CANDIDATE_NOTICE_DAYS=0` disables filtering (unstated NP is never a skip)
- Dedup: exact URL, then company+title; Dice ≥ 0.95 only on aggregators, not ATS
- Re-ingesting an exact URL backfills a missing posting date and refreshes a source-provided company score without creating a duplicate
- Consultancy/staffing keywords and jobs older than `MAX_JOB_AGE_DAYS` (default 7) are filtered at ingest
- Pending records older than three days and matched/close records older than seven days are archived using `posted_at`, with `created_at` as fallback
- Sending emails/LinkedIn messages stays manual (human-in-the-loop by design)
