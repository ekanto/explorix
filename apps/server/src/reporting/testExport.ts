import fsp from 'node:fs/promises';
import type { Prisma } from '@prisma/client';
import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild } from 'docx';
import sharp from 'sharp';
import yazl from 'yazl';
import { prisma } from '../db.js';
import { storage } from '../lib/storage.js';
import { keys } from '../lib/util.js';
import { fmtBytes, fmtDateTime, fmtDuration, humanize, safeFileName } from './text.js';

/**
 * Document exports for test management: a test run (full result history per case) and a set of test cases
 * (latest result from each run). Markdown is a ZIP with the .md file and an attachments/ folder; Word embeds
 * images and lists other files.
 */

type Kind = 'image' | 'video' | 'file';
export interface ExportFile {
  id: string;
  fileName: string;
  /** Path inside the Markdown ZIP. */
  zipPath: string;
  storageKey: string;
  /** Annotated copy shown instead of the original screenshot, when one exists. */
  displayKey: string;
  annotated: boolean;
  kind: Kind;
  mimeType: string;
  size: number;
  sha256: string;
  caption: string | null;
}
export interface ExportResult {
  status: string;
  color: string;
  tester: string;
  at: Date;
  comment: string | null;
  elapsedSeconds: number | null;
  issue: string | null;
  files: ExportFile[];
}
export interface CaseSpec {
  key: string;
  title: string;
  folder: string | null;
  priority: string;
  type: string;
  format: 'STEPS' | 'GHERKIN' | 'TEXT';
  description: string | null;
  preconditions: string | null;
  testData: string | null;
  gherkin: string | null;
  steps: { action: string; expected: string | null; data: string | null }[];
}
export interface RunExportCase extends CaseSpec {
  status: string;
  color: string;
  assignee: string | null;
  results: ExportResult[];
}
export interface RunExportModel {
  key: string;
  name: string;
  description: string | null;
  status: string;
  project: string;
  milestone: string | null;
  plan: string | null;
  environment: string | null;
  createdBy: string;
  createdAt: Date;
  closedAt: Date | null;
  exportedAt: Date;
  appVersion: string;
  cases: RunExportCase[];
}
export interface CasesExportCase extends CaseSpec {
  caseStatus: string;
  tags: string[];
  requirements: string[];
  /** Latest result from each run that executed this case, oldest run first. */
  runs: { run: string; environment: string | null; result: ExportResult }[];
}
export interface CasesExportModel {
  title: string;
  fileBase: string;
  project: string;
  scope: string;
  exportedAt: Date;
  appVersion: string;
  groups: { folder: string; cases: CasesExportCase[] }[];
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const kindOf = (kind: string, mime: string): Kind => (kind === 'IMAGE' || (kind === 'OTHER' && mime.startsWith('image/')) ? 'image' : kind === 'VIDEO' || mime.startsWith('video/') ? 'video' : 'file');

const resultInclude = {
  status: true,
  createdBy: true,
  issue: { select: { number: true, title: true } },
  attachments: {
    where: { deletedAt: null, derivedFromId: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { derivatives: { where: { deletedAt: null, derivation: 'ANNOTATED' }, orderBy: { createdAt: 'desc' }, take: 1 } },
  },
} satisfies Prisma.TestResultInclude;
type ResultRow = Prisma.TestResultGetPayload<{ include: typeof resultInclude }>;

const caseInclude = { folder: true, steps: { orderBy: { position: 'asc' } } } satisfies Prisma.TestCaseInclude;
type CaseRow = Prisma.TestCaseGetPayload<{ include: typeof caseInclude }>;

/** Numbers attachments 01, 02, … in reading order so the ZIP lists them in document order. */
function fileNamer(total: number) {
  let n = 0;
  const width = Math.max(2, String(total).length);
  return (a: ResultRow['attachments'][number]): ExportFile => {
    const annotated = a.derivatives[0];
    return {
      id: a.id,
      fileName: a.fileName,
      zipPath: `attachments/${String(++n).padStart(width, '0')}-${safeFileName(a.fileName, 60)}`,
      storageKey: a.storageKey,
      displayKey: annotated?.storageKey ?? a.storageKey,
      annotated: !!annotated,
      kind: kindOf(a.kind, a.mimeType),
      mimeType: a.mimeType,
      size: a.size,
      sha256: a.sha256,
      caption: a.caption || a.label,
    };
  };
}

const toResult = (x: ResultRow, projectKey: string, file: ReturnType<typeof fileNamer>): ExportResult => ({
  status: x.status.name,
  color: x.status.color,
  tester: x.createdBy.name,
  at: x.createdAt,
  comment: x.comment,
  elapsedSeconds: x.elapsedSeconds,
  issue: x.issue ? `${keys.issue(projectKey, x.issue.number)} ${x.issue.title}` : null,
  files: x.attachments.map(file),
});

const toSpec = (c: CaseRow, folder: string | null): CaseSpec => ({
  key: keys.testCase(c.number),
  title: c.title,
  folder,
  priority: humanize(c.priority),
  type: c.type,
  format: c.format,
  description: c.description,
  preconditions: c.preconditions,
  testData: c.testData,
  gherkin: c.gherkin,
  steps: c.steps.map((s) => ({ action: s.action, expected: s.expected, data: s.data })),
});

/** Full "a / b / c" folder paths in tree order (position, then name). */
export async function folderPaths(projectId: string) {
  const folders = await prisma.testFolder.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  const byParent = new Map<string | null, typeof folders>();
  for (const f of folders) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]);
  const paths = new Map<string, string>();
  const order: string[] = [];
  const walk = (parent: string | null, prefix: string) => {
    for (const f of byParent.get(parent) ?? []) {
      const path = prefix ? `${prefix} / ${f.name}` : f.name;
      paths.set(f.id, path);
      order.push(f.id);
      walk(f.id, path);
    }
  };
  walk(null, '');
  return { paths, order };
}

export async function loadRunExport(project: { id: string; key: string; name: string }, runId: string, appVersion: string): Promise<RunExportModel | null> {
  const r = await prisma.testRun.findFirst({
    where: { id: runId, projectId: project.id },
    include: {
      milestone: true,
      plan: true,
      environment: true,
      createdBy: true,
      items: { orderBy: { position: 'asc' }, include: { testCase: { include: caseInclude }, assignee: true, status: true, results: { orderBy: { createdAt: 'asc' }, include: resultInclude } } },
    },
  });
  if (!r) return null;
  const { paths } = await folderPaths(project.id);
  const file = fileNamer(r.items.reduce((a, i) => a + i.results.reduce((b, x) => b + x.attachments.length, 0), 0));
  return {
    key: keys.testRun(r.number),
    name: r.name,
    description: r.description,
    status: humanize(r.status),
    project: `${project.name} (${project.key})`,
    milestone: r.milestone?.name ?? null,
    plan: r.plan?.name ?? null,
    environment: r.environment?.name ?? null,
    createdBy: r.createdBy.name,
    createdAt: r.createdAt,
    closedAt: r.closedAt,
    exportedAt: new Date(),
    appVersion,
    cases: r.items.map((i) => ({
      ...toSpec(i.testCase, i.testCase.folderId ? (paths.get(i.testCase.folderId) ?? null) : null),
      status: i.status?.name ?? 'Untested',
      color: i.status?.color ?? 'gray',
      assignee: i.assignee?.name ?? null,
      results: i.results.map((x) => toResult(x, project.key, file)),
    })),
  };
}

export const MAX_DOCUMENT_CASES = 2000;

export async function loadCasesExport(project: { id: string; key: string; name: string }, where: Prisma.TestCaseWhereInput, scope: string, appVersion: string): Promise<CasesExportModel> {
  const cases = await prisma.testCase.findMany({
    where,
    orderBy: { number: 'asc' },
    take: MAX_DOCUMENT_CASES,
    include: {
      ...caseInclude,
      tags: { include: { tag: true } },
      requirements: { include: { requirement: { select: { number: true } } } },
      runItems: {
        where: { results: { some: {} } },
        orderBy: { run: { number: 'asc' } },
        include: { run: { include: { environment: true } }, results: { orderBy: { createdAt: 'desc' }, take: 1, include: resultInclude } },
      },
    },
  });
  const { paths, order } = await folderPaths(project.id);
  const file = fileNamer(cases.reduce((a, c) => a + c.runItems.reduce((b, i) => b + (i.results[0]?.attachments.length ?? 0), 0), 0));
  const groups = new Map<string | null, CasesExportCase[]>();
  for (const c of cases) {
    const folder = c.folderId ? (paths.get(c.folderId) ?? null) : null;
    const item: CasesExportCase = {
      ...toSpec(c, folder),
      caseStatus: humanize(c.status),
      tags: c.tags.map((t) => t.tag.name),
      requirements: c.requirements.map((r) => keys.requirement(r.requirement.number)),
      runs: c.runItems.map((i) => ({ run: `${keys.testRun(i.run.number)}: ${i.run.name}`, environment: i.run.environment?.name ?? null, result: toResult(i.results[0]!, project.key, file) })),
    };
    groups.set(c.folderId, [...(groups.get(c.folderId) ?? []), item]);
  }
  return {
    title: `${project.key} test cases`,
    fileBase: `${project.key}-test-cases`,
    project: `${project.name} (${project.key})`,
    scope,
    exportedAt: new Date(),
    appVersion,
    groups: [...order, null].filter((id) => groups.has(id)).map((id) => ({ folder: id ? paths.get(id)! : 'Unfiled', cases: groups.get(id)! })),
  };
}

const exported = (m: { exportedAt: Date; appVersion: string }) => `${fmtDateTime(m.exportedAt)} (Explorix ${m.appVersion})`;
const runCounts = (m: RunExportModel) => {
  const map = new Map<string, number>();
  for (const c of m.cases) map.set(c.status, (map.get(c.status) ?? 0) + 1);
  return [...map.entries()];
};
const runFacts = (m: RunExportModel): [string, string | null][] => [
  ['Project', m.project],
  ['Status', m.status],
  ['Milestone', m.milestone],
  ['Test plan', m.plan],
  ['Environment', m.environment],
  ['Created by', m.createdBy],
  ['Created', fmtDateTime(m.createdAt)],
  ['Closed', m.closedAt ? fmtDateTime(m.closedAt) : null],
  ['Test cases', String(m.cases.length)],
  ['Exported', exported(m)],
];
const casesFacts = (m: CasesExportModel): [string, string | null][] => [
  ['Project', m.project],
  ['Scope', m.scope],
  ['Test cases', String(m.groups.reduce((a, g) => a + g.cases.length, 0))],
  ['Exported', exported(m)],
];
const latest = (c: CasesExportCase) => c.runs.reduce<ExportResult | null>((a, r) => (!a || r.result.at > a.at ? r.result : a), null);
const caseFacts = (c: CasesExportCase) =>
  [`Priority: ${c.priority}`, `Type: ${c.type}`, `Status: ${c.caseStatus}`, c.tags.length ? `Tags: ${c.tags.join(', ')}` : null, c.requirements.length ? `Requirements: ${c.requirements.join(', ')}` : null].filter(
    (x): x is string => !!x,
  );

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const cellMd = (s: string | null | undefined) => (s ? s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>') : '–');
const textMd = (s: string) => s.replace(/\r\n/g, '\n').trim();
/** Markdown link targets: spaces and brackets must be encoded. */
const href = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const fence = (s: string, lang = '') => {
  const ticks = '`'.repeat(Math.max(3, ...[...s.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}${lang}\n${s.trim()}\n${ticks}`;
};
const hashes = (level: number) => '#'.repeat(Math.min(6, level));
const factsTable = (facts: [string, string | null][]) => ['| | |', '|---|---|', ...facts.filter(([, v]) => v).map(([k, v]) => `| ${k} | ${cellMd(v)} |`)];

/** Preconditions, test data and the steps or Gherkin scenario; sub-headings at `level`. */
function specMd(c: CaseSpec, level: number) {
  const out: string[] = [];
  const h = hashes(level);
  if (c.description?.trim() && c.format !== 'TEXT') out.push('', textMd(c.description));
  if (c.preconditions?.trim()) out.push('', `${h} Preconditions`, '', textMd(c.preconditions));
  if (c.testData?.trim()) out.push('', `${h} Test data`, '', textMd(c.testData));
  if (c.format === 'GHERKIN' && c.gherkin?.trim()) out.push('', `${h} Scenario`, '', fence(c.gherkin, 'gherkin'));
  else if (c.format === 'TEXT') out.push('', `${h} Test description`, '', c.description?.trim() ? textMd(c.description) : '_No description._');
  else if (c.steps.length) {
    out.push('', `${h} Steps`, '');
    const indent = (t: string) => t.replace(/\n/g, '\n   ');
    c.steps.forEach((s, i) => {
      out.push(`${i + 1}. ${indent(textMd(s.action))}`);
      if (s.data?.trim()) out.push(`   - _Data:_ ${indent(textMd(s.data))}`);
      if (s.expected?.trim()) out.push(`   - _Expected:_ ${indent(textMd(s.expected))}`);
    });
  }
  return out;
}

function resultMd(r: ExportResult, heading: string) {
  const out = ['', heading];
  const facts = [r.elapsedSeconds ? `Elapsed: ${fmtDuration(r.elapsedSeconds)}` : null, r.issue ? `Issue: ${r.issue}` : null].filter(Boolean);
  if (facts.length) out.push('', facts.map((f) => `- ${f}`).join('\n'));
  if (r.comment?.trim()) out.push('', textMd(r.comment));
  for (const f of r.files) {
    const name = f.fileName.replace(/[[\]]/g, '');
    const note = `_${fmtBytes(f.size)}_${f.caption ? ` · ${f.caption}` : ''}`;
    if (f.kind === 'image') out.push('', `![${(f.caption || f.fileName).replace(/[[\]]/g, '')}](${href(f.zipPath)})`, `_${f.fileName} · ${fmtBytes(f.size)}${f.annotated ? ' · annotated' : ''}_`);
    else if (f.kind === 'video') out.push('', `<video src="${href(f.zipPath)}" controls width="720"></video>`, '', `[${name}](${href(f.zipPath)}) ${note}`);
    else out.push('', `📎 [${name}](${href(f.zipPath)}) ${note}`);
  }
  return out;
}

export function renderRunMarkdown(m: RunExportModel): string {
  const out: string[] = [`# ${m.key}: ${m.name}`, '', ...factsTable(runFacts(m))];
  if (m.description?.trim()) out.push('', textMd(m.description));
  out.push('', '## Summary', '', '| Status | Test cases |', '|---|---:|');
  for (const [s, n] of runCounts(m)) out.push(`| ${cellMd(s)} | ${n} |`);
  out.push('', '| Case | Title | Status | Assignee | Results | Attachments |', '|---|---|---|---|---:|---:|');
  for (const c of m.cases) out.push(`| ${c.key} | ${cellMd(c.title)} | ${cellMd(c.status)} | ${cellMd(c.assignee)} | ${c.results.length} | ${c.results.reduce((a, r) => a + r.files.length, 0)} |`);
  for (const c of m.cases) {
    out.push('', '---', '', `## ${c.key}: ${c.title}`, '');
    out.push(`**Status:** ${c.status} · **Assignee:** ${c.assignee ?? 'Unassigned'} · **Priority:** ${c.priority} · **Type:** ${c.type}${c.folder ? ` · **Folder:** ${c.folder}` : ''}`);
    out.push(...specMd(c, 3), '', `### Results (${c.results.length})`);
    if (!c.results.length) out.push('', '_Not tested yet._');
    c.results.forEach((r, i) => out.push(...resultMd(r, `#### ${i + 1}. ${r.status} · ${r.tester} · ${fmtDateTime(r.at)}`)));
  }
  out.push('');
  return out.join('\n');
}

export function renderCasesMarkdown(m: CasesExportModel): string {
  const out: string[] = [`# ${m.title}`, '', ...factsTable(casesFacts(m))];
  out.push('', '## Contents', '', '| Case | Title | Folder | Priority | Latest result | Runs |', '|---|---|---|---|---|---:|');
  for (const g of m.groups) for (const c of g.cases) out.push(`| ${c.key} | ${cellMd(c.title)} | ${cellMd(g.folder)} | ${c.priority} | ${cellMd(latest(c)?.status ?? 'Never run')} | ${c.runs.length} |`);
  for (const g of m.groups) {
    out.push('', '---', '', `## 📁 ${g.folder}`);
    for (const c of g.cases) {
      out.push('', `### ${c.key}: ${c.title}`, '', caseFacts(c).map((f) => f.replace(/^([^:]+):/, '**$1:**')).join(' · '));
      out.push(...specMd(c, 4), '', `#### Latest result per run (${c.runs.length})`);
      if (!c.runs.length) out.push('', '_Never run._');
      for (const r of c.runs) out.push(...resultMd(r.result, `##### ${r.run}${r.environment ? ` (${r.environment})` : ''} · ${r.result.status} · ${r.result.tester} · ${fmtDateTime(r.result.at)}`));
    }
  }
  out.push('');
  return out.join('\n');
}

/** Streams a ZIP with the Markdown file and every attachment (annotated copies for annotated screenshots). */
async function zipWith(markdown: string, mdName: string, files: ExportFile[]) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(markdown, 'utf8'), mdName);
  for (const f of files) {
    const p = storage.localPath(f.kind === 'image' ? f.displayKey : f.storageKey);
    if (await fsp.access(p).then(() => true, () => false)) zip.addFile(p, f.zipPath);
  }
  zip.end();
  return zip.outputStream;
}
export const runMarkdownZip = (m: RunExportModel) => zipWith(renderRunMarkdown(m), `${m.key}.md`, m.cases.flatMap((c) => c.results.flatMap((r) => r.files)));
export const casesMarkdownZip = (m: CasesExportModel) => zipWith(renderCasesMarkdown(m), `${m.fileBase}.md`, m.groups.flatMap((g) => g.cases.flatMap((c) => c.runs.flatMap((r) => r.result.files))));

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

const COLORS: Record<string, string> = {
  green: '2F9E44', teal: '0C8599', red: 'E03131', pink: 'C2255C', grape: '9C36B5', violet: '7048E8', indigo: '4263EB',
  blue: '1C7ED6', cyan: '1098AD', lime: '66A80F', yellow: 'E67700', orange: 'E8590C', gray: '868E96', dark: '343A40',
};
const ACCENT = '5F3DC4';
const MUTED = '5C6370';
const SOFT = 'F1F3F7';
const MAX_W = 620;
const MAX_H = 700;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4] as const;
type Block = Paragraph | Table;
type Style = Partial<{ bold: boolean; color: string; size: number; italics: boolean; font: string }>;
type CellValue = string | ParagraphChild[] | null;

const runs = (text: string, extra: Style = {}) => text.split(/\r?\n/).map((line, i) => new TextRun({ text: line, break: i ? 1 : 0, ...extra }));
const para = (text: string, extra: Style = {}) => new Paragraph({ children: runs(text, extra) });
const heading = (text: string, level: number, pageBreakBefore = false) => new Paragraph({ heading: HEADINGS[Math.min(3, level - 1)], children: [new TextRun(text)], keepNext: true, pageBreakBefore });
const badge = (s: string, color: string) =>
  new TextRun({ text: ` ${s} `, bold: true, color: 'FFFFFF', size: 18, shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS[color] ?? (/^#?[0-9a-f]{6}$/i.test(color) ? color.replace('#', '') : COLORS.gray) } });
const cell = (v: CellValue, header = false, w?: number) =>
  new TableCell({
    children: [Array.isArray(v) ? new Paragraph({ children: v }) : new Paragraph({ children: runs(v || '–', { bold: header, size: 18, color: v ? undefined : MUTED }), spacing: { after: 0 } })],
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: SOFT } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
  });
const table = (head: string[], rows: CellValue[][], widths?: number[]) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: head.map((x, i) => cell(x, true, widths?.[i])) }), ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((x, i) => cell(x, false, widths?.[i])) }))],
  });
const kv = (rows: [string, string | null][]) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.filter(([, v]) => v).map(([k, v]) => new TableRow({ children: [cell(k, true, 28), cell(v, false, 72)] })) });
const code = (text: string) =>
  text.split(/\r?\n/).map((l, i, all) => new Paragraph({ children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 18 })], shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT }, spacing: { after: i === all.length - 1 ? 120 : 0, line: 240 } }));

async function imageRun(f: ExportFile): Promise<ImageRun | null> {
  try {
    const img = sharp(storage.localPath(f.displayKey), { failOn: 'error' }).rotate().resize({ width: 1400, withoutEnlargement: true });
    const png = f.mimeType === 'image/png' || f.mimeType === 'image/gif';
    const { data, info } = png ? await img.png().toBuffer({ resolveWithObject: true }) : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const s = Math.min(1, MAX_W / info.width, MAX_H / info.height);
    const alt = (f.caption || f.fileName).slice(0, 120);
    return new ImageRun({ type: png ? 'png' : 'jpg', data, transformation: { width: Math.round(info.width * s), height: Math.round(info.height * s) }, altText: { name: alt, description: alt, title: alt } });
  } catch {
    return null;
  }
}

function specDocx(c: CaseSpec, level: number): Block[] {
  const out: Block[] = [];
  if (c.description?.trim() && c.format !== 'TEXT') out.push(para(c.description.trim()));
  if (c.preconditions?.trim()) out.push(heading('Preconditions', level + 1), para(c.preconditions.trim()));
  if (c.testData?.trim()) out.push(heading('Test data', level + 1), para(c.testData.trim()));
  if (c.format === 'GHERKIN' && c.gherkin?.trim()) out.push(heading('Scenario', level), ...code(c.gherkin.trim()));
  else if (c.format === 'TEXT') out.push(heading('Test description', level), para(c.description?.trim() || 'No description.', c.description?.trim() ? {} : { italics: true, color: MUTED }));
  else if (c.steps.length) out.push(heading('Steps', level), table(['#', 'Action', 'Expected result'], c.steps.map((s, i) => [String(i + 1), s.data?.trim() ? `${s.action}\nData: ${s.data}` : s.action, s.expected]), [6, 52, 42]));
  return out;
}

/** One result: a heading line, facts, comment, embedded images and a list of other files. */
async function resultDocx(r: ExportResult, label: ParagraphChild[], fileList: () => number): Promise<Block[]> {
  const out: Block[] = [new Paragraph({ keepNext: true, spacing: { before: 200 }, children: [...label, badge(r.status, r.color), new TextRun({ text: `  ${r.tester} · ${fmtDateTime(r.at)}`, color: MUTED })] })];
  const facts = [r.elapsedSeconds ? `Elapsed: ${fmtDuration(r.elapsedSeconds)}` : null, r.issue ? `Issue: ${r.issue}` : null].filter((x): x is string => !!x);
  if (facts.length) out.push(para(facts.join(' · '), { size: 18, color: MUTED }));
  if (r.comment?.trim()) out.push(para(r.comment.trim()));
  const others: ExportFile[] = [];
  for (const f of r.files) {
    const img = f.kind === 'image' ? await imageRun(f) : null;
    if (!img) {
      others.push(f);
      continue;
    }
    out.push(new Paragraph({ children: [img], keepNext: true, spacing: { before: 120, after: 40 } }));
    out.push(new Paragraph({ children: [new TextRun({ text: `${f.caption || f.fileName}${f.annotated ? ' (annotated)' : ''} · ${fmtBytes(f.size)}`, size: 17, color: MUTED, italics: true })] }));
  }
  if (others.length) {
    const instance = fileList();
    out.push(para('Attached files (not embedded):', { size: 18, bold: true }));
    for (const f of others)
      out.push(
        new Paragraph({
          numbering: { reference: 'files', level: 0, instance },
          children: [new TextRun({ text: f.fileName, font: 'Consolas', size: 17 }), new TextRun({ text: ` · ${humanize(f.kind)} · ${fmtBytes(f.size)}${f.caption ? ` · ${f.caption}` : ''} · SHA-256 ${f.sha256.slice(0, 16)}…`, size: 17, color: MUTED })],
        }),
      );
  }
  return out;
}

function packDocx(title: string, subject: string, appVersion: string, body: Block[]) {
  const doc = new Document({
    creator: `Explorix ${appVersion}`,
    title,
    subject,
    styles: {
      default: { document: { run: { font: 'Segoe UI', size: 21 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 44, bold: true, color: ACCENT }, paragraph: { spacing: { after: 240 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 4 } }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '1F2430' }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '343A46' }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, color: '495057' }, paragraph: { spacing: { before: 140, after: 40 }, outlineLevel: 3 } },
      ],
    },
    numbering: { config: [{ reference: 'files', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 400, hanging: 240 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 850, right: 850 } } }, children: body }],
  });
  return Packer.toBuffer(doc);
}

const counter = () => {
  let n = 0;
  return () => ++n;
};

export async function renderRunDocx(m: RunExportModel): Promise<Buffer> {
  const fileList = counter();
  const body: Block[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`${m.key}: ${m.name}`)] }), kv(runFacts(m))];
  if (m.description?.trim()) body.push(new Paragraph({ children: [] }), para(m.description.trim()));
  body.push(heading('Summary', 1), table(['Status', 'Test cases'], runCounts(m).map(([s, n]) => [s, String(n)]), [70, 30]), new Paragraph({ children: [] }));
  body.push(table(['Case', 'Title', 'Status', 'Assignee', 'Results'], m.cases.map((c) => [c.key, c.title, [badge(c.status, c.color)], c.assignee, String(c.results.length)]), [12, 44, 16, 18, 10]));
  for (const c of m.cases) {
    body.push(heading(`${c.key}: ${c.title}`, 1, true));
    body.push(new Paragraph({ children: [badge(c.status, c.color), new TextRun({ text: `   Assignee: ${c.assignee ?? 'Unassigned'} · Priority: ${c.priority} · Type: ${c.type}${c.folder ? ` · Folder: ${c.folder}` : ''}`, color: MUTED, size: 18 })] }));
    body.push(...specDocx(c, 2), heading(`Results (${c.results.length})`, 2));
    if (!c.results.length) body.push(para('Not tested yet.', { italics: true, color: MUTED }));
    for (const [i, r] of c.results.entries()) body.push(...(await resultDocx(r, [new TextRun({ text: `${i + 1}. `, bold: true })], fileList)));
  }
  return packDocx(`${m.key}: ${m.name}`, m.project, m.appVersion, body);
}

export async function renderCasesDocx(m: CasesExportModel): Promise<Buffer> {
  const fileList = counter();
  const body: Block[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(m.title)] }), kv(casesFacts(m)), heading('Contents', 1)];
  body.push(
    table(
      ['Case', 'Title', 'Folder', 'Latest result', 'Runs'],
      m.groups.flatMap((g) =>
        g.cases.map((c): CellValue[] => {
          const l = latest(c);
          return [c.key, c.title, g.folder, l ? [badge(l.status, l.color)] : 'Never run', String(c.runs.length)];
        }),
      ),
      [10, 40, 28, 14, 8],
    ),
  );
  for (const g of m.groups) {
    body.push(heading(g.folder, 1, true));
    for (const c of g.cases) {
      body.push(heading(`${c.key}: ${c.title}`, 2), para(caseFacts(c).join(' · '), { size: 18, color: MUTED }));
      body.push(...specDocx(c, 3), heading(`Latest result per run (${c.runs.length})`, 3));
      if (!c.runs.length) body.push(para('Never run.', { italics: true, color: MUTED }));
      for (const r of c.runs) body.push(...(await resultDocx(r.result, [new TextRun({ text: `${r.run}${r.environment ? ` (${r.environment})` : ''}  `, bold: true })], fileList)));
    }
  }
  return packDocx(m.title, m.project, m.appVersion, body);
}
