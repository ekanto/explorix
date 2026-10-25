import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Grid,
  Group,
  List,
  Menu,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { BarChart, DonutChart, LineChart } from '@mantine/charts';
import { DatePickerInput } from '@mantine/dates';
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleDashed,
  IconDownload,
  IconFileTypeCsv,
  IconFilterOff,
  IconJson,
  IconPrinter,
  IconReportAnalytics,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { api, download, p, qs } from '../../lib/api';
import { fmtDate, fmtDateTime, pct } from '../../lib/format';
import { RESULT_CATEGORY, SESSION_STATUS, SEVERITY } from '../../lib/constants';
import { useProject } from '../../lib/project';
import { useAiStatus } from '../../lib/ai';
import { AiDraftBadge, AiSetupNotice } from '../../components/AiNotice';
import { EmptyState, PageHeader, QueryState, SeverityBadge, toastError } from '../../components/ui';

const LEVEL = {
  pass: { color: 'green', icon: IconCheck, label: 'Ready' },
  warn: { color: 'yellow', icon: IconAlertTriangle, label: 'At risk' },
  fail: { color: 'red', icon: IconX, label: 'Not ready' },
  na: { color: 'gray', icon: IconCircleDashed, label: 'No data' },
  insufficient_data: { color: 'gray', icon: IconCircleDashed, label: 'Insufficient data' },
} as const;
const lvl = (l: string) => LEVEL[l as keyof typeof LEVEL] ?? LEVEL.na;

const REQ_STATUS: Record<string, { label: string; color: string }> = {
  passing: { label: 'Passing', color: 'green' },
  partial: { label: 'Partially covered', color: 'yellow' },
  failing: { label: 'Failing', color: 'red' },
  untested: { label: 'Untested', color: 'gray' },
};

const DATASETS = [
  { key: 'kpis', label: 'Key metrics' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'charters', label: 'Charters' },
  { key: 'effort-by-tester', label: 'Effort by tester' },
];

const MANUAL_CATS = ['passed', 'failed', 'blocked', 'skipped', 'retest', 'untested'] as const;

type Def = { kind: string; definition: string } | undefined;
type Q = { isLoading: boolean; error: unknown; data: any };

export default function Reports() {
  const { pid, project, milestoneOptions, memberOptions } = useProject();
  const [sp, setSp] = useSearchParams();
  const filters = { milestoneId: sp.get('milestoneId') ?? '', testerId: sp.get('testerId') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '' };
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setSp(next, { replace: true });
  };
  const hasFilters = Object.keys(params).length > 0;

  const dash = useQuery({ queryKey: ['reports-dashboard', pid, params], queryFn: () => api.get(p(pid, '/reports/dashboard'), params) });
  const ready = useQuery({ queryKey: ['readiness', pid, filters.milestoneId || null], queryFn: () => api.get(p(pid, '/reports/readiness'), { milestoneId: filters.milestoneId || undefined }) });
  const gaps = useQuery({ queryKey: ['coverage-gaps', pid], queryFn: () => api.get(p(pid, '/reports/coverage-gaps')) });

  const exportUrl = (ds: string, format: 'csv' | 'json') => p(pid, `/reports/export/${ds}`) + qs({ ...params, format });
  const save = (url: string, name: string) => download(url, name).catch((e) => toastError(e, 'Export failed'));
  const testerOptions = [{ value: 'me', label: 'Me' }, ...memberOptions];
  const filterSummary = [
    filters.milestoneId && `Milestone: ${milestoneOptions.find((m) => m.value === filters.milestoneId)?.label ?? '—'}`,
    filters.testerId && `Tester: ${testerOptions.find((m) => m.value === filters.testerId)?.label ?? '—'}`,
    (filters.from || filters.to) && `Created ${filters.from ? fmtDate(filters.from) : '…'} – ${filters.to ? fmtDate(filters.to) : '…'}`,
  ].filter(Boolean);

  /** Drill-down link to a list page, carrying the milestone (and optionally tester) filter. */
  const drill = (path: string, extra: Record<string, string | undefined>, carry: ('milestoneId' | 'testerId')[] = ['milestoneId']) => {
    const q: Record<string, string | undefined> = { ...extra };
    for (const c of carry) if (filters[c] && filters[c] !== 'me') q[c] = filters[c];
    return `/projects/${pid}/${path}${qs(q)}`;
  };

  return (
    <>
      <PageHeader
        kicker={project.key}
        title="Reports"
        subtitle="Exploratory, manual and automated testing metrics computed live from stored records."
        actions={
          <>
            <Button leftSection={<IconReportAnalytics size={16} />} component={Link} to={`/projects/${pid}/reports/new`}>
              New report
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" leftSection={<IconDownload size={16} />}>
                  Export
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {DATASETS.map((d) => (
                  <Group key={d.key} gap={0} wrap="nowrap" justify="space-between" px="xs">
                    <Text size="sm" mr="md">
                      {d.label}
                    </Text>
                    <Group gap={0} wrap="nowrap">
                      <Menu.Item w="auto" leftSection={<IconFileTypeCsv size={16} />} onClick={() => save(exportUrl(d.key, 'csv'), `${project.key}-${d.key}.csv`)}>
                        CSV
                      </Menu.Item>
                      <Menu.Item w="auto" leftSection={<IconJson size={16} />} onClick={() => save(exportUrl(d.key, 'json'), `${project.key}-${d.key}.json`)}>
                        JSON
                      </Menu.Item>
                    </Group>
                  </Group>
                ))}
                <Menu.Divider />
                <Menu.Item leftSection={<IconJson size={16} />} onClick={() => save(p(pid, '/reports/dashboard') + qs({ ...params, format: 'json', download: '1' }), `${project.key}-dashboard.json`)}>
                  Full report data (JSON)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Tooltip label="PDF export is not built in — print and choose “Save as PDF” as the printer" multiline w={240}>
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
                Print / Save as PDF
              </Button>
            </Tooltip>
          </>
        }
      />

      <Paper withBorder p="sm" mb="md" className="ex-no-print">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Select label="Milestone" placeholder="All milestones" data={milestoneOptions} value={filters.milestoneId || null} onChange={(v) => set({ milestoneId: v })} clearable w={200} />
          <Select label="Tester" placeholder="All testers" data={testerOptions} value={filters.testerId || null} onChange={(v) => set({ testerId: v })} clearable searchable w={200} />
          <DatePickerInput type="range" label="Created between" placeholder="Any time" value={[filters.from || null, filters.to || null]} onChange={([from, to]) => set({ from, to })} clearable w={260} />
          {hasFilters && (
            <Button variant="subtle" leftSection={<IconFilterOff size={16} />} onClick={() => set({ milestoneId: null, testerId: null, from: null, to: null })}>
              Clear
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          The date range applies to when sessions, charters and findings were created (automation: run start, default last 30 days). Exports use the same filters. Reports have no status filter — use
          the drill-down links to open filtered lists.
        </Text>
      </Paper>

      <QueryState query={dash}>
        {(d: any) => {
          const k = d.kpis;
          const def = (key: string): Def => d.definitions?.[key];
          const effortMax = Math.max(1, ...d.byTester.map((t: any) => t.effortHours));
          const me = d.manualExecution;
          const riskCls = d.findingsByClassification.find((c: any) => c.key === 'risk');
          return (
            <Stack gap="xl">
              <Text size="xs" c="dimmed">
                Generated {fmtDateTime(d.generatedAt)} · {filterSummary.length ? filterSummary.join(' · ') : 'All data'}
              </Text>

              <Section title="Key metrics">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                  <Metric label="Session completion" value={pct(k.completionRate)} hint={`${k.completedSessions} completed of ${k.totalSessions} sessions (${k.abandonedSessions} abandoned)`} def={def('completionRate')} to={drill('sessions', { view: 'all' }, ['milestoneId', 'testerId'])} />
                  <Metric label="Testing effort" value={`${k.effortHours} h`} hint={`${k.activeSessions} active · ${k.draftSessions} draft sessions`} def={def('effortHours')} />
                  <Metric
                    label="Estimated vs actual"
                    value={k.actualToEstimateRatio == null ? '—' : `${k.actualToEstimateRatio.toFixed(2)}×`}
                    hint={`${k.actualHoursCompleted} h tracked vs ${k.estimatedHoursCompleted} h timeboxed (completed sessions)`}
                    def={def('estimatedVsActual')}
                  />
                  <Metric label="Unresolved findings" value={k.unresolvedFindings} hint={`${k.totalFindings} findings in scope`} def={def('unresolvedFindings')} color="orange" to={drill('findings', { open: 'true' })} />
                  <Metric label="Confirmed defects" value={k.confirmedDefects} def={def('confirmedDefects')} color="red" to={drill('findings', { defects: 'true' })} />
                  <Metric label="Outstanding risks" value={k.outstandingRisks} hint={`${d.riskCharters.length} unexplored high-risk charters`} def={def('outstandingRisks')} color="orange" to={riskCls ? drill('findings', { classification: 'risk', open: 'true' }) : undefined} />
                  <Metric label="Requirement coverage" value={pct(k.requirementCoverage)} hint={`${k.requirementsTotal} requirements`} def={def('requirementCoverage')} to={`/projects/${pid}/requirements`} />
                  <Metric label="Automation pass rate" value={pct(k.automationPassRate)} hint={`${k.automationRuns} completed runs`} def={def('automationPassRate')} to={`/projects/${pid}/automation`} />
                </SimpleGrid>
              </Section>

              <Section title="Release readiness" description="Each indicator has explicit thresholds; overall status is the worst graded indicator. Indicators without data are listed but not graded.">
                <ReadinessPanel query={ready} pid={pid} />
              </Section>

              <Section title="Exploratory effort">
                <Grid gap="md">
                  <Grid.Col span={{ base: 12, md: 5 }}>
                    <Card title="Sessions by status" def={def('completedSessions')}>
                      {d.sessionsByStatus.length === 0 ? (
                        <Muted>No sessions in scope.</Muted>
                      ) : (
                        <Group wrap="nowrap" align="center">
                          <DonutChart
                            size={140}
                            thickness={20}
                            withTooltip
                            data={d.sessionsByStatus.map((s: any) => ({ name: SESSION_STATUS[s.status]?.label ?? s.status, value: s.count, color: SESSION_STATUS[s.status]?.color === 'dark' ? 'dark.3' : `${SESSION_STATUS[s.status]?.color ?? 'gray'}.6` }))}
                          />
                          <Stack gap={3}>
                            {d.sessionsByStatus.map((s: any) => (
                              <Anchor key={s.status} component={Link} to={drill('sessions', { view: 'all', status: s.status }, ['milestoneId', 'testerId'])} size="sm">
                                <Dot color={SESSION_STATUS[s.status]?.color} />
                                {SESSION_STATUS[s.status]?.label ?? s.status}: <b>{s.count}</b>
                              </Anchor>
                            ))}
                          </Stack>
                        </Group>
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 7 }}>
                    <Card title="Effort by tester" def={def('effortHours')}>
                      {d.byTester.length === 0 ? (
                        <Muted>No tester activity in scope.</Muted>
                      ) : (
                        <Table fz="sm" verticalSpacing={4}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Tester</Table.Th>
                              <Table.Th ta="right">Sessions</Table.Th>
                              <Table.Th ta="right">Completed</Table.Th>
                              <Table.Th w="40%">Tracked effort</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {d.byTester.map((t: any) => (
                              <Table.Tr key={t.id}>
                                <Table.Td>
                                  <Anchor component={Link} to={drill('sessions', { view: 'all', testerId: t.id })} size="sm">
                                    {t.name}
                                  </Anchor>
                                </Table.Td>
                                <Table.Td ta="right">{t.sessions}</Table.Td>
                                <Table.Td ta="right">{t.completed}</Table.Td>
                                <Table.Td>
                                  <Group gap={6} wrap="nowrap">
                                    <Progress value={(t.effortHours / effortMax) * 100} style={{ flex: 1 }} size="sm" color="cyan" />
                                    <Text size="xs" w={48} ta="right">
                                      {t.effortHours} h
                                    </Text>
                                  </Group>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 7 }}>
                    <Card title="Effort by milestone" def={def('effortHours')}>
                      {d.effortByMilestone.length === 0 ? (
                        <Muted>No tracked effort.</Muted>
                      ) : (
                        <BarChart h={200} data={d.effortByMilestone} dataKey="milestone" unit=" h" series={[{ name: 'effortHours', label: 'Effort (h)', color: 'cyan.6' }]} />
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 5 }}>
                    <Card title="Estimated vs actual" def={def('estimatedVsActual')}>
                      {k.estimatedHoursCompleted === 0 && k.actualHoursCompleted === 0 ? (
                        <Muted>No completed sessions in scope.</Muted>
                      ) : (
                        <BarChart
                          h={180}
                          data={[{ label: 'Completed sessions', Estimated: k.estimatedHoursCompleted, Actual: k.actualHoursCompleted }]}
                          dataKey="label"
                          unit=" h"
                          withLegend
                          series={[
                            { name: 'Estimated', label: 'Timeboxed (estimate)', color: 'gray.5' },
                            { name: 'Actual', label: 'Tracked (measured)', color: 'cyan.6' },
                          ]}
                        />
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <Card title="Weekly activity" subtitle="Sessions and findings created per week; effort tracked">
                      {d.weeklyActivity.length === 0 ? (
                        <Muted>No activity in the selected period.</Muted>
                      ) : (
                        <BarChart
                          h={200}
                          data={d.weeklyActivity}
                          dataKey="week"
                          withLegend
                          series={[
                            { name: 'sessions', label: 'Sessions', color: 'explorix.6' },
                            { name: 'findings', label: 'Findings', color: 'orange.6' },
                            { name: 'effortHours', label: 'Effort (h)', color: 'cyan.6' },
                          ]}
                        />
                      )}
                    </Card>
                  </Grid.Col>
                </Grid>
              </Section>

              <Section title="Findings & defects">
                <Grid gap="md">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card title="By classification" def={def('unresolvedFindings')}>
                      <Table fz="sm" verticalSpacing={4}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Classification</Table.Th>
                            <Table.Th ta="right">Open</Table.Th>
                            <Table.Th ta="right">Total</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {d.findingsByClassification.map((c: any) => (
                            <Table.Tr key={c.id}>
                              <Table.Td>
                                <Group gap={6} wrap="nowrap">
                                  <Dot color={c.color} />
                                  <Anchor component={Link} to={drill('findings', { classification: c.key })} size="sm">
                                    {c.name}
                                  </Anchor>
                                  {c.isDefect && (
                                    <Badge size="xs" variant="outline" color="red">
                                      defect
                                    </Badge>
                                  )}
                                </Group>
                              </Table.Td>
                              <Table.Td ta="right">
                                <Anchor component={Link} to={drill('findings', { classification: c.key, open: 'true' })} size="sm">
                                  {c.open}
                                </Anchor>
                              </Table.Td>
                              <Table.Td ta="right">{c.count}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card title="By severity" subtitle="Open vs total findings in scope">
                      <Stack gap={8}>
                        {Object.entries(SEVERITY)
                          .sort((a, b) => b[1].rank - a[1].rank)
                          .map(([key, meta]) => {
                            const row = d.findingsBySeverity.find((s: any) => s.severity === key) ?? { count: 0, open: 0 };
                            const max = Math.max(1, ...d.findingsBySeverity.map((s: any) => s.count));
                            return (
                              <div key={key}>
                                <Group justify="space-between" gap={4}>
                                  <Anchor component={Link} to={drill('findings', { severity: key })} size="sm">
                                    {meta.label}
                                  </Anchor>
                                  <Text size="xs" c="dimmed">
                                    <Anchor component={Link} to={drill('findings', { severity: key, open: 'true' })} size="xs">
                                      {row.open} open
                                    </Anchor>{' '}
                                    / {row.count}
                                  </Text>
                                </Group>
                                <Progress.Root size="md">
                                  <Progress.Section value={(row.open / max) * 100} color={meta.color} />
                                  <Progress.Section value={((row.count - row.open) / max) * 100} color="gray.4" />
                                </Progress.Root>
                              </div>
                            );
                          })}
                      </Stack>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 7 }}>
                    <Card title="Confirmed defects by feature" subtitle="Feature = charter target" def={def('confirmedDefects')}>
                      {d.defectsByFeature.length === 0 ? (
                        <Muted>No confirmed defects in scope.</Muted>
                      ) : (
                        <BarChart h={Math.max(140, d.defectsByFeature.length * 28)} data={d.defectsByFeature} dataKey="feature" orientation="vertical" yAxisProps={{ width: 140 }} series={[{ name: 'count', label: 'Defects', color: 'red.6' }]} />
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 5 }}>
                    <Card title="Confirmed defects by release" subtitle="Milestone of the session that found them">
                      {d.defectsByRelease.length === 0 ? (
                        <Muted>No confirmed defects in scope.</Muted>
                      ) : (
                        <Table fz="sm" verticalSpacing={4}>
                          <Table.Tbody>
                            {d.defectsByRelease.map((r: any) => (
                              <Table.Tr key={r.milestoneId ?? 'none'}>
                                <Table.Td>
                                  {r.milestoneId ? (
                                    <Anchor component={Link} to={`/projects/${pid}/findings${qs({ defects: 'true', milestoneId: r.milestoneId })}`} size="sm">
                                      {r.milestone}
                                    </Anchor>
                                  ) : (
                                    <Text size="sm" c="dimmed">
                                      {r.milestone ?? 'No milestone'}
                                    </Text>
                                  )}
                                </Table.Td>
                                <Table.Td ta="right" fw={600}>
                                  {r.count}
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <Card title="Outstanding risks" def={def('outstandingRisks')}>
                      <Group gap="xl" align="flex-start">
                        <div>
                          <Text size="sm">
                            Open risk findings:{' '}
                            {riskCls ? (
                              <Anchor component={Link} to={drill('findings', { classification: 'risk', open: 'true' })} fw={600} inherit>
                                {riskCls.open}
                              </Anchor>
                            ) : (
                              <b>0</b>
                            )}
                          </Text>
                          <Text size="sm">
                            Unexplored high/critical-risk charters: <b>{d.riskCharters.length}</b>
                          </Text>
                        </div>
                        {d.riskCharters.length > 0 && (
                          <Stack gap={4} style={{ flex: 1, minWidth: 260 }}>
                            {d.riskCharters.map((c: any) => (
                              <Group key={c.id} gap="xs" wrap="nowrap">
                                <Badge size="xs" color={c.riskLevel === 'CRITICAL' ? 'red' : 'orange'} variant="light" w={70}>
                                  {c.riskLevel}
                                </Badge>
                                <Anchor component={Link} to={`/projects/${pid}/charters/${c.id}`} size="sm" lineClamp={1}>
                                  <span className="ex-key">{c.key}</span> {c.title}
                                </Anchor>
                              </Group>
                            ))}
                          </Stack>
                        )}
                      </Group>
                    </Card>
                  </Grid.Col>
                </Grid>
              </Section>

              <Section title="Test execution & coverage">
                <Grid gap="md">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card title="Manual execution results" def={def('manualExecution')}>
                      {me.total === 0 ? (
                        <Muted>No test-run items in scope.</Muted>
                      ) : (
                        <>
                          <Group gap="lg" mb="xs">
                            <Text size="sm">
                              Executed <b>{pct(k.manualExecutedPct)}</b>
                            </Text>
                            <Text size="sm">
                              Pass rate <b>{pct(k.manualPassRate)}</b>
                            </Text>
                            <Text size="sm" c="dimmed">
                              {me.total} items
                            </Text>
                          </Group>
                          <Progress.Root size={18}>
                            {MANUAL_CATS.map((c) =>
                              me[c] ? (
                                <Tooltip key={c} label={`${RESULT_CATEGORY[c.toUpperCase()]?.label}: ${me[c]}`}>
                                  <Progress.Section value={(me[c] / me.total) * 100} color={RESULT_CATEGORY[c.toUpperCase()]?.color ?? 'gray'} />
                                </Tooltip>
                              ) : null,
                            )}
                          </Progress.Root>
                          <Group gap="md" mt="xs">
                            {MANUAL_CATS.map((c) => (
                              <Text key={c} size="xs">
                                <Dot color={RESULT_CATEGORY[c.toUpperCase()]?.color} />
                                {RESULT_CATEGORY[c.toUpperCase()]?.label} {me[c]}
                              </Text>
                            ))}
                          </Group>
                          <Anchor component={Link} to={drill('test-runs', {})} size="xs" mt="xs" display="block">
                            View test runs →
                          </Anchor>
                        </>
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card title="Requirement coverage" def={def('requirementCoverage')}>
                      {k.requirementsTotal === 0 ? (
                        <Muted>No requirements defined.</Muted>
                      ) : (
                        <Group wrap="nowrap">
                          <DonutChart
                            size={130}
                            thickness={18}
                            withTooltip
                            chartLabel={pct(k.requirementCoverage)}
                            data={d.requirementStatus.filter((r: any) => r.count).map((r: any) => ({ name: REQ_STATUS[r.status]?.label ?? r.status, value: r.count, color: `${REQ_STATUS[r.status]?.color ?? 'gray'}.6` }))}
                          />
                          <Stack gap={3}>
                            {d.requirementStatus.map((r: any) => (
                              <Text key={r.status} size="sm">
                                <Dot color={REQ_STATUS[r.status]?.color} />
                                {REQ_STATUS[r.status]?.label ?? r.status}: <b>{r.count}</b>
                              </Text>
                            ))}
                            <Anchor component={Link} to={`/projects/${pid}/requirements`} size="xs">
                              View requirements →
                            </Anchor>
                          </Stack>
                        </Group>
                      )}
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={12}>
                    <Card title="Automation pass/fail trend" subtitle="Completed runs in scope, oldest → newest" def={def('automationPassRate')}>
                      {d.automationTrend.length === 0 ? (
                        <Muted>
                          No completed automation runs in scope.{' '}
                          <Anchor component={Link} to={`/projects/${pid}/automation?tab=setup`} size="sm">
                            Set up CI ingestion
                          </Anchor>
                        </Muted>
                      ) : (
                        <Grid gap="md">
                          <Grid.Col span={{ base: 12, md: 6 }}>
                            <LineChart h={200} data={d.automationTrend} dataKey="key" unit="%" yAxisProps={{ domain: [0, 100] }} connectNulls series={[{ name: 'passRate', label: 'Pass rate', color: 'teal.6' }]} />
                          </Grid.Col>
                          <Grid.Col span={{ base: 12, md: 6 }}>
                            <BarChart
                              h={200}
                              data={d.automationTrend}
                              dataKey="key"
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
                      )}
                    </Card>
                  </Grid.Col>
                </Grid>
              </Section>

              <Section title="Coverage gaps" description="Deterministic gap analysis across the whole project (not affected by the filters above).">
                <CoverageGaps query={gaps} pid={pid} />
              </Section>

              <ReleaseRisk />
            </Stack>
          );
        }}
      </QueryState>
    </>
  );
}

const Dot = ({ color }: { color?: string }) => {
  const c = color ?? 'gray';
  return (
    <span
      className="ex-legend-dot"
      aria-hidden
      style={{ background: `var(--mantine-color-${c}-${c === 'dark' ? 3 : 6})`, marginRight: 8, verticalAlign: 'middle', position: 'relative', top: -1 }}
    />
  );
};

const Muted = ({ children }: { children: ReactNode }) => (
  <Text size="sm" c="dimmed">
    {children}
  </Text>
);

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <Title order={2} fz={16} fw={600} mb={description ? 2 : 'sm'}>
        {title}
      </Title>
      {description && (
        <Text size="xs" c="dimmed" mb="sm">
          {description}
        </Text>
      )}
      {children}
    </section>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const measured = kind === 'measured';
  return (
    <Tooltip label={measured ? 'Derived from tracked timestamps and stored records' : 'Compares user-entered estimates (timeboxes) with measured tracked time'} multiline w={220}>
      <Badge size="xs" variant="light" color={measured ? 'teal' : 'yellow'} style={{ flexShrink: 0 }}>
        {measured ? 'Measured' : 'Estimate vs measured'}
      </Badge>
    </Tooltip>
  );
}

function Metric({ label, value, hint, def, color, to }: { label: string; value: ReactNode; hint?: string; def?: Def; color?: string; to?: string }) {
  return (
    <Paper withBorder p="md" style={{ breakInside: 'avoid' }}>
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text className="ex-label">
          {label}
        </Text>
        {def && <KindBadge kind={def.kind} />}
      </Group>
      <Text fz={26} fw={650} c={color} mt={4} className="ex-num" lh={1.15}>
        {to ? (
          <Anchor component={Link} to={to} inherit c={color ?? 'inherit'} underline="hover">
            {value}
          </Anchor>
        ) : (
          value
        )}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
      {def && (
        <Text size="xs" c="dimmed" mt={6} fs="italic">
          {def.definition}
        </Text>
      )}
    </Paper>
  );
}

function Card({ title, subtitle, def, children }: { title: string; subtitle?: string; def?: Def; children: ReactNode }) {
  return (
    <Paper withBorder p="md" h="100%" style={{ breakInside: 'avoid' }}>
      <Group justify="space-between" mb={subtitle || def ? 2 : 'sm'} wrap="nowrap">
        <Title order={5}>{title}</Title>
        {def && <KindBadge kind={def.kind} />}
      </Group>
      {(subtitle || def) && (
        <Text size="xs" c="dimmed" mb="sm">
          {[subtitle, def?.definition].filter(Boolean).join(' — ')}
        </Text>
      )}
      {children}
    </Paper>
  );
}

function ReadinessPanel({ query, pid }: { query: Q; pid: string }) {
  return (
    <QueryState query={query}>
      {(r: any) =>
        r.readiness.length === 0 ? (
          <EmptyState title="No open milestones" description="Release readiness is computed for planned and active milestones. Create one in project settings." />
        ) : (
          <SimpleGrid cols={{ base: 1, lg: Math.min(2, r.readiness.length) }}>
            {r.readiness.map((m: any) => {
              const lv = lvl(m.overall);
              return (
                <Paper key={m.milestone.id} withBorder p="md" style={{ breakInside: 'avoid' }}>
                  <Group justify="space-between" mb="xs">
                    <div>
                      <Text fw={700}>{m.milestone.name}</Text>
                      <Text size="xs" c="dimmed">
                        {m.milestone.dueDate ? `Due ${fmtDate(m.milestone.dueDate)} · ` : ''}
                        {m.sessions} sessions · {m.effortHours} h tracked
                      </Text>
                    </div>
                    <Badge color={lv.color} size="lg" leftSection={<lv.icon size={14} />}>
                      {lv.label}
                    </Badge>
                  </Group>
                  <Stack gap={6}>
                    {m.indicators.map((i: any) => {
                      const il = lvl(i.level);
                      return (
                        <div key={i.key}>
                          <Group justify="space-between" wrap="nowrap" gap="xs">
                            <Group gap={6} wrap="nowrap">
                              <ThemeIcon size={16} radius="xl" color={il.color} variant="light">
                                <il.icon size={10} />
                              </ThemeIcon>
                              <Text size="sm">{i.label}</Text>
                            </Group>
                            <Group gap={8} wrap="nowrap">
                              <Text size="xs" c="dimmed" visibleFrom="sm">
                                {i.threshold}
                              </Text>
                              <Text size="sm" fw={600} miw={56} ta="right">
                                {i.value == null ? 'no data' : `${i.value}${i.unit === '%' ? '%' : ` ${i.unit}`}`}
                              </Text>
                            </Group>
                          </Group>
                          {i.items?.length > 0 && (
                            <List size="xs" ml={28} mt={2} spacing={0}>
                              {i.items.slice(0, 5).map((it: any) => (
                                <List.Item key={it.id}>
                                  <Anchor component={Link} to={`/projects/${pid}/${i.key === 'blockers' ? 'issues' : 'findings'}/${it.id}`} size="xs">
                                    {it.key} {it.title}
                                  </Anchor>{' '}
                                  {it.severity && <SeverityBadge value={it.severity} size="xs" />}
                                </List.Item>
                              ))}
                              {i.items.length > 5 && <List.Item>…and {i.items.length - 5} more</List.Item>}
                            </List>
                          )}
                          {i.run && (
                            <Anchor component={Link} to={`/projects/${pid}/automation/runs/${i.run.id}`} size="xs" ml={28}>
                              {i.run.key} {i.run.name}
                            </Anchor>
                          )}
                        </div>
                      );
                    })}
                  </Stack>
                </Paper>
              );
            })}
          </SimpleGrid>
        )
      }
    </QueryState>
  );
}

function CoverageGaps({ query, pid }: { query: Q; pid: string }) {
  return (
    <QueryState query={query}>
      {(g: any) => (
        <Paper withBorder>
          <Tabs defaultValue="unexplored">
            <Tabs.List px="sm" pt="xs">
              <Tabs.Tab value="unexplored">Unexplored charters ({g.unexploredCharters.length})</Tabs.Tab>
              <Tabs.Tab value="stale">Stale charters ({g.staleCharters.length})</Tabs.Tab>
              <Tabs.Tab value="reqs">Uncovered requirements ({g.uncoveredRequirements.length})</Tabs.Tab>
              <Tabs.Tab value="tcs">Never-executed test cases ({g.neverExecutedTestCases.length})</Tabs.Tab>
              <Tabs.Tab value="features">Effort by feature</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="unexplored" p="md">
              <GapList
                empty="Every charter has at least one completed session."
                items={g.unexploredCharters}
                to={(c) => `/projects/${pid}/charters/${c.id}`}
                extra={(c) =>
                  c.riskLevel && (
                    <Badge size="xs" variant="light">
                      {c.riskLevel} risk
                    </Badge>
                  )
                }
              />
            </Tabs.Panel>
            <Tabs.Panel value="stale" p="md">
              <Text size="xs" c="dimmed" mb="xs">
                Explored before, but no session ended in the last 30 days.
              </Text>
              <GapList
                empty="No stale charters."
                items={g.staleCharters}
                to={(c) => `/projects/${pid}/charters/${c.id}`}
                extra={(c) => (
                  <Text size="xs" c="dimmed">
                    last {fmtDate(c.lastExploredAt)}
                  </Text>
                )}
              />
            </Tabs.Panel>
            <Tabs.Panel value="reqs" p="md">
              <GapList
                empty="All requirements are covered."
                items={g.uncoveredRequirements}
                to={(r) => `/projects/${pid}/requirements/${r.id}`}
                extra={(r) =>
                  r.priority && (
                    <Badge size="xs" variant="light">
                      {r.priority}
                    </Badge>
                  )
                }
              />
            </Tabs.Panel>
            <Tabs.Panel value="tcs" p="md">
              <GapList
                empty="Every active test case has been executed at least once."
                items={g.neverExecutedTestCases}
                to={(t) => `/projects/${pid}/test-cases/${t.id}`}
                extra={(t) =>
                  t.priority && (
                    <Badge size="xs" variant="light">
                      {t.priority}
                    </Badge>
                  )
                }
              />
            </Tabs.Panel>
            <Tabs.Panel value="features" p="md">
              {g.featureEffort.length === 0 ? (
                <Muted>No sessions yet.</Muted>
              ) : (
                <Table fz="sm" verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Feature (charter target)</Table.Th>
                      <Table.Th ta="right">Sessions</Table.Th>
                      <Table.Th ta="right">Effort (h)</Table.Th>
                      <Table.Th ta="right">Findings</Table.Th>
                      <Table.Th ta="right">Findings / h</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {g.featureEffort.map((f: any) => (
                      <Table.Tr key={f.feature}>
                        <Table.Td>{f.feature}</Table.Td>
                        <Table.Td ta="right">{f.sessions}</Table.Td>
                        <Table.Td ta="right">{f.effortHours}</Table.Td>
                        <Table.Td ta="right">{f.findings}</Table.Td>
                        <Table.Td ta="right">{f.findingsPerHour ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Tabs.Panel>
          </Tabs>
        </Paper>
      )}
    </QueryState>
  );
}

function GapList({ items, empty, to, extra }: { items: any[]; empty: string; to: (x: any) => string; extra?: (x: any) => ReactNode }) {
  if (items.length === 0) return <Muted>{empty}</Muted>;
  return (
    <Stack gap={4}>
      {items.map((x) => (
        <Group key={x.id} gap="xs" wrap="nowrap">
          <Anchor component={Link} to={to(x)} size="sm" lineClamp={1}>
            <span className="ex-key">{x.key}</span> {x.title}
          </Anchor>
          {extra?.(x)}
        </Group>
      ))}
      {items.length >= 50 && (
        <Text size="xs" c="dimmed">
          Showing the first 50.
        </Text>
      )}
    </Stack>
  );
}

function ReleaseRisk() {
  const { pid, milestoneOptions, can, milestones } = useProject();
  const [sp] = useSearchParams();
  const ai = useAiStatus();
  const firstOpen = (milestones as any[]).find((m) => m.status === 'PLANNED' || m.status === 'ACTIVE')?.id as string | undefined;
  const [milestoneId, setMilestoneId] = useState<string | null>(sp.get('milestoneId') ?? firstOpen ?? null);
  const gen = useMutation({ mutationFn: () => api.post(p(pid, '/ai/release-risk'), { milestoneId }), onError: (e) => toastError(e, 'Could not generate summary') });
  const r: any = gen.data;

  return (
    <Paper withBorder p="md" className={r ? undefined : 'ex-no-print'}>
      <Group justify="space-between" mb="xs">
        <Group gap={6}>
          <IconSparkles size={18} />
          <Title order={5}>AI release risk summary</Title>
          <Badge size="xs" variant="outline" color="gray">
            Optional
          </Badge>
        </Group>
        {r && <AiDraftBadge meta={r.meta} />}
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        Summarises the measured readiness indicators for one milestone. Nothing is saved — review the draft before sharing it.
      </Text>
      {ai.data && !ai.data.enabled ? (
        <AiSetupNotice status={ai.data} />
      ) : (
        <>
          <Group align="flex-end" gap="sm" className="ex-no-print">
            <Select label="Milestone" data={milestoneOptions} value={milestoneId} onChange={setMilestoneId} w={240} placeholder="Choose milestone" />
            <Button leftSection={<IconSparkles size={16} />} onClick={() => gen.mutate()} loading={gen.isPending} disabled={!milestoneId || !can('TESTER')} variant="light" color="grape">
              {r ? 'Regenerate' : 'Generate draft'}
            </Button>
            {!can('TESTER') && (
              <Text size="xs" c="dimmed">
                Requires the tester role.
              </Text>
            )}
          </Group>
          {r && (
            <Stack gap="sm" mt="md">
              <Text size="sm">{r.draft.summary}</Text>
              {r.draft.risks?.length > 0 && (
                <Table fz="sm" withTableBorder verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Area</Table.Th>
                      <Table.Th>Level</Table.Th>
                      <Table.Th>Rationale</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {r.draft.risks.map((x: any, i: number) => (
                      <Table.Tr key={i}>
                        <Table.Td>{x.area}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="light" color={/high|critical/i.test(x.level) ? 'red' : /medium/i.test(x.level) ? 'yellow' : 'gray'}>
                            {x.level}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{x.rationale}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <Alert variant="light" color="grape" title="Recommendation">
                {r.draft.recommendation}
              </Alert>
              <Text size="xs" c="dimmed">
                Based on readiness for {r.readiness.milestone.name} (overall: {lvl(r.readiness.overall).label}) · generated {fmtDateTime(r.meta.generatedAt)}
              </Text>
            </Stack>
          )}
        </>
      )}
    </Paper>
  );
}
