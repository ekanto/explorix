import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Box, Button, Grid, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconActivity, IconBug, IconBulb, IconPlayerPlay, IconUserCheck } from '@tabler/icons-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clock, fromNow, titleCase } from '../lib/format';
import { ClassificationBadge, EmptyState, KeyLink, PageHeader, QueryState, SectionCard, SectionHeading, SessionStatusBadge, SeverityBadge, StatCard, StatGrid, UserAvatar, UserLabel } from '../components/ui';
import { SampleProjectButton } from './Projects';

export default function Overview() {
  const { user, isOrgAdmin } = useAuth();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/overview'), refetchInterval: 60_000 });
  const mw = useQuery({ queryKey: ['my-work'], queryFn: () => api.get('/my-work') });
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageHeader title={`${greet}, ${user?.name.split(' ')[0]}`} subtitle="Quality at a glance across all projects you can access." />
      <QueryState query={q}>
        {(d: any) => (
          <Stack gap="xl">
            <StatGrid max={4}>
              <StatCard label="My active sessions" value={mw.data?.counts.activeSessions ?? '—'} icon={<IconPlayerPlay size={16} />} hint={<Link to="/my-work" className="ex-link">Open My Work</Link>} />
              <StatCard label="Awaiting my review" value={mw.data?.counts.reviews ?? '—'} icon={<IconUserCheck size={16} />} color={(mw.data?.counts.reviews ?? 0) > 0 ? 'violet' : undefined} hint="Sessions submitted for review" />
              <StatCard label="My open findings" value={mw.data?.counts.openFindings ?? '—'} icon={<IconBulb size={16} />} hint="Untriaged or in progress" />
              <StatCard label="Overdue items" value={mw.data?.counts.overdue ?? '—'} icon={<IconBug size={16} />} color={(mw.data?.counts.overdue ?? 0) > 0 ? 'red' : undefined} hint="Past their due date" />
            </StatGrid>

            <Box component="section">
              <SectionHeading>Projects</SectionHeading>
              {d.projects.length === 0 ? (
                <EmptyState
                  title="No projects"
                  description={isOrgAdmin ? 'Create a project, or load a sample project to see Explorix with realistic data.' : "You're not a member of any active project yet."}
                  action={
                    isOrgAdmin ? (
                      <Group>
                        <Button component={Link} to="/projects" variant="default">
                          Go to projects
                        </Button>
                        <SampleProjectButton />
                      </Group>
                    ) : undefined
                  }
                />
              ) : (
                <SimpleGrid type="container" cols={{ base: 1, '560px': 2, '960px': 3 }} spacing="md">
                  {d.projects.map((p: any) => (
                    <UnstyledButton key={p.id} component={Link} to={`/projects/${p.id}`} className="ex-project-card">
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                          <span className="ex-project-mark" style={{ background: p.color }} aria-hidden>
                            {p.key.slice(0, 3)}
                          </span>
                          <Text fw={600} truncate>
                            {p.name}
                          </Text>
                        </Group>
                        <Badge variant="outline" color="gray" size="sm">
                          {p.key}
                        </Badge>
                      </Group>
                      <div className="ex-project-card__stats">
                        {[
                          ['Active sessions', p.activeSessions],
                          ['Completed', p.completedSessions],
                          ['Open findings', p.openFindings],
                          ['Open issues', p.openIssues],
                        ].map(([l, v]) => (
                          <div key={l}>
                            <div className="ex-project-card__value">{v}</div>
                            <div className="ex-project-card__label">{l}</div>
                          </div>
                        ))}
                      </div>
                    </UnstyledButton>
                  ))}
                </SimpleGrid>
              )}
            </Box>

            <Grid type="container" breakpoints={{ xs: '480px', sm: '640px', md: '820px', lg: '1040px', xl: '1320px' }} gap="md">
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <SectionCard title="Sessions in progress" description="Running, paused or awaiting changes" h="100%">
                  {d.activeSessions.length === 0 ? (
                    <EmptyState compact icon={<IconPlayerPlay size={16} />} title="No one is exploring right now" description="Active sessions across your projects appear here." />
                  ) : (
                    <Stack gap={0} className="ex-list">
                      {d.activeSessions.map((s: any) => (
                        <div key={s.id} className="ex-list__row">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <KeyLink to={`/projects/${s.project.id}/sessions/${s.id}`} k={s.key}>
                              {s.title}
                            </KeyLink>
                            <Group gap={8} mt={2} wrap="nowrap">
                              <Text size="xs" c="dimmed">
                                {s.project.key}
                              </Text>
                              <UserLabel user={s.tester} size="xs" />
                            </Group>
                          </Box>
                          <SessionStatusBadge value={s.status} size="sm" />
                          <Box ta="right" miw={64}>
                            <Text size="sm" fw={600} className="ex-timer">
                              {clock(s.elapsedSeconds)}
                            </Text>
                            <Text size="xs" c="dimmed">
                              of {s.timeboxMinutes}m
                            </Text>
                          </Box>
                        </div>
                      ))}
                    </Stack>
                  )}
                </SectionCard>
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <SectionCard title="Latest findings" description="Most recent across all projects" h="100%">
                  {d.recentFindings.length === 0 ? (
                    <EmptyState compact icon={<IconBulb size={16} />} title="No findings yet" description="Findings logged during sessions appear here." />
                  ) : (
                    <Stack gap={0} className="ex-list">
                      {d.recentFindings.map((f: any) => (
                        <div key={f.id} className="ex-list__row">
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <KeyLink to={`/projects/${f.project.id}/findings/${f.id}`} k={f.key}>
                              {f.title}
                            </KeyLink>
                            <Text size="xs" c="dimmed" mt={2}>
                              {f.project.key} · {f.author.name} · {fromNow(f.createdAt)}
                            </Text>
                          </Box>
                          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                            <ClassificationBadge c={f.classification} size="sm" />
                            <SeverityBadge value={f.severity} size="sm" />
                          </Group>
                        </div>
                      ))}
                    </Stack>
                  )}
                </SectionCard>
              </Grid.Col>
            </Grid>

            <SectionCard title="Recent activity">
              {d.activity.length === 0 ? (
                <EmptyState compact icon={<IconActivity size={16} />} title="No activity yet" />
              ) : (
                <Stack gap={0} className="ex-list">
                  {d.activity.map((a: any) => (
                    <Group key={a.id} gap="sm" wrap="nowrap" className="ex-list__row" data-dense>
                      <UserAvatar user={a.actor} size={22} />
                      <Text size="sm" style={{ flex: 1, minWidth: 0 }}>
                        <b>{a.actor?.name ?? 'System'}</b> {a.action.replace(/_/g, ' ')} {titleCase(a.entityType).toLowerCase()}
                        {a.project ? <Text span c="dimmed"> · {a.project.key}</Text> : null}
                      </Text>
                      <Text size="xs" c="dimmed" className="ex-nowrap">
                        {fromNow(a.createdAt)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </SectionCard>
          </Stack>
        )}
      </QueryState>
    </>
  );
}