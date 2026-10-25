/**
 * Explorix demonstration data. Run via `npm run db:seed` (or automatically by `npm run setup` / `db:reset`).
 * Refuses to run when the database already contains an organization, so it never overwrites real data.
 *
 * Demo accounts (password for all: Explorix-demo-1):
 *   admin@explorix.dev   – organization owner (implicit admin of every project)
 *   lead@explorix.dev    – QA lead in ShopFront and Mobile Banking API
 *   tester@explorix.dev  – tester in ShopFront and Mobile Banking API
 *   sam@explorix.dev     – tester in ShopFront only
 *   viewer@explorix.dev  – viewer (product owner) in ShopFront
 *   dana@explorix.dev    – tester in Mobile Banking API only (cannot see ShopFront)
 */
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { PrismaClient, type Prisma, type Severity, type Priority, type SessionStatus, type FindingStatus } from '@prisma/client';
import { hashPassword } from '../src/lib/passwords.js';
import { applyProjectDefaults } from '../src/lib/projectDefaults.js';
import { SYSTEM_TEMPLATES } from '../src/lib/systemTemplates.js';
import { storage, newStorageKey } from '../src/lib/storage.js';
import { encryptSecret } from '../src/lib/crypto.js';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Explorix-demo-1';

const NOW = Date.now();
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW - ms);

// ---------- tiny PNG encoder to create a realistic-looking "screenshot" attachment ----------
function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function mockScreenshot(accent: [number, number, number]) {
  const w = 480;
  const h = 300;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let px: [number, number, number] = [248, 249, 251];
      if (y < 36) px = [30, 41, 59]; // app bar
      else if (x < 90) px = [235, 238, 244]; // sidebar
      else if (y > 70 && y < 92 && x > 120 && x < 420) px = [210, 214, 222]; // input
      else if (y > 110 && y < 140 && x > 120 && x < 230) px = accent; // button
      else if (y > 170 && y < 200 && x > 120 && x < 460) px = [254, 226, 226]; // error banner
      else if (y > 170 && y < 200 && x > 110 && x <= 120) px = [220, 38, 38];
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  if (await prisma.organization.count()) {
    console.log('[seed] Database already contains data; skipping. Use `npm run db:reset` to recreate the demo dataset.');
    return;
  }
  console.log('[seed] Creating Explorix demo data…');
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const org = await prisma.organization.create({ data: { name: 'Explorix Demo', slug: 'explorix-demo', settings: { allowMemberProjectCreation: false } } });
  const mkUser = (email: string, name: string, avatarColor: string) => prisma.user.create({ data: { email, name, passwordHash, avatarColor } });
  const admin = await mkUser('admin@explorix.dev', 'Ava Morgan', '#7048e8');
  const lead = await mkUser('lead@explorix.dev', 'Liam Chen', '#1c7ed6');
  const tester = await mkUser('tester@explorix.dev', 'Tara Okafor', '#0ca678');
  const sam = await mkUser('sam@explorix.dev', 'Sam Patel', '#f08c00');
  const viewer = await mkUser('viewer@explorix.dev', 'Vic Romero', '#868e96');
  const dana = await mkUser('dana@explorix.dev', 'Dana Kim', '#e64980');
  await prisma.orgMember.createMany({
    data: [
      { orgId: org.id, userId: admin.id, role: 'OWNER' },
      ...[lead, tester, sam, viewer, dana].map((u) => ({ orgId: org.id, userId: u.id, role: 'MEMBER' as const })),
    ],
  });
  const team = await prisma.team.create({ data: { orgId: org.id, name: 'Web QA', description: 'Exploratory and regression testing for the web storefront' } });
  await prisma.teamMember.createMany({ data: [lead, tester, sam].map((u) => ({ teamId: team.id, userId: u.id })) });

  for (const t of SYSTEM_TEMPLATES) {
    await prisma.charterTemplate.create({
      data: { orgId: org.id, name: t.name, category: t.category, description: t.description, missionTemplate: t.missionTemplate, timeboxMinutes: t.timeboxMinutes, heuristics: t.heuristics, testIdeas: t.testIdeas, defaults: t.defaults, isSystem: true },
    });
  }
  const tpl = async (name: string) => (await prisma.charterTemplate.findFirstOrThrow({ where: { orgId: org.id, name } })).id;

  // =====================================================================================
  // Project 1: ShopFront Web
  // =====================================================================================
  const shop = await prisma.project.create({
    data: {
      orgId: org.id,
      key: 'SHOP',
      name: 'ShopFront Web',
      description: 'Customer-facing e-commerce storefront: catalog, search, cart, checkout and accounts.',
      color: '#0ca678',
      settings: { requireReview: true, allowSelfReview: false, lockCompletedSessions: true, defaultTimeboxMinutes: 60, allowTesterCharterEdit: true },
      createdAt: ago(60 * DAY),
    },
  });
  await prisma.$transaction((tx) => applyProjectDefaults(tx, shop.id));
  await prisma.projectMember.createMany({
    data: [
      { projectId: shop.id, userId: lead.id, role: 'LEAD' },
      { projectId: shop.id, userId: tester.id, role: 'TESTER' },
      { projectId: shop.id, userId: sam.id, role: 'TESTER' },
      { projectId: shop.id, userId: viewer.id, role: 'VIEWER' },
    ],
  });

  const cls = Object.fromEntries((await prisma.findingClassification.findMany({ where: { projectId: shop.id } })).map((c) => [c.key, c.id]));
  const st = Object.fromEntries((await prisma.testResultStatus.findMany({ where: { projectId: shop.id } })).map((s) => [s.key, s]));

  const r23 = await prisma.milestone.create({ data: { projectId: shop.id, name: 'Release 2.3', status: 'RELEASED', startDate: ago(50 * DAY), dueDate: ago(22 * DAY), releasedAt: ago(21 * DAY), description: 'Wishlist and product reviews.' } });
  const r24 = await prisma.milestone.create({ data: { projectId: shop.id, name: 'Release 2.4', status: 'ACTIVE', startDate: ago(20 * DAY), dueDate: new Date(NOW + 9 * DAY), description: 'Guest checkout, discount codes and saved payment methods.' } });
  const r25 = await prisma.milestone.create({ data: { projectId: shop.id, name: 'Release 2.5', status: 'PLANNED', startDate: new Date(NOW + 10 * DAY), dueDate: new Date(NOW + 45 * DAY), description: 'Search relevance and order history redesign.' } });

  const staging = await prisma.environment.create({ data: { projectId: shop.id, name: 'Staging', url: 'https://staging.shopfront.example', browser: 'Chrome 126', os: 'Windows 11', device: 'Desktop' } });
  const qaMobile = await prisma.environment.create({ data: { projectId: shop.id, name: 'QA – Mobile', url: 'https://qa.shopfront.example', browser: 'Safari 17', os: 'iOS 17', device: 'iPhone 15' } });

  const tagNames = ['checkout', 'payments', 'a11y', 'mobile', 'regression', 'search', 'security'];
  const tags: Record<string, string> = {};
  for (const n of tagNames) tags[n] = (await prisma.tag.create({ data: { projectId: shop.id, name: n, color: n === 'security' ? 'red' : n === 'a11y' ? 'violet' : 'gray' } })).id;

  await prisma.customFieldDefinition.createMany({
    data: [
      { projectId: shop.id, entity: 'CHARTER', key: 'feature_area', label: 'Feature area', type: 'SELECT', options: ['Catalog', 'Search', 'Cart', 'Checkout', 'Account'], position: 0 },
      { projectId: shop.id, entity: 'FINDING', key: 'customer_impact', label: 'Customer impact', type: 'SELECT', options: ['None', 'Low', 'Medium', 'High'], position: 0 },
      { projectId: shop.id, entity: 'SESSION', key: 'build_link', label: 'Build link', type: 'URL', position: 0 },
    ],
  });

  const seq = { charter: 0, session: 0, finding: 0, issue: 0, testCase: 0, requirement: 0, testRun: 0, automation: 0 };

  // ---------- Requirements ----------
  const reqDefs = [
    { externalKey: 'SF-101', title: 'Guest checkout without account', priority: 'HIGH' },
    { externalKey: 'SF-102', title: 'Apply and remove discount codes', priority: 'HIGH' },
    { externalKey: 'SF-103', title: 'Save and reuse payment methods', priority: 'MEDIUM' },
    { externalKey: 'SF-110', title: 'Search filters (price, brand, rating)', priority: 'MEDIUM' },
    { externalKey: 'SF-120', title: 'Checkout meets WCAG 2.2 AA', priority: 'HIGH' },
    { externalKey: 'SF-130', title: 'Order history with re-order', priority: 'LOW' },
  ] as const;
  const reqs: Record<string, string> = {};
  for (const r of reqDefs) {
    const created = await prisma.requirement.create({
      data: { projectId: shop.id, number: ++seq.requirement, externalKey: r.externalKey, title: r.title, priority: r.priority, status: 'APPROVED', externalUrl: `https://tracker.example/browse/${r.externalKey}`, description: `Acceptance criteria are tracked in ${r.externalKey}.` },
    });
    reqs[r.externalKey] = created.id;
  }

  // ---------- Charters ----------
  interface CharterSeed {
    key: string;
    title: string;
    mission: string;
    target: string;
    template?: string;
    scope?: string;
    outOfScope?: string;
    objectives?: string;
    risks?: string;
    testIdeas?: string[];
    heuristics?: string[];
    priority: Priority;
    riskLevel: Priority;
    milestoneId?: string;
    assignees: string[];
    tags: string[];
    reqs?: string[];
    status?: 'DRAFT' | 'READY' | 'ARCHIVED';
    timebox?: number;
    area?: string;
    daysAgo: number;
    exitCriteria?: string;
  }
  const charterSeeds: CharterSeed[] = [
    {
      key: 'guest',
      title: 'Guest checkout end-to-end',
      mission: 'Explore guest checkout using varied carts, addresses and payment outcomes to discover defects that would block or mislead first-time buyers.',
      target: 'Checkout',
      template: 'New feature exploration',
      scope: 'Cart → shipping → payment → confirmation for guests. Address validation. Order confirmation email.',
      outOfScope: 'Logged-in checkout; admin order management.',
      objectives: 'Confirm a guest can always complete a purchase or receives an actionable error.',
      risks: 'Lost cart on refresh\nDuplicate charges on retry\nInternational address formats rejected',
      testIdeas: ['Refresh on every step', 'Use an address with diacritics and a 10-line street', 'Decline then approve the same card', 'Back button after payment'],
      heuristics: ['Interruptions', 'Goldilocks', 'Never and Always'],
      priority: 'HIGH',
      riskLevel: 'HIGH',
      milestoneId: r24.id,
      assignees: [tester.id, sam.id],
      tags: ['checkout', 'payments'],
      reqs: ['SF-101'],
      timebox: 90,
      area: 'Checkout',
      daysAgo: 18,
      exitCriteria: 'Every payment outcome observed at least once; open questions logged.',
    },
    {
      key: 'discount',
      title: 'Discount codes – stacking and edge cases',
      mission: 'Explore discount code entry using expired, stacked, case-varied and boundary-value codes to discover pricing errors.',
      target: 'Checkout',
      template: 'Data validation',
      scope: 'Promo code field in cart and checkout; totals, taxes and shipping recalculation.',
      outOfScope: 'Marketing admin for creating codes.',
      risks: 'Negative totals\nCodes applied twice\nTax computed before discount',
      testIdeas: ['Apply the same code twice quickly', 'Lower-case vs upper-case', 'Code that expires during checkout', 'Remove item after applying a threshold code'],
      priority: 'HIGH',
      riskLevel: 'CRITICAL',
      milestoneId: r24.id,
      assignees: [sam.id],
      tags: ['checkout', 'payments'],
      reqs: ['SF-102'],
      timebox: 60,
      area: 'Checkout',
      daysAgo: 16,
    },
    {
      key: 'a11y',
      title: 'Checkout accessibility (keyboard and screen reader)',
      mission: 'Explore the checkout flow using only a keyboard and VoiceOver to discover barriers for assistive-technology users.',
      target: 'Checkout',
      template: 'Accessibility',
      scope: 'All checkout steps, error messages, focus management in dialogs.',
      risks: 'Focus lost after validation errors\nUnlabelled payment fields (iframe)',
      priority: 'HIGH',
      riskLevel: 'HIGH',
      milestoneId: r24.id,
      assignees: [tester.id],
      tags: ['checkout', 'a11y'],
      reqs: ['SF-120'],
      timebox: 60,
      area: 'Checkout',
      daysAgo: 12,
    },
    {
      key: 'saved-cards',
      title: 'Saved payment methods – permissions and lifecycle',
      mission: 'Explore saved payment methods using multiple accounts and direct URL access to discover data exposure and lifecycle bugs.',
      target: 'Account',
      template: 'Authentication and authorization',
      scope: 'Add, set default, delete and use saved cards; account switching.',
      risks: 'Another user’s card visible by id\nDeleted card still charged',
      priority: 'CRITICAL',
      riskLevel: 'CRITICAL',
      milestoneId: r24.id,
      assignees: [lead.id],
      tags: ['payments', 'security'],
      reqs: ['SF-103'],
      timebox: 60,
      area: 'Account',
      daysAgo: 10,
    },
    {
      key: 'mobile-cart',
      title: 'Cart on small screens',
      mission: 'Explore the cart on iPhone-sized viewports using rotation and touch gestures to discover layout and interaction problems.',
      target: 'Cart',
      template: 'Responsive layouts',
      priority: 'MEDIUM',
      riskLevel: 'MEDIUM',
      milestoneId: r24.id,
      assignees: [sam.id],
      tags: ['mobile'],
      timebox: 45,
      area: 'Cart',
      daysAgo: 8,
    },
    {
      key: 'search',
      title: 'Search filters and relevance',
      mission: 'Explore product search using combined filters, typos and empty results to discover relevance and state-handling issues.',
      target: 'Search',
      template: 'New feature exploration',
      priority: 'MEDIUM',
      riskLevel: 'MEDIUM',
      milestoneId: r25.id,
      assignees: [tester.id],
      tags: ['search'],
      reqs: ['SF-110'],
      timebox: 60,
      area: 'Search',
      daysAgo: 5,
      status: 'READY',
    },
    {
      key: 'reviews',
      title: 'Product reviews regression',
      mission: 'Explore product reviews after the 2.3 release using previously reported defects to discover regressions.',
      target: 'Catalog',
      template: 'Regression exploration',
      priority: 'LOW',
      riskLevel: 'LOW',
      milestoneId: r23.id,
      assignees: [sam.id],
      tags: ['regression'],
      timebox: 45,
      area: 'Catalog',
      daysAgo: 35,
    },
    {
      key: 'order-history',
      title: 'Order history and re-order (draft)',
      mission: 'Explore order history using accounts with many and zero orders to discover pagination and re-order problems.',
      target: 'Account',
      priority: 'LOW',
      riskLevel: 'MEDIUM',
      milestoneId: r25.id,
      assignees: [],
      tags: [],
      reqs: ['SF-130'],
      status: 'DRAFT',
      daysAgo: 2,
    },
  ];
  const charters: Record<string, { id: string; mission: string; timebox: number; milestoneId: string | null; title: string }> = {};
  for (const c of charterSeeds) {
    const created = await prisma.charter.create({
      data: {
        projectId: shop.id,
        number: ++seq.charter,
        title: c.title,
        mission: c.mission,
        target: c.target,
        scope: c.scope,
        outOfScope: c.outOfScope,
        objectives: c.objectives,
        risks: c.risks,
        testIdeas: c.testIdeas ?? [],
        heuristics: c.heuristics ?? [],
        exitCriteria: c.exitCriteria,
        priority: c.priority,
        riskLevel: c.riskLevel,
        timeboxMinutes: c.timebox ?? 60,
        estimatedMinutes: c.timebox ? c.timebox * 2 : null,
        status: c.status ?? 'READY',
        milestoneId: c.milestoneId ?? null,
        templateId: c.template ? await tpl(c.template) : null,
        environmentId: c.key === 'mobile-cart' ? qaMobile.id : staging.id,
        customFields: c.area ? { feature_area: c.area } : {},
        createdById: lead.id,
        createdAt: ago(c.daysAgo * DAY),
        updatedAt: ago(Math.max(0, c.daysAgo - 1) * DAY),
        assignees: { create: c.assignees.map((userId) => ({ userId })) },
        tags: { create: c.tags.map((t) => ({ tagId: tags[t] })) },
        requirements: { create: (c.reqs ?? []).map((k) => ({ requirementId: reqs[k] })) },
      },
    });
    charters[c.key] = { id: created.id, mission: c.mission, timebox: c.timebox ?? 60, milestoneId: c.milestoneId ?? null, title: c.title };
    await prisma.auditEvent.create({ data: { orgId: org.id, projectId: shop.id, actorId: lead.id, entityType: 'charter', entityId: created.id, action: 'created', changes: { title: c.title }, createdAt: ago(c.daysAgo * DAY) } });
  }

  // ---------- Sessions with chronological logs and findings ----------
  interface FindingSeed {
    title: string;
    cls: string;
    severity?: Severity;
    priority?: Priority;
    status?: FindingStatus;
    description?: string;
    repro?: string;
    expected?: string;
    actual?: string;
    owner?: string;
    req?: string;
    tags?: string[];
    issue?: { title?: string; status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'; assignee?: string };
    screenshot?: [number, number, number];
    impact?: string;
  }
  type Ev = { at: number; note?: string; finding?: FindingSeed; pause?: number };
  interface SessionSeed {
    charter: string;
    title?: string;
    tester: string | null;
    status: SessionStatus;
    startDaysAgo: number;
    minutes: number;
    events: Ev[];
    notes?: string;
    summary?: string;
    tbs?: [number, number, number, number];
    reviewer?: string;
    reviewComment?: string;
    env?: string;
    browser?: string;
    build?: string;
    tags?: string[];
    dueInDays?: number;
  }

  const issueIds: string[] = [];
  const findingIds: Record<string, string> = {};

  async function createSession(s: SessionSeed) {
    const ch = charters[s.charter];
    const number = ++seq.session;
    const live = s.status === 'IN_PROGRESS';
    const started = s.status === 'DRAFT' ? null : live ? new Date(NOW - s.minutes * MIN) : ago(s.startDaysAgo * DAY);
    const totalPause = s.events.reduce((a, e) => a + (e.pause ?? 0), 0);
    const ended = started && ['COMPLETED', 'IN_REVIEW', 'APPROVED', 'ABANDONED', 'CHANGES_REQUESTED'].includes(s.status) ? new Date(started.getTime() + (s.minutes + totalPause) * MIN) : null;
    const session = await prisma.exploratorySession.create({
      data: {
        projectId: shop.id,
        charterId: ch.id,
        number,
        title: s.title ?? `${ch.title} #${number}`,
        status: s.status,
        testerId: s.tester,
        createdById: lead.id,
        milestoneId: ch.milestoneId,
        environmentId: s.env === 'mobile' ? qaMobile.id : staging.id,
        browser: s.browser ?? (s.env === 'mobile' ? 'Safari 17' : 'Chrome 126'),
        os: s.env === 'mobile' ? 'iOS 17' : 'Windows 11',
        device: s.env === 'mobile' ? 'iPhone 15' : 'Desktop',
        buildVersion: s.build ?? '2.4.0-rc.3',
        timeboxMinutes: ch.timebox,
        dueDate: s.dueInDays !== undefined ? new Date(NOW + s.dueInDays * DAY) : null,
        priority: 'MEDIUM',
        elapsedSeconds: live ? 0 : s.status === 'DRAFT' ? 0 : s.minutes * 60,
        lastResumedAt: live ? new Date(NOW - s.minutes * MIN) : null,
        startedAt: started,
        endedAt: ended,
        notes: s.notes ?? '',
        notesUpdatedAt: s.notes && started ? new Date(Math.min(NOW, started.getTime() + s.minutes * MIN)) : null,
        summary: s.summary,
        setupPercent: s.tbs?.[0],
        testPercent: s.tbs?.[1],
        bugPercent: s.tbs?.[2],
        charterVsOpportunity: s.tbs?.[3],
        reviewerId: s.reviewer,
        reviewedAt: s.reviewer && ended ? new Date(ended.getTime() + 3 * 3600_000) : null,
        reviewComment: s.reviewComment,
        customFields: { build_link: 'https://ci.example/shopfront/builds/2418' },
        createdAt: started ? new Date(started.getTime() - 30 * MIN) : ago(s.startDaysAgo * DAY),
        tags: { create: (s.tags ?? []).map((t) => ({ tagId: tags[t] })) },
      },
    });
    if (!started) return session;
    const log = (type: 'NOTE' | 'FINDING' | 'STATUS_CHANGE' | 'ATTACHMENT' | 'SYSTEM', content: string, at: number, wall: Date, extra: Partial<Prisma.SessionLogEntryUncheckedCreateInput> = {}) =>
      prisma.sessionLogEntry.create({ data: { sessionId: session.id, authorId: s.tester, type, content, elapsedSeconds: at, createdAt: wall, ...extra } });
    await log('STATUS_CHANGE', 'Session started', 0, started, { metadata: { from: 'DRAFT', to: 'IN_PROGRESS' } });
    let pauseOffset = 0;
    for (const e of s.events) {
      const wall = new Date(started.getTime() + (e.at + pauseOffset) * MIN);
      if (wall.getTime() > NOW) break;
      if (e.note) await log('NOTE', e.note, e.at * 60, wall);
      if (e.finding) {
        const f = e.finding;
        const fNumber = ++seq.finding;
        const finding = await prisma.finding.create({
          data: {
            projectId: shop.id,
            number: fNumber,
            sessionId: session.id,
            charterId: ch.id,
            classificationId: cls[f.cls],
            title: f.title,
            description: f.description,
            severity: f.severity ?? 'MINOR',
            priority: f.priority ?? 'MEDIUM',
            status: f.status ?? 'NEW',
            reproSteps: f.repro,
            expected: f.expected,
            actual: f.actual,
            environment: `${s.env === 'mobile' ? 'QA – Mobile · Safari 17 · iOS 17' : 'Staging · Chrome 126 · Windows 11'} · build 2.4.0-rc.3`,
            sessionElapsedSeconds: e.at * 60,
            authorId: s.tester!,
            ownerId: f.owner ?? null,
            requirementId: f.req ? reqs[f.req] : null,
            customFields: f.impact ? { customer_impact: f.impact } : {},
            createdAt: wall,
            updatedAt: wall,
            tags: { create: (f.tags ?? []).map((t) => ({ tagId: tags[t] })) },
          },
        });
        findingIds[f.title] = finding.id;
        await log('FINDING', f.title, e.at * 60, wall, { findingId: finding.id, metadata: { classification: f.cls, severity: f.severity ?? 'MINOR' } });
        if (f.screenshot) {
          const data = mockScreenshot(f.screenshot);
          const key = newStorageKey();
          await storage.put(key, data);
          const att = await prisma.attachment.create({
            data: { projectId: shop.id, uploaderId: s.tester, fileName: `screenshot-F-${fNumber}.png`, storageKey: key, mimeType: 'image/png', size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), sessionId: session.id, findingId: finding.id, createdAt: wall },
          });
          await log('ATTACHMENT', `screenshot-F-${fNumber}.png`, e.at * 60, wall, { attachmentId: att.id });
        }
        if (f.issue) {
          const issue = await prisma.issue.create({
            data: {
              projectId: shop.id,
              number: ++seq.issue,
              title: f.issue.title ?? f.title,
              description: [f.description, f.actual ? `Actual: ${f.actual}` : '', f.expected ? `Expected: ${f.expected}` : ''].filter(Boolean).join('\n\n'),
              status: f.issue.status ?? 'OPEN',
              severity: f.severity ?? 'MAJOR',
              priority: f.priority ?? 'MEDIUM',
              reporterId: s.tester!,
              assigneeId: f.issue.assignee ?? null,
              milestoneId: ch.milestoneId,
              sourceFindingId: finding.id,
              resolvedAt: f.issue.status === 'RESOLVED' || f.issue.status === 'CLOSED' ? new Date(wall.getTime() + 2 * DAY) : null,
              createdAt: new Date(wall.getTime() + 2 * 3600_000),
            },
          });
          issueIds.push(issue.id);
          await prisma.finding.update({ where: { id: finding.id }, data: { issueId: issue.id, status: f.status ?? 'CONVERTED' } });
        }
      }
      if (e.pause) {
        await log('STATUS_CHANGE', 'Session paused', e.at * 60, wall, { metadata: { from: 'IN_PROGRESS', to: 'PAUSED' } });
        pauseOffset += e.pause;
        const resumed = new Date(started.getTime() + (e.at + pauseOffset) * MIN);
        if (resumed.getTime() < NOW) await log('STATUS_CHANGE', 'Session resumed', e.at * 60, resumed, { metadata: { from: 'PAUSED', to: 'IN_PROGRESS' } });
      }
    }
    if (ended) {
      const label = s.status === 'ABANDONED' ? 'Session abandoned' : s.status === 'COMPLETED' ? 'Session completed' : 'Session finished and submitted for review';
      await log('STATUS_CHANGE', label, s.minutes * 60, ended, { metadata: { to: s.status === 'ABANDONED' ? 'ABANDONED' : s.status === 'COMPLETED' ? 'COMPLETED' : 'IN_REVIEW' } });
      if (s.status === 'APPROVED' || s.status === 'CHANGES_REQUESTED') {
        await log('STATUS_CHANGE', s.status === 'APPROVED' ? `Session approved${s.reviewComment ? `: ${s.reviewComment}` : ''}` : `Changes requested: ${s.reviewComment ?? ''}`, s.minutes * 60, new Date(ended.getTime() + 3 * 3600_000), {
          authorId: s.reviewer,
          metadata: { from: 'IN_REVIEW', to: s.status },
        });
      }
    }
    return session;
  }

  const p = (...lines: string[]) => lines.map((l) => (l.startsWith('- ') ? `<ul><li>${l.slice(2)}</li></ul>` : `<p>${l}</p>`)).join('');

  await createSession({
    charter: 'reviews',
    tester: sam.id,
    status: 'APPROVED',
    startDaysAgo: 30,
    minutes: 42,
    reviewer: lead.id,
    reviewComment: 'Good coverage of previous defects.',
    tbs: [10, 80, 10, 90],
    tags: ['regression'],
    build: '2.3.0',
    summary: '<p>No regressions found in review submission and moderation. One minor sorting inconsistency logged as an observation.</p>',
    notes: p('Checked the five defects fixed in 2.3 — all still fixed.', '- Star rating keyboard input works', '- Long reviews truncate correctly'),
    events: [
      { at: 4, note: 'Re-tested REV-12 (rating not saved on slow network) with 3G throttling — fixed.' },
      { at: 15, finding: { title: 'Review sort “Most helpful” ties are ordered randomly', cls: 'observation', severity: 'TRIVIAL', status: 'TRIAGED', description: 'Reviews with the same helpful count change order on each reload.' } },
      { at: 33, note: 'Moderation queue and profanity filter behave as before.' },
    ],
  });

  await createSession({
    charter: 'guest',
    tester: tester.id,
    status: 'APPROVED',
    startDaysAgo: 14,
    minutes: 84,
    reviewer: lead.id,
    reviewComment: 'Great evidence. Please follow up on the address question with product.',
    tbs: [15, 55, 30, 80],
    tags: ['checkout'],
    summary: '<p>Guest checkout works for the main card flows. Two serious defects: double charge after retrying a declined card, and cart loss after refresh on the payment step. Address validation rejects some international formats.</p>',
    notes: p(
      '<strong>Setup:</strong> staging with test cards 4000 0000 0000 0002 (decline) and 4242… (success).',
      'Explored all steps with refreshes, back button and slow network.',
      '- Shipping step: address autocomplete OK for US/UK',
      '- Payment step: retry after decline is risky',
      '<em>Open question:</em> should guests receive an account-creation prompt after purchase?',
    ),
    events: [
      { at: 6, note: 'Happy path with a 3-item cart completed in 2m10s. Confirmation email received.' },
      {
        at: 18,
        finding: {
          title: 'Refreshing the payment step empties the guest cart',
          cls: 'confirmed_defect',
          severity: 'CRITICAL',
          priority: 'HIGH',
          description: 'A browser refresh on the payment step returns the guest to an empty cart.',
          repro: '1. As a guest, add 2 items to the cart\n2. Proceed to the payment step\n3. Press F5',
          expected: 'Payment step reloads with the cart and shipping details intact.',
          actual: 'User is redirected to /cart which shows “Your cart is empty”.',
          req: 'SF-101',
          tags: ['checkout'],
          screenshot: [12, 166, 120],
          impact: 'High',
          issue: { status: 'IN_PROGRESS', assignee: lead.id },
        },
      },
      { at: 30, note: 'Tried decline → approve with the same card.' },
      {
        at: 33,
        finding: {
          title: 'Retrying after a declined card charges the customer twice',
          cls: 'confirmed_defect',
          severity: 'BLOCKER',
          priority: 'CRITICAL',
          description: 'Two successful authorizations appear in the payment provider dashboard after a decline + retry.',
          repro: '1. Checkout as guest\n2. Pay with the decline test card\n3. Change to the success card and press Pay twice quickly',
          expected: 'Exactly one authorization; the Pay button is disabled while processing.',
          actual: 'Two authorizations of $84.97; two order confirmation emails.',
          req: 'SF-101',
          tags: ['payments'],
          screenshot: [220, 38, 38],
          impact: 'High',
          issue: { status: 'OPEN', assignee: lead.id },
        },
        pause: 25,
      },
      { at: 45, finding: { title: 'Postal codes with spaces rejected for Canada', cls: 'potential_defect', severity: 'MAJOR', description: 'Postal code “K1A 0B1” is rejected; “K1A0B1” is accepted.', expected: 'Both formats accepted.', actual: 'Inline error “Invalid postal code”.', req: 'SF-101', owner: tester.id } },
      { at: 58, finding: { title: 'Should guests be prompted to create an account after purchase?', cls: 'question', owner: lead.id, description: 'Spec is silent. Competitor sites offer one-click account creation on the confirmation page.' } },
      { at: 71, finding: { title: 'Payment provider timeouts are not handled', cls: 'risk', severity: 'MAJOR', description: 'No visible handling when the provider takes >30s; spinner never ends. Needs a dedicated session with network faults.' } },
      { at: 80, note: 'Exit criteria met: all payment outcomes observed (success, decline, 3DS challenge).' },
    ],
  });

  await createSession({
    charter: 'discount',
    tester: sam.id,
    status: 'IN_REVIEW',
    startDaysAgo: 6,
    minutes: 55,
    tbs: [10, 60, 30, 70],
    tags: ['checkout', 'payments'],
    summary: '<p>Found a pricing defect where removing items keeps a threshold discount, and stacking two codes is possible via a double submit.</p>',
    notes: p('Codes used: SAVE10, FREESHIP, WELCOME20 (expired), BIG50 (min $100).', '- Case-insensitive matching works', '- Expiry is evaluated only on apply, not at payment'),
    events: [
      { at: 8, note: 'Upper/lower case codes accepted. Whitespace trimmed.' },
      {
        at: 20,
        finding: {
          title: 'Threshold discount persists after cart drops below minimum',
          cls: 'confirmed_defect',
          severity: 'MAJOR',
          priority: 'HIGH',
          repro: '1. Add items totalling $120\n2. Apply BIG50 (min $100)\n3. Remove items until total is $60',
          expected: 'BIG50 is removed with a message explaining the minimum.',
          actual: 'BIG50 stays applied; total becomes $10.',
          req: 'SF-102',
          tags: ['payments'],
          impact: 'Medium',
          issue: { status: 'OPEN', assignee: sam.id },
        },
      },
      { at: 34, finding: { title: 'Two codes can be stacked by double-clicking Apply', cls: 'potential_defect', severity: 'MAJOR', priority: 'HIGH', repro: '1. Enter SAVE10\n2. Double-click Apply, then quickly enter FREESHIP and Apply', expected: 'Only one code per order.', actual: 'Both codes shown in the summary.', req: 'SF-102' } },
      { at: 47, finding: { title: 'Expired-code error message is vague', cls: 'observation', severity: 'MINOR', description: 'Message “Code invalid” does not explain that the code expired.' } },
    ],
  });

  await createSession({
    charter: 'a11y',
    tester: tester.id,
    status: 'CHANGES_REQUESTED',
    startDaysAgo: 4,
    minutes: 50,
    reviewer: lead.id,
    reviewComment: 'Please also cover the 3DS challenge dialog with VoiceOver before we approve.',
    tbs: [20, 60, 20, 100],
    tags: ['a11y'],
    summary: '<p>Keyboard-only checkout is possible but focus is lost after validation errors. Card fields lack accessible names.</p>',
    notes: p('Used VoiceOver on macOS 14 + Safari, and keyboard only in Chrome.'),
    events: [
      { at: 10, finding: { title: 'Focus moves to page top after a validation error', cls: 'confirmed_defect', severity: 'MAJOR', req: 'SF-120', tags: ['a11y'], expected: 'Focus moves to the first invalid field and the error is announced.', actual: 'Focus jumps to <body>; screen reader announces nothing.', issue: { status: 'OPEN' } } },
      { at: 26, finding: { title: 'Card number iframe has no accessible name', cls: 'potential_defect', severity: 'MAJOR', req: 'SF-120', tags: ['a11y'], description: 'VoiceOver reads “frame”. May be a provider limitation; need to check the SDK option.' } },
      { at: 41, note: 'Colour contrast of the disabled Pay button is 2.1:1.' },
      { at: 42, finding: { title: 'Disabled Pay button contrast below 3:1', cls: 'observation', severity: 'MINOR', tags: ['a11y'] } },
    ],
  });

  await createSession({
    charter: 'saved-cards',
    tester: lead.id,
    status: 'COMPLETED',
    startDaysAgo: 3,
    minutes: 38,
    tbs: [25, 65, 10, 100],
    tags: ['security'],
    summary: '<p>No data exposure found via direct object references. Deleting the default card leaves no default selected (minor).</p>',
    events: [
      { at: 9, note: 'Changed /account/cards/{id} to ids of another account → 404. Good.' },
      { at: 17, note: 'API GET /api/cards?userId= ignores the parameter and uses the session. Good.' },
      { at: 28, finding: { title: 'Deleting the default card leaves no default selected', cls: 'potential_defect', severity: 'MINOR', req: 'SF-103', expected: 'Next most recent card becomes default.', actual: 'No default; checkout requires manual selection.' } },
    ],
  });

  await createSession({
    charter: 'mobile-cart',
    tester: sam.id,
    status: 'PAUSED',
    startDaysAgo: 1,
    minutes: 22,
    env: 'mobile',
    tags: ['mobile'],
    dueInDays: 2,
    notes: p('Testing on iPhone 15 (Safari).', '- Portrait layout fine', '- Landscape: quantity stepper overlaps the price'),
    events: [
      { at: 7, finding: { title: 'Quantity stepper overlaps price in landscape', cls: 'potential_defect', severity: 'MINOR', tags: ['mobile'], screenshot: [28, 126, 214] } },
      { at: 15, note: 'Swipe-to-delete not supported; uses a trash icon. Fine.' },
    ],
  });

  await createSession({
    charter: 'guest',
    title: 'Guest checkout – network faults',
    tester: tester.id,
    status: 'IN_PROGRESS',
    startDaysAgo: 0,
    minutes: 24,
    tags: ['checkout'],
    notes: p('Follow-up to the payment provider timeout risk. Using Chrome DevTools offline/slow-3G toggles.'),
    events: [
      { at: 5, note: 'Offline during “Place order” → generic error toast, cart preserved.' },
      { at: 14, finding: { title: 'Spinner never stops when the payment request times out', cls: 'potential_defect', severity: 'MAJOR', priority: 'HIGH', expected: 'Timeout message with a safe retry option.', actual: 'Spinner keeps running after 2 minutes; no message.' } },
    ],
  });

  await createSession({ charter: 'search', tester: tester.id, status: 'DRAFT', startDaysAgo: 0, minutes: 0, events: [], dueInDays: 12 });
  await createSession({
    charter: 'discount',
    tester: sam.id,
    title: 'Discount codes – mobile quick check',
    status: 'ABANDONED',
    startDaysAgo: 2,
    minutes: 8,
    env: 'mobile',
    events: [{ at: 6, note: 'Staging mobile build broken (blank page after login). Abandoning; will retry on next build.' }],
  });

  // ---------- Comments with mentions and notifications ----------
  const dblCharge = findingIds['Retrying after a declined card charges the customer twice'];
  const c1 = await prisma.comment.create({ data: { projectId: shop.id, authorId: lead.id, findingId: dblCharge, body: '@Tara Okafor great catch. I reproduced it with Apple Pay as well. Payments team is on it.', createdAt: ago(13 * DAY) } });
  await prisma.mention.create({ data: { commentId: c1.id, userId: tester.id } });
  await prisma.comment.create({ data: { projectId: shop.id, authorId: viewer.id, findingId: dblCharge, body: 'This is a release blocker for 2.4 from the product side.', createdAt: ago(12 * DAY) } });
  await prisma.notification.createMany({
    data: [
      { userId: tester.id, actorId: lead.id, projectId: shop.id, type: 'MENTION', title: 'Liam Chen mentioned you on F-3', body: 'great catch. I reproduced it with Apple Pay as well.', link: `/projects/${shop.id}/findings/${dblCharge}`, createdAt: ago(13 * DAY) },
      { userId: tester.id, actorId: lead.id, projectId: shop.id, type: 'REVIEW_DECISION', title: 'Changes requested on “Checkout accessibility” session', body: 'Please also cover the 3DS challenge dialog with VoiceOver before we approve.', link: `/projects/${shop.id}/sessions`, createdAt: ago(4 * DAY) },
      { userId: lead.id, actorId: sam.id, projectId: shop.id, type: 'REVIEW_REQUESTED', title: 'Sam Patel submitted a session for review', body: 'Discount codes – stacking and edge cases', link: `/projects/${shop.id}/sessions`, createdAt: ago(6 * DAY) },
      { userId: sam.id, actorId: lead.id, projectId: shop.id, type: 'ASSIGNMENT', title: 'You were assigned to “Cart on small screens”', link: `/projects/${shop.id}/charters/${charters['mobile-cart'].id}`, createdAt: ago(8 * DAY) },
    ],
  });

  // ---------- Manual test cases, plan and runs ----------
  const general = await prisma.testFolder.findFirstOrThrow({ where: { projectId: shop.id, name: 'General' } });
  const fCheckout = await prisma.testFolder.create({ data: { projectId: shop.id, name: 'Checkout', position: 1 } });
  const fPayments = await prisma.testFolder.create({ data: { projectId: shop.id, parentId: fCheckout.id, name: 'Payments', position: 0 } });
  const fSearch = await prisma.testFolder.create({ data: { projectId: shop.id, name: 'Search', position: 2 } });
  const fAccount = await prisma.testFolder.create({ data: { projectId: shop.id, name: 'Account', position: 3 } });

  interface CaseSeed {
    title: string;
    folder: string;
    priority: Priority;
    pre?: string;
    steps?: [string, string][];
    gherkin?: string;
    req?: string;
    tags?: string[];
    fromFinding?: string;
    automationKey?: string;
  }
  const caseSeeds: CaseSeed[] = [
    { title: 'Guest can complete checkout with a valid card', folder: fCheckout.id, priority: 'CRITICAL', pre: 'Product catalog has in-stock items.', steps: [['Add two items to the cart as a guest', 'Cart shows 2 items and correct subtotal'], ['Proceed to checkout and enter a valid US address', 'Shipping options are displayed'], ['Pay with test card 4242 4242 4242 4242', 'Order confirmation page with order number'], ['Check the confirmation email', 'Email received with matching totals']], req: 'SF-101', tags: ['checkout'], automationKey: 'checkout/guest.spec.ts::Guest checkout::completes with valid card' },
    { title: 'Guest cart survives refresh on the payment step', folder: fCheckout.id, priority: 'HIGH', steps: [['Add an item and proceed to the payment step as a guest', 'Payment form is shown'], ['Refresh the page', 'Payment step reloads with cart and address intact']], req: 'SF-101', tags: ['checkout', 'regression'], fromFinding: 'Refreshing the payment step empties the guest cart' },
    { title: 'Declined card followed by retry charges once', folder: fPayments.id, priority: 'CRITICAL', steps: [['Pay with decline test card', 'Decline message shown, Pay button enabled'], ['Pay with a valid card and click Pay twice quickly', 'Button disables after first click'], ['Check payment provider dashboard', 'Exactly one authorization']], req: 'SF-101', tags: ['payments', 'regression'], fromFinding: 'Retrying after a declined card charges the customer twice' },
    { title: 'Apply a valid discount code', folder: fPayments.id, priority: 'HIGH', gherkin: 'Feature: Discount codes\n  Scenario: Apply a valid code\n    Given a cart totalling $120\n    When I apply the code "SAVE10"\n    Then the order total is reduced by 10%\n    And the code is shown in the order summary', req: 'SF-102', tags: ['payments'] },
    { title: 'Threshold code is removed when cart drops below minimum', folder: fPayments.id, priority: 'HIGH', steps: [['Apply BIG50 with a $120 cart', 'Discount applied'], ['Remove items until the total is below $100', 'BIG50 removed with an explanatory message']], req: 'SF-102', tags: ['payments'] },
    { title: 'Saved card can be set as default', folder: fAccount.id, priority: 'MEDIUM', steps: [['Add two cards in Account → Payment methods', 'Both cards listed'], ['Set the second card as default', 'Default badge moves; used at checkout']], req: 'SF-103' },
    { title: 'Saved cards are not visible to other accounts', folder: fAccount.id, priority: 'CRITICAL', steps: [['Note the id of a saved card for user A', ''], ['Sign in as user B and open /account/cards/{id}', '404 page; no card data shown']], req: 'SF-103', tags: ['security'] },
    { title: 'Checkout is fully operable with keyboard only', folder: fCheckout.id, priority: 'HIGH', steps: [['Complete checkout using Tab/Shift+Tab/Enter/Space only', 'Every control reachable with visible focus'], ['Submit the address form with an error', 'Focus moves to first invalid field']], req: 'SF-120', tags: ['a11y'] },
    { title: 'Search filters combine correctly', folder: fSearch.id, priority: 'MEDIUM', steps: [['Search “headphones”', 'Results shown'], ['Filter by brand and price $50–$100', 'Only matching items; count updates'], ['Clear one filter', 'Results expand accordingly']], req: 'SF-110', tags: ['search'] },
    { title: 'Search with no results shows suggestions', folder: fSearch.id, priority: 'LOW', steps: [['Search “zzqqxx”', 'Empty state with suggestions and a link to all products']], tags: ['search'] },
    { title: 'Order history paginates beyond 20 orders', folder: fAccount.id, priority: 'LOW', steps: [['Sign in as a user with 45 orders', 'First 20 orders shown'], ['Go to page 3', 'Orders 41–45 shown']], req: 'SF-130' },
    { title: 'Product page smoke check', folder: general.id, priority: 'MEDIUM', steps: [['Open any product page', 'Images, price, stock and Add to cart visible']] },
  ];
  const cases: string[] = [];
  for (const c of caseSeeds) {
    const tc = await prisma.testCase.create({
      data: {
        projectId: shop.id,
        number: ++seq.testCase,
        folderId: c.folder,
        title: c.title,
        preconditions: c.pre,
        format: c.gherkin ? 'GHERKIN' : 'STEPS',
        gherkin: c.gherkin,
        priority: c.priority,
        type: c.tags?.includes('security') ? 'Security' : c.tags?.includes('a11y') ? 'Accessibility' : 'Functional',
        estimateMinutes: 5 + (c.steps?.length ?? 2) * 2,
        automationKey: c.automationKey,
        sourceFindingId: c.fromFinding ? findingIds[c.fromFinding] : null,
        createdById: c.fromFinding ? tester.id : lead.id,
        createdAt: ago(20 * DAY),
        steps: { create: (c.steps ?? []).map(([action, expected], i) => ({ position: i, action, expected: expected || null })) },
        tags: { create: (c.tags ?? []).map((t) => ({ tagId: tags[t] })) },
        requirements: c.req ? { create: [{ requirementId: reqs[c.req] }] } : undefined,
      },
    });
    await prisma.testCaseRevision.create({ data: { testCaseId: tc.id, version: 1, authorId: tc.createdById, snapshot: { title: c.title, steps: c.steps ?? [], gherkin: c.gherkin ?? null }, createdAt: ago(20 * DAY) } });
    cases.push(tc.id);
  }

  const plan = await prisma.testPlan.create({ data: { projectId: shop.id, name: 'Release 2.4 regression', description: 'Manual regression for checkout, payments and accounts.', milestoneId: r24.id } });
  async function createRun(name: string, caseIdx: number[], results: (string | null)[], opts: { closed?: boolean; daysAgo: number; assignee: string }) {
    const run = await prisma.testRun.create({
      data: { projectId: shop.id, number: ++seq.testRun, name, planId: plan.id, milestoneId: r24.id, environmentId: staging.id, createdById: lead.id, status: opts.closed ? 'CLOSED' : 'ACTIVE', closedAt: opts.closed ? ago((opts.daysAgo - 2) * DAY) : null, createdAt: ago(opts.daysAgo * DAY) },
    });
    for (let i = 0; i < caseIdx.length; i++) {
      const key = results[i];
      const item = await prisma.testRunItem.create({ data: { runId: run.id, testCaseId: cases[caseIdx[i]], position: i, assigneeId: i % 2 ? sam.id : opts.assignee, statusId: key ? st[key].id : null } });
      if (key) {
        const failIssue = key === 'failed' && i === 1 ? issueIds[0] : key === 'failed' && i === 2 ? issueIds[1] : null;
        await prisma.testResult.create({
          data: { runItemId: item.id, statusId: st[key].id, createdById: item.assigneeId ?? opts.assignee, elapsedSeconds: 180 + i * 40, comment: key === 'failed' ? 'Fails as described in linked issue.' : key === 'blocked' ? 'Blocked: staging payment sandbox down.' : null, issueId: failIssue, createdAt: ago((opts.daysAgo - 1) * DAY + i * 600_000) },
        });
      }
    }
    return run;
  }
  await createRun('2.4 regression – cycle 1', [0, 1, 2, 3, 4, 5, 6, 7], ['passed', 'failed', 'failed', 'passed', 'failed', 'passed', 'passed', 'blocked'], { closed: true, daysAgo: 9, assignee: tester.id });
  await createRun('2.4 regression – cycle 2', [0, 1, 2, 3, 4, 5, 6, 7, 8], ['passed', 'failed', 'failed', 'passed', null, 'passed', null, null, 'retest'], { daysAgo: 2, assignee: tester.id });

  // ---------- Automation runs (Playwright web e2e + JUnit API tests) ----------
  const pwSource = await prisma.automationSource.create({ data: { projectId: shop.id, name: 'web-e2e', framework: 'playwright', description: 'Playwright end-to-end suite (GitHub Actions)' } });
  const apiSource = await prisma.automationSource.create({ data: { projectId: shop.id, name: 'api-tests', framework: 'junit', description: 'Jest API contract tests (JUnit XML)' } });
  const pwTests = [
    ['checkout/guest.spec.ts', 'Guest checkout', 'completes with valid card'],
    ['checkout/guest.spec.ts', 'Guest checkout', 'shows decline message'],
    ['checkout/guest.spec.ts', 'Guest checkout', 'keeps cart after refresh'],
    ['checkout/discount.spec.ts', 'Discounts', 'applies SAVE10'],
    ['checkout/discount.spec.ts', 'Discounts', 'rejects expired code'],
    ['checkout/discount.spec.ts', 'Discounts', 'removes threshold code below minimum'],
    ['search/filters.spec.ts', 'Search', 'filters by brand'],
    ['search/filters.spec.ts', 'Search', 'filters by price range'],
    ['search/filters.spec.ts', 'Search', 'empty state suggestions'],
    ['account/cards.spec.ts', 'Saved cards', 'adds a card'],
    ['account/cards.spec.ts', 'Saved cards', 'sets default card'],
    ['account/login.spec.ts', 'Login', 'signs in with valid credentials'],
    ['account/login.spec.ts', 'Login', 'locks after 5 failed attempts'],
    ['catalog/product.spec.ts', 'Product page', 'renders gallery'],
    ['catalog/product.spec.ts', 'Product page', 'adds to cart'],
  ];
  const apiTests = [
    ['CartController', 'POST /cart adds item'],
    ['CartController', 'DELETE /cart/:id removes item'],
    ['OrdersController', 'POST /orders creates order'],
    ['OrdersController', 'POST /orders is idempotent with Idempotency-Key'],
    ['PromoController', 'POST /promo validates code'],
    ['PromoController', 'POST /promo rejects stacking'],
    ['CardsController', 'GET /cards scoped to user'],
    ['SearchController', 'GET /search paginates'],
  ];
  const testRows = new Map<string, string>();
  for (const [file, suite, name] of pwTests) {
    const key = `${file}::${suite}::${name}`;
    testRows.set(key, (await prisma.automationTest.create({ data: { projectId: shop.id, key, name, suite, file } })).id);
  }
  for (const [suite, name] of apiTests) {
    const key = `${suite}::${name}`;
    testRows.set(key, (await prisma.automationTest.create({ data: { projectId: shop.id, key, name, suite } })).id);
  }
  const rnd = (() => {
    let s = 42;
    return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  })();
  for (let d = 13; d >= 0; d--) {
    for (const src of [pwSource, apiSource]) {
      if (src === apiSource && d % 2) continue;
      const isPw = src === pwSource;
      const startedAt = new Date(NOW - d * DAY - 3 * 3600_000);
      const branch = d === 3 ? 'feature/promo-refactor' : 'main';
      const run = await prisma.automationRun.create({
        data: {
          projectId: shop.id,
          number: ++seq.automation,
          sourceId: src.id,
          name: `${src.name} · ${branch} #${1400 + seq.automation}`,
          framework: isPw ? 'playwright' : 'junit',
          status: 'COMPLETED',
          branch,
          commitSha: crypto.createHash('sha1').update(String(seq.automation)).digest('hex').slice(0, 12),
          buildNumber: String(1400 + seq.automation),
          ciProvider: 'github-actions',
          ciUrl: `https://github.com/example/shopfront/actions/runs/${9_000_000 + seq.automation}`,
          environment: 'staging',
          milestoneId: r24.id,
          startedAt,
          completedAt: new Date(startedAt.getTime() + (isPw ? 9 : 2) * MIN),
          durationMs: (isPw ? 9 : 2) * MIN,
        },
      });
      const keysList = isPw ? pwTests.map(([f, s, n]) => `${f}::${s}::${n}`) : apiTests.map(([s, n]) => `${s}::${n}`);
      let passed = 0;
      let failed = 0;
      let skipped = 0;
      for (const key of keysList) {
        let status = 'passed';
        let retries = 0;
        let message: string | null = null;
        let stack: string | null = null;
        if (key.includes('keeps cart after refresh')) {
          status = d <= 9 ? 'failed' : 'passed'; // regression introduced 9 days ago (matches F-2)
        } else if (key.includes('filters by price range')) {
          const r = rnd();
          status = r < 0.3 ? 'failed' : r < 0.5 ? 'flaky' : 'passed'; // flaky test
          if (status === 'flaky') retries = 1;
        } else if (key.includes('rejects stacking')) {
          status = d <= 6 ? 'failed' : 'passed';
        } else if (key.includes('locks after 5 failed attempts')) {
          status = 'skipped';
        } else if (key.includes('removes threshold code') && d === 3) {
          status = 'failed';
        }
        if (status === 'failed') {
          message = key.includes('refresh')
            ? 'Error: expect(locator).toHaveCount(expected)\n\nLocator: getByTestId(\'cart-line\')\nExpected: 2\nReceived: 0'
            : key.includes('price range')
              ? 'TimeoutError: locator.click: Timeout 10000ms exceeded waiting for getByRole(\'slider\', { name: \'Max price\' })'
              : 'AssertionError: expected 200 to equal 409';
          stack = `    at ${key.split('::')[0]}:42:17\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;
        }
        const s = st[status];
        if (s.category === 'PASSED') passed++;
        else if (s.category === 'FAILED') failed++;
        else if (s.category === 'SKIPPED') skipped++;
        await prisma.automationResult.create({
          data: {
            runId: run.id,
            testId: testRows.get(key)!,
            statusId: s.id,
            category: s.category,
            rawStatus: status,
            durationMs: Math.round((isPw ? 4000 : 120) + rnd() * (isPw ? 9000 : 400)),
            message,
            stackTrace: stack,
            retries,
            artifacts: status === 'failed' && isPw ? [{ name: 'trace.zip', url: `https://ci.example/artifacts/${run.id}/trace.zip`, contentType: 'application/zip' }] : [],
            createdAt: startedAt,
          },
        });
      }
      await prisma.automationRun.update({ where: { id: run.id }, data: { totalCount: keysList.length, passedCount: passed, failedCount: failed, skippedCount: skipped } });
    }
  }

  // ---------- Integration example (disabled webhook) ----------
  await prisma.integration.create({
    data: { projectId: shop.id, provider: 'WEBHOOK', name: 'Team chat relay (example)', config: { url: 'https://example.com/hooks/explorix' }, events: ['finding.created', 'session.completed'], secretEncrypted: encryptSecret('demo-webhook-secret'), enabled: false },
  });

  await prisma.project.update({
    where: { id: shop.id },
    data: { charterSeq: seq.charter, sessionSeq: seq.session, findingSeq: seq.finding, issueSeq: seq.issue, testCaseSeq: seq.testCase, requirementSeq: seq.requirement, testRunSeq: seq.testRun, automationSeq: seq.automation },
  });

  // =====================================================================================
  // Project 2: Mobile Banking API (small, demonstrates project isolation)
  // =====================================================================================
  const bank = await prisma.project.create({
    data: { orgId: org.id, key: 'BANK', name: 'Mobile Banking API', description: 'Public REST API used by the mobile banking apps.', color: '#1c7ed6', createdAt: ago(30 * DAY) },
  });
  await prisma.$transaction((tx) => applyProjectDefaults(tx, bank.id));
  await prisma.projectMember.createMany({
    data: [
      { projectId: bank.id, userId: lead.id, role: 'LEAD' },
      { projectId: bank.id, userId: tester.id, role: 'TESTER' },
      { projectId: bank.id, userId: dana.id, role: 'TESTER' },
    ],
  });
  const bcls = Object.fromEntries((await prisma.findingClassification.findMany({ where: { projectId: bank.id } })).map((c) => [c.key, c.id]));
  const bm = await prisma.milestone.create({ data: { projectId: bank.id, name: 'API v3', status: 'ACTIVE', dueDate: new Date(NOW + 20 * DAY) } });
  const bc = await prisma.charter.create({
    data: {
      projectId: bank.id,
      number: 1,
      title: 'Transfers API – idempotency and limits',
      mission: 'Explore POST /v3/transfers using retries, concurrent requests and limit boundaries to discover duplicate or over-limit transfers.',
      target: 'Transfers API',
      templateId: await tpl('API exploration'),
      priority: 'CRITICAL',
      riskLevel: 'CRITICAL',
      milestoneId: bm.id,
      status: 'READY',
      createdById: lead.id,
      timeboxMinutes: 90,
      testIdeas: ['Replay the same Idempotency-Key with a different amount', 'Send 10 concurrent transfers at the daily limit', 'Negative and zero amounts', 'Currency precision (JPY vs USD)'],
      assignees: { create: [{ userId: dana.id }] },
    },
  });
  const bs = await prisma.exploratorySession.create({
    data: { projectId: bank.id, charterId: bc.id, number: 1, title: 'Transfers API – idempotency #1', status: 'COMPLETED', testerId: dana.id, createdById: lead.id, milestoneId: bm.id, timeboxMinutes: 90, elapsedSeconds: 75 * 60, startedAt: ago(5 * DAY), endedAt: new Date(NOW - 5 * DAY + 80 * MIN), summary: '<p>Idempotency works for identical payloads; a changed amount with the same key returns the original transfer silently.</p>', setupPercent: 20, testPercent: 60, bugPercent: 20, charterVsOpportunity: 90 },
  });
  await prisma.sessionLogEntry.create({ data: { sessionId: bs.id, authorId: dana.id, type: 'STATUS_CHANGE', content: 'Session started', createdAt: ago(5 * DAY) } });
  const bf = await prisma.finding.create({
    data: { projectId: bank.id, number: 1, sessionId: bs.id, charterId: bc.id, classificationId: bcls.potential_defect, title: 'Reused Idempotency-Key with different amount returns 200 with original transfer', severity: 'MAJOR', priority: 'HIGH', expected: '422 Unprocessable Entity explaining the key was used with a different payload.', actual: '200 OK with the original transfer body.', authorId: dana.id, sessionElapsedSeconds: 31 * 60, createdAt: new Date(NOW - 5 * DAY + 31 * MIN) },
  });
  await prisma.sessionLogEntry.create({ data: { sessionId: bs.id, authorId: dana.id, type: 'FINDING', content: bf.title, findingId: bf.id, elapsedSeconds: 31 * 60, createdAt: new Date(NOW - 5 * DAY + 31 * MIN) } });
  await prisma.sessionLogEntry.create({ data: { sessionId: bs.id, authorId: dana.id, type: 'STATUS_CHANGE', content: 'Session completed', elapsedSeconds: 75 * 60, createdAt: new Date(NOW - 5 * DAY + 80 * MIN) } });
  await prisma.project.update({ where: { id: bank.id }, data: { charterSeq: 1, sessionSeq: 1, findingSeq: 1 } });

  console.log('[seed] Done.');
  console.log(`[seed] Sign in at the web app with admin@explorix.dev / lead@explorix.dev / tester@explorix.dev / viewer@explorix.dev — password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
