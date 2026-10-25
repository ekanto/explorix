import crypto from 'node:crypto';
import { config } from '../config.js';
import { badRequest } from './errors.js';

function key(): Buffer {
  if (!config.ENCRYPTION_KEY) {
    throw badRequest('ENCRYPTION_KEY is not configured on the server; integration secrets cannot be stored.');
  }
  const buf = Buffer.from(config.ENCRYPTION_KEY, 'base64');
  if (buf.length !== 32) throw badRequest('ENCRYPTION_KEY must be 32 bytes encoded as base64.');
  return buf;
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
