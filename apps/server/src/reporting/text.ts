import type { Block } from './types.js';

const OL = /^\s*\d+[.)]\s+/;
const UL = /^\s*[-*•]\s+/;

/** Turns plain text (as typed into Explorix text areas) into structured blocks: paragraphs, lists and fenced code. */
export function textToBlocks(text: string | null | undefined): Block[] {
  if (!text || !text.trim()) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  let list: { type: 'ol' | 'ul'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const kind = OL.test(line) ? 'ol' : UL.test(line) ? 'ul' : null;
    if (kind) {
      flushPara();
      if (list && list.type !== kind) flushList();
      list ??= { type: kind, items: [] };
      list.items.push(line.replace(kind === 'ol' ? OL : UL, '').trim());
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (list) {
      // Indented continuation of the previous list item.
      if (/^\s{2,}/.test(line)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
      flushList();
    }
    para.push(line.trimEnd());
  }
  flushPara();
  flushList();
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
const inline = (html: string) =>
  decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();

/** Converts the sanitized rich-text HTML used for session notes and summaries into blocks (no markup survives). */
export function htmlToBlocks(html: string | null | undefined): Block[] {
  if (!html || !html.trim()) return [];
  if (!/<[a-z][^>]*>/i.test(html)) return textToBlocks(html);
  const out: Block[] = [];
  const re = /<(p|h[1-6]|ul|ol|pre|blockquote|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const loose = (s: string) => {
    const t = inline(s);
    if (t) out.push({ type: 'p', text: t });
  };
  while ((m = re.exec(html))) {
    loose(html.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      const items = [...m[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => inline(x[1])).filter(Boolean);
      if (items.length) out.push({ type: tag, items });
    } else if (tag === 'pre') {
      const code = decode(m[2].replace(/<[^>]+>/g, ''));
      if (code.trim()) out.push({ type: 'code', text: code.replace(/\n$/, '') });
    } else if (tag.startsWith('h')) {
      const t = inline(m[2]);
      if (t) out.push({ type: 'h', text: t });
    } else loose(m[2]);
  }
  loose(html.slice(last));
  return out;
}

export const blocksToText = (blocks: Block[]) =>
  blocks
    .map((b) => ('items' in b ? b.items.map((t, i) => (b.type === 'ol' ? `${i + 1}. ${t}` : `- ${t}`)).join('\n') : b.text))
    .join('\n\n');

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** Video timecode, e.g. 1:05 or 1:02:03. */
export function fmtTimecode(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
export const fmtDateTime = (d: Date | null | undefined) => (d ? `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '');

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** ENUM_VALUE → "Enum value". */
export const humanize = (v: string | null | undefined) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : '');

/** Windows- and URL-safe file name component (ASCII, no reserved characters or names). */
export function safeFileName(name: string, maxLength = 80): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '';
  let base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength);
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `file-${base || 'unnamed'}`;
  return ext ? `${base}.${ext}` : base;
}
