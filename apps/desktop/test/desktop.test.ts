import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyUrl, isTrustedSender, parseArgs } from '../src/contract';
import { copyOutput, ExportError, suggestedName, withExtension } from '../src/export';
import { resourcePaths } from '../src/paths';
import { SettingsStore, type SecretCodec } from '../src/settings';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'explorix-unit-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('IPC contract', () => {
  const origin = 'http://127.0.0.1:51234';

  it('rejects malformed, extra and dangerous arguments', () => {
    expect(() => parseArgs('report:save', [{ jobId: '../../etc', outputName: 'x' }])).toThrow(/Invalid arguments/);
    expect(() => parseArgs('app:open-folder', ['C:\\Windows'])).toThrow(/Invalid arguments/);
    expect(() => parseArgs('app:open-external', ['file:///C:/Windows/notepad.exe'])).toThrow(/Only web links/);
    expect(() => parseArgs('backup:save-as', ['..\\..\\evil.zip'])).toThrow(/Invalid arguments/);
    expect(() => parseArgs('settings:set', [{ evidenceDir: 'C:\\' }])).toThrow(/Invalid arguments/);
    expect(() => parseArgs('app:info', ['unexpected'])).toThrow(/Invalid arguments/);
    expect(() => parseArgs('nope' as never, [])).toThrow(/Unknown channel/);
    expect(parseArgs('settings:set', [{ keepBackups: 5 }])).toEqual([{ keepBackups: 5 }]);
  });

  it('trusts only the top-level Explorix page', () => {
    expect(isTrustedSender(`${origin}/projects`, origin, true)).toBe(true);
    expect(isTrustedSender(`${origin}/projects`, origin, false)).toBe(false);
    expect(isTrustedSender('http://127.0.0.1:9999/', origin, true)).toBe(false);
    expect(isTrustedSender('https://example.com/', origin, true)).toBe(false);
    expect(isTrustedSender(`${origin}/`, null, true)).toBe(false);
  });

  it('opens web links externally and blocks local or file targets', () => {
    expect(classifyUrl(`${origin}/reports`, origin)).toBe('app');
    expect(classifyUrl('https://support.example.com/a', origin)).toBe('external');
    expect(classifyUrl('mailto:qa@example.com', origin)).toBe('external');
    expect(classifyUrl('http://localhost:3000/', origin)).toBe('blocked');
    expect(classifyUrl('file:///C:/Windows/win.ini', origin)).toBe('blocked');
    expect(classifyUrl('javascript:alert(1)', origin)).toBe('blocked');
  });
});

describe('report export', () => {
  it('suggests safe names and keeps the expected extension', () => {
    expect(suggestedName('..\\..\\Windows\\a:b*?.pdf')).toBe('a_b__.pdf');
    expect(suggestedName('...')).toBe('Explorix_Report');
    expect(withExtension('C:\\out\\Report', 'Explorix.pdf', false)).toBe('C:\\out\\Report.pdf');
    expect(withExtension('C:\\out\\Report.PDF', 'Explorix.pdf', false)).toBe('C:\\out\\Report.PDF');
    expect(withExtension('C:\\out\\Folder', 'Explorix', true)).toBe('C:\\out\\Folder');
  });

  it('never overwrites without confirmation and replaces only when confirmed', async () => {
    const d = tmp();
    const src = path.join(d, 'new.pdf');
    const dest = path.join(d, 'saved.pdf');
    fs.writeFileSync(src, 'new');
    fs.writeFileSync(dest, 'old');
    await expect(copyOutput(src, dest, { overwrite: false })).rejects.toMatchObject({ code: 'exists' });
    expect(fs.readFileSync(dest, 'utf8')).toBe('old');
    await copyOutput(src, dest, { overwrite: true });
    expect(fs.readFileSync(dest, 'utf8')).toBe('new');
    expect(fs.readdirSync(d).filter((f) => f.includes('.partial-'))).toEqual([]);
  });

  it('copies report folders and hands a replaced folder to the discard callback', async () => {
    const d = tmp();
    const src = path.join(d, 'gen');
    fs.mkdirSync(path.join(src, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(src, 'report.md'), '![a](evidence/a.png)');
    fs.writeFileSync(path.join(src, 'evidence', 'a.png'), 'png');
    const dest = path.join(d, 'out', 'Report');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'old.md'), 'old');
    const discarded: string[] = [];
    await copyOutput(src, dest, { overwrite: true, discard: async (p) => (discarded.push(p), fs.rmSync(p, { recursive: true })) });
    expect(discarded).toEqual([dest]);
    expect(fs.readdirSync(dest).sort()).toEqual(['evidence', 'report.md']);
    expect(fs.readFileSync(path.join(dest, 'evidence', 'a.png'), 'utf8')).toBe('png');
  });

  it('leaves nothing behind when cancelled and reports a missing source clearly', async () => {
    const d = tmp();
    const src = path.join(d, 'gen');
    fs.mkdirSync(src);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(src, `f${i}.txt`), 'x');
    const ac = new AbortController();
    ac.abort();
    await expect(copyOutput(src, path.join(d, 'Report'), { overwrite: false, signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readdirSync(d)).toEqual(['gen']);
    const missing = copyOutput(path.join(d, 'gone.pdf'), path.join(d, 'x.pdf'), { overwrite: false });
    await expect(missing).rejects.toBeInstanceOf(ExportError);
    await expect(missing).rejects.toMatchObject({ code: 'source_missing' });
  });
});

describe('settings', () => {
  const codec: SecretCodec = {
    available: () => true,
    encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
    decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
  };

  it('keeps a corrupt settings file aside and starts from defaults', () => {
    const d = tmp();
    const file = path.join(d, 'settings.json');
    fs.writeFileSync(file, '{ not json');
    const s = new SettingsStore(file, codec);
    expect(s.get().limits).toEqual({ uploadMb: 50, imageMb: 25, videoMb: 2048 });
    expect(fs.readdirSync(d).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true);
  });

  it('persists updates and stores secrets encrypted, never in plain text', () => {
    const d = tmp();
    const file = path.join(d, 'settings.json');
    const s = new SettingsStore(file, codec);
    s.update({ keepBackups: 3 });
    const secret = s.secret('session');
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain(secret);
    expect(JSON.parse(raw).secrets.session).toMatch(/^dpapi:/);
    const again = new SettingsStore(file, codec);
    expect(again.get().keepBackups).toBe(3);
    expect(again.secret('session')).toBe(secret);
    expect(fs.readdirSync(d)).toEqual(['settings.json']);
  });
});

describe('resources', () => {
  it('opens the packaged third-party notices, falling back to the repository copy in development', () => {
    const resourcesPath = tmp();
    const packaged = resourcePaths({ packaged: true, resourcesPath, appDir: path.join(resourcesPath, 'app.asar') });
    expect(packaged.notices).toBe(path.join(resourcesPath, 'legal', 'THIRD_PARTY_NOTICES.txt'));
    // An unstaged development checkout (no build/resources) resolves to the repository root copy.
    const repo = path.resolve(__dirname, '..', '..', '..');
    const dev = resourcePaths({ packaged: false, resourcesPath, appDir: path.join(repo, 'apps', 'unstaged') });
    expect(dev.notices).toBe(path.join(repo, 'THIRD_PARTY_NOTICES.md'));
    expect(fs.existsSync(dev.notices)).toBe(true);
  });
});
