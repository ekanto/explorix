import type { Prisma, ReportKind } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { evidenceInclude, type EvidenceRow } from '../lib/evidence.js';
import { keys } from '../lib/util.js';
import { fmtDuration, htmlToBlocks, humanize, textToBlocks } from './text.js';
import {
  BUILT_IN_TEMPLATES,
  SECTION_KEYS,
  SEVERITY_RANK,
  type Block,
  type CharterItem,
  type EvidenceItem,
  type FindingItem,
  type ReportModel,
  type ReportOptions,
  type ReportScope,
  type SectionKey,
  type SessionItem,
} from './types.js';

const userName = { select: { name: true } } as const;

const findingInclude = {
  classification: true,
  author: userName,
  owner: userName,
  session: { select: { id: true, number: true, title: true } },
  charter: { select: { number: true } },
  issue: { select: { number: true, title: true, status: true, externalKey: true, externalUrl: true } },
  requirement: { select: { number: true, title: true, externalKey: true } },
  tags: { include: { tag: true } },
  comments: { orderBy: { createdAt: 'asc' }, include: { author: userName } },
  attachments: evidenceInclude,
} satisfies Prisma.FindingInclude;

const sessionInclude = {
  tester: userName,
  reviewer: userName,
  milestone: { select: { name: true } },
  environment: { select: { name: true } },
  charter: { select: { id: true, number: true } },
  attachments: { ...evidenceInclude, where: { ...evidenceInclude.where, findingId: null } },
  _count: { select: { findings: true } },
} satisfies Prisma.ExploratorySessionInclude;

const charterInclude = { environment: { select: { name: true } } } satisfies Prisma.CharterInclude;

type SessionRow = Prisma.ExploratorySessionGetPayload<{ include: typeof sessionInclude }>;
type CharterRow = Prisma.CharterGetPayload<{ include: typeof charterInclude }>;

const TIMELINE_LIMIT = 400;

export interface BuildContext {
  projectId: string;
  userName: string;
  kind: ReportKind;
  scope: ReportScope;
  options: ReportOptions;
}

/** Loads the scope's real data and turns it into the structured report model. Nothing is invented. */
export async function buildReportModel(ctx: BuildContext): Promise<ReportModel> {
  const { projectId: pid, scope, options: o } = ctx;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: pid }, select: { key: true, name: true } });
  const live = { archivedAt: null };

  let charters: CharterRow[] = [];
  let sessions: SessionRow[] = [];
  let findingWhere: Prisma.FindingWhereInput;
  let milestone: ReportModel['milestone'] = null;
  let scopeLabel: string;
  let runsWhere: Prisma.TestRunWhereInput | null = null;
  let automationWhere: Prisma.AutomationRunWhereInput | null = null;

  switch (scope.type) {
    case 'finding':
    case 'findings': {
      const ids = scope.type === 'finding' ? [scope.findingId] : scope.findingIds;
      const found = await prisma.finding.findMany({ where: { projectId: pid, id: { in: ids } }, select: { id: true, sessionId: true, charterId: true, number: true } });
      if (found.length !== new Set(ids).size) throw notFound('Finding');
      findingWhere = { id: { in: ids } };
      const sids = [...new Set(found.map((f) => f.sessionId).filter((x): x is string => !!x))];
      const cids = [...new Set(found.map((f) => f.charterId).filter((x): x is string => !!x))];
      sessions = await prisma.exploratorySession.findMany({ where: { projectId: pid, id: { in: sids } }, include: sessionInclude, orderBy: { number: 'asc' } });
      charters = await prisma.charter.findMany({ where: { projectId: pid, id: { in: cids } }, include: charterInclude, orderBy: { number: 'asc' } });
      scopeLabel = found.length === 1 ? `Finding ${keys.finding(found[0].number)}` : `${found.length} selected findings`;
      break;
    }
    case 'session': {
      const s = await prisma.exploratorySession.findFirst({ where: { projectId: pid, id: scope.sessionId }, include: sessionInclude });
      if (!s) throw notFound('Session');
      sessions = [s];
      charters = await prisma.charter.findMany({ where: { id: s.charterId }, include: charterInclude });
      findingWhere = { sessionId: s.id };
      scopeLabel = `Session ${keys.session(s.number)}: ${s.title}`;
      break;
    }
    case 'charter': {
      const c = await prisma.charter.findFirst({ where: { projectId: pid, id: scope.charterId }, include: charterInclude });
      if (!c) throw notFound('Charter');
      charters = [c];
      sessions = await prisma.exploratorySession.findMany({ where: { charterId: c.id, ...live }, include: sessionInclude, orderBy: { number: 'asc' } });
      findingWhere = { OR: [{ charterId: c.id }, { sessionId: { in: sessions.map((s) => s.id) } }] };
      scopeLabel = `Charter ${keys.charter(c.number)}: ${c.title}`;
      break;
    }
    case 'milestone': {
      const m = await prisma.milestone.findFirst({ where: { projectId: pid, id: scope.milestoneId } });
      if (!m) throw notFound('Milestone');
      milestone = { name: m.name, status: m.status, dueDate: m.dueDate };
      sessions = await prisma.exploratorySession.findMany({ where: { projectId: pid, milestoneId: m.id, ...live }, include: sessionInclude, orderBy: { number: 'asc' } });
      const cids = new Set(sessions.map((s) => s.charterId));
      charters = await prisma.charter.findMany({ where: { projectId: pid, ...live, OR: [{ milestoneId: m.id }, { id: { in: [...cids] } }] }, include: charterInclude, orderBy: { number: 'asc' } });
      findingWhere = { OR: [{ sessionId: { in: sessions.map((s) => s.id) } }, { charter: { milestoneId: m.id } }] };
      runsWhere = { milestoneId: m.id };
      automationWhere = { milestoneId: m.id };
      scopeLabel = `Milestone: ${m.name}`;
      break;
    }
    case 'project': {
      sessions = await prisma.exploratorySession.findMany({ where: { projectId: pid, ...live }, include: sessionInclude, orderBy: { number: 'asc' }, take: 500 });
      charters = await prisma.charter.findMany({ where: { projectId: pid, ...live }, include: charterInclude, orderBy: { number: 'asc' }, take: 500 });
      findingWhere = {};
      runsWhere = {};
      automationWhere = {};
      scopeLabel = `Project ${project.key}: ${project.name}`;
      break;
    }
  }

  // Report filters (selection, severity, classification, dates).
  const and: Prisma.FindingWhereInput[] = [{ projectId: pid }, findingWhere];
  if (o.findingIds) and.push({ id: { in: o.findingIds } });
  if (o.severities) and.push({ severity: { in: o.severities } });
  if (o.classificationKeys) and.push({ classification: { key: { in: o.classificationKeys } } });
  if (o.dateFrom) and.push({ createdAt: { gte: o.dateFrom } });
  if (o.dateTo) and.push({ createdAt: { lte: endOfDay(o.dateTo) } });
  const chronological = scope.type === 'session' || scope.type === 'charter';
  const findingRows = await prisma.finding.findMany({ where: { AND: and }, include: findingInclude, orderBy: chronological ? [{ createdAt: 'asc' }] : [{ number: 'asc' }], take: 2000 });
  if (!chronological) findingRows.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || a.number - b.number);
  if (o.dateFrom || o.dateTo) {
    sessions = sessions.filter((s) => {
      const t = (s.startedAt ?? s.createdAt).getTime();
      return (!o.dateFrom || t >= o.dateFrom.getTime()) && (!o.dateTo || t <= endOfDay(o.dateTo).getTime());
    });
  }

  // Evidence selection and stable numbering (E1…En in reading order).
  const excluded = new Set(o.excludeEvidenceIds);
  const kindOn = (k: string) => (k === 'IMAGE' ? o.includeImages : k === 'VIDEO' ? o.includeVideos : o.includeAttachments);
  const selected = (a: EvidenceRow) => a.includeInReports && !excluded.has(a.id) && kindOn(a.kind);
  const evidence: EvidenceItem[] = [];
  const sessionKeyById = new Map(sessions.map((s) => [s.id, keys.session(s.number)]));
  const toEvidence = (a: EvidenceRow, finding: { id: string; key: string } | null, sessionKey: string | null): EvidenceItem => {
    const annotated = [...a.derivatives].reverse().find((d) => d.derivation === 'ANNOTATED');
    const thumb = a.derivatives.find((d) => d.derivation === 'THUMBNAIL');
    const frames = a.derivatives.filter((d) => d.derivation === 'FRAME').sort((x, y) => (x.frameTimeSeconds ?? 0) - (y.frameTimeSeconds ?? 0));
    const frameKey = new Map(frames.map((f) => [f.id, f.storageKey]));
    const item: EvidenceItem = {
      id: a.id,
      ref: `E${evidence.length + 1}`,
      kind: a.kind,
      title: a.label || a.fileName,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      sha256: a.sha256,
      caption: a.caption,
      description: a.description,
      width: a.width,
      height: a.height,
      durationSeconds: a.durationSeconds,
      createdAt: a.createdAt,
      uploader: a.uploader?.name ?? null,
      findingId: finding?.id ?? null,
      findingKey: finding?.key ?? null,
      sessionKey,
      storageKey: a.storageKey,
      displayStorageKey: a.kind === 'IMAGE' ? (o.preferAnnotated && annotated ? annotated.storageKey : a.storageKey) : null,
      displayId: a.kind === 'IMAGE' ? (o.preferAnnotated && annotated ? annotated.id : a.id) : null,
      annotated: a.kind === 'IMAGE' && o.preferAnnotated && !!annotated,
      thumbnailStorageKey: thumb?.storageKey ?? frames[0]?.storageKey ?? null,
      thumbnailId: thumb?.id ?? frames[0]?.id ?? null,
      frames: frames.map((f) => ({ id: f.id, storageKey: f.storageKey, timeSeconds: f.frameTimeSeconds })),
      markers: a.markers.map((m) => ({ timeSeconds: m.timeSeconds, label: m.label, note: m.note, frameStorageKey: m.frameId ? (frameKey.get(m.frameId) ?? null) : null })),
    };
    evidence.push(item);
    return item;
  };

  const findings: FindingItem[] = findingRows.map((f) => {
    const key = keys.finding(f.number);
    const item: FindingItem = {
      id: f.id,
      key,
      title: f.title,
      classification: f.classification.name,
      isDefect: f.classification.isDefect,
      severity: f.severity,
      priority: f.priority,
      status: f.status,
      author: f.author.name,
      owner: f.owner?.name ?? null,
      createdAt: f.createdAt,
      sessionKey: f.session ? keys.session(f.session.number) : null,
      sessionTitle: f.session?.title ?? null,
      charterKey: f.charter ? keys.charter(f.charter.number) : null,
      elapsedSeconds: f.sessionElapsedSeconds,
      description: textToBlocks(f.description),
      preconditions: textToBlocks(f.preconditions),
      reproSteps: textToBlocks(f.reproSteps),
      expected: textToBlocks(f.expected),
      actual: textToBlocks(f.actual),
      environment: f.environment,
      browser: f.browser,
      followUp: textToBlocks(f.followUp),
      resolution: textToBlocks(f.resolution),
      tags: f.tags.map((t) => t.tag.name),
      issue: f.issue ? { key: keys.issue(project.key, f.issue.number), title: f.issue.title, status: f.issue.status, externalKey: f.issue.externalKey, externalUrl: f.issue.externalUrl } : null,
      requirement: f.requirement ? { key: f.requirement.externalKey || keys.requirement(f.requirement.number), title: f.requirement.title } : null,
      comments: o.includeComments ? f.comments.map((c) => ({ author: c.author.name, at: c.createdAt, body: textToBlocks(c.body) })) : [],
      evidence: [],
    };
    item.evidence = f.attachments.filter(selected).map((a) => toEvidence(a, { id: f.id, key }, item.sessionKey));
    return item;
  });
  const looseEvidence = sessions.flatMap((s) => s.attachments.filter(selected).map((a) => toEvidence(a, null, sessionKeyById.get(s.id) ?? null)));

  // Timelines: real log entries only.
  const logRows = sessions.length && sessions.length <= 10
    ? await prisma.sessionLogEntry.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) }, type: { in: ['NOTE', 'FINDING', 'STATUS_CHANGE', 'ATTACHMENT'] } },
        orderBy: { createdAt: 'asc' },
        include: { finding: { select: { number: true } } },
        take: TIMELINE_LIMIT * 10 + 1,
      })
    : [];
  const charterKeyById = new Map(charters.map((c) => [c.id, keys.charter(c.number)]));
  // Entries about findings or evidence the user filtered out are left out as well.
  const includedFindings = new Set(findings.map((f) => f.id));
  const includedEvidence = new Set(evidence.map((x) => x.id));
  const visible = (l: (typeof logRows)[number]) => (!l.findingId || includedFindings.has(l.findingId)) && (!l.attachmentId || includedEvidence.has(l.attachmentId));
  const sessionItems: SessionItem[] = sessions.map((s) => {
    const entries = logRows.filter((l) => l.sessionId === s.id && visible(l));
    return {
      id: s.id,
      key: keys.session(s.number),
      title: s.title,
      status: s.status,
      charterKey: charterKeyById.get(s.charterId) ?? keys.charter(s.charter.number),
      tester: s.tester?.name ?? null,
      reviewer: s.reviewer?.name ?? null,
      reviewComment: s.reviewComment,
      reviewedAt: s.reviewedAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      elapsedSeconds: s.elapsedSeconds,
      timeboxMinutes: s.timeboxMinutes,
      environment: s.environment?.name ?? null,
      browser: s.browser,
      os: s.os,
      device: s.device,
      buildVersion: s.buildVersion,
      environmentNotes: s.environmentNotes,
      milestone: s.milestone?.name ?? null,
      summary: htmlToBlocks(s.summary),
      notes: htmlToBlocks(s.notes),
      tbs: s.setupPercent != null || s.testPercent != null || s.bugPercent != null ? { setup: s.setupPercent ?? 0, test: s.testPercent ?? 0, bug: s.bugPercent ?? 0 } : null,
      charterVsOpportunity: s.charterVsOpportunity,
      findingCount: s._count.findings,
      timeline: entries.slice(0, TIMELINE_LIMIT).map((l) => ({
        at: l.createdAt,
        elapsedSeconds: l.elapsedSeconds,
        type: l.type,
        text: htmlToBlocks(l.content).map((b) => ('items' in b ? b.items.join('; ') : b.text)).join(' ').slice(0, 600),
        ref: l.finding ? keys.finding(l.finding.number) : null,
      })),
      timelineTruncated: entries.length > TIMELINE_LIMIT,
    };
  });

  const charterItems: CharterItem[] = charters.map((c) => ({
    id: c.id,
    key: keys.charter(c.number),
    title: c.title,
    mission: textToBlocks(c.mission),
    target: c.target,
    objectives: textToBlocks(c.objectives),
    scope: textToBlocks(c.scope),
    outOfScope: textToBlocks(c.outOfScope),
    assumptions: textToBlocks(c.assumptions),
    risks: textToBlocks(c.risks),
    prerequisites: textToBlocks(c.prerequisites),
    testData: textToBlocks(c.testData),
    environment: [c.environment?.name, c.browser, c.os, c.device].filter(Boolean).join(' · ') || null,
    timeboxMinutes: c.timeboxMinutes,
    priority: c.priority,
    riskLevel: c.riskLevel,
  }));

  // Test execution (milestone / project scopes).
  const testExecution: ReportModel['testExecution'] = { runs: [], automation: [] };
  if (runsWhere) {
    const runs = await prisma.testRun.findMany({
      where: { projectId: pid, ...runsWhere },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { items: { select: { status: { select: { category: true } } } } },
    });
    testExecution.runs = runs.map((r) => {
      const c = { PASSED: 0, FAILED: 0, BLOCKED: 0, SKIPPED: 0, RETEST: 0, UNTESTED: 0 };
      for (const it of r.items) c[(it.status?.category ?? 'UNTESTED') as keyof typeof c]++;
      const executed = r.items.length - c.UNTESTED;
      return { key: keys.testRun(r.number), name: r.name, status: r.status, total: r.items.length, passed: c.PASSED, failed: c.FAILED + c.RETEST, blocked: c.BLOCKED, skipped: c.SKIPPED, untested: c.UNTESTED, passRate: executed ? Math.round((c.PASSED / executed) * 100) : null };
    });
  }
  if (automationWhere) {
    const autos = await prisma.automationRun.findMany({ where: { projectId: pid, ...automationWhere }, orderBy: { startedAt: 'desc' }, take: 15 });
    testExecution.automation = autos.map((a) => ({ key: keys.automationRun(a.number), name: a.name, startedAt: a.startedAt, total: a.totalCount, passed: a.passedCount, failed: a.failedCount, skipped: a.skippedCount, branch: a.branch }));
  }

  // Derived lists, all traceable to real records.
  const risks: ReportModel['risks'] = [];
  for (const c of charterItems) for (const b of c.risks) for (const t of blockLines(b)) risks.push({ kind: 'Charter risk', text: t, ref: c.key });
  for (const f of findingRows) {
    const k = f.classification.key;
    if (k === 'risk' || k === 'question') risks.push({ kind: f.classification.name, text: f.title, ref: keys.finding(f.number) });
  }
  const openFinding = (s: string) => s === 'NEW' || s === 'TRIAGED';
  const outstanding: ReportModel['outstanding'] = [];
  const seenIssues = new Set<string>();
  for (const f of findingRows) {
    if (f.issue && (f.issue.status === 'OPEN' || f.issue.status === 'IN_PROGRESS')) {
      const ik = keys.issue(project.key, f.issue.number);
      if (!seenIssues.has(ik)) outstanding.push({ ref: f.issue.externalKey ? `${ik} (${f.issue.externalKey})` : ik, title: f.issue.title, severity: f.severity, status: humanize(f.issue.status), owner: f.owner?.name ?? null });
      seenIssues.add(ik);
    } else if (!f.issue && openFinding(f.status) && (f.classification.isDefect || f.classification.key === 'potential_defect')) {
      outstanding.push({ ref: keys.finding(f.number), title: f.title, severity: f.severity, status: humanize(f.status), owner: f.owner?.name ?? null });
    }
  }
  const recommendations: ReportModel['recommendations'] = [];
  for (const f of findings) {
    const row = findingRows.find((r) => r.id === f.id)!;
    if (row.classification.key === 'follow_up' && openFinding(row.status)) recommendations.push({ text: f.title, ref: f.key });
    for (const b of f.followUp) for (const t of blockLines(b)) recommendations.push({ text: t, ref: f.key });
  }

  const assessment: ReportModel['assessment'] = [];
  for (const s of sessionItems) {
    const blocks: Block[] = [...s.summary];
    const facts: string[] = [`Status: ${humanize(s.status)}`];
    if (s.tbs) facts.push(`Time split: setup ${s.tbs.setup}%, testing ${s.tbs.test}%, bug investigation ${s.tbs.bug}%`);
    if (s.charterVsOpportunity != null) facts.push(`On-charter work: ${s.charterVsOpportunity}%`);
    if (s.reviewer) facts.push(`Reviewed by ${s.reviewer}${s.reviewComment ? `: “${s.reviewComment}”` : ''}`);
    blocks.push({ type: 'ul', items: facts });
    assessment.push({ label: `${s.key}: ${s.title}`, blocks });
  }
  if (testExecution.runs.length || milestone) {
    const blockers = findingRows.filter((f) => (f.severity === 'BLOCKER' || f.severity === 'CRITICAL') && openFinding(f.status)).length;
    const openIssues = outstanding.length;
    const items = [`Open blocker/critical findings: ${blockers}`, `Outstanding issues and untriaged defects: ${openIssues}`];
    const exec = testExecution.runs.reduce((a, r) => ({ total: a.total + r.total, passed: a.passed + r.passed, untested: a.untested + r.untested }), { total: 0, passed: 0, untested: 0 });
    if (exec.total) items.push(`Manual test results: ${exec.passed} of ${exec.total - exec.untested} executed cases passed; ${exec.untested} untested`);
    if (milestone) items.unshift(`Milestone status: ${humanize(milestone.status)}${milestone.dueDate ? `, due ${milestone.dueDate.toISOString().slice(0, 10)}` : ''}`);
    assessment.push({ label: 'Release indicators', blocks: [{ type: 'ul', items }] });
  }

  // Summary (facts only) and section list (hide empty sections).
  const bySev = new Map<string, number>();
  const byCls = new Map<string, number>();
  for (const f of findings) {
    bySev.set(f.severity, (bySev.get(f.severity) ?? 0) + 1);
    byCls.set(f.classification, (byCls.get(f.classification) ?? 0) + 1);
  }
  const timeSpent = sessionItems.reduce((a, s) => a + s.elapsedSeconds, 0);
  const evCount = { images: evidence.filter((e) => e.kind === 'IMAGE').length, videos: evidence.filter((e) => e.kind === 'VIDEO').length, other: evidence.filter((e) => e.kind !== 'IMAGE' && e.kind !== 'VIDEO').length };
  const defectCount = findings.filter((f) => f.isDefect).length;
  const paragraphs: string[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (sessionItems.length) parts.push(`${plural(sessionItems.length, 'exploratory session')}${timeSpent ? ` (${fmtDuration(timeSpent)} of recorded testing)` : ''}`);
  parts.push(plural(findings.length, 'finding'));
  paragraphs.push(`This report covers ${parts.join(' and ')} in ${scopeLabel}.`);
  if (findings.length) {
    const sevText = [...bySev.entries()].sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0)).map(([s, n]) => `${n} ${humanize(s).toLowerCase()}`).join(', ');
    paragraphs.push(`${plural(defectCount, 'finding')} ${defectCount === 1 ? 'is' : 'are'} classified as defects. By severity: ${sevText}.`);
  }
  if (outstanding.length) paragraphs.push(`${plural(outstanding.length, 'item')} remain${outstanding.length === 1 ? 's' : ''} open (see Outstanding issues).`);
  if (evidence.length) paragraphs.push(`Evidence included: ${plural(evCount.images, 'screenshot')}, ${plural(evCount.videos, 'video')} and ${plural(evCount.other, 'other attachment')}.`);
  const filters: string[] = [];
  if (o.severities) filters.push(`severity ${o.severities.map((s) => humanize(s).toLowerCase()).join('/')}`);
  if (o.classificationKeys) filters.push(`classification ${o.classificationKeys.join('/')}`);
  if (o.dateFrom || o.dateTo) filters.push(`dates ${o.dateFrom?.toISOString().slice(0, 10) ?? '…'} to ${o.dateTo?.toISOString().slice(0, 10) ?? '…'}`);
  if (o.findingIds) filters.push('a custom selection of findings');
  if (filters.length) paragraphs.push(`Filters applied: ${filters.join('; ')}.`);

  const has: Record<SectionKey, boolean> = {
    cover: true,
    toc: true,
    executiveSummary: true,
    metadata: true,
    mission: charterItems.length > 0,
    scope: charterItems.some((c) => c.scope.length || c.outOfScope.length || c.assumptions.length || c.prerequisites.length || c.testData.length),
    environment: sessionItems.some((s) => s.browser || s.os || s.device || s.buildVersion || s.environment || s.environmentNotes) || findings.some((f) => f.environment || f.browser) || charterItems.some((c) => c.environment),
    timeline: sessionItems.length > 0,
    testExecution: testExecution.runs.length + testExecution.automation.length > 0,
    findingsSummary: findings.length > 0,
    findings: findings.length > 0,
    screenshots: looseEvidence.some((e) => e.kind === 'IMAGE'),
    videos: evidence.some((e) => e.kind === 'VIDEO'),
    attachments: looseEvidence.some((e) => e.kind !== 'IMAGE' && e.kind !== 'VIDEO'),
    risks: risks.length > 0,
    outstanding: outstanding.length > 0,
    recommendations: recommendations.length > 0,
    assessment: assessment.length > 0,
    evidenceIndex: evidence.length > 0,
    appendices: sessionItems.some((s) => s.notes.length),
  };
  const sections = SECTION_KEYS.filter((k) => o.sections[k] && has[k]);
  if (!sections.some((k) => k !== 'cover' && k !== 'toc')) throw badRequest('Nothing to report: the selected sections have no data for this scope and filters');

  const t = BUILT_IN_TEMPLATES[ctx.kind];
  return {
    kind: ctx.kind,
    templateName: t.name,
    fileLabel: t.fileLabel,
    title: o.title || t.name,
    subtitle: o.subtitle ?? scopeLabel,
    author: o.author || ctx.userName,
    generatedAt: new Date(),
    appVersion: config.APP_VERSION,
    project,
    scopeLabel,
    options: o,
    sections,
    summary: {
      paragraphs,
      findingCount: findings.length,
      defectCount,
      bySeverity: [...bySev.entries()].map(([severity, count]) => ({ severity, count })).sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)),
      byClassification: [...byCls.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      sessionCount: sessionItems.length,
      timeSpentSeconds: timeSpent,
      evidence: evCount,
    },
    milestone,
    charters: charterItems,
    sessions: sessionItems,
    findings,
    looseEvidence,
    evidence,
    testExecution,
    risks,
    outstanding,
    recommendations,
    assessment,
  };
}

function endOfDay(d: Date) {
  const x = new Date(d);
  if (x.getUTCHours() === 0 && x.getUTCMinutes() === 0 && x.getUTCSeconds() === 0) x.setUTCHours(23, 59, 59, 999);
  return x;
}

const blockLines = (b: Block) => ('items' in b ? b.items : [b.text]);
