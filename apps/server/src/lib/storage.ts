import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

/**
 * Storage abstraction. Keys are always server-generated (never derived from
 * user-supplied file names), so path traversal is not possible. A production
 * object-storage driver (S3/GCS/Azure Blob) can implement the same interface.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Readable;
  remove(key: string): Promise<void>;
}

class LocalStorage implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!/^[\w/-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, data, { flag: 'wx' });
  }
  read(key: string) {
    return fs.createReadStream(this.resolve(key));
  }
  async remove(key: string) {
    await fsp.rm(this.resolve(key), { force: true });
  }
}

export const storage: StorageDriver = new LocalStorage(path.resolve(config.STORAGE_DIR));

export function newStorageKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}`;
}
