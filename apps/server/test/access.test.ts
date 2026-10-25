import { describe, expect, it } from 'vitest';
import { login, P, prisma, projectId } from './helpers';

describe('authorization and validation', () => {
  it('lists only projects the user belongs to', async () => {
    const dana = await login('dana@explorix.dev');
    const res = await dana.get('/api/projects');
    const keys = res.body.projects.map((p: { key: string }) => p.key);
    expect(keys).toContain('BANK');
    expect(keys).not.toContain('SHOP');
  });

  it('returns 404 (not 403) for projects and records the user cannot access', async () => {
    const dana = await login('dana@explorix.dev');
    const shop = await projectId('SHOP');
    const bank = await projectId('BANK');
    expect((await dana.get(P(shop))).status).toBe(404);
    expect((await dana.get(`${P(shop)}/findings`)).status).toBe(404);
    expect((await dana.post(`${P(shop)}/charters`, { title: 'x', mission: 'Explore x to discover y' })).status).toBe(404);

    // IDOR: a ShopFront finding requested through a project the user CAN access.
    const shopFinding = await prisma.finding.findFirstOrThrow({ where: { projectId: shop } });
    expect((await dana.get(`${P(bank)}/findings/${shopFinding.id}`)).status).toBe(404);
    const shopSession = await prisma.exploratorySession.findFirstOrThrow({ where: { projectId: shop } });
    expect((await dana.post(`${P(bank)}/sessions/${shopSession.id}/pause`)).status).toBe(404);

    const search = await dana.get('/api/search?q=checkout');
    expect(search.body.results.every((r: { project: { key: string } }) => r.project.key !== 'SHOP')).toBe(true);
  });

  it('enforces project roles server-side', async () => {
    const viewer = await login('viewer@explorix.dev');
    const shop = await projectId('SHOP');
    expect((await viewer.get(`${P(shop)}/charters`)).status).toBe(200);
    expect((await viewer.post(`${P(shop)}/charters`, { title: 'x', mission: 'Explore x to discover y' })).status).toBe(403);
    const charter = await prisma.charter.findFirstOrThrow({ where: { projectId: shop, status: 'READY' } });
    expect((await viewer.post(`${P(shop)}/charters/${charter.id}/sessions`)).status).toBe(403);
    const session = await prisma.exploratorySession.findFirstOrThrow({ where: { projectId: shop } });
    // Viewers may still comment.
    const comment = await viewer.post(`${P(shop)}/comments`, { targetType: 'session', targetId: session.id, body: 'Looks good from the product side' });
    expect(comment.status).toBe(201);

    const tester = await login('tester@explorix.dev');
    expect((await tester.patch(P(shop), { name: 'Hijacked' })).status).toBe(403);
    expect((await tester.get('/api/admin/users')).status).toBe(403);
    expect((await tester.get(`${P(shop)}/integrations`)).status).toBe(403);
  });

  it('prevents testers from operating sessions owned by someone else', async () => {
    const shop = await projectId('SHOP');
    const sam = await login('sam@explorix.dev');
    const others = await prisma.exploratorySession.findFirstOrThrow({ where: { projectId: shop, status: { in: ['PAUSED', 'IN_PROGRESS'] }, tester: { email: { not: 'sam@explorix.dev' } } } });
    expect((await sam.post(`${P(shop)}/sessions/${others.id}/${others.status === 'PAUSED' ? 'resume' : 'pause'}`)).status).toBe(403);
    expect((await sam.post(`${P(shop)}/sessions/${others.id}/log`, { content: 'not mine' })).status).toBe(403);
  });

  it('rejects invalid input with field-level details', async () => {
    const tester = await login('tester@explorix.dev');
    const shop = await projectId('SHOP');
    const res = await tester.post(`${P(shop)}/charters`, { title: '', mission: 'x'.repeat(5000), timeboxMinutes: 9999, priority: 'URGENT' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    const paths = res.body.error.details.fields.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['title', 'mission', 'timeboxMinutes', 'priority']));
    expect((await tester.post(`${P(shop)}/charters`, { title: 'ok', mission: 'Explore x to discover y', milestoneId: 'not-a-real-id' })).status).toBe(400);
    const bad = await tester.agent.post(`${P(shop)}/charters`).set('X-Requested-With', 'explorix').set('Content-Type', 'application/json').send('{"title":');
    expect(bad.status).toBe(400);
    expect((await tester.get(`${P(shop)}/sessions/does-not-exist`)).status).toBe(404);
  });

  it('makes archived projects read-only', async () => {
    const admin = await login('admin@explorix.dev');
    const created = await admin.post('/api/projects', { name: 'Temp Archive', key: 'TMPA' });
    expect(created.status).toBe(201);
    const pid = created.body.project.id;
    expect((await admin.post(`${P(pid)}/archive`)).status).toBe(200);
    const res = await admin.post(`${P(pid)}/charters`, { title: 'x', mission: 'Explore x to discover y' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/archived/);
    expect((await admin.get(`${P(pid)}/charters`)).status).toBe(200);
  });
});
