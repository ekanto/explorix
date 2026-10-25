import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { storage } from '../lib/storage.js';
import { safeFileName } from './text.js';
import type { EvidenceItem, ReportModel } from './types.js';

export interface ImageAsset {
  rel: string; // POSIX path relative to the report root, e.g. evidence/previews/E01-x.png
  abs: string;
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
}

export interface PreparedAsset {
  ref: string;
  /** Report-optimised copy: the (annotated) screenshot or a video thumbnail. Originals are never modified. */
  preview: ImageAsset | null;
  frames: (ImageAsset & { timeSeconds: number | null })[];
  /** Copied original (only when originals are bundled). */
  original: { rel: string; abs: string; verified: boolean } | null;
  problem: string | null;
}

export type AssetMap = Map<string, PreparedAsset>;

const PREVIEW_WIDTH = { small: 900, medium: 1400, large: 2000 } as const;

export class CancelledError extends Error {
  constructor() {
    super('Report generation was cancelled');
  }
}
export const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new CancelledError();
};

/** Sum of original sizes: used for the free-space check before copying. */
export const originalsBytes = (model: ReportModel) => model.evidence.reduce((a, e) => a + e.size, 0);

export function evidenceBaseName(e: EvidenceItem, total: number) {
  const num = e.ref.slice(1).padStart(String(total).length < 2 ? 2 : String(total).length, '0');
  return `E${num}-${safeFileName(e.fileName, 60)}`;
}

/**
 * Writes evidence for a report into `<root>/evidence/` (originals, optional) and
 * `<root>/evidence/previews/` (optimised images), returning their relative paths.
 */
export async function prepareAssets(
  model: ReportModel,
  root: string,
  opts: { copyOriginals: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<AssetMap> {
  const map: AssetMap = new Map();
  const evDir = path.join(root, 'evidence');
  const pvDir = path.join(evDir, 'previews');
  await fsp.mkdir(pvDir, { recursive: true });
  const maxW = PREVIEW_WIDTH[model.options.imageSize];
  const total = model.evidence.length;
  let done = 0;
  for (const e of model.evidence) {
    checkAbort(opts.signal);
    const base = evidenceBaseName(e, total);
    const stem = base.replace(/\.[^.]+$/, '');
    const asset: PreparedAsset = { ref: e.ref, preview: null, frames: [], original: null, problem: null };
    const src = storage.localPath(e.storageKey);
    if (!src || !(await exists(src))) {
      asset.problem = 'The original file is missing from the evidence store.';
    } else {
      if (opts.copyOriginals) {
        const abs = path.join(evDir, base);
        const verified = await copyVerified(src, abs, e.sha256, opts.signal);
        asset.original = { rel: `evidence/${base}`, abs, verified };
        if (!verified) asset.problem = 'Checksum mismatch: the stored file differs from the checksum recorded at import.';
      }
      try {
        if (e.kind === 'IMAGE' && e.displayStorageKey) {
          const display = storage.localPath(e.displayStorageKey) ?? src;
          asset.preview = await optimise(display, path.join(pvDir, stem), maxW, e.mimeType === 'image/jpeg');
        } else if (e.kind === 'VIDEO') {
          if (e.thumbnailStorageKey) {
            const t = storage.localPath(e.thumbnailStorageKey);
            if (t && (await exists(t))) asset.preview = await optimise(t, path.join(pvDir, `${stem}-thumbnail`), Math.min(maxW, 1280), true);
          }
          let i = 0;
          for (const f of e.frames) {
            checkAbort(opts.signal);
            const p = storage.localPath(f.storageKey);
            if (!p || !(await exists(p))) continue;
            const img = await optimise(p, path.join(pvDir, `${stem}-frame-${String(++i).padStart(2, '0')}`), Math.min(maxW, 1280), true);
            asset.frames.push({ ...img, timeSeconds: f.timeSeconds });
          }
        }
      } catch {
        asset.problem ??= 'A preview could not be generated (the image could not be decoded).';
      }
    }
    for (const img of [asset.preview, ...asset.frames]) if (img) img.rel = path.relative(root, img.abs).split(path.sep).join('/');
    map.set(e.id, asset);
    opts.onProgress?.(++done, total);
  }
  return map;
}

async function optimise(src: string, destNoExt: string, maxWidth: number, jpeg: boolean): Promise<ImageAsset> {
  const img = sharp(src, { failOn: 'error' }).rotate().resize({ width: maxWidth, withoutEnlargement: true });
  const abs = `${destNoExt}.${jpeg ? 'jpg' : 'png'}`;
  const info = jpeg ? await img.flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toFile(abs) : await img.png({ compressionLevel: 9 }).toFile(abs);
  return { rel: '', abs, width: info.width, height: info.height, mime: jpeg ? 'image/jpeg' : 'image/png' };
}

/** Streams a copy while hashing it, so large videos are never fully loaded into memory. */
async function copyVerified(src: string, dest: string, expectedSha: string, signal?: AbortSignal): Promise<boolean> {
  const hash = crypto.createHash('sha256');
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(fs.createReadStream(src), tap, fs.createWriteStream(dest, { flags: 'wx' }), { signal });
  } catch (err) {
    await fsp.rm(dest, { force: true });
    if ((err as Error).name === 'AbortError') throw new CancelledError();
    throw err;
  }
  return hash.digest('hex') === expectedSha;
}

const exists = (p: string) => fsp.access(p).then(() => true, () => false);
