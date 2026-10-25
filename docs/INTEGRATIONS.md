# Explorix integrations

Each integration below is marked with its real status:

- **Available:** implemented and covered by automated tests or a manual check.
- **Planned:** not implemented. The API rejects planned providers with HTTP 501.

| Integration | Status | How |
| --- | --- | --- |
| JUnit XML import (Jest via `jest-junit`, pytest, Maven/Gradle Surefire, Cypress `junit` reporter, Selenium suites, PHPUnit, Go `go-junit-report`, …) | **Available** | `POST /api/projects/{id}/automation/import/junit` |
| Playwright JSON reporter | **Available** | `POST /api/projects/{id}/automation/import/playwright` |
| Native JSON / staged runs (any framework or custom reporter) | **Available** | `POST …/automation/runs`, `…/runs/{id}/results`, `…/runs/{id}/complete` |
| GitHub Actions, GitLab CI, Jenkins, any CI | **Available via REST + API token** | Recipes below. There are no dedicated marketplace plugins. |
| Outgoing webhooks (HMAC-signed) | **Available** | Project → Integrations |
| GitHub Issues | **Available (one-way push)** | Pushes an Explorix issue to a repository and stores the link. Status does not sync back. |
| Jira | Planned | Two-way issue sync |
| GitLab Issues | Planned | Issue push and sync |
| Slack / Microsoft Teams | Planned | Use webhooks and a relay in the meantime |
| Native Cypress/Selenium reporters, Jenkins plugin | Planned | Use the JUnit XML import instead |

## 1. API tokens

1. Sign in, then open **Profile → API tokens → New token**.
2. Restrict the token to one project if you can, and set an expiry.
3. Copy the secret (`exp_…`). It is shown only once; Explorix stores only its SHA-256 hash.
4. Store it as a CI secret, for example `EXPLORIX_TOKEN`. You also need the project ID, shown in **Project settings → General**.

The token acts as its creator. Ingestion requires the **Tester** role or higher in the project.

## 2. Uploading results

### JUnit XML

Send the raw XML as the request body. Run metadata goes in query parameters:

| Parameter | Description |
| --- | --- |
| `name` | Run name |
| `source` | Groups runs, e.g. `web-e2e` |
| `framework` | Test framework |
| `branch` | Branch name |
| `commitSha` | Commit SHA |
| `buildNumber` | CI build number |
| `ciProvider` | CI system name |
| `ciUrl` | Link to the CI job |
| `environment` | Test environment |
| `milestone` | Milestone name, or `milestoneId` |

```bash
curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/import/junit?source=api-tests&framework=jest&branch=$BRANCH&buildNumber=$BUILD&ciUrl=$JOB_URL" \
  -H "Authorization: Bearer $EXPLORIX_TOKEN" \
  -H "Content-Type: application/xml" \
  --data-binary @reports/junit.xml
```

How results are mapped:

- `<failure>` maps to `failed` and `<error>` maps to `error`. Both are FAILED-category statuses.
- `<skipped>` maps to `skipped`.
- Everything else maps to `passed`.
- Failure messages and stack traces are stored, along with `time` (converted to milliseconds), `classname` (stored as the suite), and `file`.

### Playwright JSON reporter

```ts
// playwright.config.ts
reporter: [['list'], ['json', { outputFile: 'results/playwright.json' }]],
```

```bash
curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/import/playwright?source=web-e2e&branch=$BRANCH&environment=staging" \
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" \
  --data-binary @results/playwright.json
```

The importer:

- walks nested suites;
- maps outcomes: `expected` → passed (or skipped), `unexpected` → failed, `flaky` → flaky (passed on retry), `skipped` → skipped;
- records the retry count (a test that passes after a retry is flagged as flaky);
- stores error messages and stacks;
- records attachment metadata: name, path, and content type. The files themselves are not uploaded.

### Native JSON and staged runs

Use staged runs for large or sharded suites. Create a run with `"status": "RUNNING"`, append batches of up to 20,000 results, then complete it:

```bash
RUN=$(curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/runs" \
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"RUNNING","source":"mobile-ui","framework":"appium","branch":"main"}' | jq -r .run.id)

curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/runs/$RUN/results" \
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" \
  -d '{"results":[{"name":"login works","suite":"auth","status":"passed","durationMs":1234},
                  {"name":"logout","suite":"auth","status":"failed","message":"timeout","stackTrace":"…","retries":1}]}'

curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/runs/$RUN/complete" \
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" -d '{}'
```

`status` strings are matched against the project's configured automation statuses, by key and then by alias. The aliases are editable under **Project settings → Result statuses**, so values such as `timedOut` or `broken` can be mapped. Unknown values become `error` (FAILED category), so problems are never hidden.

### Flaky-test indicator

For each test, Explorix looks at its last 10 completed results:

- a **flip** is a passed↔failed change between consecutive results;
- **passed on retry** counts results that passed with `retries > 0`.

A test is flagged **flaky** when it passed on retry at least once, or flipped two or more times. The score is `flips ÷ (results − 1)`. The indicator is only a heuristic, and the UI presents it as one.

## 3. CI recipes

**GitHub Actions**

```yaml
- name: Upload results to Explorix
  if: always()
  run: |
    curl -sf -X POST "${{ vars.EXPLORIX_URL }}/api/projects/${{ vars.EXPLORIX_PROJECT }}/automation/import/playwright?source=web-e2e&branch=${GITHUB_REF_NAME}&commitSha=${GITHUB_SHA}&buildNumber=${GITHUB_RUN_NUMBER}&ciProvider=github&ciUrl=${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" \
      -H "Authorization: Bearer ${{ secrets.EXPLORIX_TOKEN }}" -H "Content-Type: application/json" \
      --data-binary @results/playwright.json
```

**GitLab CI**

```yaml
explorix:
  stage: .post
  when: always
  script:
    - >
      curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/import/junit?source=unit&branch=$CI_COMMIT_REF_NAME&commitSha=$CI_COMMIT_SHA&buildNumber=$CI_PIPELINE_IID&ciProvider=gitlab&ciUrl=$CI_JOB_URL"
      -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/xml" --data-binary @junit.xml
```

**Jenkins (declarative)**

```groovy
post {
  always {
    withCredentials([string(credentialsId: 'explorix-token', variable: 'EXPLORIX_TOKEN')]) {
      sh '''curl -sf -X POST "$EXPLORIX_URL/api/projects/$EXPLORIX_PROJECT/automation/import/junit?source=regression&branch=$BRANCH_NAME&buildNumber=$BUILD_NUMBER&ciProvider=jenkins&ciUrl=$BUILD_URL" \
            -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/xml" --data-binary @target/surefire-reports/TEST-all.xml'''
    }
  }
}
```

Merge multiple JUnit files first (for example with `junit-merge`), or upload each file as its own run.

## 4. Outgoing webhooks

Configure them under **Project → Integrations → Add webhook**. Project admins only.

Events:

| Event | Fired when |
| --- | --- |
| `session.started` | A session starts |
| `session.completed` | A session is finished |
| `session.reviewed` | A session is approved or changes are requested |
| `finding.created` | A finding is logged |
| `finding.converted` | A finding is converted to an issue |
| `issue.created` | An issue is created |
| `issue.updated` | An issue changes |
| `test_run.closed` | A test run is closed |
| `automation_run.completed` | An automation run completes |

Every delivery is a `POST` with this JSON body:

```json
{ "event": "finding.created", "deliveredAt": "2026-01-01T10:00:00.000Z", "projectId": "…", "data": { … } }
```

It carries these headers:

| Header | Value |
| --- | --- |
| `X-Explorix-Event` | Event name |
| `X-Explorix-Timestamp` | Unix seconds |
| `X-Explorix-Signature` | `sha256=` + hex HMAC-SHA256 of `"<timestamp>.<raw body>"`, sent when a secret is set |

Verify the signature like this (Node):

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.get('x-explorix-signature')));
// Also reject timestamps older than ~5 minutes to prevent replay.
```

Delivery behavior:

- Requests time out after 10 seconds and do not follow redirects.
- Each attempt is recorded under **Deliveries**, with a **Send test** button.
- There are no automatic retries yet; this is on the roadmap.
- In production, webhook and GitHub API URLs that resolve to private or loopback addresses are rejected (SSRF protection) unless `ALLOW_PRIVATE_WEBHOOKS=true`.

Secrets and tokens are encrypted at rest with AES-256-GCM using `ENCRYPTION_KEY`, and are never returned by the API.

## 5. GitHub Issues (one-way)

1. Create a fine-grained personal access token with **Issues: read & write** on the target repository.
2. Go to **Project → Integrations → Add GitHub Issues** and enter `owner/repo`, the token, and optional labels. A GitHub Enterprise API URL is also supported.
3. Use **Test connection** to check that the repository is reachable.
4. On an internal issue, click **Push to GitHub**. Explorix creates the GitHub issue with:
   - the description, reproduction steps, and expected/actual behavior;
   - a back-link to Explorix.

   It stores `owner/repo#n` and the URL on the issue.

Limitations:

- Status, comment, and assignee changes made on GitHub do not sync back.
- Pushing an issue that is already linked is rejected.

## 6. Planned integrations: design notes

The `Integration` table already stores a provider, an encrypted secret, JSON config, an event subscription, and the last status. `Issue.externalProvider`, `externalKey`, and `externalUrl` are provider-agnostic.

A Jira or GitLab provider would need to:

1. implement the same `push-issue` contract;
2. add an inbound webhook endpoint to sync status changes, verified by provider signature;
3. be added to the catalog with the status `available`.

Until then, the API returns `501 not_implemented` for these providers, and the UI labels them **Planned**.
