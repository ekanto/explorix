/**
 * Deterministic text similarity used for duplicate-finding suggestions.
 * Score = 0.6 * character-trigram Dice on titles + 0.4 * token Jaccard on full text.
 * Suggestions are advisory only; merging always requires user confirmation.
 */
const STOP = new Set(
  'the a an and or but to of in on at for with is are was were be been it this that when then than from by as not no can cannot does do did into after before while'.split(' '),
);

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

function trigrams(s: string): Map<string, number> {
  const norm = ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const m = new Map<string, number>();
  for (let i = 0; i < norm.length - 2; i++) {
    const g = norm.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

export function dice(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  let total = 0;
  for (const [, n] of A) total += n;
  for (const [g, n] of B) {
    total += n;
    inter += Math.min(n, A.get(g) ?? 0);
  }
  return total ? (2 * inter) / total : 0;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(a: { title: string; text?: string }, b: { title: string; text?: string }): number {
  const t = dice(a.title, b.title);
  const j = jaccard(tokens(`${a.title} ${a.text ?? ''}`), tokens(`${b.title} ${b.text ?? ''}`));
  return Math.round((0.6 * t + 0.4 * j) * 1000) / 1000;
}
