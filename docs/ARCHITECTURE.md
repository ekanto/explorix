# Explorix technical architecture

## 1. Overview

```
┌────────────────────────────┐        ┌───────────────────────────────────────────────┐       ┌──────────────┐
│ Browser (React SPA)        │  /api  │ Express API (Node.js, TypeScript)             │ Prisma│ PostgreSQL   │
│ Mantine UI · TanStack Query├───────►│ auth → access → module routers → services     ├──────►│ (52 tables)  │
│ TipTap · Mantine Charts    │ cookie │ zod validation · audit · webhooks · AI layer  │       └──────────────┘
└────────────────────────────┘        │                                               │       ┌──────────────┐
          ▲ CI / scripts ─────────────► Bearer API token (ingestion, read APIs)        ├──────►│ File storage │
                                      └───────────────┬──────────────┬────────────────┘       │ (local disk) │
                                                      │ HTTPS        │ HTTPS                  └──────────────┘
                                             Webhook receivers   AI provider (optional, OpenAI-compatible)
                                             GitHub Issues API
```

- **Monorepo** (npm workspaces):
  - `apps/server`: API, Prisma schema, migrations, seed, reporting engine.
  - `apps/web`: React SPA.
  - `apps/desktop`: Electron shell for the Windows desktop app (see §8).
  - `e2e`: Playwright tests.
- **Single origin in production.** Express serves the built SPA from `apps/web/dist`, so the session cookie stays first-party (`SameSite=Lax`) and no CORS configuration is needed.
- **Development.** Vite (:5173) proxies `/api` to the API (:4000). PostgreSQL comes from the `embedded-postgres` npm package (:54329), so no system install or Docker is needed. Any external PostgreSQL 14+ also works.

## 2. Technology choices

| Concern | Choice | Why |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite | Mainstream, fast feedback |
| UI kit | Mantine 9 (+ dates, dropzone, spotlight, charts, tiptap) | Accessible primitives, theming (light/dark), rich components |
| Data fetching | TanStack Query 5 | Caching, invalidation, optimistic updates |
| Routing | React Router | Nested project routes, lazy-loaded pages |
| Rich text | TipTap 3 | Session notes; HTML sanitized server-side |
| Backend | Express 5, TypeScript (tsx in dev, esbuild bundle for prod) | Small, explicit, async error handling |
| Validation | zod | One schema per request body/query; consistent 400s |
| ORM / DB | Prisma 6 + PostgreSQL | Typed queries, migrations, transactions, constraints |
| Logging | pino / pino-http | Structured JSON logs with request IDs |
| Security | helmet (CSP), express-rate-limit, scrypt, AES-256-GCM, sanitize-html, file-type | Defense in depth |
| Tests | Vitest + Supertest (API), Playwright (E2E) | Real database in both |

## 3. Backend structure (`apps/server/src`)

```
index.ts             boot: wait for DB → first-run bootstrap → listen → periodic cleanup
app.ts               middleware chain, router mounting, OpenAPI/Swagger, SPA hosting
config.ts            zod-validated environment (fails fast on invalid config)
middleware/
  auth.ts            cookie session or Bearer token → req.user; CSRF header check
  access.ts          loadProject (membership → 404 if none), requireRole(min role)
  error.ts           AppError/ZodError/Prisma errors → { error: { code, message, details } }
modules/             one router per bounded context
  auth, global (my-work, search, overview, notifications), projects (+ config collections),
  templates, charters, sessions, findings, issues, requirements, comments, attachments,
  testCases, testRuns, automation, reports, ai, integrations (+ API tokens), admin
lib/
  sessionService     timer math, transitions, log entries
  customFields       per-entity field definitions → validated JSON values
  similarity         token/trigram similarity for duplicate suggestions
  storage            storage driver (local disk; S3-compatible is a planned driver)
  webhooks           HMAC-signed delivery + delivery log
  audit / notify     audit events, in-app notifications, optional SMTP email
  crypto / passwords AES-256-GCM secrets at rest, scrypt password hashes
  csv                RFC 4180 CSV with formula-injection neutralization
  bootstrap          first-run owner provisioning from BOOTSTRAP_ADMIN_* env
integrations/parsers JUnit XML + Playwright JSON → normalized results; flaky heuristic
ai/                  provider abstraction (none | openai-compatible | mock), heuristics catalog
openapi.yaml         API contract, served at /api/docs
```

### Request pipeline

```
helmet → pino-http → cookie/json/text parsers → rate limit (/api)
→ public: /api/health, /api/docs, /api/openapi.json
→ authenticate (cookie session | Bearer token; CSRF header on cookie mutations)
→ /api/auth → requireAuth → /api/admin (org admin) | /api/tokens | global routers
→ /api/projects/:projectId/* → loadProject (membership or org admin; token project scope)
   → requireRole('VIEWER'|'TESTER'|'LEAD'|'ADMIN') per route → handler
→ notFound → errorHandler
```

### Key design decisions

1. **Authorization is server-side and project-scoped.**
   - Every nested query includes `projectId: req.project.id`, so IDs from another project resolve to 404.
   - Viewers are read-only plus comments.
   - Session content can only be edited by its tester or a lead, and is locked once in review or approved.
   - The UI hides actions the user cannot perform, but the API never relies on that.
2. **The session timer is server-authoritative.**
   - A session stores `elapsedSeconds` (accumulated) and `lastResumedAt`. Live elapsed time = `elapsedSeconds + (now − lastResumedAt)` while running.
   - Pause and finish fold the running interval into `elapsedSeconds` inside a transaction, with a status guard (`updateMany where status = expected`) so two concurrent transitions cannot double-count.
   - Every log entry and finding stores `sessionElapsedSeconds`, the session time at which it was captured.
3. **Exploration is separate from defects.**
   - Findings have configurable classifications. `isDefect` marks which ones count as defects, so an observation is never counted as a bug.
   - Converting a finding to an issue creates an `Issue` linked back to its source finding. The original finding, session, and timeline stay unchanged.
   - Duplicate handling is advisory: `/findings/similar` only suggests, and marking a finding as a duplicate requires an explicit user action and target.
4. **Configuration over hardcoding.** Each project has its own data, copied from defaults when the project is created:
   - finding classifications;
   - manual and automation result statuses (category + aliases);
   - custom field definitions (per entity type);
   - environments, tags, milestones;
   - the review workflow setting (`requireReview`).
5. **Consistency.** Multi-row operations run in `prisma.$transaction`. Examples:
   - charter duplicate;
   - session launch and number allocation;
   - finding → issue conversion;
   - automation ingestion and counters;
   - test run creation;
   - bulk updates.

   Per-project sequential numbers come from counters on `Project`, incremented inside the same transaction. Unique constraints such as `(projectId, number)` back them up.
6. **Notes autosave with recovery.**
   - The workbench debounces note saves (about 1 s) and also writes a local draft copy to `localStorage`. This copy is for recovery only; the database remains the source of truth.
   - On load, the draft is offered back only if it is newer than, and different from, the server copy.
   - Save failures are classified as transient (retried every 5 s) or rejected (4xx; kept locally and reported to the user).
7. **Attachments.**
   - Uploads go through `multer` with a size limit and `file-type` content sniffing against an allow-list (PNG, JPEG, GIF, WebP, PDF, MP4, WebM, ZIP, and `.txt .log .md .json .har .csv .xml` text files). SVG and HTML are rejected.
   - Files are stored under random keys outside the web root.
   - Downloads go through an authorized endpoint with `Content-Disposition` and `nosniff`.
8. **AI is optional and draft-only.**
   - `ai/provider.ts` defines task schemas (charter draft, test ideas, session summary, defect report, test cases, release risk).
   - The provider can be swapped: `none`, any OpenAI-compatible endpoint, or a deterministic `mock` used by tests.
   - Output is validated with zod and returned to the UI for editing; nothing is persisted until the user saves.
   - API keys stay server-side.
   - Charter linting, heuristic recommendations, and duplicate detection are deterministic and work without AI.

## 4. Data model

The full schema is in `apps/server/prisma/schema.prisma` (49 models, 23 enums). The initial migration is in `prisma/migrations/`.

```
Organization ─┬─ OrgMember ── User ── AuthSession / ApiToken / Notification
              ├─ Team ── TeamMember
              ├─ CharterTemplate (system + org)           AuditEvent (org/project scoped)
              └─ Project ─┬─ ProjectMember (role)
                          ├─ Milestone · Environment · Tag · CustomFieldDefinition
                          ├─ FindingClassification · TestResultStatus · CharterTemplate (project)
                          ├─ Charter ─┬─ CharterAssignee · CharterTag · RequirementCharter
                          │           └─ ExploratorySession ─┬─ SessionLogEntry (timeline)
                          │                                  ├─ SessionTag · SessionRelation
                          │                                  └─ Finding ─┬─ FindingTag
                          │                                              └─ Issue (converted / linked)
                          ├─ Requirement ── RequirementTestCase / RequirementCharter
                          ├─ TestFolder ── TestCase ─┬─ TestStep · TestCaseRevision · TestCaseTag
                          ├─ TestPlan ── TestRun ── TestRunItem ── TestResult
                          ├─ AutomationSource ── AutomationRun ── AutomationResult ── AutomationTest
                          ├─ Comment ── Mention        Attachment (polymorphic owner columns)
                          └─ Integration ── WebhookDelivery
```

- **Foreign keys and deletion policies:**
  - Project-owned data cascades from `Project`.
  - Findings keep their `sessionId` (a cascade from the session) and `charterId`.
  - Optional references (milestone, requirement, owner, issue) use `SetNull`, so deleting a milestone never deletes findings.
  - Audit events keep `actorId` with `SetNull`.
- **Indexes** cover every list filter, for example:
  - `(projectId, status)`;
  - `(projectId, createdAt)`;
  - `(testerId, status)`;
  - unique `(projectId, number)` for display keys;
  - many-to-many join tables with composite primary keys.
- **Timestamps:**
  - `createdAt` and `updatedAt` everywhere.
  - Sessions also have `startedAt`, `endedAt`, `lastResumedAt`, and `notesUpdatedAt`.
- **History:**
  - Charter history and test case revisions are stored explicitly.
  - Every mutation writes an `AuditEvent` with a JSON `changes` diff.

## 5. Frontend structure (`apps/web/src`)

```
main.tsx / App.tsx   providers (Mantine, Query, Router, Auth), lazy routes
lib/api.ts           fetch wrapper (CSRF header, JSON errors → ApiError), query keys
lib/auth.tsx         current user, login/logout, route guard
lib/project.tsx      current project context + role helpers (canEdit, canLead…)
components/          Layout (navigation, project switcher, spotlight search, theme toggle),
                     ui (status/severity/priority badges, avatars, empty states), RichText,
                     FindingForm, LaunchSessionModal, Attachments, Comments, CustomFields,
                     ListFilters (URL-synced filters + pagination), ExportMenu, History …
pages/               Overview, My Work, Projects, project dashboard; exploratory/* (charters,
                     templates, sessions, workbench, findings, issues); testing/* (test cases,
                     runs, requirements); automation/*; admin/* (reports, activity,
                     integrations, project settings, organization admin)
theme.ts             Explorix design tokens (brand palette, radius, typography, status colors); see docs/DESIGN.md
styles.css           Semantic light/dark tokens (--ex-*) and shared layout classes (.ex-*)
```

The **Workbench** (`pages/exploratory/Workbench.tsx`) is the signature screen. It contains:

- the mission/scope panel;
- a live timer with start, pause, resume, and finish;
- rich-text notes with autosave;
- a quick-log bar;
- a timestamped activity timeline;
- finding capture with keyboard shortcuts (`F` or `Mod+Shift+F` for a finding, `N` for notes, `L` for the log, `P` to pause or resume, plus per-classification shortcuts in the finding form), paste or drop screenshots, and duplicate suggestions;
- a debrief modal with SBTM time breakdown;
- review controls.

## 6. Security summary

| Threat | Mitigation |
| --- | --- |
| Credential theft | scrypt hashing (N=16384), login rate limit, temporary lockout after repeated failures, httpOnly cookies, `Secure` cookies in production |
| Session hijack | Random 256-bit session IDs stored hashed (SHA-256); server-side expiry; logout deletes the session |
| CSRF | `SameSite=Lax` + mandatory `X-Requested-With: explorix` header on cookie-authenticated mutations |
| XSS | React escaping; server-side sanitize-html allow-list for rich text; CSP `script-src 'self'`; attachments served as downloads with `nosniff`, SVG/HTML uploads rejected |
| IDOR / privilege escalation | Project scoping on every query; role checks per route; 404 for inaccessible resources; token project scoping |
| Injection | Prisma parameterized queries; zod validation; CSV formula neutralization |
| SSRF | Webhook/GitHub URLs validated; private/loopback targets blocked in production; no redirects followed |
| Secrets | Integration secrets AES-256-GCM encrypted with `ENCRYPTION_KEY`; never returned by the API; AI key server-side only; `.env` git-ignored |
| Abuse | Global and per-route rate limits; upload size/type limits; request body limits |

## 7. Testing strategy

- **API (Vitest + Supertest)** in `apps/server/test`.
  - Runs against a real PostgreSQL database (`<db>_test`), reset and seeded once per run.
  - Covers:
    - auth;
    - authorization/IDOR;
    - the full charter → session → finding → issue workflow;
    - timer math;
    - reports vs direct DB counts;
    - exports;
    - automation parsers and ingestion;
    - AI draft-only behavior;
    - webhook delivery/signing and GitHub push (stubbed GitHub endpoint);
    - first-run bootstrap.
- **E2E (Playwright)** in `e2e/`.
  - Starts an isolated API on :4100 with a freshly migrated and seeded `<db>_e2e` database, plus Vite on :5174.
  - Drives the real UI: sign-in, access control, the full workbench lifecycle (launch, notes persistence across reloads, findings with evidence, pause/resume, finish, review), charter create/edit/duplicate/archive, session bulk assignment, findings exports vs API, dashboard KPIs vs persisted records, and a smoke pass over every screen that fails on console errors, uncaught exceptions or 5xx responses.

## 8. Desktop architecture (2.0)

Explorix Desktop reuses the server and web app unchanged. The Electron main process hosts them; it does not reimplement them.

```
Explorix.exe (Electron main process)
├─ boot.ts      settings → start embedded PostgreSQL (pg.ts, 127.0.0.1, random port, DPAPI-stored password)
│               → safety backup + Prisma migrations (migrate.ts) → import server bundle in-process
├─ server       resources/server/server.mjs: the same Express app, listening on 127.0.0.1:<random>,
│               DESKTOP=true: loopback Host check, desktop PDF renderer, data in %APPDATA%\Explorix
├─ main.ts      BrowserWindow → http://127.0.0.1:<port> (the built web app), menu, single-instance lock,
│               navigation/permission guards, IPC handlers, graceful shutdown (server → PostgreSQL)
├─ preload.ts   contextBridge: window.explorixDesktop (15 named functions plus a navigation listener)
├─ contract.ts  zod schema per IPC channel; trusted-sender (origin) check
├─ export.ts    Save As / overwrite confirmation / atomic copy of report job outputs to the user's chosen path
├─ pdf.ts       printToPDF in a hidden, sandboxed, offline window (the server's PDF renderer hook)
└─ settings.ts  settings.json (atomic writes, corrupt-file quarantine), DPAPI secrets via safeStorage
```

Key decisions:
- **In-process server.** The web UI detects the desktop through the preload bridge and keeps using the REST API. The UI and business logic are shared, and the browser and desktop builds are tested by the same server and web suites.
- **Embedded PostgreSQL instead of SQLite.** The Prisma schema depends on PostgreSQL features (enums, JSON columns, case-insensitive search, transactional DDL) and was already exercised by 70+ tests. Shipping the PostgreSQL 18 binaries (about 104 MB) avoided a risky dual-database migration. The cluster lives in `%APPDATA%\Explorix\data\pg`.
- **Data version separate from the app version.** The latest applied migration is the data version. A newer data version than the app knows is refused with a recovery screen instead of corrupting data.
- **The renderer never handles paths.** Reports are generated into a server work directory as *jobs*. The renderer asks the main process to save a job output by ID, and the main process shows the native dialog and copies the file.
- **Packaging.** esbuild bundles main, preload and server. `scripts/build.mjs --stage` stages the runtime dependency closure and fails on unresolved imports. electron-builder builds NSIS and portable targets, and `afterPack` copies the server `node_modules`. See [DESKTOP.md](DESKTOP.md#building-from-source).

### Reporting engine (`apps/server/src/reporting`)

`model.ts` builds one structured `ReportModel` from the database for a scope (finding, findings, session, charter, milestone or project) and options (template sections, filters, evidence selection). The renderers consume only that model:
- `docx.ts` uses the `docx` library;
- `markdown.ts`;
- `html.ts` (also the PDF source);
- `pdf.ts` uses a pluggable renderer: Electron `printToPDF` on desktop, Playwright Chromium on a server (`PDF_RENDERER=playwright`).

`assets.ts` prepares report-sized image copies, thumbnails and frames, and copies originals for folder outputs. `jobs.ts` runs generation asynchronously with progress, cancellation (AbortSignal), a free-space check, packages (folder or ZIP with `manifest.json` and README) and a 2-hour job TTL. See [REPORTING.md](REPORTING.md).
