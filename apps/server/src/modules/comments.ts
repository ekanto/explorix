import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { keys } from '../lib/util.js';
import { assertProjectMembers, hasRole, requireRole } from '../middleware/access.js';

/**
 * Comments on charters, sessions, findings, issues and test cases.
 * Any project member (including viewers, e.g. product reviewers) may comment.
 * Bodies are stored as plain text and rendered as text by the client.
 */
export const commentsRouter = Router({ mergeParams: true });

const TARGETS = ['charter', 'session', 'finding', 'issue', 'testCase'] as const;
type Target = (typeof TARGETS)[number];
const FK: Record<Target, 'charterId' | 'sessionId' | 'findingId' | 'issueId' | 'testCaseId'> = {
  charter: 'charterId',
  session: 'sessionId',
  finding: 'findingId',
  issue: 'issueId',
  testCase: 'testCaseId',
};
const userSel = { select: { id: true, name: true, avatarColor: true } } as const;

/** Resolves the target within the project and returns who should hear about new comments. */
async function resolveTarget(req: Request, type: Target, id: string) {
  const projectId = req.project!.id;
  const pk = req.project!.key;
  switch (type) {
    case 'charter': {
      const t = await prisma.charter.findFirst({ where: { id, projectId }, include: { assignees: true } });
      return t && { label: `${keys.charter(t.number)} ${t.title}`, link: `/projects/${projectId}/charters/${t.id}`, watchers: [t.createdById, ...t.assignees.map((a) => a.userId)] };
    }
    case 'session': {
      const t = await prisma.exploratorySession.findFirst({ where: { id, projectId } });
      return t && { label: `${keys.session(t.number)} ${t.title}`, link: `/projects/${projectId}/sessions/${t.id}`, watchers: [t.testerId, t.reviewerId] };
    }
    case 'finding': {
      const t = await prisma.finding.findFirst({ where: { id, projectId } });
      return t && { label: `${keys.finding(t.number)} ${t.title}`, link: `/projects/${projectId}/findings/${t.id}`, watchers: [t.authorId, t.ownerId] };
    }
    case 'issue': {
      const t = await prisma.issue.findFirst({ where: { id, projectId } });
      return t && { label: `${keys.issue(pk, t.number)} ${t.title}`, link: `/projects/${projectId}/issues/${t.id}`, watchers: [t.reporterId, t.assigneeId] };
    }
    case 'testCase': {
      const t = await prisma.testCase.findFirst({ where: { id, projectId } });
      return t && { label: `${keys.testCase(t.number)} ${t.title}`, link: `/projects/${projectId}/test-cases/${t.id}`, watchers: [t.createdById] };
    }
  }
}

commentsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ targetType: z.enum(TARGETS), targetId: z.string() }), req.query);
  if (!(await resolveTarget(req, q.targetType, q.targetId))) throw notFound('Comment target');
  const comments = await prisma.comment.findMany({
    where: { projectId: req.project!.id, [FK[q.targetType]]: q.targetId },
    orderBy: { createdAt: 'asc' },
    include: { author: userSel, mentions: { include: { user: userSel } } },
  });
  res.json({ comments: comments.map((c) => ({ ...c, mentions: c.mentions.map((m) => m.user) })) });
});

commentsRouter.post('/', requireRole('VIEWER'), async (req, res) => {
  const b = parse(
    z.object({
      targetType: z.enum(TARGETS),
      targetId: z.string(),
      body: z.string().trim().min(1, 'Comment cannot be empty').max(10_000),
      mentions: z.array(z.string()).max(20).optional(),
    }),
    req.body,
  );
  const target = await resolveTarget(req, b.targetType, b.targetId);
  if (!target) throw badRequest('Unknown comment target');
  const pid = req.project!.id;
  const mentions = Array.from(new Set(b.mentions ?? []));
  await assertProjectMembers(pid, req.user!.orgId, mentions);
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({
      data: {
        projectId: pid,
        authorId: req.user!.id,
        body: b.body,
        [FK[b.targetType]]: b.targetId,
        mentions: { create: mentions.map((userId) => ({ userId })) },
      },
      include: { author: userSel, mentions: { include: { user: userSel } } },
    });
    const snippet = b.body.slice(0, 200);
    await notify(tx, { recipients: mentions, actorId: req.user!.id, projectId: pid, type: 'MENTION', title: `${req.user!.name} mentioned you on ${target.label}`, body: snippet, link: target.link });
    await notify(tx, {
      recipients: target.watchers.filter((w) => w && !mentions.includes(w)),
      actorId: req.user!.id,
      projectId: pid,
      type: 'COMMENT',
      title: `${req.user!.name} commented on ${target.label}`,
      body: snippet,
      link: target.link,
    });
    if (b.targetType === 'session') {
      const s = await tx.exploratorySession.findUniqueOrThrow({ where: { id: b.targetId } });
      await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: req.user!.id, type: 'SYSTEM', content: `Comment: ${snippet}`, elapsedSeconds: s.elapsedSeconds } });
    }
    return c;
  });
  res.status(201).json({ comment: { ...comment, mentions: comment.mentions.map((m) => m.user) } });
});

commentsRouter.patch('/:id', requireRole('VIEWER'), async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), req.body);
  const c = await prisma.comment.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!c) throw notFound('Comment');
  if (c.authorId !== req.user!.id) throw forbidden('You can only edit your own comments');
  const updated = await prisma.comment.update({ where: { id: c.id }, data: { body: b.body, editedAt: new Date() }, include: { author: userSel } });
  res.json({ comment: updated });
});

commentsRouter.delete('/:id', requireRole('VIEWER'), async (req, res) => {
  const c = await prisma.comment.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!c) throw notFound('Comment');
  if (c.authorId !== req.user!.id && !hasRole(req, 'LEAD')) throw forbidden('You can only delete your own comments');
  await prisma.$transaction(async (tx) => {
    await tx.comment.delete({ where: { id: c.id } });
    await audit(tx, req, { projectId: c.projectId, entityType: 'comment', entityId: c.id, action: 'deleted', changes: { body: c.body } });
  });
  res.json({ ok: true });
});
