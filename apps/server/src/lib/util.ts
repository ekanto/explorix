import sanitizeHtml from 'sanitize-html';
import type { Tx } from '../db.js';

export type SeqField =
  | 'charterSeq'
  | 'sessionSeq'
  | 'findingSeq'
  | 'issueSeq'
  | 'testCaseSeq'
  | 'requirementSeq'
  | 'testRunSeq'
  | 'automationSeq';

/** Atomically allocates the next per-project number (row lock on Project within the transaction). */
export async function nextNumber(tx: Tx, projectId: string, field: SeqField): Promise<number> {
  const p = await tx.project.update({
    where: { id: projectId },
    data: { [field]: { increment: 1 } },
    select: { [field]: true },
  });
  return (p as unknown as Record<SeqField, number>)[field];
}

/** Rich-text allow-list for notes, descriptions and summaries. Images may only reference Explorix attachments. */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'a', 'mark', 'hr', 'img', 'span', 'input', 'label', 'div', 'table', 'thead',
      'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      input: ['type', 'checked', 'disabled'],
      li: ['data-type', 'data-checked'],
      ul: ['data-type'],
      span: ['data-type', 'data-id', 'data-label'],
      code: ['class'],
      pre: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: [] },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => frame.tag === 'img' && !/^\/api\/projects\/[\w-]+\/attachments\/[\w-]+\/content$/.test(frame.attribs.src ?? ''),
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
      input: (tagName, attribs) => ({
        tagName,
        attribs: attribs.type === 'checkbox' ? { type: 'checkbox', ...(attribs.checked !== undefined ? { checked: 'checked' } : {}), disabled: 'disabled' } : {},
      }),
    },
  }).slice(0, 500_000);
}

export const htmlToText = (html: string | null | undefined) =>
  sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

export function liveElapsed(
  s: { status: string; elapsedSeconds: number; lastResumedAt: Date | null },
  now = new Date(),
): number {
  if (s.status === 'IN_PROGRESS' && s.lastResumedAt) {
    return s.elapsedSeconds + Math.max(0, Math.floor((now.getTime() - s.lastResumedAt.getTime()) / 1000));
  }
  return s.elapsedSeconds;
}

export const keys = {
  charter: (n: number) => `CH-${n}`,
  session: (n: number) => `S-${n}`,
  finding: (n: number) => `F-${n}`,
  issue: (projectKey: string, n: number) => `${projectKey}-${n}`,
  testCase: (n: number) => `C-${n}`,
  requirement: (n: number) => `REQ-${n}`,
  testRun: (n: number) => `R-${n}`,
  automationRun: (n: number) => `A-${n}`,
};

/** Parses pagination query params with sane bounds. */
export function paging(q: Record<string, unknown>, defaultSize = 50) {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export const toArray = (v: unknown): string[] =>
  v === undefined || v === null || v === ''
    ? []
    : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);

export async function resolveTagIds(tx: Tx, projectId: string, names: string[] | undefined): Promise<string[]> {
  if (!names) return [];
  const clean = Array.from(new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))).slice(0, 30);
  const ids: string[] = [];
  for (const name of clean) {
    if (name.length > 40) continue;
    const tag = await tx.tag.upsert({
      where: { projectId_name: { projectId, name } },
      update: {},
      create: { projectId, name },
    });
    ids.push(tag.id);
  }
  return ids;
}

export const tagNames = (rows: { tag: { name: string } }[]) => rows.map((r) => r.tag.name);
