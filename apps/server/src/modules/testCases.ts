import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Tx } from '../db.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { validateCustomFields } from '../lib/customFields.js';
import { csvToObjects, toCsv } from '../lib/csv.js';
import { keys, nextNumber, paging, resolveTagIds, tagNames, toArray } from '../lib/util.js';
import { requireRole } from '../middleware/access.js';

/** Mounted at the project root: /test-folders and /test-cases. */
export const testCasesRouter = Router({ mergeParams: true });

const userSel = { select: { id: true, name: true, avatarColor: true } } as const;
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

testCasesRouter.get('/test-folders', async (req, res) => {
  const folders = await prisma.testFolder.findMany({ where: { projectId: req.project!.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  const counts = await prisma.testCase.groupBy({ by: ['folderId'], where: { projectId: req.project!.id, archivedAt: null }, _count: true });
  res.json({ folders: folders.map((f) => ({ ...f, caseCount: counts.find((c) => c.folderId === f.id)?._count ?? 0 })), unfiledCount: counts.find((c) => c.folderId === null)?._count ?? 0 });
});

const folderBody = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullish(), position: z.number().int().min(0).max(100_000).optional() });

async function assertFolderParent(projectId: string, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  let cur = await prisma.testFolder.findFirst({ where: { id: parentId, projectId } });
  if (!cur) throw badRequest('Unknown parent folder');
  // Prevent cycles when moving folders.
  for (let depth = 0; cur && depth < 50; depth++) {
    if (cur.id === selfId) throw badRequest('A folder cannot be moved inside itself');
    cur = cur.parentId ? await prisma.testFolder.findUnique({ where: { id: cur.parentId } }) : null;
  }
}

testCasesRouter.post('/test-folders', requireRole('TESTER'), async (req, res) => {
  const b = parse(folderBody, req.body);
  await assertFolderParent(req.project!.id, b.parentId);
  const folder = await prisma.testFolder.create({ data: { projectId: req.project!.id, name: b.name, parentId: b.parentId ?? null, position: b.position ?? 0 } });
  res.status(201).json({ folder });
});

testCasesRouter.patch('/test-folders/:id', requireRole('TESTER'), async (req, res) => {
  const f = await prisma.testFolder.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!f) throw notFound('Folder');
  const b = parse(folderBody.partial(), req.body);
  await assertFolderParent(req.project!.id, b.parentId, f.id);
  res.json({ folder: await prisma.testFolder.update({ where: { id: f.id }, data: b }) });
});

/** Deleting a folder moves its test cases to the parent folder (cases are never deleted implicitly). */
testCasesRouter.delete('/test-folders/:id', requireRole('LEAD'), async (req, res) => {
  const f = await prisma.testFolder.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!f) throw notFound('Folder');
  await prisma.$transaction(async (tx) => {
    const descendants: string[] = [];
    let frontier = [f.id];
    while (frontier.length) {
      const kids = await tx.testFolder.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
      frontier = kids.map((k) => k.id);
      descendants.push(...frontier);
    }
    await tx.testCase.updateMany({ where: { folderId: { in: [f.id, ...descendants] } }, data: { folderId: f.parentId } });
    await tx.testFolder.delete({ where: { id: f.id } });
    await audit(tx, req, { projectId: f.projectId, entityType: 'test_folder', entityId: f.id, action: 'deleted', changes: { name: f.name } });
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const stepSchema = z.object({ action: z.string().trim().min(1).max(5000), expected: z.string().max(5000).nullish(), data: z.string().max(5000).nullish() });
const caseBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().max(20_000).nullish(),
  preconditions: z.string().max(10_000).nullish(),
  testData: z.string().max(10_000).nullish(),
  format: z.enum(['STEPS', 'GHERKIN', 'TEXT']).optional(),
  gherkin: z.string().max(50_000).nullish(),
  priority: priority.optional(),
  type: z.string().trim().min(1).max(60).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'DEPRECATED']).optional(),
  estimateMinutes: z.number().int().min(0).max(10_000).nullish(),
  automationKey: z.string().max(500).nullish(),
  folderId: z.string().nullish(),
  sourceCharterId: z.string().nullish(),
  steps: z.array(stepSchema).max(200).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  requirementIds: z.array(z.string()).max(100).optional(),
  customFields: z.record(z.unknown()).optional(),
});
const SCALARS = ['title', 'description', 'preconditions', 'testData', 'format', 'gherkin', 'priority', 'type', 'status', 'estimateMinutes', 'automationKey', 'folderId', 'sourceCharterId'] as const;

/** Light Gherkin validation: requires a Scenario and at least one Given/When/Then step. */
export function validateGherkin(src: string) {
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const errors: string[] = [];
  if (!lines.some((l) => /^(Scenario|Scenario Outline|Example):/i.test(l))) errors.push('Add a "Scenario:" line');
  if (!lines.some((l) => /^(Given|When|Then|And|But|\*)\s/i.test(l))) errors.push('Add at least one Given/When/Then step');
  return errors;
}

async function validateCaseRefs(req: Request, b: Partial<z.infer<typeof caseBody>>) {
  const pid = req.project!.id;
  if (b.folderId && !(await prisma.testFolder.findFirst({ where: { id: b.folderId, projectId: pid } }))) throw badRequest('Unknown folder');
  if (b.sourceCharterId && !(await prisma.charter.findFirst({ where: { id: b.sourceCharterId, projectId: pid } }))) throw badRequest('Unknown charter');
  if (b.requirementIds?.length && (await prisma.requirement.count({ where: { id: { in: b.requirementIds }, projectId: pid } })) !== new Set(b.requirementIds).size) throw badRequest('Unknown requirement');
  if (b.format === 'GHERKIN' && b.gherkin !== undefined) {
    const errs = validateGherkin(b.gherkin ?? '');
    if (errs.length) throw badRequest('Invalid Gherkin', { fields: errs.map((message) => ({ path: 'gherkin', message })) });
  }
}

const detailInclude = {
  steps: { orderBy: { position: 'asc' } },
  tags: { include: { tag: true } },
  folder: { select: { id: true, name: true } },
  createdBy: userSel,
  updatedBy: userSel,
  requirements: { include: { requirement: { select: { id: true, number: true, title: true } } } },
  sourceFinding: { select: { id: true, number: true, title: true } },
  sourceCharter: { select: { id: true, number: true, title: true } },
} satisfies Prisma.TestCaseInclude;

type DetailCase = Prisma.TestCaseGetPayload<{ include: typeof detailInclude }>;

function serialize(c: DetailCase) {
  return {
    ...c,
    key: keys.testCase(c.number),
    tags: tagNames(c.tags),
    requirements: c.requirements.map((r) => ({ ...r.requirement, key: keys.requirement(r.requirement.number) })),
    sourceFinding: c.sourceFinding ? { ...c.sourceFinding, key: keys.finding(c.sourceFinding.number) } : null,
    sourceCharter: c.sourceCharter ? { ...c.sourceCharter, key: keys.charter(c.sourceCharter.number) } : null,
  };
}

async function snapshot(tx: Tx, caseId: string, authorId: string) {
  const c = await tx.testCase.findUniqueOrThrow({ where: { id: caseId }, include: { steps: { orderBy: { position: 'asc' } }, tags: { include: { tag: true } } } });
  await tx.testCaseRevision.create({
    data: {
      testCaseId: c.id,
      version: c.version,
      authorId,
      snapshot: JSON.parse(JSON.stringify({ ...c, tags: tagNames(c.tags) })),
    },
  });
}

function buildWhere(req: Request, q: Record<string, string>): Prisma.TestCaseWhereInput {
  return {
    projectId: req.project!.id,
    archivedAt: q.archived === 'true' ? { not: null } : null,
    folderId: q.folderId === 'none' ? null : q.folderId || undefined,
    status: q.status ? { in: toArray(q.status) as never } : undefined,
    priority: q.priority ? { in: toArray(q.priority) as never } : undefined,
    type: q.type || undefined,
    tags: q.tag ? { some: { tag: { name: { in: toArray(q.tag) } } } } : undefined,
    requirements: q.requirementId ? { some: { requirementId: q.requirementId } } : undefined,
    OR: q.q
      ? [
          { title: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          ...(/^(c-)?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : []),
        ]
      : undefined,
  };
}

testCasesRouter.get('/test-cases', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q, 100);
  const where = buildWhere(req, q);
  const [total, cases] = await Promise.all([
    prisma.testCase.count({ where }),
    prisma.testCase.findMany({
      where,
      orderBy: q.sort === 'updated' ? { updatedAt: 'desc' } : q.sort === 'title' ? { title: 'asc' } : { number: 'asc' },
      skip,
      take,
      include: {
        tags: { include: { tag: true } },
        folder: { select: { id: true, name: true } },
        _count: { select: { steps: true } },
        runItems: { orderBy: { updatedAt: 'desc' }, take: 1, where: { statusId: { not: null } }, include: { status: true } },
      },
    }),
  ]);
  res.json({
    total,
    page,
    pageSize,
    testCases: cases.map(({ runItems, ...c }) => ({ ...c, key: keys.testCase(c.number), tags: tagNames(c.tags), lastResult: runItems[0]?.status ?? null })),
  });
});

testCasesRouter.post('/test-cases', requireRole('TESTER'), async (req, res) => {
  const b = parse(caseBody, req.body);
  await validateCaseRefs(req, b);
  const pid = req.project!.id;
  const customFields = await validateCustomFields(prisma, pid, 'TEST_CASE', b.customFields);
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'testCaseSeq');
    const tagIds = await resolveTagIds(tx, pid, b.tags);
    const data: Record<string, unknown> = {};
    for (const k of SCALARS) if (b[k] !== undefined) data[k] = b[k];
    const c = await tx.testCase.create({
      data: {
        ...(data as Prisma.TestCaseUncheckedCreateInput),
        title: b.title,
        projectId: pid,
        number,
        customFields: customFields as Prisma.InputJsonValue,
        createdById: req.user!.id,
        updatedById: req.user!.id,
        steps: { create: (b.steps ?? []).map((s, i) => ({ position: i + 1, action: s.action, expected: s.expected ?? null, data: s.data ?? null })) },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
        requirements: { create: (b.requirementIds ?? []).map((requirementId) => ({ requirementId })) },
      },
    });
    await snapshot(tx, c.id, req.user!.id);
    await audit(tx, req, { projectId: pid, entityType: 'test_case', entityId: c.id, action: 'created', changes: { title: c.title } });
    return c;
  });
  const full = await prisma.testCase.findUniqueOrThrow({ where: { id: created.id }, include: detailInclude });
  res.status(201).json({ testCase: serialize(full) });
});

testCasesRouter.get('/test-cases/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const cases = await prisma.testCase.findMany({ where: buildWhere(req, q), orderBy: { number: 'asc' }, include: detailInclude, take: 10_000 });
  const rows = cases.map(serialize);
  if (q.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-test-cases.json"`);
    return res.json({ exportedAt: new Date().toISOString(), project: req.project!.key, count: rows.length, testCases: rows });
  }
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-test-cases.csv"`);
  res.send(
    toCsv(rows, [
      { header: 'Key', value: (c) => c.key },
      { header: 'Title', value: (c) => c.title },
      { header: 'Folder', value: (c) => c.folder?.name },
      { header: 'Priority', value: (c) => c.priority },
      { header: 'Type', value: (c) => c.type },
      { header: 'Status', value: (c) => c.status },
      { header: 'Format', value: (c) => c.format },
      { header: 'Preconditions', value: (c) => c.preconditions },
      { header: 'Steps', value: (c) => (c.format === 'GHERKIN' ? c.gherkin : c.steps.map((s, i) => `${i + 1}. ${s.action}`).join('\n')) },
      { header: 'Expected', value: (c) => c.steps.map((s, i) => (s.expected ? `${i + 1}. ${s.expected}` : '')).filter(Boolean).join('\n') },
      { header: 'Test data', value: (c) => c.testData },
      { header: 'Tags', value: (c) => c.tags },
      { header: 'Requirements', value: (c) => c.requirements.map((r) => r.key) },
      { header: 'Estimate (min)', value: (c) => c.estimateMinutes },
      { header: 'Automation key', value: (c) => c.automationKey },
      { header: 'Version', value: (c) => c.version },
    ]),
  );
});

/**
 * CSV import. Recognised columns (case-insensitive): Title (required), Folder, Priority, Type, Status,
 * Preconditions, Steps, Expected, Test data, Tags, Description, Gherkin, Estimate (min), Automation key.
 * "Steps"/"Expected" are newline-separated and paired by line ("1. ..." numbering is stripped).
 */
testCasesRouter.post('/test-cases/import', requireRole('TESTER'), async (req, res) => {
  const text = typeof req.body === 'string' ? req.body : typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!text.trim()) throw badRequest('Send CSV text (Content-Type: text/csv) or JSON {"csv": "..."}');
  const rows = csvToObjects(text);
  if (rows.length > 2000) throw badRequest('Import at most 2000 test cases at a time');
  const get = (r: Record<string, string>, ...names: string[]) => {
    for (const n of names) {
      const hit = Object.entries(r).find(([k]) => k.trim().toLowerCase() === n);
      if (hit && hit[1].trim()) return hit[1].trim();
    }
    return undefined;
  };
  const lines = (s?: string) => (s ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  const errors: { row: number; message: string }[] = [];
  const pid = req.project!.id;
  let imported = 0;
  await prisma.$transaction(
    async (tx) => {
      const folderCache = new Map<string, string>();
      for (const [i, r] of rows.entries()) {
        const title = get(r, 'title', 'name', 'summary');
        if (!title) {
          errors.push({ row: i + 2, message: 'Missing title' });
          continue;
        }
        let folderId: string | null = null;
        const folderName = get(r, 'folder', 'section');
        if (folderName) {
          folderId = folderCache.get(folderName.toLowerCase()) ?? null;
          if (!folderId) {
            const existing = await tx.testFolder.findFirst({ where: { projectId: pid, name: { equals: folderName, mode: 'insensitive' }, parentId: null } });
            folderId = existing?.id ?? (await tx.testFolder.create({ data: { projectId: pid, name: folderName.slice(0, 120) } })).id;
            folderCache.set(folderName.toLowerCase(), folderId);
          }
        }
        const prio = get(r, 'priority')?.toUpperCase();
        const status = get(r, 'status')?.toUpperCase();
        const gherkin = get(r, 'gherkin', 'bdd');
        const actions = lines(get(r, 'steps', 'step', 'actions'));
        const expected = lines(get(r, 'expected', 'expected result', 'expected results'));
        const est = Number(get(r, 'estimate (min)', 'estimate'));
        const number = await nextNumber(tx, pid, 'testCaseSeq');
        const tagIds = await resolveTagIds(tx, pid, get(r, 'tags', 'labels')?.split(/[;,]/).map((t) => t.trim()).filter(Boolean));
        const c = await tx.testCase.create({
          data: {
            projectId: pid,
            number,
            title: title.slice(0, 300),
            folderId,
            description: get(r, 'description') ?? null,
            preconditions: get(r, 'preconditions', 'precondition') ?? null,
            testData: get(r, 'test data', 'data') ?? null,
            priority: priority.safeParse(prio).success ? (prio as z.infer<typeof priority>) : 'MEDIUM',
            status: ['DRAFT', 'ACTIVE', 'DEPRECATED'].includes(status ?? '') ? (status as 'DRAFT') : 'ACTIVE',
            type: get(r, 'type')?.slice(0, 60) ?? 'Functional',
            format: gherkin ? 'GHERKIN' : actions.length ? 'STEPS' : 'TEXT',
            gherkin: gherkin ?? null,
            estimateMinutes: Number.isFinite(est) && est > 0 ? Math.round(est) : null,
            automationKey: get(r, 'automation key') ?? null,
            createdById: req.user!.id,
            updatedById: req.user!.id,
            steps: { create: actions.map((action, idx) => ({ position: idx + 1, action: action.slice(0, 5000), expected: expected[idx]?.slice(0, 5000) ?? null })) },
            tags: { create: tagIds.map((tagId) => ({ tagId })) },
          },
        });
        await snapshot(tx, c.id, req.user!.id);
        imported++;
      }
      await audit(tx, req, { projectId: pid, entityType: 'test_case', entityId: pid, action: 'imported', changes: { count: imported, errors: errors.length } });
    },
    { timeout: 120_000 },
  );
  res.status(201).json({ imported, errors });
});

testCasesRouter.post('/test-cases/bulk', requireRole('TESTER'), async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.string()).min(1).max(500), action: z.enum(['move', 'archive', 'unarchive', 'tag']), folderId: z.string().nullish(), tags: z.array(z.string().max(40)).max(30).optional() }), req.body);
  const pid = req.project!.id;
  const n = await prisma.testCase.count({ where: { id: { in: b.ids }, projectId: pid } });
  if (n !== new Set(b.ids).size) throw notFound('One or more test cases');
  if (b.action === 'move' && b.folderId && !(await prisma.testFolder.findFirst({ where: { id: b.folderId, projectId: pid } }))) throw badRequest('Unknown folder');
  await prisma.$transaction(async (tx) => {
    if (b.action === 'move') await tx.testCase.updateMany({ where: { id: { in: b.ids } }, data: { folderId: b.folderId ?? null } });
    if (b.action === 'archive') await tx.testCase.updateMany({ where: { id: { in: b.ids } }, data: { archivedAt: new Date() } });
    if (b.action === 'unarchive') await tx.testCase.updateMany({ where: { id: { in: b.ids } }, data: { archivedAt: null } });
    if (b.action === 'tag') {
      const tagIds = await resolveTagIds(tx, pid, b.tags ?? []);
      await tx.testCaseTag.createMany({ data: b.ids.flatMap((testCaseId) => tagIds.map((tagId) => ({ testCaseId, tagId }))), skipDuplicates: true });
    }
    await audit(tx, req, { projectId: pid, entityType: 'test_case', entityId: pid, action: `bulk_${b.action}`, changes: { ids: b.ids, folderId: b.folderId, tags: b.tags } });
  });
  res.json({ ok: true, count: n });
});

testCasesRouter.get('/test-cases/:id', async (req, res) => {
  const c = await prisma.testCase.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id }, include: detailInclude });
  if (!c) throw notFound('Test case');
  const results = await prisma.testResult.findMany({
    where: { runItem: { testCaseId: c.id } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { status: true, createdBy: userSel, runItem: { select: { run: { select: { id: true, number: true, name: true } } } } },
  });
  res.json({ testCase: serialize(c), recentResults: results });
});

testCasesRouter.get('/test-cases/:id/revisions', async (req, res) => {
  const c = await prisma.testCase.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!c) throw notFound('Test case');
  const revisions = await prisma.testCaseRevision.findMany({ where: { testCaseId: c.id }, orderBy: { version: 'desc' }, include: { author: userSel } });
  res.json({ revisions });
});

testCasesRouter.patch('/test-cases/:id', requireRole('TESTER'), async (req, res) => {
  const before = await prisma.testCase.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!before) throw notFound('Test case');
  const b = parse(caseBody.partial().extend({ baseVersion: z.number().int().optional() }), req.body);
  if (b.baseVersion !== undefined && b.baseVersion !== before.version) throw badRequest('This test case was changed by someone else; reload to see the latest version');
  if (b.format === 'GHERKIN' || (before.format === 'GHERKIN' && b.gherkin !== undefined)) await validateCaseRefs(req, { ...b, format: 'GHERKIN', gherkin: b.gherkin ?? before.gherkin });
  else await validateCaseRefs(req, b);
  const pid = req.project!.id;
  const customFields = b.customFields ? await validateCustomFields(prisma, pid, 'TEST_CASE', b.customFields, before.customFields) : undefined;
  const data: Record<string, unknown> = {};
  for (const k of SCALARS) if (b[k] !== undefined) data[k] = b[k];
  if (customFields) data.customFields = customFields;
  const updated = await prisma.$transaction(async (tx) => {
    const changes: Record<string, unknown> = diff(before as unknown as Record<string, unknown>, { ...before, ...data }, Object.keys(data));
    if (b.steps) {
      const prev = before.steps.map((s) => ({ action: s.action, expected: s.expected, data: s.data }));
      const next = b.steps.map((s) => ({ action: s.action, expected: s.expected ?? null, data: s.data ?? null }));
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        await tx.testStep.deleteMany({ where: { testCaseId: before.id } });
        await tx.testStep.createMany({ data: next.map((s, i) => ({ ...s, testCaseId: before.id, position: i + 1 })) });
        changes.steps = { from: prev.length, to: next.length };
      }
    }
    if (b.tags) {
      const tagIds = await resolveTagIds(tx, pid, b.tags);
      await tx.testCaseTag.deleteMany({ where: { testCaseId: before.id } });
      await tx.testCaseTag.createMany({ data: tagIds.map((tagId) => ({ testCaseId: before.id, tagId })) });
    }
    if (b.requirementIds) {
      await tx.requirementTestCase.deleteMany({ where: { testCaseId: before.id } });
      await tx.requirementTestCase.createMany({ data: b.requirementIds.map((requirementId) => ({ testCaseId: before.id, requirementId })) });
    }
    // Only content changes create a new version; tags/requirements/folder moves do not.
    const contentChanged = Object.keys(changes).some((k) => !['folderId', 'status'].includes(k));
    const c = await tx.testCase.update({
      where: { id: before.id },
      data: { ...(data as Prisma.TestCaseUncheckedUpdateInput), updatedById: req.user!.id, ...(contentChanged ? { version: { increment: 1 } } : {}) },
    });
    if (contentChanged) await snapshot(tx, c.id, req.user!.id);
    if (Object.keys(changes).length || b.tags || b.requirementIds) {
      await audit(tx, req, { projectId: pid, entityType: 'test_case', entityId: c.id, action: 'updated', changes: { ...changes, ...(b.tags ? { tags: { to: b.tags } } : {}), ...(b.requirementIds ? { requirements: { to: b.requirementIds } } : {}) } });
    }
    return c;
  });
  const full = await prisma.testCase.findUniqueOrThrow({ where: { id: updated.id }, include: detailInclude });
  res.json({ testCase: serialize(full) });
});

testCasesRouter.post('/test-cases/:id/duplicate', requireRole('TESTER'), async (req, res) => {
  const src = await prisma.testCase.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id }, include: { steps: { orderBy: { position: 'asc' } }, tags: true, requirements: true } });
  if (!src) throw notFound('Test case');
  const pid = req.project!.id;
  const copy = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'testCaseSeq');
    const data: Record<string, unknown> = {};
    for (const k of SCALARS) data[k] = (src as Record<string, unknown>)[k];
    const c = await tx.testCase.create({
      data: {
        ...(data as Prisma.TestCaseUncheckedCreateInput),
        title: `${src.title} (copy)`.slice(0, 300),
        projectId: pid,
        number,
        customFields: (src.customFields ?? {}) as Prisma.InputJsonValue,
        createdById: req.user!.id,
        updatedById: req.user!.id,
        steps: { create: src.steps.map((s) => ({ position: s.position, action: s.action, expected: s.expected, data: s.data })) },
        tags: { create: src.tags.map((t) => ({ tagId: t.tagId })) },
        requirements: { create: src.requirements.map((r) => ({ requirementId: r.requirementId })) },
      },
    });
    await snapshot(tx, c.id, req.user!.id);
    await audit(tx, req, { projectId: pid, entityType: 'test_case', entityId: c.id, action: 'duplicated', changes: { from: keys.testCase(src.number) } });
    return c;
  });
  res.status(201).json({ testCase: { ...copy, key: keys.testCase(copy.number) } });
});

for (const action of ['archive', 'unarchive'] as const) {
  testCasesRouter.post(`/test-cases/:id/${action}`, requireRole('TESTER'), async (req, res) => {
    const c = await prisma.testCase.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
    if (!c) throw notFound('Test case');
    await prisma.testCase.update({ where: { id: c.id }, data: { archivedAt: action === 'archive' ? new Date() : null } });
    await audit(prisma, req, { projectId: c.projectId, entityType: 'test_case', entityId: c.id, action: `${action}d` });
    res.json({ ok: true });
  });
}
