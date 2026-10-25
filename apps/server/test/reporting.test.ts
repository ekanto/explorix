import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import yauzl from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { getJob, jobOutputPath } from '../src/reporting/jobs';
import { login, P, prisma, projectId, type Client } from './helpers';
import { mp4, png } from './media';

type Job = { id: string; status: string; error: string | null; warnings: string[]; outputs: { name: string; type: 'file' | 'folder'; formats: string[]; bytes: number }[]; runId: string | null; baseName: string; findingCount: number; evidenceCount: number };

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function readZip(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer>();
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on('entry', (e: yauzl.Entry) => {
        if (e.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(e, (er, s) => {
          if (er || !s) return reject(er);
          const parts: Buffer[] = [];
          s.on('data', (d: Buffer) => parts.push(d));
          s.on('end', () => {
            out.set(e.fileName, Buffer.concat(parts));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

async function pdfText(file: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await fsp.readFile(file)), useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return pages;
}

/** Every relative link/image target in Markdown or HTML (excluding anchors and absolute URLs). */
function relativeTargets(text: string, kind: 'md' | 'html') {
  const re = kind === 'md' ? /\]\(<?([^)>\s]+)>?\)/g : /(?:src|href)="([^"]+)"/g;
  return [...text.matchAll(re)]
    .map((m) => decodeURI(m[1]!.replace(/&amp;/g, '&')))
    .filter((t) => !t.startsWith('#') && !/^[a-z]+:/i.test(t));
}

describe('reporting engine', () => {
  let tester: Client;
  let pid: string;
  let sessionId: string;
  let f1: string;
  let f1Key: string;
  let f2: string;
  let videoBytes: Buffer;
  const moved = path.resolve(config.WORK_DIR, 'moved-reports');

  const runJob = async (c: Client, body: object): Promise<Job> => {
    const r = await c.post(`${P(pid)}/reporting/jobs`, body);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    let job = r.body as Job;
    const until = Date.now() + 120_000;
    while (job.status === 'running') {
      if (Date.now() > until) throw new Error('report job timed out');
      await new Promise((res) => setTimeout(res, 100));
      job = (await c.get(`${P(pid)}/reporting/jobs/${job.id}`)).body;
    }
    return job;
  };
  const outPath = (job: Job, i = 0) => jobOutputPath(getJob(job.id)!, job.outputs[i]!.name)!.abs;
  const scope = () => ({ type: 'findings', findingIds: [f1, f2] });

  beforeAll(async () => {
    tester = await login('tester@explorix.dev');
    pid = await projectId('SHOP');
    const charter = await prisma.charter.findFirstOrThrow({ where: { projectId: pid }, orderBy: { createdAt: 'asc' } });
    const s = await tester.post(`${P(pid)}/sessions`, { charterId: charter.id, title: 'Coupon rounding exploration' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    sessionId = (s.body.session ?? s.body).id;
    const a = await tester.post(`${P(pid)}/findings`, {
      title: 'Coupon total ignores tax rounding',
      description: 'Applying **SAVE10** to a basket with taxable items shows a total one cent lower than the invoice.',
      classificationKey: 'potential_defect',
      severity: 'CRITICAL',
      priority: 'HIGH',
      sessionId,
      preconditions: 'Basket contains three taxable items',
      reproSteps: '1. Add three items to the basket\n2. Apply coupon SAVE10\n3. Compare the basket total with the invoice',
      expected: 'Totals match to the cent',
      actual: 'Basket total is 0.01 lower than the invoice',
      environment: 'Staging',
      browser: 'Edge 141',
      followUp: 'Confirm rounding rules with finance',
    });
    expect(a.status).toBe(201);
    f1 = a.body.finding.id;
    f1Key = a.body.finding.key;
    const b = await tester.post(`${P(pid)}/findings`, { title: 'Promo banner overlaps search field', classificationKey: 'potential_defect', severity: 'MINOR', sessionId });
    expect(b.status).toBe(201);
    f2 = b.body.finding.id;

    const up = async (buf: Buffer, filename: string, fields: Record<string, string> = {}) => {
      let r = tester.agent.post(`${P(pid)}/attachments`).set('X-Requested-With', 'explorix').field('targetType', 'finding').field('targetId', f1);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      const res = await r.attach('file', buf, { filename });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.attachment as { id: string };
    };
    const derive = async (id: string, buf: Buffer, fields: Record<string, string>) => {
      let r = tester.agent.post(`${P(pid)}/attachments/${id}/derivatives`).set('X-Requested-With', 'explorix');
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      const res = await r.attach('file', buf, { filename: 'derived.png' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.derivative as { id: string };
    };
    const shot = await up(await png(1600, 900, '#1c7ed6', 'basket'), 'basket total.png', { caption: 'Basket total after coupon' });
    await derive(shot.id, await png(1600, 900, '#f08c00', 'annotated'), { derivation: 'ANNOTATED' });
    await up(await png(400, 3000, '#2f9e44', 'tall'), 'invoice-long.png', { caption: 'Full invoice' });
    videoBytes = mp4({ durationSeconds: 42, width: 1280, height: 720 });
    const vid = await up(videoBytes, 'checkout recording.mp4', { caption: 'Checkout screen recording' });
    await derive(vid.id, await png(320, 180, '#495057', 'thumb'), { derivation: 'THUMBNAIL' });
    const frame = await derive(vid.id, await png(1280, 720, '#e03131', 'frame 12s'), { derivation: 'FRAME', frameTimeSeconds: '12.5' });
    expect((await tester.post(`${P(pid)}/attachments/${vid.id}/markers`, { timeSeconds: 12.5, label: 'Total drops by one cent', frameId: frame.id })).status).toBe(201);
    await up(Buffer.from('2026-10-25T10:00:00Z INFO total=99.99\n2026-10-25T10:00:01Z WARN rounding\n'), 'checkout.log');
  });

  afterAll(async () => {
    await fsp.rm(moved, { recursive: true, force: true });
  });

  it('lists built-in templates and manages saved templates', async () => {
    const t = await tester.get(`${P(pid)}/reporting/templates`);
    expect(t.status).toBe(200);
    expect(t.body.builtIn).toHaveLength(8);
    expect(t.body.formats).toEqual(['pdf', 'docx', 'md', 'html']);
    expect(t.body.pdfAvailable).toBe(true);

    const name = `Payments evidence ${Date.now()}`;
    const c = await tester.post(`${P(pid)}/reporting/templates`, { name, kind: 'EVIDENCE', options: { title: 'Payments evidence', imageSize: 'small', sections: { toc: false } } });
    expect(c.status).toBe(201);
    expect((await tester.post(`${P(pid)}/reporting/templates`, { name, kind: 'CUSTOM' })).status).toBe(409);
    expect((await tester.post(`${P(pid)}/reporting/templates`, { name: 'Bad logo', kind: 'CUSTOM', options: { branding: { logoDataUrl: 'data:image/svg+xml;base64,AAAA' } } })).status).toBe(400);

    // The saved template's options feed generation.
    const pv = await tester.post(`${P(pid)}/reporting/preview`, { kind: 'CUSTOM', templateId: c.body.id, scope: scope() });
    expect(pv.status).toBe(200);
    expect(pv.body.title).toBe('Payments evidence');
    expect(pv.body.sections).not.toContain('toc');

    const viewer = await login('viewer@explorix.dev');
    expect((await viewer.del(`${P(pid)}/reporting/templates/${c.body.id}`)).status).toBe(403);
    const sam = await login('sam@explorix.dev');
    expect([403, 404]).toContain((await sam.patch(`${P(pid)}/reporting/templates/${c.body.id}`, { name: 'Hijacked' })).status);
    expect((await tester.patch(`${P(pid)}/reporting/templates/${c.body.id}`, { description: 'Updated' })).status).toBe(200);
    expect((await tester.del(`${P(pid)}/reporting/templates/${c.body.id}`)).status).toBe(204);
  });

  it('returns candidates and a preview built from real data only', async () => {
    const cand = await tester.post(`${P(pid)}/reporting/candidates`, { kind: 'SESSION', scope: scope() });
    expect(cand.status).toBe(200);
    expect(cand.body.findings.map((f: { id: string }) => f.id).sort()).toEqual([f1, f2].sort());
    const kinds = cand.body.evidence.map((x: { kind: string }) => x.kind).sort();
    expect(kinds).toEqual(['DOCUMENT', 'IMAGE', 'IMAGE', 'VIDEO'].sort());
    expect(cand.body.evidence.find((x: { kind: string }) => x.kind === 'VIDEO').thumbUrl).toMatch(/\/content\?thumb=1$/);
    expect(cand.body.evidence.find((x: { fileName: string }) => x.fileName === 'basket total.png').annotated).toBe(true);

    const pv = await tester.post(`${P(pid)}/reporting/preview`, { kind: 'BUG_INVESTIGATION', scope: scope() });
    expect(pv.status).toBe(200);
    expect(pv.body).toMatchObject({ findingCount: 2, videoCount: 1 });
    expect(pv.body.html).toContain('Coupon total ignores tax rounding');
    expect(pv.body.html).toContain('Total drops by one cent');
    expect(pv.body.html).not.toMatch(/<script/i);
    expect(pv.body.html).not.toContain(config.STORAGE_DIR);

    // Filters: severity filter excludes the MINOR finding; empty scopes are reported honestly.
    const crit = await tester.post(`${P(pid)}/reporting/preview`, { kind: 'SESSION', scope: scope(), options: { severities: ['CRITICAL'] } });
    expect(crit.body.findingCount).toBe(1);
    expect(crit.body.html).not.toContain('Promo banner overlaps search field');
    expect((await tester.post(`${P(pid)}/reporting/preview`, { kind: 'SESSION', scope: { type: 'finding', findingId: 'nope' } })).status).toBe(404);
  });

  it('generates Markdown and HTML folders whose relative links survive a move', async () => {
    const job = await runJob(tester, { kind: 'SESSION', scope: { type: 'session', sessionId }, formats: ['md', 'html'] });
    expect(job.status, job.error ?? '').toBe('done');
    expect(job.outputs).toHaveLength(1);
    expect(job.outputs[0]).toMatchObject({ type: 'folder', formats: ['md', 'html'] });
    const src = outPath(job);
    await fsp.mkdir(moved, { recursive: true });
    const dest = path.join(moved, `${job.baseName}-${Date.now()}`);
    await fsp.cp(src, dest, { recursive: true });
    await fsp.rm(src, { recursive: true, force: true });

    const md = await fsp.readFile(path.join(dest, `${job.baseName}.md`), 'utf8');
    const html = await fsp.readFile(path.join(dest, `${job.baseName}.html`), 'utf8');
    expect(md).toMatch(/^# /m);
    expect(md).toContain(`${f1Key}`);
    expect(md).toContain('Coupon total ignores tax rounding');
    expect(md).toMatch(/1\. Add three items to the basket/);
    expect(md).toContain('Total drops by one cent');
    expect(md).toContain('checkout recording.mp4');
    expect(md).toContain('Videos cannot play inside a document');

    for (const [text, kind] of [[md, 'md'], [html, 'html']] as const) {
      const targets = relativeTargets(text, kind);
      expect(targets.length).toBeGreaterThan(4);
      for (const t of targets) expect(fs.existsSync(path.join(dest, ...t.split('/'))), `${kind} link ${t}`).toBe(true);
      // Nothing points back into application data or the job directory.
      for (const leak of [config.STORAGE_DIR, path.resolve(config.WORK_DIR), 'storageKey', 'file://']) expect(text).not.toContain(leak);
    }
    expect(html).toMatch(/<video[^>]+src="evidence\/[^"]+\.mp4"/);
    // Originals are byte-identical copies.
    const vid = relativeTargets(md, 'md').find((t) => t.endsWith('.mp4'))!;
    expect(sha(await fsp.readFile(path.join(dest, ...vid.split('/'))))).toBe(sha(videoBytes));
  });

  it('generates an editable DOCX with images, captions and video references', async () => {
    const job = await runJob(tester, { kind: 'SESSION', scope: scope(), formats: ['docx'], options: { title: 'Coupon investigation' } });
    expect(job.status, job.error ?? '').toBe('done');
    expect(job.outputs[0]).toMatchObject({ type: 'file', formats: ['docx'] });
    expect(job.outputs[0]!.name).toMatch(/^Explorix_Session_Report_\d{4}-\d{2}-\d{2}\.docx$/);
    const file = outPath(job);
    const { value: text } = await mammoth.extractRawText({ path: file });
    for (const s of ['Coupon investigation', f1Key, 'Coupon total ignores tax rounding', 'Promo banner overlaps search field', 'Basket total after coupon', 'Add three items to the basket', 'Totals match to the cent', 'checkout recording.mp4', 'Total drops by one cent', 'Evidence index']) {
      expect(text, s).toContain(s);
    }
    expect(text).toContain('Word documents cannot reliably play embedded video');
    const zip = await readZip(file);
    expect([...zip.keys()].filter((k) => k.startsWith('word/media/')).length).toBeGreaterThanOrEqual(4); // 2 screenshots, thumbnail, frame
    const doc = zip.get('word/document.xml')!.toString('utf8');
    expect(doc).toContain('w:titlePg');
    expect(zip.get('word/footer1.xml')?.toString('utf8') ?? [...zip.entries()].find(([k]) => k.startsWith('word/footer'))![1].toString('utf8')).toMatch(/PAGE/);
    expect(doc).not.toContain(config.STORAGE_DIR);
    const dl = await tester.get(`${P(pid)}/reporting/jobs/${job.id}/download?name=${encodeURIComponent(job.outputs[0]!.name)}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('.docx');
  });

  it('generates a searchable, paginated PDF', async () => {
    const job = await runJob(tester, { kind: 'SESSION', scope: scope(), formats: ['pdf'] });
    expect(job.status, job.error ?? '').toBe('done');
    const file = outPath(job);
    expect((await fsp.readFile(file)).subarray(0, 5).toString()).toBe('%PDF-');
    const pages = await pdfText(file);
    expect(pages.length).toBeGreaterThan(2);
    const all = pages.join('\n');
    for (const s of ['Coupon total ignores tax rounding', 'Totals match to the cent', 'checkout recording.mp4', 'Total drops by one cent', 'Evidence index']) expect(all, s).toContain(s);
    expect(pages[1]).toMatch(/Page 2 of \d+/);
    expect(all).not.toContain(config.STORAGE_DIR);
  });

  it('exports a self-contained ZIP package with manifest, README and verified originals', async () => {
    const job = await runJob(tester, { kind: 'EVIDENCE', scope: scope(), formats: ['pdf', 'docx', 'md'], package: 'zip' });
    expect(job.status, job.error ?? '').toBe('done');
    expect(job.outputs).toHaveLength(1);
    expect(job.outputs[0]).toMatchObject({ type: 'file', formats: ['pdf', 'docx', 'md'] });
    const zip = await readZip(outPath(job));
    const root = `${job.baseName}/`;
    for (const k of zip.keys()) expect(k.startsWith(root)).toBe(true);
    for (const f of ['manifest.json', 'README.md', `${job.baseName}.pdf`, `${job.baseName}.docx`, `${job.baseName}.md`]) expect(zip.has(root + f), f).toBe(true);
    const manifest = JSON.parse(zip.get(`${root}manifest.json`)!.toString('utf8'));
    expect(manifest.format).toBe('explorix-report-package');
    expect(manifest.evidence).toHaveLength(4);
    for (const e of manifest.evidence) {
      expect(e.path).toMatch(/^evidence\//);
      expect(e.checksumVerified).toBe(true);
      expect(sha(zip.get(root + e.path)!)).toBe(e.sha256);
      for (const p of e.previews) expect(zip.has(root + p), p).toBe(true);
    }
    const video = manifest.evidence.find((e: { kind: string }) => e.kind === 'VIDEO');
    expect(video).toMatchObject({ durationSeconds: 42, markers: [{ label: 'Total drops by one cent', timecode: expect.stringMatching(/^0?0:12$/) }] });
    const md = zip.get(`${root}${job.baseName}.md`)!.toString('utf8');
    for (const t of relativeTargets(md, 'md')) expect(zip.has(root + t), t).toBe(true);
    for (const [k, v] of zip) {
      if (/\.(md|json|html)$/.test(k)) expect(v.toString('utf8')).not.toContain(config.STORAGE_DIR);
      expect(k).not.toMatch(/\.(db|sqlite|env)$|^\.print-/);
    }
  });

  it('respects evidence selection and never silently drops videos', async () => {
    const cand = await tester.post(`${P(pid)}/reporting/candidates`, { kind: 'SESSION', scope: scope() });
    const shot = cand.body.evidence.find((x: { fileName: string }) => x.fileName === 'invoice-long.png').id;
    const job = await runJob(tester, { kind: 'SESSION', scope: scope(), formats: ['md'], options: { excludeEvidenceIds: [shot], findingIds: [f1] } });
    expect(job.status).toBe('done');
    expect(job.findingCount).toBe(1);
    expect(job.evidenceCount).toBe(3);
    const folder = outPath(job);
    const md = await fsp.readFile(path.join(folder, `${job.baseName}.md`), 'utf8');
    expect(md).not.toContain('invoice-long.png');
    expect(md).not.toContain('Promo banner overlaps search field');
    expect(md).toContain('checkout recording.mp4');
  });

  it('cancels a running job and cleans up its files', async () => {
    const r = await tester.post(`${P(pid)}/reporting/jobs`, { kind: 'EVIDENCE', scope: scope(), formats: ['pdf', 'docx', 'md', 'html'], package: 'zip' });
    expect(r.status).toBe(202);
    const c = await tester.post(`${P(pid)}/reporting/jobs/${r.body.id}/cancel`);
    expect(c.status).toBe(200);
    const job = getJob(r.body.id)!;
    const until = Date.now() + 60_000;
    while (job.status === 'running' && Date.now() < until) await new Promise((res) => setTimeout(res, 50));
    expect(job.status).toBe('cancelled');
    expect(job.outputs).toEqual([]);
    expect(fs.existsSync(job.dir)).toBe(false);
    const status = await tester.get(`${P(pid)}/reporting/jobs/${job.id}`);
    expect(status.body).toMatchObject({ status: 'cancelled', error: 'Report generation was cancelled.' });
    expect((await tester.get(`${P(pid)}/reporting/jobs/${job.id}/download`)).status).toBe(404);
    const run = await prisma.reportRun.findUniqueOrThrow({ where: { id: job.runId ?? '' } }).catch(() => null);
    if (run) expect(run.status).toBe('cancelled');
  });

  it('downloads outputs, keeps jobs private, and records run history', async () => {
    const job = await runJob(tester, { kind: 'BUG_INVESTIGATION', scope: { type: 'finding', findingId: f1 }, formats: ['html'] });
    expect(job.status).toBe('done');
    const dl = await tester.agent
      .get(`${P(pid)}/reporting/jobs/${job.id}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (d: Buffer) => parts.push(d));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain(`${job.baseName}.zip`);
    const tmp = path.join(config.WORK_DIR, `dl-${job.id}.zip`);
    await fsp.writeFile(tmp, dl.body as Buffer);
    const entries = await readZip(tmp);
    await fsp.rm(tmp);
    expect(entries.has(`${job.baseName}/${job.baseName}.html`)).toBe(true);
    expect([...entries.keys()].some((k) => k.includes('/evidence/'))).toBe(true);

    const lead = await login('lead@explorix.dev');
    expect((await lead.get(`${P(pid)}/reporting/jobs/${job.id}`)).status).toBe(404);
    expect((await lead.get(`${P(pid)}/reporting/jobs/${job.id}/download`)).status).toBe(404);
    const dana = await login('dana@explorix.dev');
    expect([403, 404]).toContain((await dana.post(`${P(pid)}/reporting/jobs`, { kind: 'SESSION', scope: scope(), formats: ['md'] })).status);
    expect((await tester.post(`${P(pid)}/reporting/jobs`, { kind: 'SESSION', scope: scope(), formats: [] })).status).toBe(400);
    expect((await tester.post(`${P(pid)}/reporting/jobs`, { kind: 'SESSION', scope: scope(), formats: ['exe'] })).status).toBe(400);

    const viewer = await login('viewer@explorix.dev');
    const vj = await runJob(viewer, { kind: 'SESSION', scope: scope(), formats: ['md'] });
    expect(vj.status).toBe('done');

    const runs = await tester.get(`${P(pid)}/reporting/runs`);
    expect(runs.status).toBe(200);
    const mine = runs.body.find((r: { id: string }) => r.id === job.runId);
    expect(mine).toMatchObject({ status: 'done', kind: 'BUG_INVESTIGATION', formats: ['html'], templateName: 'Detailed Bug Investigation Report' });
    expect(mine.options).toBeUndefined();
    const full = await tester.get(`${P(pid)}/reporting/runs/${job.runId}`);
    expect(full.body.scope).toEqual({ type: 'finding', findingId: f1 });
  });
});
