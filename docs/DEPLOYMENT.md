# Deploying and operating Explorix

## Requirements

- Node.js 20 or newer (developed on Node 26) and npm 10 or newer.
- PostgreSQL 14 or newer. Development can use the bundled embedded PostgreSQL instead.
- A persistent directory or volume for attachments (`STORAGE_DIR`).

## Configuration

All settings are environment variables, validated at startup by `apps/server/src/config.ts`; the server refuses to start with invalid values. Copy `apps/server/.env.example` to `apps/server/.env`, or run `npm run setup`, which also generates `ENCRYPTION_KEY`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | `postgresql://user:pass@host:5432/explorix` |
| `ENCRYPTION_KEY` | prod | — | 32 random bytes, base64. Encrypts integration secrets. **Back it up**; secrets cannot be decrypted without it. |
| `APP_URL` | yes | `http://localhost:5173` | Public URL. Used in links and emails. |
| `PORT` | | `4000` | |
| `NODE_ENV` | | `development` | Use `production` in deployments. Enables secure cookies and the SSRF guard. |
| `COOKIE_SECURE` | | prod: `true` | Set `false` only when serving plain HTTP for local testing. |
| `SESSION_TTL_HOURS` | | `72` | Login session lifetime. |
| `STORAGE_DIR` | | `./.data/uploads` | Attachment directory. Must be persistent. |
| `MAX_UPLOAD_MB` | | `15` | Per-file limit. |
| `USE_EMBEDDED_PG` | | `true` | Development only. Set `false` when using your own PostgreSQL. |
| `AI_PROVIDER` | | `none` | `none` or `openai` (any OpenAI-compatible API). |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | | | Server-side only; never sent to the browser. |
| `SMTP_URL`, `EMAIL_FROM` | | | Optional email notifications. In-app notifications always work. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ORG_NAME` | first run | | Creates the organization and its owner if the database has no organization. Ignored afterwards. Remove the password once the owner has signed in. |
| `LOG_LEVEL` | | `info` | pino level. |
| `RATE_LIMIT_DISABLED` | | | `true` only for automated tests. |
| `ALLOW_PRIVATE_WEBHOOKS` | | | `true` allows webhook/GitHub URLs on private networks in production. |
| `WEB_DIST` | | `apps/web/dist` | Location of the built SPA served by the API. |

## Option A — Node.js on a server or VM

```bash
git clone <repo> explorix && cd explorix
npm ci
cp apps/server/.env.example apps/server/.env    # edit: DATABASE_URL, ENCRYPTION_KEY, APP_URL, NODE_ENV=production, USE_EMBEDDED_PG=false
npm run build                                   # builds the web SPA and the API bundle
npm run db:migrate -w @explorix/server          # prisma migrate deploy (safe and idempotent)
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='a-long-passphrase-1' npm start
```

Run the server under a process manager (systemd, pm2, or similar) behind a TLS-terminating reverse proxy such as nginx, Caddy, or a cloud load balancer. Forward `/` to `:4000`. The API and SPA share one origin.

Example nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 25m;
}
```

`trust proxy` is set to loopback. If the proxy runs on a different host, adjust it in `app.ts` so rate limiting sees real client IPs.

## Option B — Docker Compose

> **Not verified in this environment.** The Dockerfile and `docker-compose.yml` were written without access to a Docker engine. Treat them as a starting point and test before relying on them.

```bash
export ENCRYPTION_KEY=$(openssl rand -base64 32)
export BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='a-long-passphrase-1'
docker compose up --build -d
# optional demo data instead of an empty organization (run before the first start):
docker compose --profile demo run --rm seed
```

The app container:

- runs `prisma migrate deploy` on start;
- serves the app on `:4000`;
- stores attachments in the `uploads` volume;
- exposes `/api/health` for health checks.

## Demo data

`npm run db:seed -w @explorix/server` creates a realistic demo organization:

- 2 projects (ShopFront Web and Mobile Banking API);
- 6 users;
- charters, sessions, findings, issues, test cases, runs, automation history, and requirements.

The seed refuses to run when an organization already exists, so it never overwrites real data. `npm run db:reset` drops and recreates the development database and **deletes all data**.

## Backup and recovery

| What | How |
| --- | --- |
| Database | `pg_dump -Fc "$DATABASE_URL" > explorix-$(date +%F).dump`. Restore with `pg_restore -d <empty db> --no-owner explorix-YYYY-MM-DD.dump`, then start the app; migrations are idempotent. |
| Attachments | Copy or snapshot `STORAGE_DIR`. Files are named by random keys referenced from the `Attachment` table, so back up the database and the files together. |
| Encryption key | Store `ENCRYPTION_KEY` in your secret manager. If it is lost, re-enter integration secrets (webhook secrets, GitHub tokens). |
| Logical export | **Administration → Data export** (`GET /api/admin/export`, org admins) downloads a JSON export of the organization's projects and records. It is meant for portability and audits; it does not replace `pg_dump` and has no import counterpart yet. |

Test restores regularly. A minimal drill:

1. Restore into a scratch database.
2. Start Explorix against it with a copy of the files.
3. Sign in and open a session that has attachments.

## Upgrades

1. Back up the database and files.
2. Deploy the new code and run `npm ci && npm run build`.
3. Run `npm run db:migrate -w @explorix/server`.
4. Restart.

Migrations live in `apps/server/prisma/migrations` and are applied in order.

## Observability

- Logs are structured JSON (pino) on stdout and include request method, URL, status, and duration. Ship them with your log collector.
- `GET /api/health` returns 200 when the process is up.
- The audit log is under **Administration → Audit** and **Project → Activity**.
