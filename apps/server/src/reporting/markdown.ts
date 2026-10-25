import type { AssetMap, PreparedAsset } from './assets.js';
import { fmtBytes, fmtDate, fmtDateTime, fmtDuration, fmtTimecode, humanize } from './text.js';
import { SECTION_TITLES, type Block, type EvidenceItem, type FindingItem, type ReportModel, type SectionKey } from './types.js';

/** GitHub-style heading anchor. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
const cell = (s: string | number | null | undefined) => (s == null || s === '' ? '–' : esc(String(s)).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'));
const table = (head: string[], rows: (string | number | null | undefined)[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

function blocks(bs: Block[]): string {
  return bs
    .map((b) => {
      switch (b.type) {
        case 'p':
          return esc(b.text).replace(/^(\s*)([#>+-]|\d+\.)/gm, '$1\\$2').replace(/\n/g, '  \n');
        case 'h':
          return `**${esc(b.text)}**`;
        case 'code': {
          const fence = b.text.includes('```') ? '~~~~' : '```';
          return `${fence}\n${b.text}\n${fence}`;
        }
        case 'ol':
          return b.items.map((t, i) => `${i + 1}. ${esc(t)}`).join('\n');
        case 'ul':
          return b.items.map((t) => `- ${esc(t)}`).join('\n');
      }
    })
    .join('\n\n');
}

export interface MarkdownOptions {
  /** Link to bundled originals (true when they were copied next to the report). */
  linkOriginals: boolean;
}

export function renderMarkdown(m: ReportModel, assets: AssetMap, opts: MarkdownOptions): string {
  const out: string[] = [];
  const push = (...s: string[]) => out.push(...s, '');
  const o = m.options;
  const meta = o.showMetadata;
  const assetOf = (e: EvidenceItem) => assets.get(e.id) as PreparedAsset;
  const fileRef = (e: EvidenceItem) => {
    const a = assetOf(e);
    return opts.linkOriginals && a.original ? `[${esc(e.fileName).replace(/\|/g, '\\|')}](${a.original.rel})` : `\`${e.fileName.replace(/[`|]/g, "'")}\``;
  };

  // Cover
  push(`# ${esc(m.title)}`);
  if (m.subtitle) push(`_${esc(m.subtitle)}_`);
  const coverRows: [string, string][] = [
    ['Project', `${m.project.name} (${m.project.key})`],
    ['Report type', m.templateName],
  ];
  if (o.branding.organization) coverRows.unshift(['Organization', o.branding.organization]);
  if (meta) coverRows.push(['Author', m.author], ['Generated', fmtDateTime(m.generatedAt)], ['Generated with', `Explorix ${m.appVersion}`]);
  push(coverRows.map(([k, v]) => `**${k}:** ${esc(v)}`).join('  \n'));
  if (o.branding.confidentiality) push(`> **${esc(o.branding.confidentiality)}**`);

  const h2 = (k: SectionKey) => push(`## ${SECTION_TITLES[k]}`);
  const body = m.sections.filter((k) => k !== 'cover' && k !== 'toc');

  for (const k of m.sections) {
    switch (k) {
      case 'toc':
        h2('toc');
        push(body.map((s) => `- [${SECTION_TITLES[s]}](#${slug(SECTION_TITLES[s])})`).join('\n'));
        break;
      case 'executiveSummary': {
        h2(k);
        push(...m.summary.paragraphs.map(esc));
        if (m.summary.bySeverity.length) push(table(['Severity', 'Findings'], m.summary.bySeverity.map((s) => [humanize(s.severity), s.count])));
        for (const s of m.sessions) if (s.summary.length) push(`**${esc(s.key)} summary (${esc(s.title)})**`, blocks(s.summary));
        break;
      }
      case 'metadata': {
        h2(k);
        const rows: [string, string][] = [['Project', `${m.project.name} (${m.project.key})`], ['Scope', m.scopeLabel]];
        if (m.milestone) rows.push(['Milestone', `${m.milestone.name} (${humanize(m.milestone.status)}${m.milestone.dueDate ? `, due ${fmtDate(m.milestone.dueDate)}` : ''})`]);
        rows.push(['Sessions', String(m.summary.sessionCount)], ['Findings', String(m.summary.findingCount)]);
        if (m.summary.timeSpentSeconds) rows.push(['Time spent', fmtDuration(m.summary.timeSpentSeconds)]);
        push(table(['Field', 'Value'], rows));
        if (m.sessions.length)
          push(
            '### Sessions',
            '',
            table(
              ['Session', 'Title', 'Status', 'Tester', 'Started', 'Time spent', 'Findings'],
              m.sessions.map((s) => [s.key, s.title, humanize(s.status), s.tester, fmtDateTime(s.startedAt), fmtDuration(s.elapsedSeconds), s.findingCount]),
            ),
          );
        break;
      }
      case 'mission':
        h2(k);
        for (const c of m.charters) {
          push(`### ${esc(c.key)}: ${esc(c.title)}`, blocks(c.mission));
          const rows: [string, string][] = [];
          if (c.target) rows.push(['Target', c.target]);
          rows.push(['Timebox', `${c.timeboxMinutes} min`], ['Priority', humanize(c.priority)], ['Risk level', humanize(c.riskLevel)]);
          push(table(['Field', 'Value'], rows));
          if (c.objectives.length) push('**Objectives**', blocks(c.objectives));
        }
        break;
      case 'scope':
        h2(k);
        for (const c of m.charters) {
          const parts: [string, Block[]][] = [['In scope', c.scope], ['Out of scope', c.outOfScope], ['Assumptions', c.assumptions], ['Prerequisites', c.prerequisites], ['Test data', c.testData]];
          if (!parts.some(([, b]) => b.length)) continue;
          if (m.charters.length > 1) push(`### ${esc(c.key)}: ${esc(c.title)}`);
          for (const [label, b] of parts) if (b.length) push(`**${label}**`, blocks(b));
        }
        break;
      case 'environment': {
        h2(k);
        const rows = m.sessions.filter((s) => s.browser || s.os || s.device || s.buildVersion || s.environment).map((s) => [s.key, s.environment, s.browser, s.os, s.device, s.buildVersion]);
        if (rows.length) push(table(['Session', 'Environment', 'Browser', 'OS', 'Device', 'Build'], rows));
        for (const s of m.sessions) if (s.environmentNotes) push(`**${esc(s.key)} environment notes:** ${esc(s.environmentNotes)}`);
        const envs = [...new Set(m.findings.map((f) => [f.environment, f.browser].filter(Boolean).join(' · ')).filter(Boolean))];
        if (envs.length) push('**Environments recorded on findings**', envs.map((e) => `- ${esc(e)}`).join('\n'));
        if (!m.sessions.length) for (const c of m.charters) if (c.environment) push(`**${esc(c.key)}:** ${esc(c.environment)}`);
        break;
      }
      case 'timeline':
        h2(k);
        for (const s of m.sessions) {
          push(`### ${esc(s.key)}: ${esc(s.title)}`);
          const facts = [`**Started:** ${fmtDateTime(s.startedAt) || 'not started'}`, `**Ended:** ${fmtDateTime(s.endedAt) || '–'}`, `**Time spent:** ${fmtDuration(s.elapsedSeconds) || '0 s'} of ${s.timeboxMinutes} min timebox`];
          if (s.tbs) facts.push(`**Split:** setup ${s.tbs.setup}% · testing ${s.tbs.test}% · bug investigation ${s.tbs.bug}%`);
          push(facts.join('  \n'));
          if (s.timeline.length) push(table(['Session time', 'Type', 'Entry'], s.timeline.map((t) => [fmtTimecode(t.elapsedSeconds), humanize(t.type), t.ref ? `${t.ref}: ${t.text}` : t.text])));
          if (s.timelineTruncated) push(`_Timeline truncated to the first ${s.timeline.length} entries._`);
        }
        break;
      case 'testExecution':
        h2(k);
        if (m.testExecution.runs.length)
          push('### Manual test runs', '', table(['Run', 'Name', 'Status', 'Total', 'Passed', 'Failed', 'Blocked', 'Skipped', 'Untested', 'Pass rate'], m.testExecution.runs.map((r) => [r.key, r.name, humanize(r.status), r.total, r.passed, r.failed, r.blocked, r.skipped, r.untested, r.passRate == null ? null : `${r.passRate}%`])));
        if (m.testExecution.automation.length)
          push('### Automation runs', '', table(['Run', 'Name', 'Started', 'Branch', 'Total', 'Passed', 'Failed', 'Skipped'], m.testExecution.automation.map((a) => [a.key, a.name, fmtDateTime(a.startedAt), a.branch, a.total, a.passed, a.failed, a.skipped])));
        break;
      case 'findingsSummary':
        h2(k);
        push(table(['ID', 'Title', 'Classification', 'Severity', 'Priority', 'Status', 'Evidence'], m.findings.map((f) => [f.key, f.title, f.classification, humanize(f.severity), humanize(f.priority), humanize(f.status), f.evidence.map((e) => e.ref).join(', ')])));
        break;
      case 'findings':
        h2(k);
        for (const f of m.findings) push(findingMd(f));
        break;
      case 'screenshots':
        h2(k);
        for (const e of m.looseEvidence.filter((x) => x.kind === 'IMAGE')) push(imageMd(e));
        break;
      case 'videos': {
        h2(k);
        push('_Videos cannot play inside a document. Each video is listed with its duration, preview frames and important timestamps, and is referenced by file name' + (opts.linkOriginals ? ' with a relative link to the bundled original._' : '._'));
        const vids = m.evidence.filter((e) => e.kind === 'VIDEO');
        push(table(['Ref', 'Title', 'Duration', 'Linked to', 'File'], vids.map((v) => [v.ref, v.title, fmtTimecode(v.durationSeconds) || 'unknown', v.findingKey ?? v.sessionKey, '@@' + v.id])).replace(/@@(\w+)/g, (_, id) => fileRef(vids.find((v) => v.id === id)!)));
        for (const v of vids.filter((x) => !x.findingId)) push(videoMd(v));
        break;
      }
      case 'attachments':
        h2(k);
        push(m.looseEvidence.filter((x) => x.kind !== 'IMAGE' && x.kind !== 'VIDEO').map(docMd).join('\n'));
        break;
      case 'risks':
        h2(k);
        push(table(['Type', 'Description', 'Source'], m.risks.map((r) => [r.kind, r.text, r.ref])));
        break;
      case 'outstanding':
        h2(k);
        push(table(['Reference', 'Title', 'Severity', 'Status', 'Owner'], m.outstanding.map((x) => [x.ref, x.title, humanize(x.severity), x.status, x.owner])));
        break;
      case 'recommendations':
        h2(k);
        push(m.recommendations.map((r) => `- ${esc(r.text)}${r.ref ? ` (${r.ref})` : ''}`).join('\n'));
        break;
      case 'assessment':
        h2(k);
        for (const a of m.assessment) push(`### ${esc(a.label)}`, blocks(a.blocks));
        break;
      case 'evidenceIndex':
        h2(k);
        push(
          table(
            ['Ref', 'Type', 'Title', 'File', 'Size', 'Linked to', 'Added', 'SHA-256'],
            m.evidence.map((e) => [e.ref, humanize(e.kind), e.title, '@@' + e.id, fmtBytes(e.size), e.findingKey ?? e.sessionKey, fmtDateTime(e.createdAt), e.sha256]),
          ).replace(/@@(\w+)/g, (_, id) => fileRef(m.evidence.find((v) => v.id === id)!)),
        );
        break;
      case 'appendices':
        h2(k);
        for (const s of m.sessions) if (s.notes.length) push(`### Session notes: ${esc(s.key)}`, blocks(s.notes));
        break;
    }
  }
  push('---', `_Generated by Explorix ${m.appVersion} on ${fmtDateTime(m.generatedAt)}._`);
  return out.join('\n');

  function findingMd(f: FindingItem) {
    const s: string[] = [`### ${esc(f.key)}: ${esc(f.title)}`, ''];
    const rows: [string, string | null][] = [
      ['Classification', f.classification],
      ['Severity', humanize(f.severity)],
      ['Priority', humanize(f.priority)],
      ['Status', humanize(f.status)],
    ];
    if (meta) rows.push(['Author', f.author], ['Created', fmtDateTime(f.createdAt)]);
    if (f.owner) rows.push(['Owner', f.owner]);
    if (f.sessionKey) rows.push(['Session', `${f.sessionKey}${f.elapsedSeconds != null ? ` at ${fmtTimecode(f.elapsedSeconds)}` : ''}`]);
    if (f.charterKey) rows.push(['Charter', f.charterKey]);
    if (f.environment) rows.push(['Environment', f.environment]);
    if (f.browser) rows.push(['Browser', f.browser]);
    if (f.issue) rows.push(['Related issue', `${f.issue.key}${f.issue.externalKey ? ` / ${f.issue.externalKey}` : ''}: ${f.issue.title} (${humanize(f.issue.status)})`]);
    if (f.requirement) rows.push(['Requirement', `${f.requirement.key}: ${f.requirement.title}`]);
    if (f.tags.length) rows.push(['Tags', f.tags.join(', ')]);
    s.push(table(['Field', 'Value'], rows), '');
    const parts: [string, Block[]][] = [['Description', f.description], ['Preconditions', f.preconditions], ['Steps to reproduce', f.reproSteps], ['Expected behavior', f.expected], ['Actual behavior', f.actual], ['Follow-up', f.followUp], ['Resolution', f.resolution]];
    for (const [label, b] of parts) if (b.length) s.push(`#### ${label}`, '', blocks(b), '');
    if (f.evidence.length) {
      s.push('#### Evidence', '');
      for (const e of f.evidence) s.push(e.kind === 'IMAGE' ? imageMd(e) : e.kind === 'VIDEO' ? videoMd(e) : docMd(e), '');
    }
    if (f.comments.length) {
      s.push('#### Comments', '');
      for (const c of f.comments) s.push(`**${esc(c.author)}**, ${fmtDateTime(c.at)}:`, '', blocks(c.body), '');
    }
    return s.join('\n').trimEnd();
  }

  function imageMd(e: EvidenceItem) {
    const a = assetOf(e);
    const label = `Figure ${e.ref}: ${e.caption || e.title}${e.annotated ? ' (annotated)' : ''}`;
    const s: string[] = [];
    if (a.preview) s.push(`![${esc(label)}](${a.preview.rel})`, '');
    s.push(`*${esc(label)}*${opts.linkOriginals && a.original ? `. Original: ${fileRef(e)}` : ''}`);
    if (e.description) s.push('', esc(e.description));
    if (a.problem) s.push('', `> ⚠ ${esc(a.problem)}`);
    return s.join('\n');
  }

  function videoMd(e: EvidenceItem) {
    const a = assetOf(e);
    const s: string[] = [`**Video ${e.ref}: ${esc(e.title)}**`, ''];
    if (a.preview) s.push(`![Preview of video ${e.ref}](${a.preview.rel})`, '');
    s.push(`- File: ${fileRef(e)} (${fmtBytes(e.size)})`, `- Duration: ${fmtTimecode(e.durationSeconds) || 'unknown'}`);
    if (e.caption) s.push(`- Caption: ${esc(e.caption)}`);
    if (e.description) s.push(`- Description: ${esc(e.description)}`);
    if (!a.preview && !a.frames.length) s.push('- No preview frame was captured for this video.');
    if (e.markers.length) s.push('', table(['Time', 'Moment', 'Note'], e.markers.map((mk) => [fmtTimecode(mk.timeSeconds), mk.label, mk.note])));
    if (a.frames.length) {
      s.push('');
      for (const fr of a.frames) s.push(`![Frame at ${fmtTimecode(fr.timeSeconds)}](${fr.rel})`, `*Frame at ${fmtTimecode(fr.timeSeconds)}*`, '');
    }
    if (a.problem) s.push('', `> ⚠ ${esc(a.problem)}`);
    return s.join('\n').trimEnd();
  }

  function docMd(e: EvidenceItem) {
    const a = assetOf(e);
    return `- **${e.ref}**: ${fileRef(e)} (${fmtBytes(e.size)})${e.caption ? ` – ${esc(e.caption)}` : ''}${a.problem ? ` ⚠ ${esc(a.problem)}` : ''}`;
  }
}
