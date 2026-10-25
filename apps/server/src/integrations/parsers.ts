import { XMLParser } from 'fast-xml-parser';

/** Normalized automation test result, the common shape all report formats are converted into. */
export interface NormalizedResult {
  key?: string;
  name: string;
  suite?: string | null;
  file?: string | null;
  status: string;
  durationMs?: number | null;
  message?: string | null;
  stackTrace?: string | null;
  retries?: number;
  artifacts?: { name: string; url?: string; path?: string; contentType?: string }[];
}

export interface ParsedReport {
  framework: string;
  startedAt?: Date;
  durationMs?: number;
  results: NormalizedResult[];
}

const arr = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.message, o['#text']].filter((x) => typeof x === 'string' && x).join('\n') || null;
  }
  return String(v);
};
const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

/**
 * Parses JUnit XML (Jenkins/Maven Surefire/pytest/Jest-junit/Cypress/Selenium style).
 * Supports nested <testsuites>/<testsuite> and <failure>, <error>, <skipped> children.
 */
export function parseJUnit(xml: string): ParsedReport {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text', processEntities: true, allowBooleanAttributes: true });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw new Error(`Invalid XML: ${(e as Error).message}`);
  }
  const results: NormalizedResult[] = [];
  let startedAt: Date | undefined;
  let totalTime = 0;

  const visitSuite = (suite: Record<string, unknown>, parents: string[]) => {
    const name = typeof suite.name === 'string' ? suite.name : '';
    const path = name ? [...parents, name] : parents;
    if (!startedAt && typeof suite.timestamp === 'string' && !Number.isNaN(Date.parse(suite.timestamp))) startedAt = new Date(suite.timestamp);
    for (const tc of arr(suite.testcase as Record<string, unknown> | Record<string, unknown>[])) {
      const failure = tc.failure ?? undefined;
      const error = tc.error ?? undefined;
      const skipped = tc.skipped !== undefined;
      const status = failure !== undefined ? 'failed' : error !== undefined ? 'error' : skipped ? 'skipped' : 'passed';
      const problem = (arr(failure as unknown[])[0] ?? arr(error as unknown[])[0]) as Record<string, unknown> | string | undefined;
      const msgAttr = problem && typeof problem === 'object' ? (problem.message as string | undefined) : undefined;
      const body = problem && typeof problem === 'object' ? (problem['#text'] as string | undefined) : typeof problem === 'string' ? problem : undefined;
      const time = Number(tc.time);
      if (Number.isFinite(time)) totalTime += time;
      const classname = typeof tc.classname === 'string' ? tc.classname : null;
      const tcName = String(tc.name ?? 'Unnamed test');
      results.push({
        key: `${classname ?? path.join('.')}::${tcName}`,
        name: tcName,
        suite: classname ?? (path.join(' › ') || null),
        file: typeof tc.file === 'string' ? tc.file : null,
        status,
        durationMs: Number.isFinite(time) ? Math.round(time * 1000) : null,
        message: clip(msgAttr ?? (body ? body.split('\n')[0] : null) ?? textOf(tc.skipped), 4000),
        stackTrace: clip(body ?? null, 20_000),
      });
    }
    for (const child of arr(suite.testsuite as Record<string, unknown> | Record<string, unknown>[])) visitSuite(child, path);
  };

  const roots: Record<string, unknown>[] = doc.testsuites ? arr(doc.testsuites as Record<string, unknown> | Record<string, unknown>[]) : [];
  for (const r of roots) {
    for (const s of arr(r.testsuite as Record<string, unknown> | Record<string, unknown>[])) visitSuite(s, []);
  }
  for (const s of arr(doc.testsuite as Record<string, unknown> | Record<string, unknown>[])) visitSuite(s, []);
  if (!roots.length && !doc.testsuite) throw new Error('No <testsuites> or <testsuite> element found');
  return { framework: 'junit', startedAt, durationMs: Math.round(totalTime * 1000), results };
}

interface PwResult { status?: string; duration?: number; retry?: number; error?: { message?: string; stack?: string }; errors?: { message?: string; stack?: string }[]; attachments?: { name: string; path?: string; contentType?: string }[] }
interface PwTest { projectName?: string; status?: string; results?: PwResult[]; expectedStatus?: string }
interface PwSpec { title: string; file?: string; line?: number; tests?: PwTest[] }
interface PwSuite { title?: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] }

/**
 * Parses the Playwright JSON reporter output (`--reporter=json`).
 * Outcome mapping: expected→passed (or skipped), unexpected→failed, flaky→flaky (passed on retry), skipped→skipped.
 */
export function parsePlaywright(report: unknown): ParsedReport {
  const r = report as { suites?: PwSuite[]; stats?: { startTime?: string; duration?: number } };
  if (!r || !Array.isArray(r.suites)) throw new Error('Not a Playwright JSON report (missing "suites")');
  const results: NormalizedResult[] = [];
  const visit = (suite: PwSuite, titles: string[], file?: string) => {
    const f = suite.file ?? file;
    const path = suite.title && suite.title !== f ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const runs = t.results ?? [];
        const last = runs[runs.length - 1];
        let status = t.status ?? 'expected';
        if (status === 'expected') status = last?.status === 'skipped' ? 'skipped' : 'passed';
        else if (status === 'unexpected') status = last?.status === 'timedOut' ? 'timedout' : last?.status === 'interrupted' ? 'interrupted' : 'failed';
        const err = [...runs].reverse().find((x) => x.error || x.errors?.length);
        const e = err?.error ?? err?.errors?.[0];
        const name = [...path.filter(Boolean), spec.title].join(' › ');
        results.push({
          key: `${spec.file ?? f ?? ''}::${name}::${t.projectName ?? ''}`,
          name: t.projectName ? `${name} [${t.projectName}]` : name,
          suite: path.filter(Boolean).join(' › ') || null,
          file: spec.file ?? f ?? null,
          status,
          durationMs: runs.reduce((a, x) => a + (x.duration ?? 0), 0),
          message: clip(e?.message?.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0] ?? null, 4000),
          stackTrace: clip(e?.stack?.replace(/\u001b\[[0-9;]*m/g, '') ?? null, 20_000),
          retries: Math.max(0, runs.length - 1),
          artifacts: runs.flatMap((x) => x.attachments ?? []).filter((a) => a.path || a.name).slice(0, 20).map((a) => ({ name: a.name, path: a.path, contentType: a.contentType })),
        });
      }
    }
    for (const s of suite.suites ?? []) visit(s, path, f);
  };
  for (const s of r.suites) visit(s, [], s.file);
  return {
    framework: 'playwright',
    startedAt: r.stats?.startTime ? new Date(r.stats.startTime) : undefined,
    durationMs: r.stats?.duration ? Math.round(r.stats.duration) : undefined,
    results,
  };
}

/**
 * Flakiness from historical evidence (most recent first): a test is flaky when it
 * passed on retry recently, or its pass/fail outcome flipped at least twice in the window.
 */
export function flakiness(history: { category: string; retries: number }[]) {
  const relevant = history.filter((h) => h.category === 'PASSED' || h.category === 'FAILED');
  let flips = 0;
  for (let i = 1; i < relevant.length; i++) if (relevant[i].category !== relevant[i - 1].category) flips++;
  const passedOnRetry = history.filter((h) => h.category === 'PASSED' && h.retries > 0).length;
  const score = relevant.length > 1 ? flips / (relevant.length - 1) : 0;
  return { flips, passedOnRetry, score: Math.round(score * 100) / 100, flaky: passedOnRetry > 0 || flips >= 2 };
}
