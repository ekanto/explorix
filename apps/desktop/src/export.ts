import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class ExportError extends Error {
  constructor(
    public code: 'exists' | 'source_missing' | 'no_space' | 'invalid_destination' | 'copy_failed',
    message: string,
  ) {
    super(message);
  }
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

/** Default file name: a stable base plus the right extension, never containing path separators. */
export function suggestedName(name: string) {
  const clean = path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return clean || 'Explorix_Report';
}

/** Ensures a Save As result still carries the expected extension (Windows dialogs allow typing any name). */
export function withExtension(dest: string, sourceName: string, isFolder: boolean) {
  if (isFolder) return dest;
  const ext = path.extname(sourceName);
  return ext && path.extname(dest).toLowerCase() !== ext.toLowerCase() ? `${dest}${ext}` : dest;
}

async function copyDir(src: string, dest: string, signal?: AbortSignal) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    signal?.throwIfAborted();
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d, signal);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

export interface CopyOptions {
  /** The user explicitly confirmed replacing an existing destination. */
  overwrite: boolean;
  /** Moves a replaced destination to the Recycle Bin (shell.trashItem); defaults to deleting it. */
  discard?: (p: string) => Promise<void>;
  signal?: AbortSignal;
}

/**
 * Copies a finished report (file or folder) to a user-chosen destination. The copy is written
 * beside the destination first and only then moved into place, so a failure or cancellation
 * never leaves a half-written report and never destroys an existing file the user did not
 * agree to replace.
 */
export async function copyOutput(src: string, dest: string, opts: CopyOptions) {
  const stat = await fs.stat(src).catch(() => null);
  if (!stat) throw new ExportError('source_missing', 'The generated report is no longer available. Generate it again.');
  if (!path.isAbsolute(dest)) throw new ExportError('invalid_destination', 'Choose a destination folder on this computer.');
  const destExists = await exists(dest);
  if (destExists && !opts.overwrite) throw new ExportError('exists', `${path.basename(dest)} already exists.`);
  const destStat = destExists ? await fs.stat(dest) : null;
  if (destStat && destStat.isDirectory() !== stat.isDirectory()) {
    throw new ExportError('invalid_destination', `${path.basename(dest)} exists and is a ${destStat.isDirectory() ? 'folder' : 'file'}; choose another name.`);
  }

  const staging = path.join(path.dirname(dest), `.${path.basename(dest)}.partial-${crypto.randomBytes(4).toString('hex')}`);
  try {
    if (stat.isDirectory()) await copyDir(src, staging, opts.signal);
    else await fs.copyFile(src, staging);
    opts.signal?.throwIfAborted();
    if (destExists) {
      if (stat.isDirectory()) await (opts.discard ?? ((p) => fs.rm(p, { recursive: true, force: true })))(dest);
      // Files are replaced atomically by rename.
    }
    await fs.rename(staging, dest);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') throw new ExportError('no_space', 'There is not enough free disk space at the destination.');
    if (err instanceof ExportError || (err as Error).name === 'AbortError') throw err;
    throw new ExportError('copy_failed', `Saving failed: ${(err as Error).message}`);
  }
  return dest;
}
