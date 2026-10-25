import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockProvider, setProviderForTests, type AiProvider } from '../src/ai/provider';
import { login, P, prisma, projectId, type Client } from './helpers';

describe('AI assistance layer', () => {
  let tester: Client;
  let pid: string;
  beforeAll(async () => {
    tester = await login('tester@explorix.dev');
    pid = await projectId('SHOP');
  });
  afterAll(() => setProviderForTests(undefined));

  it('reports not-configured with setup instructions and returns 503 for drafts', async () => {
    setProviderForTests(null);
    const status = await tester.get('/api/ai/status');
    expect(status.body.enabled).toBe(false);
    expect(status.body.setupInstructions.length).toBeGreaterThan(0);
    const res = await tester.post(`${P(pid)}/ai/charter-draft`, { text: 'As a shopper I can save items to a wishlist and share it by link.' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ai_not_configured');
  });

  it('keeps deterministic helpers available without a provider', async () => {
    setProviderForTests(null);
    const lint = await tester.post(`${P(pid)}/ai/charter-lint`, { mission: 'test everything' });
    expect(lint.status).toBe(200);
    expect(lint.body.score).toBeLessThan(70);
    const rec = await tester.post(`${P(pid)}/ai/heuristics/recommend`, { text: 'login form with password reset' });
    expect(rec.body.heuristics.length).toBeGreaterThan(0);
  });

  it('returns reviewable drafts without persisting anything', async () => {
    setProviderForTests(new MockProvider());
    const before = await prisma.charter.count();
    const res = await tester.post(`${P(pid)}/ai/charter-draft`, { text: 'As a shopper I can save items to a wishlist and share it by link.', target: 'Wishlist' });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ reviewRequired: true, isMock: true });
    expect(res.body.draft.mission).toMatch(/^Explore/);
    expect(await prisma.charter.count()).toBe(before);

    const session = await prisma.exploratorySession.findFirstOrThrow({ where: { projectId: pid, status: 'APPROVED' } });
    const sum = await tester.post(`${P(pid)}/ai/sessions/${session.id}/summary`);
    expect(sum.status).toBe(200);
    expect(sum.body.draft.summary).toBeTruthy();
    const fresh = await prisma.exploratorySession.findUniqueOrThrow({ where: { id: session.id } });
    expect(fresh.summary).toBe(session.summary);
  });

  it('rejects malformed provider output instead of saving it', async () => {
    const broken: AiProvider = { name: 'broken', model: 'x', isMock: true, generate: async () => ({ nonsense: true }) };
    setProviderForTests(broken);
    const res = await tester.post(`${P(pid)}/ai/charter-draft`, { text: 'As a shopper I can save items to a wishlist.' });
    expect(res.status).toBe(502);
  });

  it('does not allow viewers to call provider-backed endpoints', async () => {
    setProviderForTests(new MockProvider());
    const viewer = await login('viewer@explorix.dev');
    expect((await viewer.post(`${P(pid)}/ai/charter-draft`, { text: 'As a shopper I can save items to a wishlist.' })).status).toBe(403);
  });
});
