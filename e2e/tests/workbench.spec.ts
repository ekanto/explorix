import { expect, test, type Page } from '@playwright/test';
import { api, login, logout, PNG, projectId, USERS } from './helpers';

/**
 * The signature flow: launch a session from a charter, explore (notes, quick log,
 * findings with evidence, pause/resume), finish with a debrief and get it reviewed.
 */
test.describe.serial('Exploratory session workbench', () => {
  const title = `E2E guest checkout ${Date.now()}`;
  let shopId = '';
  let sessionUrl = '';

  const notes = (page: Page) => page.getByRole('textbox', { name: /session notes/i }).or(page.locator('.ProseMirror').first()).first();

  test('tester launches a session from a charter and the timer runs', async ({ page }) => {
    await login(page, USERS.tester);
    shopId = await projectId(page, 'SHOP');
    await page.goto(`/projects/${shopId}`);
    await page.getByRole('button', { name: 'Start session' }).first().click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Launch exploratory session' });
    await dialog.getByRole('combobox', { name: 'Charter' }).click();
    await page.getByRole('option', { name: /Guest checkout end-to-end/ }).click();
    await dialog.getByLabel('Session title').fill(title);
    await dialog.getByLabel('Browser').fill('Chromium E2E');
    await dialog.getByRole('button', { name: 'Start session' }).click();

    await expect(page).toHaveURL(/\/sessions\/[a-z0-9]+$/);
    sessionUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('In progress', { exact: true })).toBeVisible();

    const timer = page.locator('.ex-timer').first();
    const t1 = await timer.textContent();
    await page.waitForTimeout(2200);
    expect(await timer.textContent()).not.toBe(t1);
  });

  test('notes autosave and survive a refresh; quick log is timestamped', async ({ page }) => {
    await login(page, USERS.tester, sessionUrl);
    await notes(page).click();
    await page.keyboard.type('Tried guest checkout with an empty cart. Persist-check-42.');
    await expect(page.getByText(/^Saved /)).toBeVisible();

    await page.getByPlaceholder(/Quick observation/).fill('Shipping step remembers the previous address');
    await page.getByPlaceholder(/Quick observation/).press('Enter');
    await expect(page.getByText('Shipping step remembers the previous address')).toBeVisible();

    await page.reload();
    await expect(notes(page)).toContainText('Persist-check-42');
    await expect(page.getByText('Shipping step remembers the previous address')).toBeVisible();
    await expect(page.getByText(/unsaved notes recovered/i)).toHaveCount(0);
  });

  test('captures a classified finding with screenshot evidence', async ({ page }) => {
    await login(page, USERS.tester, sessionUrl);
    await page.getByRole('button', { name: 'Finding', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Capture finding' });
    await dialog.getByText('Confirmed defect', { exact: false }).first().click();
    await dialog.getByLabel('Title').fill('Order total ignores coupon after back navigation');
    await dialog.getByLabel('Actual behavior').fill('Total shows the undiscounted price');
    await dialog.getByLabel('Expected behavior').fill('Coupon stays applied');
    await dialog.getByLabel('Reproduction steps').fill('1. Apply coupon\n2. Go to payment\n3. Press back');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'coupon-bug.png', mimeType: 'image/png', buffer: PNG });
    await dialog.getByRole('button', { name: 'Save finding' }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    const log = page.getByText('Order total ignores coupon after back navigation').first();
    await expect(log).toBeVisible();
    await expect(page.getByText('coupon-bug.png').first()).toBeVisible();

    const sessionId = sessionUrl.split('/').pop();
    const { session } = await api(page.request).get(`/projects/${shopId}/sessions/${sessionId}`);
    const f = session.findings.find((x: { title: string }) => x.title.startsWith('Order total ignores coupon'));
    expect(f.classification.key).toBe('confirmed_defect');
    expect(f.author.name).toBe('Tara Okafor');
    expect(f._count.attachments).toBe(1);
    expect(f.sessionElapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  test('pause stops the clock and resume continues it', async ({ page }) => {
    await login(page, USERS.tester, sessionUrl);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    const timer = page.locator('.ex-timer').first();
    const paused = await timer.textContent();
    await page.waitForTimeout(1500);
    expect(await timer.textContent()).toBe(paused);
    await page.reload();
    await expect(timer).toHaveText(paused!);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('In progress', { exact: true })).toBeVisible();
  });

  test('finishing sends the session for review and keeps its history read-only', async ({ page }) => {
    await login(page, USERS.tester, sessionUrl);
    await page.getByRole('button', { name: 'Finish' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'debrief' });
    await dialog.locator('.ProseMirror').click();
    await page.keyboard.type('Coupon state is lost on back navigation; otherwise stable.');
    await dialog.getByRole('button', { name: /Finish & send for review/ }).click();

    await expect(page.getByText('In review', { exact: true })).toBeVisible();
    await expect(page.getByText(/read-only/i).first()).toBeVisible();
    await expect(page.getByText(/Not saved|Offline/)).toHaveCount(0);

    await page.reload();
    for (const text of ['Session created and started', 'Session paused', 'Session resumed', 'Session finished', 'Shipping step remembers the previous address']) {
      await expect(page.getByText(text).first()).toBeVisible();
    }
    await expect(notes(page)).toContainText('Persist-check-42');
  });

  test('a lead approves the session', async ({ page }) => {
    await login(page, USERS.lead, sessionUrl);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText('Approved', { exact: true })).toBeVisible();
    await logout(page);
  });
});
