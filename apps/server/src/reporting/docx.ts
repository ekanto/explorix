import fsp from 'node:fs/promises';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import type { AssetMap, ImageAsset, PreparedAsset } from './assets.js';
import { fmtBytes, fmtDate, fmtDateTime, fmtDuration, fmtTimecode, humanize } from './text.js';
import { SECTION_TITLES, SEVERITY_COLORS, type Block, type EvidenceItem, type FindingItem, type ReportModel, type SectionKey } from './types.js';

type Child = Paragraph | Table | TableOfContents;
type Cell = string | number | null | undefined | ParagraphChild[];

const FONT = 'Segoe UI';
const MONO = 'Consolas';
const MUTED = '5C6370';
const LINE = 'D8DDE6';
const SOFT = 'F1F3F7';
const hex = (c: string) => c.replace('#', '').toUpperCase();
const bm = (s: string) => `x_${s.replace(/[^A-Za-z0-9]/g, '_')}`.slice(0, 40);

export interface DocxOptions {
  /** Hyperlink to bundled originals (relative paths), only when the report ships with its evidence folder. */
  linkOriginals: boolean;
}

export async function renderDocx(m: ReportModel, assets: AssetMap, opts: DocxOptions): Promise<Buffer> {
  const o = m.options;
  const meta = o.showMetadata;
  const accent = hex(o.branding.accentColor);
  const landscape = o.orientation === 'landscape';
  // Usable width in CSS pixels (96 dpi): A4 minus 15 mm margins.
  const contentPx = landscape ? 1009 : 680;
  const maxImgH = landscape ? 430 : { small: 320, medium: 520, large: 760 }[o.imageSize];
  const maxImgW = Math.round(contentPx * { small: 0.65, medium: 1, large: 1 }[o.imageSize]);
  let listInstance = 0;
  const assetOf = (x: EvidenceItem) => assets.get(x.id) as PreparedAsset;

  // ---------- primitives ----------
  const runs = (text: string, extra: Partial<{ bold: boolean; color: string; size: number; italics: boolean; font: string }> = {}) =>
    text.split(/\r?\n/).map((line, i) => new TextRun({ text: line, break: i ? 1 : 0, ...extra }));
  const p = (text: string, extra: { keepNext?: boolean; style?: string; color?: string; bold?: boolean; italics?: boolean; size?: number; spacingAfter?: number } = {}) =>
    new Paragraph({
      children: runs(text, { color: extra.color, bold: extra.bold, italics: extra.italics, size: extra.size }),
      keepNext: extra.keepNext,
      style: extra.style,
      spacing: extra.spacingAfter != null ? { after: extra.spacingAfter } : undefined,
    });
  const heading = (text: string, level: 1 | 2 | 3, anchor?: string) => {
    const children: ParagraphChild[] = anchor ? [new Bookmark({ id: anchor, children: [new TextRun(text)] })] : [new TextRun(text)];
    return new Paragraph({
      heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      children,
      keepNext: true,
      keepLines: true,
    });
  };
  const badge = (sev: string) =>
    new TextRun({ text: ` ${humanize(sev)} `, bold: true, color: 'FFFFFF', size: 17, shading: { type: ShadingType.CLEAR, color: 'auto', fill: hex(SEVERITY_COLORS[sev] ?? '#495057') } });
  const link = (text: string, href: string) => new ExternalHyperlink({ link: href, children: [new TextRun({ text, style: 'Hyperlink' })] });

  const blocks = (bs: Block[]): Child[] => {
    const out: Child[] = [];
    for (const b of bs) {
      if ('items' in b) {
        const inst = ++listInstance;
        for (const it of b.items)
          out.push(new Paragraph({ children: runs(it), ...(b.type === 'ol' ? { numbering: { reference: 'ol', level: 0, instance: inst } } : { bullet: { level: 0 } }) }));
      } else if (b.type === 'code') {
        const lines = b.text.split(/\r?\n/);
        lines.forEach((l, i) =>
          out.push(
            new Paragraph({
              children: [new TextRun({ text: l || ' ', font: MONO, size: 17 })],
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT },
              spacing: { after: i === lines.length - 1 ? 120 : 0, before: 0, line: 240 },
              keepLines: true,
              keepNext: i < lines.length - 1,
            }),
          ),
        );
      } else if (b.type === 'h') out.push(p(b.text, { bold: true, keepNext: true }));
      else out.push(p(b.text));
    }
    return out;
  };

  const cellParas = (v: Cell, header = false): Paragraph[] => {
    if (Array.isArray(v)) return [new Paragraph({ children: v })];
    const s = v == null || v === '' ? '–' : String(v);
    return [new Paragraph({ children: runs(s, { bold: header, size: 18, color: v == null || v === '' ? MUTED : undefined }), spacing: { after: 0 } })];
  };
  const cell = (v: Cell, opts2: { header?: boolean; width?: number; fill?: string } = {}) =>
    new TableCell({
      children: cellParas(v, opts2.header),
      width: opts2.width ? { size: opts2.width, type: WidthType.PERCENTAGE } : undefined,
      shading: opts2.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts2.fill } : undefined,
      margins: { top: 50, bottom: 50, left: 90, right: 90 },
    });
  const table = (head: string[], rows: Cell[][], widths?: number[]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: head.map((h, i) => cell(h, { header: true, fill: SOFT, width: widths?.[i] })) }),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, { width: widths?.[i] })) })),
      ],
    });
  const kv = (rows: [string, Cell][]) => {
    const filtered = rows.filter(([, v]) => v != null && v !== '');
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: filtered.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, { header: true, fill: SOFT, width: 28 }), cell(v, { width: 72 })] })),
    });
  };
  const spacer = () => new Paragraph({ children: [], spacing: { after: 60 } });

  const fit = (w: number, h: number, maxW = maxImgW, maxH = maxImgH) => {
    const s = Math.min(1, maxW / w, maxH / h);
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
  };
  const imageRun = async (a: ImageAsset, alt: string, maxW?: number, maxH?: number) =>
    new ImageRun({
      type: a.mime === 'image/png' ? 'png' : 'jpg',
      data: await fsp.readFile(a.abs),
      transformation: fit(a.width, a.height, maxW, maxH),
      altText: { name: alt.slice(0, 120), description: alt, title: alt.slice(0, 120) },
    });
  const fileRef = (x: EvidenceItem): ParagraphChild[] => {
    const a = assetOf(x);
    if (opts.linkOriginals && a.original) return [link(a.original.rel, a.original.rel)];
    return [new TextRun({ text: x.fileName, font: MONO, size: 17 })];
  };

  // ---------- evidence ----------
  const imageBlock = async (x: EvidenceItem): Promise<Child[]> => {
    const a = assetOf(x);
    const label = `${x.caption || x.title}${x.annotated ? ' (annotated)' : ''}`;
    const out: Child[] = [];
    if (a.preview) out.push(new Paragraph({ children: [await imageRun(a.preview, label)], keepNext: true, keepLines: true, spacing: { before: 120, after: 40 } }));
    const cap: ParagraphChild[] = [new TextRun({ text: `Figure ${x.ref}: `, bold: true }), new TextRun(label)];
    if (x.description) cap.push(new TextRun({ text: x.description, break: 1, color: MUTED }));
    if (opts.linkOriginals && a.original) cap.push(new TextRun({ text: 'Original: ', break: 1, color: MUTED }), ...fileRef(x));
    if (a.problem) cap.push(new TextRun({ text: `⚠ ${a.problem}`, break: 1, color: 'B02A2A' }));
    out.push(new Paragraph({ style: 'Caption', children: cap, spacing: { after: 200 } }));
    return out;
  };

  const videoBlock = async (x: EvidenceItem): Promise<Child[]> => {
    const a = assetOf(x);
    const out: Child[] = [new Paragraph({ children: [new TextRun({ text: `▶ Video ${x.ref}: ${x.title}`, bold: true, color: accent })], keepNext: true, spacing: { before: 160 } })];
    if (a.preview) out.push(new Paragraph({ children: [await imageRun(a.preview, `Preview of video ${x.ref}`, Math.min(maxImgW, 520), 300)], keepNext: true }));
    else out.push(p('No preview frame was captured for this video.', { italics: true, color: MUTED, keepNext: true }));
    out.push(
      kv([
        ['File', fileRef(x)],
        ['Size', fmtBytes(x.size)],
        ['Duration', fmtTimecode(x.durationSeconds) || 'Unknown'],
        ['Caption', x.caption],
        ['Description', x.description],
        ['Linked to', x.findingKey ?? x.sessionKey],
      ]),
    );
    if (x.markers.length) out.push(p('Important moments', { bold: true, keepNext: true }), table(['Time', 'Moment', 'Note'], x.markers.map((mk) => [fmtTimecode(mk.timeSeconds), mk.label, mk.note]), [14, 36, 50]));
    if (a.frames.length) {
      const per = Math.floor((maxImgW - 24) / 3);
      const imgs: ParagraphChild[] = [];
      for (const fr of a.frames) imgs.push(await imageRun(fr, `Frame at ${fmtTimecode(fr.timeSeconds)}`, per, 200), new TextRun('  '));
      out.push(new Paragraph({ children: imgs, keepNext: true, spacing: { before: 80 } }));
      out.push(new Paragraph({ style: 'Caption', children: [new TextRun(`Selected frames at ${a.frames.map((f) => fmtTimecode(f.timeSeconds) || '?').join(', ')}`)] }));
    }
    if (a.problem) out.push(p(`⚠ ${a.problem}`, { color: 'B02A2A' }));
    out.push(spacer());
    return out;
  };

  const docLine = (x: EvidenceItem) => {
    const a = assetOf(x);
    return new Paragraph({
      bullet: { level: 0 },
      children: [
        new TextRun({ text: `${x.ref} `, bold: true }),
        ...fileRef(x),
        new TextRun({ text: ` (${fmtBytes(x.size)})`, color: MUTED }),
        ...(x.caption ? [new TextRun(`: ${x.caption}`)] : []),
        ...(a.problem ? [new TextRun({ text: ` ⚠ ${a.problem}`, color: 'B02A2A' })] : []),
      ],
    });
  };
  const evidenceBlock = async (x: EvidenceItem) => (x.kind === 'IMAGE' ? imageBlock(x) : x.kind === 'VIDEO' ? videoBlock(x) : [docLine(x)]);

  const finding = async (f: FindingItem): Promise<Child[]> => {
    const rows: [string, Cell][] = [
      ['Classification', f.classification],
      ['Severity', [badge(f.severity)]],
      ['Priority', humanize(f.priority)],
      ['Status', humanize(f.status)],
    ];
    if (meta) rows.push(['Author', f.author], ['Created', fmtDateTime(f.createdAt)]);
    rows.push(['Owner', f.owner]);
    if (f.sessionKey) rows.push(['Session', `${f.sessionKey}${f.elapsedSeconds != null ? ` at ${fmtTimecode(f.elapsedSeconds)}` : ''}`]);
    rows.push(['Charter', f.charterKey], ['Environment', f.environment], ['Browser', f.browser]);
    if (f.issue) {
      const label = `${f.issue.key}${f.issue.externalKey ? ` / ${f.issue.externalKey}` : ''}: ${f.issue.title} (${humanize(f.issue.status)})`;
      rows.push(['Related issue', f.issue.externalUrl && /^https?:\/\//.test(f.issue.externalUrl) ? [link(label, f.issue.externalUrl)] : label]);
    }
    if (f.requirement) rows.push(['Requirement', `${f.requirement.key}: ${f.requirement.title}`]);
    if (f.tags.length) rows.push(['Tags', f.tags.join(', ')]);
    const out: Child[] = [heading(`${f.key}: ${f.title}`, 2, bm(f.id)), kv(rows), spacer()];
    const ps: [string, Block[]][] = [['Description', f.description], ['Preconditions', f.preconditions], ['Steps to reproduce', f.reproSteps], ['Expected behavior', f.expected], ['Actual behavior', f.actual], ['Follow-up', f.followUp], ['Resolution', f.resolution]];
    for (const [l, b] of ps) if (b.length) out.push(heading(l, 3), ...blocks(b));
    if (f.evidence.length) {
      out.push(heading('Evidence', 3));
      for (const x of f.evidence) out.push(...(await evidenceBlock(x)));
    }
    if (f.comments.length) {
      out.push(heading('Comments', 3));
      for (const c of f.comments) out.push(p(`${c.author} · ${fmtDateTime(c.at)}`, { color: MUTED, size: 17, keepNext: true }), ...blocks(c.body));
    }
    return out;
  };

  // ---------- sections ----------
  const body: Child[] = [];
  const hasCover = m.sections.includes('cover');
  const bodySections = m.sections.filter((k) => k !== 'cover' && k !== 'toc');
  const sec = (k: SectionKey) => body.push(heading(SECTION_TITLES[k], 1, bm(`sec_${k}`)));

  for (const k of m.sections) {
    switch (k) {
      case 'cover': {
        if (o.branding.logoDataUrl) {
          const mm = /^data:image\/(png|jpeg);base64,(.+)$/.exec(o.branding.logoDataUrl);
          if (mm) {
            const data = Buffer.from(mm[2]!, 'base64');
            const sharp = (await import('sharp')).default;
            const md = await sharp(data).metadata().catch(() => null);
            if (md?.width && md.height)
              body.push(new Paragraph({ children: [new ImageRun({ type: mm[1] === 'png' ? 'png' : 'jpg', data, transformation: fit(md.width, md.height, 220, 80), altText: { name: 'Logo', description: 'Logo', title: 'Logo' } })], spacing: { before: 1600, after: 300 } }));
          }
        }
        if (o.branding.organization) body.push(p(o.branding.organization.toUpperCase(), { bold: true, color: MUTED, spacingAfter: 120 }));
        body.push(new Paragraph({ style: 'Title', children: [new TextRun(m.title)], spacing: { before: o.branding.logoDataUrl ? 0 : 2400, after: 200 } }));
        if (m.subtitle) body.push(p(m.subtitle, { color: MUTED, size: 28, spacingAfter: 400 }));
        const rows: [string, Cell][] = [['Project', `${m.project.name} (${m.project.key})`], ['Scope', m.scopeLabel], ['Report type', m.templateName]];
        if (meta) rows.push(['Author', m.author], ['Generated', fmtDateTime(m.generatedAt)], ['Generated with', `Explorix ${m.appVersion}`]);
        body.push(kv(rows));
        if (o.branding.confidentiality) body.push(new Paragraph({ children: [new TextRun({ text: o.branding.confidentiality, bold: true, color: 'B02A2A' })], spacing: { before: 400 } }));
        body.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      }
      case 'toc':
        body.push(
          new Paragraph({ style: 'TOCHeading', children: [new TextRun(SECTION_TITLES.toc)] }),
          new TableOfContents(SECTION_TITLES.toc, {
            hyperlink: true,
            headingStyleRange: '1-2',
            cachedEntries: bodySections.flatMap((s) => [
              { title: SECTION_TITLES[s], level: 1, href: bm(`sec_${s}`) },
              ...(s === 'findings' ? m.findings.map((f) => ({ title: `${f.key}: ${f.title}`, level: 2, href: bm(f.id) })) : []),
            ]),
          }),
          p('Page numbers in this table are filled in when Word updates fields (it asks when the document opens).', { italics: true, color: MUTED, size: 16 }),
          new Paragraph({ children: [new PageBreak()] }),
        );
        break;
      case 'executiveSummary':
        sec(k);
        body.push(...m.summary.paragraphs.map((t) => p(t)));
        if (m.summary.bySeverity.length) {
          const kids: ParagraphChild[] = [];
          for (const s of m.summary.bySeverity) kids.push(badge(s.severity), new TextRun({ text: ` ${s.count}    `, bold: true }));
          body.push(new Paragraph({ children: kids, spacing: { before: 120, after: 160 } }));
        }
        for (const s of m.sessions) if (s.summary.length) body.push(heading(`${s.key} summary: ${s.title}`, 3), ...blocks(s.summary));
        break;
      case 'metadata': {
        sec(k);
        const rows: [string, Cell][] = [['Project', `${m.project.name} (${m.project.key})`], ['Scope', m.scopeLabel]];
        if (m.milestone) rows.push(['Milestone', `${m.milestone.name} (${humanize(m.milestone.status)}${m.milestone.dueDate ? `, due ${fmtDate(m.milestone.dueDate)}` : ''})`]);
        rows.push(['Sessions', m.summary.sessionCount], ['Findings', m.summary.findingCount]);
        if (m.summary.timeSpentSeconds) rows.push(['Time spent', fmtDuration(m.summary.timeSpentSeconds)]);
        body.push(kv(rows));
        if (m.sessions.length)
          body.push(
            heading('Sessions', 3),
            table(['Session', 'Title', 'Status', 'Tester', 'Started', 'Time spent', 'Findings'], m.sessions.map((s) => [s.key, s.title, humanize(s.status), s.tester, fmtDateTime(s.startedAt), fmtDuration(s.elapsedSeconds), s.findingCount])),
          );
        break;
      }
      case 'mission':
        sec(k);
        for (const c of m.charters) {
          body.push(heading(`${c.key}: ${c.title}`, 2), ...blocks(c.mission), kv([['Target', c.target], ['Timebox', `${c.timeboxMinutes} min`], ['Priority', humanize(c.priority)], ['Risk level', humanize(c.riskLevel)]]));
          if (c.objectives.length) body.push(heading('Objectives', 3), ...blocks(c.objectives));
        }
        break;
      case 'scope':
        sec(k);
        for (const c of m.charters) {
          const ps: [string, Block[]][] = [['In scope', c.scope], ['Out of scope', c.outOfScope], ['Assumptions', c.assumptions], ['Prerequisites', c.prerequisites], ['Test data', c.testData]];
          if (!ps.some(([, b]) => b.length)) continue;
          if (m.charters.length > 1) body.push(heading(`${c.key}: ${c.title}`, 2));
          for (const [l, b] of ps) if (b.length) body.push(heading(l, 3), ...blocks(b));
        }
        break;
      case 'environment': {
        sec(k);
        const rows = m.sessions.filter((s) => s.browser || s.os || s.device || s.buildVersion || s.environment).map((s) => [s.key, s.environment, s.browser, s.os, s.device, s.buildVersion]);
        if (rows.length) body.push(table(['Session', 'Environment', 'Browser', 'OS', 'Device', 'Build'], rows));
        for (const s of m.sessions) if (s.environmentNotes) body.push(new Paragraph({ children: [new TextRun({ text: `${s.key} environment notes: `, bold: true }), ...runs(s.environmentNotes)] }));
        const envs = [...new Set(m.findings.map((f) => [f.environment, f.browser].filter(Boolean).join(' · ')).filter(Boolean))];
        if (envs.length) body.push(heading('Environments recorded on findings', 3), ...envs.map((x) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(x)] })));
        if (!m.sessions.length) for (const c of m.charters) if (c.environment) body.push(new Paragraph({ children: [new TextRun({ text: `${c.key}: `, bold: true }), new TextRun(c.environment)] }));
        break;
      }
      case 'timeline':
        sec(k);
        for (const s of m.sessions) {
          const rows: [string, Cell][] = [
            ['Started', fmtDateTime(s.startedAt) || 'Not started'],
            ['Ended', fmtDateTime(s.endedAt)],
            ['Time spent', `${fmtDuration(s.elapsedSeconds) || '0 s'} of ${s.timeboxMinutes} min timebox`],
          ];
          if (s.tbs) rows.push(['Split', `Setup ${s.tbs.setup}% · Testing ${s.tbs.test}% · Bug investigation ${s.tbs.bug}%`]);
          body.push(heading(`${s.key}: ${s.title}`, 2), kv(rows), spacer());
          if (s.timeline.length) body.push(table(['Session time', 'Type', 'Entry'], s.timeline.map((t) => [fmtTimecode(t.elapsedSeconds), humanize(t.type), t.ref ? `${t.ref}: ${t.text}` : t.text]), [14, 16, 70]));
          if (s.timelineTruncated) body.push(p(`Timeline truncated to the first ${s.timeline.length} entries.`, { color: MUTED, italics: true }));
        }
        break;
      case 'testExecution':
        sec(k);
        if (m.testExecution.runs.length)
          body.push(
            heading('Manual test runs', 3),
            table(['Run', 'Name', 'Status', 'Total', 'Passed', 'Failed', 'Blocked', 'Skipped', 'Untested', 'Pass rate'], m.testExecution.runs.map((r) => [r.key, r.name, humanize(r.status), r.total, r.passed, r.failed, r.blocked, r.skipped, r.untested, r.passRate == null ? null : `${r.passRate}%`])),
          );
        if (m.testExecution.automation.length)
          body.push(
            heading('Automation runs', 3),
            table(['Run', 'Name', 'Started', 'Branch', 'Total', 'Passed', 'Failed', 'Skipped'], m.testExecution.automation.map((a) => [a.key, a.name, fmtDateTime(a.startedAt), a.branch, a.total, a.passed, a.failed, a.skipped])),
          );
        break;
      case 'findingsSummary':
        sec(k);
        body.push(
          table(
            ['ID', 'Title', 'Classification', 'Severity', 'Priority', 'Status', 'Evidence'],
            m.findings.map((f) => [[new InternalHyperlink({ anchor: bm(f.id), children: [new TextRun({ text: f.key, style: 'Hyperlink', size: 18 })] })], f.title, f.classification, [badge(f.severity)], humanize(f.priority), humanize(f.status), f.evidence.map((x) => x.ref).join(', ')]),
            [9, 31, 14, 12, 10, 12, 12],
          ),
        );
        break;
      case 'findings':
        sec(k);
        for (const f of m.findings) body.push(...(await finding(f)));
        break;
      case 'screenshots':
        sec(k);
        for (const x of m.looseEvidence.filter((y) => y.kind === 'IMAGE')) body.push(...(await imageBlock(x)));
        break;
      case 'videos': {
        sec(k);
        const vids = m.evidence.filter((x) => x.kind === 'VIDEO');
        body.push(
          new Paragraph({
            children: runs(
              'Word documents cannot reliably play embedded video. Each video is represented by a preview image, its duration, selected frames and important timestamps, and is identified by file name' +
                (opts.linkOriginals ? '; the links point to the original files in this package’s evidence folder.' : '.'),
              { italics: true },
            ),
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: SOFT },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 6 } },
            spacing: { after: 160 },
          }),
          table(['Ref', 'Title', 'Duration', 'Linked to', 'File'], vids.map((v) => [v.ref, v.title, fmtTimecode(v.durationSeconds) || 'Unknown', v.findingKey ?? v.sessionKey, fileRef(v)]), [8, 30, 12, 14, 36]),
        );
        for (const v of vids.filter((y) => !y.findingId)) body.push(...(await videoBlock(v)));
        break;
      }
      case 'attachments':
        sec(k);
        body.push(...m.looseEvidence.filter((x) => x.kind !== 'IMAGE' && x.kind !== 'VIDEO').map(docLine));
        break;
      case 'risks':
        sec(k);
        body.push(table(['Type', 'Description', 'Source'], m.risks.map((r) => [r.kind, r.text, r.ref]), [16, 66, 18]));
        break;
      case 'outstanding':
        sec(k);
        body.push(table(['Reference', 'Title', 'Severity', 'Status', 'Owner'], m.outstanding.map((x) => [x.ref, x.title, [badge(x.severity)], x.status, x.owner]), [14, 42, 14, 14, 16]));
        break;
      case 'recommendations': {
        sec(k);
        const inst = ++listInstance;
        for (const r of m.recommendations)
          body.push(new Paragraph({ numbering: { reference: 'ol', level: 0, instance: inst }, children: [new TextRun(r.text), ...(r.ref ? [new TextRun({ text: ` (${r.ref})`, color: MUTED })] : [])] }));
        break;
      }
      case 'assessment':
        sec(k);
        for (const a of m.assessment) body.push(heading(a.label, 3), ...blocks(a.blocks));
        break;
      case 'evidenceIndex':
        sec(k);
        body.push(
          table(
            ['Ref', 'Type', 'Title', 'File', 'Size', 'Linked to', 'Added', 'SHA-256'],
            m.evidence.map((x) => [x.ref, humanize(x.kind), x.title, fileRef(x), fmtBytes(x.size), x.findingKey ?? x.sessionKey, fmtDateTime(x.createdAt), [new TextRun({ text: x.sha256, font: MONO, size: 12 })]]),
            [6, 9, 17, 20, 8, 9, 12, 19],
          ),
        );
        break;
      case 'appendices':
        sec(k);
        for (const s of m.sessions.filter((y) => y.notes.length)) body.push(heading(`Session notes: ${s.key}`, 2), ...blocks(s.notes));
        break;
    }
  }

  const headerPara = new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: m.title, color: MUTED, size: 16 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
  });
  const footerPara = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], color: MUTED, size: 16 })],
  });

  const doc = new Document({
    creator: `Explorix ${m.appVersion}`,
    title: m.title,
    description: `${m.templateName}: ${m.scopeLabel}`,
    subject: `${m.project.name} (${m.project.key})`,
    features: { updateFields: m.sections.includes('toc') },
    styles: {
      default: { document: { run: { font: FONT, size: 21 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 56, bold: true, color: accent } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: accent }, paragraph: { spacing: { before: 360, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 4 } }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 27, bold: true, color: '1F2430' }, paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '343A46' }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
        { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', run: { size: 18, color: '343A46' } },
        { id: 'TOCHeading', name: 'TOC Heading', basedOn: 'Normal', next: 'Normal', run: { size: 34, bold: true, color: accent }, paragraph: { spacing: { after: 200 } } },
      ],
      characterStyles: [{ id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: accent, underline: {} } }],
    },
    numbering: {
      config: [{ reference: 'ol', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] }],
    },
    sections: [
      {
        properties: {
          titlePage: hasCover,
          page: {
            size: { orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: 1134, bottom: 1020, left: 850, right: 850, header: 500, footer: 500 },
          },
        },
        headers: { default: new Header({ children: [headerPara] }), ...(hasCover ? { first: new Header({ children: [] }) } : {}) },
        footers: { default: new Footer({ children: [footerPara] }), ...(hasCover ? { first: new Footer({ children: [] }) } : {}) },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
