import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Chip,
  Code,
  Grid,
  Group,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  IconArrowsDiff,
  IconBug,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconFile,
  IconHistory,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { RESULT_CATEGORY } from '../../lib/constants';
import { useProject } from '../../lib/project';
import { Attachments } from '../../components/Attachments';
import { EmptyState, IssueStatusBadge, PageHeader, QueryState, StatCard, StatusPill, toastError, toastOk } from '../../components/ui';
import { FlakyBadge, RunResultBar, RunStatusBadge, fmtMs } from '../../components/AutomationBits';

const CATEGORY_ORDER = ['FAILED', 'BLOCKED', 'RETEST', 'SKIPPED', 'UNTESTED', 'PASSED'];

export default function AutomationRun() {
  const { id } = useParams();
  const { pid, can } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const categories = (sp.get('status') ?? '').split(',').filter(Boolean);
  const suite = sp.get('suite');
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [q] = useDebouncedValue(search.trim(), 350);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [issueFor, setIssueFor] = useState<any>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setSp(next, { replace: true });
  };
  useEffect(() => {
    if (q !== (sp.get('q') ?? '')) set({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const queryKey = ['automation-run', pid, id, categories.join(','), sp.get('q') ?? ''];
  const detail = useQuery({
    queryKey,
    queryFn: () => api.get(p(pid, `/automation/runs/${id}`), { category: categories.length ? categories : undefined, q: sp.get('q') || undefined }),
    placeholderData: (prev) => prev,
  });
  const refetch = () => qc.invalidateQueries({ queryKey: ['automation-run', pid, id] });

  const del = useMutation({
    mutationFn: () => api.del(p(pid, `/automation/runs/${id}`)),
    onSuccess: () => {
      toastOk('Run deleted');
      qc.invalidateQueries({ queryKey: ['automation-runs', pid] });
      qc.invalidateQueries({ queryKey: ['automation-trends', pid] });
      navigate(`/projects/${pid}/automation`);
    },
    onError: (e) => toastError(e),
  });

  const toggle = (rid: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(rid) ? n.delete(rid) : n.add(rid);
      return n;
    });

  return (
    <QueryState query={detail}>
      {(d: any) => {
        const run = { ...d.run, passRate: d.run.totalCount ? Math.round((d.run.passedCount / Math.max(1, d.run.totalCount - d.run.skippedCount)) * 1000) / 10 : null };
        const suites = [...new Set<string>(d.results.map((r: any) => r.test.suite).filter(Boolean))].sort();
        const results = [...d.results]
          .filter((r: any) => !suite || r.test.suite === suite)
          .sort((a: any, b: any) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
        const flakyCount = d.results.filter((r: any) => r.flaky?.flaky).length;
        const counts: Record<string, number> = { FAILED: run.failedCount, PASSED: run.passedCount, SKIPPED: run.skippedCount };
        return (
          <>
            <PageHeader
              kicker={
                <Anchor component={Link} to={`/projects/${pid}/automation`} size="xs" c="dimmed">
                  Automation / {run.key}
                </Anchor>
              }
              title={
                <Group gap="sm">
                  <span>{run.name}</span>
                  <RunStatusBadge status={run.status} />
                </Group>
              }
              subtitle={[run.source?.name, run.framework].filter(Boolean).join(' · ') || undefined}
              actions={
                <>
                  {d.previousRun && (
                    <Button variant="default" leftSection={<IconArrowsDiff size={16} />} component={Link} to={`/projects/${pid}/automation/compare?base=${d.previousRun.id}&head=${run.id}`}>
                      Compare with {d.previousRun.key}
                    </Button>
                  )}
                  {run.ciUrl && (
                    <Button variant="default" leftSection={<IconExternalLink size={16} />} component="a" href={run.ciUrl} target="_blank" rel="noopener noreferrer">
                      CI build
                    </Button>
                  )}
                  {can('LEAD') && (
                    <Button
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() =>
                        modals.openConfirmModal({
                          title: `Delete ${run.key}?`,
                          children: <Text size="sm">This permanently deletes the run and its {run.totalCount} results.</Text>,
                          labels: { confirm: 'Delete run', cancel: 'Cancel' },
                          confirmProps: { color: 'red' },
                          onConfirm: () => del.mutate(),
                        })
                      }
                    >
                      Delete
                    </Button>
                  )}
                </>
              }
            />

            <Grid gap="md" mb="md">
              <Grid.Col span={{ base: 12, lg: 7 }}>
                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                  <StatCard label="Pass rate" value={run.passRate == null ? '—' : `${run.passRate}%`} hint="passed ÷ (total − skipped)" color={run.passRate == null ? undefined : run.passRate >= 95 ? 'green' : run.passRate >= 80 ? 'yellow' : 'red'} />
                  <StatCard label="Failed" value={run.failedCount} color={run.failedCount ? 'red' : undefined} />
                  <StatCard label="Passed" value={run.passedCount} color="green" />
                  <StatCard label="Skipped / other" value={`${run.skippedCount} / ${run.otherCount}`} />
                </SimpleGrid>
                <Paper withBorder p="sm" mt="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      {run.totalCount} tests
                    </Text>
                    {flakyCount > 0 && <Badge color="grape" variant="light">{flakyCount} flaky in this view</Badge>}
                  </Group>
                  <Box mt={6}>
                    <RunResultBar passed={run.passedCount} failed={run.failedCount} skipped={run.skippedCount} other={run.otherCount} total={run.totalCount} w={520} />
                  </Box>
                </Paper>
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 5 }}>
                <Paper withBorder p="md" h="100%">
                  <Table fz="sm" verticalSpacing={3} withRowBorders={false}>
                    <Table.Tbody>
                      <Meta label="Branch" value={run.branch} />
                      <Meta label="Commit" value={run.commitSha && <Code>{run.commitSha}</Code>} />
                      <Meta label="Build" value={run.buildNumber && `#${run.buildNumber}`} />
                      <Meta
                        label="CI"
                        value={
                          run.ciUrl ? (
                            <Anchor href={run.ciUrl} target="_blank" rel="noopener noreferrer" size="sm">
                              {run.ciProvider ?? 'Open build'} <IconExternalLink size={12} />
                            </Anchor>
                          ) : (
                            run.ciProvider
                          )
                        }
                      />
                      <Meta label="Environment" value={run.environment} />
                      <Meta label="Milestone" value={run.milestone?.name} />
                      <Meta label="Framework" value={run.framework} />
                      <Meta label="Duration" value={fmtMs(run.durationMs)} />
                      <Meta label="Started" value={fmtDateTime(run.startedAt)} />
                      <Meta label="Completed" value={run.completedAt && fmtDateTime(run.completedAt)} />
                    </Table.Tbody>
                  </Table>
                </Paper>
              </Grid.Col>
            </Grid>

            <Paper withBorder p="sm" mb="sm">
              <Group gap="sm" align="flex-end" wrap="wrap">
                <div>
                  <Text size="sm" fw={500} mb={4}>
                    Status
                  </Text>
                  <Chip.Group multiple value={categories} onChange={(v) => set({ status: v.length ? v.join(',') : null })}>
                    <Group gap={6}>
                      {['FAILED', 'PASSED', 'SKIPPED', 'BLOCKED', 'RETEST'].map((c) => (
                        <Chip key={c} value={c} size="xs" color={RESULT_CATEGORY[c]?.color}>
                          {RESULT_CATEGORY[c]?.label ?? c}
                          {counts[c] != null ? ` (${counts[c]})` : ''}
                        </Chip>
                      ))}
                    </Group>
                  </Chip.Group>
                </div>
                <TextInput label="Search" placeholder="Test name or suite" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={240} />
                {suites.length > 1 && <Select label="Suite" placeholder="All suites" data={suites} value={suite} onChange={(v) => set({ suite: v })} clearable searchable w={220} />}
                <SegmentedControl
                  ml="auto"
                  size="xs"
                  value={expanded.size ? 'collapse' : 'expand'}
                  onChange={(v) => setExpanded(v === 'collapse' ? new Set(results.filter((r: any) => r.message || r.stackTrace).map((r: any) => r.id)) : new Set())}
                  data={[
                    { value: 'expand', label: 'Collapse all' },
                    { value: 'collapse', label: 'Expand failures' },
                  ]}
                />
              </Group>
            </Paper>

            {d.results.length >= 2000 && (
              <Alert color="yellow" variant="light" mb="sm">
                Showing the first 2,000 results. Use the status filter or search to narrow down.
              </Alert>
            )}

            {results.length === 0 ? (
              <EmptyState title="No results match" description="Try clearing the status filter or search." />
            ) : (
              <Paper withBorder>
                <Table.ScrollContainer minWidth={900}>
                  <Table verticalSpacing="xs" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={32} />
                        <Table.Th>Test</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Duration</Table.Th>
                        <Table.Th>Retries</Table.Th>
                        <Table.Th>Issue</Table.Th>
                        <Table.Th w={90} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {results.map((r: any) => {
                        const open = expanded.has(r.id);
                        const failing = r.category === 'FAILED' || r.category === 'BLOCKED';
                        return (
                          <Fragment key={r.id}>
                            <Table.Tr style={{ cursor: 'pointer' }} onClick={() => toggle(r.id)}>
                              <Table.Td>
                                <ActionIcon variant="subtle" color="gray" size="sm" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
                                  {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                                </ActionIcon>
                              </Table.Td>
                              <Table.Td maw={480}>
                                <Group gap={6} wrap="nowrap">
                                  <Text size="sm" lineClamp={1} fw={failing ? 500 : undefined}>
                                    {r.test.name}
                                  </Text>
                                  <FlakyBadge flaky={r.flaky} />
                                </Group>
                                <Text size="xs" c="dimmed" lineClamp={1}>
                                  {[r.test.suite, r.test.file].filter(Boolean).join(' · ')}
                                </Text>
                                {!open && r.message && (
                                  <Text size="xs" c="red.7" ff="monospace" lineClamp={1}>
                                    {r.message}
                                  </Text>
                                )}
                              </Table.Td>
                              <Table.Td>
                                <Tooltip label={`Reported as "${r.rawStatus}"`} disabled={!r.rawStatus}>
                                  <span>
                                    <StatusPill status={r.status} />
                                  </span>
                                </Tooltip>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm">{fmtMs(r.durationMs)}</Text>
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c={r.retries ? undefined : 'dimmed'}>
                                  {r.retries || '—'}
                                </Text>
                              </Table.Td>
                              <Table.Td onClick={(e) => e.stopPropagation()}>
                                {r.issue ? (
                                  <Group gap={4} wrap="nowrap">
                                    <Anchor component={Link} to={`/projects/${pid}/issues/${r.issue.id}`} size="sm">
                                      {r.issue.key}
                                    </Anchor>
                                    <IssueStatusBadge value={r.issue.status} size="xs" variant="light" />
                                  </Group>
                                ) : failing && can('TESTER') ? (
                                  <Button size="compact-xs" variant="light" color="red" leftSection={<IconBug size={12} />} onClick={() => setIssueFor(r)}>
                                    Create issue
                                  </Button>
                                ) : (
                                  <Text size="sm" c="dimmed">
                                    —
                                  </Text>
                                )}
                              </Table.Td>
                              <Table.Td onClick={(e) => e.stopPropagation()}>
                                <Tooltip label="Test history">
                                  <ActionIcon component={Link} to={`/projects/${pid}/automation/tests/${r.testId}`} variant="subtle" color="gray" aria-label="Test history">
                                    <IconHistory size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              </Table.Td>
                            </Table.Tr>
                            {open && (
                              <Table.Tr>
                                <Table.Td />
                                <Table.Td colSpan={6} pb="md">
                                  <ResultDetail r={r} onChange={refetch} canUpload={can('TESTER')} onIssue={() => setIssueFor(r)} />
                                </Table.Td>
                              </Table.Tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <Text size="xs" c="dimmed" p="sm">
                  {results.length} result{results.length === 1 ? '' : 's'} shown
                </Text>
              </Paper>
            )}
            <IssueModal result={issueFor} onClose={() => setIssueFor(null)} onDone={refetch} />
          </>
        );
      }}
    </QueryState>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td w={110} c="dimmed" py={3}>
        {label}
      </Table.Td>
      <Table.Td py={3}>{value || <Text span c="dimmed" size="sm">—</Text>}</Table.Td>
    </Table.Tr>
  );
}

function ResultDetail({ r, onChange, canUpload, onIssue }: { r: any; onChange: () => void; canUpload: boolean; onIssue: () => void }) {
  const { pid } = useProject();
  const artifacts: any[] = Array.isArray(r.artifacts) ? r.artifacts : [];
  return (
    <Stack gap="sm">
      {r.message && (
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={2}>
            Failure message
          </Text>
          <ScrollArea.Autosize mah={160}>
            <Code block c="red.8" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {r.message}
            </Code>
          </ScrollArea.Autosize>
        </div>
      )}
      {r.stackTrace && (
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={2}>
            Stack trace
          </Text>
          <ScrollArea.Autosize mah={320} type="auto">
            <Code block fz={11} style={{ whiteSpace: 'pre' }}>
              {r.stackTrace}
            </Code>
          </ScrollArea.Autosize>
        </div>
      )}
      {!r.message && !r.stackTrace && (
        <Text size="sm" c="dimmed">
          No failure output recorded.
        </Text>
      )}
      {r.flaky?.flaky && (
        <Text size="xs" c="grape.7">
          Flaky evidence (last 10 completed runs): {r.flaky.flips} pass/fail flip{r.flaky.flips === 1 ? '' : 's'}, {r.flaky.passedOnRetry} pass{r.flaky.passedOnRetry === 1 ? '' : 'es'} on retry.{' '}
          <Anchor component={Link} to={`/projects/${pid}/automation/tests/${r.testId}`} size="xs">
            See history
          </Anchor>
        </Text>
      )}
      {artifacts.length > 0 && (
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={4}>
            CI artifacts
          </Text>
          <Group gap="xs">
            {artifacts.map((a, i) =>
              a.url ? (
                <Button key={i} size="compact-xs" variant="default" component="a" href={a.url} target="_blank" rel="noopener noreferrer" leftSection={<IconExternalLink size={12} />}>
                  {a.name}
                </Button>
              ) : (
                <Tooltip key={i} label={a.path ?? 'No link provided'}>
                  <Badge variant="outline" color="gray" leftSection={<IconFile size={12} />} tt="none">
                    {a.name}
                  </Badge>
                </Tooltip>
              ),
            )}
          </Group>
        </div>
      )}
      <div>
        <Text size="xs" fw={600} c="dimmed" mb={4}>
          Attachments
        </Text>
        <Attachments targetType="automationResult" targetId={r.id} items={r.attachments ?? []} canUpload={canUpload} onChange={onChange} compact />
      </div>
      {!r.issue && canUpload && r.category !== 'PASSED' && (
        <Group>
          <Button size="xs" variant="light" color="red" leftSection={<IconBug size={14} />} onClick={onIssue}>
            Create or link issue
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function IssueModal({ result, onClose, onDone }: { result: any; onClose: () => void; onDone: () => void }) {
  const { pid } = useProject();
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [title, setTitle] = useState('');
  const [issueId, setIssueId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  useEffect(() => {
    if (result) {
      setMode('new');
      setTitle(`Automated test failing: ${result.test.name}`.slice(0, 300));
      setIssueId(null);
      setSearch('');
    }
  }, [result]);
  const issues = useQuery({
    queryKey: ['issues-pick', pid, q],
    queryFn: () => api.get(p(pid, '/issues'), { q: q || undefined, pageSize: 20 }),
    enabled: !!result && mode === 'link',
  });
  const options = useMemo(() => (issues.data?.issues ?? []).map((i: any) => ({ value: i.id, label: `${i.key} · ${i.title}` })), [issues.data]);
  const save = useMutation({
    mutationFn: () => api.post(p(pid, `/automation/results/${result.id}/issue`), mode === 'new' ? { title: title.trim() || undefined } : { issueId }),
    onSuccess: (r: any) => {
      toastOk(`${mode === 'new' ? 'Created' : 'Linked'} ${r.issue.key}`);
      onDone();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Modal opened={!!result} onClose={onClose} title="Issue for failing test" size="lg">
      {result && (
        <Stack gap="sm">
          <Text size="sm">
            <b>{result.test.name}</b>
            {result.test.suite && <Text span c="dimmed"> · {result.test.suite}</Text>}
          </Text>
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as 'new' | 'link')}
            data={[
              { value: 'new', label: 'Create new issue' },
              { value: 'link', label: 'Link existing issue' },
            ]}
          />
          {mode === 'new' ? (
            <>
              <TextInput label="Title" value={title} maxLength={300} onChange={(e) => setTitle(e.currentTarget.value)} />
              <Text size="xs" c="dimmed">
                The description is filled automatically with the run, branch, commit, failure message and stack trace.
              </Text>
            </>
          ) : (
            <Select label="Issue" placeholder="Search issues" searchable searchValue={search} onSearchChange={setSearch} data={options} value={issueId} onChange={setIssueId} filter={({ options: o }) => o} nothingFoundMessage={issues.isFetching ? 'Searching…' : 'No issues found'} />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={mode === 'link' && !issueId}>
              {mode === 'new' ? 'Create issue' : 'Link issue'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
