#!/usr/bin/env node
/**
 * Captures full-page screenshots of the main Explorix screens in light and dark themes
 * at several viewport sizes, for visual review of design-system changes.
 *
 *   node e2e/scripts/capture-screens.mjs <outDir> [--sizes=1440x900,1280x800] [--only=dashboard,workbench] [--themes=light,dark]
 *
 * Requires the dev stack (`npm run dev`) on http://localhost:5173 with the demo seed.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.EXPLORIX_URL ?? 'http://localhost:5173';
const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'screens');
const opt = (name, def) => (args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def).split(',').filter(Boolean);
const sizes = opt('sizes', '1440x900').map((s) => s.split('x').map(Number));
const only = opt('only', '');
const themes = opt('themes', 'light,dark');
mkdirSync(outDir, { recursive: true });

const H = { 'x-requested-with': 'explorix', 'content-type': 'application/json' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const req = ctx.request;
const login = await req.post(`${BASE}/api/auth/login`, { headers: H, data: { email: 'admin@explorix.dev', password: 'Explorix-demo-1' } });
if (!login.ok()) throw new Error(`login failed ${login.status()}`);
const get = async (url) => (await req.get(`${BASE}/api${url}`, { headers: H })).json();
const list = (x) => x?.items ?? x?.charters ?? x?.sessions ?? x?.findings ?? x?.testCases ?? x?.runs ?? x?.testRuns ?? [];

const { projects } = await get('/projects');
const shop = projects.find((p) => p.key === 'SHOP');
let empty = projects.find((p) => p.key === 'EMPTY');
if (!empty) {
  const r = await req.post(`${BASE}/api/projects`, { headers: H, data: { key: 'EMPTY', name: 'Empty project', description: 'A project with no testing data yet.' } });
  const j = await r.json();
  empty = j.project ?? j;
}
const P = `/projects/${shop.id}`;
const sessions = list(await get(`${P}/sessions?pageSize=50&view=all`));
const active = sessions.find((s) => s.status === 'IN_PROGRESS') ?? sessions[0];
const charter = list(await get(`${P}/charters?pageSize=5`))[0];
const finding = list(await get(`${P}/findings?pageSize=5`))[0];
const run = list(await get(`${P}/automation/runs?pageSize=5`))[0];

const pages = {
  login: '/login',
  overview: '/',
  mywork: '/my-work',
  dashboard: P,
  'dashboard-empty': `/projects/${empty.id}`,
  charters: `${P}/charters`,
  'charter-new': `${P}/charters/new`,
  'charter-detail': charter && `${P}/charters/${charter.id}`,
  sessions: `${P}/sessions`,
  workbench: active && `${P}/sessions/${active.id}`,
  findings: `${P}/findings`,
  'finding-detail': finding && `${P}/findings/${finding.id}`,
  'test-cases': `${P}/test-cases`,
  'test-runs': `${P}/test-runs`,
  automation: `${P}/automation`,
  'automation-run': run && `${P}/automation/runs/${run.id}`,
  issues: `${P}/issues`,
  requirements: `${P}/requirements`,
  reports: `${P}/reports`,
  'report-builder': `${P}/reports/new`,
  'project-settings': `${P}/settings`,
  admin: '/admin',
};

for (const theme of themes) {
  const page = await ctx.newPage();
  await page.addInitScript((t) => localStorage.setItem('explorix-color-scheme', t), theme);
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    for (const [name, url] of Object.entries(pages)) {
      if (!url || (only.length && !only.includes(name))) continue;
      if (name === 'login') {
        const anon = await browser.newContext({ viewport: { width: w, height: h } });
        const lp = await anon.newPage();
        await lp.addInitScript((t) => localStorage.setItem('explorix-color-scheme', t), theme);
        await lp.goto(BASE + url);
        await lp.waitForLoadState('networkidle');
        await lp.screenshot({ path: path.join(outDir, `${name}-${theme}-${w}.png`) });
        await anon.close();
        continue;
      }
      await page.goto(BASE + url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, `${name}-${theme}-${w}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) console.log(`!! horizontal overflow ${overflow}px on ${name} ${theme} ${w}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
