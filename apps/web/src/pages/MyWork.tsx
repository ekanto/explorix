import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Group, Paper, Progress, Stack, Table, Tabs, Text } from '@mantine/core';
import { IconAlertTriangle, IconBug, IconBulb, IconCalendar, IconChecklist, IconPlayerPlay, IconTargetArrow, IconUserCheck } from '@tabler/icons-react';
import { api } from '../lib/api';
import { clock, fmtDate, fromNow, titleCase } from '../lib/format';
import { ClassificationBadge, EmptyState, IssueStatusBadge, KeyLink, PageHeader, PriorityBadge, QueryState, SessionStatusBadge, SeverityBadge, StatCard, StatGrid, StatusPill, UserLabel } from '../components/ui';

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={650}>{title}</Text>
        <Badge variant="light">{count}</Badge>
      </Group>
      {count === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing here.
        </Text>
      ) : (
        children
      )}
    </Paper>
  );
}

export default function MyWork() {
  const q = useQuery({ queryKey: ['my-work'], queryFn: () => api.get('/my-work'), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader title="My Work" subtitle="Everything assigned to you or waiting on you, across projects." />
      <QueryState query={q}>
        {(d: any) => (
          <Stack gap="lg">
            <StatGrid max={7}>
              <StatCard label="Active sessions" value={d.counts.activeSessions} icon={<IconPlayerPlay size={16} />} />
              <StatCard label="Charters" value={d.counts.assignedCharters} icon={<IconTargetArrow size={16} />} />
              <StatCard label="Reviews" value={d.counts.reviews} icon={<IconUserCheck size={16} />} color="violet" />
              <StatCard label="Open findings" value={d.counts.openFindings} icon={<IconBulb size={16} />} color="blue" />
              <StatCard label="Issues" value={d.counts.issues} icon={<IconBug size={16} />} color="red" />
              <StatCard label="Tests to run" value={d.counts.testsToRun} icon={<IconChecklist size={16} />} color="cyan" />
              <StatCard label="Overdue" value={d.counts.overdue} icon={<IconAlertTriangle size={16} />} color={d.counts.overdue ? 'red' : 'gray'} />
            </StatGrid>

            {(d.overdue.length > 0 || d.upcoming.length > 0) && (
              <Paper withBorder p="md">
                <Group gap={6} mb="sm">
                  <IconCalendar size={18} />
                  <Text fw={650}>Due dates</Text>
                </Group>
                <Stack gap={6}>
                  {[...d.overdue.map((x: any) => ({ ...x, overdue: true })), ...d.upcoming].map((x: any) => (
                    <Group key={`${x.kind}-${x.id}`} justify="space-between">
                      <Group gap="xs">
                        <Badge size="sm" variant="outline" color="gray">
                          {titleCase(x.kind)}
                        </Badge>
                        <KeyLink to={x.link} k={x.key}>
                          {x.title}
                        </KeyLink>
                      </Group>
                      <Text size="sm" c={x.overdue ? 'red' : 'dimmed'} fw={x.overdue ? 600 : 400}>
                        {x.overdue ? 'Overdue · ' : 'Due '}
                        {fmtDate(x.dueDate)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Paper>
            )}

            <Tabs defaultValue="sessions" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="sessions">Sessions ({d.activeSessions.length + d.draftSessions.length})</Tabs.Tab>
                <Tabs.Tab value="charters">Charters ({d.charters.length})</Tabs.Tab>
                <Tabs.Tab value="reviews">Reviews ({d.reviews.length})</Tabs.Tab>
                <Tabs.Tab value="findings">Findings ({d.findings.length})</Tabs.Tab>
                <Tabs.Tab value="issues">Issues ({d.issues.length})</Tabs.Tab>
                <Tabs.Tab value="tests">Test runs ({d.testRunItems.length})</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="sessions" pt="md">
                <Stack>
                  <Section title="Active (in progress / paused / changes requested)" count={d.activeSessions.length}>
                    <SessionTable rows={d.activeSessions} />
                  </Section>
                  <Section title="Ready to start (draft)" count={d.draftSessions.length}>
                    <SessionTable rows={d.draftSessions} />
                  </Section>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="charters" pt="md">
                {d.charters.length === 0 ? (
                  <EmptyState title="No charters assigned to you" />
                ) : (
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Charter</Table.Th>
                        <Table.Th>Project</Table.Th>
                        <Table.Th>Priority</Table.Th>
                        <Table.Th>Milestone</Table.Th>
                        <Table.Th>My sessions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.charters.map((c: any) => (
                        <Table.Tr key={c.id}>
                          <Table.Td>
                            <KeyLink to={`/projects/${c.project.id}/charters/${c.id}`} k={c.key}>
                              {c.title}
                            </KeyLink>
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {c.mission}
                            </Text>
                          </Table.Td>
                          <Table.Td>{c.project.key}</Table.Td>
                          <Table.Td>
                            <PriorityBadge value={c.priority} size="sm" />
                          </Table.Td>
                          <Table.Td>{c.milestone ? `${c.milestone.name}${c.milestone.dueDate ? ` · ${fmtDate(c.milestone.dueDate)}` : ''}` : '—'}</Table.Td>
                          <Table.Td>
                            {c.myCompletedSessions}/{c.mySessions} completed
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="reviews" pt="md">
                {d.reviews.length === 0 ? (
                  <EmptyState title="No sessions awaiting your review" />
                ) : (
                  <Table>
                    <Table.Tbody>
                      {d.reviews.map((s: any) => (
                        <Table.Tr key={s.id}>
                          <Table.Td>
                            <KeyLink to={`/projects/${s.project.id}/sessions/${s.id}`} k={s.key}>
                              {s.title}
                            </KeyLink>
                          </Table.Td>
                          <Table.Td>{s.project.key}</Table.Td>
                          <Table.Td>
                            <UserLabel user={s.tester} />
                          </Table.Td>
                          <Table.Td className="ex-nowrap">Finished {fromNow(s.endedAt)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="findings" pt="md">
                {d.findings.length === 0 ? (
                  <EmptyState title="No unresolved findings owned by you" />
                ) : (
                  <Table>
                    <Table.Tbody>
                      {d.findings.map((f: any) => (
                        <Table.Tr key={f.id}>
                          <Table.Td>
                            <KeyLink to={`/projects/${f.project.id}/findings/${f.id}`} k={f.key}>
                              {f.title}
                            </KeyLink>
                            <Text size="xs" c="dimmed">
                              {f.project.key}
                              {f.session ? ` · from ${f.session.key}` : ''} · {f.owned ? 'owner' : 'author'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <ClassificationBadge c={f.classification} size="sm" />
                          </Table.Td>
                          <Table.Td>
                            <SeverityBadge value={f.severity} size="sm" />
                          </Table.Td>
                          <Table.Td className="ex-nowrap">{fromNow(f.createdAt)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="issues" pt="md">
                {d.issues.length === 0 ? (
                  <EmptyState title="No open issues assigned to you" />
                ) : (
                  <Table>
                    <Table.Tbody>
                      {d.issues.map((i: any) => (
                        <Table.Tr key={i.id}>
                          <Table.Td>
                            <KeyLink to={`/projects/${i.project.id}/issues/${i.id}`} k={i.key}>
                              {i.title}
                            </KeyLink>
                          </Table.Td>
                          <Table.Td>
                            <IssueStatusBadge value={i.status} size="sm" />
                          </Table.Td>
                          <Table.Td>
                            <SeverityBadge value={i.severity} size="sm" />
                          </Table.Td>
                          <Table.Td>
                            <PriorityBadge value={i.priority} size="sm" />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="tests" pt="md">
                {d.testRunItems.length === 0 ? (
                  <EmptyState title="No manual tests waiting for you" />
                ) : (
                  <Table>
                    <Table.Tbody>
                      {d.testRunItems.map((i: any) => (
                        <Table.Tr key={i.id}>
                          <Table.Td>
                            <KeyLink to={`/projects/${i.project.id}/test-runs/${i.runId}`} k={i.testCase.key}>
                              {i.testCase.title}
                            </KeyLink>
                            <Text size="xs" c="dimmed">
                              {i.runKey} {i.runName}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <StatusPill status={i.status} />
                          </Table.Td>
                          <Table.Td>{i.dueDate ? <Text size="sm" c={i.overdue ? 'red' : undefined}>Due {fmtDate(i.dueDate)}</Text> : '—'}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Tabs.Panel>
            </Tabs>
          </Stack>
        )}
      </QueryState>
    </>
  );
}

function SessionTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <Table.Tbody>
        {rows.map((s) => {
          const pct = Math.min(100, (s.elapsedSeconds / (s.timeboxMinutes * 60)) * 100);
          return (
            <Table.Tr key={s.id}>
              <Table.Td>
                <Link to={`/projects/${s.project.id}/sessions/${s.id}`} className="ex-link">
                  <span className="ex-key">{s.key}</span> {s.title}
                </Link>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {s.project.key} · {s.charter.key} {s.charter.mission}
                </Text>
              </Table.Td>
              <Table.Td w={140}>
                <SessionStatusBadge value={s.status} size="sm" />
              </Table.Td>
              <Table.Td w={180}>
                <Text size="xs" className="ex-timer">
                  {clock(s.elapsedSeconds)} / {s.timeboxMinutes}m
                </Text>
                <Progress value={pct} size="sm" color={pct >= 100 ? 'orange' : 'explorix'} aria-label="Timebox used" />
              </Table.Td>
              <Table.Td w={140}>
                {s.dueDate ? (
                  <Text size="sm" c={s.overdue ? 'red' : 'dimmed'}>
                    {s.overdue ? 'Overdue' : 'Due'} {fmtDate(s.dueDate)}
                  </Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    No due date
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
