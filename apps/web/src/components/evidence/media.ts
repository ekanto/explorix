import { api, ApiError, p } from '../../lib/api';

/** Evidence item as returned by the API (serializeEvidence). Older endpoints may omit the richer fields. */
export type Evidence = {
  id: string;
  fileName: string;
  displayName?: string;
  mimeType: string;
  kind?: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
  size: number;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  caption?: string | null;
  label?: string | null;
  description?: string | null;
  includeInReports?: boolean;
  position?: number;
  createdAt?: string;
  deletedAt?: string | null;
  uploader?: { id: string; name: string } | null;
  annotatedId?: string | null;
  thumbnailId?: string | null;
  frames?: { id: string; frameTimeSeconds: number | null; caption?: string | null }[];
  markers?: { id: string; timeSeconds: number; label: string; note?: string | null; frameId?: string | null; author?: { id: string; name: string } | null }[];
};

export type TargetType = 'session' | 'finding' | 'issue' | 'testResult' | 'automationResult';

export const kindOf = (e: Pick<Evidence, 'kind' | 'mimeType'>) =>
  e.kind ?? (e.mimeType.startsWith('image/') ? 'IMAGE' : e.mimeType.startsWith('video/') ? 'VIDEO' : 'DOCUMENT');

export const contentUrl = (pid: string, id: string, opts: { download?: boolean; thumb?: boolean } = {}) =>
  `/api/projects/${pid}/attachments/${id}/content${opts.download ? '?download=1' : opts.thumb ? '?thumb=1' : ''}`;

/** react-dropzone matches by MIME type or extension; the server re-validates every file by its content. */
export const ACCEPT: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'text/plain': ['.txt', '.log'],
  'text/markdown': ['.md', '.markdown'],
  'application/json': ['.json', '.har'],
  'text/csv': ['.csv'],
  'application/xml': ['.xml'],
  'text/xml': ['.xml'],
};
export const ACCEPT_HINT = 'Images (PNG, JPG, WebP, GIF), videos (MP4, WebM, MOV), PDF, ZIP, logs and text (TXT, MD, CSV, JSON, HAR, XML)';

export const fmtDuration = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return '';
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Gives clipboard screenshots ("image.png") a meaningful, unique name. */
export function nameClipboardFile(f: File) {
  if (f.name && f.name !== 'image.png') return f;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([f], `Screenshot_${ts}.png`, { type: f.type || 'image/png' });
}

export interface UploadOptions {
  caption?: string;
  label?: string;
  description?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Multipart upload with progress (fetch cannot report upload progress). */
export function sendForm<T>(url: string, fd: FormData, opts: Pick<UploadOptions, 'onProgress' | 'signal'>): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${url}`);
    xhr.setRequestHeader('X-Requested-With', 'explorix');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload was interrupted'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      const err = body?.error;
      reject(new ApiError(xhr.status, err?.code ?? 'http_error', err?.message ?? (xhr.status === 413 ? 'The file is larger than the allowed maximum' : `Upload failed (${xhr.status})`), err?.details));
    };
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}

export async function uploadAttachment(pid: string, targetType: string, targetId: string, file: File, captionOrOpts?: string | UploadOptions) {
  const opts: UploadOptions = typeof captionOrOpts === 'string' ? { caption: captionOrOpts } : (captionOrOpts ?? {});
  const fd = new FormData();
  fd.append('targetType', targetType);
  fd.append('targetId', targetId);
  if (opts.caption) fd.append('caption', opts.caption);
  if (opts.label) fd.append('label', opts.label);
  if (opts.description) fd.append('description', opts.description);
  fd.append('file', file);
  const res = await sendForm<{ attachment: Evidence & { url: string } }>(p(pid, '/attachments'), fd, opts);
  if (kindOf(res.attachment) === 'VIDEO') await prepareVideo(pid, res.attachment).catch(() => undefined);
  return res;
}

export async function uploadDerivative(pid: string, parentId: string, blob: Blob, fields: { derivation: 'ANNOTATED' | 'FRAME' | 'THUMBNAIL'; frameTimeSeconds?: number; caption?: string; fileName: string }) {
  const fd = new FormData();
  fd.append('derivation', fields.derivation);
  if (fields.frameTimeSeconds !== undefined) fd.append('frameTimeSeconds', String(Math.round(fields.frameTimeSeconds * 1000) / 1000));
  if (fields.caption) fd.append('caption', fields.caption);
  fd.append('file', new File([blob], fields.fileName, { type: blob.type }));
  return sendForm<{ attachment: Evidence }>(p(pid, `/attachments/${parentId}/derivatives`), fd, {});
}

export const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality));

/** Loads a video's metadata in a detached element. Resolves null when Chromium cannot decode it (e.g. some MOV codecs). */
export function loadVideo(src: string, timeoutMs = 15_000): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      v.onloadeddata = v.onerror = null;
      resolve(ok ? v : null);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    v.onloadeddata = () => done(true);
    v.onerror = () => done(false);
    v.src = src;
  });
}

export function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    const target = Math.max(0, Math.min(t, (Number.isFinite(v.duration) ? v.duration : t) - 0.05));
    if (Math.abs(v.currentTime - target) < 0.01 && v.readyState >= 2) return resolve();
    const timer = setTimeout(done, 5000);
    function done() {
      clearTimeout(timer);
      v.removeEventListener('seeked', done);
      resolve();
    }
    v.addEventListener('seeked', done);
    v.currentTime = target;
  });
}

/** Grabs the current frame of a playing or paused video as a JPEG. */
export async function grabFrame(v: HTMLVideoElement, maxWidth = 1920) {
  const scale = Math.min(1, maxWidth / v.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', 0.88);
}

/** WebM recordings from MediaRecorder report Infinity until the browser has scanned to the end. */
async function realDuration(v: HTMLVideoElement) {
  if (Number.isFinite(v.duration)) return v.duration;
  await seek(v, 1e7);
  const d = v.duration;
  return Number.isFinite(d) ? d : null;
}

/**
 * After a video upload: records its duration (when the server could not read it) and
 * stores a representative thumbnail used by galleries and the PDF/DOCX reports.
 * Only derived copies are created; the original video is never changed.
 */
export async function prepareVideo(pid: string, att: Evidence) {
  const v = await loadVideo(contentUrl(pid, att.id));
  if (!v) return { playable: false };
  try {
    const duration = await realDuration(v);
    const patch: Record<string, number> = {};
    if (duration != null && att.durationSeconds == null) patch.durationSeconds = Math.round(duration * 100) / 100;
    if (att.width == null && v.videoWidth) patch.width = v.videoWidth;
    if (att.height == null && v.videoHeight) patch.height = v.videoHeight;
    if (Object.keys(patch).length) await api.patch(p(pid, `/attachments/${att.id}`), patch);
    if (!att.thumbnailId && v.videoWidth) {
      await seek(v, Math.min(1, (duration ?? 2) / 10));
      const blob = await grabFrame(v, 1280);
      await uploadDerivative(pid, att.id, blob, { derivation: 'THUMBNAIL', fileName: `${att.fileName.replace(/\.[^.]+$/, '')}_thumbnail.jpg` });
    }
    return { playable: true };
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}
