import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/** 3725 -> "1:02:05"; 125 -> "2:05" */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** 3725 -> "1h 2m"; 90 -> "1m"; 0 -> "0m" */
export function duration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(totalSeconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export const minutes = (m: number | null | undefined) => (m == null ? '—' : duration(m * 60));

export const fmtDate = (d: string | Date | null | undefined) => (d ? dayjs(d).format('MMM D, YYYY') : '—');
export const fmtDateTime = (d: string | Date | null | undefined) => (d ? dayjs(d).format('MMM D, YYYY HH:mm') : '—');
export const fromNow = (d: string | Date | null | undefined) => (d ? dayjs(d).fromNow() : '—');

export const titleCase = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

export const pct = (v: number | null | undefined, digits = 0) => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}%`);

/** Strip HTML for plain previews. */
export function plain(html: string | null | undefined, max = 200): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  const t = (div.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const initials = (name: string | null | undefined) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
