import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Box, Card, Grid, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconBug, IconBulb, IconPlayerPlay, IconUserCheck } from '@tabler/icons-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clock, fromNow, titleCase } from '../lib/format';
import { ClassificationBadge, EmptyState, KeyLink, PageHeader, QueryState, SessionStatusBadge, SeverityBadge, StatCard, UserAvatar, UserLabel } from '../components/ui';

export default function Overview() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api.get('/overview'), refetchInterval: 60_000 });
  const mw = useQuery({ queryKey: ['my-work'], queryFn: () => api.get('/my-work') });
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageHeader title={`${greet}, ${user?.name.split(' ')[0]}`} subtitle="Quality at a glance across all projects you can access." />
      <QueryState query={q}>
        {(d: any) => (
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 2, md: 4 }}>
              <StatCard label="My active sessions" value={mw.data?.counts.activeSessions ?? '—'} icon={<IconPlayerPlay size={18} />} hint={<Link to="/my-work" className="ex-link">Open My Work</Link>} />
              <StatCard label="Awaiting my review" value={mw.data?.counts.reviews ?? '—'} icon={<IconUserCheck size={18} />} color="violet" />
              <StatCard label="My open findings" value={mw.data?.counts.openFindings ?? '—'} icon={<IconBulb size={18} />} color="blue" />
              <StatCard label="Overdue items" value={mw.data?.counts.overdue ?? '—'} icon={<IconBug size={18} />} color={(mw.data?.counts.overdue ?? 0) > 0 ? 'red' : 'gray'} />
            </SimpleGrid>

            <Box>
              <Title order={4} mb="sm">
                Projects
              </Title>
              {d.projects.length === 0 ? (
                <EmptyState title="No projects" description="You're not a member of any active project yet." />
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                  {d.projects.map((p: any) => (
                    <Card key={p.id} component={Link} to={`/projects/${p.id}`} style={{ borderLeft: `4px solid ${p.color}` }}>
                      <Group justify="space-between">
                        <Text fw={700}>{p.name}</Text>
                        <Badge variant="outline" color="gray">
                          {p.key}
                        </Badge>
                      </Group>
                      <Group gap="lg" mt="sm">
                        {[
                          ['Active sessions', p.activeSessions],
                          ['Completed', p.completedSessions],
                          ['Open findings', p.openFindings],
                          ['Open issues', p.openIssues],
                        ].map(([l, v]) => (
                          <Box key={l}>
                            <Text fw={700}>{v}</Text>
                            <Text size="xs" c="dimmed">
                              {l}
                            </Text>
                          </Box>
                        ))}
                      </Group>
                    </Card>
                  ))}
                </SimpleGrid>
              )}
            </Box>

            <Grid gap="lg">
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Paper withBorder p="md" h="100%">
                  <Title order={5} mb="sm">
                    Sessions in progress
                  </Title>
                  {d.activeSessions.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No one is exploring right now.
                    </Text>
                  ) : (
                    <Table>
                      <Table.Tbody>
                        {d.activeSessions.map((s: any) => (
                          <Table.Tr key={s.id}>
                            <Table.Td>
                              <KeyLink to={`/projects/${s.project.id}/sessions/${s.id}`} k={s.key}>
                                {s.title}
                              </KeyLink>
                              <Text size="xs" c="dimmed">
                                {s.project.key}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <UserLabel user={s.tester} />
                            </Table.Td>
                            <Table.Td>
                              <SessionStatusBadge value={s.status} size="sm" />
                            </Table.Td>
                            <Table.Td ta="right">
                              <Text size="sm" className="ex-timer">
                                {clock(s.elapsedSeconds)}
                              </Text>
                              <Text size="xs" c="dimmed">
                                of {s.timeboxMinutes}m
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Paper>
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Paper withBorder p="md" h="100%">
                  <Title order={5} mb="sm">
                    Latest findings
                  </Title>
                  {d.recentFindings.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No findings yet.
                    </Text>
                  ) : (
                    <Stack gap={8}>
                      {d.recentFindings.map((f: any) => (
                        <Group key={f.id} justify="space-between" wrap="nowrap">
                          <Box style={{ minWidth: 0 }}>
                            <KeyLink to={`/projects/${f.project.id}/findings/${f.id}`} k={f.key}>
                              {f.title}
                            </KeyLink>
                            <Text size="xs" c="dimmed">
                              {f.project.key} · {f.author.name} · {fromNow(f.createdAt)}
                            </Text>
                          </Box>
                          <Group gap={4} wrap="nowrap">
                            <ClassificationBadge c={f.classification} size="sm" />
                            <SeverityBadge value={f.severity} size="sm" />
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Paper>
              </Grid.Col>
            </Grid>

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Recent activity
              </Title>
              <Stack gap={6}>
                {d.activity.map((a: any) => (
                  <Group key={a.id} gap="sm" wrap="nowrap">
                    <UserAvatar user={a.actor} size={22} />
                    <Text size="sm" style={{ flex: 1 }}>
                      <b>{a.actor?.name ?? 'System'}</b> {a.action.replace(/_/g, ' ')} {titleCase(a.entityType).toLowerCase()}
                      {a.project ? <Text span c="dimmed"> · {a.project.key}</Text> : null}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {fromNow(a.createdAt)}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Paper>
          </Stack>
        )}
      </QueryState>
    </>
  );
}
