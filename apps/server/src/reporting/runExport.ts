import fsp from 'node:fs/promises';
import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild } from 'docx';
import sharp from 'sharp';
import yazl from 'yazl';
import { prisma } from '../db.js';
import { storage } from '../lib/storage.js';
import { keys } from '../lib/util.js';
import { fmtBytes, fmtDateTime, fmtDuration, humanize, safeFileName } from './text.js';

/**
 * Test run export with full result history, test case content and attachments:
 * Markdown (ZIP with RUN-n.md + attachments/) or Word (images embedded, other files listed).
 */

type Kind = 'image' | 'video' | 'file';
export interface RunExportFile {
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
export interface RunExportResult {
  status: string;
  color: string;
  tester: string;
  at: Date;
  comment: string | null;
  elapsedSeconds: number | null;
  issue: string | null;
  files: RunExportFile[];
}
export interface RunExportCase {
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
  status: string;
  color: string;
  assignee: string | null;
  results: RunExportResult[];
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

const kindOf = (kind: string, mime: string): Kind => (kind === 'IMAGE' || (kind === 'OTHER' && mime.startsWith('image/')) ? 'image' : kind === 'VIDEO' || mime.startsWith('video/') ? 'video' : 'file');

export async function loadRunExport(project: { id: string; key: string; name: string }, runId: string, appVersion: string): Promise<RunExportModel | null> {
  const r = await prisma.testRun.findFirst({
    where: { id: runId, projectId: project.id },
    include: {
      milestone: true,
      plan: true,
      environment: true,
      createdBy: true,
      items: {
        orderBy: { position: 'asc' },
        include: {
          testCase: { include: { folder: true, steps: { orderBy: { position: 'asc' } } } },
          assignee: true,
          status: true,
          results: {
            orderBy: { createdAt: 'asc' },
            include: {
              status: true,
              createdBy: true,
              issue: { select: { number: true, title: true } },
              attachments: {
                where: { deletedAt: null, derivedFromId: null },
                orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                include: { derivatives: { where: { deletedAt: null, derivation: 'ANNOTATED' }, orderBy: { createdAt: 'desc' }, take: 1 } },
              },
            },
          },
        },
      },
    },
  });
  if (!r) return null;
  let n = 0;
  const width = String(r.items.reduce((a, i) => a + i.results.reduce((b, x) => b + x.attachments.length, 0), 0)).length;
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
    cases: r.items.map((i) => {
      const c = i.testCase;
      return {
        key: keys.testCase(c.number),
        title: c.title,
        folder: c.folder?.name ?? null,
        priority: humanize(c.priority),
        type: c.type,
        format: c.format,
        description: c.description,
        preconditions: c.preconditions,
        testData: c.testData,
        gherkin: c.gherkin,
        steps: c.steps.map((s) => ({ action: s.action, expected: s.expected, data: s.data })),
        status: i.status?.name ?? 'Untested',
        color: i.status?.color ?? 'gray',
        assignee: i.assignee?.name ?? null,
        results: i.results.map((x) => ({
          status: x.status.name,
          color: x.status.color,
          tester: x.createdBy.name,
          at: x.createdAt,
          comment: x.comment,
          elapsedSeconds: x.elapsedSeconds,
          issue: x.issue ? `${keys.issue(project.key, x.issue.number)} ${x.issue.title}` : null,
          files: x.attachments.map((a) => {
            const annotated = a.derivatives[0];
            return {
              id: a.id,
              fileName: a.fileName,
              zipPath: `attachments/${String(++n).padStart(Math.max(2, width), '0')}-${safeFileName(a.fileName, 60)}`,
              storageKey: a.storageKey,
              displayKey: annotated?.storageKey ?? a.storageKey,
              annotated: !!annotated,
              kind: kindOf(a.kind, a.mimeType),
              mimeType: a.mimeType,
              size: a.size,
              sha256: a.sha256,
              caption: a.caption || a.label,
            };
          }),
        })),
      };
    }),
  };
}

const counts = (m: RunExportModel) => {
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
  ['Exported', `${fmtDateTime(m.exportedAt)} (Explorix ${m.appVersion})`],
];

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

export function renderRunMarkdown(m: RunExportModel): string {
  const out: string[] = [`# ${m.key}: ${m.name}`, '', '| | |', '|---|---|'];
  for (const [k, v] of runFacts(m)) if (v) out.push(`| ${k} | ${cellMd(v)} |`);
  if (m.description?.trim()) out.push('', textMd(m.description));
  out.push('', '## Summary', '', '| Status | Test cases |', '|---|---:|');
  for (const [s, n] of counts(m)) out.push(`| ${cellMd(s)} | ${n} |`);
  out.push('', '| Case | Title | Status | Assignee | Results | Attachments |', '|---|---|---|---|---:|---:|');
  for (const c of m.cases) out.push(`| ${c.key} | ${cellMd(c.title)} | ${cellMd(c.status)} | ${cellMd(c.assignee)} | ${c.results.length} | ${c.results.reduce((a, r) => a + r.files.length, 0)} |`);

  for (const c of m.cases) {
    out.push('', '---', '', `## ${c.key}: ${c.title}`, '');
    out.push(`**Status:** ${c.status} · **Assignee:** ${c.assignee ?? 'Unassigned'} · **Priority:** ${c.priority} · **Type:** ${c.type}${c.folder ? ` · **Folder:** ${c.folder}` : ''}`);
    if (c.description?.trim() && c.format !== 'TEXT') out.push('', textMd(c.description));
    if (c.preconditions?.trim()) out.push('', '### Preconditions', '', textMd(c.preconditions));
    if (c.testData?.trim()) out.push('', '### Test data', '', textMd(c.testData));
    if (c.format === 'GHERKIN' && c.gherkin?.trim()) out.push('', '### Scenario', '', fence(c.gherkin, 'gherkin'));
    else if (c.format === 'TEXT') out.push('', '### Test description', '', c.description?.trim() ? textMd(c.description) : '_No description._');
    else if (c.steps.length) {
      out.push('', '### Steps', '');
      c.steps.forEach((s, i) => {
        const indent = (t: string) => t.replace(/\n/g, '\n   ');
        out.push(`${i + 1}. ${indent(textMd(s.action))}`);
        if (s.data?.trim()) out.push(`   - _Data:_ ${indent(textMd(s.data))}`);
        if (s.expected?.trim()) out.push(`   - _Expected:_ ${indent(textMd(s.expected))}`);
      });
    }
    out.push('', `### Results (${c.results.length})`);
    if (!c.results.length) out.push('', '_Not tested yet._');
    c.results.forEach((r, i) => {
      out.push('', `#### ${i + 1}. ${r.status} · ${r.tester} · ${fmtDateTime(r.at)}`);
      const facts = [r.elapsedSeconds ? `Elapsed: ${fmtDuration(r.elapsedSeconds)}` : null, r.issue ? `Issue: ${r.issue}` : null].filter(Boolean);
      if (facts.length) out.push('', facts.map((f) => `- ${f}`).join('\n'));
      if (r.comment?.trim()) out.push('', textMd(r.comment));
      for (const f of r.files) {
        const label = f.caption || f.fileName;
        const meta = `${f.fileName} · ${fmtBytes(f.size)}${f.annotated ? ' · annotated' : ''}`;
        if (f.kind === 'image') out.push('', `![${label.replace(/[[\]]/g, '')}](${href(f.zipPath)})`, `_${meta}_`);
        else if (f.kind === 'video') out.push('', `<video src="${href(f.zipPath)}" controls width="720"></video>`, '', `[${f.fileName.replace(/[[\]]/g, '')}](${href(f.zipPath)}) _${fmtBytes(f.size)}_${f.caption ? ` · ${f.caption}` : ''}`);
        else out.push('', `📎 [${f.fileName.replace(/[[\]]/g, '')}](${href(f.zipPath)}) _${fmtBytes(f.size)}_${f.caption ? ` · ${f.caption}` : ''}`);
      }
    });
  }
  out.push('');
  return out.join('\n');
}

/** Streams a ZIP with the Markdown file and every attachment (annotated copies for annotated screenshots). */
export async function markdownZip(m: RunExportModel) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(renderRunMarkdown(m), 'utf8'), `${m.key}.md`);
  for (const c of m.cases)
    for (const r of c.results)
      for (const f of r.files) {
        const p = storage.localPath(f.kind === 'image' ? f.displayKey : f.storageKey);
        if (await fsp.access(p).then(() => true, () => false)) zip.addFile(p, f.zipPath);
      }
  zip.end();
  return zip.outputStream;
}

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

export async function renderRunDocx(m: RunExportModel): Promise<Buffer> {
  const runs = (text: string, extra: Partial<{ bold: boolean; color: string; size: number; italics: boolean; font: string }> = {}) =>
    text.split(/\r?\n/).map((line, i) => new TextRun({ text: line, break: i ? 1 : 0, ...extra }));
  const p = (text: string, extra: Partial<{ bold: boolean; color: string; size: number; italics: boolean; font: string }> = {}) => new Paragraph({ children: runs(text, extra) });
  const h = (text: string, level: 1 | 2 | 3) =>
    new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: [new TextRun(text)], keepNext: true });
  const badge = (s: string, color: string) => new TextRun({ text: ` ${s} `, bold: true, color: 'FFFFFF', size: 18, shading: { type: ShadingType.CLEAR, color: 'auto', fill: COLORS[color] ?? (/^#?[0-9a-f]{6}$/i.test(color) ? color.replace('#', '') : COLORS.gray) } });
  const cell = (v: string | ParagraphChild[] | null, header = false, w?: number) =>
    new TableCell({
      children: [Array.isArray(v) ? new Paragraph({ children: v }) : new Paragraph({ children: runs(v || '–', { bold: header, size: 18, color: v ? undefined : MUTED }), spacing: { after: 0 } })],
      width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
      shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: SOFT } : undefined,
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
    });
  const table = (head: string[], rows: (string | ParagraphChild[] | null)[][], widths?: number[]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ tableHeader: true, children: head.map((x, i) => cell(x, true, widths?.[i])) }), ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((x, i) => cell(x, false, widths?.[i])) }))],
    });
  const kv = (rows: [string, string | null][]) =>
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.filter(([, v]) => v).map(([k, v]) => new TableRow({ children: [cell(k, true, 28), cell(v, false, 72)] })) });
  const code = (text: string) =>
    text.split(/\r?\n/).map((l, i, all) => new Paragraph({ children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 18 })], shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT }, spacing: { after: i === all.length - 1 ? 120 : 0, line: 240 } }));
  const image = async (f: RunExportFile): Promise<ImageRun | null> => {
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
  };

  const body: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(`${m.key}: ${m.name}`)] }), kv(runFacts(m))];
  if (m.description?.trim()) body.push(new Paragraph({ children: [] }), p(m.description.trim()));
  body.push(h('Summary', 1), table(['Status', 'Test cases'], counts(m).map(([s, n]) => [s, String(n)]), [70, 30]), new Paragraph({ children: [] }));
  body.push(
    table(
      ['Case', 'Title', 'Status', 'Assignee', 'Results'],
      m.cases.map((c) => [c.key, c.title, [badge(c.status, c.color)], c.assignee, String(c.results.length)]),
      [12, 44, 16, 18, 10],
    ),
  );

  let list = 0;
  for (const c of m.cases) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(`${c.key}: ${c.title}`)], keepNext: true }));
    body.push(
      new Paragraph({
        children: [badge(c.status, c.color), new TextRun({ text: `   Assignee: ${c.assignee ?? 'Unassigned'} · Priority: ${c.priority} · Type: ${c.type}${c.folder ? ` · Folder: ${c.folder}` : ''}`, color: MUTED, size: 18 })],
      }),
    );
    if (c.description?.trim() && c.format !== 'TEXT') body.push(p(c.description.trim()));
    if (c.preconditions?.trim()) body.push(h('Preconditions', 3), p(c.preconditions.trim()));
    if (c.testData?.trim()) body.push(h('Test data', 3), p(c.testData.trim()));
    if (c.format === 'GHERKIN' && c.gherkin?.trim()) body.push(h('Scenario', 2), ...code(c.gherkin.trim()));
    else if (c.format === 'TEXT') body.push(h('Test description', 2), p(c.description?.trim() || 'No description.', c.description?.trim() ? {} : { italics: true, color: MUTED }));
    else if (c.steps.length) {
      body.push(h('Steps', 2), table(['#', 'Action', 'Expected result'], c.steps.map((s, i) => [String(i + 1), s.data?.trim() ? `${s.action}\nData: ${s.data}` : s.action, s.expected]), [6, 52, 42]));
    }
    body.push(h(`Results (${c.results.length})`, 2));
    if (!c.results.length) body.push(p('Not tested yet.', { italics: true, color: MUTED }));
    for (const [i, r] of c.results.entries()) {
      body.push(new Paragraph({ keepNext: true, spacing: { before: 200 }, children: [new TextRun({ text: `${i + 1}. `, bold: true }), badge(r.status, r.color), new TextRun({ text: `  ${r.tester} · ${fmtDateTime(r.at)}`, color: MUTED })] }));
      const facts = [r.elapsedSeconds ? `Elapsed: ${fmtDuration(r.elapsedSeconds)}` : null, r.issue ? `Issue: ${r.issue}` : null].filter((x): x is string => !!x);
      if (facts.length) body.push(p(facts.join(' · '), { size: 18, color: MUTED }));
      if (r.comment?.trim()) body.push(p(r.comment.trim()));
      const others: RunExportFile[] = [];
      for (const f of r.files) {
        const img = f.kind === 'image' ? await image(f) : null;
        if (!img) {
          others.push(f);
          continue;
        }
        body.push(new Paragraph({ children: [img], keepNext: true, spacing: { before: 120, after: 40 } }));
        body.push(new Paragraph({ children: [new TextRun({ text: `${f.caption || f.fileName}${f.annotated ? ' (annotated)' : ''} · ${fmtBytes(f.size)}`, size: 17, color: MUTED, italics: true })] }));
      }
      if (others.length) {
        const inst = ++list;
        body.push(p('Attached files (not embedded):', { size: 18, bold: true }));
        for (const f of others)
          body.push(
            new Paragraph({
              numbering: { reference: 'files', level: 0, instance: inst },
              children: [new TextRun({ text: f.fileName, font: 'Consolas', size: 17 }), new TextRun({ text: ` · ${humanize(f.kind)} · ${fmtBytes(f.size)}${f.caption ? ` · ${f.caption}` : ''} · SHA-256 ${f.sha256.slice(0, 16)}…`, size: 17, color: MUTED })],
            }),
          );
      }
    }
  }

  const doc = new Document({
    creator: `Explorix ${m.appVersion}`,
    title: `${m.key}: ${m.name}`,
    subject: m.project,
    styles: {
      default: { document: { run: { font: 'Segoe UI', size: 21 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 44, bold: true, color: ACCENT }, paragraph: { spacing: { after: 240 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 240, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 4 } }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '1F2430' }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '343A46' }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [{ reference: 'files', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 400, hanging: 240 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 850, right: 850 } } }, children: body }],
  });
  return Packer.toBuffer(doc);
}
