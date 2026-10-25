import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { AppError } from '../lib/errors.js';
import { recommendHeuristics } from './heuristics.js';

/**
 * Provider abstraction for optional AI assistance. Every result is a *draft* that the user must
 * review and explicitly save; nothing generated here is written to the database by this layer.
 */

export const TASKS = {
  charter_draft: z.object({
    title: z.string(),
    mission: z.string(),
    target: z.string().optional().default(''),
    scope: z.string().optional().default(''),
    outOfScope: z.string().optional().default(''),
    objectives: z.string().optional().default(''),
    risks: z.string().optional().default(''),
    testIdeas: z.array(z.string()).default([]),
    heuristics: z.array(z.string()).default([]),
    exitCriteria: z.string().optional().default(''),
    timeboxMinutes: z.coerce.number().int().min(10).max(480).catch(60),
  }),
  test_ideas: z.object({ ideas: z.array(z.object({ idea: z.string(), rationale: z.string().optional().default('') })) }),
  session_summary: z.object({
    summary: z.string(),
    keyFindings: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    followUps: z.array(z.string()).default([]),
    coverageNotes: z.string().optional().default(''),
  }),
  defect_report: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    reproSteps: z.string().optional().default(''),
    expected: z.string().optional().default(''),
    actual: z.string().optional().default(''),
    severity: z.enum(['TRIVIAL', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER']).catch('MINOR'),
    classificationKey: z.string().optional().default('potential_defect'),
  }),
  test_cases: z.object({
    testCases: z.array(
      z.object({
        title: z.string(),
        preconditions: z.string().optional().default(''),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).catch('MEDIUM'),
        steps: z.array(z.object({ action: z.string(), expected: z.string().optional().default('') })).min(1),
      }),
    ),
  }),
  release_risk: z.object({
    summary: z.string(),
    risks: z.array(z.object({ area: z.string(), level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).catch('MEDIUM'), rationale: z.string() })).default([]),
    recommendation: z.string().optional().default(''),
  }),
} as const;

export type AiTask = keyof typeof TASKS;
export type AiOutput<T extends AiTask> = z.infer<(typeof TASKS)[T]>;

export interface AiRequest {
  task: AiTask;
  system: string;
  prompt: string;
  /** Structured context used by deterministic providers. */
  context: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock: boolean;
  generate(req: AiRequest): Promise<unknown>;
}

export const SETUP_INSTRUCTIONS = [
  'AI assistance is optional; every core Explorix workflow works without it.',
  'To enable it, set these variables in apps/server/.env (server-side only, never in the browser) and restart:',
  '  AI_PROVIDER=openai',
  '  AI_API_KEY=<your key>',
  '  AI_MODEL=gpt-4o-mini            # any chat model',
  '  AI_BASE_URL=https://api.openai.com/v1   # or any OpenAI-compatible endpoint (Azure OpenAI, Ollama, LM Studio, vLLM)',
  'For demos and automated tests, AI_PROVIDER=mock returns deterministic, clearly labeled drafts without calling any service.',
].join('\n');

class OpenAICompatibleProvider implements AiProvider {
  readonly name = 'openai';
  readonly isMock = false;
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async generate(req: AiRequest) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${req.system}\nRespond with a single JSON object only.` },
          { role: 'user', content: req.prompt },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: text.slice(0, 500) }, 'AI provider error');
      throw new AppError(502, 'ai_provider_error', `AI provider returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? '';
    try {
      return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new AppError(502, 'ai_invalid_response', 'AI provider returned a response that was not valid JSON');
    }
  }
}

const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
const firstWords = (s: string, n: number) => s.split(/\s+/).slice(0, n).join(' ');
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Deterministic offline provider for demos/tests. Output is derived from the input text by simple rules. */
export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'explorix-mock-1';
  readonly isMock = true;

  async generate(req: AiRequest): Promise<unknown> {
    const c = req.context;
    switch (req.task) {
      case 'charter_draft': {
        const text = str(c.text);
        const s = sentences(text);
        const target = str(c.target) || firstWords(s[0] ?? 'the feature', 6).replace(/[.,;:]$/, '');
        const h = recommendHeuristics(text, 3);
        return {
          title: `Explore ${target}`.slice(0, 120),
          mission: `Explore ${target} using realistic user journeys, boundary values and interruptions to discover defects, gaps against the requirement and usability risks.`,
          target,
          scope: s.slice(0, 3).join(' '),
          outOfScope: 'Unrelated modules and infrastructure not touched by this change.',
          objectives: `Verify the behavior described in the requirement and learn where it is fragile.`,
          risks: ['Incorrect handling of invalid or boundary input', 'Inconsistent state after interruption or refresh', 'Permission or data-visibility gaps'].join('\n'),
          testIdeas: [...h.flatMap((x) => x.ideas).slice(0, 5), ...s.slice(0, 3).map((x) => `Check: ${x}`)],
          heuristics: h.map((x) => x.name),
          exitCriteria: 'Every statement in the requirement has been exercised; open questions and risks are logged.',
          timeboxMinutes: text.length > 600 ? 90 : 60,
        };
      }
      case 'test_ideas': {
        const h = recommendHeuristics(str(c.text), 4);
        return { ideas: h.flatMap((x) => x.ideas.map((idea) => ({ idea, rationale: `From heuristic: ${x.name}` }))).slice(0, 10) };
      }
      case 'session_summary': {
        const findings = (c.findings as { title: string; classification: string; severity: string }[]) ?? [];
        const defects = findings.filter((f) => /defect/i.test(f.classification));
        const questions = findings.filter((f) => /question/i.test(f.classification));
        const risks = findings.filter((f) => /risk/i.test(f.classification));
        return {
          summary: `Session "${str(c.title)}" ran for ${c.elapsedMinutes} of ${c.timeboxMinutes} planned minutes against the mission: ${str(c.mission)} It produced ${findings.length} finding(s): ${defects.length} defect-related, ${questions.length} question(s) and ${risks.length} risk(s).`,
          keyFindings: findings.slice(0, 8).map((f) => `[${f.classification}/${f.severity}] ${f.title}`),
          risks: risks.map((f) => f.title),
          followUps: [...questions.map((f) => `Answer: ${f.title}`), ...defects.filter((f) => /potential/i.test(f.classification)).map((f) => `Confirm or reject: ${f.title}`)],
          coverageNotes: str(c.notesText).slice(0, 400),
        };
      }
      case 'defect_report': {
        const notes = str(c.notes);
        const s = sentences(notes);
        const exp = s.find((x) => /expect|should/i.test(x)) ?? '';
        const act = s.find((x) => /actual|instead|but|error|fails?|crash/i.test(x) && x !== exp) ?? '';
        const steps = s.filter((x) => x !== exp && x !== act).map((x, i) => `${i + 1}. ${x}`);
        const sev = /crash|data loss|security|cannot|blocked/i.test(notes) ? 'CRITICAL' : /error|fail|wrong/i.test(notes) ? 'MAJOR' : 'MINOR';
        return { title: firstWords(act || s[0] || 'Unexpected behavior', 12), description: notes, reproSteps: steps.join('\n'), expected: exp, actual: act, severity: sev, classificationKey: 'potential_defect' };
      }
      case 'test_cases': {
        const f = c.finding as { title: string; reproSteps?: string; expected?: string; actual?: string; environment?: string };
        const steps = (f.reproSteps ?? '').split(/\n+/).map((x) => x.replace(/^\s*(\d+[.)]|[-*])\s*/, '').trim()).filter(Boolean);
        return {
          testCases: [
            {
              title: `Regression: ${f.title}`,
              preconditions: f.environment ?? '',
              priority: 'HIGH',
              steps: (steps.length ? steps : ['Reproduce the scenario from the original finding']).map((action, i, arr) => ({ action, expected: i === arr.length - 1 ? f.expected || 'Behavior matches the specification' : '' })),
            },
          ],
        };
      }
      case 'release_risk': {
        const ind = (c.indicators as { label: string; level: string; value: unknown }[]) ?? [];
        const bad = ind.filter((i) => i.level === 'fail' || i.level === 'warn');
        return {
          summary: `Milestone "${str(c.milestone)}" overall readiness: ${str(c.overall)}. ${bad.length} indicator(s) need attention.`,
          risks: bad.map((i) => ({ area: i.label, level: i.level === 'fail' ? 'HIGH' : 'MEDIUM', rationale: `Current value: ${String(i.value ?? 'n/a')}` })),
          recommendation: bad.length ? 'Resolve failing indicators before release; review warnings with the team.' : 'No indicator is failing. Confirm with stakeholders before release.',
        };
      }
    }
  }
}

let cached: AiProvider | null | undefined;

export function getProvider(): AiProvider | null {
  if (cached !== undefined) return cached;
  if (config.AI_PROVIDER === 'mock') cached = new MockProvider();
  else if (config.AI_PROVIDER === 'openai' && config.AI_API_KEY) cached = new OpenAICompatibleProvider(config.AI_MODEL, config.AI_API_KEY, config.AI_BASE_URL);
  else cached = null;
  return cached;
}

/** For tests: override the active provider. */
export function setProviderForTests(p: AiProvider | null | undefined) {
  cached = p;
}

export function aiStatus() {
  const p = getProvider();
  const misconfigured = config.AI_PROVIDER === 'openai' && !config.AI_API_KEY;
  return {
    enabled: !!p,
    provider: p?.name ?? 'none',
    model: p?.model ?? null,
    isMock: p?.isMock ?? false,
    misconfigured,
    setupInstructions: p && !p.isMock ? null : SETUP_INSTRUCTIONS,
  };
}

export async function runTask<T extends AiTask>(task: T, system: string, prompt: string, context: Record<string, unknown>): Promise<{ draft: AiOutput<T>; meta: { provider: string; model: string; isMock: boolean; generatedAt: string; reviewRequired: true } }> {
  const p = getProvider();
  if (!p) throw new AppError(503, 'ai_not_configured', 'AI assistance is not configured on this server.', { setupInstructions: SETUP_INSTRUCTIONS });
  const raw = await p.generate({ task, system, prompt, context });
  const parsed = TASKS[task].safeParse(raw);
  if (!parsed.success) throw new AppError(502, 'ai_invalid_response', 'AI provider response did not match the expected structure', { issues: parsed.error.issues.slice(0, 5) });
  return { draft: parsed.data as AiOutput<T>, meta: { provider: p.name, model: p.model, isMock: p.isMock, generatedAt: new Date().toISOString(), reviewRequired: true } };
}
