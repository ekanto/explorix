import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Badge, Button, Checkbox, Group, Menu, Modal, MultiSelect, Paper, Progress, Select, Stack, Table, Tabs, TagsInput, Text, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconArchive,
  IconArrowBackUp,
  IconCopy,
  IconDots,
  IconFilterOff,
  IconFlag,
  IconPlayerPlay,
  IconTag,
  IconTagOff,
  IconTimeline,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { options, PRIORITY, SESSION_STATUS } from '../../lib/constants';
import { duration, fmtDate, fmtDateTime, fromNow, minutes } from '../../lib/format';
import { useProject } from '../../lib/project';
import { LaunchSessionModal } from '../../components/LaunchSessionModal';
import { ListPager, SearchInput, useUrlFilters } from '../../components/ListFilters';
import { EmptyState, PageHeader, PriorityBadge, QueryState, SessionStatusBadge, toastError, toastOk, UserLabel } from '../../components/ui';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['q', 'status', 'testerId', 'charterId', 'milestoneId', 'priority', 'tag', 'from', 'to'];
const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'assigned', label: 'Assigned to me' },
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'Awaiting review' },
  { value: 'completed', label: 'Completed' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'archived', label: 'Archived' },
];

type BulkAction = 'assign' | 'tag' | 'untag' | 'milestone';

export default function Sessions() {
  const { pid, can, milestoneOptions, memberOptions, tagNames } = useProject();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const f = useUrlFilters();
  const [launch, setLaunch] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const view = f.get('view') || 'all';
  const isLead = can('LEAD');

  const params = {
    view,
    q: f.get('q'),
    status: f.list('status'),
    testerId: f.get('testerId'),
    charterId: f.get('charterId'),
    milestoneId: f.get('milestoneId'),
    priority: f.list('priority'),
    tag: f.get('tag'),
    from: f.get('from'),
    to: f.get('to'),
    sort: f.get('sort'),
    page: f.page,
    pageSize: PAGE_SIZE,
  };
  const q = useQuery({ queryKey: ['sessions', pid, params], queryFn: () => api.get(p(pid, '/sessions'), params), placeholderData: (prev) => prev });
  const charters = useQuery({ queryKey: ['charters', pid, 'options'], queryFn: () => api.get(p(pid, '/charters'), { pageSize: 200, sort: 'number' }), staleTime: 60_000 });
  const charterOptions = (charters.data?.charters ?? []).map((c: any) => ({ value: c.id, label: `${c.key} · ${c.title}` }));
  const filtered = FILTER_KEYS.some((k) => f.get(k));
  const rows: any[] = q.data?.sessions ?? [];
  const visibleIds = rows.map((s) => s.id);
  const selectedHere = selected.filter((id) => visibleIds.includes(id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sessions', pid] });
    qc.invalidateQueries({ queryKey: ['charters', pid] });
  };

  const setFilters = (patch: Parameters<typeof f.set>[0]) => {
    setSelected([]);
    f.set(patch);
  };

  const canArchive = (s: any) => (isLead || (can('TESTER') && s.tester?.id === user?.id)) && s.status !== 'IN_PROGRESS';

  const duplicate = async (s: any) => {
    try {
      const r = await api.post(p(pid, `/sessions/${s.id}/duplicate`));
      toastOk(`Created ${r.session.key} from ${s.key}`);
      refresh();
      navigate(`/projects/${pid}/sessions/${r.session.id}`);
    } catch (e) {
      toastError(e, 'Could not duplicate session');
    }
  };

  const archiveOne = async (s: any, action: 'archive' | 'unarchive') => {
    try {
      await api.post(p(pid, `/sessions/${s.id}/${action}`));
      toastOk(action === 'archive' ? `${s.key} archived` : `${s.key} restored`);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const runBulk = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const r = await api.post(p(pid, '/sessions/bulk'), { ids: selectedHere, action, ...extra });
      toastOk(`Updated ${r.count} session${r.count === 1 ? '' : 's'}`);
      setSelected([]);
      setBulk(null);
      refresh();
    } catch (e) {
      toastError(e, 'Bulk update failed');
    }
  };

  const bulkArchive = (action: 'archive' | 'unarchive') => {
    if (action === 'unarchive') return void runBulk('unarchive');
    const running = rows.filter((s) => selectedHere.includes(s.id) && s.status === 'IN_PROGRESS').length;
    modals.openConfirmModal({
      title: `Archive ${selectedHere.length} session(s)?`,
      children: (
        <Text size="sm">
          Archived sessions are hidden from the default views; findings are kept.
          {running > 0 && ` ${running} session(s) currently in progress will be skipped.`}
        </Text>
      ),
      labels: { confirm: 'Archive', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => runBulk('archive'),
    });
  };

  return (
    <>
      <PageHeader
        title="Sessions"
        subtitle="Every timeboxed exploratory session in this project — running, waiting for review and done."
        actions={
          can('TESTER') && (
            <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => setLaunch(true)}>
              Start session
            </Button>
          )
        }
      />

      <Tabs
        value={view}
        onChange={(v) => {
          setSelected([]);
          f.set({ view: v === 'all' ? null : v });
        }}
        mb="sm"
      >
        <Tabs.List>
          {VIEWS.map((v) => (
            <Tabs.Tab key={v.value} value={v.value}>
              {v.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Paper withBorder p="sm" mb="md">
        <Group gap="xs" wrap="wrap">
          <SearchInput value={f.get('q')} onChange={(v) => setFilters({ q: v })} placeholder="Search title, charter, notes, S-12…" />
          <MultiSelect aria-label="Status" placeholder={f.list('status').length ? undefined : 'Status'} data={options(SESSION_STATUS)} value={f.list('status')} onChange={(v) => setFilters({ status: v })} w={200} clearable />
          <Select
            aria-label="Tester"
            placeholder="Tester"
            data={[{ value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...memberOptions]}
            value={f.get('testerId') || null}
            onChange={(v) => setFilters({ testerId: v })}
            w={170}
            clearable
            searchable
          />
          <Select aria-label="Charter" placeholder="Charter" data={charterOptions} value={f.get('charterId') || null} onChange={(v) => setFilters({ charterId: v })} w={220} clearable searchable />
          <Select aria-label="Milestone" placeholder="Milestone" data={milestoneOptions} value={f.get('milestoneId') || null} onChange={(v) => setFilters({ milestoneId: v })} w={160} clearable />
          <MultiSelect aria-label="Priority" placeholder={f.list('priority').length ? undefined : 'Priority'} data={options(PRIORITY)} value={f.list('priority')} onChange={(v) => setFilters({ priority: v })} w={150} clearable />
          <Select aria-label="Tag" placeholder="Tag" data={tagNames} value={f.get('tag') || null} onChange={(v) => setFilters({ tag: v })} w={130} clearable searchable />
          <DatePickerInput
            type="range"
            aria-label="Created between"
            placeholder="Created any time"
            value={[f.get('from') || null, f.get('to') || null]}
            onChange={([from, to]) => setFilters({ from, to })}
            clearable
            w={230}
          />
          <Select
            aria-label="Sort"
            data={[
              { value: 'updated', label: 'Recently updated' },
              { value: 'created', label: 'Newest first' },
              { value: 'number', label: 'Key (desc)' },
              { value: 'due', label: 'Due date' },
            ]}
            value={f.get('sort') || 'updated'}
            onChange={(v) => f.set({ sort: v === 'updated' ? null : v })}
            w={160}
            allowDeselect={false}
          />
          {filtered && (
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconFilterOff size={16} />}
              onClick={() => {
                setSelected([]);
                f.clear(['sort', 'view']);
              }}
            >
              Clear
            </Button>
          )}
        </Group>
      </Paper>

      {isLead && selectedHere.length > 0 && (
        <Paper withBorder p="xs" mb="sm" bg="var(--mantine-color-explorix-light)">
          <Group gap="xs">
            <Text size="sm" fw={600} mr="xs">
              {selectedHere.length} selected
            </Text>
            <Button size="xs" variant="default" leftSection={<IconUserPlus size={14} />} onClick={() => setBulk('assign')}>
              Assign tester
            </Button>
            <Button size="xs" variant="default" leftSection={<IconTag size={14} />} onClick={() => setBulk('tag')}>
              Add tags
            </Button>
            <Button size="xs" variant="default" leftSection={<IconTagOff size={14} />} onClick={() => setBulk('untag')}>
              Remove tags
            </Button>
            <Button size="xs" variant="default" leftSection={<IconFlag size={14} />} onClick={() => setBulk('milestone')}>
              Set milestone
            </Button>
            {view === 'archived' ? (
              <Button size="xs" variant="default" leftSection={<IconArrowBackUp size={14} />} onClick={() => bulkArchive('unarchive')}>
                Unarchive
              </Button>
            ) : (
              <Button size="xs" variant="default" color="red" leftSection={<IconArchive size={14} />} onClick={() => bulkArchive('archive')}>
                Archive
              </Button>
            )}
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={() => setSelected([])} ml="auto">
              Clear selection
            </Button>
          </Group>
        </Paper>
      )}

      <QueryState query={q}>
        {(d: any) =>
          d.sessions.length === 0 ? (
            <Paper withBorder>
              <EmptyState
                icon={<IconTimeline size={26} />}
                title={filtered ? 'No sessions match these filters' : view === 'all' ? 'No sessions yet' : `No ${VIEWS.find((v) => v.value === view)?.label.toLowerCase()} sessions`}
                description={
                  filtered
                    ? 'Try removing a filter or searching for something else.'
                    : view === 'all'
                      ? 'Sessions are launched from a charter. Each one is a timeboxed, focused exploration with its own notes, findings and debrief.'
                      : undefined
                }
                action={
                  filtered ? (
                    <Button variant="light" onClick={() => f.clear(['sort', 'view'])}>
                      Clear filters
                    </Button>
                  ) : (
                    view === 'all' &&
                    can('TESTER') && (
                      <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => setLaunch(true)}>
                        Start session
                      </Button>
                    )
                  )
                }
              />
            </Paper>
          ) : (
            <>
              <Paper withBorder>
                <Table.ScrollContainer minWidth={1050}>
                  <Table highlightOnHover verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        {isLead && (
                          <Table.Th w={36}>
                            <Checkbox
                              aria-label="Select all on this page"
                              checked={selectedHere.length === visibleIds.length}
                              indeterminate={selectedHere.length > 0 && selectedHere.length < visibleIds.length}
                              onChange={(e) => setSelected(e.currentTarget.checked ? visibleIds : [])}
                            />
                          </Table.Th>
                        )}
                        <Table.Th w={70}>Key</Table.Th>
                        <Table.Th>Session</Table.Th>
                        <Table.Th>Tester</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Priority</Table.Th>
                        <Table.Th>Time</Table.Th>
                        <Table.Th>Findings</Table.Th>
                        <Table.Th>Started</Table.Th>
                        <Table.Th>Updated</Table.Th>
                        <Table.Th w={40} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.sessions.map((s: any) => {
                        const ratio = s.timeboxMinutes ? s.elapsedSeconds / (s.timeboxMinutes * 60) : 0;
                        const checked = selected.includes(s.id);
                        const overdue = s.dueDate && !s.endedAt && new Date(s.dueDate) < new Date();
                        return (
                          <Table.Tr key={s.id} bg={checked ? 'var(--mantine-color-explorix-light)' : undefined}>
                            {isLead && (
                              <Table.Td>
                                <Checkbox
                                  aria-label={`Select ${s.key}`}
                                  checked={checked}
                                  onChange={(e) => {
                                    const on = e.currentTarget.checked;
                                    setSelected((cur) => (on ? [...cur, s.id] : cur.filter((x) => x !== s.id)));
                                  }}
                                />
                              </Table.Td>
                            )}
                            <Table.Td>
                              <Link to={`/projects/${pid}/sessions/${s.id}`} className="ex-link ex-key">
                                {s.key}
                              </Link>
                            </Table.Td>
                            <Table.Td miw={260} maw={380}>
                              <Link to={`/projects/${pid}/sessions/${s.id}`} className="ex-link">
                                <Text size="sm" fw={600} lineClamp={1}>
                                  {s.title}
                                </Text>
                              </Link>
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                <Link to={`/projects/${pid}/charters/${s.charter.id}`} className="ex-link">
                                  {s.charter.key}
                                </Link>{' '}
                                {s.charter.title}
                              </Text>
                              {(s.milestone || s.tags.length > 0 || s.dueDate || s.archivedAt) && (
                                <Group gap={4} mt={4}>
                                  {s.archivedAt && (
                                    <Badge size="xs" color="dark" variant="light">
                                      archived
                                    </Badge>
                                  )}
                                  {s.dueDate && (
                                    <Badge size="xs" variant="outline" color={overdue ? 'red' : 'gray'}>
                                      due {fmtDate(s.dueDate)}
                                    </Badge>
                                  )}
                                  {s.milestone && (
                                    <Badge size="xs" variant="outline" color="gray">
                                      {s.milestone.name}
                                    </Badge>
                                  )}
                                  {s.tags.slice(0, 4).map((t: string) => (
                                    <Badge key={t} size="xs" variant="light" color="gray">
                                      {t}
                                    </Badge>
                                  ))}
                                </Group>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <UserLabel user={s.tester} />
                            </Table.Td>
                            <Table.Td>
                              <SessionStatusBadge value={s.status} variant="light" />
                            </Table.Td>
                            <Table.Td>
                              <PriorityBadge value={s.priority} />
                            </Table.Td>
                            <Table.Td miw={130} className="ex-nowrap">
                              <Text size="xs" c={s.overTimebox ? 'red' : undefined} fw={s.overTimebox ? 600 : undefined}>
                                {duration(s.elapsedSeconds)} / {minutes(s.timeboxMinutes)}
                              </Text>
                              <Progress value={Math.min(100, ratio * 100)} color={s.overTimebox ? 'red' : 'explorix'} size="xs" mt={2} aria-label="Elapsed vs timebox" />
                              {s.overTimebox && (
                                <Text size="xs" c="red">
                                  +{duration(s.elapsedSeconds - s.timeboxMinutes * 60)} over
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              {s.findingsCount > 0 ? (
                                <Link to={`/projects/${pid}/findings?sessionId=${s.id}`} className="ex-link">
                                  {s.findingsCount}
                                </Link>
                              ) : (
                                <Text size="sm" c="dimmed">
                                  0
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td className="ex-nowrap">
                              <Text size="sm" c="dimmed">
                                {s.startedAt ? fmtDate(s.startedAt) : '—'}
                              </Text>
                            </Table.Td>
                            <Table.Td className="ex-nowrap">
                              <Tooltip label={fmtDateTime(s.updatedAt)}>
                                <Text size="sm" c="dimmed">
                                  {fromNow(s.updatedAt)}
                                </Text>
                              </Tooltip>
                            </Table.Td>
                            <Table.Td>
                              <Menu position="bottom-end" withinPortal>
                                <Menu.Target>
                                  <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${s.key}`}>
                                    <IconDots size={16} />
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => navigate(`/projects/${pid}/sessions/${s.id}`)}>
                                    Open workbench
                                  </Menu.Item>
                                  {can('TESTER') && (
                                    <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => duplicate(s)}>
                                      Duplicate (new session, same setup)
                                    </Menu.Item>
                                  )}
                                  {canArchive(s) &&
                                    (s.archivedAt ? (
                                      <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => archiveOne(s, 'unarchive')}>
                                        Unarchive
                                      </Menu.Item>
                                    ) : (
                                      <Menu.Item leftSection={<IconArchive size={14} />} color="red" onClick={() => archiveOne(s, 'archive')}>
                                        Archive
                                      </Menu.Item>
                                    ))}
                                </Menu.Dropdown>
                              </Menu>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
              <ListPager
                total={d.total}
                page={d.page}
                pageSize={d.pageSize}
                onChange={(page) => {
                  setSelected([]);
                  f.set({ page });
                }}
              />
            </>
          )
        }
      </QueryState>

      <LaunchSessionModal
        opened={launch}
        onClose={() => setLaunch(false)}
        onLaunched={(s) => {
          refresh();
          navigate(`/projects/${pid}/sessions/${s.id}`);
        }}
      />
      <BulkModal action={bulk} count={selectedHere.length} memberOptions={memberOptions} milestoneOptions={milestoneOptions} tagNames={tagNames} onClose={() => setBulk(null)} onRun={runBulk} />
    </>
  );
}

function BulkModal({
  action,
  count,
  memberOptions,
  milestoneOptions,
  tagNames,
  onClose,
  onRun,
}: {
  action: BulkAction | null;
  count: number;
  memberOptions: { value: string; label: string }[];
  milestoneOptions: { value: string; label: string }[];
  tagNames: string[];
  onClose: () => void;
  onRun: (action: string, extra: Record<string, unknown>) => Promise<void>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const titles: Record<BulkAction, string> = { assign: 'Assign tester', tag: 'Add tags', untag: 'Remove tags', milestone: 'Set milestone' };

  const close = () => {
    setValue(null);
    setTags([]);
    onClose();
  };
  const submit = async () => {
    if (!action) return;
    setBusy(true);
    const extra = action === 'assign' ? { testerId: value } : action === 'milestone' ? { milestoneId: value } : { tags };
    await onRun(action, extra);
    setBusy(false);
    setValue(null);
    setTags([]);
  };
  const invalid = (action === 'tag' || action === 'untag') && tags.length === 0;

  return (
    <Modal opened={!!action} onClose={close} title={action ? `${titles[action]} · ${count} session${count === 1 ? '' : 's'}` : ''}>
      <Stack>
        {action === 'assign' && (
          <Select label="Tester" placeholder="Unassigned" description="Leave empty to unassign. The tester is notified." data={memberOptions} value={value} onChange={setValue} searchable clearable data-autofocus />
        )}
        {action === 'milestone' && <Select label="Milestone" placeholder="No milestone" description="Leave empty to clear the milestone." data={milestoneOptions} value={value} onChange={setValue} clearable />}
        {(action === 'tag' || action === 'untag') && (
          <TagsInput label="Tags" data={tagNames} value={tags} onChange={setTags} placeholder="Type and press Enter" clearable data-autofocus maxTags={30} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={invalid}>
            Apply
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
