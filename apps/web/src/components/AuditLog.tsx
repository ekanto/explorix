import { Link } from 'react-router';
import { Badge, Box, Code, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { fmtDateTime, fromNow, titleCase } from '../lib/format';
import { UserAvatar } from './ui';

/** Entity types written to the audit log by the server (see `audit()` calls). */
export const AUDIT_ENTITY_TYPES: { value: string; label: string }[] = [
  ['charter', 'Charter'],
  ['session', 'Session'],
  ['finding', 'Finding'],
  ['issue', 'Issue'],
  ['requirement', 'Requirement'],
  ['test_case', 'Test case'],
  ['test_folder', 'Test folder'],
  ['test_plan', 'Test plan'],
  ['test_run', 'Test run'],
  ['automation_run', 'Automation run'],
  ['comment', 'Comment'],
  ['attachment', 'Attachment'],
  ['template', 'Template'],
  ['project', 'Project'],
  ['project_member', 'Project member'],
  ['milestone', 'Milestone'],
  ['environment', 'Environment'],
  ['tag', 'Tag'],
  ['customFieldDefinition', 'Custom field'],
  ['findingClassification', 'Finding classification'],
  ['testResultStatus', 'Result status'],
  ['integration', 'Integration'],
  ['api_token', 'API token'],
  ['user', 'User'],
  ['team', 'Team'],
  ['organization', 'Organization'],
].map(([value, label]) => ({ value, label }));

const LABEL = Object.fromEntries(AUDIT_ENTITY_TYPES.map((t) => [t.value, t.label]));
export const entityLabel = (type: string) => LABEL[type] ?? titleCase(type);

const DETAIL_PATH: Record<string, string> = {
  charter: 'charters',
  session: 'sessions',
  finding: 'findings',
  issue: 'issues',
  requirement: 'requirements',
  test_case: 'test-cases',
  test_run: 'test-runs',
  automation_run: 'automation/runs',
};
const SETTINGS_TAB: Record<string, string> = {
  project: 'general',
  project_member: 'members',
  milestone: 'milestones',
  environment: 'environments',
  tag: 'tags',
  customFieldDefinition: 'fields',
  findingClassification: 'classifications',
  testResultStatus: 'statuses',
};

/** Best-effort link to the audited entity (null when there is no page for it). */
export function entityLink(e: { entityType: string; entityId: string; projectId: string | null; action?: string }): string | null {
  if (e.action === 'deleted') return null;
  if (!e.projectId) return ['user', 'team', 'organization'].includes(e.entityType) ? '/admin' : null;
  const base = `/projects/${e.projectId}`;
  if (DETAIL_PATH[e.entityType]) return `${base}/${DETAIL_PATH[e.entityType]}/${e.entityId}`;
  if (SETTINGS_TAB[e.entityType]) return `${base}/settings?tab=${SETTINGS_TAB[e.entityType]}`;
  if (e.entityType === 'integration') return `${base}/integrations`;
  if (e.entityType === 'template') return `${base}/templates`;
  return null;
}

const short = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

/** Compact human-readable summary of an audit `changes` payload. */
export function AuditChanges({ changes }: { changes: unknown }) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  const entries = Object.entries(changes as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return null;
  const isDiff = (v: unknown): v is { from: unknown; to: unknown } => !!v && typeof v === 'object' && 'to' in (v as object) && 'from' in (v as object);
  return (
    <Group gap={6} mt={2} wrap="wrap">
      {entries.slice(0, 4).map(([k, v]) => (
        <Text key={k} size="xs" c="dimmed">
          <Text span size="xs" fw={600}>
            {k}
          </Text>
          : {isDiff(v) ? `${short(v.from)} → ${short(v.to)}` : short(v)}
        </Text>
      ))}
      <Popover width={420} position="bottom-start" withArrow shadow="md">
        <Popover.Target>
          <UnstyledButton aria-label="Show full change details">
            <Text size="xs" className="ex-link">
              details
            </Text>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown>
          <Code block style={{ maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify(changes, null, 2)}
          </Code>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}

export type AuditEventRow = {
  id: string;
  projectId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
  createdAt: string;
  ip?: string | null;
  actor: { id: string; name: string; avatarColor?: string | null } | null;
  project?: { id: string; key: string; name: string } | null;
};

/** Timeline of audit events: actor, action, entity link, change summary and time. */
export function AuditFeed({ events, showProject }: { events: AuditEventRow[]; showProject?: boolean }) {
  return (
    <Stack gap={0}>
      {events.map((e) => {
        const link = entityLink(e);
        const label = entityLabel(e.entityType);
        return (
          <Group key={e.id} wrap="nowrap" align="flex-start" gap="sm" py="sm" style={{ borderBottom: '1px solid var(--ex-border)' }}>
            <UserAvatar user={e.actor ?? { name: 'System' }} size={30} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group gap={6} wrap="wrap">
                <Text size="sm" fw={600}>
                  {e.actor?.name ?? 'System'}
                </Text>
                <Text size="sm">{titleCase(e.action).toLowerCase()}</Text>
                {link ? (
                  <Text size="sm" component={Link} to={link} className="ex-link">
                    {label.toLowerCase()}
                  </Text>
                ) : (
                  <Text size="sm">{label.toLowerCase()}</Text>
                )}
                {showProject && e.project && (
                  <Badge size="xs" variant="outline" color="gray">
                    {e.project.key}
                  </Badge>
                )}
              </Group>
              <AuditChanges changes={e.changes} />
            </Box>
            <Box ta="right" style={{ flexShrink: 0 }}>
              <Text size="xs" c="dimmed" title={fmtDateTime(e.createdAt)}>
                {fromNow(e.createdAt)}
              </Text>
              <Text size="xs" c="dimmed">
                {fmtDateTime(e.createdAt)}
              </Text>
            </Box>
          </Group>
        );
      })}
    </Stack>
  );
}
