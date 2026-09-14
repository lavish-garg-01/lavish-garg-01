# Job Hunter V2

Start with [the context index](docs/CONTEXT_INDEX.md) for ownership, decisions, known issues and source links. The [implementation checkpoint](docs/IMPLEMENTATION_CHECKPOINT.md) records completion through Phase Q: 304 passing tests and green browser/build gates. Next boundary: Phase R. [Strategy Intelligence](docs/STRATEGY_INTELLIGENCE.md) documents default-enabled observation, review-gated candidate rollout and operator controls; run migrations through0020 before API startup. See [AI orchestration](docs/AI_ORCHESTRATOR.md) for server-only provider setup and limits. The older slice list below describes the initial foundation.

V2 is the clean production rebuild. The repository root remains the frozen V1 reference system, behavior oracle, fixture corpus and migration source during cutover.

Current slice:

- Phase A audit and reconciliation;
- Phase B TypeScript modular-monolith skeleton and architecture guards;
- Phase C clean PostgreSQL `0001_initial_v2_schema` plus an executable empty-database migration test;
- Phase D identity and entitlement domain foundations;
- Phase E Candidate Truth authority through E4: policy, scoped resolution, verified learning, grouped writes, append-only Undo/Restore and immutable reversal history.
- Phase F value-private V1 import;
- Phase G onboarding/profile;
- Phase H Job Intelligence.

Run with the pinned runtime:

```bash
nvm use
cd v2
npm install
npm run check
```

No V2 runtime may import V1 implementation code. Proven V1 behavior is carried through explicit ports and golden tests.

## Local development login

The local bypass replaces only the external identity-provider handshake. PostgreSQL and the normal Candidate Truth encryption/fingerprint settings remain required.

Create `.env` from `.env.example` and set:

```text
NODE_ENV=development
HOST=127.0.0.1
ENABLE_DEV_AUTH=true
DEV_AUTH_TOKEN=<at-least-16-local-characters>
DEV_AUTH_EMAIL=developer@jobhunter.local
DATABASE_URL=<your-local-or-Supabase-PostgreSQL-URL>
CANDIDATE_VALUE_HMAC_SECRET=<at-least-32-characters>
RESUME_PROPOSAL_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
```

Create `apps/web/.env.local` and use the same token:

```text
VITE_API_URL=http://127.0.0.1:3100
VITE_ENABLE_DEV_AUTH=true
VITE_DEV_AUTH_TOKEN=<same-token-as-DEV_AUTH_TOKEN>
VITE_DEV_AUTH_EMAIL=developer@jobhunter.local
```

Then run the API and web app in separate terminals:

```bash
nvm use 24
npm run dev:setup
npm run dev:api
```

```bash
npm run dev:web
```

All root and V2 npm scripts automatically use Node **24.8.0**, including
database setup/migrations, job sync, builds, tests, strategy tools, and direct
web/extension workspace commands. The shared launcher reads the repository
root `.nvmrc`. It reuses the installed nvm runtime, or installs the pinned
version when nvm is available. This changes only the command's environment,
not your terminal's default Node version.

Use `npm run deps:install` instead of plain `npm install`, or
`npm run deps:ci` instead of `npm ci`, to run dependency installation itself
under the pinned runtime (including native-module compilation). For an ad hoc
Node command, use `npm run node -- <arguments>`. Plain `node`, `npm install`,
and `npm ci` still use your terminal's runtime.

Keep both processes running. The web server uses strict port `3000` so it fails
clearly if another project owns that port instead of silently moving to an
origin the API does not trust. If Copilot reports `API_UNAVAILABLE`, first
confirm that `npm run dev:api` is still serving `http://127.0.0.1:3100/health`,
then rebuild and reload `apps/extension/dist`.

The sign-in screen shows **Continue as local test user**. The API rejects development authentication in production or when bound to a non-loopback host, and Vite excludes the option from production builds even if the frontend flag is accidentally present.

`npm run dev:setup` starts the project-owned PostgreSQL 17 Docker container and applies all V2 migrations idempotently. Docker Desktop must be running. Existing data is kept in the `job-hunter-v2-postgres-data` Docker volume. For Supabase or another hosted PostgreSQL database, skip `db:start` and run `npm run db:migrate` with its `DATABASE_URL`.
