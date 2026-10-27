import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Grid,
  Group,
  Kbd,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBug,
  IconChevronLeft,
  IconClipboardCheck,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { api, ApiError, p } from '../../lib/api';
import { options, RESULT_CATEGORY, SEVERITY } from '../../lib/constants';
import { clock, duration, fmtDateTime, fromNow } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { projectKey, useProject } from '../../lib/project';
import { EmptyState, Loading, ErrorState, PageHeader, PriorityBadge, QueryState, StatusPill, TextBlock, toastError, toastOk, UserAvatar, UserLabel } from '../../components/ui';
import { Attachments } from '../../components/Attachments';
import { ExportMenu } from '../../components/ExportMenu';
import { GherkinView, LinkPickerModal, RUN_STATUS, RunProgressBar, StepsTable, useUrlState } from '../../components/TestingWidgets';

const CATS = ['PASSED', 'FAILED', 'BLOCKED', 'RETEST', 'SKIPPED', 'UNTESTED'] as const;
const catOf = (item: any): string => item.status?.category ?? 'UNTESTED';

export default function TestRunDetail() {
  const { id } = useParams();
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['test-run', pid, id], queryFn: () => api.get(p(pid, `/test-runs/${id}`)) });
  return <QueryState query={q}>{(d: any) => <RunView run={d.run} />}</QueryState>;
}

function RunView({ run }: { run: any }) {
  const { pid, can, memberOptions } = useProject();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { get, set } = useUrlState();
  const canTest = can('TESTER');
  const closed = run.status === 'CLOSED';
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const fq = get('fq').toLowerCase();
  const fs = get('fs');
  const fa = get('fa');
  const ff = get('ff');
  const items: any[] = run.items;
  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (!fq || i.testCase.key.toLowerCase().includes(fq) || i.testCase.title.toLowerCase().includes(fq)) &&
          (!fs || catOf(i) === fs) &&
          (!fa || (fa === 'none' ? !i.assigneeId : fa === 'me' ? i.assigneeId === user?.id : i.assigneeId === fa)) &&
          (!ff || (ff === 'none' ? !i.testCase.folder : i.testCase.folder?.id === ff)),
      ),
    [items, fq, fs, fa, ff, user?.id],
  );
  const folderOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.testCase.folder) m.set(i.testCase.folder.id, i.testCase.folder.name);
    return [...[...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), { value: 'none', label: 'Unfiled' }];
  }, [items]);

  const selectedId = get('item') || visible[0]?.id || items[0]?.id || null;
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const idx = visible.findIndex((i) => i.id === selectedId);
  const select = (itemId: string | undefined) => itemId && set({ item: itemId });
  const go = (delta: number) => {
    if (!visible.length) return;
    const n = idx < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, idx + delta));
    select(visible[n]?.id);
  };
  const nextUntested = () => {
    const after = [...visible.slice(idx + 1), ...visible.slice(0, Math.max(0, idx))];
    const n = after.find((i) => catOf(i) === 'UNTESTED' || catOf(i) === 'RETEST') ?? visible[idx + 1];
    if (n) select(n.id);
  };

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-item="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  useHotkeys([
    ['j', () => go(1)],
    ['k', () => go(-1)],
  ]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['test-run', pid, run.id] });
    qc.invalidateQueries({ queryKey: ['test-runs', pid] });
    qc.invalidateQueries({ queryKey: ['test-plans', pid] });
  };

  const toggleClosed = () =>
    modals.openConfirmModal({
      title: closed ? `Reopen ${run.key}?` : `Close ${run.key}?`,
      children: (
        <Text size="sm">
          {closed
            ? 'Testers will be able to record results and add tests again.'
            : `Closing freezes the run: no more results or tests can be added. ${run.progress.total - run.progress.done} test(s) are still untested or need a retest.`}
        </Text>
      ),
      labels: { confirm: closed ? 'Reopen run' : 'Close run', cancel: 'Cancel' },
      onConfirm: async () => {
        try {
          await api.post(p(pid, `/test-runs/${run.id}/${closed ? 'reopen' : 'close'}`));
          toastOk(closed ? 'Run reopened' : 'Run closed');
          refresh();
        } catch (e) {
          toastError(e);
        }
      },
    });

  const addCases = async (ids: string[]) => {
    const r = await api.post(p(pid, `/test-runs/${run.id}/items`), { testCaseIds: ids });
    toastOk(`Added ${r.added} test(s)`);
    refresh();
  };

  const pr = run.progress;
  const filtered = !!(fq || fs || fa || ff);

  return (
    <>
      <Anchor component={Link} to={`/projects/${pid}/test-runs`} size="sm" c="dimmed" mb="xs" display="inline-flex" style={{ alignItems: 'center', gap: 4 }}>
        <IconChevronLeft size={14} /> Test runs
      </Anchor>
      <PageHeader
        kicker={run.key}
        title={
          <Group gap="sm" component="span">
            <span>{run.name}</span>
            <Badge variant="light" color={RUN_STATUS[run.status]?.color} size="lg">
              {RUN_STATUS[run.status]?.label}
            </Badge>
          </Group>
        }
        subtitle={
          <Group gap="md" component="span" c="dimmed" fz="sm">
            {run.plan && (
              <Anchor component={Link} to={`/projects/${pid}/test-runs?tab=plans`} size="sm">
                Plan: {run.plan.name}
              </Anchor>
            )}
            <span>Milestone: {run.milestone?.name ?? '—'}</span>
            <span>Environment: {run.environment?.name ?? '—'}</span>
            <span>
              Created by {run.createdBy?.name ?? 'unknown'} {fromNow(run.createdAt)}
            </span>
            {run.closedAt && <span>Closed {fmtDateTime(run.closedAt)}</span>}
          </Group>
        }
        actions={
          <>
            <ExportMenu url={p(pid, `/test-runs/${run.id}/export`)} name={`${run.key}-results`} documents />
            {canTest && !closed && (
              <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
                Add cases
              </Button>
            )}
            {canTest && (
              <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {canTest && (
              <Button variant={closed ? 'light' : 'filled'} color={closed ? 'teal' : 'gray'} leftSection={closed ? <IconLockOpen size={16} /> : <IconLock size={16} />} onClick={toggleClosed}>
                {closed ? 'Reopen' : 'Close run'}
              </Button>
            )}
          </>
        }
      />
      {run.description && (
        <Text size="sm" className="ex-prewrap" mt={-8} mb="md">
          {run.description}
        </Text>
      )}

      <Paper withBorder p="md" mb="md">
        <Group justify="space-between" mb="xs" wrap="wrap" gap="md">
          <Group gap="xl" wrap="wrap">
            {CATS.map((c) => {
              const n = pr[c.toLowerCase()] ?? 0;
              return (
                <UnstyledButton key={c} onClick={() => set({ fs: fs === c ? null : c })} aria-pressed={fs === c} aria-label={`Filter ${RESULT_CATEGORY[c].label}`}>
                  <Text className="ex-label" style={{ textDecoration: fs === c ? 'underline' : undefined }}>
                    {RESULT_CATEGORY[c].label}
                  </Text>
                  <Group gap={6} align="baseline">
                    <Text fz={22} fw={650} className="ex-num" style={n && c !== 'UNTESTED' && c !== 'SKIPPED' ? { color: `var(--mantine-color-${RESULT_CATEGORY[c].color}-text)` } : undefined}>
                      {n}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {pr.total ? Math.round((n / pr.total) * 100) : 0}%
                    </Text>
                  </Group>
                </UnstyledButton>
              );
            })}
          </Group>
          <Stack gap={0} align="flex-end">
            <Text fz={22} fw={650} className="ex-num">
              {pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%
            </Text>
            <Text size="xs" c="dimmed">
              {pr.done} of {pr.total} executed
            </Text>
          </Stack>
        </Group>
        <RunProgressBar progress={pr} size="lg" />
      </Paper>

      {closed && (
        <Alert color="gray" icon={<IconLock size={18} />} mb="md">
          This run is closed. Results are read-only{canTest ? '; reopen it to continue testing' : ''}.
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="This run has no tests"
          description="Add test cases from the repository to start executing."
          icon={<IconClipboardCheck size={26} />}
          action={
            canTest &&
            !closed && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
                Add cases
              </Button>
            )
          }
        />
      ) : (
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 5, lg: 4 }}>
            <Paper withBorder>
              <Stack gap="xs" p="sm">
                <ListSearch value={get('fq')} onChange={(v) => set({ fq: v })} />
                <SimpleGrid cols={3} spacing={6}>
                  <Select size="xs" placeholder="Status" data={options(RESULT_CATEGORY)} value={fs || null} onChange={(v) => set({ fs: v })} clearable aria-label="Filter by status" />
                  <Select
                    size="xs"
                    placeholder="Assignee"
                    data={[{ value: 'me', label: 'Me' }, { value: 'none', label: 'Unassigned' }, ...memberOptions]}
                    value={fa || null}
                    onChange={(v) => set({ fa: v })}
                    clearable
                    searchable
                    aria-label="Filter by assignee"
                  />
                  <Select size="xs" placeholder="Folder" data={folderOptions} value={ff || null} onChange={(v) => set({ ff: v })} clearable searchable aria-label="Filter by folder" />
                </SimpleGrid>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {visible.length} of {items.length} tests
                  </Text>
                  <Group gap={4}>
                    {filtered && (
                      <Button size="compact-xs" variant="subtle" onClick={() => set({ fq: null, fs: null, fa: null, ff: null })}>
                        Clear
                      </Button>
                    )}
                    <Tooltip label="Next / previous test">
                      <Text size="xs" c="dimmed">
                        <Kbd size="xs">j</Kbd> <Kbd size="xs">k</Kbd>
                      </Text>
                    </Tooltip>
                  </Group>
                </Group>
              </Stack>
              <Divider />
              <ScrollArea.Autosize mah="calc(100vh - 330px)" viewportRef={listRef}>
                {visible.length === 0 ? (
                  <Text size="sm" c="dimmed" p="md" ta="center">
                    No tests match these filters.
                  </Text>
                ) : (
                  visible.map((i) => <ItemRow key={i.id} item={i} active={i.id === selectedId} onClick={() => select(i.id)} />)
                )}
              </ScrollArea.Autosize>
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7, lg: 8 }}>
            {selected ? (
              <ItemPanel
                key={selected.id}
                run={run}
                item={selected}
                position={idx >= 0 ? `${idx + 1} of ${visible.length}` : 'Hidden by filters'}
                onPrev={idx > 0 ? () => go(-1) : undefined}
                onNext={idx >= 0 && idx < visible.length - 1 ? () => go(1) : undefined}
                onRecorded={(advance) => {
                  refresh();
                  if (advance) nextUntested();
                }}
                memberOptions={memberOptions}
              />
            ) : (
              <EmptyState title="Select a test" />
            )}
          </Grid.Col>
        </Grid>
      )}

      <EditRunModal opened={editing} run={run} onClose={() => setEditing(false)} onSaved={refresh} />
      <LinkPickerModal opened={adding} onClose={() => setAdding(false)} title={`Add test cases to ${run.key}`} kind="testCase" exclude={items.map((i) => i.testCaseId)} confirmLabel="Add to run" onConfirm={addCases} />
    </>
  );
}

function ListSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [debounced] = useDebouncedValue(text, 200);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
  }, [debounced]);
  return <TextInput size="xs" leftSection={<IconSearch size={14} />} placeholder="Search key or title…" value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Search tests" />;
}

function ItemRow({ item, active, onClick }: { item: any; active: boolean; onClick: () => void }) {
  const cat = catOf(item);
  const color = item.status?.color ?? 'gray';
  return (
    <UnstyledButton
      data-item={item.id}
      onClick={onClick}
      w="100%"
      px="sm"
      py={8}
      aria-current={active ? 'true' : undefined}
      style={{
        display: 'block',
        borderLeft: `3px solid ${active ? 'var(--mantine-primary-color-filled)' : 'transparent'}`,
        background: active ? 'var(--mantine-primary-color-light)' : undefined,
        borderBottom: '1px solid var(--ex-border)',
      }}
    >
      <Group gap="sm" wrap="nowrap">
        <Tooltip label={item.status?.name ?? 'Untested'}>
          <Box
            w={10}
            h={10}
            style={{ borderRadius: 99, flexShrink: 0, background: cat === 'UNTESTED' ? 'transparent' : `var(--mantine-color-${color}-6, ${color})`, border: cat === 'UNTESTED' ? '2px solid var(--mantine-color-gray-5)' : undefined }}
          />
        </Tooltip>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" lineClamp={1} fw={active ? 600 : 400}>
            <span className="ex-key">{item.testCase.key}</span> {item.testCase.title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {item.status?.name ?? 'Untested'}
            {item.testCase.folder ? ` · ${item.testCase.folder.name}` : ''}
          </Text>
        </Box>
        {item.assignee && (
          <Tooltip label={item.assignee.name}>
            <span>
              <UserAvatar user={item.assignee} size={22} />
            </span>
          </Tooltip>
        )}
      </Group>
    </UnstyledButton>
  );
}

// ---------------------------------------------------------------------------
// Selected test
// ---------------------------------------------------------------------------

function ItemPanel({
  run,
  item,
  position,
  onPrev,
  onNext,
  onRecorded,
  memberOptions,
}: {
  run: any;
  item: any;
  position: string;
  onPrev?: () => void;
  onNext?: () => void;
  onRecorded: (advance: boolean) => void;
  memberOptions: { value: string; label: string }[];
}) {
  const { pid, can } = useProject();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['run-item', pid, run.id, item.id], queryFn: () => api.get(p(pid, `/test-runs/${run.id}/items/${item.id}/results`)) });
  const closed = run.status === 'CLOSED';
  const canTest = can('TESTER');

  const reloadItem = () => qc.invalidateQueries({ queryKey: ['run-item', pid, run.id, item.id] });

  const assign = async (assigneeId: string | null) => {
    try {
      await api.patch(p(pid, `/test-runs/${run.id}/items/${item.id}`), { assigneeId });
      toastOk(assigneeId ? 'Test assigned' : 'Assignee cleared');
      onRecorded(false);
    } catch (e) {
      toastError(e);
    }
  };

  const remove = () =>
    modals.openConfirmModal({
      title: `Remove ${item.testCase.key} from this run?`,
      children: <Text size="sm">Its results in this run are deleted as well. The test case itself is not affected.</Text>,
      labels: { confirm: 'Remove', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(p(pid, `/test-runs/${run.id}/items/${item.id}`));
          toastOk('Removed from run');
          onRecorded(true);
        } catch (e) {
          toastError(e);
        }
      },
    });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const tc = q.data.item.testCase;
  const results: any[] = q.data.results;

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
          <Box style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed" fw={600}>
              {position}
            </Text>
            <Title order={4} lh={1.3}>
              <Anchor component={Link} to={`/projects/${pid}/test-cases/${tc.id}`} c="inherit" underline="hover">
                <span className="ex-key">{tc.key}</span> {tc.title}
              </Anchor>
            </Title>
            <Group gap="xs" mt={6}>
              <StatusPill status={item.status} />
              <PriorityBadge value={tc.priority} size="sm" />
              {item.testCase.folder && (
                <Badge size="sm" variant="outline" color="gray">
                  {item.testCase.folder.name}
                </Badge>
              )}
              {tc.estimateMinutes != null && (
                <Badge size="sm" variant="default">
                  Est. {duration(tc.estimateMinutes * 60)}
                </Badge>
              )}
            </Group>
          </Box>
          <Group gap={4} wrap="nowrap">
            <Tooltip label="Previous (k)">
              <ActionIcon variant="default" onClick={onPrev} disabled={!onPrev} aria-label="Previous test">
                <IconArrowLeft size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Next (j)">
              <ActionIcon variant="default" onClick={onNext} disabled={!onNext} aria-label="Next test">
                <IconArrowRight size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Group gap="sm" mb="md" align="flex-end">
          <Select
            size="xs"
            label="Assigned tester"
            placeholder="Unassigned"
            data={memberOptions}
            value={item.assigneeId ?? null}
            onChange={(v) => assign(v)}
            clearable
            searchable
            disabled={!canTest}
            w={220}
          />
          {can('LEAD') && (
            <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={remove}>
              Remove from run
            </Button>
          )}
        </Group>
        {item.caseVersion !== tc.version && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} mb="md" p="xs">
            <Text size="sm">
              The run was created with v{item.caseVersion}; the case has since changed to v{tc.version}. The current content is shown below.
            </Text>
          </Alert>
        )}
        <Stack gap="md">
          <TextBlock label="Preconditions" value={tc.preconditions} />
          <TextBlock label="Test data" value={tc.testData} />
          {tc.format === 'GHERKIN' ? (
            <GherkinView source={tc.gherkin} />
          ) : tc.format === 'TEXT' ? (
            <TextBlock label="Instructions" value={tc.description || 'No instructions written for this case.'} />
          ) : (
            <>
              {tc.description && <TextBlock label="Description" value={tc.description} />}
              <StepsTable steps={tc.steps} />
            </>
          )}
        </Stack>
      </Paper>

      {canTest && !closed && <ResultForm run={run} item={item} tc={tc} onRecorded={(advance) => (reloadItem(), onRecorded(advance))} />}

      <div>
        <Title order={5} mb="sm">
          Result history ({results.length})
        </Title>
        {results.length === 0 ? (
          <Text size="sm" c="dimmed">
            No results recorded for this test in this run.
          </Text>
        ) : (
          <Stack gap="sm">
            {results.map((r) => (
              <ResultEntry key={r.id} r={r} canUpload={canTest} onChange={reloadItem} />
            ))}
          </Stack>
        )}
      </div>
    </Stack>
  );
}

function ResultEntry({ r, canUpload, onChange }: { r: any; canUpload: boolean; onChange: () => void }) {
  const { pid, project } = useProject();
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Group gap="sm">
          <StatusPill status={r.status} />
          <UserLabel user={r.createdBy} fallback="Unknown" />
        </Group>
        <Group gap="sm">
          {r.elapsedSeconds != null && (
            <Text size="xs" c="dimmed">
              {duration(r.elapsedSeconds)}
            </Text>
          )}
          <Tooltip label={fmtDateTime(r.createdAt)}>
            <Text size="xs" c="dimmed">
              {fromNow(r.createdAt)}
            </Text>
          </Tooltip>
        </Group>
      </Group>
      {r.comment && (
        <Text size="sm" className="ex-prewrap" mt="xs">
          {r.comment}
        </Text>
      )}
      {r.issue && (
        <Group gap={6} mt="xs">
          <IconBug size={14} color="var(--mantine-color-red-6)" />
          <Text size="sm" component={Link} to={`/projects/${pid}/issues/${r.issue.id}`} className="ex-link">
            <span className="ex-key">
              {project.key}-{r.issue.number}
            </span>{' '}
            {r.issue.title}
          </Text>
        </Group>
      )}
      <Box mt="xs">
        <Attachments targetType="testResult" targetId={r.id} items={r.attachments ?? []} canUpload={canUpload} onChange={onChange} compact />
      </Box>
    </Paper>
  );
}

type DefectMode = 'none' | 'link' | 'create';

function ResultForm({ run, item, tc, onRecorded }: { run: any; item: any; tc: any; onRecorded: (advance: boolean) => void }) {
  const { pid, statuses } = useProject();
  const qc = useQueryClient();
  const manual = useMemo(() => {
    const s = statuses.filter((x) => (x.scope === 'MANUAL' || x.scope === 'BOTH') && !(x as any).archivedAt).sort((a, b) => a.position - b.position);
    return s;
  }, [statuses]);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [defect, setDefect] = useState<DefectMode>('none');
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueSearch, setIssueSearch] = useState('');
  const [issueTitle, setIssueTitle] = useState(`${tc.key} failed: ${tc.title}`.slice(0, 300));
  const [severity, setSeverity] = useState<string>('MAJOR');
  const [advance, setAdvance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const chosen = manual.find((s) => s.id === statusId);
  const failing = !!chosen && ['FAILED', 'BLOCKED'].includes(chosen.category);

  const [debouncedSearch] = useDebouncedValue(issueSearch, 250);
  const issues = useQuery({
    queryKey: ['issues', pid, 'picker', debouncedSearch],
    queryFn: () => api.get(p(pid, '/issues'), { q: debouncedSearch || undefined, pageSize: 20 }),
    enabled: defect === 'link',
  });
  const issueOptions = (issues.data?.issues ?? []).map((i: any) => ({ value: i.id, label: `${i.key} · ${i.title}` }));

  const submit = async (sid = statusId) => {
    if (!sid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(p(pid, `/test-runs/${run.id}/items/${item.id}/results`), {
        statusId: sid,
        comment: comment.trim() || null,
        elapsedSeconds: Math.min(elapsed, 86_400),
        issueId: defect === 'link' ? issueId : undefined,
        createIssue: defect === 'create' ? { title: issueTitle.trim(), severity } : undefined,
      });
      const st = manual.find((s) => s.id === sid);
      toastOk(`${tc.key} marked ${st?.name ?? 'recorded'}${defect === 'create' ? ' and issue created' : ''}`);
      if (defect === 'create') qc.invalidateQueries({ queryKey: ['issues', pid] });
      setStatusId(null);
      setComment('');
      setDefect('none');
      setIssueId(null);
      setElapsed(0);
      qc.invalidateQueries({ queryKey: projectKey(pid) });
      qc.invalidateQueries({ queryKey: ['test-case', pid, tc.id] });
      onRecorded(advance);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  useHotkeys(manual.slice(0, 9).map((s, i) => [String(i + 1), () => setStatusId(s.id)] as [string, () => void]));
  useHotkeys([['mod+Enter', () => submit()]], []);

  const defectInvalid = (defect === 'link' && !issueId) || (defect === 'create' && !issueTitle.trim());

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Record result</Title>
        <Group gap={6}>
          <Text size="sm" ff="monospace" c="dimmed" aria-label="Elapsed time">
            {clock(elapsed)}
          </Text>
          <Tooltip label={running ? 'Pause timer' : 'Resume timer'}>
            <ActionIcon variant="subtle" color="gray" onClick={() => setRunning((r) => !r)} aria-label={running ? 'Pause timer' : 'Resume timer'}>
              {running ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Reset timer">
            <ActionIcon variant="subtle" color="gray" onClick={() => setElapsed(0)} aria-label="Reset timer">
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Stack gap="sm">
        {manual.length === 0 ? (
          <Alert color="yellow">No manual result statuses are configured for this project. Ask an admin to add some in project settings.</Alert>
        ) : (
          <Group gap="xs">
            {manual.map((s, i) => (
              <Button
                key={s.id}
                color={s.color}
                variant={statusId === s.id ? 'filled' : 'light'}
                onClick={() => setStatusId(s.id)}
                rightSection={i < 9 ? <Kbd size="xs">{i + 1}</Kbd> : undefined}
                aria-pressed={statusId === s.id}
              >
                {s.name}
              </Button>
            ))}
          </Group>
        )}
        <Textarea placeholder="Comment: actual result, build, notes…" value={comment} onChange={(e) => setComment(e.currentTarget.value)} autosize minRows={2} maxRows={8} aria-label="Comment" />
        <div>
          <Group gap="xs" mb={6}>
            <IconBug size={16} color="var(--mantine-color-red-6)" />
            <Text size="sm" fw={500}>
              Defect
            </Text>
          </Group>
          <SegmentedControl
            size="xs"
            value={defect}
            onChange={(v) => setDefect(v as DefectMode)}
            data={[
              { value: 'none', label: 'None' },
              { value: 'link', label: 'Link existing issue' },
              { value: 'create', label: 'Create issue' },
            ]}
          />
          {defect === 'none' && failing && (
            <Text size="xs" c="dimmed" mt={4}>
              Failed or blocked: consider linking an existing issue or filing a new one.
            </Text>
          )}
          {defect === 'link' && (
            <Select
              mt="xs"
              placeholder="Search issues by key or title…"
              data={issueOptions}
              value={issueId}
              onChange={setIssueId}
              searchable
              searchValue={issueSearch}
              onSearchChange={setIssueSearch}
              filter={({ options }) => options}
              nothingFoundMessage={issues.isLoading ? 'Searching…' : 'No issues found'}
              clearable
              aria-label="Issue"
            />
          )}
          {defect === 'create' && (
            <Group mt="xs" align="flex-start" gap="xs" wrap="nowrap">
              <TextInput style={{ flex: 1 }} value={issueTitle} onChange={(e) => setIssueTitle(e.currentTarget.value)} placeholder="Issue title" aria-label="Issue title" maxLength={300} />
              <Select w={130} data={options(SEVERITY)} value={severity} onChange={(v) => v && setSeverity(v)} allowDeselect={false} aria-label="Severity" />
            </Group>
          )}
          {defect === 'create' && (
            <Text size="xs" c="dimmed" mt={4}>
              The new issue references this run and test case and includes your comment.
            </Text>
          )}
        </div>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="space-between">
          <Checkbox size="xs" label="Go to next untested test after saving" checked={advance} onChange={(e) => setAdvance(e.currentTarget.checked)} />
          <Tooltip label={
            <span>
              Save (<Kbd size="xs">Ctrl</Kbd>+<Kbd size="xs">Enter</Kbd>)
            </span>
          }>
            <Button onClick={() => submit()} loading={busy} disabled={!statusId || defectInvalid} color={chosen?.color}>
              {chosen ? `Save as ${chosen.name}` : 'Choose a result'}
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Edit run
// ---------------------------------------------------------------------------

function EditRunModal({ opened, run, onClose, onSaved }: { opened: boolean; run: any; onClose: () => void; onSaved: () => void }) {
  const { pid, milestoneOptions, environmentOptions } = useProject();
  const plans = useQuery({ queryKey: ['test-plans', pid, 'options'], queryFn: () => api.get(p(pid, '/test-plans')), enabled: opened });
  const planOptions = (plans.data?.plans ?? []).map((pl: any) => ({ value: pl.id, label: pl.name }));
  if (run.plan && !planOptions.some((o: any) => o.value === run.plan.id)) planOptions.push({ value: run.plan.id, label: run.plan.name });
  const [v, setV] = useState({ name: '', description: '', milestoneId: null as string | null, environmentId: null as string | null, planId: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (opened) setV({ name: run.name, description: run.description ?? '', milestoneId: run.milestoneId, environmentId: run.environmentId, planId: run.planId });
    setError(null);
  }, [opened]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(p(pid, `/test-runs/${run.id}`), { ...v, description: v.description || null });
      toastOk('Run updated');
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={`Edit ${run.key}`}>
      <Stack>
        <TextInput label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <Textarea label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.currentTarget.value })} autosize minRows={2} maxRows={6} />
        <Select label="Milestone" data={milestoneOptions} value={v.milestoneId} onChange={(x) => setV({ ...v, milestoneId: x })} clearable searchable />
        <Select label="Environment" data={environmentOptions} value={v.environmentId} onChange={(x) => setV({ ...v, environmentId: x })} clearable searchable />
        <Select label="Test plan" data={planOptions} value={v.planId} onChange={(x) => setV({ ...v, planId: x })} clearable searchable />
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!v.name.trim()}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

