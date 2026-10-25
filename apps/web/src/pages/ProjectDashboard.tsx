import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Grid, Group, Paper, Progress, Select, SimpleGrid, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { AreaChart, BarChart, DonutChart } from '@mantine/charts';
import { IconAlertTriangle, IconCheck, IconChartBar, IconCircleDashed, IconClockHour4, IconPlayerPlay, IconPlus, IconTargetArrow, IconX } from '@tabler/icons-react';
import { api, p } from '../lib/api';
import { pct } from '../lib/format';
import { useProject } from '../lib/project';
import { SESSION_STATUS, SEVERITY } from '../lib/constants';
import { EmptyState, PageHeader, QueryState, StatCard } from '../components/ui';
import { LaunchSessionModal } from '../components/LaunchSessionModal';

const LEVEL = {
  pass: { color: 'green', icon: IconCheck, label: 'Ready' },
  warn: { color: 'yellow', icon: IconAlertTriangle, label: 'At risk' },
  fail: { color: 'red', icon: IconX, label: 'Not ready' },
  insufficient_data: { color: 'gray', icon: IconCircleDashed, label: 'Insufficient data' },
} as const;

export default function ProjectDashboard() {
  const { pid, project, milestoneOptions, can } = useProject();
  const navigate = useNavigate();
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [launch, setLaunch] = useState(false);
  const dash = useQuery({ queryKey: ['dashboard', pid, milestoneId], queryFn: () => api.get(p(pid, '/reports/dashboard'), { milestoneId }) });
  const ready = useQuery({ queryKey: ['readiness', pid, milestoneId], queryFn: () => api.get(p(pid, '/reports/readiness'), { milestoneId }) });

  return (
    <>
      <PageHeader
        kicker={project.key}
        title={project.name}
        subtitle={project.description ?? undefined}
        actions={
          <>
            <Select placeholder="All milestones" data={milestoneOptions} value={milestoneId} onChange={setMilestoneId} clearable w={200} aria-label="Milestone filter" />
            {can('TESTER') && (
              <>
                <Button variant="default" leftSection={<IconPlus size={16} />} component={Link} to={`/projects/${pid}/charters/new`}>
                  New charter
                </Button>
                <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => setLaunch(true)}>
                  Start session
                </Button>
              </>
            )}
          </>
        }
      />
      <QueryState query={dash}>
        {(d: any) => {
          const k = d.kpis;
          const def = (key: string) => d.definitions?.[key]?.definition as string | undefined;
          return (
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
                <Tooltip label={def('totalCharters')} multiline w={260} disabled={!def('totalCharters')}>
                  <div>
                    <StatCard label="Charters" value={k.totalCharters} icon={<IconTargetArrow size={16} />} />
                  </div>
                </Tooltip>
                <Tooltip label={def('activeSessions')} multiline w={260} disabled={!def('activeSessions')}>
                  <div>
                    <StatCard label="Active sessions" value={k.activeSessions} hint={`${k.draftSessions} draft`} icon={<IconPlayerPlay size={16} />} />
                  </div>
                </Tooltip>
                <Tooltip label={def('completionRate')} multiline w={260} disabled={!def('completionRate')}>
                  <div>
                    <StatCard label="Session completion" value={pct(k.completionRate)} hint={`${k.completedSessions} of ${k.totalSessions} done`} color="blue" />
                  </div>
                </Tooltip>
                <Tooltip label={def('effortHours')} multiline w={260} disabled={!def('effortHours')}>
                  <div>
                    <StatCard
                      label="Testing effort"
                      value={`${k.effortHours}h`}
                      hint={k.actualToEstimateRatio != null ? `actual/timebox ${k.actualToEstimateRatio.toFixed(2)}×` : 'measured from timers'}
                      icon={<IconClockHour4 size={16} />}
                      color="cyan"
                    />
                  </div>
                </Tooltip>
                <Tooltip label={def('unresolvedFindings')} multiline w={260} disabled={!def('unresolvedFindings')}>
                  <div>
                    <StatCard label="Unresolved findings" value={k.unresolvedFindings} hint={`${k.totalFindings} total`} color="orange" />
                  </div>
                </Tooltip>
                <Tooltip label={def('confirmedDefects')} multiline w={260} disabled={!def('confirmedDefects')}>
                  <div>
                    <StatCard label="Confirmed defects" value={k.confirmedDefects} hint={`${k.outstandingRisks} outstanding risks`} color="red" />
                  </div>
                </Tooltip>
              </SimpleGrid>

              <ReadinessPanel query={ready} />

              <Grid gap="lg">
                <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                  <Paper withBorder p="md" h="100%">
                    <Title order={5} mb="sm">
                      Sessions by status
                    </Title>
                    {d.sessionsByStatus.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No sessions yet.
                      </Text>
                    ) : (
                      <Group wrap="nowrap" align="center">
                        <DonutChart
                          size={150}
                          thickness={22}
                          withTooltip
                          data={d.sessionsByStatus.map((s: any) => ({ name: SESSION_STATUS[s.status]?.label ?? s.status, value: s.count, color: `${SESSION_STATUS[s.status]?.color ?? 'gray'}.6` }))}
                        />
                        <Stack gap={4}>
                          {d.sessionsByStatus.map((s: any) => (
                            <Text
                              key={s.status}
                              size="sm"
                              component={Link}
                              to={`/projects/${pid}/sessions?view=all&status=${s.status}`}
                              className="ex-link"
                            >
                              <Badge size="xs" color={SESSION_STATUS[s.status]?.color} variant="filled" mr={6} circle>
                                {' '}
                              </Badge>
                              {SESSION_STATUS[s.status]?.label ?? s.status}: <b>{s.count}</b>
                            </Text>
                          ))}
                        </Stack>
                      </Group>
                    )}
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                  <Paper withBorder p="md" h="100%">
                    <Title order={5} mb="sm">
                      Findings by classification
                    </Title>
                    {d.findingsByClassification.every((c: any) => c.count === 0) ? (
                      <Text size="sm" c="dimmed">
                        No findings yet.
                      </Text>
                    ) : (
                      <BarChart
                        h={200}
                        data={d.findingsByClassification.map((c: any) => ({ name: c.name, Open: c.open, Resolved: c.count - c.open }))}
                        dataKey="name"
                        type="stacked"
                        orientation="vertical"
                        yAxisProps={{ width: 110 }}
                        series={[
                          { name: 'Open', color: 'orange.6' },
                          { name: 'Resolved', color: 'gray.5' },
                        ]}
                      />
                    )}
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 12, lg: 4 }}>
                  <Paper withBorder p="md" h="100%">
                    <Title order={5} mb="sm">
                      Findings by severity
                    </Title>
                    <Stack gap={8}>
                      {Object.entries(SEVERITY)
                        .reverse()
                        .map(([key, meta]) => {
                          const row = d.findingsBySeverity.find((s: any) => s.severity === key) ?? { count: 0, open: 0 };
                          const max = Math.max(1, ...d.findingsBySeverity.map((s: any) => s.count));
                          return (
                            <div key={key}>
                              <Group justify="space-between" gap={4}>
                                <Text size="sm">{meta.label}</Text>
                                <Text size="xs" c="dimmed">
                                  {row.open} open / {row.count}
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
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 8 }}>
                  <Paper withBorder p="md">
                    <Title order={5} mb="sm">
                      Weekly exploratory activity
                    </Title>
                    {d.weeklyActivity.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No activity in the selected period.
                      </Text>
                    ) : (
                      <AreaChart
                        h={220}
                        data={d.weeklyActivity}
                        dataKey="week"
                        curveType="monotone"
                        withLegend
                        series={[
                          { name: 'sessions', label: 'Sessions', color: 'explorix.6' },
                          { name: 'findings', label: 'Findings', color: 'orange.6' },
                          { name: 'effortHours', label: 'Effort (h)', color: 'blue.6' },
                        ]}
                      />
                    )}
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 4 }}>
                  <Paper withBorder p="md" h="100%">
                    <Title order={5} mb="sm">
                      High-risk charters
                    </Title>
                    {d.riskCharters.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No high or critical risk charters without completed sessions.
                      </Text>
                    ) : (
                      <Stack gap={6}>
                        {d.riskCharters.map((c: any) => (
                          <Group key={c.id} justify="space-between" wrap="nowrap">
                            <Text size="sm" component={Link} to={`/projects/${pid}/charters/${c.id}`} className="ex-link" lineClamp={1}>
                              <span className="ex-key">{c.key}</span> {c.title}
                            </Text>
                            <Badge size="sm" color={c.riskLevel === 'CRITICAL' ? 'red' : 'orange'} variant="light">
                              {c.riskLevel}
                            </Badge>
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                </Grid.Col>
              </Grid>

              <SimpleGrid cols={{ base: 1, md: 3 }}>
                <StatCard label="Manual tests executed" value={pct(k.manualExecutedPct)} hint={`pass rate ${pct(k.manualPassRate)}`} />
                <StatCard label="Automation pass rate" value={pct(k.automationPassRate)} hint={`${k.automationRuns} runs in period`} />
                <StatCard label="Requirement coverage" value={pct(k.requirementCoverage)} hint={`${k.requirementsTotal} requirements`} />
              </SimpleGrid>
              <Group justify="flex-end">
                <Button variant="subtle" leftSection={<IconChartBar size={16} />} onClick={() => navigate(`/projects/${pid}/reports`)}>
                  Full reports, metric definitions & exports
                </Button>
              </Group>
            </Stack>
          );
        }}
      </QueryState>
      <LaunchSessionModal opened={launch} onClose={() => setLaunch(false)} onLaunched={(s) => navigate(`/projects/${pid}/sessions/${s.id}`)} />
    </>
  );
}

function ReadinessPanel({ query }: { query: { isLoading: boolean; error: unknown; data: any } }) {
  return (
    <QueryState query={query}>
      {(r: any) =>
        r.readiness.length === 0 ? (
          <EmptyState title="No open milestones" description="Create a milestone in project settings to track release readiness." />
        ) : (
          <SimpleGrid cols={{ base: 1, md: Math.min(3, r.readiness.length) }}>
            {r.readiness.slice(0, 3).map((m: any) => {
              const lv = LEVEL[m.overall as keyof typeof LEVEL] ?? LEVEL.insufficient_data;
              return (
                <Paper key={m.milestone.id} withBorder p="md">
                  <Group justify="space-between" mb="xs">
                    <div>
                      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                        Release readiness
                      </Text>
                      <Text fw={700}>{m.milestone.name}</Text>
                    </div>
                    <Badge color={lv.color} size="lg" leftSection={<lv.icon size={14} />}>
                      {lv.label}
                    </Badge>
                  </Group>
                  <Stack gap={4}>
                    {m.indicators.map((i: any) => {
                      const il = LEVEL[i.level as keyof typeof LEVEL] ?? LEVEL.insufficient_data;
                      return (
                        <Group key={i.key} justify="space-between" wrap="nowrap" gap="xs">
                          <Group gap={6} wrap="nowrap">
                            <ThemeIcon size={16} radius="xl" color={il.color} variant="light">
                              <il.icon size={10} />
                            </ThemeIcon>
                            <Text size="sm">{i.label}</Text>
                          </Group>
                          <Tooltip label={i.threshold} disabled={!i.threshold}>
                            <Text size="sm" fw={600}>
                              {i.value == null ? '—' : `${i.value}${i.unit === '%' ? '%' : i.unit ? ` ${i.unit}` : ''}`}
                            </Text>
                          </Tooltip>
                        </Group>
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
