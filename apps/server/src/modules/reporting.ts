import path from 'node:path';
import { Router, type Request } from 'express';
import yazl from 'yazl';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError, conflict, forbidden, notFound, parse } from '../lib/errors.js';
import { isOrgAdmin, hasRole, requireRole } from '../middleware/access.js';
import type { AssetMap } from '../reporting/assets.js';
import { renderHtml } from '../reporting/html.js';
import { cancelJob, defaultBaseName, getJob, jobOutputPath, serializeJob, startJob } from '../reporting/jobs.js';
import { buildReportModel } from '../reporting/model.js';
import { getPdfRenderer } from '../reporting/pdf.js';
import {
  BUILT_IN_TEMPLATES,
  FORMATS,
  REPORT_KINDS,
  SECTION_KEYS,
  SECTION_TITLES,
  reportOptionsSchema,
  resolveOptions,
  scopeSchema,
  type ReportOptionsInput,
} from '../reporting/types.js';

export const reportingRouter = Router({ mergeParams: true });

const kind = z.enum(REPORT_KINDS);
const templateBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  kind,
  description: z.string().trim().max(500).nullish(),
  options: reportOptionsSchema.default({}),
});
const generateBody = z.object({
  kind,
  scope: scopeSchema,
  templateId: z.string().max(40).nullish(),
  options: reportOptionsSchema.default({}),
});
const jobBody = generateBody.extend({
  formats: z.array(z.enum(FORMATS)).min(1, 'Choose at least one format').max(4),
  package: z.enum(['none', 'folder', 'zip']).default('none'),
});

async function loadTemplate(req: Request, id: string | null | undefined) {
  if (!id) return null;
  const t = await prisma.reportTemplate.findFirst({ where: { id, orgId: req.user!.orgId } });
  if (!t) throw notFound('Report template');
  return t;
}

/** Built-in defaults, then the saved template, then this request's overrides. */
async function resolveRequest(req: Request, body: z.infer<typeof generateBody>) {
  const t = await loadTemplate(req, body.templateId);
  const saved = t ? (reportOptionsSchema.safeParse(t.options).data ?? {}) : {};
  const k = t?.kind ?? body.kind;
  const raw: ReportOptionsInput = { ...saved, ...body.options, sections: { ...saved.sections, ...body.options.sections }, branding: { ...saved.branding, ...body.options.branding } };
  return { kind: k, raw, options: resolveOptions(k, raw) };
}

reportingRouter.get('/templates', async (req, res) => {
  const saved = await prisma.reportTemplate.findMany({
    where: { orgId: req.user!.orgId },
    orderBy: { name: 'asc' },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  res.json({
    builtIn: REPORT_KINDS.map((k) => {
      const t = BUILT_IN_TEMPLATES[k];
      return { kind: k, name: t.name, description: t.description, sections: t.sections, defaults: t.defaults ?? {}, defaultBaseName: defaultBaseName(k) };
    }),
    saved,
    sections: SECTION_KEYS.map((key) => ({ key, title: SECTION_TITLES[key] })),
    formats: FORMATS,
    pdfAvailable: !!getPdfRenderer(),
  });
});

reportingRouter.post('/templates', requireRole('TESTER'), async (req, res) => {
  const b = parse(templateBody, req.body);
  const exists = await prisma.reportTemplate.findUnique({ where: { orgId_name: { orgId: req.user!.orgId, name: b.name } } });
  if (exists) throw conflict('A report template with this name already exists');
  const t = await prisma.reportTemplate.create({
    data: { orgId: req.user!.orgId, name: b.name, kind: b.kind, description: b.description ?? null, options: b.options as object, createdById: req.user!.id },
  });
  res.status(201).json(t);
});

async function editableTemplate(req: Request) {
  const t = await loadTemplate(req, String(req.params.id));
  if (!t) throw notFound('Report template');
  if (t.createdById !== req.user!.id && !isOrgAdmin(req) && !hasRole(req, 'LEAD')) throw forbidden('Only the creator or a lead can change this template');
  return t;
}

reportingRouter.patch('/templates/:id', requireRole('TESTER'), async (req, res) => {
  const t = await editableTemplate(req);
  const b = parse(templateBody.partial(), req.body);
  if (b.name && b.name !== t.name) {
    const exists = await prisma.reportTemplate.findUnique({ where: { orgId_name: { orgId: req.user!.orgId, name: b.name } } });
    if (exists) throw conflict('A report template with this name already exists');
  }
  const updated = await prisma.reportTemplate.update({
    where: { id: t.id },
    data: { name: b.name, kind: b.kind, description: b.description, options: b.options as object | undefined },
  });
  res.json(updated);
});

reportingRouter.delete('/templates/:id', requireRole('TESTER'), async (req, res) => {
  const t = await editableTemplate(req);
  await prisma.reportTemplate.delete({ where: { id: t.id } });
  res.status(204).end();
});

/** Findings and evidence available in a scope, for the wizard's selection step (filters apply, selections do not). */
reportingRouter.post('/candidates', async (req, res) => {
  const b = parse(generateBody, req.body);
  const { kind: k, raw } = await resolveRequest(req, b);
  const options = resolveOptions(k, { ...raw, findingIds: undefined, excludeEvidenceIds: [], includeImages: true, includeVideos: true, includeAttachments: true, sections: Object.fromEntries(SECTION_KEYS.map((s) => [s, true])) });
  let model;
  try {
    model = await buildReportModel({ projectId: req.project!.id, userName: req.user!.name, kind: k, scope: b.scope, options });
  } catch (err) {
    if (err instanceof AppError && err.status === 400) return void res.json({ findings: [], evidence: [], scopeLabel: null });
    throw err;
  }
  const base = `/api/projects/${req.project!.id}/attachments`;
  res.json({
    scopeLabel: model.scopeLabel,
    findings: model.findings.map((f) => ({ id: f.id, key: f.key, title: f.title, severity: f.severity, priority: f.priority, status: f.status, classification: f.classification, sessionKey: f.sessionKey, evidenceCount: f.evidence.length })),
    evidence: model.evidence.map((x) => ({
      id: x.id,
      kind: x.kind,
      title: x.title,
      fileName: x.fileName,
      size: x.size,
      caption: x.caption,
      findingId: x.findingId,
      findingKey: x.findingKey,
      sessionKey: x.sessionKey,
      durationSeconds: x.durationSeconds,
      annotated: x.annotated,
      thumbUrl: x.displayId ? `${base}/${x.displayId}/content?thumb=1` : x.thumbnailId ? `${base}/${x.thumbnailId}/content?thumb=1` : null,
    })),
  });
});

/** Renders the report as HTML for an in-app preview; evidence loads through the authorized content API. */
reportingRouter.post('/preview', async (req, res) => {
  const b = parse(generateBody, req.body);
  const { kind: k, options } = await resolveRequest(req, b);
  const model = await buildReportModel({ projectId: req.project!.id, userName: req.user!.name, kind: k, scope: b.scope, options });
  const base = `/api/projects/${req.project!.id}/attachments`;
  const assets: AssetMap = new Map();
  for (const x of model.evidence) {
    const w = x.width ?? 1280;
    const h = x.height ?? 720;
    const pv = x.displayId ?? x.thumbnailId;
    assets.set(x.id, {
      ref: x.ref,
      preview: pv ? { rel: `${base}/${pv}/content`, abs: '', width: w, height: h, mime: 'image/png' } : null,
      frames: x.frames.map((f) => ({ rel: `${base}/${f.id}/content`, abs: '', width: w, height: h, mime: 'image/jpeg' as const, timeSeconds: f.timeSeconds })),
      original: null,
      problem: null,
    });
  }
  res.json({
    html: renderHtml(model, assets, { mode: 'html', linkOriginals: false }),
    title: model.title,
    findingCount: model.findings.length,
    evidenceCount: model.evidence.length,
    videoCount: model.evidence.filter((x) => x.kind === 'VIDEO').length,
    sections: model.sections,
    defaultBaseName: defaultBaseName(k),
  });
});

reportingRouter.post('/jobs', async (req, res) => {
  const b = parse(jobBody, req.body);
  const { kind: k, raw, options } = await resolveRequest(req, b);
  const job = startJob({
    userId: req.user!.id,
    userName: req.user!.name,
    orgId: req.user!.orgId,
    projectId: req.project!.id,
    kind: k,
    scope: b.scope,
    options,
    rawOptions: raw,
    formats: b.formats,
    packageMode: b.package,
  });
  res.status(202).json(serializeJob(job));
});

function ownJob(req: Request) {
  const job = getJob(String(req.params.id));
  if (!job || job.userId !== req.user!.id || job.projectId !== req.project!.id) throw notFound('Report job');
  return job;
}

reportingRouter.get('/jobs/:id', (req, res) => {
  res.json(serializeJob(ownJob(req)));
});

reportingRouter.post('/jobs/:id/cancel', (req, res) => {
  const job = ownJob(req);
  cancelJob(job);
  res.json(serializeJob(job));
});

/** Web download: files as-is, folders zipped on the fly (the desktop app copies outputs to a Save As location instead). */
reportingRouter.get('/jobs/:id/download', async (req, res) => {
  const job = ownJob(req);
  const name = String(req.query.name ?? job.outputs[0]?.name ?? '');
  const found = jobOutputPath(job, name);
  if (!found) throw notFound('Report output');
  if (found.output.type === 'file') return void res.download(found.abs, found.output.name, { dotfiles: 'allow' });
  const zip = new yazl.ZipFile();
  const fsp = await import('node:fs/promises');
  for (const e of await fsp.readdir(found.abs, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    zip.addFile(abs, `${found.output.name}/${path.relative(found.abs, abs).split(path.sep).join('/')}`);
  }
  zip.end();
  res.attachment(`${found.output.name}.zip`);
  zip.outputStream.pipe(res);
});

reportingRouter.get('/runs', async (req, res) => {
  const runs = await prisma.reportRun.findMany({
    where: { projectId: req.project!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { createdBy: { select: { id: true, name: true } } },
  });
  res.json(runs.map(({ options: _o, ...r }) => ({ ...r, templateName: BUILT_IN_TEMPLATES[r.kind].name })));
});

/** Full configuration of a previous run, so it can be regenerated (for example in another format). */
reportingRouter.get('/runs/:id', async (req, res) => {
  const run = await prisma.reportRun.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!run) throw notFound('Report run');
  res.json(run);
});
