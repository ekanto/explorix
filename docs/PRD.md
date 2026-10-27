# Explorix product requirements document

**Product:** Explorix, an exploratory testing and quality engineering platform
**Version:** 1.0 (MVP + QA management + automation/integrations foundation + optional AI layer)
**Related:** [Research & feature matrix](RESEARCH.md) · [Architecture](ARCHITECTURE.md) · [Implementation checklist](CHECKLIST.md) · [Limitations & roadmap](ROADMAP.md)

## 1. Problem

Exploratory testing finds the most interesting defects, but its results are usually lost:

- notes live in text files or chat, and findings lack context;
- time spent is not measured;
- managers cannot see which areas were explored.

Tools for scripted testing tend to treat exploration as an afterthought. Exploratory tools are often disconnected from test cases, defects, and automation results.

Explorix makes exploration a **first-class, measurable activity** connected to the rest of quality engineering.

## 2. Users and jobs to be done

| Persona | Primary jobs |
| --- | --- |
| Exploratory / manual tester | Pick up a mission, explore without interruption, capture observations and evidence quickly, hand off clear defect reports |
| QA lead / manager | Plan charters per release, assign testers, review sessions, see coverage, effort and risks, decide release readiness |
| SDET / automation engineer | Push CI results, find flaky tests, compare runs, link failures to issues |
| Developer | Understand a defect: steps, environment, evidence, session context |
| Product / stakeholder (viewer) | Read-only insight into quality, comment and answer questions |

## 3. Product principles → requirements

1. **Exploration first.**
   - Missions in natural language.
   - Charter fields are optional beyond title and mission.
   - Templates and heuristics guide the tester without forcing a script.
2. **Fast execution.** The session runs in a single workspace with:
   - a timer;
   - autosaving notes;
   - a quick log;
   - keyboard shortcuts;
   - paste-to-attach screenshots.
3. **Reliable evidence.**
   - Every log entry and finding records its author, wall-clock time, and session time.
   - Attachments are validated and access-controlled.
   - Completed sessions are read-only.
4. **Connected quality.** Charters, sessions, findings, issues, requirements, test cases, test runs, and automation results all link to each other.
5. **Actionable reporting.**
   - Every metric comes from stored records and has a published definition ([METRICS.md](METRICS.md)).
   - Estimates are labeled as estimates.
6. **Extensibility.** Configurable classifications, statuses, custom fields, templates, webhooks, a REST API, and provider abstractions (storage, AI, issue trackers).
7. **Secure by default.** Server-side RBAC, project isolation, CSRF protection, input validation, encrypted secrets, and audit logging.

## 4. Requirements

**Priority**

| Level | Meaning |
| --- | --- |
| P0 | MVP blocker |
| P1 | QA management |
| P2 | Automation & integrations |
| P3 | AI & advanced |

**Status**

| Value | Meaning |
| --- | --- |
| Done | Implemented and verified by automated tests or a manual browser check |
| Partial | Implemented with documented gaps |
| Planned | Not implemented |

### 4.1 Exploratory testing workbench (P0)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| EX-1 | Create, edit, duplicate, archive/unarchive, search and filter charters with mission, target, scope, out-of-scope, objectives, learning goals, risks, assumptions, test ideas, prerequisites, test data, environment (browser/OS/device/env), estimate, timebox, assignees, priority, risk level, milestone, tags, template, exit criteria, custom fields | P0 | Done |
| EX-2 | Charter drafts (status Draft → Ready) and change history | P0 | Done |
| EX-3 | Mission written in natural language. "Explore [target] using [approach] to discover [risks]" is offered as guidance, not enforced | P0 | Done |
| EX-4 | One charter → many sessions, each with its own timeline, notes and findings | P0 | Done |
| EX-5 | 15 built-in editable templates (new feature, regression, smoke, bug investigation, API, UI/usability, authn/authz, accessibility, security, cross-browser, responsive, performance, data validation, error handling, AI feature) with heuristics, default timebox, test ideas, custom field defaults | P0 | Done (custom-field defaults not stored on templates) |
| EX-6 | Session workspace showing mission, objectives, scope and environment while testing | P0 | Done |
| EX-7 | Start, pause, resume, finish; server-authoritative elapsed time; paused vs abandoned vs completed distinguished | P0 | Done |
| EX-8 | Rich-text notes with autosave, local recovery after refresh/navigation, conflict-safe save states | P0 | Done |
| EX-9 | Chronological activity log with timestamped quick entries (note, observation, question, idea, …) | P0 | Done |
| EX-10 | Finding capture: classification, severity, priority, expected/actual, repro steps, environment, tags, custom fields, requirement link, attachments (paste/drop) | P0 | Done |
| EX-11 | Configurable finding classifications. Defaults: observation, potential defect, confirmed defect, question, risk, follow-up, testing note. Only classifications flagged "is defect" count as defects | P0 | Done |
| EX-12 | Keyboard shortcuts (F, N, L, P, Mod+Shift+F) with an in-app reference | P0 | Done |
| EX-13 | Debrief: summary, SBTM-style setup/test/bug % breakdown, charter-vs-opportunity % | P0 | Done |
| EX-14 | Session repository with tabs (all, active, assigned to me, draft, awaiting review, completed, abandoned, archived) and filters (charter, milestone, tester, created date, status, tag, priority; project via the project switcher) | P0 | Done |
| EX-15 | Bulk assign, tag and archive sessions | P1 | Done |
| EX-16 | Duplicate a session; related-session links | P1 | Done |
| EX-17 | Review workflow (project setting): In review → Approved / Changes requested; reopen by lead | P1 | Done |
| EX-18 | Estimated vs actual time per session and in aggregate | P0 | Done |
| EX-19 | Printable session report | P1 | Done |

### 4.2 Findings and issues (P0)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| FI-1 | Findings repository with all fields, filters, owner, status workflow, comments | P0 | Done |
| FI-2 | Internal issue tracker (no external dependency) | P0 | Done |
| FI-3 | Convert finding → issue, preserving the finding and session history (back-links both ways) | P0 | Done |
| FI-4 | Link a finding to an existing issue | P0 | Done |
| FI-5 | Duplicate suggestions while typing; merging/marking duplicate only with explicit confirmation | P1 | Done |
| FI-6 | Turn a validated finding into a regression test case | P1 | Done |
| FI-7 | CSV/JSON export of findings and issues | P0 | Done |
| FI-8 | Bulk finding actions | P2 | Planned |

### 4.3 Collaboration and administration (P0–P1)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| CO-1 | Email/password sign-in, server-side sessions, lockout, password change | P0 | Done |
| CO-2 | Org roles (owner/admin/member); project roles (admin/lead/tester/viewer) enforced server-side | P0 | Done |
| CO-3 | Projects with members, milestones, environments, tags, custom fields, classifications, result statuses, settings | P0 | Done |
| CO-4 | Comments with @mentions on sessions, findings, issues, test cases, runs | P1 | Done |
| CO-5 | In-app notifications (assignment, mention, review, comment); optional email via SMTP | P1 | Done (email requires SMTP config) |
| CO-6 | My Work: assigned charters, active sessions, upcoming/overdue, findings I own, reviews waiting, assigned test runs | P0 | Done |
| CO-7 | Audit log (org and project) | P1 | Done |
| CO-8 | Admin: users (create, deactivate, reset password), teams, org settings, data export | P1 | Done |
| CO-9 | API tokens (project-scoped, expiring) | P2 | Done |
| CO-10 | SSO (SAML/OIDC), SCIM | P3 | Planned |
| CO-11 | First-run bootstrap of the org owner for production installs | P1 | Done |

### 4.4 Manual test management (P1)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| TM-1 | Repository with nested folders, search, labels, priority, status | P1 | Done |
| TM-2 | Steps format and Gherkin/BDD format; preconditions; test data; templates via custom fields | P1 | Done |
| TM-3 | Revision history with diff and restore-as-new-version | P1 | Done |
| TM-4 | Test plans grouping runs; runs with assignment, configurable statuses (Pass/Fail/Blocked/Skipped/Retest/Untested), progress, defect linking | P1 | Done |
| TM-5 | Requirement traceability (requirements ↔ test cases ↔ charters, coverage status) | P1 | Done |
| TM-6 | CSV import/export of test cases (format and step separator choice); run and test case export as CSV, JSON, Markdown with attachments, or Word | P1 | Done |
| TM-7 | Per-step results | P2 | Planned |
| TM-8 | Cross-references between charters and test cases | P1 | Done |

### 4.5 Automation (P2)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| AU-1 | Ingest native JSON (single-shot and staged), JUnit XML, Playwright JSON | P2 | Done |
| AU-2 | Run history with build, branch, commit, CI link, environment, milestone; filters | P2 | Done |
| AU-3 | Results with failure message, stack trace, duration, retries, artifact metadata | P2 | Done |
| AU-4 | Configurable automation statuses with aliases | P2 | Done |
| AU-5 | Run comparison (new failures, fixed, still failing, added/removed) | P2 | Done |
| AU-6 | Per-test history and flaky indicator | P2 | Done |
| AU-7 | Pass/fail trends | P2 | Done |
| AU-8 | Artifact binary upload from CI (screenshots, traces) | P2 | Partial (metadata/links stored; uploads via the attachments API) |
| AU-9 | Native Cypress/Selenium reporters, Jenkins plugin | P3 | Planned (use JUnit) |

### 4.6 Reporting (P0–P1)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| RE-1 | Project dashboard: KPIs, findings by classification/severity, sessions by tester, effort by milestone, defects by feature/release, manual and automation results, requirement coverage, risks | P0 | Done |
| RE-2 | Filters: milestone, date range, tester | P0 | Done |
| RE-3 | Drill-down from charts to filtered lists | P1 | Done |
| RE-4 | CSV/JSON exports; print-friendly reports (browser print → PDF) | P1 | Done (no server-side PDF rendering) |
| RE-5 | Release readiness with explicit thresholds | P1 | Done |
| RE-6 | Coverage gaps (under-tested areas) | P1 | Done |
| RE-7 | Cross-project overview | P1 | Done |

### 4.7 Integrations (P2)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| IN-1 | REST API with OpenAPI docs | P2 | Done |
| IN-2 | Outgoing signed webhooks with delivery log | P2 | Done |
| IN-3 | GitHub Issues one-way push | P2 | Done |
| IN-4 | Jira, GitLab issue sync | P2 | Planned (API returns 501, UI labels "Planned") |
| IN-5 | Slack/Teams | P3 | Planned |

### 4.8 AI assistance (P3, optional)

| ID | Requirement | Pri | Status |
| --- | --- | --- | --- |
| AI-1 | Provider abstraction; disabled by default; setup instructions shown when absent | P3 | Done |
| AI-2 | Charter draft from story/requirement | P3 | Done (requires provider) |
| AI-3 | Test idea suggestions | P3 | Done (requires provider) |
| AI-4 | Heuristic recommendations | P3 | Done (deterministic, no provider needed) |
| AI-5 | Charter lint: ambiguous objectives, missing scope | P3 | Done (deterministic) |
| AI-6 | Session summary | P3 | Done (requires provider) |
| AI-7 | Notes → structured defect report | P3 | Done (requires provider) |
| AI-8 | Duplicate finding suggestions | P3 | Done (deterministic similarity) |
| AI-9 | Regression test cases from a finding | P3 | Done (requires provider) |
| AI-10 | Release risk summary | P3 | Done (requires provider) |
| AI-11 | Under-tested area detection | P3 | Done (deterministic coverage gaps) |

All AI output is a draft that the user edits and explicitly saves.

## 5. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Security | OWASP Top-10 mitigations in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-security-summary); secrets never committed or sent to the browser |
| Data integrity | Transactions for multi-row operations; FK constraints; unique display numbers per project |
| Performance | Paginated lists (≤200 per page); indexed filters; ingestion of up to 20,000 results per request |
| Accessibility | Labeled form controls, keyboard operation, visible focus, WCAG AA color contrast in both themes (manual review; no automated audit yet) |
| Usability | Light/dark themes, responsive layouts down to tablet width, global search (Ctrl/⌘+K) |
| Operability | Env-validated config, structured logs, health endpoint, migrations, backup procedure |

## 6. Success metrics (product)

- Time from opening a charter to the first logged finding.
- Share of sessions finished with a debrief summary.
- Share of potential defects triaged within 2 days.
- Share of milestone charters explored before release.
- Weekly active testers per project.

These are product-analytics goals. Explorix does not collect telemetry.

## 7. Out of scope for 1.0

These are listed in [ROADMAP.md](ROADMAP.md):

- SSO;
- multi-org tenancy UI;
- Jira/GitLab sync;
- browser extension capture;
- screen recording;
- mobile apps;
- server-side PDF generation;
- S3 storage driver;
- configurable readiness thresholds;
- per-step manual results.
