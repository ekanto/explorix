import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

export const app = createApp();
export const PASSWORD = 'Explorix-demo-1';
export { prisma };

export type Client = ReturnType<typeof clientFor>;

/** A cookie-authenticated client that sends the CSRF header on every request. */
function clientFor(agent: ReturnType<typeof request.agent>) {
  const h = { 'X-Requested-With': 'explorix' };
  return {
    agent,
    get: (url: string) => agent.get(url).set(h),
    post: (url: string, body?: object) => agent.post(url).set(h).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set(h).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set(h).send(body ?? {}),
    del: (url: string) => agent.delete(url).set(h),
  };
}

export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'explorix').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return clientFor(agent);
}

export async function projectId(key: string) {
  const p = await prisma.project.findFirstOrThrow({ where: { key } });
  return p.id;
}

export async function userId(email: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

export const P = (pid: string) => `/api/projects/${pid}`;
