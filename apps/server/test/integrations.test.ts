import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { login, P, prisma, projectId, type Client } from './helpers';
import { signPayload } from '../src/lib/webhooks';

describe('integrations', () => {
  let admin: Client;
  let tester: Client;
  let pid: string;
  let server: http.Server;
  let baseUrl: string;
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];

  beforeAll(async () => {
    admin = await login('admin@explorix.dev');
    tester = await login('tester@explorix.dev');
    pid = await projectId('SHOP');
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('delivers HMAC-signed webhooks for subscribed events and logs the delivery', async () => {
    const secret = 'whsec-test-123456';
    const created = await admin.post(`${P(pid)}/integrations`, { provider: 'WEBHOOK', name: 'Test hook', url: `${baseUrl}/hook`, events: ['issue.created'], secret });
    expect(created.status).toBe(201);
    expect(created.body.integration).toMatchObject({ hasSecret: true });
    expect(JSON.stringify(created.body)).not.toContain(secret);

    const issue = await tester.post(`${P(pid)}/issues`, { title: 'Webhook probe issue' });
    expect(issue.status).toBe(201);
    await vi.waitFor(() => expect(received.length).toBe(1), { timeout: 5000 });

    const [hit] = received;
    expect(hit.headers['x-explorix-event']).toBe('issue.created');
    const ts = String(hit.headers['x-explorix-timestamp']);
    expect(hit.headers['x-explorix-signature']).toBe(signPayload(secret, ts, hit.body));
    expect(JSON.parse(hit.body)).toMatchObject({ event: 'issue.created', projectId: pid, data: { id: issue.body.issue.id } });

    const deliveries = await admin.get(`${P(pid)}/integrations/${created.body.integration.id}/deliveries`);
    expect(deliveries.body.deliveries[0]).toMatchObject({ event: 'issue.created', success: true, statusCode: 204 });
  });

  it('pushes an internal issue to GitHub once and stores the external link', async () => {
    const created = await admin.post(`${P(pid)}/integrations`, { provider: 'GITHUB', name: 'GH', repo: 'acme/shop', token: 'ghp_testtoken_123456', apiUrl: 'https://github.example.test', labels: ['explorix'] });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('ghp_testtoken');
    const issue = (await tester.post(`${P(pid)}/issues`, { title: 'Checkout total rounds wrong', description: 'Totals off by one cent' })).body.issue;

    const realFetch = globalThis.fetch;
    const calls: { url: string; init?: RequestInit }[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith('https://github.example.test')) return realFetch(input, init);
      calls.push({ url, init });
      return new Response(JSON.stringify({ number: 42, html_url: 'https://github.example.test/acme/shop/issues/42' }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    try {
      const pushed = await tester.post(`${P(pid)}/integrations/${created.body.integration.id}/push-issue`, { issueId: issue.id });
      expect(pushed.status).toBe(200);
      expect(pushed.body.issue).toMatchObject({ externalProvider: 'GITHUB', externalKey: 'acme/shop#42', externalUrl: 'https://github.example.test/acme/shop/issues/42' });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://github.example.test/repos/acme/shop/issues');
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get('authorization')).toBe('Bearer ghp_testtoken_123456');
      const sent = JSON.parse(String(calls[0].init?.body));
      expect(sent).toMatchObject({ title: 'Checkout total rounds wrong', labels: ['explorix'] });
      expect(sent.body).toContain('Totals off by one cent');

      const again = await tester.post(`${P(pid)}/integrations/${created.body.integration.id}/push-issue`, { issueId: issue.id });
      expect(again.status).toBe(409);
      expect(calls).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    const stored = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(stored.externalKey).toBe('acme/shop#42');
  });

  it('reports planned providers as not implemented', async () => {
    const res = await admin.post(`${P(pid)}/integrations`, { provider: 'JIRA', name: 'Jira' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('not_implemented');
  });
});
