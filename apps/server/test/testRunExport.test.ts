import mammoth from 'mammoth';
import type { Response } from 'superagent';
import yauzl from 'yauzl';
import { beforeAll, describe, expect, it } from 'vitest';
import { login, P, prisma, projectId, type Client } from './helpers';
import { png } from './media';

function unzip(buf: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer>();
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on('entry', (e: yauzl.Entry) => {
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

const binary = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const parts: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on('data', (d: Buffer) => parts.push(d));
  stream.on('end', () => cb(null, Buffer.concat(parts)));
};

describe('test case import formats and test run document export', () => {
  let tester: Client;
  let pid: string;
  let runId: string;
  let runKey: string;
  const tag = `exp${Date.now().toString(36)}`;

  beforeAll(async () => {
    tester = await login('tester@explorix.dev');
    pid = await projectId('SHOP');
  });

  const importCsv = (csv: string, query: string) =>
    tester.agent.post(`${P(pid)}/test-cases/import?${query}`).set('X-Requested-With', 'explorix').set('Content-Type', 'text/csv').send(csv);

  it('imports with the chosen format and separator', async () => {
    const csv = `Title,Preconditions,Steps,Expected,Tags\n"${tag} pipe steps",Signed in,"1. Open profile | 2. Upload photo | 3. Save",Photo is shown,${tag}\n`;
    const steps = await importCsv(csv, 'format=steps&separator=pipe');
    expect(steps.body).toMatchObject({ imported: 1, errors: [] });
    const gherkin = await importCsv(csv.replace('pipe steps', 'gherkin'), 'format=gherkin&separator=auto');
    expect(gherkin.body).toMatchObject({ imported: 1, errors: [] });
    const bad = await importCsv(`Title\n${tag} nothing`, 'format=steps');
    expect(bad.body).toMatchObject({ imported: 0, errors: [{ row: 2 }] });
    expect((await importCsv(csv, 'format=xml')).status).toBe(400);

    const cases = await prisma.testCase.findMany({ where: { projectId: pid, title: { startsWith: tag } }, include: { steps: { orderBy: { position: 'asc' } } }, orderBy: { number: 'asc' } });
    expect(cases.map((c) => c.format)).toEqual(['STEPS', 'GHERKIN']);
    expect(cases[0]!.steps.map((s) => [s.action, s.expected])).toEqual([
      ['Open profile', null],
      ['Upload photo', null],
      ['Save', 'Photo is shown'],
    ]);
    expect(cases[1]!.gherkin).toBe(`Scenario: ${tag} gherkin\n  Given signed in\n  When open profile\n  And upload photo\n  And save\n  Then photo is shown`);

    const run = await tester.post(`${P(pid)}/test-runs`, { name: `${tag} export run`, testCaseIds: cases.map((c) => c.id) });
    expect(run.status).toBe(201);
    runId = run.body.run.id;
    runKey = run.body.run.key;
  });

  it('exports a run as Markdown (ZIP) and Word with full history and attachments', async () => {
    const items = await prisma.testRunItem.findMany({ where: { runId }, orderBy: { position: 'asc' } });
    const statuses = await prisma.testResultStatus.findMany({ where: { projectId: pid, archivedAt: null, scope: { in: ['MANUAL', 'BOTH'] } }, orderBy: { position: 'asc' } });
    const failed = statuses.find((s) => s.category === 'FAILED') ?? statuses[0]!;
    const passed = statuses.find((s) => s.category === 'PASSED') ?? statuses[1]!;
    const first = await tester.post(`${P(pid)}/test-runs/${runId}/items/${items[0]!.id}/results`, { statusId: failed.id, comment: 'Upload spinner never stops', elapsedSeconds: 95 });
    expect(first.status).toBe(201);
    const upload = (name: string, buf: Buffer) =>
      tester.agent
        .post(`${P(pid)}/attachments`)
        .set('X-Requested-With', 'explorix')
        .field('targetType', 'testResult')
        .field('targetId', first.body.result.id)
        .attach('file', buf, { filename: name });
    expect((await upload('spinner shot.png', await png(800, 500))).status).toBe(201);
    expect((await upload('console.log', Buffer.from('TypeError: x is undefined'))).status).toBe(201);
    expect((await tester.post(`${P(pid)}/test-runs/${runId}/items/${items[0]!.id}/results`, { statusId: passed.id, comment: 'Fixed in build 42' })).status).toBe(201);

    const md = await tester.get(`${P(pid)}/test-runs/${runId}/export?format=md`).buffer(true).parse(binary);
    expect(md.status).toBe(200);
    expect(md.headers['content-disposition']).toContain(`${runKey}.zip`);
    const zip = await unzip(md.body as Buffer);
    const text = zip.get(`${runKey}.md`)!.toString('utf8');
    const files = [...zip.keys()].filter((k) => k.startsWith('attachments/') && !k.endsWith('/'));
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^attachments\/01-spinner.shot\.png$/);
    expect(files[1]).toBe('attachments/02-console.log');
    expect(zip.get(files[1]!)!.toString()).toBe('TypeError: x is undefined');
    expect(text).toContain(`# ${runKey}: ${tag} export run`);
    expect(text).toContain('1. Open profile');
    expect(text).toContain('   - _Expected:_ Photo is shown');
    expect(text).toContain('```gherkin\nScenario:');
    expect(text).toContain('### Results (2)');
    expect(text).toContain('Upload spinner never stops');
    expect(text).toContain('Fixed in build 42');
    expect(text).toContain(`](${encodeURI(files[0]!)})`);
    expect(text).toContain('_Not tested yet._');

    const doc = await tester.get(`${P(pid)}/test-runs/${runId}/export?format=docx`).buffer(true).parse(binary);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toContain('wordprocessingml');
    const parts = await unzip(doc.body as Buffer);
    expect([...parts.keys()].filter((k) => k.startsWith('word/media/') && !k.endsWith('/'))).toHaveLength(1);
    const { value } = await mammoth.extractRawText({ buffer: doc.body as Buffer });
    expect(value).toContain('Upload spinner never stops');
    expect(value).toContain('console.log');
    expect(value).toContain('Attached files (not embedded)');
    expect(value).toContain('Then photo is shown');
  });
});
