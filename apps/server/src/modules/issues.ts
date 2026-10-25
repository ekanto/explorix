import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { evidenceInclude, serializeEvidence } from '../lib/evidence.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { validateCustomFields } from '../lib/customFields.js';
import { notify } from '../lib/notify.js';
import { toCsv } from '../lib/csv.js';
import { keys, nextNumber, paging, toArray } from '../lib/util.js';
import { emitEvent } from '../lib/webhooks.js';
import { assertProjectMembers, hasRole, requireRole } from '../middleware/access.js';

export const issuesRouter = Router({ mergeParams: true });

const userSel = { select: { id: true, name: true, avatarColor: true } } as const;
const severity = z.enum(['TRIVIAL', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const issueStatus = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'WONT_FIX']);
export const OPEN_ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS'] as const;

const issueBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().max(50_000).nullish(),
  status: issueStatus.optional(),
  severity: severity.optional(),
  priority: priority.optional(),
  assigneeId: z.string().nullish(),
  milestoneId: z.string().nullish(),
  externalUrl: z.string().url().max(1000).nullish(),
  customFields: z.record(z.unknown()).optional(),
});

const listInclude = {
  reporter: userSel,
  assignee: userSel,
  milestone: { select: { id: true, name: true } },
  sourceFinding: { select: { id: true, number: true, title: true, sessionId: true } },
  _count: { select: { findings: true, comments: true, testResults: true, automationResults: true } },
} satisfies Prisma.IssueInclude;

function serialize(req: Request, i: Prisma.IssueGetPayload<{ include: typeof listInclude }>) {
  return {
    ...i,
    key: keys.issue(req.project!.key, i.number),
    sourceFinding: i.sourceFinding ? { ...i.sourceFinding, key: keys.finding(i.sourceFinding.number) } : null,
  };
}

function buildWhere(req: Request, q: Record<string, string>): Prisma.IssueWhereInput {
  const statuses = toArray(q.status);
  return {
    projectId: req.project!.id,
    status: q.open === 'true' ? { in: [...OPEN_ISSUE_STATUSES] } : statuses.length ? { in: statuses as never } : undefined,
    severity: q.severity ? { in: toArray(q.severity) as never } : undefined,
    priority: q.priority ? { in: toArray(q.priority) as never } : undefined,
    assigneeId: q.assigneeId ? (q.assigneeId === 'me' ? req.user!.id : q.assigneeId === 'none' ? null : q.assigneeId) : undefined,
    milestoneId: q.milestoneId || undefined,
    OR: q.q
      ? [
          { title: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          ...(/^([a-z]+-)?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : []),
        ]
      : undefined,
  };
}

issuesRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q);
  const where = buildWhere(req, q);
  const orderBy: Prisma.IssueOrderByWithRelationInput = q.sort === 'severity' ? { severity: 'desc' } : q.sort === 'updated' ? { updatedAt: 'desc' } : { number: 'desc' };
  const [total, issues] = await Promise.all([prisma.issue.count({ where }), prisma.issue.findMany({ where, orderBy, skip, take, include: listInclude })]);
  res.json({ total, page, pageSize, issues: issues.map((i) => serialize(req, i)) });
});

issuesRouter.get('/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const issues = (await prisma.issue.findMany({ where: buildWhere(req, q), orderBy: { number: 'asc' }, include: listInclude, take: 10_000 })).map((i) => serialize(req, i));
  if (q.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-issues.json"`);
    return res.json({ exportedAt: new Date().toISOString(), project: req.project!.key, count: issues.length, issues });
  }
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-issues.csv"`);
  res.send(
    toCsv(issues, [
      { header: 'Key', value: (i) => i.key },
      { header: 'Title', value: (i) => i.title },
      { header: 'Status', value: (i) => i.status },
      { header: 'Severity', value: (i) => i.severity },
      { header: 'Priority', value: (i) => i.priority },
      { header: 'Assignee', value: (i) => i.assignee?.name },
      { header: 'Reporter', value: (i) => i.reporter.name },
      { header: 'Milestone', value: (i) => i.milestone?.name },
      { header: 'Source finding', value: (i) => i.sourceFinding?.key },
      { header: 'External URL', value: (i) => i.externalUrl },
      { header: 'Created', value: (i) => i.createdAt },
      { header: 'Resolved', value: (i) => i.resolvedAt },
      { header: 'Description', value: (i) => i.description },
    ]),
  );
});

issuesRouter.post('/', requireRole('TESTER'), async (req, res) => {
  const body = parse(issueBody, req.body);
  const pid = req.project!.id;
  await assertProjectMembers(pid, req.user!.orgId, [body.assigneeId]);
  if (body.milestoneId && !(await prisma.milestone.findFirst({ where: { id: body.milestoneId, projectId: pid } }))) throw badRequest('Unknown milestone');
  const customFields = await validateCustomFields(prisma, pid, 'ISSUE', body.customFields);
  const issue = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'issueSeq');
    const i = await tx.issue.create({
      data: {
        projectId: pid,
        number,
        title: body.title,
        description: body.description ?? null,
        status: body.status ?? 'OPEN',
        severity: body.severity ?? 'MAJOR',
        priority: body.priority ?? 'MEDIUM',
        assigneeId: body.assigneeId ?? null,
        milestoneId: body.milestoneId ?? null,
        externalUrl: body.externalUrl ?? null,
        reporterId: req.user!.id,
        customFields: customFields as Prisma.InputJsonValue,
      },
    });
    await audit(tx, req, { projectId: pid, entityType: 'issue', entityId: i.id, action: 'created', changes: { title: i.title } });
    await notify(tx, { recipients: [body.assigneeId], actorId: req.user!.id, projectId: pid, type: 'ASSIGNMENT', title: `You were assigned issue ${keys.issue(req.project!.key, number)}: ${i.title}`, link: `/projects/${pid}/issues/${i.id}` });
    return i;
  });
  emitEvent(pid, 'issue.created', { id: issue.id, key: keys.issue(req.project!.key, issue.number), title: issue.title, severity: issue.severity });
  const full = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id }, include: listInclude });
  res.status(201).json({ issue: serialize(req, full) });
});

issuesRouter.get('/:id', async (req, res) => {
  const i = await prisma.issue.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      ...listInclude,
      findings: { select: { id: true, number: true, title: true, status: true, severity: true, sessionId: true, classification: { select: { name: true, color: true } } } },
      attachments: evidenceInclude,
      testResults: { take: 20, orderBy: { createdAt: 'desc' }, include: { status: true, runItem: { select: { runId: true, testCase: { select: { id: true, number: true, title: true } } } } } },
      automationResults: { take: 20, orderBy: { createdAt: 'desc' }, include: { test: { select: { id: true, name: true } }, run: { select: { id: true, number: true } } } },
    },
  });
  if (!i) throw notFound('Issue');
  const history = await prisma.auditEvent.findMany({ where: { entityType: 'issue', entityId: i.id }, include: { actor: userSel }, orderBy: { createdAt: 'desc' }, take: 100 });
  const integrations = await prisma.integration.findMany({ where: { projectId: i.projectId, provider: 'GITHUB', enabled: true }, select: { id: true, name: true } });
  res.json({
    issue: { ...serialize(req, i), attachments: i.attachments.map(serializeEvidence), findings: i.findings.map((f) => ({ ...f, key: keys.finding(f.number) })) },
    history,
    pushTargets: integrations,
    permissions: { canEdit: hasRole(req, 'TESTER') },
  });
});

issuesRouter.patch('/:id', requireRole('TESTER'), async (req, res) => {
  const before = await prisma.issue.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!before) throw notFound('Issue');
  const body = parse(issueBody.partial(), req.body);
  const pid = req.project!.id;
  if (body.assigneeId) await assertProjectMembers(pid, req.user!.orgId, [body.assigneeId]);
  if (body.milestoneId && !(await prisma.milestone.findFirst({ where: { id: body.milestoneId, projectId: pid } }))) throw badRequest('Unknown milestone');
  if (body.status && ['CLOSED', 'WONT_FIX'].includes(body.status) && !hasRole(req, 'LEAD') && before.reporterId !== req.user!.id && before.assigneeId !== req.user!.id) {
    throw forbidden('Only leads, the reporter or the assignee can close issues');
  }
  const customFields = body.customFields ? await validateCustomFields(prisma, pid, 'ISSUE', body.customFields, before.customFields) : undefined;
  const { customFields: _c, ...rest } = body;
  const data: Prisma.IssueUncheckedUpdateInput = { ...rest, ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}) };
  if (body.status && body.status !== before.status) {
    data.resolvedAt = ['RESOLVED', 'CLOSED', 'WONT_FIX'].includes(body.status) ? new Date() : null;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const i = await tx.issue.update({ where: { id: before.id }, data });
    // Resolving an issue resolves the findings converted into it (they keep their history).
    if (body.status && ['RESOLVED', 'CLOSED'].includes(body.status)) {
      await tx.finding.updateMany({ where: { issueId: i.id, status: { in: ['CONVERTED', 'TRIAGED', 'NEW'] } }, data: { status: 'RESOLVED' } });
    }
    const changes = diff(before as unknown as Record<string, unknown>, i as unknown as Record<string, unknown>, Object.keys(data));
    if (Object.keys(changes).length) await audit(tx, req, { projectId: pid, entityType: 'issue', entityId: i.id, action: 'updated', changes });
    if (body.assigneeId && body.assigneeId !== before.assigneeId) {
      await notify(tx, { recipients: [body.assigneeId], actorId: req.user!.id, projectId: pid, type: 'ASSIGNMENT', title: `You were assigned issue ${keys.issue(req.project!.key, i.number)}: ${i.title}`, link: `/projects/${pid}/issues/${i.id}` });
    }
    if (body.status && body.status !== before.status) {
      await notify(tx, { recipients: [before.reporterId, before.assigneeId], actorId: req.user!.id, projectId: pid, type: 'SYSTEM', title: `${keys.issue(req.project!.key, i.number)} is now ${body.status.replace('_', ' ').toLowerCase()}`, link: `/projects/${pid}/issues/${i.id}` });
    }
    return i;
  });
  emitEvent(pid, 'issue.updated', { id: updated.id, key: keys.issue(req.project!.key, updated.number), status: updated.status });
  const full = await prisma.issue.findUniqueOrThrow({ where: { id: updated.id }, include: listInclude });
  res.json({ issue: serialize(req, full) });
});
