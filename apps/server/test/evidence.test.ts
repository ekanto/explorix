import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { storage } from '../src/lib/storage';
import { login, P, prisma, projectId, type Client } from './helpers';
import { mp4, png } from './media';

type Up = { status: number; body: { attachment: Record<string, any>; error?: { code: string; message: string } } };

describe('evidence: screenshots, videos and attachments', () => {
  let tester: Client;
  let pid: string;
  let findingId: string;

  const upload = (buf: Buffer, filename: string, fields: Record<string, string> = {}, target = { type: 'finding', id: '' }): Promise<Up> => {
    let r = tester.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', target.type)
      .field('targetId', target.id || findingId);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', buf, { filename }) as unknown as Promise<Up>;
  };
  const derive = (id: string, buf: Buffer, fields: Record<string, string>) => {
    let r = tester.agent.post(`${P(pid)}/attachments/${id}/derivatives`).set('X-Requested-With', 'explorix');
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', buf, { filename: 'derived.png' });
  };

  beforeAll(async () => {
    tester = await login('tester@explorix.dev');
    pid = await projectId('SHOP');
    const f = await tester.post(`${P(pid)}/findings`, {
      title: 'Evidence test finding',
      classificationKey: 'potential_defect',
      severity: 'CRITICAL',
      preconditions: 'Signed in as a customer',
      browser: 'Edge 141',
      followUp: 'Confirm with the payments team',
    });
    expect(f.status).toBe(201);
    findingId = f.body.finding.id;
    expect(f.body.finding).toMatchObject({ preconditions: 'Signed in as a customer', browser: 'Edge 141', followUp: 'Confirm with the payments team' });
  });

  it('stores screenshots with dimensions and checksum, and validates actual content', async () => {
    const img = await upload(await png(800, 500), 'Checkout error.png', { caption: 'Error banner' });
    expect(img.status).toBe(201);
    expect(img.body.attachment).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png', width: 800, height: 500, caption: 'Error banner', includeInReports: true });
    expect(img.body.attachment.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(img.body.attachment.storageKey).toBeUndefined();

    // Extension and declared MIME are not trusted.
    const fake = await upload(Buffer.from('MZ\x90\x00 not really an image'), 'photo.png');
    expect(fake.status).toBe(415);
    const exe = await upload(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'tool.exe');
    expect(exe.status).toBe(415);
    // A PNG signature followed by garbage is detected as corrupted.
    const corrupt = await upload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDRgarbage-garbage-garbage')]), 'broken.png');
    expect([415, 422]).toContain(corrupt.status);
    // Text logs must be UTF-8.
    expect((await upload(Buffer.from('2026-10-25 ERROR payment declined\n'), 'console.log')).status).toBe(201);
    expect((await upload(Buffer.from([0xff, 0xfe, 0x00, 0x41]), 'binary.log')).status).toBe(415);
  });

  it('rejects files above the configured per-kind size limit', async () => {
    const big = Buffer.concat([await png(64, 64), Buffer.alloc(Math.round(1.2 * 1024 * 1024))]);
    const res = await upload(big, 'huge.png');
    expect(res.status).toBe(413);
    expect(res.body.error!.message).toMatch(/at most 1 MB/);
    const vid = await upload(mp4({ padBytes: Math.round(2.3 * 1024 * 1024) }), 'long.mp4');
    expect(vid.status).toBe(413);
    // Over the absolute multipart limit too.
    expect((await upload(Buffer.alloc(3.5 * 1024 * 1024, 1), 'blob.txt')).status).toBe(413);
  });

  it('reads video metadata, supports frames, thumbnails, markers and byte ranges', async () => {
    const v = await upload(mp4({ durationSeconds: 12.5, width: 1280, height: 720, padBytes: 4096 }), 'recording.mp4', { caption: 'Checkout replay' });
    expect(v.status).toBe(201);
    const vid = v.body.attachment;
    expect(vid).toMatchObject({ kind: 'VIDEO', mimeType: 'video/mp4', durationSeconds: 12.5, width: 1280, height: 720 });

    const frame = await derive(vid.id, await png(1280, 720, '#e03131', 'frame 4s'), { derivation: 'FRAME', frameTimeSeconds: '4.2' });
    expect(frame.status).toBe(201);
    const frameId = frame.body.derivative.id;
    expect((await derive(vid.id, await png(320, 180), { derivation: 'THUMBNAIL' })).status).toBe(201);
    expect((await derive(vid.id, await png(320, 180), { derivation: 'FRAME' })).status).toBe(400); // missing time
    expect((await derive(vid.id, mp4(), { derivation: 'THUMBNAIL' })).status).toBe(415); // derivatives must be images

    const mk = await tester.post(`${P(pid)}/attachments/${vid.id}/markers`, { timeSeconds: 4.2, label: 'Spinner never stops', frameId });
    expect(mk.status).toBe(201);
    expect((await tester.post(`${P(pid)}/attachments/${vid.id}/markers`, { timeSeconds: 30, label: 'too late' })).status).toBe(400);

    const full = (await tester.get(`${P(pid)}/attachments/${vid.id}`)).body.attachment;
    expect(full.frames).toHaveLength(1);
    expect(full.thumbnailId).toBeTruthy();
    expect(full.markers[0]).toMatchObject({ label: 'Spinner never stops', frameId });
    // Derivatives are not listed as separate evidence of the finding.
    const list = (await tester.get(`${P(pid)}/attachments?targetType=finding&targetId=${findingId}`)).body.items;
    expect(list.some((a: { id: string }) => a.id === frameId)).toBe(false);

    const range = await tester.agent.get(`${P(pid)}/attachments/${vid.id}/content`).set('Range', 'bytes=0-15');
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toMatch(/^bytes 0-15\//);
  });

  it('keeps the original intact when an annotated copy is saved and replaced', async () => {
    const orig = (await upload(await png(600, 400), 'annotate-me.png')).body.attachment;
    const a1 = await derive(orig.id, await png(600, 400, '#f08c00', 'arrows'), { derivation: 'ANNOTATED' });
    expect(a1.status).toBe(201);
    const a2 = await derive(orig.id, await png(600, 400, '#2f9e44', 'v2'), { derivation: 'ANNOTATED' });
    expect(a2.status).toBe(201);
    const after = a2.body.attachment;
    expect(after.derivatives.filter((d: { derivation: string }) => d.derivation === 'ANNOTATED')).toHaveLength(1);
    expect(after.annotatedId).toBe(a2.body.derivative.id);
    expect(after.sha256).toBe(orig.sha256);
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: orig.id } });
    expect(fs.existsSync(storage.localPath(row.storageKey)!)).toBe(true);
    // Only images can be annotated.
    const doc = (await upload(Buffer.from('notes'), 'notes.txt')).body.attachment;
    expect((await derive(doc.id, await png(10, 10), { derivation: 'ANNOTATED' })).status).toBe(400);
  });

  it('reorders, relabels and toggles report inclusion', async () => {
    const list = (await tester.get(`${P(pid)}/attachments?targetType=finding&targetId=${findingId}`)).body.items as { id: string }[];
    const reversed = list.map((a) => a.id).reverse();
    expect((await tester.post(`${P(pid)}/attachments/reorder`, { targetType: 'finding', targetId: findingId, ids: reversed })).status).toBe(200);
    const again = (await tester.get(`${P(pid)}/attachments?targetType=finding&targetId=${findingId}`)).body.items as { id: string }[];
    expect(again.map((a) => a.id)).toEqual(reversed);
    expect((await tester.post(`${P(pid)}/attachments/reorder`, { targetType: 'finding', targetId: findingId, ids: ['nope'] })).status).toBe(400);

    const patched = await tester.patch(`${P(pid)}/attachments/${reversed[0]}`, { label: 'Step 3', caption: 'Shown in report', includeInReports: false });
    expect(patched.body.attachment).toMatchObject({ label: 'Step 3', caption: 'Shown in report', includeInReports: false });
  });

  it('moves evidence to the trash, restores it, and deletes files only when purged', async () => {
    const a = (await upload(await png(100, 100), 'trash-me.png')).body.attachment;
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    const file = storage.localPath(row.storageKey)!;
    expect((await tester.del(`${P(pid)}/attachments/${a.id}/permanent`)).status).toBe(400); // must be trashed first
    expect((await tester.del(`${P(pid)}/attachments/${a.id}`)).body).toMatchObject({ ok: true, permanent: false });
    const trash = (await tester.get(`${P(pid)}/attachments?trash=1`)).body;
    expect(trash.items.map((i: { id: string }) => i.id)).toContain(a.id);
    expect(fs.existsSync(file)).toBe(true);
    expect((await tester.post(`${P(pid)}/attachments/${a.id}/restore`)).status).toBe(200);
    expect((await tester.del(`${P(pid)}/attachments/${a.id}`)).status).toBe(200);
    expect((await tester.del(`${P(pid)}/attachments/${a.id}/permanent`)).status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    expect(await prisma.attachment.findUnique({ where: { id: a.id } })).toBeNull();
  });

  it('viewers cannot add evidence', async () => {
    const viewer = await login('viewer@explorix.dev');
    const res = await viewer.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', 'finding')
      .field('targetId', findingId)
      .attach('file', await png(10, 10), { filename: 'x.png' });
    expect(res.status).toBe(403);
  });
});

describe('desktop first run: setup wizard and sample project', () => {
  it('reports setup status and refuses setup when disabled or already done', async () => {
    const anon = (await import('supertest')).default((await import('./helpers')).app);
    const st = await anon.get('/api/auth/setup-status');
    expect(st.body).toMatchObject({ needsSetup: false });
    const body = { orgName: 'Acme', name: 'A', email: 'new@acme.test', password: 'Very-secure-pass-1' };
    expect((await anon.post('/api/auth/setup').set('X-Requested-With', 'explorix').send(body)).status).toBe(404);
    const prev = config.allowSetupWizard;
    (config as { allowSetupWizard: boolean }).allowSetupWizard = true;
    try {
      const res = await anon.post('/api/auth/setup').set('X-Requested-With', 'explorix').send(body);
      expect(res.status).toBe(409);
    } finally {
      (config as { allowSetupWizard: boolean }).allowSetupWizard = prev;
    }
  });

  it('creates independent sample projects with real evidence files', async () => {
    const admin = await login('admin@explorix.dev');
    expect((await (await login('tester@explorix.dev')).post('/api/admin/sample-project')).status).toBe(403);
    const r1 = await admin.post('/api/admin/sample-project');
    expect(r1.status).toBe(201);
    expect(r1.body.project.key).toMatch(/^SAMPLE\d*$/);
    const r2 = await admin.post('/api/admin/sample-project');
    expect(r2.body.project.key).not.toBe(r1.body.project.key);
    const atts = await prisma.attachment.findMany({ where: { projectId: r1.body.project.id } });
    expect(atts.filter((a) => a.kind === 'IMAGE').length).toBeGreaterThanOrEqual(3);
    for (const a of atts) expect(fs.existsSync(storage.localPath(a.storageKey)!)).toBe(true);
    const findings = await prisma.finding.count({ where: { projectId: r1.body.project.id } });
    expect(findings).toBeGreaterThanOrEqual(4);
  });
});
