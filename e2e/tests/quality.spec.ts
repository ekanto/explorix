import { expect, test } from '@playwright/test';
import { api, login, projectId, USERS } from './helpers';

test.describe('Sessions, exports and metrics', () => {
  test('lead bulk-assigns sessions to a tester from the session repository', async ({ page }) => {
    await login(page, USERS.lead);
    const pid = await projectId(page, 'SHOP');
    const client = api(page.request);
    const { members } = await client.get(`/projects/${pid}`);
    const sam = members.find((m: { user: { email: string } }) => m.user.email === USERS.sam).user;
    const { sessions } = await client.get(`/projects/${pid}/sessions?view=all&pageSize=50`);
    const targets = sessions.filter((s: { tester: { id: string } | null }) => s.tester?.id !== sam.id).slice(0, 2);
    expect(targets.length).toBe(2);

    await page.goto(`/projects/${pid}/sessions?view=all&pageSize=50`);
    for (const s of targets) await page.getByRole('checkbox', { name: `Select ${s.key}`, exact: true }).check();
    await page.getByRole('button', { name: 'Assign tester' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Assign' });
    await dialog.getByRole('combobox', { name: 'Tester' }).click();
    await page.getByRole('option', { name: sam.name }).click();
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();

    for (const s of targets) {
      const { session } = await client.get(`/projects/${pid}/sessions/${s.id}`);
      expect(session.tester?.id).toBe(sam.id);
    }
    // Sam sees them under "Assigned to me" and got a notification.
    await page.context().clearCookies();
    await login(page, USERS.sam);
    const mine = await api(page.request).get(`/projects/${pid}/sessions?testerId=me&view=all&pageSize=200`);
    for (const s of targets) expect(mine.sessions.map((x: { id: string }) => x.id)).toContain(s.id);
    const { items } = await api(page.request).get('/notifications');
    expect(items.some((n: { type: string; title: string }) => n.type === 'ASSIGNMENT' && /2 exploratory session/.test(n.title))).toBeTruthy();
  });

  test('findings CSV and JSON exports match the filtered list', async ({ page }) => {
    await login(page, USERS.lead);
    const pid = await projectId(page, 'SHOP');
    const client = api(page.request);
    const list = await client.get(`/projects/${pid}/findings?open=true&pageSize=200`);
    expect(list.total).toBeGreaterThan(0);

    const json = await client.get(`/projects/${pid}/findings/export?format=json&open=true`);
    expect(json.count).toBe(list.total);
    expect(json.findings.map((f: { key: string }) => f.key).sort()).toEqual(list.findings.map((f: { key: string }) => f.key).sort());
    for (const f of json.findings) expect(['NEW', 'TRIAGED']).toContain(f.status);

    const res = await page.request.get(`/api/projects/${pid}/findings/export?format=csv&open=true`, { headers: { 'X-Requested-With': 'explorix' } });
    expect(res.headers()['content-type']).toContain('text/csv');
    const csv = await res.text();
    expect(csv.split(/\r?\n/)[0].replace(/^\uFEFF/, '')).toMatch(/^Key,Title,Classification,Severity,Priority,Status/);
    for (const f of list.findings) expect(csv).toContain(`${f.key},`);

    // The UI export button downloads the same file.
    await page.goto(`/projects/${pid}/findings?open=true`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click().then(() => page.getByRole('menuitem', { name: /CSV/ }).click())]);
    expect(download.suggestedFilename()).toBe('SHOP-findings.csv');
  });

  test('dashboard metrics change exactly with persisted records', async ({ page }) => {
    await login(page, USERS.lead);
    const pid = await projectId(page, 'SHOP');
    const client = api(page.request);
    const before = (await client.get(`/projects/${pid}/reports/dashboard`)).kpis;

    const { charter } = await client.post(`/projects/${pid}/charters`, { title: `Metrics probe ${Date.now()}`, mission: 'Explore metrics using a probe to discover counting errors', status: 'READY' });
    await client.post(`/projects/${pid}/findings`, { title: 'Probe finding', classificationKey: 'confirmed_defect', severity: 'MAJOR', charterId: charter.id });
    await client.post(`/projects/${pid}/findings`, { title: 'Probe question', classificationKey: 'question', charterId: charter.id });

    const after = (await client.get(`/projects/${pid}/reports/dashboard`)).kpis;
    expect(after.totalCharters).toBe(before.totalCharters + 1);
    expect(after.totalFindings).toBe(before.totalFindings + 2);
    expect(after.unresolvedFindings).toBe(before.unresolvedFindings + 2);
    expect(after.confirmedDefects).toBe(before.confirmedDefects + 1);

    await page.goto(`/projects/${pid}`);
    const card = (label: string) => page.getByRole('main').getByText(label, { exact: true }).locator('xpath=ancestor::div[2]');
    await expect(card('Charters')).toContainText(String(after.totalCharters));
    await expect(card('Unresolved findings')).toContainText(String(after.unresolvedFindings));
    await expect(card('Confirmed defects')).toContainText(String(after.confirmedDefects));
  });
});
