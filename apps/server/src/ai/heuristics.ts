/**
 * Deterministic exploratory-testing helpers that work without any AI provider:
 * heuristic recommendations and a charter quality check.
 */

export interface Heuristic {
  name: string;
  description: string;
  keywords: string[];
  ideas: string[];
}

export const HEURISTICS: Heuristic[] = [
  {
    name: 'SFDIPOT',
    description: 'Product elements: Structure, Function, Data, Interfaces, Platform, Operations, Time.',
    keywords: ['feature', 'new', 'module', 'product', 'workflow'],
    ideas: ['Map the structure (screens, components, services) before diving in', 'Vary the platform: browser, OS, device, locale', 'Consider time: timeouts, time zones, expiring data'],
  },
  {
    name: 'Goldilocks',
    description: 'Try values that are too small, too big, and just right.',
    keywords: ['input', 'form', 'field', 'value', 'amount', 'quantity', 'upload', 'size', 'limit', 'validation'],
    ideas: ['Empty, minimum, maximum and over-maximum values', 'Very long text, unicode, emoji and RTL text', 'Zero, negative and fractional numbers'],
  },
  {
    name: 'CRUD',
    description: 'Create, Read, Update and Delete every entity, and combinations of those.',
    keywords: ['create', 'edit', 'delete', 'list', 'record', 'entity', 'data', 'crud', 'admin'],
    ideas: ['Edit a record while another user deletes it', 'Delete an item referenced elsewhere', 'Create duplicates and near-duplicates'],
  },
  {
    name: 'Zero, One, Many',
    description: 'Exercise collections with no items, exactly one, and many items.',
    keywords: ['list', 'table', 'search', 'cart', 'collection', 'pagination', 'results', 'bulk'],
    ideas: ['Empty state with no data', 'Exactly one result', 'Hundreds of results, pagination and sorting'],
  },
  {
    name: 'Interruptions',
    description: 'Interrupt the flow: navigate away, refresh, lose network, time out, use the back button.',
    keywords: ['checkout', 'payment', 'wizard', 'flow', 'upload', 'session', 'mobile', 'offline', 'sync'],
    ideas: ['Refresh mid-transaction', 'Go offline and back online', 'Use browser back/forward during a multi-step flow', 'Let the session expire mid-task'],
  },
  {
    name: 'Follow the data',
    description: 'Trace data from entry through storage to every place it is displayed or exported.',
    keywords: ['report', 'export', 'import', 'sync', 'integration', 'api', 'data', 'migration'],
    ideas: ['Enter special characters and check every output (UI, email, CSV, PDF)', 'Import, then export and compare', 'Verify totals across views'],
  },
  {
    name: 'Never and Always',
    description: 'Identify things the system must never do and must always do, then try to break them.',
    keywords: ['payment', 'security', 'permission', 'billing', 'money', 'privacy', 'audit'],
    ideas: ['Try to charge twice', 'Try to see another user’s data', 'Check audit trails for every change'],
  },
  {
    name: 'Roles and permissions',
    description: 'Exercise each role, including direct URL/API access to resources not shown in the UI.',
    keywords: ['login', 'auth', 'role', 'permission', 'admin', 'user', 'access', 'sso', 'password', 'account'],
    ideas: ['Access another tenant’s object by changing the id in the URL', 'Downgrade a user’s role while they are logged in', 'Reuse an old session after logout'],
  },
  {
    name: 'OWASP-inspired probes',
    description: 'Injection, broken access control, insecure defaults, sensitive data exposure.',
    keywords: ['security', 'api', 'login', 'auth', 'upload', 'input', 'token', 'password', 'xss', 'injection'],
    ideas: ['Inject HTML/script into text fields and check rendering', 'Upload a file with a misleading extension', 'Check error messages for stack traces or secrets'],
  },
  {
    name: 'POUR (accessibility)',
    description: 'Perceivable, Operable, Understandable, Robust.',
    keywords: ['accessibility', 'a11y', 'screen reader', 'keyboard', 'contrast', 'ui', 'wcag'],
    ideas: ['Complete the main flow using only the keyboard', 'Check focus order and visible focus', 'Zoom to 200% and check reflow', 'Use a screen reader on key controls'],
  },
  {
    name: 'Consistency (HICCUPPS)',
    description: 'Compare against History, Image, Comparable products, Claims, User expectations, Product, Purpose, Standards.',
    keywords: ['ui', 'usability', 'ux', 'design', 'copy', 'docs', 'claims'],
    ideas: ['Compare behavior with similar screens in the product', 'Verify documentation and marketing claims', 'Check consistency of labels and terminology'],
  },
  {
    name: 'Error handling and recovery',
    description: 'Force failures and check that the system degrades gracefully and recovers.',
    keywords: ['error', 'recovery', 'failure', 'timeout', 'retry', 'network', 'api', 'integration', 'resilience'],
    ideas: ['Simulate a failing dependency (HTTP 500, timeout)', 'Retry after a failure and check for duplicates', 'Check error messages are actionable'],
  },
  {
    name: 'Responsive layouts',
    description: 'Vary viewport, orientation and input type.',
    keywords: ['mobile', 'responsive', 'layout', 'tablet', 'browser', 'device', 'viewport'],
    ideas: ['Resize across breakpoints during a flow', 'Rotate the device', 'Use touch and mouse alternately'],
  },
  {
    name: 'Performance perception',
    description: 'Look for slowness, jank and resource growth under realistic load and data volume.',
    keywords: ['performance', 'slow', 'load', 'latency', 'large', 'scale', 'speed'],
    ideas: ['Use large data sets', 'Throttle the network', 'Repeat an action many times and watch memory'],
  },
  {
    name: 'AI output probing',
    description: 'Vary prompts, adversarial inputs, and check grounding, safety and consistency of generated output.',
    keywords: ['ai', 'llm', 'chatbot', 'assistant', 'generated', 'model', 'prompt', 'recommendation'],
    ideas: ['Ask the same question several ways and compare answers', 'Try prompt-injection text inside user content', 'Check that outputs cite or respect the source data'],
  },
];

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Recommends heuristics by keyword overlap with the provided text. Always returns at least SFDIPOT. */
export function recommendHeuristics(text: string, limit = 5) {
  const lower = text.toLowerCase();
  const w = new Set(words(text));
  const scored = HEURISTICS.map((h) => {
    const matched = h.keywords.filter((k) => (k.includes(' ') ? lower.includes(k) : w.has(k)));
    return { ...h, matched, score: matched.length };
  })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.find((h) => h.name === 'SFDIPOT')) scored.push({ ...HEURISTICS[0], matched: [], score: 0 });
  return scored.slice(0, limit).map(({ keywords: _k, score: _s, ...rest }) => rest);
}

export interface CharterLike {
  title?: string | null;
  mission?: string | null;
  target?: string | null;
  scope?: string | null;
  outOfScope?: string | null;
  objectives?: string | null;
  risks?: string | null;
  exitCriteria?: string | null;
  timeboxMinutes?: number | null;
  testIdeas?: string[] | null;
}

const VAGUE = ['everything', 'all features', 'whole app', 'entire application', 'check it works', 'test it', 'make sure', 'etc', 'various', 'stuff', 'things', 'general'];

/** Rule-based charter quality check (identifies ambiguous objectives and missing scope). */
export function lintCharter(c: CharterLike) {
  const issues: { field: string; level: 'warning' | 'info'; message: string }[] = [];
  const mission = (c.mission ?? '').trim();
  const lm = mission.toLowerCase();
  if (mission.length < 25) issues.push({ field: 'mission', level: 'warning', message: 'Mission is very short. State the target, the approach and what you hope to discover.' });
  if (mission && !/\bexplore\b|\binvestigate\b|\bexamine\b|\bevaluate\b|\bprobe\b/.test(lm)) issues.push({ field: 'mission', level: 'info', message: 'Consider the format "Explore <target> using <approach> to discover <risks>".' });
  if (mission && !/\b(to discover|to find|to learn|to identify|to evaluate|to uncover|to assess|so that)\b/.test(lm)) issues.push({ field: 'mission', level: 'warning', message: 'Mission does not state what information you want to discover.' });
  for (const v of VAGUE) {
    const all = [mission, c.objectives ?? '', c.scope ?? ''].join(' ').toLowerCase();
    if (new RegExp(`\\b${v.replace(/ /g, '\\s+')}\\b`).test(all)) issues.push({ field: 'objectives', level: 'warning', message: `Vague wording "${v}" — narrow it to a specific area or behavior.` });
  }
  if (!c.target?.trim()) issues.push({ field: 'target', level: 'info', message: 'No feature/application under test specified; reports group findings by this field.' });
  if (!c.scope?.trim()) issues.push({ field: 'scope', level: 'warning', message: 'Scope is empty. Define what is in scope to keep the session focused.' });
  if (!c.outOfScope?.trim()) issues.push({ field: 'outOfScope', level: 'info', message: 'Out-of-scope is empty. Listing exclusions prevents scope creep.' });
  if (!c.risks?.trim()) issues.push({ field: 'risks', level: 'info', message: 'No target risks listed. Risks help prioritize where to look first.' });
  if (!c.exitCriteria?.trim()) issues.push({ field: 'exitCriteria', level: 'info', message: 'No exit criteria. How will the tester know the mission is complete?' });
  if (c.timeboxMinutes && c.timeboxMinutes > 180) issues.push({ field: 'timeboxMinutes', level: 'warning', message: 'Timebox over 3 hours. Consider splitting into several focused sessions.' });
  if (c.timeboxMinutes && c.timeboxMinutes < 15) issues.push({ field: 'timeboxMinutes', level: 'info', message: 'Timebox under 15 minutes leaves little time for learning.' });
  if (!c.testIdeas?.length) issues.push({ field: 'testIdeas', level: 'info', message: 'No test ideas. Add a few starting points (they are suggestions, not scripts).' });
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + (i.level === 'warning' ? 15 : 5), 0));
  return { score, issues };
}
