import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { csvToObjects, toCsv } from '../lib/csv.js';
import { keys, nextNumber, paging, toArray } from '../lib/util.js';
import { requireRole } from '../middleware/access.js';

export const requirementsRouter = Router({ mergeParams: true });

const reqStatus = z.enum(['DRAFT', 'APPROVED', 'IMPLEMENTED', 'DEPRECATED']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const body = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().max(20_000).nullish(),
  externalKey: z.string().max(100).nullish(),
  externalUrl: z.string().url().max(1000).nullish(),
  status: reqStatus.optional(),
  priority: priority.optional(),
  charterIds: z.array(z.string()).max(200).optional(),
  testCaseIds: z.array(z.string()).max(500).optional(),
});

/**
 * Coverage for a requirement:
 * - covered: at least one linked charter with a completed session OR one linked test case with a latest manual result.
 * - status: "passing" if every linked test case's latest result is PASSED and no open defect findings,
 *   "failing" if any latest result FAILED or an open defect finding exists, "untested" if nothing was executed.
 */
export async function requirementCoverage(projectId: string, requirementIds?: string[]) {
  const reqs = await prisma.requirement.findMany({
    where: { projectId, ...(requirementIds ? { id: { in: requirementIds } } : {}) },
    include: {
      charters: { include: { charter: { select: { id: true, sessions: { where: { status: { in: ['COMPLETED', 'IN_REVIEW', 'APPROVED'] } }, select: { id: true } } } } } },
      testCases: { include: { testCase: { select: { id: true, runItems: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: { select: { category: true } } } } } } } },
      findings: { where: { status: { in: ['NEW', 'TRIAGED', 'CONVERTED'] } }, select: { id: true, classification: { select: { isDefect: true } } } },
    },
  });
  return new Map(
    reqs.map((r) => {
      const exploredCharters = r.charters.filter((c) => c.charter.sessions.length > 0).length;
      const latest = r.testCases.map((t) => t.testCase.runItems[0]?.status?.category ?? 'UNTESTED');
      const executed = latest.filter((c) => c !== 'UNTESTED').length;
      const failed = latest.filter((c) => c === 'FAILED' || c === 'BLOCKED').length;
      const openDefects = r.findings.filter((f) => f.classification.isDefect).length;
      const covered = exploredCharters > 0 || executed > 0;
      const status = failed > 0 || openDefects > 0 ? 'failing' : !covered ? 'untested' : latest.every((c) => c === 'PASSED' || c === 'UNTESTED') && executed > 0 ? 'passing' : 'partial';
      return [
        r.id,
        { charters: r.charters.length, exploredCharters, testCases: r.testCases.length, executedTestCases: executed, failedTestCases: failed, openFindings: r.findings.length, openDefects, covered, status },
      ];
    }),
  );
}

requirementsRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q, 100);
  const where: Prisma.RequirementWhereInput = {
    projectId: req.project!.id,
    status: q.status ? { in: toArray(q.status) as never } : undefined,
    OR: q.q ? [{ title: { contains: q.q, mode: 'insensitive' } }, { externalKey: { contains: q.q, mode: 'insensitive' } }] : undefined,
  };
  const [total, rows] = await Promise.all([prisma.requirement.count({ where }), prisma.requirement.findMany({ where, orderBy: { number: 'asc' }, skip, take })]);
  const coverage = await requirementCoverage(req.project!.id, rows.map((r) => r.id));
  const requirements = rows.map((r) => ({ ...r, key: keys.requirement(r.number), coverage: coverage.get(r.id) }));
  if (q.format === 'csv') {
    res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-requirements.csv"`);
    return res.send(
      toCsv(requirements, [
        { header: 'Key', value: (r) => r.key },
        { header: 'External key', value: (r) => r.externalKey },
        { header: 'Title', value: (r) => r.title },
        { header: 'Status', value: (r) => r.status },
        { header: 'Priority', value: (r) => r.priority },
        { header: 'Coverage', value: (r) => r.coverage?.status },
        { header: 'Charters', value: (r) => r.coverage?.charters },
        { header: 'Test cases', value: (r) => r.coverage?.testCases },
        { header: 'Open defects', value: (r) => r.coverage?.openDefects },
      ]),
    );
  }
  res.json({ total, page, pageSize, requirements });
});

async function validateLinks(req: Request, b: { charterIds?: string[]; testCaseIds?: string[] }) {
  const pid = req.project!.id;
  if (b.charterIds?.length && (await prisma.charter.count({ where: { id: { in: b.charterIds }, projectId: pid } })) !== new Set(b.charterIds).size) throw badRequest('Unknown charter');
  if (b.testCaseIds?.length && (await prisma.testCase.count({ where: { id: { in: b.testCaseIds }, projectId: pid } })) !== new Set(b.testCaseIds).size) throw badRequest('Unknown test case');
}

requirementsRouter.post('/', requireRole('TESTER'), async (req, res) => {
  const b = parse(body, req.body);
  await validateLinks(req, b);
  const pid = req.project!.id;
  const r = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'requirementSeq');
    const r = await tx.requirement.create({
      data: {
        projectId: pid,
        number,
        title: b.title,
        description: b.description ?? null,
        externalKey: b.externalKey ?? null,
        externalUrl: b.externalUrl ?? null,
        status: b.status,
        priority: b.priority,
        charters: { create: (b.charterIds ?? []).map((charterId) => ({ charterId })) },
        testCases: { create: (b.testCaseIds ?? []).map((testCaseId) => ({ testCaseId })) },
      },
    });
    await audit(tx, req, { projectId: pid, entityType: 'requirement', entityId: r.id, action: 'created', changes: { title: r.title } });
    return r;
  });
  res.status(201).json({ requirement: { ...r, key: keys.requirement(r.number) } });
});

/** CSV import: columns Title (required), Description, External key, External URL, Priority, Status. */
requirementsRouter.post('/import', requireRole('LEAD'), async (req, res) => {
  const text = typeof req.body === 'string' ? req.body : typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!text.trim()) throw badRequest('Send CSV text (Content-Type: text/csv) or JSON {"csv": "..."}');
  const rows = csvToObjects(text);
  const pick = (r: Record<string, string>, ...names: string[]) => names.map((n) => Object.entries(r).find(([k]) => k.trim().toLowerCase() === n)?.[1]).find((v) => v !== undefined)?.trim();
  const errors: { row: number; message: string }[] = [];
  const valid = rows
    .map((r, i) => {
      const title = pick(r, 'title', 'name', 'summary');
      if (!title) {
        errors.push({ row: i + 2, message: 'Missing title' });
        return null;
      }
      const prio = pick(r, 'priority')?.toUpperCase();
      const status = pick(r, 'status')?.toUpperCase();
      return {
        title: title.slice(0, 300),
        description: pick(r, 'description') || null,
        externalKey: pick(r, 'external key', 'externalkey', 'key', 'id')?.slice(0, 100) || null,
        externalUrl: pick(r, 'external url', 'url') || null,
        priority: priority.safeParse(prio).success ? (prio as z.infer<typeof priority>) : undefined,
        status: reqStatus.safeParse(status).success ? (status as z.infer<typeof reqStatus>) : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (valid.length > 2000) throw badRequest('Import at most 2000 requirements at a time');
  const pid = req.project!.id;
  await prisma.$transaction(async (tx) => {
    for (const v of valid) {
      const number = await nextNumber(tx, pid, 'requirementSeq');
      await tx.requirement.create({ data: { ...v, projectId: pid, number } });
    }
    await audit(tx, req, { projectId: pid, entityType: 'requirement', entityId: pid, action: 'imported', changes: { count: valid.length } });
  });
  res.status(201).json({ imported: valid.length, errors });
});

requirementsRouter.get('/:id', async (req, res) => {
  const r = await prisma.requirement.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      charters: { include: { charter: { select: { id: true, number: true, title: true, status: true } } } },
      testCases: { include: { testCase: { select: { id: true, number: true, title: true, status: true } } } },
      findings: { select: { id: true, number: true, title: true, status: true, severity: true, classification: { select: { name: true, color: true } } } },
    },
  });
  if (!r) throw notFound('Requirement');
  const coverage = (await requirementCoverage(req.project!.id, [r.id])).get(r.id);
  res.json({
    requirement: {
      ...r,
      key: keys.requirement(r.number),
      coverage,
      charters: r.charters.map((c) => ({ ...c.charter, key: keys.charter(c.charter.number) })),
      testCases: r.testCases.map((t) => ({ ...t.testCase, key: keys.testCase(t.testCase.number) })),
      findings: r.findings.map((f) => ({ ...f, key: keys.finding(f.number) })),
    },
  });
});

requirementsRouter.patch('/:id', requireRole('TESTER'), async (req, res) => {
  const before = await prisma.requirement.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!before) throw notFound('Requirement');
  const b = parse(body.partial(), req.body);
  await validateLinks(req, b);
  const { charterIds, testCaseIds, ...data } = b;
  const r = await prisma.$transaction(async (tx) => {
    if (charterIds) {
      await tx.requirementCharter.deleteMany({ where: { requirementId: before.id } });
      await tx.requirementCharter.createMany({ data: charterIds.map((charterId) => ({ requirementId: before.id, charterId })) });
    }
    if (testCaseIds) {
      await tx.requirementTestCase.deleteMany({ where: { requirementId: before.id } });
      await tx.requirementTestCase.createMany({ data: testCaseIds.map((testCaseId) => ({ requirementId: before.id, testCaseId })) });
    }
    const r = await tx.requirement.update({ where: { id: before.id }, data });
    const changes: Record<string, unknown> = diff(before as unknown as Record<string, unknown>, r as unknown as Record<string, unknown>, Object.keys(data));
    if (charterIds) changes.charters = { to: charterIds };
    if (testCaseIds) changes.testCases = { to: testCaseIds };
    if (Object.keys(changes).length) await audit(tx, req, { projectId: r.projectId, entityType: 'requirement', entityId: r.id, action: 'updated', changes });
    return r;
  });
  res.json({ requirement: { ...r, key: keys.requirement(r.number) } });
});

requirementsRouter.delete('/:id', requireRole('LEAD'), async (req, res) => {
  const r = await prisma.requirement.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!r) throw notFound('Requirement');
  await prisma.$transaction(async (tx) => {
    await tx.requirement.delete({ where: { id: r.id } });
    await audit(tx, req, { projectId: r.projectId, entityType: 'requirement', entityId: r.id, action: 'deleted', changes: { title: r.title, key: keys.requirement(r.number) } });
  });
  res.json({ ok: true });
});
