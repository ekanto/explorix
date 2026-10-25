import { describe, expect, it } from 'vitest';
import { bootstrapIfEmpty } from '../src/lib/bootstrap';
import { prisma } from './helpers';

describe('first-run bootstrap', () => {
  it('does nothing when an organization already exists', async () => {
    const before = await prisma.organization.count();
    const created = await bootstrapIfEmpty({ BOOTSTRAP_ADMIN_EMAIL: 'new-owner@example.com', BOOTSTRAP_ADMIN_PASSWORD: 'Sufficient-pass-1' });
    expect(created).toBe(false);
    expect(await prisma.organization.count()).toBe(before);
    expect(await prisma.user.findUnique({ where: { email: 'new-owner@example.com' } })).toBeNull();
  });

  it('rejects weak bootstrap passwords instead of creating an insecure owner', async () => {
    await expect(bootstrapIfEmpty({ BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com', BOOTSTRAP_ADMIN_PASSWORD: 'short' })).rejects.toThrow(/Invalid bootstrap settings/);
  });
});
