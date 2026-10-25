import { expect, test } from '@playwright/test';
import { api, login, projectId, USERS } from './helpers';

test.describe('Charter library', () => {
  test.describe.configure({ mode: 'serial' });
  const title = `E2E charter ${Date.now()}`;
  let charterPath = '';

  test('lead creates a charter in natural language and it persists', async ({ page }) => {
    await login(page, USERS.lead);
    const pid = await projectId(page, 'SHOP');
    await page.goto(`/projects/${pid}/charters/new`);
    await page.getByRole('textbox', { name: /^Title/ }).fill(title);
    await page.getByRole('textbox', { name: /^Mission/ }).fill('Explore gift card redemption using partial balances and refunds to discover rounding and balance errors');
    await page.getByRole('textbox', { name: 'Target / feature under test' }).fill('Checkout › Gift cards');
    await page.getByRole('button', { name: 'Save as ready' }).click();

    await expect(page).toHaveURL(/\/charters\/[a-z0-9]+$/);
    charterPath = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Checkout › Gift cards').first()).toBeVisible();

    const { charter } = await api(page.request).get(`/projects/${pid}/charters/${charterPath.split('/').pop()}`);
    expect(charter).toMatchObject({ title, status: 'READY', target: 'Checkout › Gift cards' });
  });

  test('editing records history', async ({ page }) => {
    await login(page, USERS.lead, charterPath);
    await page.getByRole('link', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: /^Title/ }).fill(`${title} v2`);
    await page.getByRole('button', { name: 'Save as ready' }).click();
    await expect(page.getByRole('heading', { name: `${title} v2` })).toBeVisible();

    const pid = charterPath.split('/')[2];
    const id = charterPath.split('/').pop();
    const history = await api(page.request).get(`/projects/${pid}/charters/${id}/history`);
    expect(JSON.stringify(history)).toContain(`${title} v2`);
  });

  test('duplicate creates an independent draft copy', async ({ page }) => {
    await login(page, USERS.lead, charterPath);
    await page.getByRole('button', { name: 'More charter actions' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/\/charters\/[a-z0-9]+\/edit$/);
    const copyId = page.url().split('/').at(-2);
    expect(copyId).not.toBe(charterPath.split('/').pop());

    const pid = charterPath.split('/')[2];
    const { charter } = await api(page.request).get(`/projects/${pid}/charters/${copyId}`);
    expect(charter).toMatchObject({ title: `${title} v2 (copy)`, status: 'DRAFT' });
    expect(charter.sessions ?? []).toHaveLength(0);
  });

  test('archive hides the charter from the library; unarchive restores it', async ({ page }) => {
    await login(page, USERS.lead, charterPath);
    await page.getByRole('button', { name: 'More charter actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('Archived', { exact: true }).first()).toBeVisible();

    const pid = charterPath.split('/')[2];
    await page.goto(`/projects/${pid}/charters?q=${encodeURIComponent(`${title} v2`)}`);
    // Default library view (Draft + Ready) shows only the copy, not the archived original.
    await expect(page.getByRole('link', { name: `${title} v2 (copy)` })).toBeVisible();
    await expect(page.getByRole('link', { name: `${title} v2`, exact: true })).toHaveCount(0);

    await page.goto(charterPath);
    await page.getByRole('button', { name: 'More charter actions' }).click();
    await page.getByRole('menuitem', { name: 'Unarchive' }).click();
    await expect(page.getByRole('button', { name: 'Launch session' }).first()).toBeVisible();
  });

  test('viewer cannot create charters (UI and API)', async ({ page }) => {
    await login(page, USERS.viewer);
    const pid = await projectId(page, 'SHOP');
    await page.goto(`/projects/${pid}/charters`);
    await expect(page.getByRole('heading', { name: 'Charters' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New charter' })).toHaveCount(0);
    const res = await page.request.post(`/api/projects/${pid}/charters`, {
      headers: { 'X-Requested-With': 'explorix' },
      data: { title: 'Nope', mission: 'Explore nothing to discover nothing' },
    });
    expect(res.status()).toBe(403);
  });
});
