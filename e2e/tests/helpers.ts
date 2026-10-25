import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PASSWORD = 'Explorix-demo-1';
export const USERS = {
  admin: 'admin@explorix.dev',
  lead: 'lead@explorix.dev',
  tester: 'tester@explorix.dev',
  sam: 'sam@explorix.dev',
  viewer: 'viewer@explorix.dev',
} as const;

/** 1x1 PNG used as screenshot evidence. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function login(page: Page, email: string, next = '/') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  await page.request.post('/api/auth/logout', { headers: { 'X-Requested-With': 'explorix' } });
}

/** Authenticated API helper bound to the page's cookie jar. */
export function api(request: APIRequestContext) {
  const headers = { 'X-Requested-With': 'explorix' };
  return {
    get: async (url: string) => {
      const r = await request.get(`/api${url}`, { headers });
      expect(r.ok(), `GET ${url} -> ${r.status()}`).toBeTruthy();
      return r.json();
    },
    post: async (url: string, data?: unknown) => {
      const r = await request.post(`/api${url}`, { headers, data: data ?? {} });
      expect(r.ok(), `POST ${url} -> ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
  };
}

export async function projectId(page: Page, key: 'SHOP' | 'BANK') {
  const { projects } = await api(page.request).get('/projects');
  const p = projects.find((x: { key: string }) => x.key === key);
  expect(p, `project ${key} visible to current user`).toBeTruthy();
  return p.id as string;
}
