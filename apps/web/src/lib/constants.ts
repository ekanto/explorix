/** Shared enum metadata so status/priority/severity look identical everywhere. */

export const SESSION_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  IN_PROGRESS: { label: 'In progress', color: 'teal' },
  PAUSED: { label: 'Paused', color: 'yellow' },
  COMPLETED: { label: 'Completed', color: 'blue' },
  IN_REVIEW: { label: 'In review', color: 'violet' },
  CHANGES_REQUESTED: { label: 'Changes requested', color: 'orange' },
  APPROVED: { label: 'Approved', color: 'green' },
  ABANDONED: { label: 'Abandoned', color: 'dark' },
};

export const CHARTER_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  READY: { label: 'Ready', color: 'teal' },
  ARCHIVED: { label: 'Archived', color: 'dark' },
};

export const FINDING_STATUS: Record<string, { label: string; color: string }> = {
  NEW: { label: 'New', color: 'blue' },
  TRIAGED: { label: 'Triaged', color: 'cyan' },
  CONVERTED: { label: 'Converted to issue', color: 'violet' },
  RESOLVED: { label: 'Resolved', color: 'green' },
  DUPLICATE: { label: 'Duplicate', color: 'gray' },
  WONT_FIX: { label: "Won't fix", color: 'gray' },
  CLOSED: { label: 'Closed', color: 'dark' },
};

export const ISSUE_STATUS: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'Open', color: 'red' },
  IN_PROGRESS: { label: 'In progress', color: 'yellow' },
  RESOLVED: { label: 'Resolved', color: 'green' },
  CLOSED: { label: 'Closed', color: 'dark' },
  WONT_FIX: { label: "Won't fix", color: 'gray' },
};

export const PRIORITY: Record<string, { label: string; color: string; rank: number }> = {
  LOW: { label: 'Low', color: 'gray', rank: 1 },
  MEDIUM: { label: 'Medium', color: 'blue', rank: 2 },
  HIGH: { label: 'High', color: 'orange', rank: 3 },
  CRITICAL: { label: 'Critical', color: 'red', rank: 4 },
};

export const RISK = PRIORITY;

export const SEVERITY: Record<string, { label: string; color: string; rank: number }> = {
  TRIVIAL: { label: 'Trivial', color: 'gray', rank: 1 },
  MINOR: { label: 'Minor', color: 'blue', rank: 2 },
  MAJOR: { label: 'Major', color: 'yellow', rank: 3 },
  CRITICAL: { label: 'Critical', color: 'orange', rank: 4 },
  BLOCKER: { label: 'Blocker', color: 'red', rank: 5 },
};

export const RESULT_CATEGORY: Record<string, { label: string; color: string }> = {
  PASSED: { label: 'Passed', color: 'green' },
  FAILED: { label: 'Failed', color: 'red' },
  BLOCKED: { label: 'Blocked', color: 'orange' },
  SKIPPED: { label: 'Skipped', color: 'gray' },
  RETEST: { label: 'Retest', color: 'yellow' },
  UNTESTED: { label: 'Untested', color: 'gray' },
};

export const ROLE_LABEL: Record<string, string> = { ADMIN: 'Project admin', LEAD: 'Lead', TESTER: 'Tester', VIEWER: 'Viewer' };
export const ROLE_RANK: Record<string, number> = { VIEWER: 1, TESTER: 2, LEAD: 3, ADMIN: 4 };

export const options = (m: Record<string, { label: string }>) => Object.entries(m).map(([value, v]) => ({ value, label: v.label }));

export const ACTIVE_SESSION_STATUSES = ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'];
