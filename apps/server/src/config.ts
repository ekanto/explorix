import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(72),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  ENCRYPTION_KEY: z.string().optional(),
  STORAGE_DIR: z.string().default('./.data/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(15),
  MAX_IMAGE_MB: z.coerce.number().positive().default(25),
  MAX_VIDEO_MB: z.coerce.number().positive().default(500),
  TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  // Scratch space for report jobs, backups and in-flight uploads.
  WORK_DIR: z.string().default('./.data/work'),
  // Full backups (database + evidence). Defaults to <WORK_DIR>/backups.
  BACKUP_DIR: z.string().optional(),
  // First-run "create workspace" wizard (desktop). Keep disabled on public servers.
  ALLOW_SETUP_WIZARD: z.enum(['true', 'false']).optional(),
  // Set by the desktop shell: binds to loopback and rejects foreign Host headers.
  DESKTOP: z.enum(['true', 'false']).optional(),
  PDF_RENDERER: z.enum(['none', 'playwright']).default('none'),
  APP_VERSION: z.string().default('4.1.0'),
  AI_PROVIDER: z.enum(['none', 'openai', 'mock']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Explorix <no-reply@explorix.local>'),
  LOG_LEVEL: z.string().default('info'),
  LOG_FILE: z.string().optional(),
  RATE_LIMIT_DISABLED: z.enum(['true', 'false']).optional(),
  WEB_DIST: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
}

const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
  maxImageBytes: Math.round(env.MAX_IMAGE_MB * 1024 * 1024),
  maxVideoBytes: Math.round(env.MAX_VIDEO_MB * 1024 * 1024),
  allowSetupWizard: env.ALLOW_SETUP_WIZARD === 'true',
  isDesktop: env.DESKTOP === 'true',
  rateLimitDisabled: env.RATE_LIMIT_DISABLED === 'true' || env.NODE_ENV === 'test',
};

/** Applies new evidence size limits (MB) at runtime; used by the desktop settings screen. */
export function setUploadLimits(limits: { uploadMb?: number; imageMb?: number; videoMb?: number }) {
  const mb = (v: number) => Math.round(v * 1024 * 1024);
  if (limits.uploadMb && limits.uploadMb > 0) config.maxUploadBytes = mb(limits.uploadMb);
  if (limits.imageMb && limits.imageMb > 0) config.maxImageBytes = mb(limits.imageMb);
  if (limits.videoMb && limits.videoMb > 0) config.maxVideoBytes = mb(limits.videoMb);
  return { uploadMb: config.maxUploadBytes / 1048576, imageMb: config.maxImageBytes / 1048576, videoMb: config.maxVideoBytes / 1048576 };
}
