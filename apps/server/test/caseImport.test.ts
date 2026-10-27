import { describe, expect, it } from 'vitest';
import { buildCaseContent, detectSeparator, splitItems } from '../src/lib/caseImport';
import { validateGherkin } from '../src/modules/testCases';

const row = {
  title: 'Upload a profile photo',
  preconditions: 'Signed in as a customer',
  steps: '1. Open the profile page | 2. Upload a PNG | 3. Save',
  expected: 'The new photo is shown',
};

describe('test case CSV import formats', () => {
  it('detects separators and keeps decimals intact', () => {
    expect(detectSeparator('a\nb')).toBe('newline');
    expect(detectSeparator('a | b')).toBe('pipe');
    expect(detectSeparator('1. Set zoom to 4.5 2. Reload')).toBe('numbered');
    expect(detectSeparator('a; b')).toBe('semicolon');
    expect(splitItems('1. Set zoom to 4.5 2. Reload', 'numbered')).toEqual(['Set zoom to 4.5', 'Reload']);
    expect(splitItems('1) Open; 2) Close', 'semicolon')).toEqual(['Open', 'Close']);
  });

  it('splits pipe-separated steps and puts a single expected result on the last step', () => {
    const r = buildCaseContent(row, 'auto', 'auto');
    expect(r).toMatchObject({ ok: true, format: 'STEPS' });
    if (!r.ok) return;
    expect(r.steps).toEqual([
      { action: 'Open the profile page', expected: null },
      { action: 'Upload a PNG', expected: null },
      { action: 'Save', expected: 'The new photo is shown' },
    ]);
  });

  it('honours an explicit separator', () => {
    const r = buildCaseContent({ ...row, steps: 'Open; Upload | resize; Save' }, 'steps', 'semicolon');
    expect(r.ok && r.steps.map((s) => s.action)).toEqual(['Open', 'Upload | resize', 'Save']);
  });

  it('converts plain steps to valid Gherkin', () => {
    const r = buildCaseContent({ ...row, expected: 'Photo is shown | Toast says Saved' }, 'gherkin', 'auto');
    expect(r).toMatchObject({ ok: true, format: 'GHERKIN' });
    if (!r.ok) return;
    expect(r.gherkin).toBe(
      [
        'Scenario: Upload a profile photo',
        '  Given signed in as a customer',
        '  When open the profile page',
        '  And upload a PNG',
        '  And save',
        '  Then photo is shown',
        '  And toast says Saved',
      ].join('\n'),
    );
    expect(validateGherkin(r.gherkin!)).toEqual([]);
  });

  it('adds a Scenario line to step-only Gherkin and turns Gherkin into steps on request', () => {
    const g = 'Given a cart\nWhen I check out\nThen I see the receipt';
    const auto = buildCaseContent({ title: 'Checkout', steps: g }, 'auto', 'auto');
    expect(auto.ok && auto.format).toBe('GHERKIN');
    expect(auto.ok && auto.gherkin?.startsWith('Scenario: Checkout\n  Given a cart')).toBe(true);
    const steps = buildCaseContent({ title: 'Checkout', gherkin: g }, 'steps', 'auto');
    expect(steps.ok && steps.steps).toEqual([
      { action: 'a cart', expected: null },
      { action: 'I check out', expected: 'I see the receipt' },
    ]);
  });

  it('stores numbered steps and expected results in the description for Text', () => {
    const r = buildCaseContent({ ...row, description: 'Avatar flow' }, 'text', 'auto');
    expect(r).toMatchObject({ ok: true, format: 'TEXT', steps: [] });
    expect(r.ok && r.description).toBe('Avatar flow\n\nSteps:\n1. Open the profile page\n2. Upload a PNG\n3. Save\n\nExpected result:\nThe new photo is shown');
  });

  it('rejects a row with nothing to convert', () => {
    expect(buildCaseContent({ title: 'Empty' }, 'steps', 'auto')).toMatchObject({ ok: false });
  });
});
