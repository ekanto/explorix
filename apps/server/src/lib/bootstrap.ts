import { z } from 'zod';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { hashPassword, passwordSchema } from './passwords.js';
import { SYSTEM_TEMPLATES } from './systemTemplates.js';

const bootstrapSchema = z.object({
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
  BOOTSTRAP_ADMIN_PASSWORD: passwordSchema,
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).max(120).default('Administrator'),
  BOOTSTRAP_ORG_NAME: z.string().trim().min(1).max(120).default('My Organization'),
});

/**
 * First-run provisioning for empty databases (e.g. production without demo data).
 * When no organization exists and BOOTSTRAP_ADMIN_EMAIL/PASSWORD are set, creates the
 * organization, its owner and the built-in charter templates in one transaction.
 * Returns true when it provisioned anything.
 */
export async function bootstrapIfEmpty(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!env.BOOTSTRAP_ADMIN_EMAIL) {
    if ((await prisma.organization.count()) === 0) {
      logger.warn('Database has no organization. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (or run the demo seed) to create the first administrator.');
    }
    return false;
  }
  const parsed = bootstrapSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid bootstrap settings: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  const { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password, BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ORG_NAME: orgName } = parsed.data;
  const created = await provisionOrganization({ email, password, name, orgName, source: 'org.bootstrap' });
  if (created) logger.info({ email, org: orgName }, 'First-run bootstrap created the organization owner');
  return !!created;
}

/**
 * Creates the first organization, its owner and the built-in charter templates
 * in one transaction. Returns the owner, or null when an organization already
 * exists (re-checked under an advisory lock so concurrent callers cannot both win).
 */
export async function provisionOrganization(p: { email: string; password: string; name: string; orgName: string; source: string }) {
  const passwordHash = await hashPassword(p.password);
  const slug = p.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727172)`;
    if ((await tx.organization.count()) > 0) return null;
    const org = await tx.organization.create({ data: { name: p.orgName, slug } });
    const user = await tx.user.upsert({ where: { email: p.email }, update: {}, create: { email: p.email, name: p.name, passwordHash } });
    await tx.orgMember.create({ data: { orgId: org.id, userId: user.id, role: 'OWNER' } });
    for (const t of SYSTEM_TEMPLATES) {
      await tx.charterTemplate.create({
        data: { orgId: org.id, name: t.name, category: t.category, description: t.description, missionTemplate: t.missionTemplate, timeboxMinutes: t.timeboxMinutes, heuristics: t.heuristics, testIdeas: t.testIdeas, defaults: t.defaults, isSystem: true },
      });
    }
    await tx.auditEvent.create({ data: { orgId: org.id, actorId: user.id, action: p.source, entityType: 'Organization', entityId: org.id, changes: { name: p.orgName, owner: p.email } } });
    return { user, org };
  });
}
