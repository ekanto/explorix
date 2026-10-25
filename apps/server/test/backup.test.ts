import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { backupsDir } from '../src/lib/backup';
import { storage } from '../src/lib/storage';
import { login, P, prisma, projectId, type Client } from './helpers';
import { png } from './media';

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function readZip(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const out = new Map<string, Buffer>();
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
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
      zip.readEntry();
    });
  });
}

async function writeZip(file: string, entries: Map<string, Buffer>) {
  const z = new yazl.ZipFile();
  for (const [n, b] of entries) z.addBuffer(b, n);
  z.end();
  await new Promise<void>((resolve, reject) => z.outputStream.pipe(fs.createWriteStream(file)).on('close', resolve).on('error', reject));
}

describe('backup and restore', () => {
  let admin: Client;
  let pid: string;
  let evidenceId: string;
  let evidenceKey: string;
  let backupName: string;
  let backupFile: string;
  const scratch = path.resolve(config.WORK_DIR, 'backup-test');

  const uploadRestore = (c: Client, file: string, confirm = 'RESTORE') =>
    c.agent.post('/api/admin/backups/restore-upload').set('X-Requested-With', 'explorix').field('confirm', confirm).attach('file', file);

  beforeAll(async () => {
    admin = await login('admin@explorix.dev');
    pid = await projectId('SHOP');
    await fsp.rm(scratch, { recursive: true, force: true });
    await fsp.mkdir(scratch, { recursive: true });
    const f = await admin.post(`${P(pid)}/findings`, { title: 'Backed-up finding', classificationKey: 'potential_defect', severity: 'MAJOR' });
    expect(f.status).toBe(201);
    const up = await admin.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', 'finding')
      .field('targetId', f.body.finding.id)
      .attach('file', await png(300, 200, '#5f3dc4', 'backup'), { filename: 'backup-shot.png' });
    expect(up.status).toBe(201);
    evidenceId = up.body.attachment.id;
    evidenceKey = (await prisma.attachment.findUniqueOrThrow({ where: { id: evidenceId } })).storageKey;
  });

  it('is limited to the workspace owner', async () => {
    const tester = await login('tester@explorix.dev');
    expect((await tester.get('/api/admin/backups')).status).toBe(403);
    const lead = await login('lead@explorix.dev');
    expect([403]).toContain((await lead.post('/api/admin/backups')).status);
  });

  it('creates a backup with every table and verified evidence', async () => {
    const r = await admin.post('/api/admin/backups');
    expect(r.status).toBe(201);
    backupName = r.body.backup.name;
    expect(backupName).toMatch(/^Explorix_Backup_\d{4}-\d{2}-\d{2}_\d{6}\.zip$/);
    expect(r.body.backup).toMatchObject({ valid: true, reason: 'manual', appVersion: config.APP_VERSION });
    backupFile = path.join(backupsDir(), backupName);

    const list = await admin.get('/api/admin/backups');
    expect(list.body.backups.find((b: { name: string }) => b.name === backupName)).toMatchObject({ valid: true });
    expect(list.body.location).toBeNull(); // paths are only shown in the desktop app

    const zip = await readZip(backupFile);
    const meta = JSON.parse(zip.get('explorix-backup.json')!.toString('utf8'));
    expect(meta.format).toBe('explorix-backup');
    expect(meta.dataVersion).toBe(meta.migrations.at(-1));
    expect(meta.tables.Finding).toBe(await prisma.finding.count());
    expect(meta.tables.Attachment).toBe(await prisma.attachment.count());
    expect(meta.tables.AuthSession).toBeUndefined();
    expect([...zip.keys()].some((k) => k.startsWith('db/AuthSession'))).toBe(false);
    const ev = meta.evidence.files.find((f: { key: string }) => f.key === evidenceKey);
    expect(ev).toBeTruthy();
    expect(sha(zip.get(`evidence/${evidenceKey}`)!)).toBe(ev.sha256);
    for (const k of zip.keys()) expect(k).toMatch(/^(explorix-backup\.json|README\.txt|db\/\w+\/\d{4}\.jsonl|evidence\/[\w/-]+)$/);

    const dl = await admin.get(`/api/admin/backups/${backupName}/download`);
    expect(dl.status).toBe(200);
    expect((await admin.get('/api/admin/backups/..%2F..%2Fsecret.zip/download')).status).toBe(400);
    expect((await admin.get('/api/admin/backups/nope.zip/download')).status).toBe(404);
  });

  it('rejects damaged, foreign, tampered and newer backups without changing data', async () => {
    const before = await prisma.finding.count();
    const original = await readZip(backupFile);
    const variant = async (name: string, mutate: (m: Map<string, Buffer>) => void) => {
      const m = new Map(original);
      mutate(m);
      const file = path.join(scratch, name);
      await writeZip(file, m);
      return file;
    };

    const notZip = path.join(scratch, 'not-a-zip.zip');
    await fsp.writeFile(notZip, 'definitely not a zip');
    let r = await uploadRestore(admin, notZip);
    expect(r.status).toBe(422);

    r = await uploadRestore(admin, await variant('no-meta.zip', (m) => m.delete('explorix-backup.json')));
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/not an Explorix backup/);

    r = await uploadRestore(
      admin,
      await variant('tampered.zip', (m) => {
        const b = Buffer.from(m.get(`evidence/${evidenceKey}`)!);
        b[b.length - 20] = b[b.length - 20]! ^ 0xff;
        m.set(`evidence/${evidenceKey}`, b);
      }),
    );
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/checksum/);

    r = await uploadRestore(
      admin,
      await variant('newer.zip', (m) => {
        const meta = JSON.parse(m.get('explorix-backup.json')!.toString('utf8'));
        meta.migrations.push('99991231000000_from_the_future');
        m.set('explorix-backup.json', Buffer.from(JSON.stringify(meta)));
      }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('backup_too_new');

    for (const stray of ['config/settings.json', 'evidence/2026/01/not-in-manifest', 'db/Finding/x.sh']) {
      r = await uploadRestore(admin, await variant('stray.zip', (m) => m.set(stray, Buffer.from('x'))));
      expect(r.status, stray).toBe(422);
    }

    expect((await uploadRestore(admin, backupFile, 'yes')).status).toBe(400);
    expect((await admin.post(`/api/admin/backups/${backupName}/restore`, {})).status).toBe(400);

    expect(await prisma.finding.count()).toBe(before);
    expect(fs.existsSync(storage.localPath(evidenceKey))).toBe(true);
    // Rejected uploads are not left behind.
    expect((await fsp.readdir(backupsDir())).filter((n) => n.endsWith('.partial'))).toEqual([]);
  });

  it('restores data and evidence exactly, with a safety backup of the replaced state', async () => {
    const findingsBefore = await prisma.finding.count();
    const originalBytes = await fsp.readFile(storage.localPath(evidenceKey));

    // Changes made after the backup.
    await prisma.project.update({ where: { id: pid }, data: { name: 'Renamed after backup' } });
    const later = await admin.post(`${P(pid)}/findings`, { title: 'Created after backup', classificationKey: 'potential_defect', severity: 'MINOR' });
    expect(later.status).toBe(201);
    const up = await admin.agent
      .post(`${P(pid)}/attachments`)
      .set('X-Requested-With', 'explorix')
      .field('targetType', 'finding')
      .field('targetId', later.body.finding.id)
      .attach('file', await png(100, 100), { filename: 'later.png' });
    const laterKey = (await prisma.attachment.findUniqueOrThrow({ where: { id: up.body.attachment.id } })).storageKey;
    await fsp.rm(storage.localPath(evidenceKey)); // simulate a lost evidence file

    const r = await admin.post(`/api/admin/backups/${backupName}/restore`, { confirm: 'RESTORE' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ restored: backupName, signInRequired: true, evidenceMissing: [] });
    expect(r.body.safetyBackup).toMatch(/_before-restore\.zip$/);

    // Sessions are cleared: the old cookie no longer works.
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    admin = await login('admin@explorix.dev');

    expect((await prisma.project.findUniqueOrThrow({ where: { id: pid } })).name).not.toBe('Renamed after backup');
    expect(await prisma.finding.count()).toBe(findingsBefore);
    expect(await prisma.finding.findFirst({ where: { title: 'Created after backup' } })).toBeNull();
    expect(sha(await fsp.readFile(storage.localPath(evidenceKey)))).toBe(sha(originalBytes));
    expect(fs.existsSync(storage.localPath(laterKey))).toBe(false);
    const att = await admin.get(`${P(pid)}/attachments/${evidenceId}/content`);
    expect(att.status).toBe(200);

    // The safety backup holds the replaced state and can itself be restored.
    const safety = await readZip(path.join(backupsDir(), r.body.safetyBackup));
    const meta = JSON.parse(safety.get('explorix-backup.json')!.toString('utf8'));
    expect(meta.reason).toBe('before-restore');
    expect(meta.tables.Finding).toBe(findingsBefore + 1);
    expect(meta.evidence.missing).toContain(evidenceKey);
    expect(meta.evidence.files.some((f: { key: string }) => f.key === laterKey)).toBe(true);

    // Normal work continues after a restore.
    expect((await admin.post(`${P(pid)}/findings`, { title: 'After restore', classificationKey: 'potential_defect', severity: 'MINOR' })).status).toBe(201);
    expect((await admin.del(`/api/admin/backups/${r.body.safetyBackup}`)).status).toBe(204);
  });

  it('restores a backup from an older data version into the current schema', async () => {
    const zip = await readZip(backupFile);
    const meta = JSON.parse(zip.get('explorix-backup.json')!.toString('utf8'));
    meta.migrations = meta.migrations.filter((m: string) => !m.endsWith('_desktop_evidence_reporting'));
    zip.set('explorix-backup.json', Buffer.from(JSON.stringify(meta)));
    // Columns added by the newer migration are absent from the old data.
    for (const [k, v] of zip) {
      if (!k.startsWith('db/Attachment/')) continue;
      const lines = v.toString('utf8').split('\n').filter(Boolean).map((l) => {
        const row = JSON.parse(l);
        delete row.includeInReports;
        delete row.sortOrder;
        return JSON.stringify(row);
      });
      zip.set(k, Buffer.from(lines.join('\n') + '\n'));
    }
    const file = path.join(scratch, 'older.zip');
    await writeZip(file, zip);
    const r = await uploadRestore(admin, file);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.restored).toMatch(/_uploaded(_\w+)?\.zip$/);
    admin = await login('admin@explorix.dev');
    const a = await prisma.attachment.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(a.includeInReports).toBe(true);
    expect((await admin.get(`${P(pid)}/attachments/${evidenceId}/content`)).status).toBe(200);
  });
});
