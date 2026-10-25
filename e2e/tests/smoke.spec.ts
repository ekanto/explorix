import { expect, test, type Page } from '@playwright/test';
import { api, login, projectId, USERS } from './helpers';

/**
 * Smoke test: every screen renders real data without uncaught exceptions, console errors or failed API calls.
 * Detail routes use the first record of each list so the test follows whatever the seed contains.
 */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  return problems;
}

async function visit(page: Page, problems: string[], path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('main'), path).toBeVisible();
  await expect(page.getByRole('main').getByText('Something went wrong'), path).toHaveCount(0);
  await expect(page.getByRole('main').getByText(/page not found/i), path).toHaveCount(0);
  expect(problems, path).toEqual([]);
}

test('every project screen renders without errors', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, USERS.lead);
  const pid = await projectId(page, 'SHOP');
  const c = api(page.request);
  const base = `/projects/${pid}`;
  const first = async (url: string, key: string) => {
    const r = await c.get(`${base}${url}`);
    expect(r[key]?.length, `${url} has data`).toBeGreaterThan(0);
    return r[key][0].id as string;
  };
  const ids = {
    charter: await first('/charters', 'charters'),
    session: await first('/sessions?view=all', 'sessions'),
    finding: await first('/findings', 'findings'),
    issue: await first('/issues', 'issues'),
    testCase: await first('/test-cases', 'testCases'),
    testRun: await first('/test-runs', 'runs'),
    requirement: await first('/requirements', 'requirements'),
    autoRun: await first('/automation/runs', 'runs'),
    autoTest: await first('/automation/tests', 'tests'),
  };

  const problems = watch(page);
  const paths = [
    '/',
    '/my-work',
    '/projects',
    '/notifications',
    '/profile',
    base,
    `${base}/charters`,
    `${base}/charters/new`,
    `${base}/charters/${ids.charter}`,
    `${base}/charters/${ids.charter}/edit`,
    `${base}/templates`,
    `${base}/sessions`,
    `${base}/sessions/${ids.session}`,
    `${base}/findings`,
    `${base}/findings/${ids.finding}`,
    `${base}/issues`,
    `${base}/issues/${ids.issue}`,
    `${base}/test-cases`,
    `${base}/test-cases/${ids.testCase}`,
    `${base}/test-runs`,
    `${base}/test-runs/${ids.testRun}`,
    `${base}/requirements`,
    `${base}/requirements/${ids.requirement}`,
    `${base}/automation`,
    `${base}/automation/runs/${ids.autoRun}`,
    `${base}/automation/compare`,
    `${base}/automation/tests/${ids.autoTest}`,
    `${base}/reports`,
    `${base}/activity`,
    `${base}/integrations`,
    `${base}/settings`,
  ];
  for (const path of paths) await visit(page, problems, path);
});

test('administration renders for an org admin and is denied to a tester', async ({ page }) => {
  await login(page, USERS.admin);
  const problems = watch(page);
  await visit(page, problems, '/admin');
  await expect(page.getByRole('tab').first()).toBeVisible();

  await page.context().clearCookies();
  await login(page, USERS.tester);
  const res = await page.request.get('/api/admin/users', { headers: { 'X-Requested-With': 'explorix' } });
  expect(res.status()).toBe(403);
});
