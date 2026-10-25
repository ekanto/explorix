import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const limitsSchema = z.object({
  uploadMb: z.number().min(1).max(2048),
  imageMb: z.number().min(1).max(2048),
  videoMb: z.number().min(1).max(20480),
});

const settingsSchema = z.object({
  evidenceDir: z.string().min(1).nullable().default(null),
  /** Left in place after a move so the user can verify before deleting it. */
  previousEvidenceDir: z.string().nullable().default(null),
  limits: limitsSchema.default({ uploadMb: 50, imageMb: 25, videoMb: 2048 }),
  launchAtLogin: z.boolean().default(false),
  keepBackups: z.number().int().min(1).max(100).default(10),
  window: z
    .object({ width: z.number().int(), height: z.number().int(), x: z.number().int().optional(), y: z.number().int().optional(), maximized: z.boolean().default(false) })
    .nullable()
    .default(null),
  /** Values protected with Windows DPAPI (Electron safeStorage), base64 encoded. */
  secrets: z.record(z.string()).default({}),
});

export type Settings = z.infer<typeof settingsSchema>;
export type Limits = z.infer<typeof limitsSchema>;

/** Abstracts Electron safeStorage so settings can be unit-tested. */
export interface SecretCodec {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export class SettingsStore {
  private data: Settings;

  constructor(
    private file: string,
    private codec: SecretCodec,
  ) {
    this.data = SettingsStore.read(file);
  }

  /** Missing or unreadable settings fall back to defaults; a corrupt file is kept aside for inspection. */
  static read(file: string): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const parsed = settingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return settingsSchema.parse({});
    }
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    return settingsSchema.parse({});
  }

  get(): Settings {
    return structuredClone(this.data);
  }

  update(patch: Partial<Omit<Settings, 'secrets'>>) {
    this.data = settingsSchema.parse({ ...this.data, ...patch });
    this.save();
    return this.get();
  }

  /** Atomic write: a crash mid-save never leaves a truncated settings file. */
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /**
   * Returns a stored secret, generating and persisting a random one on first use. Secrets are
   * encrypted with DPAPI so copying settings.json to another account or machine does not reveal them.
   */
  secret(name: string, generate: () => string = () => crypto.randomBytes(32).toString('base64url')): string {
    const stored = this.data.secrets[name];
    if (stored) {
      if (stored.startsWith('dpapi:')) return this.codec.decrypt(Buffer.from(stored.slice(6), 'base64'));
      if (stored.startsWith('plain:')) return stored.slice(6);
    }
    const value = generate();
    this.data.secrets[name] = this.codec.available() ? `dpapi:${this.codec.encrypt(value).toString('base64')}` : `plain:${value}`;
    this.save();
    return value;
  }
}
