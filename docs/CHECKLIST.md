# Explorix 3.0 — feature implementation checklist

Status legend:

- ✅ **Done**: implemented end-to-end (database → API → UI) and exercised by tests or manual verification.
- 🟡 **Partial**: works, with the stated limitation.
- 📋 **Planned**: not implemented. The UI and API say so honestly (e.g. HTTP 501, a "Planned" badge).
- ❔ **Unverified**: implemented but never run in this environment.

Requirement IDs refer to [PRD.md](PRD.md). Test evidence lives in `apps/server/test/*.test.ts` (Vitest + real PostgreSQL) and `e2e/tests/*.spec.ts` (Playwright against the real API and UI).

## 1. MVP acceptance criteria (brief §16)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Sign in; access only authorized projects | ✅ | `auth.test.ts`, `access.test.ts` (inaccessible projects and records return 404, role checks return 403); `auth.spec.ts` |
| 2 | Create, edit, duplicate, archive charters | ✅ | `charters.spec.ts` (UI create → reload → API check, edit history, duplicate as draft, archive/unarchive, viewer denied) |
| 3 | Launch sessions from charters | ✅ | `workbench.spec.ts` "tester launches a session from a charter"; `workflow.test.ts` |
| 4 | Timer start / pause / resume / finish | ✅ | `workbench.spec.ts` "pause stops the clock and resume continues it"; server-authoritative clock in `workflow.test.ts` |
| 5 | Notes and findings persist after refresh | ✅ | `workbench.spec.ts` "notes autosave and survive a refresh", "captures a classified finding with screenshot evidence" |
| 6 | Findings: timestamps, authors, classification, evidence, issue links | ✅ | `workbench.spec.ts` (finding + PNG evidence), `workflow.test.ts` (convert to issue keeps back-links) |
| 7 | Completed sessions keep chronological history | ✅ | `workbench.spec.ts` "finishing sends the session for review and keeps its history read-only" |
| 8 | Search, filter, assign sessions | ✅ | `quality.spec.ts` "lead bulk-assigns sessions…" (UI bulk assign → API → assignee's list + notification) |
| 9 | Dashboard metrics reflect stored records | ✅ | `reports.test.ts` (exact counts on fixture data); `quality.spec.ts` "dashboard metrics change exactly with persisted records" (API and UI cards) |
| 10 | CSV and JSON exports contain correct data | ✅ | `quality.spec.ts` "findings CSV and JSON exports match the filtered list"; `unit.test.ts` (CSV escaping, formula-injection guard) |
| 11 | Invalid input and unauthorized requests handled safely | ✅ | `access.test.ts` (validation 400s, role 403s), `auth.test.ts` (CSRF header, lockout, token scope), `workflow.test.ts` (unsafe upload types rejected), `charters.spec.ts` viewer 403 |
| 12 | Core workflows have automated tests | ✅ | 74 backend tests + 21 web e2e tests + 9 desktop unit tests + 6 desktop e2e tests (see README "Test results") |
| 13 | Another developer can install and run it | ✅ | README quick start was exercised on Windows with embedded PostgreSQL. Docker path is ❔ (see §4) |
| 14 | Nothing presented as functional unless it is | ✅ | Jira/GitLab return 501; Slack/SSO/MFA/SCIM shown as "Planned"; AI shows setup instructions when unconfigured |
| 15 | Unimplemented features documented honestly | ✅ | This file, [ROADMAP.md](ROADMAP.md), [RESEARCH.md](RESEARCH.md) matrix status column |

## 1a. Desktop 2.0 definition of done (desktop brief §18)

Desktop e2e = `apps/desktop/e2e/desktop.spec.ts`, run against the development build, `win-unpacked` and the installed app.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Launches as a normal Windows desktop application | ✅ | Desktop e2e (window state, menu); installed via `Explorix-Setup-2.0.0.exe /S` and launched from the installed exe |
| 2 | No separate Node.js install | ✅ | Electron runtime, server bundle, dependencies and PostgreSQL are packaged; `build.mjs` fails if a runtime import is not staged; installed-app e2e run from a folder outside the repository |
| 3 | Existing core features keep working | ✅ | Web e2e 21/21 and server 74/74 on the same code; desktop e2e uses the sample project, findings and the workbench |
| 4 | Projects, sessions, findings and attachments persist across restarts | ✅ | Desktop e2e "keeps projects and evidence across an app restart, outside the install folder" |
| 5 | Screenshots and supported videos attach to findings | ✅ | Desktop e2e records a real WebM; `evidence.test.ts` covers images, video metadata, frames and markers |
| 6 | Reports contain the selected findings and evidence | ✅ | `reporting.test.ts` "respects evidence selection and never silently drops videos"; desktop e2e parses every format |
| 7 | DOCX is editable and correctly formatted | ✅ | mammoth parses the headings, tables, images and captions (`reporting.test.ts`, desktop e2e) |
| 8 | Markdown links work after the package is moved | ✅ | `reporting.test.ts` moves the folder and resolves every link; desktop e2e resolves the MD and HTML links |
| 9 | PDFs are readable, searchable and laid out | ✅ | pdf.js text extraction and page count (`reporting.test.ts`, desktop e2e) |
| 10 | Videos represented, never silently omitted | ✅ | Thumbnail, frames and timestamp table in DOCX/PDF; link or player in MD/HTML; warning when no preview is possible ([REPORTING.md](REPORTING.md#how-video-is-represented)) |
| 11 | Evidence packages include all selected assets and a manifest | ✅ | Desktop e2e ZIP package (original video byte-identical, no secrets or app paths); `reporting.test.ts` package test |
| 12 | No overwrite without confirmation | ✅ | Desktop e2e (Cancel keeps the existing report, Keep both); desktop unit tests (atomic save, folder replace) |
| 13 | Backup and restore preserve data and evidence relationships | ✅ | `backup.test.ts` (5 tests); desktop e2e backup → change → restore |
| 14 | Installer and packaged app tested | ✅ | Silent install, shortcuts, uninstall entry, launch, clean shutdown, uninstall keeps data ([DESKTOP.md](DESKTOP.md#tests)); portable exe launched |
| 15 | Setup, build instructions and known limitations | ✅ | [DESKTOP.md](DESKTOP.md), [REPORTING.md](REPORTING.md), README |
| — | Code-signed installer | 📋 | No certificate available; the build is unsigned and documented as such |

## 2. Phase checklist

### Phase 1 — MVP

- ✅ Authentication (email/password, server sessions in PostgreSQL, scrypt password hashing, lockout, CSRF header, rate limiting)
- ✅ Org and project roles enforced server-side
- ✅ Projects and project dashboard
- ✅ Charters (all brief §5.1 fields, natural-language mission, drafts, history, duplicate, archive, search/filter)
- ✅ 15 reusable charter templates (editable; org- or project-scoped)
- ✅ Session workbench (mission panel, timer, rich-text notes, timeline, quick log, findings, evidence, hotkeys, autosave, refresh recovery, debrief)
- ✅ Screenshots and attachments (paste, drag-and-drop, upload; validated by content; authorized download)
- ✅ Assignments and statuses
- ✅ Internal issue tracker
- ✅ Search and filtering (lists + global Spotlight search)
- ✅ Basic analytics
- ✅ Persistence, migrations, seed data
- ✅ End-to-end tests

### Phase 2 — QA management

- ✅ Custom fields (8 types; charters, sessions, findings, test cases, issues)
- ✅ Configurable workflows: optional session review step, finding classifications, test-result statuses
- ✅ Advanced session management (8 views, bulk assign/tag/milestone/archive, duplicate, related sessions)
- ✅ Collaboration (comments, @mentions, finding ownership, follow-up classification)
- ✅ Notifications (in-app); 🟡 email requires SMTP configuration and was not tested against a real mail server
- ✅ Milestones/releases
- ✅ Manual test cases (folders, steps or Gherkin, versions with diff/restore, CSV import/export)
- ✅ Test plans and runs (assignment, configurable statuses, defect linking, progress)
- ✅ Audit history (org and project)
- ✅ Reports with drill-down, CSV/JSON exports, print-friendly layout

### Phase 3 — Automation and integrations

- ✅ Result ingestion: native JSON (single-shot and staged/parallel), JUnit XML, Playwright JSON reporter output
- ✅ Run history, comparison, per-test history, flaky indicator, trends
- ✅ REST API with OpenAPI (`/api/docs`) and personal API tokens
- ✅ Outbound webhooks (HMAC-signed, delivery log; `integrations.test.ts` delivers to a real local HTTP receiver and verifies the signature)
- 🟡 GitHub Issues: one-way push only (no status sync back)
- 📋 Jira and GitLab issue sync (API returns 501)
- 📋 Native Cypress/Selenium/Jenkins plugins (use the JUnit XML ingestion instead)
- 🟡 Advanced traceability: requirements ↔ test cases ↔ charters ↔ findings, coverage status; no matrix export

### Phase 4 — AI and advanced analytics

- ✅ Provider abstraction (one implementation: any OpenAI-compatible endpoint such as OpenAI, Azure OpenAI or Ollama), off by default, server-side keys only
- ✅ Deterministic features that need no provider: heuristic recommendations, charter lint, duplicate suggestions, coverage gaps
- 🟡 Provider-backed features (charter draft, test ideas, session summary, defect report, regression cases, release risk): built and tested with a stubbed provider (`ai.test.ts`); **not exercised against a live AI service**
- ✅ Release readiness with explicit thresholds

## 3. Known gaps by module

| Module | Gap | Status |
|---|---|---|
| Charters / templates | Templates do not store custom-field defaults; no charter or template export | 📋 |
| Sessions | TBS split is self-reported at debrief (session reports and ZIP evidence packages are available since 2.0) | 🟡 |
| Findings | No bulk actions; finding ↔ issue linking only starts from the finding side | 📋 |
| Issues | No tags or environment field; plain-text description | 📋 |
| AI regression cases | Generated preconditions are not passed to the create endpoint | 🟡 |
| Test cases | Archive only (no hard delete); folder filter is not recursive; no format/automation filter | 🟡 |
| Test runs | No per-step results; runs cannot be deleted; run list omits assignees; plans only group runs | 🟡 |
| Requirements | Coverage filter is client-side over the first 200 rows; no direct requirement ↔ session/issue link | 🟡 |
| Automation | Sources are created automatically and cannot be edited; run detail shows at most 2,000 results; artifacts are links/metadata (binary upload goes through the attachments API) | 🟡 |
| Activity / audit | Project feed filters only by entity type; no export of the activity log | 🟡 |
| Reports | Dashboard has no status filter; generated reports are English only (see [REPORTING.md](REPORTING.md#limitations)) | 🟡 |
| Admin | Backup/restore covers the whole workspace (no per-project export); restore needs a superuser database role | 🟡 |
| Integrations | Webhook secrets and GitHub tokens need `ENCRYPTION_KEY`; webhooks have no retry | 🟡 |

## 4. Deliverables (brief §17)

| # | Deliverable | Location | Status |
|---|---|---|---|
| 1 | Research summary | [RESEARCH.md](RESEARCH.md) | ✅ |
| 2 | Feature matrix | [RESEARCH.md § matrix](RESEARCH.md) | ✅ |
| 3 | PRD | [PRD.md](PRD.md) | ✅ |
| 4 | Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) | ✅ |
| 5 | Schema and migrations | `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/` | ✅ |
| 6 | Working application | `apps/server`, `apps/web` | ✅ |
| 7 | Design system | `apps/web/src/theme.ts`, `apps/web/src/styles.css`, `apps/web/src/components/ui.tsx`, [DESIGN.md](DESIGN.md) | ✅ |
| 8 | Demo data | `apps/server/prisma/seed.ts` | ✅ |
| 9 | Tests and results | `apps/server/test`, `e2e/tests`, README "Test results" | ✅ |
| 10 | Env examples (no secrets) | `apps/server/.env.example` | ✅ |
| 11 | Local and deployment instructions | [README.md](../README.md), [DEPLOYMENT.md](DEPLOYMENT.md) | ✅ (Docker ❔) |
| 12 | API and integration docs | [API.md](API.md), [INTEGRATIONS.md](INTEGRATIONS.md), `/api/docs` | ✅ |
| 13 | This checklist | — | ✅ |
| 14 | Limitations and roadmap | [ROADMAP.md](ROADMAP.md) | ✅ |
| 15 | Windows desktop app and installer | `apps/desktop`, `apps/desktop/release/` (git-ignored build output), [DESKTOP.md](DESKTOP.md) | ✅ (unsigned) |
| 16 | Reporting engine docs | [REPORTING.md](REPORTING.md) | ✅ |
| 17 | UI/UX audit and redesign: tokens, light and dark themes, shell, dashboard, responsive validation | [DESIGN.md](DESIGN.md), `e2e/scripts/capture-screens.mjs` | ✅ |

## 5. Unverified in this environment

- ❔ `Dockerfile` and `docker-compose.yml`: no Docker engine was available, so neither has been built or run.
- ❔ SMTP email delivery: code path exists, but no mail server was used.
- ❔ Live AI providers: only exercised with a mocked provider.
- ❔ GitHub Issues push against the real GitHub API: `integrations.test.ts` covers it with a stubbed GitHub endpoint only.
- ❔ Browsers other than Chromium; screen-reader behaviour (no automated accessibility audit was run). Colour contrast was calculated from the design tokens ([DESIGN.md §2](DESIGN.md)); it was not measured with an audit tool.
- ❔ Windows display scaling at 125% and 150% was simulated by testing the equivalent CSS viewport widths, not on physical high-DPI hardware.
- ❔ Windows 10, ARM64 devices and machines with non-English locales: the desktop build was tested only on Windows 11 x64.
- ❔ In-place upgrade from one installed desktop version to the next: there is only one desktop release so far. The migration safety-backup path is covered by `backup.test.ts` and the boot code, not by a real upgrade.
