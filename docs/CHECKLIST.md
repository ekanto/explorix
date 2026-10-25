# Explorix 1.0 — feature implementation checklist

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
| 12 | Core workflows have automated tests | ✅ | 51 backend tests + 21 e2e tests (see README "Test results") |
| 13 | Another developer can install and run it | ✅ | README quick start was exercised on Windows with embedded PostgreSQL. Docker path is ❔ (see §4) |
| 14 | Nothing presented as functional unless it is | ✅ | Jira/GitLab return 501; Slack/SSO/MFA/SCIM shown as "Planned"; AI shows setup instructions when unconfigured |
| 15 | Unimplemented features documented honestly | ✅ | This file, [ROADMAP.md](ROADMAP.md), [RESEARCH.md](RESEARCH.md) matrix status column |

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
| Sessions | No ZIP export with attachments; TBS split is self-reported at debrief | 📋 |
| Findings | No bulk actions; finding ↔ issue linking only starts from the finding side | 📋 |
| Issues | No tags or environment field; plain-text description | 📋 |
| AI regression cases | Generated preconditions are not passed to the create endpoint | 🟡 |
| Test cases | Archive only (no hard delete); folder filter is not recursive; no format/automation filter | 🟡 |
| Test runs | No per-step results; runs cannot be deleted; run list omits assignees; plans only group runs | 🟡 |
| Requirements | Coverage filter is client-side over the first 200 rows; no direct requirement ↔ session/issue link | 🟡 |
| Automation | Sources are created automatically and cannot be edited; run detail shows at most 2,000 results; artifacts are links/metadata (binary upload goes through the attachments API) | 🟡 |
| Activity / audit | Project feed filters only by entity type; no export of the activity log | 🟡 |
| Reports | No status filter; no server-generated PDF (browser print → PDF) | 🟡 |
| Admin | Only the full-organization JSON export; no import/restore tool | 🟡 |
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
| 7 | Design system | `apps/web/src/theme.ts`, `apps/web/src/components/`, [ARCHITECTURE.md §5](ARCHITECTURE.md) | ✅ |
| 8 | Demo data | `apps/server/prisma/seed.ts` | ✅ |
| 9 | Tests and results | `apps/server/test`, `e2e/tests`, README "Test results" | ✅ |
| 10 | Env examples (no secrets) | `apps/server/.env.example` | ✅ |
| 11 | Local and deployment instructions | [README.md](../README.md), [DEPLOYMENT.md](DEPLOYMENT.md) | ✅ (Docker ❔) |
| 12 | API and integration docs | [API.md](API.md), [INTEGRATIONS.md](INTEGRATIONS.md), `/api/docs` | ✅ |
| 13 | This checklist | — | ✅ |
| 14 | Limitations and roadmap | [ROADMAP.md](ROADMAP.md) | ✅ |

## 5. Unverified in this environment

- ❔ `Dockerfile` and `docker-compose.yml`: no Docker engine was available, so neither has been built or run.
- ❔ SMTP email delivery: code path exists, but no mail server was used.
- ❔ Live AI providers: only exercised with a mocked provider.
- ❔ GitHub Issues push against the real GitHub API: `integrations.test.ts` covers it with a stubbed GitHub endpoint only.
- ❔ Browsers other than Chromium; screen-reader behaviour (no automated accessibility audit was run).
