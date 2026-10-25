import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ReportKind } from '@prisma/client';
import yazl from 'yazl';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { AppError } from '../lib/errors.js';
import { freeBytes } from '../lib/storage.js';
import { logger } from '../logger.js';
import { CancelledError, checkAbort, originalsBytes, prepareAssets, type AssetMap } from './assets.js';
import { renderDocx } from './docx.js';
import { renderHtml } from './html.js';
import { renderMarkdown } from './markdown.js';
import { buildReportModel } from './model.js';
import { getPdfRenderer } from './pdf.js';
import { fmtDate, fmtDateTime, fmtTimecode, humanize, safeFileName } from './text.js';
import { BUILT_IN_TEMPLATES, type ReportFormat, type ReportModel, type ReportOptions, type ReportOptionsInput, type ReportScope } from './types.js';

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type PackageMode = 'none' | 'folder' | 'zip';

export interface JobOutput {
  /** File or folder name inside the job directory (also the suggested save name). */
  name: string;
  type: 'file' | 'folder';
  formats: ReportFormat[];
  bytes: number;
  description: string;
}

export interface ReportJob {
  id: string;
  userId: string;
  orgId: string;
  projectId: string;
  runId: string | null;
  status: JobStatus;
  phase: string;
  progress: number;
  error: string | null;
  warnings: string[];
  baseName: string;
  formats: ReportFormat[];
  packageMode: PackageMode;
  outputs: JobOutput[];
  findingCount: number;
  evidenceCount: number;
  createdAt: Date;
  finishedAt: Date | null;
  dir: string;
  controller: AbortController;
}

export interface JobRequest {
  userId: string;
  userName: string;
  orgId: string;
  projectId: string;
  kind: ReportKind;
  scope: ReportScope;
  options: ReportOptions;
  /** As submitted, stored on the ReportRun so the same configuration can be regenerated. */
  rawOptions: ReportOptionsInput;
  formats: ReportFormat[];
  packageMode: PackageMode;
}

const jobs = new Map<string, ReportJob>();
const JOB_TTL_MS = 2 * 60 * 60_000;
const MAX_RUNNING_PER_USER = 2;
export const jobsRoot = () => path.resolve(config.WORK_DIR, 'report-jobs');

/** Public, path-free job view returned to clients. */
export const serializeJob = (j: ReportJob) => ({
  id: j.id,
  runId: j.runId,
  status: j.status,
  phase: j.phase,
  progress: Math.round(j.progress),
  error: j.error,
  warnings: j.warnings,
  baseName: j.baseName,
  formats: j.formats,
  packageMode: j.packageMode,
  outputs: j.outputs,
  findingCount: j.findingCount,
  evidenceCount: j.evidenceCount,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
});

export function getJob(id: string): ReportJob | undefined {
  return jobs.get(id);
}

/** Absolute path of a finished output, or null. Names are matched against the job's own list, never joined blindly. */
export function jobOutputPath(job: ReportJob, name: string): { abs: string; output: JobOutput } | null {
  if (job.status !== 'done') return null;
  const output = job.outputs.find((o) => o.name === name);
  return output ? { abs: path.join(job.dir, output.name), output } : null;
}

export function cancelJob(job: ReportJob) {
  if (job.status === 'running') job.controller.abort();
}

export function defaultBaseName(kind: ReportKind, date = new Date()) {
  return `Explorix_${BUILT_IN_TEMPLATES[kind].fileLabel}_${fmtDate(date)}`;
}

export function startJob(req: JobRequest): ReportJob {
  sweep();
  const running = [...jobs.values()].filter((j) => j.userId === req.userId && j.status === 'running').length;
  if (running >= MAX_RUNNING_PER_USER) throw new AppError(429, 'too_many_jobs', 'Wait for your current report to finish before starting another.');
  if (req.formats.includes('pdf') && !getPdfRenderer()) throw new AppError(400, 'pdf_unavailable', 'PDF export is not available in this environment (it requires the Explorix desktop app or a configured Chromium renderer).');
  const id = crypto.randomUUID();
  const job: ReportJob = {
    id,
    userId: req.userId,
    orgId: req.orgId,
    projectId: req.projectId,
    runId: null,
    status: 'running',
    phase: 'Collecting report data',
    progress: 0,
    error: null,
    warnings: [],
    baseName: safeFileName(defaultBaseName(req.kind), 100),
    formats: [...new Set(req.formats)],
    packageMode: req.packageMode,
    outputs: [],
    findingCount: 0,
    evidenceCount: 0,
    createdAt: new Date(),
    finishedAt: null,
    dir: path.join(jobsRoot(), id),
    controller: new AbortController(),
  };
  jobs.set(id, job);
  void run(job, req);
  return job;
}

/** Runs a job to completion and resolves when it settles (used by tests and the desktop shell). */
export async function waitForJob(job: ReportJob, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  while (job.status === 'running') {
    if (Date.now() > until) throw new Error('Timed out waiting for report job');
    await new Promise((r) => setTimeout(r, 50));
  }
  return job;
}

function sweep() {
  const now = Date.now();
  for (const j of jobs.values()) {
    if (j.status !== 'running' && j.finishedAt && now - j.finishedAt.getTime() > JOB_TTL_MS) {
      jobs.delete(j.id);
      void fsp.rm(j.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
setInterval(sweep, 10 * 60_000).unref();

async function run(job: ReportJob, req: JobRequest) {
  const signal = job.controller.signal;
  const set = (phase: string, progress: number) => {
    job.phase = phase;
    job.progress = progress;
  };
  try {
    await fsp.mkdir(job.dir, { recursive: true });
    const model = await buildReportModel({ projectId: req.projectId, userName: req.userName, kind: req.kind, scope: req.scope, options: req.options });
    job.findingCount = model.findings.length;
    job.evidenceCount = model.evidence.length;
    const run = await prisma.reportRun.create({
      data: {
        projectId: req.projectId,
        createdById: req.userId,
        title: model.title,
        kind: req.kind,
        formats: job.formats,
        scope: req.scope,
        options: req.rawOptions as object,
        status: 'running',
        findingCount: model.findings.length,
        evidenceCount: model.evidence.length,
      },
    });
    job.runId = run.id;
    checkAbort(signal);

    const packaged = job.packageMode !== 'none';
    // Markdown/HTML always ship as a folder with their evidence; a package bundles every format.
    const folderFormats = job.formats.filter((f) => packaged || f === 'md' || f === 'html');
    const loneFormats = job.formats.filter((f) => !folderFormats.includes(f));
    const needsFolder = folderFormats.length > 0;
    const folder = path.join(job.dir, job.baseName);
    const assetRoot = needsFolder ? folder : path.join(job.dir, '_stage');

    const need = (needsFolder ? originalsBytes(model) * (job.packageMode === 'zip' ? 2 : 1) : 0) + 64 * 1024 * 1024;
    const free = await freeBytes(job.dir);
    if (free != null && free < need) throw new AppError(507, 'insufficient_storage', `Not enough free disk space to generate this report (needs about ${Math.ceil(need / 1024 / 1024)} MB).`);

    set('Preparing evidence', 5);
    const assets = await prepareAssets(model, assetRoot, {
      copyOriginals: needsFolder,
      signal,
      onProgress: (d, t) => set(`Preparing evidence (${d}/${t})`, 5 + (50 * d) / Math.max(1, t)),
    });
    for (const x of model.evidence) {
      const a = assets.get(x.id);
      if (a?.problem) job.warnings.push(`${x.ref} (${x.fileName}): ${a.problem}`);
    }

    const step = 35 / Math.max(1, job.formats.length);
    let p = 55;
    const render = async (fmt: ReportFormat, dir: string, linkOriginals: boolean) => {
      set(`Rendering ${fmt.toUpperCase()}`, p);
      checkAbort(signal);
      const out = path.join(dir, `${job.baseName}.${fmt}`);
      if (fmt === 'md') await fsp.writeFile(out, renderMarkdown(model, assets, { linkOriginals }), 'utf8');
      else if (fmt === 'html') await fsp.writeFile(out, renderHtml(model, assets, { mode: 'html', linkOriginals }), 'utf8');
      else if (fmt === 'docx') await fsp.writeFile(out, await renderDocx(model, assets, { linkOriginals }));
      else {
        // The print HTML lives next to the evidence so relative image paths resolve, then is removed.
        const tmp = path.join(assetRoot, `.print-${job.id}.html`);
        await fsp.writeFile(tmp, renderHtml(model, assets, { mode: 'pdf', linkOriginals }), 'utf8');
        try {
          await getPdfRenderer()!({ htmlPath: tmp, outPath: out, title: model.title, footerLabel: `${model.project.key} · ${fmtDateTime(model.generatedAt)}`, landscape: model.options.orientation === 'landscape', signal });
        } finally {
          await fsp.rm(tmp, { force: true });
        }
        checkAbort(signal);
      }
      p += step;
    };

    for (const f of folderFormats) await render(f, folder, true);
    for (const f of loneFormats) {
      await render(f, job.dir, false);
      const st = await fsp.stat(path.join(job.dir, `${job.baseName}.${f}`));
      job.outputs.push({ name: `${job.baseName}.${f}`, type: 'file', formats: [f], bytes: st.size, description: `${f.toUpperCase()} report` });
    }

    if (needsFolder) {
      if (packaged) {
        set('Writing manifest', 90);
        await writeManifest(model, assets, folder, folderFormats);
      }
      if (job.packageMode === 'zip') {
        set('Compressing package', 92);
        const zipName = `${job.baseName}.zip`;
        await zipFolder(folder, path.join(job.dir, zipName), job.baseName, signal);
        await fsp.rm(folder, { recursive: true, force: true });
        const st = await fsp.stat(path.join(job.dir, zipName));
        job.outputs.unshift({ name: zipName, type: 'file', formats: folderFormats, bytes: st.size, description: 'Report package (ZIP) with evidence and manifest' });
      } else {
        job.outputs.unshift({
          name: job.baseName,
          type: 'folder',
          formats: folderFormats,
          bytes: await dirSize(folder),
          description: packaged ? 'Report package folder with evidence and manifest' : `${folderFormats.map((f) => f.toUpperCase()).join(' + ')} report folder with evidence`,
        });
      }
    }
    await fsp.rm(path.join(job.dir, '_stage'), { recursive: true, force: true });

    job.status = 'done';
    set('Done', 100);
    await prisma.reportRun.update({ where: { id: run.id }, data: { status: 'done', completedAt: new Date() } }).catch(() => undefined);
  } catch (err) {
    const cancelled = err instanceof CancelledError || signal.aborted;
    job.status = cancelled ? 'cancelled' : 'failed';
    job.error = cancelled ? 'Report generation was cancelled.' : describeError(err);
    if (!cancelled && !(err instanceof AppError)) logger.error({ err }, 'Report job failed');
    job.outputs = [];
    await fsp.rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
    if (job.runId) await prisma.reportRun.update({ where: { id: job.runId }, data: { status: job.status, error: job.error, completedAt: new Date() } }).catch(() => undefined);
  } finally {
    job.finishedAt = new Date();
  }
}

function describeError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') return 'The disk ran out of space while writing the report.';
  if (code === 'EACCES' || code === 'EPERM') return 'Explorix was not allowed to write the report files.';
  if (/Executable doesn't exist|browserType\.launch/i.test(String((err as Error)?.message))) return 'PDF rendering failed: the Chromium renderer is not installed.';
  return 'The report could not be generated. See the application log for details.';
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await fsp.stat(path.join(e.parentPath, e.name))).size;
  }
  return total;
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Streams a folder into a ZIP whose entries live under `<prefix>/`. */
export async function zipFolder(dir: string, dest: string, prefix: string, signal?: AbortSignal) {
  const zip = new yazl.ZipFile();
  for (const rel of await listFiles(dir)) {
    const already = /\.(png|jpe?g|webp|mp4|webm|mov|zip|docx|pdf)$/i.test(rel);
    zip.addFile(path.join(dir, ...rel.split('/')), `${prefix}/${rel}`, { compress: !already });
  }
  zip.end();
  try {
    await pipeline(zip.outputStream, fs.createWriteStream(dest, { flags: 'wx' }), { signal });
  } catch (err) {
    await fsp.rm(dest, { force: true });
    if ((err as Error).name === 'AbortError') throw new CancelledError();
    throw err;
  }
}

/** manifest.json + README.md: everything is described by relative paths, never by local absolute paths. */
async function writeManifest(m: ReportModel, assets: AssetMap, folder: string, formats: ReportFormat[]) {
  const reports = formats.map((f) => `${path.basename(folder)}.${f}`);
  const manifest = {
    format: 'explorix-report-package',
    version: 1,
    generator: `Explorix ${m.appVersion}`,
    generatedAt: m.generatedAt.toISOString(),
    report: { title: m.title, template: m.templateName, kind: m.kind, project: { key: m.project.key, name: m.project.name }, scope: m.scopeLabel, files: reports },
    findings: m.findings.map((f) => ({ key: f.key, title: f.title, severity: f.severity, status: f.status, evidence: f.evidence.map((x) => x.ref) })),
    evidence: m.evidence.map((x) => {
      const a = assets.get(x.id)!;
      return {
        ref: x.ref,
        kind: x.kind,
        title: x.title,
        originalFileName: x.fileName,
        path: a.original?.rel ?? null,
        mimeType: x.mimeType,
        bytes: x.size,
        sha256: x.sha256,
        checksumVerified: a.original?.verified ?? false,
        caption: x.caption,
        description: x.description,
        width: x.width,
        height: x.height,
        durationSeconds: x.durationSeconds,
        linkedTo: x.findingKey ?? x.sessionKey,
        annotatedPreview: x.annotated,
        previews: [a.preview, ...a.frames].filter(Boolean).map((i) => i!.rel),
        markers: x.markers.map((mk) => ({ timeSeconds: mk.timeSeconds, timecode: fmtTimecode(mk.timeSeconds), label: mk.label, note: mk.note })),
        problem: a.problem,
      };
    }),
  };
  await fsp.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const videos = m.evidence.filter((x) => x.kind === 'VIDEO').length;
  const readme = `# ${m.title}

Report package generated by Explorix ${m.appVersion} on ${fmtDateTime(m.generatedAt)}.

- Project: ${m.project.name} (${m.project.key})
- Report type: ${m.templateName}
- Scope: ${m.scopeLabel}
- Findings: ${m.findings.length}
- Evidence items: ${m.evidence.length}${videos ? ` (including ${videos} video${videos === 1 ? '' : 's'})` : ''}

## Contents

| Path | Description |
| --- | --- |
${reports.map((r) => `| \`${r}\` | ${describeFormat(r)} |`).join('\n')}
| \`evidence/\` | Original evidence files, byte-for-byte copies (named \`E<ref>-<file name>\`). |
| \`evidence/previews/\` | Report-sized copies of screenshots, video thumbnails and selected video frames. Originals are never modified. |
| \`manifest.json\` | Machine-readable index: every evidence item with its SHA-256 checksum, linked finding, markers and file paths. |
| \`README.md\` | This file. |

## Using this package

All links are **relative**, so the package keeps working when the folder is moved, copied to another computer or
extracted from a ZIP. Keep the report files and the \`evidence\` folder together.

Videos: PDF and Word documents cannot reliably play video, so each video appears as a preview image with its
duration, selected frames and important timestamps, and refers to the original file under \`evidence/\`.
The HTML report plays videos directly when the format is supported by your browser; the Markdown report links to them.

## Verifying evidence integrity

Each original's SHA-256 checksum is listed in \`manifest.json\` and in the report's evidence index. On Windows:

\`\`\`powershell
Get-FileHash -Algorithm SHA256 .\\evidence\\<file>
\`\`\`
`;
  await fsp.writeFile(path.join(folder, 'README.md'), readme, 'utf8');
}

function describeFormat(file: string) {
  const ext = file.split('.').pop();
  return { pdf: 'PDF report (print-ready)', docx: 'Editable Microsoft Word report', md: 'Markdown report', html: 'Standalone HTML report (open in any browser, works offline)' }[ext as ReportFormat] ?? humanize(ext);
}
