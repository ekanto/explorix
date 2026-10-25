import { beforeAll, describe, expect, it } from 'vitest';
import { login, P, prisma, projectId, userId, type Client } from './helpers';

// A minimal valid 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('charter → session → finding → issue workflow', () => {
  let tester: Client;
  let lead: Client;
  let pid: string;
  let charterId: string;
  let sessionId: string;
  let findingId: string;

  beforeAll(async () => {
    tester = await login('tester@explorix.dev');
    lead = await login('lead@explorix.dev');
    pid = await projectId('SHOP');
  });

  it('creates, edits, duplicates and lists a charter', async () => {
    const res = await tester.post(`${P(pid)}/charters`, {
      title: 'Explore gift card redemption',
      mission: 'Explore gift card redemption using boundary balances to discover rounding and double-spend defects',
      target: 'Gift cards',
      scope: 'Redeem at checkout',
      timeboxMinutes: 45,
      priority: 'HIGH',
      tags: ['checkout', 'payments-new'],
      testIdeas: ['zero balance', 'card + coupon'],
      status: 'READY',
    });
    expect(res.status).toBe(201);
    charterId = res.body.charter.id;
    expect(res.body.charter.key).toMatch(/^CH-\d+$/);

    const edit = await tester.patch(`${P(pid)}/charters/${charterId}`, { scope: 'Redeem at checkout and in account wallet' });
    expect(edit.status).toBe(200);
    const hist = await tester.get(`${P(pid)}/charters/${charterId}/history`);
    expect(hist.body.events.some((h: { action: string }) => h.action === 'updated')).toBe(true);

    const dup = await tester.post(`${P(pid)}/charters/${charterId}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.charter.title).toContain('(copy)');
    expect(dup.body.charter.status).toBe('DRAFT');

    const list = await tester.get(`${P(pid)}/charters?q=gift card`);
    expect(list.body.charters.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([charterId, dup.body.charter.id]));
    const tagged = await tester.get(`${P(pid)}/charters?tag=payments-new`);
    expect(tagged.body.charters.map((c: { id: string }) => c.id)).toContain(charterId);

    const arch = await tester.post(`${P(pid)}/charters/${dup.body.charter.id}/archive`);
    expect(arch.status).toBe(200);
    const after = await tester.get(`${P(pid)}/charters?q=gift card`);
    expect(after.body.charters.map((c: { id: string }) => c.id)).not.toContain(dup.body.charter.id);
  });

  it('launches a session from the charter and runs the timer lifecycle', async () => {
    const launch = await tester.post(`${P(pid)}/charters/${charterId}/sessions`, { browser: 'Firefox 140', os: 'Windows 11' });
    expect(launch.status).toBe(201);
    sessionId = launch.body.session.id;
    expect(launch.body.session.status).toBe('DRAFT');
    expect(launch.body.session.charterId).toBe(charterId);
    expect(launch.body.session.timeboxMinutes).toBe(45);

    expect((await tester.post(`${P(pid)}/sessions/${sessionId}/pause`)).status).toBe(409); // cannot pause a draft
    const start = await tester.post(`${P(pid)}/sessions/${sessionId}/start`);
    expect(start.body.session.status).toBe('IN_PROGRESS');
    expect(start.body.session.startedAt).toBeTruthy();

    // Simulate 90s of exploration by moving the resume point back in time.
    await prisma.exploratorySession.update({ where: { id: sessionId }, data: { lastResumedAt: new Date(Date.now() - 90_000) } });
    const pause = await tester.post(`${P(pid)}/sessions/${sessionId}/pause`);
    expect(pause.body.session.status).toBe('PAUSED');
    expect(pause.body.session.elapsedSeconds).toBeGreaterThanOrEqual(90);
    const pausedAt = pause.body.session.elapsedSeconds;

    // Time does not accrue while paused.
    await new Promise((r) => setTimeout(r, 1100));
    const detail = await tester.get(`${P(pid)}/sessions/${sessionId}`);
    expect(detail.body.session.liveElapsedSeconds).toBe(pausedAt);

    const resume = await tester.post(`${P(pid)}/sessions/${sessionId}/resume`);
    expect(resume.body.session.status).toBe('IN_PROGRESS');
  });

  it('persists notes with optimistic concurrency and chronological log entries', async () => {
    const s0 = (await tester.get(`${P(pid)}/sessions/${sessionId}`)).body.session;
    const save = await tester.put(`${P(pid)}/sessions/${sessionId}/notes`, { notes: '<p>Balance shows <strong>£0.00</strong><script>x</script></p>', baseVersion: s0.version });
    expect(save.status).toBe(200);
    const stale = await tester.put(`${P(pid)}/sessions/${sessionId}/notes`, { notes: '<p>stale</p>', baseVersion: s0.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.notes).toContain('£0.00');

    expect((await tester.post(`${P(pid)}/sessions/${sessionId}/log`, { content: 'Tried redeeming an expired card' })).status).toBe(201);
    expect((await tester.post(`${P(pid)}/sessions/${sessionId}/log`, { content: '   ' })).status).toBe(400);

    // "Refresh": a new client sees the same persisted notes and log.
    const fresh = await login('tester@explorix.dev');
    const s1 = (await fresh.get(`${P(pid)}/sessions/${sessionId}`)).body.session;
    expect(s1.notes).toContain('£0.00');
    expect(s1.notes).not.toContain('<script>');
    const contents = s1.logEntries.map((l: { content: string }) => l.content);
    expect(contents).toContain('Tried redeeming an expired card');
    const times = s1.logEntries.map((l: { createdAt: string }) => Date.parse(l.createdAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('captures findings with classification, timestamps, evidence and safe uploads', async () => {
    const f = await tester.post(`${P(pid)}/findings`, {
      sessionId,
      title: 'Gift card can be applied twice in two tabs',
      classificationKey: 'potential_defect',
      severity: 'CRITICAL',
      expected: 'Second redemption is rejected',
      actual: 'Both orders accepted the full balance',
      reproSteps: '1. Open checkout in two tabs\n2. Apply the same card in both\n3. Place both orders',
    });
    expect(f.status).toBe(201);
    findingId = f.body.finding.id;
    expect(f.body.finding.classification.key).toBe('potential_defect');
    expect(f.body.finding.author.id).toBe(await userId('tester@explorix.dev'));
    expect(f.body.finding.environment).toContain('Firefox 140');
    expect(f.body.finding.sessionElapsedSeconds).toBeGreaterThanOrEqual(90);

    const obs = await tester.post(`${P(pid)}/findings`, { sessionId, title: 'Balance label wraps on narrow screens', classificationKey: 'observation' });
    expect(obs.body.finding.severity).toBe('MINOR');
    expect((await tester.post(`${P(pid)}/findings`, { sessionId, title: 'x', classificationKey: 'nope' })).status).toBe(400);

    const up = await tester.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', 'finding')
      .field('targetId', findingId)
      .field('caption', 'two tabs')
      .attach('file', PNG, { filename: 'tabs.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.attachment.mimeType).toBe('image/png');
    const content = await tester.get(up.body.attachment.url);
    expect(content.status).toBe(200);
    expect(content.headers['content-type']).toContain('image/png');
    expect(content.headers['x-content-type-options']).toBe('nosniff');

    const svg = await tester.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', 'session')
      .field('targetId', sessionId)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(415);
    const html = await tester.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', 'session')
      .field('targetId', sessionId)
      .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), { filename: 'evil.png', contentType: 'image/png' });
    expect(html.status).toBe(415);

    // A user without access to the project cannot fetch the evidence.
    const dana = await login('dana@explorix.dev');
    expect((await dana.get(up.body.attachment.url)).status).toBe(404);

    const s = (await tester.get(`${P(pid)}/sessions/${sessionId}`)).body.session;
    const types = s.logEntries.map((l: { type: string }) => l.type);
    expect(types).toEqual(expect.arrayContaining(['STATUS_CHANGE', 'NOTE', 'FINDING', 'ATTACHMENT']));
    expect(s.findings).toHaveLength(2);
  });

  it('converts a confirmed finding into an issue while preserving the observation', async () => {
    const res = await tester.post(`${P(pid)}/findings/${findingId}/convert-to-issue`, { confirmDefect: true });
    expect(res.status).toBe(201);
    expect(res.body.issue.key).toMatch(/^SHOP-\d+$/);
    const f = (await tester.get(`${P(pid)}/findings/${findingId}`)).body.finding;
    expect(f.status).toBe('CONVERTED');
    expect(f.classification.key).toBe('confirmed_defect');
    expect(f.session.id).toBe(sessionId);
    expect(f.issue.id).toBe(res.body.issue.id);
    expect(f.actual).toBe('Both orders accepted the full balance');
    const issue = (await tester.get(`${P(pid)}/issues/${res.body.issue.id}`)).body.issue;
    expect(issue.severity).toBe('CRITICAL');
    expect((await tester.post(`${P(pid)}/findings/${findingId}/convert-to-issue`)).status).toBe(400);

    const tc = await tester.post(`${P(pid)}/findings/${findingId}/create-test-case`);
    expect(tc.status).toBe(201);
    expect(tc.body.testCase.steps).toHaveLength(3);
  });

  it('finishes into review, blocks self-approval and keeps completed history read-only', async () => {
    const finish = await tester.post(`${P(pid)}/sessions/${sessionId}/finish`, { summary: '<p>Found a double-spend bug.</p>', setupPercent: 10, testPercent: 60, bugPercent: 30 });
    expect(finish.status).toBe(200);
    expect(finish.body.session.status).toBe('IN_REVIEW'); // ShopFront requires review
    expect(finish.body.session.endedAt).toBeTruthy();

    expect((await tester.post(`${P(pid)}/sessions/${sessionId}/approve`)).status).toBe(403);
    expect((await tester.put(`${P(pid)}/sessions/${sessionId}/notes`, { notes: 'late edit', baseVersion: 999, force: true })).status).toBe(400);
    expect((await tester.post(`${P(pid)}/findings`, { sessionId, title: 'late finding' })).status).toBe(400);

    const approve = await lead.post(`${P(pid)}/sessions/${sessionId}/approve`, { comment: 'Great find' });
    expect(approve.body.session.status).toBe('APPROVED');

    const s = (await tester.get(`${P(pid)}/sessions/${sessionId}`)).body.session;
    const statusLog = s.logEntries.filter((l: { type: string }) => l.type === 'STATUS_CHANGE').map((l: { content: string }) => l.content);
    expect(statusLog.some((t: string) => /started/i.test(t))).toBe(true);
    expect(statusLog.at(-1)).toMatch(/approved/i);
    expect(s.findings).toHaveLength(2);

    const notifications = await tester.get('/api/notifications');
    expect(notifications.body.items.some((n: { type: string }) => n.type === 'REVIEW_DECISION')).toBe(true);
  });

  it('searches, filters and bulk-assigns sessions', async () => {
    const sam = await userId('sam@explorix.dev');
    const extra = await lead.post(`${P(pid)}/charters/${charterId}/sessions`, { title: 'Gift cards on mobile' });
    const id2 = extra.body.session.id;
    const bulk = await lead.post(`${P(pid)}/sessions/bulk`, { ids: [id2], action: 'assign', testerId: sam });
    expect(bulk.status).toBe(200);
    const samClient = await login('sam@explorix.dev');
    const assigned = await samClient.get(`${P(pid)}/sessions?view=assigned`);
    expect(assigned.body.sessions.map((s: { id: string }) => s.id)).toContain(id2);

    const byCharter = await tester.get(`${P(pid)}/sessions?charterId=${charterId}`);
    expect(byCharter.body.total).toBe(2);
    const search = await tester.get(`${P(pid)}/sessions?q=Gift cards on mobile`);
    expect(search.body.sessions[0].id).toBe(id2);
    const review = await tester.get(`${P(pid)}/sessions?view=completed&charterId=${charterId}`);
    expect(review.body.sessions.map((s: { id: string }) => s.id)).toEqual([sessionId]);

    // Testers cannot bulk-assign.
    expect((await tester.post(`${P(pid)}/sessions/bulk`, { ids: [id2], action: 'assign', testerId: sam })).status).toBe(403);
  });
});
