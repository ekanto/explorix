import { z } from 'zod';

/**
 * The complete renderer → main API. Every channel has a schema; anything not listed here is
 * unreachable from the web UI. Arguments are validated in the main process before use.
 */
export const channels = {
  'app:info': z.tuple([]),
  'app:open-folder': z.tuple([z.enum(['data', 'evidence', 'backups', 'logs'])]),
  'app:open-external': z.tuple([z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Only web links can be opened')]),
  'report:save': z.tuple([z.object({ jobId: z.string().uuid(), outputName: z.string().min(1).max(260) })]),
  'report:open-saved': z.tuple([z.string().uuid()]),
  'report:show-saved': z.tuple([z.string().uuid()]),
  'capture:sources': z.tuple([]),
  'capture:screenshot': z.tuple([z.object({ sourceId: z.string().min(1).max(200), hideWindow: z.boolean().default(true) })]),
  'capture:recording-source': z.tuple([z.string().min(1).max(200)]),
  'backup:save-as': z.tuple([z.string().regex(/^[\w.-]{1,200}\.zip$/)]),
  'backup:restore-file': z.tuple([]),
  'settings:get': z.tuple([]),
  'settings:set': z.tuple([
    z
      .object({
        limits: z.object({ uploadMb: z.number().min(1).max(2048), imageMb: z.number().min(1).max(2048), videoMb: z.number().min(1).max(20480) }).optional(),
        launchAtLogin: z.boolean().optional(),
        keepBackups: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
  ]),
  'settings:choose-evidence-dir': z.tuple([]),
} as const;

export type Channel = keyof typeof channels;

export function parseArgs<C extends Channel>(channel: C, args: unknown[]): z.infer<(typeof channels)[C]> {
  const schema = channels[channel];
  if (!schema) throw new Error('Unknown channel');
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new Error(`Invalid arguments for ${channel}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return parsed.data as z.infer<(typeof channels)[C]>;
}

/** IPC is only honoured from the top-level Explorix page served by the embedded server. */
export function isTrustedSender(frameUrl: string | undefined, appOrigin: string | null, isMainFrame: boolean) {
  if (!frameUrl || !appOrigin || !isMainFrame) return false;
  try {
    return new URL(frameUrl).origin === appOrigin;
  } catch {
    return false;
  }
}

/** Classifies navigation targets: the app itself, external web links (opened in the browser), or blocked. */
export function classifyUrl(url: string, appOrigin: string | null): 'app' | 'external' | 'blocked' {
  try {
    const u = new URL(url);
    if (appOrigin && u.origin === appOrigin) return 'app';
    if ((u.protocol === 'https:' || u.protocol === 'http:') && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return 'external';
    if (u.protocol === 'mailto:') return 'external';
    return 'blocked';
  } catch {
    return 'blocked';
  }
}
