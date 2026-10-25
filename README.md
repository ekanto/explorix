# Explorix

**Exploratory testing and quality engineering platform.** Explorix pairs a focused exploratory-testing workbench with structured test management, automation reporting and release-readiness insights.

Write a mission, explore, capture timestamped observations with evidence, separate *observations* from *confirmed defects*, then turn discoveries into issues and regression test cases.

> Explorix is an original, independent product. It is not affiliated with Testmo or any other vendor named in the research documents.

## What's in 1.0

| Area | Highlights |
|---|---|
| **Exploratory workbench** | <ul><li>Charters with a natural-language mission and 15 editable templates</li><li>One charter → many sessions</li><li>Server-authoritative timer with pause/resume</li><li>Autosaved rich-text notes that survive a refresh</li><li>Timestamped activity log</li><li>Classified findings: observation, potential/confirmed defect, question, risk, follow-up, note</li><li>Paste/drag screenshots and keyboard shortcuts</li><li>SBTM debrief and an optional review/approval step</li></ul> |
| **Findings & issues** | <ul><li>Findings repository</li><li>Duplicate suggestions (always confirmed by a user)</li><li>Convert to an internal issue with back-links</li><li>Findings → regression test cases</li></ul> |
| **Test management** | <ul><li>Folders, steps or Gherkin, versions with diff/restore</li><li>Plans, runs, configurable result statuses</li><li>Requirement traceability, CSV import/export</li></ul> |
| **Automation** | <ul><li>Ingests JUnit XML, Playwright JSON and native JSON (single-shot or staged/parallel) via API tokens</li><li>Run history and comparison, flaky detection, trends</li></ul> |
| **Reporting** | <ul><li>Dashboards built from persisted records, with documented metric definitions</li><li>Drill-down, release readiness, coverage gaps</li><li>CSV/JSON export, print-friendly reports</li></ul> |
| **Collaboration & admin** | <ul><li>Org and project roles enforced server-side</li><li>Comments and @mentions, notifications, My Work</li><li>Audit log, custom fields, teams, API tokens, signed webhooks</li><li>GitHub Issues push</li></ul> |
| **AI (optional)** | <ul><li>Provider abstraction, off by default</li><li>Drafts are always reviewed before saving</li><li>Deterministic heuristics, charter lint and duplicate detection work without any AI provider</li></ul> |

**Not implemented:** Jira/GitLab sync, SSO/MFA, Slack, S3 storage, server-side PDF and per-step results. The app labels these as planned. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full list of limitations.

## Quick start (local development)

Requirements:

- Node.js 22+ and npm 10+.
- PostgreSQL. You don't need to install it: an embedded PostgreSQL 18 is downloaded and started automatically.

```bash
npm install
npm run setup     # creates apps/server/.env (with a generated ENCRYPTION_KEY), starts PostgreSQL, migrates, seeds demo data
npm run dev       # PostgreSQL (if needed) + API on :4000 + web on :5173
```

Open **http://localhost:5173** and sign in with a demo account.

> **macOS/Linux:** the root `package.json` `allowScripts` list approves the Windows embedded-PostgreSQL binary package. On other platforms, do one of the following:
> - add your platform's `@embedded-postgres/<platform>` package to `allowScripts`; or
> - set `USE_EMBEDDED_PG=false` and point `DATABASE_URL` at your own PostgreSQL 14+.

### Demo accounts

All accounts use the password `Explorix-demo-1`.

| Email | Role |
|---|---|
| `admin@explorix.dev` | Org admin |
| `lead@explorix.dev` | QA lead |
| `tester@explorix.dev` | Tester |
| `sam@explorix.dev` | Tester |
| `viewer@explorix.dev` | Read-only viewer |
| `dana@explorix.dev` | Member of the second project only |

The seed creates two projects, **ShopFront Web (SHOP)** and **Mobile Banking API (BANK)**, with:

- charters, sessions in every state, findings, issues;
- test cases, runs, requirements, automation history and milestones.

## Scripts (repository root)

| Command | Purpose |
|---|---|
| `npm run setup` | First-time setup: env file, database, migrations, demo data |
| `npm run dev` | Start database (if needed), API and web with live reload |
| `npm run db` | Start only the embedded PostgreSQL |
| `npm run db:reset` | Drop, re-migrate and re-seed the development database |
| `npm run build` | Production build (web → `apps/web/dist`, server → `apps/server/dist`) |
| `npm start` | Run the production server; it serves the API and the built web app on `PORT` |
| `npm run typecheck` | TypeScript checks for server and web |
| `npm test` | API/integration tests (Vitest + Supertest against a real PostgreSQL `<db>_test`) |
| `npm run test:e2e` | Playwright end-to-end tests (isolated API on :4100 and web on :5174, fresh `<db>_e2e`) |
| `npm run test:all` | Both suites |

First-time e2e setup: `npx playwright install chromium`.

## Test results

Results from the 1.0 build, on Windows with Node 26 and embedded PostgreSQL 18:

| Suite | Result | What it covers |
|---|---|---|
| `npm test` | **51 / 51 passed** (9 files) | <ul><li>Auth, CSRF, lockout and token scope</li><li>IDOR and role enforcement</li><li>Charter → session → finding → issue workflow</li><li>Timer math</li><li>Reports compared with direct DB counts</li><li>Export correctness and formula-injection guard</li><li>JUnit/Playwright ingestion and flaky detection</li><li>AI draft-only behavior</li><li>Webhook signing and delivery, GitHub push (stubbed endpoint)</li><li>First-run bootstrap</li></ul> |
| `npm run test:e2e` | **21 / 21 passed** (Chromium) | <ul><li>Sign-in and access control</li><li>Full workbench lifecycle: launch, timer, autosave across reloads, findings with screenshots, pause/resume, finish, review</li><li>Charter create/edit/duplicate/archive</li><li>Bulk session assignment</li><li>Findings exports vs the API</li><li>Dashboard KPIs vs persisted records</li><li>Smoke pass over all 31 screens that fails on console errors, uncaught exceptions or 5xx responses</li></ul> |

## Production

`npm run build && npm start` runs a single Node process. It serves the REST API, the OpenAPI docs at `/api/docs` and the web app.

On first start against an empty database, set `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` to create the owner account.

A `Dockerfile` and `docker-compose.yml` are included but **were not tested** (no Docker engine was available). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for:

- configuration;
- backups;
- upgrades;
- hardening.

## Repository layout

```
apps/server   Express + TypeScript API, Prisma schema/migrations/seed, Vitest tests
apps/web      React + Vite + TypeScript SPA (Mantine UI, TanStack Query, Tiptap)
e2e           Playwright end-to-end tests
docs          Research, PRD, architecture, API, integrations, metrics, deployment, checklist, roadmap
scripts       Dev orchestration (scripts/dev.mjs)
```

## Documentation

| Document | Contents |
|---|---|
| [docs/RESEARCH.md](docs/RESEARCH.md) | Public-source market research and a feature matrix with implementation status |
| [docs/PRD.md](docs/PRD.md) | Prioritized product requirements with status |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, data model, security and testing strategy |
| [docs/API.md](docs/API.md) | REST API guide (live OpenAPI at `/api/docs`) |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | CI recipes, ingestion formats, webhooks, GitHub, AI providers |
| [docs/METRICS.md](docs/METRICS.md) | Exact definition of every dashboard metric (measured vs estimated) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment, backup and recovery |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | Feature implementation checklist and acceptance criteria evidence |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Known limitations and prioritized roadmap |

## Security notes

- Server-side sessions (hashed IDs, HttpOnly cookies), scrypt password hashing, account lockout, CSRF header check and rate limiting.
- Every project-scoped query is filtered by membership. Inaccessible records return 404.
- Uploads are validated by content type and size. SVG and HTML are rejected, and files are served only through authorized endpoints.
- Integration secrets are encrypted with AES-256-GCM. API tokens and webhook secrets are never returned after creation.
- `.env` files are git-ignored. `.env.example` contains no secrets.
