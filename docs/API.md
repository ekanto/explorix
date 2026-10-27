# Explorix REST API

The complete, machine-readable contract is the OpenAPI 3 document in
[`apps/server/src/openapi.yaml`](../apps/server/src/openapi.yaml). A running server exposes it at:

| URL | Content |
| --- | --- |
| `GET /api/docs` | Interactive Swagger UI |
| `GET /api/openapi.json` | OpenAPI document as JSON (for client generators) |
| `GET /api/health` | Unauthenticated liveness probe `{ "status": "ok" }` |

This page summarizes the conventions. CI and webhook recipes are in [INTEGRATIONS.md](INTEGRATIONS.md).

## Authentication

| Caller | Mechanism | Notes |
| --- | --- | --- |
| Browser / web app | `POST /api/auth/login` sets an `httpOnly`, `SameSite=Lax` cookie (`explorix_sid`). | Every state-changing request (`POST/PUT/PATCH/DELETE`) must also send `X-Requested-With: explorix`; requests without it are rejected with **403** (CSRF protection). |
| Scripts / CI | Personal API token sent as `Authorization: Bearer exp_…` | Create one under **Profile → API tokens**. Tokens can be restricted to a single project and have an optional expiry. The token acts with its creator's permissions and is stored only as a SHA-256 hash. Tokens cannot create other tokens or change passwords. The CSRF header is not needed. |

Repeated failed logins lock the account temporarily, and the login endpoint is rate-limited.

## Authorization

- **Organization roles:** `OWNER`, `ADMIN`, `MEMBER`. Owners and admins are implicit admins of every project and can use `/api/admin/*`.
- **Project roles:** `VIEWER < TESTER < LEAD < ADMIN`. The server checks them on every route.
  - Viewers can read and comment.
  - Testers can create and execute work.
  - Leads can review and approve sessions and manage project configuration.
  - Admins can manage members and integrations.
- Resources in projects the caller cannot access return **404**, not 403, so their existence is not disclosed. Every nested lookup is scoped by `projectId`, which prevents IDOR (accessing another project's records by guessing IDs).

## Conventions

- **Base path:** project resources live under `/api/projects/{projectId}/…` and use internal IDs. Human-friendly keys (`CH-3`, `S-12`, `F-7`, `SHOP-4`, `C-21`, `R-2`, `A-15`, `REQ-5`) are included in responses for display.
- **Errors:** always `{ "error": { "code": "validation_error", "message": "…", "details": { … } } }`.

  | Status | Meaning |
  | --- | --- |
  | 400 | Validation error |
  | 401 | Not signed in |
  | 403 | Insufficient role or missing CSRF header |
  | 404 | Not found or not accessible |
  | 409 | Conflict |
  | 413 | Upload too large |
  | 415 | Unsupported file type |
  | 429 | Rate limited |
  | 501 | Planned integration that is not implemented |

- **Pagination:** list endpoints accept `page` and `pageSize` (maximum 200) and return `{ total, page, pageSize, <items> }`.
- **Filtering:** list endpoints accept query filters such as `q`, `status`, `assigneeId`, `milestoneId`, `tag`, `priority`, `from`, and `to`. Repeat a parameter or comma-separate values to pass several.
- **Exports:** `…/findings/export`, `…/issues/export`, `…/test-cases/export`, `…/test-runs/{id}/export`, and `…/reports/export/{dataset}` accept `format=csv|json` and the same filters as their list endpoints. CSV cells that start with `= + - @` are prefixed with `'` to prevent spreadsheet formula injection.
- **Attachments:** `POST …/attachments` is a multipart upload linked to a session, finding, issue, test result, or automation result.
  - The type is checked by content sniffing, not by file extension.
  - The size limit is `MAX_UPLOAD_MB`.
  - Downloads go through `GET …/attachments/{id}/content`, which checks project access and sends `Content-Disposition` and `X-Content-Type-Options: nosniff`. Files are never served directly from disk.
- **Rich text:** session notes and descriptions are sanitized server-side with an allow-list (no scripts, styles, or event handlers).

## Endpoint groups

| Group | Paths | Highlights |
| --- | --- | --- |
| Auth & profile | `/api/auth/*`, `/api/tokens` | Login/logout, current user, password change, API tokens. |
| Workspace | `/api/my-work`, `/api/overview`, `/api/search`, `/api/notifications` | Cross-project data, always limited to the caller's projects. |
| Projects | `/api/projects`, `…/members`, `…/{collection}` | Projects, members, and configuration collections: milestones, environments, tags, custom fields, finding classifications, result statuses, and project settings. |
| Templates | `…/templates` | Organization templates (15 built-in) plus project templates. |
| Charters | `…/charters` | CRUD, history, duplicate, archive and unarchive, and launch a session. |
| Sessions | `…/sessions` | List with filters, bulk assign/tag/archive, notes autosave, log entries, transitions (`start`, `pause`, `resume`, `finish`, `abandon`, `submit-review`, `approve`, `request-changes`, `reopen`), duplicate, related sessions, and a printable report. Archiving is done through `sessions/bulk`. |
| Findings | `…/findings` | CRUD, duplicate suggestions (`/similar`), convert to an issue, link to an existing issue, mark as duplicate (requires an explicit target), and create a regression test case. |
| Issues | `…/issues` | Internal issue tracker with source-finding back-links. |
| Requirements | `…/requirements` | CRUD, CSV import, and charter/test case traceability. |
| Test management | `…/test-folders`, `…/test-cases`, `…/test-plans`, `…/test-runs` | Steps or Gherkin, revisions, CSV import (`?format=auto\|steps\|gherkin\|text&separator=auto\|newline\|pipe\|semicolon\|numbered`) and export, runs with assignment, results, and close. Run export: `…/test-runs/:id/export?format=csv\|json\|md\|docx` (`md` is a ZIP with `RUN.md` and `attachments/`; `docx` embeds images). |
| Automation | `…/automation/*` | Ingestion (native JSON, staged runs, JUnit XML, Playwright JSON), runs, comparison, per-test history with flaky indicators, and trends. |
| Reports | `…/reports/*` | Dashboard metrics with definitions, release readiness, coverage gaps, and CSV/JSON exports. |
| AI (optional) | `/api/ai/*`, `…/ai/*` | Returns drafts only; it never writes records. Returns 503 with setup guidance when no provider is configured. Charter linting, heuristic recommendations, and duplicate detection are deterministic and always available. |
| Integrations | `…/integrations` | Outgoing webhooks and GitHub Issues push. Jira and GitLab return 501. |
| Admin | `/api/admin/*` | Users, teams, organization settings, audit log, and a full organization JSON export. |

## Example: the exploratory workflow over the API

```bash
API=http://localhost:4000/api
H='-H "X-Requested-With: explorix" -H "Content-Type: application/json"'
curl -c jar -X POST $API/auth/login -H 'Content-Type: application/json' \
     -d '{"email":"tester@explorix.dev","password":"Explorix-demo-1"}'
PID=$(curl -s -b jar $API/projects | jq -r '.projects[] | select(.key=="SHOP") | .id')

# 1. Charter
CH=$(curl -s -b jar -X POST $API/projects/$PID/charters -H 'X-Requested-With: explorix' -H 'Content-Type: application/json' \
  -d '{"title":"Coupon edge cases","mission":"Explore coupon entry using boundary values to discover pricing errors","timeboxMinutes":45}' | jq -r .charter.id)
# 2. Launch and start a session
S=$(curl -s -b jar -X POST $API/projects/$PID/charters/$CH/sessions -H 'X-Requested-With: explorix' -H 'Content-Type: application/json' \
  -d '{"start":true}' | jq -r .session.id)
# 3. Log a timestamped finding
curl -s -b jar -X POST $API/projects/$PID/findings -H 'X-Requested-With: explorix' -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$S\",\"title\":\"100% coupon yields negative tax\",\"classificationKey\":\"potential_defect\",\"severity\":\"MAJOR\"}"
# 4. Finish (sends to review when the project requires it)
curl -s -b jar -X POST $API/projects/$PID/sessions/$S/finish -H 'X-Requested-With: explorix' -H 'Content-Type: application/json' \
  -d '{"summary":"Coupons mostly solid; tax rounding issue found."}'
```

The OpenAPI document lists the exact request and response fields for every endpoint.
