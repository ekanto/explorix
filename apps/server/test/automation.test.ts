import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, P, projectId, type Client } from './helpers';

const junit = (failing: boolean) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="ci-suite" tests="3">
    <testcase classname="ci.cart" name="adds item" time="0.5"/>
    <testcase classname="ci.cart" name="applies coupon" time="0.7">${failing ? '<failure message="expected 90 got 100">AssertionError\n  at cart.test.js:42</failure>' : ''}</testcase>
    <testcase classname="ci.cart" name="gift wrap" time="0"><skipped/></testcase>
  </testsuite>
</testsuites>`;

describe('automation ingestion', () => {
  let tester: Client;
  let pid: string;
  let token: string;
  beforeAll(async () => {
    tester = await login('tester@explorix.dev');
    pid = await projectId('SHOP');
    token = (await tester.post('/api/tokens', { name: 'ci-automation', projectId: pid })).body.secret;
  });

  const upload = (xml: string, qs: string) =>
    request(app).post(`${P(pid)}/automation/import/junit?${qs}`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/xml').send(xml);

  it('imports JUnit XML with CI metadata via an API token', async () => {
    const res = await upload(junit(false), 'source=ci-junit&branch=main&commitSha=abc123&buildNumber=101&ciUrl=https://ci.example.com/101');
    expect(res.status).toBe(201);
    expect(res.body.run).toMatchObject({ total: 3, passed: 2, failed: 0, skipped: 1 });
    const detail = await tester.get(`${P(pid)}/automation/runs/${res.body.run.id}`);
    expect(detail.body.run).toMatchObject({ branch: 'main', commitSha: 'abc123', buildNumber: '101' });
    expect(detail.body.run.source.name).toBe('ci-junit');
  });

  it('records failures with messages and stack traces, and compares runs', async () => {
    const res = await upload(junit(true), 'source=ci-junit&branch=main&buildNumber=102');
    expect(res.body.run.failed).toBe(1);
    const detail = await tester.get(`${P(pid)}/automation/runs/${res.body.run.id}`);
    const failed = detail.body.results.find((r: { category: string }) => r.category === 'FAILED');
    expect(failed.message).toContain('expected 90 got 100');
    expect(failed.stackTrace).toContain('cart.test.js:42');
    expect(detail.body.previousRun).toBeTruthy();
    const cmp = await tester.get(`${P(pid)}/automation/compare?base=${detail.body.previousRun.id}&head=${res.body.run.id}`);
    expect(cmp.body.newFailures.map((r: { name: string }) => r.name)).toEqual(['applies coupon']);
  });

  it('flags tests whose outcome flips as flaky based on history', async () => {
    await upload(junit(false), 'source=ci-junit&branch=main&buildNumber=103');
    const tests = await tester.get(`${P(pid)}/automation/tests?flaky=true`);
    const names = tests.body.tests.map((t: { name: string }) => t.name);
    expect(names).toContain('applies coupon');
    expect(names).not.toContain('adds item');
  });

  it('imports Playwright JSON reports', async () => {
    const report = {
      stats: { startTime: new Date().toISOString(), duration: 2000 },
      suites: [{ title: 'login.spec.ts', file: 'login.spec.ts', specs: [{ title: 'signs in', tests: [{ projectName: 'chromium', status: 'expected', results: [{ status: 'passed', duration: 800, retry: 0 }] }] }] }],
    };
    const res = await request(app).post(`${P(pid)}/automation/import/playwright?source=pw&branch=feature/x`).set('Authorization', `Bearer ${token}`).send(report);
    expect(res.status).toBe(201);
    expect(res.body.run).toMatchObject({ total: 1, passed: 1 });
  });

  it('supports staged ingestion (create → append → complete)', async () => {
    const run = await request(app).post(`${P(pid)}/automation/runs`).set('Authorization', `Bearer ${token}`).send({ name: 'staged', source: 'staged-src', status: 'RUNNING' });
    expect(run.status).toBe(201);
    const id = run.body.run.id;
    const add = await request(app).post(`${P(pid)}/automation/runs/${id}/results`).set('Authorization', `Bearer ${token}`).send({ results: [{ name: 't1', status: 'passed' }, { name: 't2', status: 'failed', message: 'nope' }] });
    expect(add.status).toBe(201);
    const done = await request(app).post(`${P(pid)}/automation/runs/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    expect(done.body.run).toMatchObject({ status: 'COMPLETED', total: 2, passed: 1, failed: 1 });
    const again = await request(app).post(`${P(pid)}/automation/runs/${id}/results`).set('Authorization', `Bearer ${token}`).send({ results: [{ name: 't3', status: 'passed' }] });
    expect(again.status).toBe(400);
  });

  it('rejects malformed reports and viewer tokens', async () => {
    expect((await upload('<not-xml', 'source=x')).status).toBe(400);
    const viewer = await login('viewer@explorix.dev');
    const vt = (await viewer.post('/api/tokens', { name: 'viewer-ci', projectId: pid })).body.secret;
    const res = await request(app).post(`${P(pid)}/automation/import/junit`).set('Authorization', `Bearer ${vt}`).set('Content-Type', 'application/xml').send(junit(false));
    expect(res.status).toBe(403);
  });
});
