import { describe, expect, it } from 'vitest';
import { parseJUnit, parsePlaywright, flakiness } from '../src/integrations/parsers';
import { parseCsv, toCsv } from '../src/lib/csv';
import { lintCharter, recommendHeuristics } from '../src/ai/heuristics';
import { similarity } from '../src/lib/similarity';
import { sanitizeRichText, liveElapsed } from '../src/lib/util';

describe('JUnit parser', () => {
  it('normalizes nested suites and outcomes', () => {
    const xml = `<?xml version="1.0"?>
      <testsuites>
        <testsuite name="checkout" timestamp="2026-01-01T10:00:00" time="3.5">
          <testcase classname="cart" name="adds item" time="1.2"/>
          <testcase classname="cart" name="removes item" time="0.3"><failure message="expected 0 got 1">AssertionError at cart.spec:12</failure></testcase>
          <testcase classname="cart" name="crashes" time="0.1"><error message="boom"/></testcase>
          <testcase classname="cart" name="later"><skipped/></testcase>
        </testsuite>
      </testsuites>`;
    const r = parseJUnit(xml);
    expect(r.results.map((x) => x.status)).toEqual(['passed', 'failed', 'error', 'skipped']);
    expect(r.results[1].message).toContain('expected 0 got 1');
    expect(r.results[1].stackTrace).toContain('cart.spec:12');
    expect(r.results[0].durationMs).toBe(1200);
    expect(r.startedAt?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('rejects documents without test suites', () => {
    expect(() => parseJUnit('<html><body/></html>')).toThrow();
  });
});

describe('Playwright parser', () => {
  it('maps tests, retries and flaky outcomes', () => {
    const report = {
      stats: { startTime: '2026-02-01T08:00:00.000Z', duration: 4000 },
      suites: [
        {
          title: 'search.spec.ts',
          file: 'search.spec.ts',
          specs: [
            { title: 'finds products', tests: [{ projectName: 'chromium', status: 'expected', results: [{ status: 'passed', duration: 900, retry: 0 }] }] },
            {
              title: 'filters by price',
              tests: [{ projectName: 'chromium', status: 'flaky', results: [{ status: 'failed', duration: 500, retry: 0, error: { message: 'timeout' } }, { status: 'passed', duration: 600, retry: 1 }] }],
            },
            { title: 'sorts', tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 300, retry: 0, error: { message: 'wrong order', stack: 'at sort.spec:4' } }] }] },
          ],
        },
      ],
    };
    const r = parsePlaywright(report);
    expect(r.framework).toBe('playwright');
    expect(r.results).toHaveLength(3);
    const flaky = r.results.find((x) => x.name.includes('filters by price'))!;
    expect(flaky.retries).toBe(1);
    const failed = r.results.find((x) => x.name.includes('sorts'))!;
    expect(failed.status).toBe('failed');
    expect(failed.message).toContain('wrong order');
  });
});

describe('flakiness', () => {
  it('flags pass-on-retry and repeated flips, not stable failures', () => {
    expect(flakiness([{ category: 'PASSED', retries: 1 }]).flaky).toBe(true);
    expect(flakiness(['PASSED', 'FAILED', 'PASSED'].map((category) => ({ category, retries: 0 }))).flaky).toBe(true);
    expect(flakiness(['FAILED', 'FAILED', 'FAILED'].map((category) => ({ category, retries: 0 }))).flaky).toBe(false);
  });
});

describe('CSV', () => {
  it('escapes formula injection and round-trips quotes/newlines', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'line1\nline2, "q"' }], [
      { header: 'A', value: (r) => r.a },
      { header: 'B', value: (r) => r.b },
    ]);
    const rows = parseCsv(csv);
    expect(rows[1][0]).toBe(`'=HYPERLINK("x")`);
    expect(rows[1][1]).toBe('line1\nline2, "q"');
  });
});

describe('charter lint and heuristics', () => {
  it('scores a vague charter lower than a focused one', () => {
    const vague = lintCharter({ mission: 'test everything' });
    const good = lintCharter({
      mission: 'Explore the checkout coupon flow using boundary values to discover pricing and rounding defects',
      target: 'Checkout',
      scope: 'Coupon entry and totals',
      outOfScope: 'Payment provider',
      risks: 'Incorrect totals',
      exitCriteria: 'All coupon types tried',
      timeboxMinutes: 60,
      testIdeas: ['expired coupon'],
    });
    expect(vague.score).toBeLessThan(good.score);
    expect(vague.issues.some((i) => i.message.includes('everything'))).toBe(true);
    expect(good.issues).toHaveLength(0);
  });

  it('recommends relevant heuristics and always includes SFDIPOT', () => {
    const names = recommendHeuristics('login password session timeout').map((h) => h.name);
    expect(names).toContain('SFDIPOT');
    expect(names.length).toBeGreaterThan(1);
  });
});

describe('utilities', () => {
  it('similarity ranks near-duplicates above unrelated text', () => {
    const a = { title: 'Coupon total not updated after removing item' };
    expect(similarity(a, { title: 'Total does not update when item removed with coupon' })).toBeGreaterThan(similarity(a, { title: 'Avatar upload rejects PNG' }));
  });

  it('sanitizes rich text and strips scripts and handlers', () => {
    const out = sanitizeRichText('<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">l</a></p>');
    expect(out).not.toMatch(/script|onclick|javascript:/i);
    expect(out).toContain('Hi');
  });

  it('computes live elapsed time only while running', () => {
    const now = new Date('2026-01-01T10:10:00Z');
    expect(liveElapsed({ status: 'IN_PROGRESS', elapsedSeconds: 60, lastResumedAt: new Date('2026-01-01T10:00:00Z') }, now)).toBe(660);
    expect(liveElapsed({ status: 'PAUSED', elapsedSeconds: 60, lastResumedAt: null }, now)).toBe(60);
  });
});
