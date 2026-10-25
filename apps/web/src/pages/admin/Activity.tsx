import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Group, Pagination, Paper, Select, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconFilterOff, IconHistory } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, QueryState } from '../../components/ui';
import { AUDIT_ENTITY_TYPES, AuditFeed } from '../../components/AuditLog';

const PAGE_SIZE = 50;

export default function Activity() {
  const { pid, project, members } = useProject();
  const { isOrgAdmin } = useAuth();
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const page = Number(sp.get('page')) || 1;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const [action, setAction] = useState(get('action'));
  const [debouncedAction] = useDebouncedValue(action, 400);
  useEffect(() => {
    if (debouncedAction !== get('action')) set({ action: debouncedAction || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAction]);

  const filters = { entityType: get('entityType'), actorId: get('actorId'), action: get('action'), from: get('from'), to: get('to') };
  // Org admins use the org audit endpoint (supports actor/action/date filters); other members use the project feed.
  const q = useQuery({
    queryKey: ['activity', pid, isOrgAdmin, filters, page],
    queryFn: () =>
      isOrgAdmin
        ? api.get('/admin/audit', {
            projectId: pid,
            entityType: filters.entityType,
            actorId: filters.actorId,
            action: filters.action,
            from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
            to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
            page,
            pageSize: PAGE_SIZE,
          })
        : api.get(p(pid, '/activity'), { entityType: filters.entityType, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader kicker={project.key} title="Activity" subtitle="Audit trail of changes in this project — who did what, and when." />
      <Paper withBorder p="sm" mb="md" className="ex-no-print">
        <Group gap="sm" wrap="wrap" align="flex-end">
          <Select
            label="Entity type"
            placeholder="All types"
            data={AUDIT_ENTITY_TYPES}
            value={filters.entityType || null}
            onChange={(v) => set({ entityType: v })}
            clearable
            searchable
            w={210}
          />
          {isOrgAdmin && (
            <>
              <Select
                label="Actor"
                placeholder="Anyone"
                data={members.map((m) => ({ value: m.user.id, label: m.user.name }))}
                value={filters.actorId || null}
                onChange={(v) => set({ actorId: v })}
                clearable
                searchable
                w={200}
              />
              <TextInput
                label="Action"
                description="Exact name, e.g. created"
                placeholder="Any action"
                value={action}
                onChange={(e) => setAction(e.currentTarget.value.trim())}
                w={180}
              />
              <DatePickerInput
                type="range"
                label="Date range"
                placeholder="Any time"
                value={[filters.from || null, filters.to || null]}
                onChange={([from, to]) => set({ from, to })}
                clearable
                w={260}
              />
            </>
          )}
          {hasFilters && (
            <Button
              variant="subtle"
              leftSection={<IconFilterOff size={16} />}
              onClick={() => {
                setAction('');
                setSp(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </Button>
          )}
        </Group>
        {!isOrgAdmin && (
          <Text size="xs" c="dimmed" mt={6}>
            Filtering by actor, action and date range is available to organization admins.
          </Text>
        )}
      </Paper>
      <QueryState query={q}>
        {(d: any) =>
          d.events.length === 0 ? (
            <EmptyState
              icon={<IconHistory size={26} />}
              title="No activity found"
              description={hasFilters ? 'No events match these filters. Try clearing them.' : 'Changes to charters, sessions, findings and settings will appear here.'}
            />
          ) : (
            <Paper withBorder px="md">
              <AuditFeed events={d.events} />
              <Group justify="space-between" py="sm">
                <Text size="xs" c="dimmed">
                  {d.total} event{d.total === 1 ? '' : 's'}
                </Text>
                {d.total > d.pageSize && <Pagination total={Math.ceil(d.total / d.pageSize)} value={d.page} onChange={(pg) => set({ page: String(pg) })} size="sm" />}
              </Group>
            </Paper>
          )
        }
      </QueryState>
    </>
  );
}
