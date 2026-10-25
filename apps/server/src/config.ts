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
  AI_PROVIDER: z.enum(['none', 'openai', 'mock']).default('none'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Explorix <no-reply@explorix.local>'),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_DISABLED: z.enum(['true', 'false']).optional(),
  WEB_DIST: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
  rateLimitDisabled: env.RATE_LIMIT_DISABLED === 'true' || env.NODE_ENV === 'test',
};
