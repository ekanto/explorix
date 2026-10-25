import { beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import { login, P, prisma, projectId, type Client } from './helpers';

describe('reports reflect stored records', () => {
  let lead: Client;
  let pid: string;
  beforeAll(async () => {
    lead = await login('lead@explorix.dev');
    pid = await projectId('SHOP');
  });

  it('dashboard KPIs equal direct database counts', async () => {
    const res = await lead.get(`${P(pid)}/reports/dashboard`);
    expect(res.status).toBe(200);
    const k = res.body.kpis;
    const sessions = await prisma.exploratorySession.findMany({ where: { projectId: pid, archivedAt: null } });
    const completed = sessions.filter((s) => ['COMPLETED', 'IN_REVIEW', 'APPROVED'].includes(s.status)).length;
    const started = sessions.filter((s) => s.status !== 'DRAFT').length;
    expect(k.totalSessions).toBe(sessions.length);
    expect(k.completedSessions).toBe(completed);
    expect(k.activeSessions).toBe(sessions.filter((s) => ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'].includes(s.status)).length);
    expect(k.completionRate).toBe(Math.round((completed / started) * 1000) / 10);
    expect(k.totalCharters).toBe(await prisma.charter.count({ where: { projectId: pid, status: { not: 'ARCHIVED' } } }));
    expect(k.totalFindings).toBe(await prisma.finding.count({ where: { projectId: pid } }));
    expect(k.unresolvedFindings).toBe(await prisma.finding.count({ where: { projectId: pid, status: { in: ['NEW', 'TRIAGED'] } } }));
    expect(k.confirmedDefects).toBe(await prisma.finding.count({ where: { projectId: pid, classification: { isDefect: true }, status: { not: 'DUPLICATE' } } }));
    const severityTotal = res.body.findingsBySeverity.reduce((a: number, s: { count: number }) => a + s.count, 0);
    expect(severityTotal).toBe(k.totalFindings);
    expect(res.body.definitions.completionRate.definition).toBeTruthy();
  });

  it('updates immediately when a record is added', async () => {
    const before = (await lead.get(`${P(pid)}/reports/dashboard`)).body.kpis;
    const charter = await prisma.charter.findFirstOrThrow({ where: { projectId: pid, status: 'READY' } });
    expect((await lead.post(`${P(pid)}/findings`, { charterId: charter.id, title: 'Standalone risk noted in planning', classificationKey: 'risk' })).status).toBe(201);
    const after = (await lead.get(`${P(pid)}/reports/dashboard`)).body.kpis;
    expect(after.totalFindings).toBe(before.totalFindings + 1);
    expect(after.unresolvedFindings).toBe(before.unresolvedFindings + 1);
    expect(after.outstandingRisks).toBe(before.outstandingRisks + 1);
  });

  it('filters by tester', async () => {
    const tester = await prisma.user.findUniqueOrThrow({ where: { email: 'sam@explorix.dev' } });
    const res = await lead.get(`${P(pid)}/reports/dashboard?testerId=${tester.id}`);
    expect(res.body.kpis.totalSessions).toBe(await prisma.exploratorySession.count({ where: { projectId: pid, archivedAt: null, testerId: tester.id } }));
    expect((await lead.get(`${P(pid)}/reports/dashboard?from=not-a-date`)).status).toBe(400);
  });

  it('CSV and JSON exports contain the same, correct rows', async () => {
    const csv = await lead.get(`${P(pid)}/reports/export/sessions?format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const rows = parseCsv(csv.text);
    const json = await lead.get(`${P(pid)}/reports/export/sessions?format=json`);
    const total = await prisma.exploratorySession.count({ where: { projectId: pid } });
    expect(rows.length - 1).toBe(total);
    expect(json.body.count).toBe(total);
    const header = rows[0];
    const keyIdx = header.indexOf('Key');
    const statusIdx = header.indexOf('Status');
    expect(rows.slice(1).map((r) => r[keyIdx])).toEqual(json.body.rows.map((r: Record<string, string>) => r.Key));
    const first = await prisma.exploratorySession.findFirstOrThrow({ where: { projectId: pid }, orderBy: { number: 'asc' } });
    expect(rows[1][keyIdx]).toBe(`S-${first.number}`);
    expect(rows[1][statusIdx]).toBe(first.status);

    const findings = await lead.get(`${P(pid)}/findings/export?format=json`);
    expect(findings.status).toBe(200);
    const fcount = await prisma.finding.count({ where: { projectId: pid } });
    expect((findings.body.findings ?? findings.body.rows).length).toBe(fcount);
  });

  it('neutralizes spreadsheet formulas in exported user content', async () => {
    const tester = await login('tester@explorix.dev');
    const charter = await prisma.charter.findFirstOrThrow({ where: { projectId: pid, status: 'READY' } });
    await tester.post(`${P(pid)}/findings`, { charterId: charter.id, title: '=HYPERLINK("http://evil.example","click")' });
    const csv = await lead.get(`${P(pid)}/findings/export?format=csv`);
    expect(csv.text).toContain(`'=HYPERLINK`);
    expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('computes release readiness with explicit indicators', async () => {
    const ms = await prisma.milestone.findFirstOrThrow({ where: { projectId: pid, name: { contains: '2.4' } } });
    const res = await lead.get(`${P(pid)}/reports/readiness?milestoneId=${ms.id}`);
    expect(res.status).toBe(200);
    expect(res.body.readiness[0].indicators.length).toBeGreaterThan(3);
    for (const i of res.body.readiness[0].indicators) expect(['pass', 'warn', 'fail', 'na']).toContain(i.level);
  });
});
