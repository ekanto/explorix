import type { AssetMap, ImageAsset, PreparedAsset } from './assets.js';
import { fmtBytes, fmtDate, fmtDateTime, fmtDuration, fmtTimecode, humanize } from './text.js';
import { SECTION_TITLES, SEVERITY_COLORS, type Block, type EvidenceItem, type FindingItem, type ReportModel, type SectionKey } from './types.js';

const e = (s: string | number | null | undefined) =>
  s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const attr = e;
const multiline = (s: string) => e(s).replace(/\r?\n/g, '<br>');

function blocks(bs: Block[]): string {
  return bs
    .map((b) => {
      switch (b.type) {
        case 'p':
          return `<p>${multiline(b.text)}</p>`;
        case 'h':
          return `<p class="subhead">${e(b.text)}</p>`;
        case 'code':
          return `<pre><code>${e(b.text)}</code></pre>`;
        case 'ol':
        case 'ul':
          return `<${b.type}>${b.items.map((t) => `<li>${e(t)}</li>`).join('')}</${b.type}>`;
      }
    })
    .join('');
}

const table = (head: string[], rows: (string | number | null | undefined)[][], cls = '') =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c == null || c === '' ? '<span class="muted">–</span>' : typeof c === 'number' ? c : c.startsWith('\u0000') ? c.slice(1) : e(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
/** Marks a cell value as pre-rendered HTML. */
const raw = (html: string) => `\u0000${html}`;

const kv = (rows: [string, string | null | undefined][]) =>
  `<table class="kv"><tbody>${rows
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><th scope="row">${e(k)}</th><td>${v!.startsWith('\u0000') ? v!.slice(1) : e(v)}</td></tr>`)
    .join('')}</tbody></table>`;

const sevBadge = (s: string) => `<span class="sev" style="--c:${SEVERITY_COLORS[s] ?? '#495057'}">${e(humanize(s))}</span>`;
const anchor = (k: SectionKey) => `sec-${k}`;

export interface HtmlOptions {
  mode: 'html' | 'pdf';
  linkOriginals: boolean;
}

export function renderHtml(m: ReportModel, assets: AssetMap, opts: HtmlOptions): string {
  const o = m.options;
  const meta = o.showMetadata;
  const pdf = opts.mode === 'pdf';
  const assetOf = (x: EvidenceItem) => assets.get(x.id) as PreparedAsset;
  // PDFs show bundled paths as text: Chromium would turn relative links into absolute paths on this computer.
  const fileRef = (x: EvidenceItem) => {
    const a = assetOf(x);
    if (opts.linkOriginals && a.original) return pdf ? `<code>${e(a.original.rel)}</code>` : `<a href="${attr(a.original.rel)}">${e(x.fileName)}</a>`;
    return `<code>${e(x.fileName)}</code>`;
  };
  const img = (a: ImageAsset, alt: string, cls = '') => `<img class="${cls}" src="${attr(a.rel)}" width="${a.width}" height="${a.height}" alt="${attr(alt)}">`;

  const parts: string[] = [];
  const section = (k: SectionKey, html: string) => parts.push(`<section id="${anchor(k)}" class="sec sec-${k}"><h2>${e(SECTION_TITLES[k])}</h2>${html}</section>`);
  const body = m.sections.filter((k) => k !== 'cover' && k !== 'toc');

  for (const k of m.sections) {
    switch (k) {
      case 'cover': {
        const rows: [string, string | null][] = [['Project', `${m.project.name} (${m.project.key})`], ['Scope', m.scopeLabel], ['Report type', m.templateName]];
        if (meta) rows.push(['Author', m.author], ['Generated', fmtDateTime(m.generatedAt)], ['Generated with', `Explorix ${m.appVersion}`]);
        parts.push(`<header class="cover">
          ${o.branding.logoDataUrl ? `<img class="logo" src="${attr(o.branding.logoDataUrl)}" alt="Logo">` : ''}
          ${o.branding.organization ? `<div class="org">${e(o.branding.organization)}</div>` : ''}
          <h1>${e(m.title)}</h1>
          ${m.subtitle ? `<p class="subtitle">${e(m.subtitle)}</p>` : ''}
          ${kv(rows)}
          ${o.branding.confidentiality ? `<p class="confidential">${e(o.branding.confidentiality)}</p>` : ''}
        </header>`);
        break;
      }
      case 'toc':
        parts.push(`<nav class="toc" id="${anchor('toc')}"><h2>${e(SECTION_TITLES.toc)}</h2><ol>${body
          .map((s) => {
            const sub = s === 'findings' ? `<ol>${m.findings.map((f) => `<li><a href="#${attr(f.id)}">${e(f.key)}: ${e(f.title)}</a></li>`).join('')}</ol>` : '';
            return `<li><a href="#${anchor(s)}">${e(SECTION_TITLES[s])}</a>${sub}</li>`;
          })
          .join('')}</ol></nav>`);
        break;
      case 'executiveSummary': {
        let h = m.summary.paragraphs.map((p) => `<p>${e(p)}</p>`).join('');
        if (m.summary.bySeverity.length || m.summary.byClassification.length) {
          h += `<div class="stats">${m.summary.bySeverity.map((s) => `<div class="stat">${sevBadge(s.severity)}<b>${s.count}</b></div>`).join('')}</div>`;
        }
        for (const s of m.sessions) if (s.summary.length) h += `<h3>${e(s.key)} summary: ${e(s.title)}</h3>${blocks(s.summary)}`;
        section(k, h);
        break;
      }
      case 'metadata': {
        const rows: [string, string | null][] = [['Project', `${m.project.name} (${m.project.key})`], ['Scope', m.scopeLabel]];
        if (m.milestone) rows.push(['Milestone', `${m.milestone.name} (${humanize(m.milestone.status)}${m.milestone.dueDate ? `, due ${fmtDate(m.milestone.dueDate)}` : ''})`]);
        rows.push(['Sessions', String(m.summary.sessionCount)], ['Findings', String(m.summary.findingCount)]);
        if (m.summary.timeSpentSeconds) rows.push(['Time spent', fmtDuration(m.summary.timeSpentSeconds)]);
        let h = kv(rows);
        if (m.sessions.length)
          h += `<h3>Sessions</h3>${table(['Session', 'Title', 'Status', 'Tester', 'Started', 'Time spent', 'Findings'], m.sessions.map((s) => [s.key, s.title, humanize(s.status), s.tester, fmtDateTime(s.startedAt), fmtDuration(s.elapsedSeconds), s.findingCount]))}`;
        section(k, h);
        break;
      }
      case 'mission':
        section(
          k,
          m.charters
            .map((c) => {
              const rows: [string, string | null][] = [['Target', c.target], ['Timebox', `${c.timeboxMinutes} min`], ['Priority', humanize(c.priority)], ['Risk level', humanize(c.riskLevel)]];
              return `<div class="keep"><h3>${e(c.key)}: ${e(c.title)}</h3><div class="mission">${blocks(c.mission)}</div>${kv(rows)}</div>${c.objectives.length ? `<h4>Objectives</h4>${blocks(c.objectives)}` : ''}`;
            })
            .join(''),
        );
        break;
      case 'scope':
        section(
          k,
          m.charters
            .map((c) => {
              const ps: [string, Block[]][] = [['In scope', c.scope], ['Out of scope', c.outOfScope], ['Assumptions', c.assumptions], ['Prerequisites', c.prerequisites], ['Test data', c.testData]];
              if (!ps.some(([, b]) => b.length)) return '';
              return `${m.charters.length > 1 ? `<h3>${e(c.key)}: ${e(c.title)}</h3>` : ''}${ps.filter(([, b]) => b.length).map(([l, b]) => `<h4>${e(l)}</h4>${blocks(b)}`).join('')}`;
            })
            .join(''),
        );
        break;
      case 'environment': {
        let h = '';
        const rows = m.sessions.filter((s) => s.browser || s.os || s.device || s.buildVersion || s.environment).map((s) => [s.key, s.environment, s.browser, s.os, s.device, s.buildVersion]);
        if (rows.length) h += table(['Session', 'Environment', 'Browser', 'OS', 'Device', 'Build'], rows);
        for (const s of m.sessions) if (s.environmentNotes) h += `<p><b>${e(s.key)} environment notes:</b> ${multiline(s.environmentNotes)}</p>`;
        const envs = [...new Set(m.findings.map((f) => [f.environment, f.browser].filter(Boolean).join(' · ')).filter(Boolean))];
        if (envs.length) h += `<h4>Environments recorded on findings</h4><ul>${envs.map((x) => `<li>${e(x)}</li>`).join('')}</ul>`;
        if (!m.sessions.length) for (const c of m.charters) if (c.environment) h += `<p><b>${e(c.key)}:</b> ${e(c.environment)}</p>`;
        section(k, h);
        break;
      }
      case 'timeline':
        section(
          k,
          m.sessions
            .map((s) => {
              const rows: [string, string | null][] = [
                ['Started', fmtDateTime(s.startedAt) || 'Not started'],
                ['Ended', fmtDateTime(s.endedAt)],
                ['Time spent', `${fmtDuration(s.elapsedSeconds) || '0 s'} of ${s.timeboxMinutes} min timebox`],
              ];
              if (s.tbs) rows.push(['Split', `Setup ${s.tbs.setup}% · Testing ${s.tbs.test}% · Bug investigation ${s.tbs.bug}%`]);
              const bar = s.tbs ? `<div class="tbs" aria-hidden="true"><span style="flex:${s.tbs.setup}" class="t-setup"></span><span style="flex:${s.tbs.test}" class="t-test"></span><span style="flex:${s.tbs.bug}" class="t-bug"></span></div>` : '';
              const tl = s.timeline.length
                ? table(['Session time', 'Type', 'Entry'], s.timeline.map((t) => [fmtTimecode(t.elapsedSeconds), humanize(t.type), t.ref ? `${t.ref}: ${t.text}` : t.text]), 'timeline')
                : '';
              return `<h3>${e(s.key)}: ${e(s.title)}</h3>${kv(rows)}${bar}${tl}${s.timelineTruncated ? `<p class="muted">Timeline truncated to the first ${s.timeline.length} entries.</p>` : ''}`;
            })
            .join(''),
        );
        break;
      case 'testExecution': {
        let h = '';
        if (m.testExecution.runs.length)
          h += `<h3>Manual test runs</h3>${table(['Run', 'Name', 'Status', 'Total', 'Passed', 'Failed', 'Blocked', 'Skipped', 'Untested', 'Pass rate'], m.testExecution.runs.map((r) => [r.key, r.name, humanize(r.status), r.total, r.passed, r.failed, r.blocked, r.skipped, r.untested, r.passRate == null ? null : `${r.passRate}%`]), 'num')}`;
        if (m.testExecution.automation.length)
          h += `<h3>Automation runs</h3>${table(['Run', 'Name', 'Started', 'Branch', 'Total', 'Passed', 'Failed', 'Skipped'], m.testExecution.automation.map((a) => [a.key, a.name, fmtDateTime(a.startedAt), a.branch, a.total, a.passed, a.failed, a.skipped]), 'num')}`;
        section(k, h);
        break;
      }
      case 'findingsSummary':
        section(
          k,
          table(
            ['ID', 'Title', 'Classification', 'Severity', 'Priority', 'Status', 'Evidence'],
            m.findings.map((f) => [raw(`<a href="#${attr(f.id)}">${e(f.key)}</a>`), f.title, f.classification, raw(sevBadge(f.severity)), humanize(f.priority), humanize(f.status), f.evidence.map((x) => x.ref).join(', ')]),
          ),
        );
        break;
      case 'findings':
        section(k, m.findings.map(findingHtml).join(''));
        break;
      case 'screenshots':
        section(k, m.looseEvidence.filter((x) => x.kind === 'IMAGE').map(imageHtml).join(''));
        break;
      case 'videos': {
        const vids = m.evidence.filter((x) => x.kind === 'VIDEO');
        let h = `<p class="note">${
          pdf
            ? 'Videos cannot play inside a PDF. Each video is shown with a preview, its duration and important timestamps; the original is identified by file name' + (opts.linkOriginals ? ' and its path inside the report package.' : '.')
            : opts.linkOriginals
              ? 'Videos play in this page from the bundled <code>evidence</code> folder (playback depends on the codecs your browser supports).'
              : 'Original videos are not bundled with this export; each is identified by file name.'
        }</p>`;
        h += table(['Ref', 'Title', 'Duration', 'Linked to', 'File'], vids.map((v) => [v.ref, v.title, fmtTimecode(v.durationSeconds) || 'Unknown', v.findingKey ?? v.sessionKey, raw(fileRef(v))]));
        h += vids.filter((v) => !v.findingId).map(videoHtml).join('');
        section(k, h);
        break;
      }
      case 'attachments':
        section(k, `<ul class="docs">${m.looseEvidence.filter((x) => x.kind !== 'IMAGE' && x.kind !== 'VIDEO').map(docHtml).join('')}</ul>`);
        break;
      case 'risks':
        section(k, table(['Type', 'Description', 'Source'], m.risks.map((r) => [r.kind, r.text, r.ref])));
        break;
      case 'outstanding':
        section(k, table(['Reference', 'Title', 'Severity', 'Status', 'Owner'], m.outstanding.map((x) => [x.ref, x.title, raw(sevBadge(x.severity)), x.status, x.owner])));
        break;
      case 'recommendations':
        section(k, `<ol>${m.recommendations.map((r) => `<li>${e(r.text)}${r.ref ? ` <span class="muted">(${e(r.ref)})</span>` : ''}</li>`).join('')}</ol>`);
        break;
      case 'assessment':
        section(k, m.assessment.map((a) => `<div class="keep"><h3>${e(a.label)}</h3>${blocks(a.blocks)}</div>`).join(''));
        break;
      case 'evidenceIndex':
        section(
          k,
          table(
            ['Ref', 'Type', 'Title', 'File', 'Size', 'Linked to', 'Added', 'SHA-256'],
            m.evidence.map((x) => [x.ref, humanize(x.kind), x.title, raw(fileRef(x)), fmtBytes(x.size), x.findingKey ?? x.sessionKey, fmtDateTime(x.createdAt), raw(`<code class="hash">${e(x.sha256)}</code>`)]),
            'index',
          ),
        );
        break;
      case 'appendices':
        section(k, m.sessions.filter((s) => s.notes.length).map((s) => `<h3>Session notes: ${e(s.key)}</h3>${blocks(s.notes)}`).join(''));
        break;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="Explorix ${attr(m.appVersion)}">
<title>${e(m.title)}</title>
<style>${css(m, pdf)}</style>
</head>
<body class="${pdf ? 'pdf' : 'screen'}">
<main>${parts.join('\n')}</main>
${pdf ? '' : `<footer class="foot">Generated by Explorix ${e(m.appVersion)} on ${e(fmtDateTime(m.generatedAt))}</footer>`}
</body>
</html>`;

  function findingHtml(f: FindingItem) {
    const rows: [string, string | null][] = [
      ['Classification', f.classification],
      ['Severity', raw(sevBadge(f.severity))],
      ['Priority', humanize(f.priority)],
      ['Status', humanize(f.status)],
    ];
    if (meta) rows.push(['Author', f.author], ['Created', fmtDateTime(f.createdAt)]);
    rows.push(['Owner', f.owner]);
    if (f.sessionKey) rows.push(['Session', `${f.sessionKey}${f.elapsedSeconds != null ? ` at ${fmtTimecode(f.elapsedSeconds)}` : ''}`]);
    rows.push(['Charter', f.charterKey], ['Environment', f.environment], ['Browser', f.browser]);
    if (f.issue) {
      const label = `${f.issue.key}${f.issue.externalKey ? ` / ${f.issue.externalKey}` : ''}: ${f.issue.title} (${humanize(f.issue.status)})`;
      rows.push(['Related issue', f.issue.externalUrl && /^https?:\/\//.test(f.issue.externalUrl) ? raw(`<a href="${attr(f.issue.externalUrl)}">${e(label)}</a>`) : label]);
    }
    if (f.requirement) rows.push(['Requirement', `${f.requirement.key}: ${f.requirement.title}`]);
    if (f.tags.length) rows.push(['Tags', f.tags.join(', ')]);
    const ps: [string, Block[]][] = [['Description', f.description], ['Preconditions', f.preconditions], ['Steps to reproduce', f.reproSteps], ['Expected behavior', f.expected], ['Actual behavior', f.actual], ['Follow-up', f.followUp], ['Resolution', f.resolution]];
    let h = `<article class="finding" id="${attr(f.id)}"><div class="keep"><h3><span class="fkey">${e(f.key)}</span> ${e(f.title)}</h3>${kv(rows)}</div>`;
    for (const [l, b] of ps) if (b.length) h += `<div class="part"><h4>${e(l)}</h4>${blocks(b)}</div>`;
    if (f.evidence.length) h += `<h4>Evidence</h4>${f.evidence.map((x) => (x.kind === 'IMAGE' ? imageHtml(x) : x.kind === 'VIDEO' ? videoHtml(x) : `<ul class="docs">${docHtml(x)}</ul>`)).join('')}`;
    if (f.comments.length) h += `<h4>Comments</h4>${f.comments.map((c) => `<div class="comment"><div class="muted">${e(c.author)} · ${e(fmtDateTime(c.at))}</div>${blocks(c.body)}</div>`).join('')}`;
    return `${h}</article>`;
  }

  function imageHtml(x: EvidenceItem) {
    const a = assetOf(x);
    const label = `${x.caption || x.title}${x.annotated ? ' (annotated)' : ''}`;
    const pic = a.preview ? (opts.linkOriginals && a.original && !pdf ? `<a href="${attr(a.original.rel)}">${img(a.preview, label)}</a>` : img(a.preview, label)) : '';
    return `<figure class="ev" id="ev-${attr(x.id)}">${pic}<figcaption><b>Figure ${e(x.ref)}:</b> ${e(label)}${x.description ? `<br><span class="muted">${e(x.description)}</span>` : ''}${
      opts.linkOriginals && a.original ? `<br><span class="muted">Original: ${fileRef(x)}</span>` : ''
    }${a.problem ? `<br><span class="warn">⚠ ${e(a.problem)}</span>` : ''}</figcaption></figure>`;
  }

  function videoHtml(x: EvidenceItem) {
    const a = assetOf(x);
    const media =
      !pdf && opts.linkOriginals && a.original
        ? `<video controls preload="metadata" src="${attr(a.original.rel)}"${a.preview ? ` poster="${attr(a.preview.rel)}"` : ''}></video>`
        : a.preview
          ? img(a.preview, `Preview of video ${x.ref}`, 'thumb')
          : '<div class="noframe">No preview frame was captured for this video.</div>';
    const rows: [string, string | null][] = [
      ['File', raw(fileRef(x))],
      ['Size', fmtBytes(x.size)],
      ['Duration', fmtTimecode(x.durationSeconds) || 'Unknown'],
      ['Caption', x.caption],
      ['Description', x.description],
      ['Linked to', x.findingKey ?? x.sessionKey],
    ];
    const markers = x.markers.length ? table(['Time', 'Moment', 'Note'], x.markers.map((mk) => [fmtTimecode(mk.timeSeconds), mk.label, mk.note])) : '';
    const frames = a.frames.length ? `<div class="frames">${a.frames.map((fr) => `<figure>${img(fr, `Frame at ${fmtTimecode(fr.timeSeconds)}`)}<figcaption>${e(fmtTimecode(fr.timeSeconds))}</figcaption></figure>`).join('')}</div>` : '';
    return `<div class="video" id="ev-${attr(x.id)}"><div class="keep"><h4 class="vt">▶ Video ${e(x.ref)}: ${e(x.title)}</h4>${media}${kv(rows)}</div>${markers}${frames}${a.problem ? `<p class="warn">⚠ ${e(a.problem)}</p>` : ''}</div>`;
  }

  function docHtml(x: EvidenceItem) {
    const a = assetOf(x);
    return `<li id="ev-${attr(x.id)}"><b>${e(x.ref)}</b> ${fileRef(x)} <span class="muted">(${e(fmtBytes(x.size))})</span>${x.caption ? `: ${e(x.caption)}` : ''}${a.problem ? ` <span class="warn">⚠ ${e(a.problem)}</span>` : ''}</li>`;
  }
}

function css(m: ReportModel, pdf: boolean) {
  const accent = m.options.branding.accentColor;
  const maxImgH = m.options.orientation === 'landscape' ? '120mm' : { small: '90mm', medium: '140mm', large: '200mm' }[m.options.imageSize];
  const maxImgW = { small: '70%', medium: '100%', large: '100%' }[m.options.imageSize];
  return `
:root { --accent: ${accent}; --ink: #1f2430; --muted: #5c6370; --line: #d8dde6; --soft: #f4f6fa; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); font: 10.5pt/1.5 "Segoe UI", "Helvetica Neue", Arial, sans-serif; }
body.screen main { max-width: 980px; margin: 0 auto; padding: 32px 24px 48px; }
h1, h2, h3, h4 { line-height: 1.25; break-after: avoid; page-break-after: avoid; }
h2 { color: var(--accent); font-size: 17pt; border-bottom: 2px solid var(--accent); padding-bottom: 4px; margin: 28px 0 12px; }
h3 { font-size: 13pt; margin: 20px 0 8px; }
h4 { font-size: 11pt; margin: 14px 0 6px; color: #343a46; }
p, li { overflow-wrap: anywhere; }
a { color: var(--accent); }
.muted { color: var(--muted); }
.warn { color: #b02a2a; }
.note { background: var(--soft); border-left: 3px solid var(--accent); padding: 8px 12px; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 9pt; background: var(--soft); padding: 0 3px; border-radius: 3px; overflow-wrap: anywhere; }
pre { background: #f1f3f7; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 9pt; }
pre code { background: none; padding: 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 9.5pt; }
th, td { border: 1px solid var(--line); padding: 5px 7px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
table.index { font-size: 8.5pt; }
table.index th, table.index td:nth-child(-n+2), table.index td:nth-child(5), table.index td:nth-child(6) { white-space: nowrap; overflow-wrap: normal; }
table.index td:nth-child(8) { width: 24%; }
table.index .hash { font-size: 7pt; word-break: break-all; }
thead th { background: var(--soft); }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
table.kv th { width: 28%; background: var(--soft); font-weight: 600; }
table.index td:last-child { font-size: 7.5pt; }
code.hash { font-size: 7.5pt; background: none; }
.sev { display: inline-block; padding: 0 8px; border-radius: 10px; font-size: 8.5pt; font-weight: 700; color: #fff; background: var(--c); white-space: nowrap; }
.cover { padding-top: ${pdf ? '45mm' : '24px'}; ${pdf ? 'break-after: page; page-break-after: always;' : 'margin-bottom: 24px;'} }
.cover h1 { font-size: 28pt; color: var(--accent); margin: 8px 0; }
.cover .subtitle { font-size: 13pt; color: var(--muted); margin: 0 0 24px; }
.cover .org { font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.cover .logo { max-height: 22mm; max-width: 60mm; display: block; margin-bottom: 10mm; }
.cover table.kv { width: auto; min-width: 60%; }
.confidential { margin-top: 18px; font-weight: 700; color: #b02a2a; border: 1px solid #b02a2a; display: inline-block; padding: 4px 10px; }
.toc { ${pdf ? 'break-after: page; page-break-after: always;' : ''} }
.toc ol { padding-left: 20px; } .toc ol ol { font-size: 9.5pt; }
.toc a { text-decoration: none; color: var(--ink); }
.stats { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0; }
.stat { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; display: flex; gap: 8px; align-items: center; }
.tbs { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin: -6px 0 12px; max-width: 360px; }
.t-setup { background: #74c0fc; } .t-test { background: #63e6be; } .t-bug { background: #ff8787; }
.finding { border-top: 1px solid var(--line); padding-top: 6px; margin-top: 18px; }
.finding h3 .fkey { color: var(--accent); margin-right: 6px; }
.keep, figure, .comment { break-inside: avoid; page-break-inside: avoid; }
figure.ev { margin: 10px 0 16px; }
figure img, .video img.thumb, .video video { display: block; max-width: ${maxImgW}; max-height: ${maxImgH}; width: auto; height: auto; object-fit: contain; border: 1px solid var(--line); border-radius: 4px; }
figcaption { font-size: 9pt; margin-top: 4px; }
.video { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin: 10px 0 16px; }
.video h4.vt { margin-top: 2px; }
.noframe { padding: 18px; background: var(--soft); color: var(--muted); text-align: center; border-radius: 4px; }
.frames { display: flex; flex-wrap: wrap; gap: 8px; }
.frames figure { margin: 0; width: calc(33% - 6px); }
.frames img { max-width: 100%; max-height: 50mm; }
.comment { border-left: 3px solid var(--line); padding: 2px 10px; margin: 6px 0; }
ul.docs { padding-left: 18px; }
.foot { text-align: center; color: var(--muted); font-size: 9pt; padding: 16px; border-top: 1px solid var(--line); }
@page { size: A4 ${m.options.orientation}; margin: 20mm 15mm 18mm; }
@media screen and (prefers-color-scheme: dark) {
  body.screen { background: #15171c; --ink: #e6e8ee; --muted: #a2a9b6; --line: #343946; --soft: #1f232b; }
  body.screen pre { background: #1f232b; }
}`;
}
