import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, login, P, prisma, projectId } from './helpers';

describe('authentication', () => {
  it('rejects unauthenticated API calls', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
  });

  it('logs in, returns the current user and logs out', async () => {
    const c = await login('tester@explorix.dev');
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('tester@explorix.dev');
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('uses a generic error for bad credentials and unknown users', async () => {
    const a = await request(app).post('/api/auth/login').set('X-Requested-With', 'explorix').send({ email: 'tester@explorix.dev', password: 'wrong-password' });
    const b = await request(app).post('/api/auth/login').set('X-Requested-With', 'explorix').send({ email: 'nobody@explorix.dev', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks an account after repeated failures', async () => {
    const admin = await login('admin@explorix.dev');
    const created = await admin.post('/api/admin/users', { email: 'lockme@explorix.dev', name: 'Lock Me', password: 'Correct-horse-1', orgRole: 'MEMBER' });
    expect(created.status).toBe(201);
    for (let i = 0; i < 8; i++) {
      await request(app).post('/api/auth/login').set('X-Requested-With', 'explorix').send({ email: 'lockme@explorix.dev', password: 'bad-password' });
    }
    const locked = await request(app).post('/api/auth/login').set('X-Requested-With', 'explorix').send({ email: 'lockme@explorix.dev', password: 'Correct-horse-1' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('locked');
  });

  it('requires the CSRF header for cookie-authenticated mutations', async () => {
    const c = await login('tester@explorix.dev');
    const pid = await projectId('SHOP');
    const res = await c.agent.post(`${P(pid)}/charters`).send({ title: 'No header', mission: 'Explore something to discover issues' });
    expect(res.status).toBe(403);
  });

  it('authenticates API tokens without CSRF and respects their project scope', async () => {
    const c = await login('tester@explorix.dev');
    const shop = await projectId('SHOP');
    const bank = await projectId('BANK');
    const t = await c.post('/api/tokens', { name: 'ci', projectId: shop });
    expect(t.status).toBe(201);
    const token = t.body.secret as string;
    expect(token).toMatch(/^exp_/);
    const ok = await request(app).get(`${P(shop)}/automation/runs`).set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    const other = await request(app).get(`${P(bank)}/charters`).set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(404);
    const stored = await prisma.apiToken.findFirstOrThrow({ where: { name: 'ci' } });
    expect(stored.tokenHash).not.toContain(token);
  });
});
