import type { Request } from 'express';
import type { Charter, Prisma, SessionStatus } from '@prisma/client';
import { prisma, type Tx } from '../db.js';
import { badRequest, forbidden, notFound } from './errors.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { keys, liveElapsed, nextNumber, resolveTagIds } from './util.js';
import { assertProjectMembers, hasRole } from '../middleware/access.js';
import { projectSettings } from './projectDefaults.js';

export const ACTIVE_STATUSES: SessionStatus[] = ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'];
export const EDITABLE_STATUSES: SessionStatus[] = ['DRAFT', 'IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'];
export const DONE_STATUSES: SessionStatus[] = ['COMPLETED', 'IN_REVIEW', 'APPROVED'];

export interface SessionLaunchInput {
  title?: string;
  testerId?: string | null;
  environmentId?: string | null;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  buildVersion?: string | null;
  environmentNotes?: string | null;
  timeboxMinutes?: number;
  dueDate?: Date | null;
  milestoneId?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  tags?: string[];
  start?: boolean;
}

export async function validateRefs(projectId: string, refs: { milestoneId?: string | null; environmentId?: string | null }) {
  if (refs.milestoneId) {
    if (!(await prisma.milestone.findFirst({ where: { id: refs.milestoneId, projectId } }))) throw badRequest('Unknown milestone');
  }
  if (refs.environmentId) {
    if (!(await prisma.environment.findFirst({ where: { id: refs.environmentId, projectId } }))) throw badRequest('Unknown environment');
  }
}

/** Creates an exploratory session from a charter, copying the charter's environment and timebox defaults. */
export async function createSessionFromCharter(req: Request, charter: Charter, input: SessionLaunchInput) {
  if (charter.status === 'ARCHIVED') throw badRequest('Cannot launch a session from an archived charter');
  const projectId = charter.projectId;
  const testerId = input.testerId === undefined ? req.user!.id : input.testerId;
  await assertProjectMembers(projectId, req.user!.orgId, [testerId]);
  await validateRefs(projectId, { milestoneId: input.milestoneId, environmentId: input.environmentId });
  const env = input.environmentId ? await prisma.environment.findUnique({ where: { id: input.environmentId } }) : null;
  const now = new Date();
  const start = !!input.start && testerId === req.user!.id;

  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, projectId, 'sessionSeq');
    const tagIds = await resolveTagIds(tx, projectId, input.tags);
    const session = await tx.exploratorySession.create({
      data: {
        projectId,
        charterId: charter.id,
        number,
        title: input.title?.trim() || charter.title,
        status: start ? 'IN_PROGRESS' : 'DRAFT',
        testerId,
        createdById: req.user!.id,
        milestoneId: input.milestoneId === undefined ? charter.milestoneId : input.milestoneId,
        environmentId: input.environmentId ?? charter.environmentId,
        browser: input.browser ?? env?.browser ?? charter.browser,
        os: input.os ?? env?.os ?? charter.os,
        device: input.device ?? env?.device ?? charter.device,
        buildVersion: input.buildVersion,
        environmentNotes: input.environmentNotes ?? charter.environmentNotes,
        priority: input.priority ?? charter.priority,
        timeboxMinutes: input.timeboxMinutes ?? charter.timeboxMinutes,
        dueDate: input.dueDate,
        startedAt: start ? now : null,
        lastResumedAt: start ? now : null,
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
    });
    if (charter.status === 'DRAFT') await tx.charter.update({ where: { id: charter.id }, data: { status: 'READY' } });
    await tx.sessionLogEntry.create({
      data: {
        sessionId: session.id,
        authorId: req.user!.id,
        type: 'STATUS_CHANGE',
        content: start ? 'Session created and started' : 'Session created',
        metadata: { to: session.status },
      },
    });
    await audit(tx, req, { projectId, entityType: 'session', entityId: session.id, action: 'created', changes: { charter: keys.charter(charter.number), status: session.status } });
    if (testerId && testerId !== req.user!.id) {
      await notify(tx, {
        recipients: [testerId],
        actorId: req.user!.id,
        projectId,
        type: 'ASSIGNMENT',
        title: `You were assigned session ${keys.session(number)}: ${session.title}`,
        link: `/projects/${projectId}/sessions/${session.id}`,
      });
    }
    return session;
  });
}

export async function getSessionOr404(projectId: string, id: string) {
  const s = await prisma.exploratorySession.findFirst({ where: { id, projectId } });
  if (!s) throw notFound('Session');
  return s;
}

/** Tester of the session or a lead/admin may operate the timer and edit content. */
export function canOperate(req: Request, s: { testerId: string | null }) {
  return hasRole(req, 'LEAD') || (hasRole(req, 'TESTER') && (s.testerId === req.user!.id || s.testerId === null));
}

export function isEditable(req: Request, s: { status: SessionStatus; archivedAt: Date | null }) {
  if (s.archivedAt) return false;
  if (EDITABLE_STATUSES.includes(s.status)) return true;
  return !projectSettings(req.project!.settings).lockCompletedSessions && s.status !== 'ABANDONED';
}

export function assertCanEditContent(req: Request, s: { status: SessionStatus; archivedAt: Date | null; testerId: string | null }) {
  if (!canOperate(req, s)) throw forbidden('Only the session tester or a lead can change this session');
  if (!isEditable(req, s)) throw badRequest('This session is read-only (completed, abandoned or archived)');
}

export async function addLog(
  tx: Tx,
  s: { id: string; status: string; elapsedSeconds: number; lastResumedAt: Date | null },
  entry: { authorId: string | null; type: Prisma.SessionLogEntryCreateInput['type']; content: string; findingId?: string; attachmentId?: string; metadata?: object },
) {
  return tx.sessionLogEntry.create({
    data: {
      sessionId: s.id,
      authorId: entry.authorId,
      type: entry.type,
      content: entry.content.slice(0, 5000),
      elapsedSeconds: liveElapsed(s),
      findingId: entry.findingId,
      attachmentId: entry.attachmentId,
      metadata: entry.metadata ?? {},
    },
  });
}
