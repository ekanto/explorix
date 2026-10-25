import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';

/**
 * Storage abstraction. Keys are always server-generated relative paths (never
 * derived from user-supplied file names), so path traversal is not possible.
 * The database stores only the key plus metadata; large media never lives in
 * database rows. A remote object-storage driver can implement the same interface
 * (localPath() is only used by the local driver for media probing and exports).
 */
export interface StorageDriver {
  readonly root: string;
  put(key: string, data: Buffer): Promise<void>;
  /** Moves a finished temporary file (same volume) into the store. */
  putFile(key: string, srcPath: string): Promise<void>;
  read(key: string, range?: { start: number; end: number }): Readable;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  localPath(key: string): string;
  /** Directory for in-flight uploads; lives inside the store so moves are atomic renames. */
  incomingDir(): string;
}

const KEY_RE = /^[\w/-]+$/;

export class LocalStorage implements StorageDriver {
  constructor(public readonly root: string) {}
  localPath(key: string) {
    if (!KEY_RE.test(key) || key.includes('..') || key.startsWith('/')) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }
  incomingDir() {
    return path.join(this.root, '.incoming');
  }
  async put(key: string, data: Buffer) {
    const p = this.localPath(key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, data, { flag: 'wx' });
  }
  async putFile(key: string, srcPath: string) {
    const p = this.localPath(key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    try {
      await fsp.rename(srcPath, p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
      await pipeline(fs.createReadStream(srcPath), fs.createWriteStream(p, { flags: 'wx' }));
      await fsp.rm(srcPath, { force: true });
    }
  }
  read(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.localPath(key), range);
  }
  async remove(key: string) {
    await fsp.rm(this.localPath(key), { force: true });
  }
  async exists(key: string) {
    return fs.promises.access(this.localPath(key)).then(
      () => true,
      () => false,
    );
  }
}

export const storage: StorageDriver = new LocalStorage(path.resolve(config.STORAGE_DIR));

export function newStorageKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}`;
}

/** Free bytes on the volume holding `dir` (null when the platform cannot tell). */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    await fsp.mkdir(dir, { recursive: true });
    const s = await fsp.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Streams a file through SHA-256. */
export async function sha256File(filePath: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) h.update(chunk as Buffer);
  return h.digest('hex');
}
