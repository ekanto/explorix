import { Group, Stack, Text, Timeline, Tooltip } from '@mantine/core';
import { fmtDateTime, fromNow, titleCase } from '../lib/format';
import { UserAvatar } from './ui';

export type AuditEvent = {
  id: string;
  action: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string; avatarColor?: string | null } | null;
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
};

function ChangeLine({ field, value }: { field: string; value: unknown }) {
  const label = titleCase(field.replace(/([a-z])([A-Z])/g, '$1_$2'));
  const isDiff = !!value && typeof value === 'object' && !Array.isArray(value) && ('from' in value || 'to' in value);
  return (
    <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>
      <b>{label}</b>:{' '}
      {isDiff ? (
        <>
          {'from' in (value as object) && <>{show((value as { from: unknown }).from)} → </>}
          {show((value as { to?: unknown }).to)}
        </>
      ) : (
        show(value)
      )}
    </Text>
  );
}

/** Audit history timeline (newest first) as returned by the server's audit events. */
export function HistoryList({ events, empty = 'No history recorded yet.' }: { events: AuditEvent[] | undefined; empty?: string }) {
  if (!events?.length)
    return (
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    );
  return (
    <Timeline bulletSize={26} lineWidth={2}>
      {events.map((e) => {
        const entries = Object.entries(e.changes ?? {}).filter(([, v]) => v !== undefined && v !== null);
        return (
          <Timeline.Item key={e.id} bullet={<UserAvatar user={e.actor} size={24} />}>
            <Group gap={6} wrap="wrap">
              <Text size="sm" fw={600}>
                {e.actor?.name ?? 'System'}
              </Text>
              <Text size="sm">{titleCase(e.action).toLowerCase()}</Text>
              <Tooltip label={fmtDateTime(e.createdAt)}>
                <Text size="xs" c="dimmed">
                  {fromNow(e.createdAt)}
                </Text>
              </Tooltip>
            </Group>
            {entries.length > 0 && (
              <Stack gap={0} mt={2}>
                {entries.slice(0, 12).map(([k, v]) => (
                  <ChangeLine key={k} field={k} value={v} />
                ))}
              </Stack>
            )}
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}
