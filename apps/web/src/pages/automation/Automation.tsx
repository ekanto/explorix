import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Grid,
  Group,
  List,
  Menu,
  Modal,
  Pagination,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { BarChart, LineChart } from '@mantine/charts';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  IconArrowsDiff,
  IconBrandGithub,
  IconCheck,
  IconDots,
  IconExternalLink,
  IconFileUpload,
  IconFilterOff,
  IconInfoCircle,
  IconKey,
  IconPlugConnected,
  IconRefreshAlert,
  IconRobot,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { api, ApiError, p, qs } from '../../lib/api';
import { fmtDate, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, QueryState, ResultBadge, toastError, toastOk } from '../../components/ui';
import { CopyCode } from '../../components/CopyCode';
import { FlakyBadge, HistoryStrip, RunResultBar, RunStatusBadge, fmtMs } from '../../components/AutomationBits';

type Setter = (patch: Record<string, string | null>) => void;

function useUrlState() {
  const [sp, setSp] = useSearchParams();
  const set: Setter = (patch) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setSp(next, { replace: true });
  };
  return { sp, set };
}

export default function Automation() {
  const { project, can } = useProject();
  const { sp, set } = useUrlState();
  const tab = sp.get('tab') ?? 'runs';
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <PageHeader
        kicker={project.key}
        title="Automation"
        subtitle="Results ingested from CI — JUnit XML, Playwright JSON or the native JSON API."
        actions={
          can('TESTER') && (
            <Button leftSection={<IconFileUpload size={16} />} onClick={() => setImportOpen(true)}>
              Import results
            </Button>
          )
        }
      />
      <Tabs value={tab} onChange={(t) => set({ tab: t === 'runs' ? null : t })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="runs">Runs</Tabs.Tab>
          <Tabs.Tab value="sources">Sources</Tabs.Tab>
          <Tabs.Tab value="flaky" leftSection={<IconRefreshAlert size={14} />}>
            Flaky tests
          </Tabs.Tab>
          <Tabs.Tab value="setup" leftSection={<IconPlugConnected size={14} />}>
            CI setup
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="runs">
          <RunsPanel sp={sp} set={set} onImport={() => setImportOpen(true)} />
        </Tabs.Panel>
        <Tabs.Panel value="sources">
          <SourcesPanel set={set} />
        </Tabs.Panel>
        <Tabs.Panel value="flaky">
          <TestsPanel sp={sp} set={set} />
        </Tabs.Panel>
        <Tabs.Panel value="setup">
          <SetupPanel />
        </Tabs.Panel>
      </Tabs>
      <ImportModal opened={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

/** Sources and facet values (unfiltered) for pickers. */
function useAutomationMeta() {
  const { pid } = useProject();
  return useQuery({ queryKey: ['automation-meta', pid], queryFn: () => api.get(p(pid, '/automation/runs'), { pageSize: 1 }), staleTime: 30_000 });
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const RUN_FILTERS = ['framework', 'branch', 'sourceId', 'environment', 'milestoneId', 'status', 'q'] as const;

function RunsPanel({ sp, set, onImport }: { sp: URLSearchParams; set: Setter; onImport: () => void }) {
  const { pid, milestoneOptions, can } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useAutomationMeta();
  const filters = Object.fromEntries(RUN_FILTERS.map((k) => [k, sp.get(k) ?? ''])) as Record<(typeof RUN_FILTERS)[number], string>;
  const page = Number(sp.get('page')) || 1;
  const days = sp.get('days') ?? '30';
  const [search, setSearch] = useState(filters.q);
  const [debounced] = useDebouncedValue(search, 350);
  useEffect(() => {
    if (debounced !== filters.q) set({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const [selected, setSelected] = useState<string[]>([]);

  const runs = useQuery({
    queryKey: ['automation-runs', pid, filters, page],
    queryFn: () => api.get(p(pid, '/automation/runs'), { ...filters, page, pageSize: 25 }),
    placeholderData: (prev) => prev,
  });
  const trend = useQuery({
    queryKey: ['automation-trends', pid, filters, days],
    queryFn: () => api.get(p(pid, '/automation/trends'), { ...filters, status: undefined, days }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(pid, `/automation/runs/${id}`)),
    onSuccess: () => {
      toastOk('Run deleted');
      qc.invalidateQueries({ queryKey: ['automation-runs', pid] });
      qc.invalidateQueries({ queryKey: ['automation-trends', pid] });
      qc.invalidateQueries({ queryKey: ['automation-meta', pid] });
    },
    onError: (e) => toastError(e),
  });

  const m = meta.data;
  const hasFilters = RUN_FILTERS.some((k) => filters[k]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  const compare = () => {
    const rows: any[] = runs.data?.runs ?? [];
    const pick = selected.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    if (pick.length !== 2) return;
    pick.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    navigate(`/projects/${pid}/automation/compare?base=${pick[0].id}&head=${pick[1].id}`);
  };

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={5}>Pass rate trend</Title>
            <Text size="xs" c="dimmed">
              Daily passed ÷ (total − skipped) across completed runs matching the filters.
            </Text>
          </div>
          <SegmentedControl
            size="xs"
            value={days}
            onChange={(v) => set({ days: v === '30' ? null : v })}
            data={[
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        </Group>
        <QueryState query={trend}>
          {(t: any) =>
            t.trend.length === 0 ? (
              <Text size="sm" c="dimmed" py="lg" ta="center">
                No completed runs in the last {t.days} days.
              </Text>
            ) : (
              <Grid gap="md">
                <Grid.Col span={{ base: 12, md: 7 }}>
                  <LineChart
                    h={180}
                    data={t.trend}
                    dataKey="date"
                    unit="%"
                    connectNulls
                    curveType="monotone"
                    yAxisProps={{ domain: [0, 100] }}
                    series={[{ name: 'passRate', label: 'Pass rate', color: 'teal.6' }]}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 5 }}>
                  <BarChart
                    h={180}
                    data={t.trend}
                    dataKey="date"
                    type="stacked"
                    withLegend
                    series={[
                      { name: 'passed', label: 'Passed', color: 'green.6' },
                      { name: 'failed', label: 'Failed', color: 'red.6' },
                      { name: 'skipped', label: 'Skipped', color: 'gray.5' },
                    ]}
                  />
                </Grid.Col>
              </Grid>
            )
          }
        </QueryState>
      </Paper>

      <Paper withBorder p="sm" className="ex-no-print">
        <Group gap="sm" wrap="wrap" align="flex-end">
          <TextInput
            label="Search"
            placeholder="Run name"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={200}
          />
          <Select label="Source" placeholder="Any" data={(m?.sources ?? []).map((s: any) => ({ value: s.id, label: s.name }))} value={filters.sourceId || null} onChange={(v) => set({ sourceId: v, page: null })} clearable w={160} />
          <Select label="Framework" placeholder="Any" data={m?.facets.frameworks ?? []} value={filters.framework || null} onChange={(v) => set({ framework: v, page: null })} clearable w={140} />
          <Select label="Branch" placeholder="Any" data={m?.facets.branches ?? []} value={filters.branch || null} onChange={(v) => set({ branch: v, page: null })} clearable searchable w={190} />
          <Select label="Environment" placeholder="Any" data={m?.facets.environments ?? []} value={filters.environment || null} onChange={(v) => set({ environment: v, page: null })} clearable w={150} />
          <Select label="Milestone" placeholder="Any" data={milestoneOptions} value={filters.milestoneId || null} onChange={(v) => set({ milestoneId: v, page: null })} clearable w={160} />
          <Select
            label="Status"
            placeholder="Any"
            data={[
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'RUNNING', label: 'Running' },
            ]}
            value={filters.status || null}
            onChange={(v) => set({ status: v, page: null })}
            clearable
            w={130}
          />
          {hasFilters && (
            <Button
              variant="subtle"
              leftSection={<IconFilterOff size={16} />}
              onClick={() => {
                setSearch('');
                set(Object.fromEntries([...RUN_FILTERS, 'page'].map((k) => [k, null])));
              }}
            >
              Clear
            </Button>
          )}
          <Group gap="xs" ml="auto">
            <Text size="xs" c="dimmed">
              {selected.length}/2 selected
            </Text>
            <Button variant="default" leftSection={<IconArrowsDiff size={16} />} disabled={selected.length !== 2} onClick={compare}>
              Compare
            </Button>
          </Group>
        </Group>
      </Paper>

      <QueryState query={runs}>
        {(d: any) =>
          d.runs.length === 0 ? (
            <EmptyState
              icon={<IconRobot size={26} />}
              title={hasFilters ? 'No runs match these filters' : 'No automation runs yet'}
              description={hasFilters ? 'Try clearing filters.' : 'Upload a JUnit XML or Playwright JSON report, or send results from CI using the REST API.'}
              action={
                !hasFilters && (
                  <Group>
                    {can('TESTER') && <Button onClick={onImport}>Import results</Button>}
                    <Button variant="default" onClick={() => set({ tab: 'setup' })}>
                      CI setup guide
                    </Button>
                  </Group>
                )
              }
            />
          ) : (
            <Paper withBorder>
              <Table.ScrollContainer minWidth={1100}>
                <Table highlightOnHover verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={36} />
                      <Table.Th>Run</Table.Th>
                      <Table.Th>Source</Table.Th>
                      <Table.Th>Branch · commit</Table.Th>
                      <Table.Th>Build</Table.Th>
                      <Table.Th>Environment</Table.Th>
                      <Table.Th>Results</Table.Th>
                      <Table.Th>Pass rate</Table.Th>
                      <Table.Th>Duration</Table.Th>
                      <Table.Th>Started</Table.Th>
                      <Table.Th w={70} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {d.runs.map((r: any) => (
                      <Table.Tr key={r.id} bg={selected.includes(r.id) ? 'var(--mantine-primary-color-light)' : undefined}>
                        <Table.Td>
                          <Checkbox aria-label={`Select ${r.key} for comparison`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                        </Table.Td>
                        <Table.Td maw={280}>
                          <Text size="sm" component={Link} to={`/projects/${pid}/automation/runs/${r.id}`} className="ex-link" lineClamp={1}>
                            <span className="ex-key">{r.key}</span> {r.name}
                          </Text>
                          <Group gap={4} mt={2}>
                            {r.status === 'RUNNING' && <RunStatusBadge status={r.status} />}
                            {r.milestone && (
                              <Badge size="xs" variant="outline" color="gray">
                                {r.milestone.name}
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{r.source?.name ?? '—'}</Text>
                          <Text size="xs" c="dimmed">
                            {r.framework ?? ''}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" lineClamp={1}>
                            {r.branch ?? '—'}
                          </Text>
                          {r.commitSha && (
                            <Text size="xs" ff="monospace" c="dimmed">
                              {r.commitSha.slice(0, 10)}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Text size="sm">{r.buildNumber ? `#${r.buildNumber}` : '—'}</Text>
                            {r.ciUrl && (
                              <Tooltip label={`Open in ${r.ciProvider ?? 'CI'}`}>
                                <ActionIcon component="a" href={r.ciUrl} target="_blank" rel="noopener noreferrer" variant="subtle" size="sm" color="gray" aria-label="Open CI build">
                                  <IconExternalLink size={14} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{r.environment ?? '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          <RunResultBar passed={r.passedCount} failed={r.failedCount} skipped={r.skippedCount} other={r.otherCount} total={r.totalCount} />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={600} c={r.passRate == null ? 'dimmed' : r.passRate >= 95 ? 'green.7' : r.passRate >= 80 ? 'yellow.8' : 'red.7'}>
                            {r.passRate == null ? '—' : `${r.passRate}%`}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{fmtMs(r.durationMs)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={new Date(r.startedAt).toLocaleString()}>
                            <Text size="sm">{fromNow(r.startedAt)}</Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${r.key}`}>
                                <IconDots size={16} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item component={Link} to={`/projects/${pid}/automation/runs/${r.id}`}>
                                Open run
                              </Menu.Item>
                              {can('LEAD') && (
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconTrash size={14} />}
                                  onClick={() =>
                                    modals.openConfirmModal({
                                      title: `Delete ${r.key}?`,
                                      children: <Text size="sm">This permanently deletes the run and its {r.totalCount} results. Test history from other runs is kept.</Text>,
                                      labels: { confirm: 'Delete run', cancel: 'Cancel' },
                                      confirmProps: { color: 'red' },
                                      onConfirm: () => del.mutate(r.id),
                                    })
                                  }
                                >
                                  Delete run
                                </Menu.Item>
                              )}
                            </Menu.Dropdown>
                          </Menu>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              <Group justify="space-between" p="sm">
                <Text size="xs" c="dimmed">
                  {d.total} run{d.total === 1 ? '' : 's'} · select two runs to compare them
                </Text>
                {d.total > d.pageSize && <Pagination size="sm" total={Math.ceil(d.total / d.pageSize)} value={d.page} onChange={(pg) => set({ page: String(pg) })} />}
              </Group>
            </Paper>
          )
        }
      </QueryState>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function SourcesPanel({ set }: { set: Setter }) {
  const meta = useAutomationMeta();
  return (
    <Stack gap="md">
      <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />}>
        A source groups runs from one suite or pipeline (for example <b>web-e2e</b> or <b>api-tests</b>). Sources are created automatically the first time results are ingested with a new{' '}
        <code>source</code> name; runs of the same source and branch are compared with each other. Renaming or deleting sources from the UI is not available yet.
      </Alert>
      <QueryState query={meta}>
        {(d: any) =>
          d.sources.length === 0 ? (
            <EmptyState title="No sources yet" description="Import a report or post results from CI with a source name to create one." />
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {d.sources.map((s: any) => (
                <Paper key={s.id} withBorder p="md">
                  <Group justify="space-between" mb={4}>
                    <Text fw={600}>{s.name}</Text>
                    {s.framework && <Badge variant="light">{s.framework}</Badge>}
                  </Group>
                  <Text size="sm" c={s.description ? undefined : 'dimmed'} mb="sm">
                    {s.description ?? 'No description'}
                  </Text>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Created {fmtDate(s.createdAt)}
                    </Text>
                    <Button size="xs" variant="light" onClick={() => set({ tab: null, sourceId: s.id, page: null })}>
                      View runs
                    </Button>
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          )
        }
      </QueryState>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Tests / flaky tests
// ---------------------------------------------------------------------------

function TestsPanel({ sp, set }: { sp: URLSearchParams; set: Setter }) {
  const { pid } = useProject();
  const flakyOnly = sp.get('all') !== '1';
  const page = Number(sp.get('tpage')) || 1;
  const [search, setSearch] = useState(sp.get('tq') ?? '');
  const [debounced] = useDebouncedValue(search, 350);
  useEffect(() => {
    if (debounced !== (sp.get('tq') ?? '')) set({ tq: debounced || null, tpage: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const tests = useQuery({
    queryKey: ['automation-tests', pid, flakyOnly, sp.get('tq') ?? '', page],
    queryFn: () => api.get(p(pid, '/automation/tests'), { flaky: flakyOnly ? 'true' : undefined, q: sp.get('tq') ?? undefined, page, pageSize: 50 }),
    placeholderData: (prev) => prev,
  });

  return (
    <Stack gap="md">
      <Alert variant="light" color="grape" icon={<IconRefreshAlert size={18} />}>
        A test is flagged <b>flaky</b> when, across its last 10 completed results, it either passed on a retry at least once or flipped between pass and fail at least twice. The flake score is
        flips ÷ (comparable results − 1).
      </Alert>
      <Group gap="sm" align="flex-end">
        <TextInput label="Search tests" placeholder="Name, suite or file" leftSection={<IconSearch size={14} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={280} />
        <Switch label="Flaky tests only" checked={flakyOnly} onChange={(e) => set({ all: e.currentTarget.checked ? null : '1', tpage: null })} mb={8} />
      </Group>
      <QueryState query={tests}>
        {(d: any) =>
          d.tests.length === 0 ? (
            <EmptyState
              icon={<IconCheck size={26} />}
              title={flakyOnly ? 'No flaky tests detected' : 'No automated tests found'}
              description={flakyOnly ? 'Nothing in the recent history of your automated tests looks flaky.' : 'Tests appear here once results are ingested.'}
            />
          ) : (
            <Paper withBorder>
              <Table.ScrollContainer minWidth={900}>
                <Table highlightOnHover verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Test</Table.Th>
                      <Table.Th>Recent results (oldest → newest)</Table.Th>
                      <Table.Th>Flips</Table.Th>
                      <Table.Th>Passed on retry</Table.Th>
                      <Table.Th>Flake score</Table.Th>
                      <Table.Th>Last</Table.Th>
                      <Table.Th>Avg duration</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {d.tests.map((t: any) => (
                      <Table.Tr key={t.id}>
                        <Table.Td maw={360}>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" component={Link} to={`/projects/${pid}/automation/tests/${t.id}`} className="ex-link" lineClamp={1}>
                              {t.name}
                            </Text>
                            <FlakyBadge flaky={t.flaky} />
                          </Group>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {[t.suite, t.file].filter(Boolean).join(' · ') || '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <HistoryStrip items={[...t.history].reverse().map((c: string) => ({ category: c }))} />
                        </Table.Td>
                        <Table.Td>{t.flaky.flips}</Table.Td>
                        <Table.Td>{t.flaky.passedOnRetry}</Table.Td>
                        <Table.Td w={140}>
                          <Group gap={6} wrap="nowrap">
                            <Progress value={t.flaky.score * 100} color={t.flaky.score >= 0.3 ? 'grape' : 'gray'} w={60} size="sm" aria-label="Flake score" />
                            <Text size="xs">{Math.round(t.flaky.score * 100)}%</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {t.lastStatus ? <ResultBadge value={t.lastStatus} size="sm" variant="light" /> : '—'}
                          <Text size="xs" c="dimmed">
                            {t.lastRunAt ? fromNow(t.lastRunAt) : ''}
                          </Text>
                        </Table.Td>
                        <Table.Td>{fmtMs(t.avgDurationMs)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              <Group justify="space-between" p="sm">
                <Text size="xs" c="dimmed">
                  {d.total} test{d.total === 1 ? '' : 's'}
                </Text>
                {d.total > d.pageSize && <Pagination size="sm" total={Math.ceil(d.total / d.pageSize)} value={d.page} onChange={(pg) => set({ tpage: String(pg) })} />}
              </Group>
            </Paper>
          )
        }
      </QueryState>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// CI setup / REST ingestion contract
// ---------------------------------------------------------------------------

function SetupPanel() {
  const { pid, statuses } = useProject();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://explorix.example.com';
  const base = `/api/projects/${pid}/automation`;
  const autoStatuses = (statuses as any[]).filter((s) => s.scope !== 'MANUAL' && !s.archivedAt);

  const curlJunit = `export EXPLORIX_URL="${origin}"
export EXPLORIX_TOKEN="exp_..."   # personal API token (Profile → API tokens)

curl -sS --fail-with-body -X POST "$EXPLORIX_URL${base}/import/junit" \\
  --url-query "source=api-tests" \\
  --url-query "branch=main" \\
  --url-query "commitSha=$(git rev-parse HEAD)" \\
  --url-query "buildNumber=142" \\
  --url-query "ciUrl=https://ci.example.com/builds/142" \\
  --url-query "environment=staging" \\
  -H "Authorization: Bearer $EXPLORIX_TOKEN" \\
  -H "Content-Type: application/xml" \\
  --data-binary @reports/junit.xml`;

  const curlPlaywright = `# playwright.config.ts: reporter: [['json', { outputFile: 'results.json' }]]
curl -sS --fail-with-body -X POST "$EXPLORIX_URL${base}/import/playwright" \\
  --url-query "source=web-e2e" \\
  --url-query "branch=main" \\
  --url-query "environment=staging" \\
  -H "Authorization: Bearer $EXPLORIX_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data-binary @results.json`;

  const curlNative = `curl -sS --fail-with-body -X POST "$EXPLORIX_URL${base}/runs" \\
  -H "Authorization: Bearer $EXPLORIX_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": "smoke",
    "framework": "custom",
    "branch": "main",
    "commitSha": "4f2c9e1",
    "environment": "production",
    "results": [
      { "name": "login works", "suite": "Auth", "status": "passed", "durationMs": 1200 },
      { "name": "checkout total", "suite": "Cart", "status": "failed", "durationMs": 3400,
        "message": "Expected 42.00 but got 40.00", "stackTrace": "at cart.spec.ts:18", "retries": 1,
        "artifacts": [{ "name": "screenshot", "url": "https://ci.example.com/artifacts/1.png" }] }
    ]
  }'`;

  const curlStaged = `# 1. Start a run (status RUNNING) — response contains run.id
RUN_ID=$(curl -sS -X POST "$EXPLORIX_URL${base}/runs" \\
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" \\
  -d '{"source":"nightly","branch":"main","status":"RUNNING"}' | jq -r .run.id)

# 2. Append results in batches (≤ 20,000 per request)
curl -sS -X POST "$EXPLORIX_URL${base}/runs/$RUN_ID/results" \\
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" \\
  -d '{"results":[{"name":"test a","status":"passed"}]}'

# 3. Complete the run (computes duration, fires the automation_run.completed webhook)
curl -sS -X POST "$EXPLORIX_URL${base}/runs/$RUN_ID/complete" \\
  -H "Authorization: Bearer $EXPLORIX_TOKEN" -H "Content-Type: application/json" -d '{}'`;

  const gha = `# .github/workflows/tests.yml (excerpt)
- name: Upload results to Explorix
  if: always()
  env:
    EXPLORIX_URL: \${{ vars.EXPLORIX_URL }}
    EXPLORIX_TOKEN: \${{ secrets.EXPLORIX_TOKEN }}
  run: |
    curl -sS --fail-with-body -X POST "$EXPLORIX_URL${base}/import/junit" \\
      --url-query "source=api-tests" \\
      --url-query "branch=\${{ github.head_ref || github.ref_name }}" \\
      --url-query "commitSha=\${{ github.sha }}" \\
      --url-query "buildNumber=\${{ github.run_number }}" \\
      --url-query "ciProvider=github-actions" \\
      --url-query "ciUrl=\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}" \\
      -H "Authorization: Bearer $EXPLORIX_TOKEN" \\
      -H "Content-Type: application/xml" \\
      --data-binary @reports/junit.xml`;

  const gitlab = `# .gitlab-ci.yml (excerpt) — set EXPLORIX_URL and a masked EXPLORIX_TOKEN CI/CD variable
upload-to-explorix:
  stage: .post
  when: always
  script:
    - >
      curl -sS --fail-with-body -X POST "$EXPLORIX_URL${base}/import/junit"
      --url-query "source=api-tests"
      --url-query "branch=$CI_COMMIT_REF_NAME"
      --url-query "commitSha=$CI_COMMIT_SHA"
      --url-query "buildNumber=$CI_PIPELINE_IID"
      --url-query "ciProvider=gitlab-ci"
      --url-query "ciUrl=$CI_PIPELINE_URL"
      -H "Authorization: Bearer $EXPLORIX_TOKEN"
      -H "Content-Type: application/xml"
      --data-binary @report.xml`;

  const jenkins = `// Jenkinsfile (declarative, excerpt) — store the token as a "Secret text" credential
post {
  always {
    withCredentials([string(credentialsId: 'explorix-token', variable: 'EXPLORIX_TOKEN')]) {
      sh '''
        curl -sS --fail-with-body -X POST "$EXPLORIX_URL${base}/import/junit" \\
          --url-query "source=api-tests" \\
          --url-query "branch=$BRANCH_NAME" \\
          --url-query "commitSha=$GIT_COMMIT" \\
          --url-query "buildNumber=$BUILD_NUMBER" \\
          --url-query "ciProvider=jenkins" \\
          --url-query "ciUrl=$BUILD_URL" \\
          -H "Authorization: Bearer $EXPLORIX_TOKEN" \\
          -H "Content-Type: application/xml" \\
          --data-binary @build/test-results/junit.xml
      '''
    }
  }
}`;

  const params: [string, string][] = [
    ['source', 'Suite/pipeline name. Creates the source on first use. Defaults to the framework name.'],
    ['name', 'Run name. Default: "<source> · <branch> #<buildNumber>".'],
    ['framework', 'Free text (e.g. jest, pytest). JUnit defaults to "junit"; Playwright is always "playwright".'],
    ['branch, commitSha, buildNumber', 'Version-control and build identifiers (free text).'],
    ['ciProvider, ciUrl', 'CI system name and an absolute http(s) link to the build.'],
    ['environment', 'Free text, e.g. staging.'],
    ['milestone | milestoneId', 'Milestone name (ignored if unknown) or id (rejected if unknown).'],
    ['startedAt, completedAt', 'ISO 8601 timestamps with offset, e.g. 2026-01-31T10:00:00Z.'],
  ];

  return (
    <Stack gap="lg">
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />} title="How CI integration works">
        Explorix ingests results over its <b>REST API</b> — natively supported formats are <b>JUnit XML</b> (Jest, pytest, Maven/Gradle, Cypress, PHPUnit…), the <b>Playwright JSON reporter</b> and a
        native <b>JSON</b> payload. There are no dedicated CI plugins: the GitHub Actions, GitLab CI and Jenkins snippets below are <b>examples</b> that call the same API with curl (7.87+ for{' '}
        <code>--url-query</code>).
      </Alert>

      <Paper withBorder p="md">
        <Group gap={6} mb="xs">
          <IconKey size={18} />
          <Title order={5}>1. Create an API token</Title>
        </Group>
        <Text size="sm">
          Create a personal API token on your{' '}
          <Anchor component={Link} to="/profile">
            profile page
          </Anchor>{' '}
          — ideally restricted to this project — and store it as a CI secret. Tokens act with your permissions (the tester role or higher is required to ingest). Send it as{' '}
          <code>Authorization: Bearer &lt;token&gt;</code>. Project id for URLs: <code>{pid}</code>
        </Text>
      </Paper>

      <Paper withBorder p="md">
        <Title order={5} mb="xs">
          2. Send results
        </Title>
        <Tabs defaultValue="junit">
          <Tabs.List mb="sm">
            <Tabs.Tab value="junit">JUnit XML</Tabs.Tab>
            <Tabs.Tab value="playwright">Playwright JSON</Tabs.Tab>
            <Tabs.Tab value="native">Native JSON</Tabs.Tab>
            <Tabs.Tab value="staged">Staged (large suites)</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="junit">
            <Text size="sm" mb="xs">
              <code>POST {base}/import/junit</code> — body is the XML document, run metadata goes in query parameters.
            </Text>
            <CopyCode code={curlJunit} />
          </Tabs.Panel>
          <Tabs.Panel value="playwright">
            <Text size="sm" mb="xs">
              <code>POST {base}/import/playwright</code> — body is the Playwright JSON report. Retries are kept, so passes on retry count toward flakiness.
            </Text>
            <CopyCode code={curlPlaywright} />
          </Tabs.Panel>
          <Tabs.Panel value="native">
            <Text size="sm" mb="xs">
              <code>POST {base}/runs</code> — JSON body with the run metadata fields below plus a <code>results</code> array (<code>name</code> and <code>status</code> required; optional{' '}
              <code>key</code>, <code>suite</code>, <code>file</code>, <code>durationMs</code>, <code>message</code>, <code>stackTrace</code>, <code>retries</code>, <code>artifacts</code>).
            </Text>
            <CopyCode code={curlNative} />
          </Tabs.Panel>
          <Tabs.Panel value="staged">
            <Text size="sm" mb="xs">
              For suites larger than one request, start a run with <code>"status": "RUNNING"</code>, append batches, then complete it.
            </Text>
            <CopyCode code={curlStaged} />
          </Tabs.Panel>
        </Tabs>
        <Grid gap="lg" mt="md">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Text size="sm" fw={600} mb={4}>
              Run metadata (query parameters for imports, JSON fields for /runs)
            </Text>
            <Table withTableBorder fz="xs" verticalSpacing={4}>
              <Table.Tbody>
                {params.map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td w={190}>
                      <code>{k}</code>
                    </Table.Td>
                    <Table.Td>{v}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Text size="sm" fw={600} mb={4}>
              Response & limits
            </Text>
            <CopyCode code={`201 Created\n{ "run": { "id", "key", "name", "status",\n           "total", "passed", "failed", "skipped", "url" } }`} />
            <List size="xs" mt="xs" spacing={2}>
              <List.Item>Max 20,000 results per request</List.Item>
              <List.Item>XML body ≤ 20 MB, JSON body ≤ 10 MB</List.Item>
              <List.Item>Validation errors: HTTP 400 with field details</List.Item>
              <List.Item>
                Completed runs emit the <code>automation_run.completed</code>{' '}
                <Anchor component={Link} to={`/projects/${pid}/integrations`} size="xs">
                  webhook
                </Anchor>
              </List.Item>
            </List>
          </Grid.Col>
        </Grid>
      </Paper>

      <Paper withBorder p="md">
        <Title order={5} mb={4}>
          Status mapping
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Raw statuses are matched (case-insensitive) against these project statuses by key or alias. Anything unrecognised is recorded as <b>Error</b> (failed). Manage them in project settings → Statuses.
        </Text>
        <Table withTableBorder fz="sm" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Status</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Accepted values</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {autoStatuses.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>
                  <Badge color={s.color} variant="light">
                    {s.name}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <ResultBadge value={s.category} size="sm" variant="outline" />
                </Table.Td>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {[s.key, ...(s.aliases ?? [])].filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="xs">
          <Title order={5}>3. CI pipeline examples</Title>
          <Badge color="gray" variant="outline">
            Examples — not native plugins
          </Badge>
        </Group>
        <Text size="sm" c="dimmed" mb="sm">
          Adapt paths and the source name to your project. Use <code>if: always()</code> / <code>when: always</code> so failing test jobs still upload results.
        </Text>
        <Tabs defaultValue="gha">
          <Tabs.List mb="sm">
            <Tabs.Tab value="gha" leftSection={<IconBrandGithub size={14} />}>
              GitHub Actions
            </Tabs.Tab>
            <Tabs.Tab value="gitlab">GitLab CI</Tabs.Tab>
            <Tabs.Tab value="jenkins">Jenkins</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="gha">
            <CopyCode code={gha} />
          </Tabs.Panel>
          <Tabs.Panel value="gitlab">
            <CopyCode code={gitlab} />
          </Tabs.Panel>
          <Tabs.Panel value="jenkins">
            <CopyCode code={jenkins} />
          </Tabs.Panel>
        </Tabs>
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Import modal
// ---------------------------------------------------------------------------

type ImportForm = { source: string; name: string; framework: string; branch: string; commitSha: string; buildNumber: string; ciProvider: string; ciUrl: string; environment: string; milestoneId: string | null };
const EMPTY: ImportForm = { source: '', name: '', framework: '', branch: '', commitSha: '', buildNumber: '', ciProvider: '', ciUrl: '', environment: '', milestoneId: null };

function ImportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { pid, milestoneOptions } = useProject();
  const qc = useQueryClient();
  const meta = useAutomationMeta();
  const [format, setFormat] = useState<'junit' | 'playwright'>('junit');
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [form, setForm] = useState<ImportForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const f = (k: keyof ImportForm) => ({
    value: (form[k] ?? '') as string,
    error: errors[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.currentTarget.value }),
  });
  const sourceNames = useMemo(() => (meta.data?.sources ?? []).map((s: any) => s.name as string), [meta.data]);

  const reset = () => {
    setFile(null);
    setPasted('');
    setForm(EMPTY);
    setErrors({});
    setResult(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = useMutation({
    mutationFn: async () => {
      const text = file ? await file.text() : pasted;
      if (!text.trim()) throw new Error('Choose a report file or paste its contents');
      const params = Object.fromEntries(Object.entries({ ...form, framework: format === 'junit' ? form.framework : '' }).filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v).trim()]));
      return api.postText(p(pid, `/automation/import/${format}${qs(params)}`), text, format === 'junit' ? 'application/xml' : 'application/json');
    },
    onSuccess: (r: any) => {
      setResult(r.run);
      setErrors({});
      toastOk(`Imported ${r.run.total} results as ${r.run.key}`);
      for (const k of ['automation-runs', 'automation-trends', 'automation-meta', 'automation-tests']) qc.invalidateQueries({ queryKey: [k, pid] });
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      toastError(e, 'Import failed');
    },
  });

  return (
    <Modal opened={opened} onClose={close} title="Import automation results" size="lg">
      {result ? (
        <Stack>
          <Alert color={result.failed ? 'orange' : 'teal'} icon={<IconCheck size={18} />} title={`${result.key} · ${result.name}`}>
            Parsed {result.total} results: {result.passed} passed, {result.failed} failed, {result.skipped} skipped.
          </Alert>
          <RunResultBar passed={result.passed} failed={result.failed} skipped={result.skipped} total={result.total} w={300} />
          <Group justify="flex-end">
            <Button variant="default" onClick={reset}>
              Import another
            </Button>
            <Button component={Link} to={`/projects/${pid}/automation/runs/${result.id}`} onClick={close}>
              Open run
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <SegmentedControl
            value={format}
            onChange={(v) => setFormat(v as 'junit' | 'playwright')}
            data={[
              { value: 'junit', label: 'JUnit XML' },
              { value: 'playwright', label: 'Playwright JSON' },
            ]}
          />
          <FileInput
            label="Report file"
            description={format === 'junit' ? 'JUnit XML from Jest, pytest, Maven/Gradle, Cypress, PHPUnit… (≤ 20 MB)' : "Output of Playwright's JSON reporter (≤ 10 MB)"}
            placeholder="Choose file"
            accept={format === 'junit' ? '.xml,application/xml,text/xml' : '.json,application/json'}
            value={file}
            onChange={setFile}
            clearable
            leftSection={<IconFileUpload size={16} />}
          />
          {!file && (
            <Textarea label="…or paste the report" autosize minRows={2} maxRows={6} value={pasted} onChange={(e) => setPasted(e.currentTarget.value)} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }} />
          )}
          <SimpleGrid cols={2}>
            <Autocomplete label="Source" description="Existing or new source name" data={sourceNames} value={form.source} onChange={(v) => setForm({ ...form, source: v })} error={errors.source} />
            <TextInput label="Run name" description="Optional — generated if empty" {...f('name')} />
            {format === 'junit' && <TextInput label="Framework" placeholder="e.g. jest, pytest" {...f('framework')} />}
            <Autocomplete label="Branch" data={meta.data?.facets.branches ?? []} value={form.branch} onChange={(v) => setForm({ ...form, branch: v })} error={errors.branch} />
            <TextInput label="Commit SHA" {...f('commitSha')} />
            <TextInput label="Build number" {...f('buildNumber')} />
            <TextInput label="CI provider" placeholder="e.g. github-actions" {...f('ciProvider')} />
            <TextInput label="CI build URL" placeholder="https://…" {...f('ciUrl')} />
            <Autocomplete label="Environment" data={meta.data?.facets.environments ?? []} value={form.environment} onChange={(v) => setForm({ ...form, environment: v })} error={errors.environment} />
            <Select label="Milestone" data={milestoneOptions} value={form.milestoneId} onChange={(v) => setForm({ ...form, milestoneId: v })} clearable error={errors.milestoneId} />
          </SimpleGrid>
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={!file && !pasted.trim()}>
              Import
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
