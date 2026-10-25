import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '../db.js';
import { applyProjectDefaults } from './projectDefaults.js';
import { newStorageKey, storage } from './storage.js';

/**
 * Creates a small, realistic sample project in an existing organization so a
 * fresh desktop install can explore the workbench and reporting immediately.
 * All evidence is real stored files (generated PNG screenshots and a text log).
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function mockScreen(opts: { title: string; banner?: string; bannerTone?: 'error' | 'warn'; lines: string[]; accent: string }) {
  const w = 1280;
  const h = 800;
  const tone = opts.bannerTone === 'warn' ? ['#fff4e6', '#e8590c'] : ['#fff5f5', '#e03131'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" fill="#f8f9fb"/>
  <rect width="100%" height="64" fill="#1e293b"/>
  <text x="32" y="41" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#fff" font-weight="600">Northwind Shop</text>
  <text x="${w - 32}" y="41" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#cbd5e1" text-anchor="end">staging.northwind.example</text>
  <rect x="0" y="64" width="240" height="${h - 64}" fill="#eef1f6"/>
  ${['Catalog', 'Cart', 'Checkout', 'Account', 'Orders'].map((t, i) => `<text x="32" y="${120 + i * 44}" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#334155">${t}</text>`).join('')}
  <text x="296" y="132" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#0f172a" font-weight="600">${esc(opts.title)}</text>
  ${opts.banner ? `<rect x="296" y="164" width="900" height="56" rx="8" fill="${tone[0]}" stroke="${tone[1]}"/><rect x="296" y="164" width="8" height="56" rx="4" fill="${tone[1]}"/><text x="324" y="199" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="${tone[1]}">${esc(opts.banner)}</text>` : ''}
  ${opts.lines.map((t, i) => `<rect x="296" y="${252 + i * 72}" width="900" height="52" rx="6" fill="#fff" stroke="#d0d7e2"/><text x="316" y="${284 + i * 72}" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#334155">${esc(t)}</text>`).join('')}
  <rect x="296" y="${268 + opts.lines.length * 72}" width="220" height="52" rx="8" fill="${opts.accent}"/>
  <text x="406" y="${300 + opts.lines.length * 72}" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#fff" text-anchor="middle" font-weight="600">Continue</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function createSampleProject(orgId: string, userId: string) {
  const existing = new Set((await prisma.project.findMany({ where: { orgId }, select: { key: true } })).map((p) => p.key));
  let key = 'SAMPLE';
  for (let i = 2; existing.has(key); i++) key = `SAMPLE${i}`;

  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
  const shots = {
    payment: await mockScreen({ title: 'Checkout · Payment', banner: 'Something went wrong. Please try again. (PAY-500)', lines: ['Visa •••• 4242   exp 04/27', 'Billing address: same as shipping', 'Order total: $148.20'], accent: '#e03131' }),
    coupon: await mockScreen({ title: 'Checkout · Order summary', banner: 'Coupon SAVE10 applied twice: −$29.64', bannerTone: 'warn', lines: ['Subtotal: $148.20', 'SAVE10  −$14.82', 'SAVE10  −$14.82'], accent: '#1c7ed6' }),
    focus: await mockScreen({ title: 'Account · Profile', lines: ['Name: Jordan Rivera', 'Email: jordan@example.com', 'Phone: (no visible focus ring)'], accent: '#0ca678' }),
  };
  const log = Buffer.from(
    [
      '2026-10-24T10:14:03.211Z INFO  checkout  POST /api/payments/intent 200 312ms',
      '2026-10-24T10:14:05.877Z ERROR checkout  POST /api/payments/confirm 500 1043ms',
      '2026-10-24T10:14:05.878Z ERROR payments  TokenExpiredError: saved card token expired at 2026-10-24T10:00:00Z',
      '2026-10-24T10:14:05.879Z WARN  checkout  retry suppressed: idempotency key reused',
    ].join('\n') + '\n',
  );

  const files: { key: string; data: Buffer }[] = [];
  const stash = (data: Buffer) => {
    const k = newStorageKey();
    files.push({ key: k, data });
    return k;
  };
  const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

  const evidenceKeys = { payment: stash(shots.payment), coupon: stash(shots.coupon), focus: stash(shots.focus), log: stash(log) };
  for (const f of files) await storage.put(f.key, f.data);

  try {
    return await prisma.$transaction(
      async (tx) => {
        const project = await tx.project.create({
          data: {
            orgId,
            key,
            name: 'Sample: Northwind Shop',
            description: 'A sample e-commerce project with charters, sessions, findings and evidence. Safe to archive when you no longer need it.',
            color: '#7048e8',
            members: { create: { userId, role: 'ADMIN' } },
            charterSeq: 2,
            sessionSeq: 3,
            findingSeq: 4,
            issueSeq: 1,
          },
        });
        await applyProjectDefaults(tx, project.id);
        const cls = Object.fromEntries((await tx.findingClassification.findMany({ where: { projectId: project.id } })).map((c) => [c.key, c.id]));
        const milestone = await tx.milestone.create({ data: { projectId: project.id, name: 'Release 2.4', status: 'ACTIVE', startDate: at(60 * 24 * 7), dueDate: new Date(now + 7 * 86_400_000) } });
        const env = await tx.environment.create({ data: { projectId: project.id, name: 'Staging', url: 'https://staging.northwind.example', browser: 'Chrome 130', os: 'Windows 11' } });

        const checkout = await tx.charter.create({
          data: {
            projectId: project.id,
            number: 1,
            title: 'Checkout with saved payment methods',
            mission: 'Explore checkout using saved cards and coupons to discover payment failures, pricing errors and confusing recovery paths.',
            target: 'Web checkout (cart → payment → confirmation)',
            scope: 'Saved cards, coupon codes, address reuse, payment retries',
            outOfScope: 'New card entry, PayPal, mobile apps',
            risks: 'Double charges; incorrect totals; lost orders after payment errors',
            prerequisites: 'Test account with two saved cards (one expiring this month)',
            testData: 'Coupon SAVE10; Visa 4242 (expired token); Mastercard 5454',
            environmentId: env.id,
            browser: 'Chrome 130',
            os: 'Windows 11',
            timeboxMinutes: 60,
            priority: 'HIGH',
            riskLevel: 'HIGH',
            status: 'READY',
            milestoneId: milestone.id,
            createdById: userId,
            createdAt: at(60 * 24 * 3),
          },
        });
        const a11y = await tx.charter.create({
          data: {
            projectId: project.id,
            number: 2,
            title: 'Keyboard and focus behaviour in account settings',
            mission: 'Explore account settings using only the keyboard to discover focus traps, missing focus indicators and unreachable controls.',
            target: 'Account → Profile, Addresses, Security',
            scope: 'Keyboard navigation, focus order, visible focus, screen-reader labels',
            outOfScope: 'Colour contrast audit',
            environmentId: env.id,
            timeboxMinutes: 45,
            priority: 'MEDIUM',
            riskLevel: 'MEDIUM',
            status: 'READY',
            milestoneId: milestone.id,
            createdById: userId,
            createdAt: at(60 * 24 * 2),
          },
        });

        const s1Start = at(60 * 26);
        const s1 = await tx.exploratorySession.create({
          data: {
            projectId: project.id,
            charterId: checkout.id,
            number: 1,
            title: 'Checkout with saved payment methods',
            status: 'COMPLETED',
            testerId: userId,
            createdById: userId,
            milestoneId: milestone.id,
            environmentId: env.id,
            browser: 'Chrome 130',
            os: 'Windows 11',
            buildVersion: '2.4.0-rc.2',
            priority: 'HIGH',
            timeboxMinutes: 60,
            elapsedSeconds: 52 * 60,
            startedAt: s1Start,
            endedAt: new Date(s1Start.getTime() + 55 * 60_000),
            notes:
              '<p>Started with the expiring Visa card. Payment confirmation fails with a generic error once the saved token has expired.</p><p>Coupons: applying SAVE10, navigating back to the cart and returning applies the discount a second time.</p><ul><li>Retry button is disabled after the first failure</li><li>Order history shows no failed attempt</li></ul>',
            summary: 'Two defects in checkout: expired saved-card tokens cause an unrecoverable payment error, and SAVE10 can be applied twice. Retry behaviour needs a follow-up session.',
            setupPercent: 10,
            testPercent: 60,
            bugPercent: 30,
            charterVsOpportunity: 80,
            createdAt: s1Start,
          },
        });
        const s2Start = at(60 * 5);
        const s2 = await tx.exploratorySession.create({
          data: {
            projectId: project.id,
            charterId: a11y.id,
            number: 2,
            title: 'Keyboard and focus behaviour in account settings',
            status: 'COMPLETED',
            testerId: userId,
            createdById: userId,
            milestoneId: milestone.id,
            environmentId: env.id,
            browser: 'Firefox 131',
            os: 'Windows 11',
            buildVersion: '2.4.0-rc.2',
            timeboxMinutes: 45,
            elapsedSeconds: 38 * 60,
            startedAt: s2Start,
            endedAt: new Date(s2Start.getTime() + 40 * 60_000),
            notes: '<p>Tabbed through Profile, Addresses and Security. Focus order is logical except on the Phone field, where the focus indicator disappears.</p>',
            summary: 'Keyboard navigation is mostly sound. One missing focus indicator; one question about the 2FA modal focus trap.',
            setupPercent: 15,
            testPercent: 75,
            bugPercent: 10,
            charterVsOpportunity: 100,
            createdAt: s2Start,
          },
        });
        await tx.exploratorySession.create({
          data: { projectId: project.id, charterId: checkout.id, number: 3, title: 'Checkout: payment retry and recovery', status: 'DRAFT', testerId: userId, createdById: userId, milestoneId: milestone.id, environmentId: env.id, timeboxMinutes: 60, priority: 'HIGH' },
        });

        const mk = async (n: number, s: typeof s1, data: { cls: string; title: string; minute: number } & Record<string, unknown>) => {
          const { cls: c, minute, ...rest } = data;
          const created = new Date(s.startedAt!.getTime() + minute * 60_000);
          const f = await tx.finding.create({
            data: {
              projectId: project.id,
              number: n,
              sessionId: s.id,
              charterId: s.charterId,
              classificationId: cls[c],
              authorId: userId,
              environment: `Staging · ${s.browser} · ${s.os} · build ${s.buildVersion}`,
              browser: s.browser,
              sessionElapsedSeconds: minute * 60,
              createdAt: created,
              updatedAt: created,
              ...(rest as { title: string }),
            },
          });
          await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: userId, type: 'FINDING', content: f.title, elapsedSeconds: minute * 60, findingId: f.id, createdAt: created } });
          return f;
        };
        const f1 = await mk(1, s1, {
          cls: 'confirmed_defect',
          minute: 14,
          title: 'Payment fails with generic error when saved card token has expired',
          description: 'Confirming an order with a saved card whose token expired shows "Something went wrong" and the order cannot be completed.',
          severity: 'CRITICAL',
          priority: 'HIGH',
          status: 'CONVERTED',
          preconditions: 'Signed in as a customer with a saved Visa card whose token expired.',
          reproSteps: '1. Add any item to the cart\n2. Proceed to checkout\n3. Select the saved Visa •••• 4242\n4. Click "Place order"',
          expected: 'The customer is asked to re-enter card details, or the token is refreshed transparently.',
          actual: 'A generic error (PAY-500) is shown and the Retry button is disabled. The server log shows TokenExpiredError.',
          followUp: 'Session SAMPLE-S3 will explore retry and recovery paths.',
        });
        const f2 = await mk(2, s1, {
          cls: 'confirmed_defect',
          minute: 31,
          title: 'Coupon SAVE10 applied twice after navigating back to the cart',
          description: 'Returning to the cart and back to checkout re-applies the same coupon, doubling the discount.',
          severity: 'MAJOR',
          priority: 'HIGH',
          status: 'NEW',
          reproSteps: '1. Apply coupon SAVE10 in the cart\n2. Proceed to checkout\n3. Use the browser Back button to return to the cart\n4. Proceed to checkout again',
          expected: 'The coupon is applied once.',
          actual: 'The order summary lists SAVE10 twice (−$29.64 in total).',
        });
        const f3 = await mk(3, s1, {
          cls: 'question',
          minute: 44,
          title: 'Should failed payment attempts appear in order history?',
          description: 'Failed attempts are not visible anywhere to the customer. Product to confirm the intended behaviour.',
          severity: 'MINOR',
          priority: 'MEDIUM',
          status: 'NEW',
        });
        const f4 = await mk(4, s2, {
          cls: 'potential_defect',
          minute: 12,
          title: 'No visible focus indicator on the Phone field',
          description: 'When tabbing into the Phone field the focus ring is not displayed (custom CSS removes outline).',
          severity: 'MAJOR',
          priority: 'MEDIUM',
          status: 'TRIAGED',
          reproSteps: '1. Open Account → Profile\n2. Press Tab until the Phone field receives focus',
          expected: 'A clearly visible focus indicator (WCAG 2.4.7).',
          actual: 'No focus indicator is visible.',
        });

        const ev = async (p: { key: string; data: Buffer; name: string; mime: string; kind: 'IMAGE' | 'DOCUMENT'; finding: typeof f1; s: typeof s1; caption?: string; position: number; width?: number; height?: number }) => {
          const a = await tx.attachment.create({
            data: {
              projectId: project.id,
              uploaderId: userId,
              fileName: p.name,
              storageKey: p.key,
              mimeType: p.mime,
              kind: p.kind,
              size: p.data.length,
              sha256: sha(p.data),
              caption: p.caption,
              position: p.position,
              width: p.width,
              height: p.height,
              sessionId: p.s.id,
              findingId: p.finding.id,
              createdAt: p.finding.createdAt,
            },
          });
          await tx.sessionLogEntry.create({ data: { sessionId: p.s.id, authorId: userId, type: 'ATTACHMENT', content: p.name, elapsedSeconds: p.finding.sessionElapsedSeconds ?? 0, attachmentId: a.id, createdAt: p.finding.createdAt } });
        };
        await ev({ key: evidenceKeys.payment, data: shots.payment, name: 'payment-error.png', mime: 'image/png', kind: 'IMAGE', finding: f1, s: s1, caption: 'Generic PAY-500 error after "Place order"', position: 0, width: 1280, height: 800 });
        await ev({ key: evidenceKeys.log, data: log, name: 'checkout-server.log', mime: 'text/plain', kind: 'DOCUMENT', finding: f1, s: s1, caption: 'Server log excerpt showing TokenExpiredError', position: 1 });
        await ev({ key: evidenceKeys.coupon, data: shots.coupon, name: 'coupon-applied-twice.png', mime: 'image/png', kind: 'IMAGE', finding: f2, s: s1, caption: 'Order summary lists SAVE10 twice', position: 0, width: 1280, height: 800 });
        await ev({ key: evidenceKeys.focus, data: shots.focus, name: 'phone-field-no-focus.png', mime: 'image/png', kind: 'IMAGE', finding: f4, s: s2, caption: 'Phone field focused, but no focus ring', position: 0, width: 1280, height: 800 });

        const issue = await tx.issue.create({
          data: {
            projectId: project.id,
            number: 1,
            title: f1.title,
            description: `${f1.description}\n\nExpected: ${f1.expected}\n\nActual: ${f1.actual}`,
            severity: 'CRITICAL',
            priority: 'HIGH',
            reporterId: userId,
            milestoneId: milestone.id,
            sourceFindingId: f1.id,
          },
        });
        await tx.finding.update({ where: { id: f1.id }, data: { issueId: issue.id } });
        void f3;

        for (const [s, mins] of [[s1, 52], [s2, 38]] as const) {
          await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: userId, type: 'STATUS_CHANGE', content: 'Session started', elapsedSeconds: 0, createdAt: s.startedAt!, metadata: { from: 'DRAFT', to: 'IN_PROGRESS' } } });
          await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: userId, type: 'STATUS_CHANGE', content: 'Session completed', elapsedSeconds: mins * 60, createdAt: s.endedAt!, metadata: { from: 'IN_PROGRESS', to: 'COMPLETED' } } });
        }
        await tx.auditEvent.create({ data: { orgId, projectId: project.id, actorId: userId, action: 'created', entityType: 'project', entityId: project.id, changes: { key, sample: true } } });
        return project;
      },
      { timeout: 30_000 },
    );
  } catch (err) {
    await Promise.all(files.map((f) => storage.remove(f.key).catch(() => undefined)));
    throw err;
  }
}
