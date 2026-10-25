import type { Prisma } from '@prisma/client';
import type { Tx } from '../db.js';

export interface ProjectSettings {
  requireReview: boolean;
  allowSelfReview: boolean;
  lockCompletedSessions: boolean;
  defaultTimeboxMinutes: number;
  allowTesterCharterEdit: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  requireReview: false,
  allowSelfReview: false,
  lockCompletedSessions: true,
  defaultTimeboxMinutes: 60,
  allowTesterCharterEdit: true,
};

export const projectSettings = (raw: unknown): ProjectSettings => ({
  ...DEFAULT_SETTINGS,
  ...((raw as Partial<ProjectSettings>) ?? {}),
});

export const DEFAULT_CLASSIFICATIONS = [
  { key: 'observation', name: 'Observation', color: 'blue', isDefect: false, shortcut: 'o' },
  { key: 'potential_defect', name: 'Potential defect', color: 'orange', isDefect: false, shortcut: '!' },
  { key: 'confirmed_defect', name: 'Confirmed defect', color: 'red', isDefect: true, shortcut: 'b' },
  { key: 'question', name: 'Question', color: 'violet', isDefect: false, shortcut: '?' },
  { key: 'risk', name: 'Risk', color: 'yellow', isDefect: false, shortcut: 'r' },
  { key: 'follow_up', name: 'Follow-up action', color: 'cyan', isDefect: false, shortcut: 'f' },
  { key: 'testing_note', name: 'Testing note', color: 'gray', isDefect: false, shortcut: 'n' },
];

export const DEFAULT_RESULT_STATUSES: Omit<Prisma.TestResultStatusCreateManyInput, 'projectId'>[] = [
  { key: 'passed', name: 'Passed', color: 'green', category: 'PASSED', scope: 'BOTH', aliases: ['pass', 'passed', 'success', 'succeeded', 'ok', 'expected'], isSystem: true },
  { key: 'failed', name: 'Failed', color: 'red', category: 'FAILED', scope: 'BOTH', aliases: ['fail', 'failed', 'failure', 'unexpected'], isSystem: true },
  { key: 'error', name: 'Error', color: 'pink', category: 'FAILED', scope: 'AUTOMATION', aliases: ['error', 'errored', 'broken', 'timedout', 'timed_out', 'interrupted', 'crashed'], isSystem: false },
  { key: 'blocked', name: 'Blocked', color: 'orange', category: 'BLOCKED', scope: 'MANUAL', aliases: ['blocked'], isSystem: true },
  { key: 'skipped', name: 'Skipped', color: 'gray', category: 'SKIPPED', scope: 'BOTH', aliases: ['skip', 'skipped', 'pending', 'ignored', 'disabled', 'todo'], isSystem: true },
  { key: 'retest', name: 'Retest', color: 'yellow', category: 'RETEST', scope: 'MANUAL', aliases: ['retest'], isSystem: false },
  { key: 'flaky', name: 'Passed on retry', color: 'lime', category: 'PASSED', scope: 'AUTOMATION', aliases: ['flaky'], isSystem: false },
];

/** Seeds per-project configuration so a new project is immediately usable. */
export async function applyProjectDefaults(tx: Tx, projectId: string) {
  await tx.findingClassification.createMany({
    data: DEFAULT_CLASSIFICATIONS.map((c, i) => ({ ...c, projectId, position: i })),
  });
  await tx.testResultStatus.createMany({
    data: DEFAULT_RESULT_STATUSES.map((s, i) => ({ ...s, projectId, position: i })),
  });
  await tx.testFolder.create({ data: { projectId, name: 'General', position: 0 } });
}
