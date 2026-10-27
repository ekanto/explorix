# Explorix

**Exploratory testing and quality engineering platform.** Explorix pairs a focused exploratory-testing workbench with structured test management, automation reporting and release-readiness insights.

Write a mission, explore, capture timestamped observations with evidence, separate *observations* from *confirmed defects*, then turn discoveries into issues and regression test cases.

> Explorix is an original, independent product. It is not affiliated with Testmo or any other vendor named in the research documents.

## Explorix Desktop 3.0 for Windows

Explorix 3.0 also ships as a **standalone Windows desktop application**. It bundles the Explorix server, an embedded PostgreSQL database and the UI in one installer, so you don't need Node.js, a terminal or a browser. It works offline and keeps all data in `%APPDATA%\Explorix`.

| Download (built into `apps/desktop/release/`) | |
|---|---|
| `Explorix-Setup-3.0.0.exe` | Per-user installer with Start menu and desktop shortcuts and an uninstaller. Your data is kept on uninstall. **Recommended.** |
| `Explorix-Portable-3.0.0.exe` | Runs without installing. Slower to start (about 1 minute) because it unpacks itself on each launch. |

The builds are **not code-signed**, so Windows SmartScreen will warn on first run (*More info → Run anyway*).

Highlights:
- **Evidence-rich findings.** Add screenshots, screen recordings and attachments from the file picker, drag and drop, the clipboard or built-in screen capture.
  - Annotations, captions, ordering, video timestamps and selected frames.
  - Content-based file validation and SHA-256 checksums.
  - Originals are never modified.
- **Reporting engine.** A 6-step wizard with 8 templates produces Word, PDF, Markdown and HTML reports.
  - Optional self-contained evidence packages (folder or ZIP with a manifest).
  - Saving uses the Windows *Save As* dialog with overwrite protection.
- **Local-first.** Data is stored locally. Includes backup and restore, automatic safety backups before upgrades, and a recovery screen. Electron security: context isolation, sandbox, validated IPC, CSP.

See **[docs/DESKTOP.md](docs/DESKTOP.md)** (install, data locations, security, build, tests, limitations) and **[docs/REPORTING.md](docs/REPORTING.md)**.

```bash
npm install
npm run desktop     # run the desktop app from source
npm run dist:win    # build the installer and portable exe into apps/desktop/release/
```

## Features

| Area | Highlights |
|---|---|
| **Exploratory workbench** | <ul><li>Charters with a natural-language mission and 15 editable templates</li><li>One charter → many sessions</li><li>Server-authoritative timer with pause/resume</li><li>Autosaved rich-text notes that survive a refresh</li><li>Timestamped activity log</li><li>Classified findings: observation, potential/confirmed defect, question, risk, follow-up, note</li><li>Paste/drag screenshots and keyboard shortcuts</li><li>SBTM debrief and an optional review/approval step</li></ul> |
| **Findings & issues** | <ul><li>Findings repository</li><li>Duplicate suggestions (always confirmed by a user)</li><li>Convert to an internal issue with back-links</li><li>Findings → regression test cases</li></ul> |
| **Test management** | <ul><li>Folders, steps or Gherkin, versions with diff/restore</li><li>Plans, runs, configurable result statuses</li><li>Requirement traceability, CSV import (steps, Gherkin or text; choice of step separator) and export</li><li>Run export to Markdown (ZIP with attachments) or Word, with full result history</li><li>Test case export to Markdown or Word, grouped by folder, with the latest result and attachments from each run</li></ul> |
| **Automation** | <ul><li>Ingests JUnit XML, Playwright JSON and native JSON (single-shot or staged/parallel) via API tokens</li><li>Run history and comparison, flaky detection, trends</li></ul> |
| **Reporting** | <ul><li>Dashboards built from persisted records, with documented metric definitions</li><li>Drill-down, release readiness, coverage gaps</li><li>CSV/JSON export</li><li>Report wizard: DOCX, PDF, Markdown and HTML reports and evidence packages from a finding, findings, session, charter, milestone or project</li></ul> |
| **Evidence** | <ul><li>Screenshots, videos, documents and logs on findings, sessions, issues and results</li><li>Annotations, captions, ordering, video markers and frames</li><li>Exclude from reports; trash with 30-day retention</li></ul> |
| **Collaboration & admin** | <ul><li>Org and project roles enforced server-side</li><li>Comments and @mentions, notifications, My Work</li><li>Audit log, custom fields, teams, API tokens, signed webhooks</li><li>GitHub Issues push</li><li>Backup and restore (database plus evidence)</li></ul> |
| **AI (optional)** | <ul><li>Provider abstraction, off by default</li><li>Drafts are always reviewed before saving</li><li>Deterministic heuristics, charter lint and duplicate detection work without any AI provider</li></ul> |

**Not implemented:** Jira/GitLab sync, SSO/MFA, Slack, S3 storage, remote sync for the desktop app, and per-step results. The app labels these as planned. See [docs/ROADMAP.md](docs/ROADMAP.md) for the full list of limitations.

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
| `npm run typecheck` | TypeScript checks for server, web and desktop |
| `npm test` | API/integration tests (Vitest + Supertest against a real PostgreSQL `<db>_test`) |
| `npm run test:e2e` | Playwright end-to-end tests (isolated API on :4100 and web on :5174, fresh `<db>_e2e`) |
| `npm run test:all` | Both suites |
| `npm run desktop` | Build and launch the Electron desktop app (data in `%APPDATA%\Explorix`, or `EXPLORIX_HOME` if set) |
| `npm run test:desktop` | Desktop unit tests and the Playwright suite that drives the real Electron app |
| `npm run dist:win` | Windows installer and portable exe in `apps/desktop/release/` |
| `npm run notices` | Regenerate `THIRD_PARTY_NOTICES.md` from the installed dependencies (`npm run notices:check` verifies it) |

First-time e2e setup: `npx playwright install chromium`.

## Test results

Results from the 3.0 build, on Windows 11 with Node 26 and embedded PostgreSQL 18:

| Suite | Result | What it covers |
|---|---|---|
| `npm test` | **74 / 74 passed** (12 files) | <ul><li>Auth, CSRF, lockout and token scope</li><li>IDOR and role enforcement</li><li>Charter → session → finding → issue workflow</li><li>Timer math</li><li>Reports compared with direct DB counts</li><li>Export correctness and formula-injection guard</li><li>JUnit/Playwright ingestion and flaky detection</li><li>AI draft-only behavior</li><li>Webhook signing and delivery, GitHub push (stubbed endpoint)</li><li>First-run bootstrap and setup wizard</li><li>Evidence: content sniffing, invalid and oversized files, video metadata, frames and byte ranges, annotated copies keep originals intact, ordering, trash and restore</li><li>Reporting: DOCX, PDF, MD and HTML parsed and checked, relative links survive a move, packages and manifests, video never dropped, cancellation</li><li>Backup and restore: checksums, tampered, foreign and too-new backups, safety backup, restore from an older data version</li></ul> |
| `npm run test:e2e` | **21 / 21 passed** (Chromium) | <ul><li>Sign-in and access control</li><li>Full workbench lifecycle: launch, timer, autosave across reloads, findings with screenshots, pause/resume, finish, review</li><li>Charter create/edit/duplicate/archive</li><li>Bulk session assignment</li><li>Findings exports vs the API</li><li>Dashboard KPIs vs persisted records</li><li>Smoke pass over all screens that fails on console errors, uncaught exceptions or 5xx responses</li></ul> |
| `npm test -w @explorix/desktop` | **9 / 9 passed** | IPC validation and sender trust, URL policy, Save As overwrite protection and atomic saves, cancellation, settings recovery, DPAPI secrets |
| Desktop e2e (Playwright `_electron`) | **6 / 6 passed** on the development build and on the packaged `win-unpacked` app (3.0.0); on 2.0.0 also on the app installed by the setup exe | <ul><li>Window security</li><li>First-run setup and the sample project</li><li>A real screen recording attached to a finding</li><li>PDF, DOCX, HTML and Markdown reports parsed and their links resolved</li><li>Overwrite protection</li><li>A ZIP package with a byte-identical original video</li><li>Backup and restore</li><li>Persistence across a restart</li></ul> |

The installer was also tested with a silent install, launch, clean shutdown and uninstall; the data folder was preserved. Details are in [docs/DESKTOP.md](docs/DESKTOP.md#tests).

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
apps/server   Express + TypeScript API, Prisma schema/migrations/seed, reporting engine, Vitest tests
apps/web      React + Vite + TypeScript SPA (Mantine UI, TanStack Query, Tiptap)
apps/desktop  Electron shell: main process, preload, embedded PostgreSQL boot, packaging, unit + e2e tests
e2e           Playwright end-to-end tests
docs          Research, PRD, architecture, API, integrations, metrics, deployment, checklist, roadmap
scripts       Dev orchestration (scripts/dev.mjs), third-party notices generator (scripts/notices.mjs)
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
| [docs/DESKTOP.md](docs/DESKTOP.md) | Windows desktop app: install, data locations, backups, security model, build, tests, limitations |
| [docs/REPORTING.md](docs/REPORTING.md) | Report wizard, templates, formats, video representation, evidence packages |
| [docs/DESIGN.md](docs/DESIGN.md) | Design system: audit, light/dark tokens, type scale, layout rules, accessibility, visual validation |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment, backup and recovery |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | Feature implementation checklist and acceptance criteria evidence |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Known limitations and prioritized roadmap |

## Security notes

- Server-side sessions (hashed IDs, HttpOnly cookies), scrypt password hashing, account lockout, CSRF header check and rate limiting.
- Every project-scoped query is filtered by membership. Inaccessible records return 404.
- Uploads are validated by content type and size. SVG and HTML are rejected, and files are served only through authorized endpoints.
- Integration secrets are encrypted with AES-256-GCM. API tokens and webhook secrets are never returned after creation.
- `.env` files are git-ignored. `.env.example` contains no secrets.

## License

Explorix is released under the [MIT License](LICENSE). Copyright (c) 2026 Omar Faruq.

It bundles open-source components under their own licences, listed with full texts in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The desktop installer and the Docker image include both files. After changing dependencies, run `npm run notices` to regenerate the notices; the desktop build fails while they are out of date.
