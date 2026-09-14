# Setup guide

This archive contains no API keys, job database, generated applications, or personal resume files. Complete the steps below on your own computer.

## 1. Requirements

- Node.js 20 or newer
- npm
- An OpenAI API key for AI scoring and tailored application content
- Optional: Hunter API key for recruiter contact enrichment
- Optional: Python 3.10+ and JobSpy for LinkedIn/Indeed job discovery

## 2. Install the application

Open a terminal in the extracted `job-hunter-agent` directory and run:

```bash
npm install
cp .env.example .env
cp data/master_resume.example.json data/master_resume.json
```

On Windows PowerShell, use:

```powershell
npm install
Copy-Item .env.example .env
Copy-Item data/master_resume.example.json data/master_resume.json
```

## 3. Configure `.env`

Open `.env` and replace the placeholder values.

- Set `OPENAI_API_KEY` to enable scoring and tailored content.
- Set `CANDIDATE_EMAIL` to your own email.
- Hunter is optional. For one user, set `HUNTER_API_KEY`. For multiple distinct authorized users, set `HUNTER_API_KEYS` to their comma-separated keys.
- Keep search sources disabled until their required tools or API keys are configured.
- Never commit or share `.env`.

The application does not include mock recruiter contacts. Missing or rejected provider keys are shown as real errors.

## 4. Add your resume

Edit `data/master_resume.json` and replace every example value with factual information. The dashboard also provides a Resume tab for later edits.

Do not share this file after adding personal contact or employment information.

## 5. Start the dashboard

```bash
npm start
```

Open `http://localhost:3001`, or the port configured in `.env`.

From Overview you can:

- Process a chosen number of existing pending jobs.
- Search enabled sources and process a chosen number of newly added jobs.
- Review action counts, follow-ups, system health, and recent activity.

The COPILOT tab uses the safe local form when `ALLOW_REAL_SUBMISSION=false`. For employer sites, set `ALLOW_REAL_SUBMISSION=true`, restart the server, and load the unpacked extension from the repository's `extension/` directory at `chrome://extensions`. Choose **Build resume & open with extension**. The extension uses the current signed-in browser, follows multi-hop Apply pages, fills verified facts, and stops for final review. Unknown or sensitive facts, login, CAPTCHA, portal changes, and experience mismatches pause the workflow.

You can also run the complete ingestion pipeline from the terminal:

```bash
npm run ingest
```

## 6. Optional JobSpy setup

JobSpy requires Python 3.10 or newer. One supported macOS/Linux setup is:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
```

Then set `JOBSPY_ENABLED=true` in `.env`. Review `JOBSPY_COMMAND` before running it.

## 7. Verify the installation

```bash
npm test
```

The SQLite database is created automatically under `data/` on first run. Generated resumes and cover letters are written under `output/`.

## Before sharing your own copy

Never include these paths in a shared archive:

- `.env`
- `data/jobs.db*`
- `data/master_resume.json`
- `data/master_resume.txt`
- Resume PDFs under `data/`
- Files under `output/`
- `node_modules/` and `.venv/`
