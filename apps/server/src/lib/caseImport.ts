/**
 * Turns the free-text Steps / Expected / Gherkin columns of a test case CSV row into a test case body.
 * Pure functions: the import route does the database work.
 */

export const IMPORT_FORMATS = ['auto', 'steps', 'gherkin', 'text'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const STEP_SEPARATORS = ['auto', 'newline', 'pipe', 'semicolon', 'numbered'] as const;
export type StepSeparator = (typeof STEP_SEPARATORS)[number];
type Concrete = Exclude<StepSeparator, 'auto'>;

const NUMBERING = /^\s*\d+[.)]\s*/;
const GHERKIN_STEP = /^(Given|When|Then|And|But|\*)\s/i;
const GHERKIN_SCENARIO = /^(Scenario|Scenario Outline|Example):/i;

/** Positions of an inline "1. … 2. … 3. …" sequence (numbers must count up from 1). */
function numberedStarts(s: string) {
  const starts: number[] = [];
  let next = 1;
  for (const m of s.matchAll(/(^|\s)(\d+)[.)]\s+/g)) {
    if (Number(m[2]) !== next) continue;
    starts.push(m.index + m[1].length);
    next++;
  }
  return starts.length >= 2 ? starts : null;
}

/** The separator that splits this text into more than one item, tried in a fixed order. */
export function detectSeparator(s: string): Concrete | null {
  const t = s.trim();
  if (/\r?\n/.test(t)) return 'newline';
  if (t.includes('|')) return 'pipe';
  if (numberedStarts(t)) return 'numbered';
  if (t.includes(';')) return 'semicolon';
  return null;
}

/** Splits a cell into items with the given separator, stripping "1." style numbering and blanks. */
export function splitItems(s: string | undefined, sep: Concrete | null): string[] {
  const t = (s ?? '').trim();
  if (!t) return [];
  let parts: string[];
  if (sep === 'numbered') {
    const starts = numberedStarts(t);
    // Text before "1." (if any) stays with the first item; multi-line cells also split on new lines.
    parts = starts ? starts.map((start, i) => t.slice(i === 0 ? 0 : start, starts[i + 1] ?? t.length)) : t.split(/\r?\n/);
  } else if (sep === 'pipe') parts = t.split(/\r?\n|\|/);
  else if (sep === 'semicolon') parts = t.split(/\r?\n|;/);
  else if (sep === 'newline') parts = t.split(/\r?\n/);
  else parts = [t];
  return parts.map((p) => p.replace(NUMBERING, '').trim()).filter(Boolean);
}

/**
 * Pairs actions with expected results by position. A row with several steps but a single expected result
 * describes the outcome of the whole case, so it goes on the last step; surplus expected lines are kept on the last step too.
 */
export function pairSteps(actions: string[], expected: string[]) {
  const steps = actions.map((action) => ({ action, expected: null as string | null }));
  if (!steps.length) return steps;
  if (expected.length === 1 && steps.length > 1) steps[steps.length - 1]!.expected = expected[0]!;
  else {
    expected.slice(0, steps.length).forEach((e, i) => (steps[i]!.expected = e));
    if (expected.length > steps.length) {
      const last = steps[steps.length - 1]!;
      last.expected = [last.expected, ...expected.slice(steps.length)].filter(Boolean).join('\n');
    }
  }
  return steps;
}

export const looksLikeGherkin = (s: string | undefined) => {
  const lines = (s ?? '').split(/\r?\n/).map((l) => l.trim());
  return lines.some((l) => GHERKIN_SCENARIO.test(l)) || lines.filter((l) => GHERKIN_STEP.test(l)).length >= 2;
};

/** Keeps acronyms and names ("API", "Content Discovery") but reads naturally after a keyword ("When open the app"). */
const phrase = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s).replace(/[.;]\s*$/, '');

/** Adds a Scenario line (named after the case) when existing Gherkin text has only steps. */
export function ensureScenario(src: string, title: string) {
  const lines = src.trim().split(/\r?\n/);
  if (lines.some((l) => GHERKIN_SCENARIO.test(l.trim()))) return src.trim();
  return [`Scenario: ${title}`, ...lines.map((l) => `  ${l.trim()}`)].join('\n');
}

/** Builds a scenario from plain fields: Given = preconditions, When/And = steps, Then/And = expected results. */
export function toGherkin(title: string, preconditions: string[], actions: string[], expected: string[]) {
  const out = [`Scenario: ${title}`];
  const block = (keyword: string, items: string[]) => items.forEach((t, i) => out.push(`  ${i === 0 ? keyword : 'And'} ${phrase(t)}`));
  block('Given', preconditions);
  block('When', actions);
  block('Then', expected);
  return out.join('\n');
}

/** Gherkin text back to steps: Given/When lines become actions, Then lines the expected result of the step before. */
export function gherkinToSteps(src: string) {
  const steps: { action: string; expected: string | null }[] = [];
  let mode: 'action' | 'expected' = 'action';
  for (const raw of src.split(/\r?\n/)) {
    const m = raw.trim().match(/^(Given|When|Then|And|But|\*)\s+(.*)$/i);
    if (!m) continue;
    const kw = m[1]!.toLowerCase();
    if (kw === 'then') mode = 'expected';
    else if (kw === 'given' || kw === 'when') mode = 'action';
    const text = m[2]!.trim();
    const last = steps[steps.length - 1];
    if (mode === 'expected' && last) last.expected = last.expected ? `${last.expected}\n${text}` : text;
    else steps.push({ action: text, expected: null });
  }
  return steps;
}

export interface RowInput {
  title: string;
  description?: string;
  preconditions?: string;
  steps?: string;
  expected?: string;
  gherkin?: string;
}

export type RowResult =
  | { ok: true; format: 'STEPS' | 'GHERKIN' | 'TEXT'; gherkin: string | null; description: string | null; steps: { action: string; expected: string | null }[] }
  | { ok: false; message: string };

/** Decides the stored format and content for one CSV row. */
export function buildCaseContent(row: RowInput, format: ImportFormat, separator: StepSeparator): RowResult {
  const sep = separator === 'auto' ? detectSeparator(row.steps ?? '') : separator;
  const actions = splitItems(row.steps, sep);
  // Expected results follow the steps' separator, so a sentence containing ";" is not split when steps are on one line.
  const expected = splitItems(row.expected, separator === 'auto' ? (sep ?? detectSeparator(row.expected ?? '')) : separator);
  const description = row.description ?? null;
  const gherkinSource = row.gherkin ?? (looksLikeGherkin(row.steps) ? row.steps : undefined);

  if (format === 'auto') {
    if (gherkinSource) return { ok: true, format: 'GHERKIN', gherkin: ensureScenario(gherkinSource, row.title), description, steps: [] };
    if (actions.length) return { ok: true, format: 'STEPS', gherkin: null, description, steps: pairSteps(actions, expected) };
    return { ok: true, format: 'TEXT', gherkin: null, description: textDescription(description, [], expected), steps: [] };
  }
  if (format === 'gherkin') {
    if (gherkinSource) return { ok: true, format: 'GHERKIN', gherkin: ensureScenario(gherkinSource, row.title), description, steps: [] };
    const pre = splitItems(row.preconditions, /\r?\n/.test(row.preconditions ?? '') ? 'newline' : (row.preconditions ?? '').includes(';') ? 'semicolon' : null);
    if (!actions.length && !expected.length && !pre.length) return { ok: false, message: 'Gherkin format needs Steps, Expected, Preconditions or a Gherkin column' };
    return { ok: true, format: 'GHERKIN', gherkin: toGherkin(row.title, pre, actions, expected), description, steps: [] };
  }
  if (format === 'steps') {
    const steps = actions.length ? pairSteps(actions, expected) : gherkinSource ? gherkinToSteps(gherkinSource) : [];
    if (!steps.length) return { ok: false, message: 'Steps format needs a Steps (or Gherkin) column' };
    return { ok: true, format: 'STEPS', gherkin: null, description, steps };
  }
  return { ok: true, format: 'TEXT', gherkin: null, description: textDescription(description, gherkinSource ? [gherkinSource] : actions, expected), steps: [] };
}

function textDescription(description: string | null, actions: string[], expected: string[]) {
  const parts = [description?.trim()];
  if (actions.length) parts.push(actions.length > 1 ? `Steps:\n${actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : `Steps:\n${actions[0]}`);
  if (expected.length) parts.push(`Expected result:\n${expected.join('\n')}`);
  return parts.filter(Boolean).join('\n\n') || null;
}
