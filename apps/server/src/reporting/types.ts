import { z } from 'zod';
import type { ReportKind } from '@prisma/client';

export const SECTION_KEYS = [
  'cover',
  'toc',
  'executiveSummary',
  'metadata',
  'mission',
  'scope',
  'environment',
  'timeline',
  'testExecution',
  'findingsSummary',
  'findings',
  'screenshots',
  'videos',
  'attachments',
  'risks',
  'outstanding',
  'recommendations',
  'assessment',
  'evidenceIndex',
  'appendices',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  cover: 'Cover page',
  toc: 'Table of contents',
  executiveSummary: 'Executive summary',
  metadata: 'Project and session metadata',
  mission: 'Charter and testing mission',
  scope: 'Scope, exclusions and assumptions',
  environment: 'Test environment',
  timeline: 'Session timeline and time spent',
  testExecution: 'Test execution summary',
  findingsSummary: 'Findings summary',
  findings: 'Detailed findings',
  screenshots: 'Screenshot evidence',
  videos: 'Video evidence and important timestamps',
  attachments: 'Additional attachments',
  risks: 'Risks and unresolved questions',
  outstanding: 'Outstanding issues',
  recommendations: 'Recommended actions',
  assessment: 'Final assessment',
  evidenceIndex: 'Evidence index',
  appendices: 'Appendices',
};

export const FORMATS = ['pdf', 'docx', 'md', 'html'] as const;
export type ReportFormat = (typeof FORMATS)[number];

export const SEVERITIES = ['TRIVIAL', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER'] as const;
export const REPORT_KINDS = ['SESSION', 'BUG_INVESTIGATION', 'PROJECT_SUMMARY', 'RELEASE_READINESS', 'REGRESSION', 'SECURITY', 'EVIDENCE', 'CUSTOM'] as const satisfies readonly ReportKind[];

const all = (on: boolean) => Object.fromEntries(SECTION_KEYS.map((k) => [k, on])) as Record<SectionKey, boolean>;
const only = (...keys: SectionKey[]) => ({ ...all(false), ...Object.fromEntries(keys.map((k) => [k, true])) }) as Record<SectionKey, boolean>;

export interface BuiltInTemplate {
  kind: ReportKind;
  name: string;
  description: string;
  fileLabel: string;
  sections: Record<SectionKey, boolean>;
  defaults?: ReportOptionsInput;
}

/** The eight built-in templates. Users save customised copies as ReportTemplate rows. */
export const BUILT_IN_TEMPLATES: Record<ReportKind, BuiltInTemplate> = {
  SESSION: {
    kind: 'SESSION',
    name: 'Exploratory Session Report',
    description: 'Mission, timeline, findings and evidence for one or more exploratory sessions.',
    fileLabel: 'Session_Report',
    sections: { ...all(true), testExecution: false },
  },
  BUG_INVESTIGATION: {
    kind: 'BUG_INVESTIGATION',
    name: 'Detailed Bug Investigation Report',
    description: 'Deep dive into selected findings with reproduction steps and all evidence.',
    fileLabel: 'Bug_Investigation',
    sections: only('cover', 'executiveSummary', 'metadata', 'environment', 'findingsSummary', 'findings', 'videos', 'outstanding', 'recommendations', 'evidenceIndex'),
    defaults: { imageSize: 'large' },
  },
  PROJECT_SUMMARY: {
    kind: 'PROJECT_SUMMARY',
    name: 'Project QA Summary',
    description: 'Quality overview of a project: sessions, findings, test execution and open risks.',
    fileLabel: 'Project_QA_Summary',
    sections: only('cover', 'toc', 'executiveSummary', 'metadata', 'testExecution', 'findingsSummary', 'findings', 'risks', 'outstanding', 'recommendations', 'assessment', 'evidenceIndex'),
    defaults: { imageSize: 'small' },
  },
  RELEASE_READINESS: {
    kind: 'RELEASE_READINESS',
    name: 'Release Readiness Report',
    description: 'Open defects, test execution and risks for a milestone or release.',
    fileLabel: 'Release_Readiness',
    sections: only('cover', 'toc', 'executiveSummary', 'metadata', 'testExecution', 'findingsSummary', 'findings', 'risks', 'outstanding', 'recommendations', 'assessment', 'evidenceIndex'),
    defaults: { severities: ['MAJOR', 'CRITICAL', 'BLOCKER'], imageSize: 'small' },
  },
  REGRESSION: {
    kind: 'REGRESSION',
    name: 'Regression Testing Report',
    description: 'Manual and automated test execution results plus regressions found while exploring.',
    fileLabel: 'Regression_Report',
    sections: only('cover', 'toc', 'executiveSummary', 'metadata', 'environment', 'testExecution', 'findingsSummary', 'findings', 'outstanding', 'recommendations', 'assessment', 'evidenceIndex'),
  },
  SECURITY: {
    kind: 'SECURITY',
    name: 'Security Testing Findings Report',
    description: 'Security-relevant findings with severity, impact, reproduction and remediation follow-ups.',
    fileLabel: 'Security_Findings',
    sections: only('cover', 'toc', 'executiveSummary', 'metadata', 'mission', 'scope', 'environment', 'findingsSummary', 'findings', 'videos', 'risks', 'outstanding', 'recommendations', 'evidenceIndex', 'appendices'),
    defaults: { branding: { confidentiality: 'Confidential: contains security findings' } },
  },
  EVIDENCE: {
    kind: 'EVIDENCE',
    name: 'Evidence Collection Report',
    description: 'Every selected screenshot, video and attachment with captions, timestamps and checksums.',
    fileLabel: 'Evidence_Report',
    sections: only('cover', 'toc', 'metadata', 'findingsSummary', 'findings', 'screenshots', 'videos', 'attachments', 'evidenceIndex'),
    defaults: { imageSize: 'large' },
  },
  CUSTOM: {
    kind: 'CUSTOM',
    name: 'Custom Report',
    description: 'Start from every section and choose exactly what to include.',
    fileLabel: 'Report',
    sections: all(true),
  },
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const reportOptionsSchema = z.object({
  title: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(300).optional(),
  author: z.string().trim().max(120).optional(),
  sections: z.record(z.enum(SECTION_KEYS), z.boolean()).optional(),
  severities: z.array(z.enum(SEVERITIES)).max(5).optional(),
  classificationKeys: z.array(z.string().max(40)).max(50).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  findingIds: z.array(z.string().max(40)).max(2000).optional(),
  excludeEvidenceIds: z.array(z.string().max(40)).max(10_000).optional(),
  includeImages: z.boolean().optional(),
  includeVideos: z.boolean().optional(),
  includeAttachments: z.boolean().optional(),
  includeComments: z.boolean().optional(),
  preferAnnotated: z.boolean().optional(),
  showMetadata: z.boolean().optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
  imageSize: z.enum(['small', 'medium', 'large']).optional(),
  language: z.enum(['en']).optional(),
  branding: z
    .object({
      organization: z.string().trim().max(120).optional(),
      accentColor: hex.optional(),
      logoDataUrl: z
        .string()
        .max(700_000)
        .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG or JPEG data URL')
        .optional(),
      confidentiality: z.string().trim().max(200).optional(),
    })
    .optional(),
});
export type ReportOptionsInput = z.infer<typeof reportOptionsSchema>;

export interface ReportOptions {
  title?: string;
  subtitle?: string;
  author?: string;
  sections: Record<SectionKey, boolean>;
  severities?: (typeof SEVERITIES)[number][];
  classificationKeys?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  findingIds?: string[];
  excludeEvidenceIds: string[];
  includeImages: boolean;
  includeVideos: boolean;
  includeAttachments: boolean;
  includeComments: boolean;
  preferAnnotated: boolean;
  showMetadata: boolean;
  orientation: 'portrait' | 'landscape';
  imageSize: 'small' | 'medium' | 'large';
  language: 'en';
  branding: { organization?: string; accentColor: string; logoDataUrl?: string; confidentiality?: string };
}

/** Template defaults, then saved-template options, then per-run overrides. */
export function resolveOptions(kind: ReportKind, ...layers: (ReportOptionsInput | undefined | null)[]): ReportOptions {
  const t = BUILT_IN_TEMPLATES[kind];
  const merged: Record<string, unknown> = {};
  for (const l of [t.defaults, ...layers]) {
    if (!l) continue;
    for (const [k, v] of Object.entries(l)) {
      if (v === undefined) continue;
      if (k === 'sections' || k === 'branding') merged[k] = { ...((merged[k] as object) ?? {}), ...(v as object) };
      else merged[k] = v;
    }
  }
  const m = merged as ReportOptionsInput;
  return {
    title: m.title || undefined,
    subtitle: m.subtitle || undefined,
    author: m.author || undefined,
    sections: { ...t.sections, ...(m.sections ?? {}) },
    severities: m.severities?.length ? m.severities : undefined,
    classificationKeys: m.classificationKeys?.length ? m.classificationKeys : undefined,
    dateFrom: m.dateFrom ? new Date(m.dateFrom) : undefined,
    dateTo: m.dateTo ? new Date(m.dateTo) : undefined,
    findingIds: m.findingIds,
    excludeEvidenceIds: m.excludeEvidenceIds ?? [],
    includeImages: m.includeImages ?? true,
    includeVideos: m.includeVideos ?? true,
    includeAttachments: m.includeAttachments ?? true,
    includeComments: m.includeComments ?? true,
    preferAnnotated: m.preferAnnotated ?? true,
    showMetadata: m.showMetadata ?? true,
    orientation: m.orientation ?? 'portrait',
    imageSize: m.imageSize ?? 'medium',
    language: 'en',
    branding: { accentColor: '#5f3dc4', ...(m.branding ?? {}) },
  };
}

export const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('finding'), findingId: z.string().max(40) }),
  z.object({ type: z.literal('findings'), findingIds: z.array(z.string().max(40)).min(1).max(2000) }),
  z.object({ type: z.literal('session'), sessionId: z.string().max(40) }),
  z.object({ type: z.literal('charter'), charterId: z.string().max(40) }),
  z.object({ type: z.literal('milestone'), milestoneId: z.string().max(40) }),
  z.object({ type: z.literal('project') }),
]);
export type ReportScope = z.infer<typeof scopeSchema>;

// ---------------------------------------------------------------------------
// Structured report model: every renderer consumes exactly this.
// ---------------------------------------------------------------------------

export type Block = { type: 'p'; text: string } | { type: 'ol' | 'ul'; items: string[] } | { type: 'code'; text: string } | { type: 'h'; text: string };

export interface EvidenceItem {
  id: string;
  ref: string; // E1, E2…
  kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER';
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  caption: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  createdAt: Date;
  uploader: string | null;
  findingId: string | null;
  findingKey: string | null;
  sessionKey: string | null;
  /** Internal storage keys: used to locate files, never rendered. */
  storageKey: string;
  displayStorageKey: string | null;
  displayId: string | null;
  annotated: boolean;
  thumbnailStorageKey: string | null;
  thumbnailId: string | null;
  frames: { id: string; storageKey: string; timeSeconds: number | null }[];
  markers: { timeSeconds: number; label: string; note: string | null; frameStorageKey: string | null }[];
}

export interface FindingItem {
  id: string;
  key: string;
  title: string;
  classification: string;
  isDefect: boolean;
  severity: string;
  priority: string;
  status: string;
  author: string;
  owner: string | null;
  createdAt: Date;
  sessionKey: string | null;
  sessionTitle: string | null;
  charterKey: string | null;
  elapsedSeconds: number | null;
  description: Block[];
  preconditions: Block[];
  reproSteps: Block[];
  expected: Block[];
  actual: Block[];
  environment: string | null;
  browser: string | null;
  followUp: Block[];
  resolution: Block[];
  tags: string[];
  issue: { key: string; title: string; status: string; externalKey: string | null; externalUrl: string | null } | null;
  requirement: { key: string; title: string } | null;
  comments: { author: string; at: Date; body: Block[] }[];
  evidence: EvidenceItem[];
}

export interface SessionItem {
  id: string;
  key: string;
  title: string;
  status: string;
  charterKey: string;
  tester: string | null;
  reviewer: string | null;
  reviewComment: string | null;
  reviewedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  elapsedSeconds: number;
  timeboxMinutes: number;
  environment: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  buildVersion: string | null;
  environmentNotes: string | null;
  milestone: string | null;
  summary: Block[];
  notes: Block[];
  tbs: { setup: number; test: number; bug: number } | null;
  charterVsOpportunity: number | null;
  findingCount: number;
  timeline: { at: Date; elapsedSeconds: number; type: string; text: string; ref: string | null }[];
  timelineTruncated: boolean;
}

export interface CharterItem {
  id: string;
  key: string;
  title: string;
  mission: Block[];
  target: string | null;
  objectives: Block[];
  scope: Block[];
  outOfScope: Block[];
  assumptions: Block[];
  risks: Block[];
  prerequisites: Block[];
  testData: Block[];
  environment: string | null;
  timeboxMinutes: number;
  priority: string;
  riskLevel: string;
}

export interface ReportModel {
  kind: ReportKind;
  templateName: string;
  fileLabel: string;
  title: string;
  subtitle: string | null;
  author: string;
  generatedAt: Date;
  appVersion: string;
  project: { key: string; name: string };
  scopeLabel: string;
  options: ReportOptions;
  sections: SectionKey[];
  summary: {
    paragraphs: string[];
    findingCount: number;
    defectCount: number;
    bySeverity: { severity: string; count: number }[];
    byClassification: { name: string; count: number }[];
    sessionCount: number;
    timeSpentSeconds: number;
    evidence: { images: number; videos: number; other: number };
  };
  milestone: { name: string; status: string; dueDate: Date | null } | null;
  charters: CharterItem[];
  sessions: SessionItem[];
  findings: FindingItem[];
  /** Selected evidence not attached to an included finding (session-level). */
  looseEvidence: EvidenceItem[];
  /** Every selected evidence item in reference order (E1…En). */
  evidence: EvidenceItem[];
  testExecution: {
    runs: { key: string; name: string; status: string; total: number; passed: number; failed: number; blocked: number; skipped: number; untested: number; passRate: number | null }[];
    automation: { key: string; name: string; startedAt: Date; total: number; passed: number; failed: number; skipped: number; branch: string | null }[];
  };
  risks: { kind: string; text: string; ref: string | null }[];
  outstanding: { ref: string; title: string; severity: string; status: string; owner: string | null }[];
  recommendations: { text: string; ref: string | null }[];
  assessment: { label: string; blocks: Block[] }[];
}

export const SEVERITY_RANK: Record<string, number> = { BLOCKER: 5, CRITICAL: 4, MAJOR: 3, MINOR: 2, TRIVIAL: 1 };
export const SEVERITY_COLORS: Record<string, string> = { BLOCKER: '#862e9c', CRITICAL: '#c92a2a', MAJOR: '#d9480f', MINOR: '#1864ab', TRIVIAL: '#495057' };
