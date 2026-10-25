import { expect, test } from '@playwright/test';
import { api, login, logout, projectId, USERS } from './helpers';

test.describe('Authentication & authorization', () => {
  test('rejects invalid credentials with a visible error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(USERS.tester);
    await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects anonymous users to login and back to the requested page', async ({ page }) => {
    await page.goto('/my-work');
    await expect(page).toHaveURL(/\/login\?next=%2Fmy-work/);
    await page.getByLabel('Email').fill(USERS.tester);
    await page.getByRole('textbox', { name: 'Password' }).fill('Explorix-demo-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
  });

  test('users only see and access projects they are members of', async ({ page }) => {
    await login(page, USERS.lead);
    const bankId = await projectId(page, 'BANK');
    await logout(page);

    // Sam is a SHOP tester but not a BANK member.
    await login(page, USERS.sam);
    const { projects } = await api(page.request).get('/projects');
    expect(projects.map((p: { key: string }) => p.key)).toEqual(['SHOP']);

    const direct = await page.request.get(`/api/projects/${bankId}/charters`);
    expect(direct.status()).toBe(404);

    await page.goto(`/projects/${bankId}`);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await expect(page.getByText('Mobile Banking API')).toHaveCount(0);
  });

  test('mutations without the CSRF header and anonymous API calls are refused', async ({ page }) => {
    const anon = await page.request.get('/api/projects');
    expect(anon.status()).toBe(401);

    await login(page, USERS.tester);
    const shopId = await projectId(page, 'SHOP');
    const noCsrf = await page.request.post(`/api/projects/${shopId}/charters`, { data: { title: 'x', mission: 'y' } });
    expect(noCsrf.status()).toBe(403);
  });

  test('viewers get a read-only workbench', async ({ page }) => {
    await login(page, USERS.viewer);
    const shopId = await projectId(page, 'SHOP');
    const { sessions } = await api(page.request).get(`/projects/${shopId}/sessions?view=all&status=IN_PROGRESS`);
    expect(sessions.length).toBeGreaterThan(0);
    await page.goto(`/projects/${shopId}/sessions/${sessions[0].id}`);
    await expect(page.getByText('Session notes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finding', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveCount(0);
    await expect(page.getByPlaceholder(/Quick observation/)).toHaveCount(0);

    const forbidden = await page.request.post(`/api/projects/${shopId}/sessions/${sessions[0].id}/log`, {
      headers: { 'X-Requested-With': 'explorix' },
      data: { content: 'should not be allowed' },
    });
    expect(forbidden.status()).toBe(403);
  });
});
