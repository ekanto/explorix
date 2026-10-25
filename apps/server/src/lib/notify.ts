import type { NotificationType, PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import { prisma, type Tx } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

type Db = Tx | PrismaClient;

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  if (!config.SMTP_URL) return null;
  transport ??= nodemailer.createTransport(config.SMTP_URL);
  return transport;
}

export const emailEnabled = () => !!config.SMTP_URL;

/** Creates in-app notifications (never for the acting user) and optionally emails recipients. */
export async function notify(
  db: Db,
  n: {
    recipients: (string | null | undefined)[];
    actorId?: string | null;
    projectId?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    link?: string | null;
  },
) {
  const ids = Array.from(new Set(n.recipients.filter((x): x is string => !!x && x !== n.actorId)));
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      actorId: n.actorId ?? null,
      projectId: n.projectId ?? null,
      type: n.type,
      title: n.title.slice(0, 300),
      body: n.body?.slice(0, 1000) ?? null,
      link: n.link ?? null,
    })),
  });
  if (mailer()) setTimeout(() => void sendEmails(ids, n.title, n.body ?? '', n.link ?? ''), 50);
}

async function sendEmails(userIds: string[], title: string, body: string, link: string) {
  const t = mailer();
  if (!t) return;
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, deactivatedAt: null } });
  for (const u of users) {
    const prefs = (u.preferences ?? {}) as { emailNotifications?: boolean };
    if (prefs.emailNotifications === false) continue;
    try {
      await t.sendMail({
        from: config.EMAIL_FROM,
        to: u.email,
        subject: `[Explorix] ${title}`,
        text: `${body}\n\n${link ? new URL(link, config.APP_URL).toString() : config.APP_URL}`,
      });
    } catch (err) {
      logger.warn({ err, userId: u.id }, 'Failed to send notification email');
    }
  }
}
