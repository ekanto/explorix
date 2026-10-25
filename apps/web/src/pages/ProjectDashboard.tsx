import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Box, Button, Grid, Group, Progress, Select, Stack, Text, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core';
import { AreaChart, BarChart, DonutChart } from '@mantine/charts';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBug,
  IconBulb,
  IconCheck,
  IconChecklist,
  IconCircleCheck,
  IconCircleDashed,
  IconClockHour4,
  IconFileDescription,
  IconFlag,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconShieldCheck,
  IconTargetArrow,
  IconTimeline,
  IconX,
} from '@tabler/icons-react';
import { api, p } from '../lib/api';
import { pct } from '../lib/format';
import { useProject } from '../lib/project';
import { SESSION_STATUS, SEVERITY } from '../lib/constants';
import { EmptyState, PageHeader, QueryState, SectionCard, SectionHeading, StatCard } from '../components/ui';
import { LaunchSessionModal } from '../components/LaunchSessionModal';

const LEVEL = {
  pass: { color: 'green', icon: IconCheck, label: 'Ready' },
  warn: { color: 'yellow', icon: IconAlertTriangle, label: 'At risk' },
  fail: { color: 'red', icon: IconX, label: 'Not ready' },
  insufficient_data: { color: 'gray', icon: IconCircleDashed, label: 'Insufficient data' },
} as const;

// Container breakpoints: the grid adapts to the content width (sidebar expanded/collapsed, window size), not the viewport.
const GRID_BP = { xs: '480px', sm: '640px', md: '820px', lg: '1040px', xl: '1320px' };
const ICON = 16;
/** Chart/legend swatch as "color-shade"; the near-black `dark` status colour uses a mid shade so it stays visible in both themes. */
const swatch = (color = 'gray') => (color === 'dark' ? 'dark-3' : `${color}-6`);

export default function ProjectDashboard() {
  const { pid, project, milestoneOptions, can } = useProject();
  const navigate = useNavigate();
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [launch, setLaunch] = useState(false);
  const dash = useQuery({ queryKey: ['dashboard', pid, milestoneId], queryFn: () => api.get(p(pid, '/reports/dashboard'), { milestoneId }) });
  const ready = useQuery({ queryKey: ['readiness', pid, milestoneId], queryFn: () => api.get(p(pid, '/reports/readiness'), { milestoneId }) });
  const base = `/projects/${pid}`;

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link to="/projects" className="ex-link" style={{ color: 'inherit' }}>
              Projects
            </Link>
            <span aria-hidden>/</span>
            <span>{project.key}</span>
          </>
        }
        title={project.name}
        subtitle={project.description ?? undefined}
        actions={
          <>
            <Select
              placeholder="All milestones"
              data={milestoneOptions}
              value={milestoneId}
              onChange={setMilestoneId}
              clearable
              w={210}
              leftSection={<IconFlag size={ICON} />}
              aria-label="Milestone filter"
            />
            {can('TESTER') && (
              <>
                <Button variant="default" leftSection={<IconPlus size={ICON} />} component={Link} to={`${base}/charters/new`}>
                  New charter
                </Button>
                <Button leftSection={<IconPlayerPlay size={ICON} />} onClick={() => setLaunch(true)}>
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
          const totalFindings = d.findingsBySeverity.reduce((n: number, s: any) => n + s.count, 0);
          return (
            <Stack gap="lg">
              {/* 1. Primary exploratory metrics */}
              <Grid type="container" breakpoints={GRID_BP} gap="md">
                {[
                  <StatCard key="c" label="Charters" value={k.totalCharters} hint={`${k.totalSessions} sessions launched`} icon={<IconTargetArrow size={ICON} />} tooltip={def('totalCharters')} />,
                  <StatCard key="a" label="Active sessions" value={k.activeSessions} hint={`${k.draftSessions} draft`} icon={<IconPlayerPlay size={ICON} />} tooltip={def('activeSessions')} />,
                  <StatCard
                    key="p"
                    label="Session completion"
                    value={pct(k.completionRate)}
                    hint={`${k.completedSessions} of ${k.totalSessions} done`}
                    icon={<IconCircleCheck size={ICON} />}
                    tooltip={def('completionRate')}
                  />,
                  <StatCard
                    key="e"
                    label="Testing effort"
                    value={`${k.effortHours}h`}
                    hint={k.actualToEstimateRatio != null ? `${k.actualToEstimateRatio.toFixed(2)}× of timebox` : 'Measured from session timers'}
                    icon={<IconClockHour4 size={ICON} />}
                    tooltip={def('effortHours')}
                  />,
                  <StatCard
                    key="f"
                    label="Unresolved findings"
                    value={k.unresolvedFindings}
                    hint={`${k.totalFindings} total`}
                    icon={<IconBulb size={ICON} />}
                    color={k.unresolvedFindings > 0 ? 'orange' : undefined}
                    tooltip={def('unresolvedFindings')}
                  />,
                  <StatCard
                    key="d"
                    label="Confirmed defects"
                    value={k.confirmedDefects}
                    hint={`${k.outstandingRisks} outstanding risks`}
                    icon={<IconBug size={ICON} />}
                    color={k.confirmedDefects > 0 ? 'red' : undefined}
                    tooltip={def('confirmedDefects')}
                  />,
                ].map((card) => (
                  <Grid.Col key={card.key} span={{ base: 12, xs: 6, md: 4, xl: 2 }}>
                    {card}
                  </Grid.Col>
                ))}
              </Grid>

              {/* 2. Milestone / release readiness */}
              <ReadinessPanel query={ready} settingsLink={`${base}/settings?tab=milestones`} canManage={can('LEAD')} />

              {/* 3. Exploratory analytics */}
              <Box>
                <SectionHeading
                  action={
                    <Button variant="subtle" size="xs" rightSection={<IconArrowRight size={14} />} onClick={() => navigate(`${base}/reports`)}>
                      Reports & metric definitions
                    </Button>
                  }
                >
                  Exploratory analytics
                </SectionHeading>
                <Grid type="container" breakpoints={GRID_BP} gap="md">
                  <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                    <SectionCard title="Sessions by status" h="100%">
                      {d.sessionsByStatus.length === 0 ? (
                        <EmptyState
                          compact
                          icon={<IconPlayerPlay size={16} />}
                          title="No sessions yet"
                          description="Launch a charter to start exploring."
                          action={
                            can('TESTER') ? (
                              <Button size="xs" variant="default" onClick={() => setLaunch(true)}>
                                Start session
                              </Button>
                            ) : undefined
                          }
                        />
                      ) : (
                        <Group wrap="nowrap" align="center" gap="lg">
                          <DonutChart
                            size={132}
                            thickness={18}
                            withTooltip
                            tooltipDataSource="segment"
                            chartLabel={d.sessionsByStatus.reduce((n: number, s: any) => n + s.count, 0)}
                            data={d.sessionsByStatus.map((s: any) => ({ name: SESSION_STATUS[s.status]?.label ?? s.status, value: s.count, color: swatch(SESSION_STATUS[s.status]?.color).replace('-', '.') }))}
                          />
                          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                            {d.sessionsByStatus.map((s: any) => (
                              <UnstyledButton
                                key={s.status}
                                component={Link}
                                to={`${base}/sessions?view=all&status=${s.status}`}
                                className="ex-link"
                                style={{ color: 'inherit', borderRadius: 4 }}
                              >
                                <Group gap={8} wrap="nowrap" justify="space-between">
                                  <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                                    <span className="ex-legend-dot" style={{ background: `var(--mantine-color-${swatch(SESSION_STATUS[s.status]?.color)})` }} />
                                    <Text size="sm" truncate>
                                      {SESSION_STATUS[s.status]?.label ?? s.status}
                                    </Text>
                                  </Group>
                                  <Text size="sm" fw={600} className="ex-num">
                                    {s.count}
                                  </Text>
                                </Group>
                              </UnstyledButton>
                            ))}
                          </Stack>
                        </Group>
                      )}
                    </SectionCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                    <SectionCard title="Findings by classification" h="100%">
                      {d.findingsByClassification.every((c: any) => c.count === 0) ? (
                        <EmptyState compact icon={<IconBulb size={16} />} title="No findings yet" description="Findings logged during sessions are classified here." />
                      ) : (
                        <BarChart
                          h={Math.max(150, d.findingsByClassification.length * 34 + 30)}
                          data={d.findingsByClassification.map((c: any) => ({ name: c.name, Open: c.open, Resolved: c.count - c.open }))}
                          dataKey="name"
                          type="stacked"
                          orientation="vertical"
                          yAxisProps={{ width: 116 }}
                          gridAxis="none"
                          withLegend
                          legendProps={{ verticalAlign: 'top', height: 28 }}
                          barProps={{ radius: 2 }}
                          series={[
                            { name: 'Open', color: 'orange.6' },
                            { name: 'Resolved', color: 'gray.5' },
                          ]}
                        />
                      )}
                    </SectionCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 4 }}>
                    <SectionCard title="Findings by severity" description={totalFindings ? 'Open share of each severity' : undefined} h="100%">
                      {totalFindings === 0 ? (
                        <EmptyState compact icon={<IconShieldCheck size={16} />} title="Nothing to triage" description="Severity breakdown appears once findings are logged." />
                      ) : (
                        <Stack gap={10}>
                          {Object.entries(SEVERITY)
                            .reverse()
                            .map(([key, meta]) => {
                              const row = d.findingsBySeverity.find((s: any) => s.severity === key) ?? { count: 0, open: 0 };
                              const max = Math.max(1, ...d.findingsBySeverity.map((s: any) => s.count));
                              return (
                                <div key={key}>
                                  <Group justify="space-between" gap={4} mb={4}>
                                    <Text size="sm">{meta.label}</Text>
                                    <Text size="xs" c="dimmed" className="ex-num">
                                      {row.open} open / {row.count}
                                    </Text>
                                  </Group>
                                  <Progress.Root size={6} aria-label={`${meta.label}: ${row.open} open of ${row.count}`}>
                                    <Progress.Section value={(row.open / max) * 100} color={meta.color} />
                                    <Progress.Section value={((row.count - row.open) / max) * 100} color="gray.5" />
                                  </Progress.Root>
                                </div>
                              );
                            })}
                        </Stack>
                      )}
                    </SectionCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 8 }}>
                    <SectionCard title="Weekly exploratory activity" description={d.weeklyActivity.length ? 'Sessions, findings and effort per week' : undefined} h="100%">
                      {d.weeklyActivity.length === 0 ? (
                        <EmptyState compact icon={<IconTimeline size={16} />} title="No activity in this period" description="Weekly sessions, findings and effort are charted as testing happens." />
                      ) : (
                        <AreaChart
                          h={230}
                          data={d.weeklyActivity}
                          dataKey="week"
                          curveType="monotone"
                          withLegend
                          legendProps={{ verticalAlign: 'top', height: 32 }}
                          gridAxis="y"
                          fillOpacity={0.18}
                          series={[
                            { name: 'sessions', label: 'Sessions', color: 'explorix.5' },
                            { name: 'findings', label: 'Findings', color: 'orange.6' },
                            { name: 'effortHours', label: 'Effort (h)', color: 'blue.5' },
                          ]}
                        />
                      )}
                    </SectionCard>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 4 }}>
                    <SectionCard title="High-risk charters" description="High or critical risk, no completed session yet" h="100%">
                      {d.riskCharters.length === 0 ? (
                        <EmptyState compact icon={<IconShieldCheck size={16} />} title="No uncovered high-risk charters" description="Every high or critical risk charter has a completed session." />
                      ) : (
                        <Stack gap={2}>
                          {d.riskCharters.map((c: any) => (
                            <Group key={c.id} justify="space-between" wrap="nowrap" gap="sm" py={6} style={{ borderBottom: '1px solid var(--ex-border)' }}>
                              <Text size="sm" component={Link} to={`${base}/charters/${c.id}`} className="ex-link" truncate style={{ minWidth: 0 }}>
                                <span className="ex-key">{c.key}</span> {c.title}
                              </Text>
                              <Badge size="sm" color={c.riskLevel === 'CRITICAL' ? 'red' : 'orange'}>
                                {c.riskLevel === 'CRITICAL' ? 'Critical' : 'High'}
                              </Badge>
                            </Group>
                          ))}
                        </Stack>
                      )}
                    </SectionCard>
                  </Grid.Col>
                </Grid>
              </Box>

              {/* 4. Secondary quality metrics */}
              <Box>
                <SectionHeading>Test management & automation</SectionHeading>
                <Grid type="container" breakpoints={GRID_BP} gap="md">
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <StatCard
                      label="Manual tests executed"
                      value={pct(k.manualExecutedPct)}
                      hint={k.manualPassRate != null ? `Pass rate ${pct(k.manualPassRate)}` : 'No manual results yet'}
                      icon={<IconChecklist size={ICON} />}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <StatCard label="Automation pass rate" value={pct(k.automationPassRate)} hint={`${k.automationRuns} runs in period`} icon={<IconRobot size={ICON} />} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 4 }}>
                    <StatCard label="Requirement coverage" value={pct(k.requirementCoverage)} hint={`${k.requirementsTotal} requirements`} icon={<IconFileDescription size={ICON} />} />
                  </Grid.Col>
                </Grid>
              </Box>
            </Stack>
          );
        }}
      </QueryState>
      <LaunchSessionModal opened={launch} onClose={() => setLaunch(false)} onLaunched={(s) => navigate(`${base}/sessions/${s.id}`)} />
    </>
  );
}

function ReadinessPanel({ query, settingsLink, canManage }: { query: { isLoading: boolean; error: unknown; data: any }; settingsLink: string; canManage: boolean }) {
  return (
    <QueryState query={query}>
      {(r: any) =>
        r.readiness.length === 0 ? (
          <SectionCard title="Release readiness">
            <EmptyState
              compact
              icon={<IconFlag size={16} />}
              title="No open milestones"
              description="Create a milestone to track release readiness against open defects, coverage and pass rates."
              action={
                canManage ? (
                  <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} component={Link} to={settingsLink}>
                    Create milestone
                  </Button>
                ) : undefined
              }
            />
          </SectionCard>
        ) : (
          <SectionCard
            title="Release readiness"
            description={`${r.readiness.length} open milestone${r.readiness.length === 1 ? '' : 's'}${r.readiness.length > 3 ? ' · showing the first 3' : ''}`}
            actions={
              canManage ? (
                <Button size="xs" variant="subtle" component={Link} to={settingsLink} rightSection={<IconArrowRight size={14} />}>
                  Manage milestones
                </Button>
              ) : undefined
            }
          >
            <Grid type="container" breakpoints={GRID_BP} gap="md">
              {r.readiness.slice(0, 3).map((m: any) => {
                const lv = LEVEL[m.overall as keyof typeof LEVEL] ?? LEVEL.insufficient_data;
                return (
                  <Grid.Col key={m.milestone.id} span={{ base: 12, md: r.readiness.length === 1 ? 12 : 6, xl: 12 / Math.min(3, r.readiness.length) }}>
                    <Box p="sm" h="100%" style={{ border: '1px solid var(--ex-border)', borderRadius: 'var(--ex-radius-md)', background: 'var(--ex-subtle)' }}>
                      <Group justify="space-between" mb="xs" wrap="nowrap" gap="sm">
                        <Text fw={600} truncate>
                          {m.milestone.name}
                        </Text>
                        <Badge color={lv.color} size="md" leftSection={<lv.icon size={12} />}>
                          {lv.label}
                        </Badge>
                      </Group>
                      <Stack gap={6}>
                        {m.indicators.map((i: any) => {
                          const il = LEVEL[i.level as keyof typeof LEVEL] ?? LEVEL.insufficient_data;
                          return (
                            <Group key={i.key} justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
                              <Group gap={8} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                                <ThemeIcon size={18} radius="xl" color={il.color} variant="light" mt={1} aria-label={il.label}>
                                  <il.icon size={11} />
                                </ThemeIcon>
                                <Text size="sm" c="var(--ex-fg-secondary)">
                                  {i.label}
                                </Text>
                              </Group>
                              <Tooltip label={i.threshold} disabled={!i.threshold}>
                                <Text size="sm" fw={600} className="ex-num" style={{ whiteSpace: 'nowrap' }}>
                                  {i.value == null ? '—' : `${i.value}${i.unit === '%' ? '%' : i.unit ? ` ${i.unit}` : ''}`}
                                </Text>
                              </Tooltip>
                            </Group>
                          );
                        })}
                      </Stack>
                    </Box>
                  </Grid.Col>
                );
              })}
            </Grid>
          </SectionCard>
        )
      }
    </QueryState>
  );
}
