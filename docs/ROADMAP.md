# Explorix — known limitations and roadmap

This document describes the **2.0** build honestly. For the per-feature status see [CHECKLIST.md](CHECKLIST.md); for the market comparison see [RESEARCH.md](RESEARCH.md). Desktop-specific limitations are in [DESKTOP.md](DESKTOP.md#known-limitations) and reporting limitations in [REPORTING.md](REPORTING.md#limitations).

## 1. Known limitations

### Not verified in this environment

| Area | Limitation |
|---|---|
| Docker | `Dockerfile` and `docker-compose.yml` were written but never built or run, because no Docker engine was available. The supported, tested path is Node + PostgreSQL (embedded or external). |
| Email | SMTP notifications exist but were never sent through a real mail server. |
| AI | Provider-backed features were tested only with a stubbed provider, never against a live model. Output quality depends on the model you configure. |
| GitHub | Push-to-GitHub was tested against a stubbed GitHub endpoint, not github.com. |
| Browsers / a11y | E2E tests run in Chromium only. Components use accessible primitives (Mantine) and labelled controls, but no automated accessibility audit (axe) or screen-reader pass was done. |
| Desktop | Tested on Windows 11 x64 only. The installer is **not code-signed**. Upgrading from one installed desktop version to the next has not been exercised yet (2.0 is the first release). |

### Functional limitations

| Area | Limitation | Workaround |
|---|---|---|
| Integrations | Jira and GitLab issue sync are **not implemented**: the API returns `501 not_implemented` and the UI labels them "Planned". Slack/Teams, SSO (SAML/OIDC), MFA and SCIM are also not implemented. | Webhooks + REST API |
| GitHub | One-way create only. Status changes on GitHub are not synced back. | Track status in Explorix |
| Webhooks | One delivery attempt, with a 10 s timeout and no retries or backoff. Failures are visible in the delivery log. | Re-send from the receiver side, or poll the API |
| Storage | Attachments live on the local filesystem (`STORAGE_DIR`). There is no S3/Azure Blob driver yet, though the storage module is the abstraction point. | Use a persistent volume and back it up |
| Reports | Generated reports are English only. In PDFs, evidence references are text paths, not clickable links. Readiness thresholds are fixed in code. | Use the HTML report for clickable evidence |
| Sessions | The setup/test/bug (TBS) split and charter-vs-opportunity are self-reported at debrief, not measured. Screen capture and recording are available only in the desktop app; the browser version supports file upload and paste. | Use Explorix Desktop |
| Findings / issues | No bulk actions on findings. Issues have no tags or environment field, and their description is plain text. | Filter + per-item edits |
| Test management | Results are recorded per test case, not per step. There are no shared steps, no saved dynamic run selections, and no nested milestones. Cases and runs are archived, never hard-deleted. | Note step details in the result comment |
| Automation | Sources are created automatically by name and can't be edited. The run detail view shows at most 2,000 results. There is no CLI or native CI plugins: use `curl` with the JUnit/Playwright/native JSON endpoints. | [INTEGRATIONS.md](INTEGRATIONS.md) recipes |
| Admin | Backup/restore covers the whole workspace: there is no per-project export, and the activity log can't be exported. A restore signs everyone out. | `pg_dump` for server deployments ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| Scale | The dashboard is computed on request from raw rows, which is fine for thousands of sessions and findings but not tuned for very large tenants. List pages cap at 200 rows per page and exports at 10,000 rows. | Narrow filters |
| Tenancy | One organization per installation. The schema is org-scoped, but there is no sign-up or multi-org admin UI. | Separate installs |

## 2. Prioritized roadmap

Priorities follow the brief's principle: deepen the exploratory workbench first, then close integration gaps.

### Next (1.x — fixes and small features)

1. **Webhook retries** with exponential backoff and a manual "redeliver" button. *(reliability)*
2. **Bulk finding actions**: triage, owner, status, tags. *(FI-8)*
3. **Run the Docker image in CI** and publish it; add an axe accessibility check to the e2e suite. *(verification gaps above)*
4. **Issue tags, environment and rich-text description**, plus a link-to-finding action from the issue side.
5. **Charter, session and template exports** (CSV/JSON).
6. **Desktop:** code signing, an auto-update channel, and a faster portable build (or a zip-based portable distribution).

### Done in 2.0

- Windows desktop app with an installer, local-first storage, backup/restore and recovery ([DESKTOP.md](DESKTOP.md)).
- Server-generated DOCX, PDF, Markdown and HTML reports and evidence packages ([REPORTING.md](REPORTING.md)).
- Screen capture and recording, annotations, video markers and frames.

### Next major — integrations and enterprise

1. **Jira Cloud two-way sync** (create, status/comment sync, webhook receiver), then **GitLab Issues**.
2. **SSO** (OIDC first, then SAML), **MFA**, and SCIM provisioning.
3. **S3-compatible object storage driver** with signed URLs.
4. **Slack/Teams notifications.**
5. **CI helpers**: a small CLI (`explorix submit junit "reports/*.xml"`) and a GitHub Action wrapping the existing API.

### 3.0 — deeper test management and analytics

1. **Per-step results** and shared/reusable steps.
2. **Saved dynamic run selections** (query-based test runs) and nested milestones.
3. **Configurable readiness thresholds** per project/milestone, burndown and forecast charts.
4. **Scheduled report generation and email delivery.**
5. **Customizable dashboards** (widget layout per user/project).

### Later / exploratory ideas

- A browser extension for tab capture and automatic environment metadata in the browser version.
- Optional remote synchronisation for the desktop app (storage is already behind one module, and evidence uses relative keys).
- Guest (no-login) session participation for bug bashes.
- An MCP server so AI agents can read charters and record findings through the same authorization model.
- Measured TBS time, based on timer segments tagged by activity.
- Multi-organization hosting with sign-up and billing.
