import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import type { EvidenceKind } from '@prisma/client';
import { config } from '../config.js';
import { AppError } from './errors.js';

/**
 * Evidence media validation. Types are decided from file content (magic bytes),
 * never from the extension or browser-supplied MIME type alone. SVG/HTML are
 * never accepted because they can carry scripts.
 */
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const OTHER_BINARY = new Set(['application/pdf', 'application/zip']);
export const TEXT_EXTENSIONS: Record<string, string> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.har': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
};
export const ALLOWED_DESCRIPTION =
  'Images (PNG, JPEG, GIF, WebP), videos (MP4, WebM, MOV), PDF, ZIP, and text files (.txt .log .md .json .har .csv .xml)';

/** Canonical file extension for a stored MIME type (used for exported copies). */
export const EXT_FOR_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
  'application/xml': '.xml',
};

export function kindForMime(mime: string): EvidenceKind {
  if (IMAGE_TYPES.has(mime)) return 'IMAGE';
  if (VIDEO_TYPES.has(mime)) return 'VIDEO';
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') return 'DOCUMENT';
  return 'OTHER';
}

export function maxBytesFor(kind: EvidenceKind) {
  return kind === 'VIDEO' ? config.maxVideoBytes : kind === 'IMAGE' ? config.maxImageBytes : config.maxUploadBytes;
}

const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

export interface MediaInfo {
  mimeType: string;
  kind: EvidenceKind;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}

/** Validates a file on disk and returns its canonical type and media metadata. */
export async function inspectFile(filePath: string, originalName: string, size: number): Promise<MediaInfo> {
  // file-type returns undefined for unknown content; anything thrown is a real failure (I/O, missing module)
  // that must not be reported to the user as an unsupported file.
  const sniffed = await fileTypeFromFile(filePath).catch((err: Error) => {
    if (err?.name === 'EndOfStreamError') return undefined;
    throw err;
  });
  let mimeType: string;
  if (sniffed) {
    if (!IMAGE_TYPES.has(sniffed.mime) && !VIDEO_TYPES.has(sniffed.mime) && !OTHER_BINARY.has(sniffed.mime)) {
      throw new AppError(415, 'unsupported_file_type', `Files of type ${sniffed.mime} are not supported. Allowed: ${ALLOWED_DESCRIPTION}`);
    }
    mimeType = sniffed.mime;
  } else {
    const ext = path.extname(originalName).toLowerCase();
    const textMime = TEXT_EXTENSIONS[ext];
    if (!textMime) {
      const claimed = ext ? `"${ext}" file` : 'file';
      throw new AppError(415, 'unsupported_file_type', `The ${claimed} content is not a recognised format. Allowed: ${ALLOWED_DESCRIPTION}`);
    }
    await assertUtf8Text(filePath);
    mimeType = textMime;
  }
  const kind = kindForMime(mimeType);
  const limit = maxBytesFor(kind);
  if (size > limit) {
    const label = kind === 'VIDEO' ? 'Videos' : kind === 'IMAGE' ? 'Images' : 'Files of this type';
    throw new AppError(413, 'file_too_large', `${label} must be at most ${mb(limit)} (this file is ${mb(size)})`);
  }
  if (kind === 'IMAGE') return { mimeType, kind, ...(await probeImage(filePath)) };
  if (kind === 'VIDEO') return { mimeType, kind, ...(await probeVideo(filePath, mimeType)) };
  return { mimeType, kind };
}

async function assertUtf8Text(filePath: string) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const fh = await fsp.open(filePath, 'r');
  try {
    for await (const chunk of fh.createReadStream()) {
      const buf = chunk as Buffer;
      if (buf.includes(0)) throw new Error('nul');
      decoder.decode(buf, { stream: true });
    }
    decoder.decode();
  } catch {
    throw new AppError(415, 'unsupported_file_type', 'Text attachments must be UTF-8 encoded text');
  } finally {
    await fh.close().catch(() => undefined);
  }
}

export async function probeImage(filePath: string) {
  try {
    const m = await sharp(filePath, { failOn: 'error' }).metadata();
    if (!m.width || !m.height) throw new Error('no dimensions');
    // Respect EXIF orientation so reported dimensions match what viewers display.
    const rotated = (m.orientation ?? 1) >= 5;
    return { width: rotated ? m.height : m.width, height: rotated ? m.width : m.height };
  } catch {
    throw new AppError(422, 'corrupted_media', 'The image could not be decoded; it may be corrupted or truncated');
  }
}

/** Reads duration and dimensions from MP4/MOV (ISO-BMFF) or WebM (EBML) headers without loading the file. */
export async function probeVideo(filePath: string, mime: string): Promise<{ durationSeconds: number | null; width: number | null; height: number | null }> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    if (mime === 'video/webm') return await probeWebm(fh, size);
    return await probeIsoBmff(fh, size);
  } finally {
    await fh.close().catch(() => undefined);
  }
}

type FH = fsp.FileHandle;
async function readAt(fh: FH, pos: number, len: number) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

interface Box {
  type: string;
  start: number;
  header: number;
  size: number;
}
async function listBoxes(fh: FH, start: number, end: number): Promise<Box[]> {
  const out: Box[] = [];
  let pos = start;
  while (pos + 8 <= end && out.length < 10_000) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) break;
      size = Number(h.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end + 8) break;
    out.push({ type, start: pos, header, size });
    pos += size;
  }
  return out;
}

async function probeIsoBmff(fh: FH, fileSize: number) {
  const top = await listBoxes(fh, 0, fileSize);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new AppError(422, 'corrupted_media', 'The video has no index (moov box); the recording may be incomplete or corrupted');
  const moovEnd = moov.start + moov.size;
  const inner = await listBoxes(fh, moov.start + moov.header, moovEnd);
  let durationSeconds: number | null = null;
  const mvhd = inner.find((b) => b.type === 'mvhd');
  if (mvhd) {
    const c = await readAt(fh, mvhd.start + mvhd.header, 32);
    const v = c[0];
    const timescale = v === 1 ? c.readUInt32BE(20) : c.readUInt32BE(12);
    const duration = v === 1 ? Number(c.readBigUInt64BE(24)) : c.readUInt32BE(16);
    if (timescale > 0 && duration > 0 && duration !== 0xffffffff) durationSeconds = Math.round((duration / timescale) * 1000) / 1000;
  }
  let width: number | null = null;
  let height: number | null = null;
  for (const trak of inner.filter((b) => b.type === 'trak')) {
    const tb = await listBoxes(fh, trak.start + trak.header, trak.start + trak.size);
    const tkhd = tb.find((b) => b.type === 'tkhd');
    if (!tkhd) continue;
    const c = await readAt(fh, tkhd.start + tkhd.header, 96);
    const off = c[0] === 1 ? 88 : 76;
    if (c.length < off + 8) continue;
    const w = c.readUInt32BE(off) / 65536;
    const h = c.readUInt32BE(off + 4) / 65536;
    if (w > 0 && h > 0) {
      width = Math.round(w);
      height = Math.round(h);
      break;
    }
  }
  return { durationSeconds, width, height };
}

// --- WebM / Matroska (EBML) ---
function readVint(buf: Buffer, pos: number, keepMarker: boolean): { value: number; length: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || pos + length > buf.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { value: !keepMarker && allOnes ? -1 : value, length };
}

const EBML = { header: 0x1a45dfa3, segment: 0x18538067, info: 0x1549a966, timecodeScale: 0x2ad7b1, duration: 0x4489, tracks: 0x1654ae6b, trackEntry: 0xae, video: 0xe0, pixelWidth: 0xb0, pixelHeight: 0xba, cluster: 0x1f43b675 };
const MASTERS = new Set([EBML.segment, EBML.info, EBML.tracks, EBML.trackEntry, EBML.video]);

async function probeWebm(fh: FH, fileSize: number) {
  const buf = await readAt(fh, 0, Math.min(fileSize, 1024 * 1024));
  const firstId = readVint(buf, 0, true);
  if (!firstId || firstId.value !== EBML.header) throw new AppError(422, 'corrupted_media', 'The WebM file header is invalid; the file may be corrupted');
  let timecodeScale = 1_000_000;
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  const walk = (start: number, end: number, depth: number) => {
    let pos = start;
    while (pos < end && depth < 8) {
      const id = readVint(buf, pos, true);
      if (!id) return;
      const sz = readVint(buf, pos + id.length, false);
      if (!sz) return;
      const dataStart = pos + id.length + sz.length;
      const dataEnd = sz.value < 0 ? end : Math.min(end, dataStart + sz.value);
      if (id.value === EBML.cluster) return;
      if (MASTERS.has(id.value)) walk(dataStart, dataEnd, depth + 1);
      else if (id.value === EBML.timecodeScale) timecodeScale = buf.readUIntBE(dataStart, Math.min(6, dataEnd - dataStart));
      else if (id.value === EBML.duration) duration = dataEnd - dataStart === 4 ? buf.readFloatBE(dataStart) : buf.readDoubleBE(dataStart);
      else if (id.value === EBML.pixelWidth && width == null) width = buf.readUIntBE(dataStart, Math.min(6, dataEnd - dataStart));
      else if (id.value === EBML.pixelHeight && height == null) height = buf.readUIntBE(dataStart, Math.min(6, dataEnd - dataStart));
      if (sz.value < 0) return;
      pos = dataEnd;
    }
  };
  try {
    walk(0, buf.length, 0);
  } catch {
    /* truncated element: keep what was found */
  }
  const durationSeconds = duration && Number.isFinite(duration) && duration > 0 ? Math.round(((duration * timecodeScale) / 1e9) * 1000) / 1000 : null;
  return { durationSeconds, width, height };
}
