import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Alert, Anchor, Badge, Code, Grid, Group, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { LineChart } from '@mantine/charts';
import { IconRefreshAlert } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { IssueStatusBadge, PageHeader, QueryState, SeverityBadge, StatCard, StatusPill } from '../../components/ui';
import { FlakyBadge, HistoryStrip, fmtMs } from '../../components/AutomationBits';

export default function AutomationTest() {
  const { testId } = useParams();
  const { pid } = useProject();
  const [sp, setSp] = useSearchParams();
  const branch = sp.get('branch');
  const q = useQuery({ queryKey: ['automation-test', pid, testId], queryFn: () => api.get(p(pid, `/automation/tests/${testId}`)) });

  const issueIds = useMemo(() => [...new Set<string>((q.data?.results ?? []).map((r: any) => r.issueId).filter(Boolean))], [q.data]);
  const issues = useQueries({
    queries: issueIds.map((id) => ({ queryKey: ['issue', pid, id], queryFn: () => api.get(p(pid, `/issues/${id}`)), staleTime: 60_000 })),
  });

  return (
    <QueryState query={q}>
      {(d: any) => {
        const branches = [...new Set<string>(d.results.map((r: any) => r.run.branch).filter(Boolean))].sort();
        const results: any[] = d.results.filter((r: any) => !branch || r.run.branch === branch);
        const chrono = [...results].reverse();
        const executed = results.filter((r) => r.category !== 'SKIPPED' && r.category !== 'UNTESTED');
        const passed = executed.filter((r) => r.category === 'PASSED').length;
        const passRate = executed.length ? Math.round((passed / executed.length) * 1000) / 10 : null;
        const durations = results.map((r) => r.durationMs).filter((v): v is number => v != null);
        const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
        const latestFailure = results.find((r) => r.category === 'FAILED' || r.category === 'BLOCKED');
        const retried = results.filter((r) => r.retries > 0);
        return (
          <>
            <PageHeader
              kicker={
                <Anchor component={Link} to={`/projects/${pid}/automation?tab=flaky&all=1`} size="xs" c="dimmed">
                  Automation / Tests
                </Anchor>
              }
              title={
                <Group gap="sm">
                  <span>{d.test.name}</span>
                  <FlakyBadge flaky={d.flaky} showStable />
                </Group>
              }
              subtitle={[d.test.suite, d.test.file].filter(Boolean).join(' · ') || undefined}
            />

            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" mb="md">
              <StatCard label="Pass rate" value={passRate == null ? '—' : `${passRate}%`} hint={`${passed} of ${executed.length} executed results shown (skips excluded)`} color={passRate == null ? undefined : passRate >= 95 ? 'green' : passRate >= 80 ? 'yellow' : 'red'} />
              <StatCard label="Results" value={results.length} hint={d.results.length >= 50 ? 'Latest 50 results' : 'All recorded results'} />
              <StatCard label="Avg duration" value={fmtMs(avg)} hint={durations.length ? `min ${fmtMs(Math.min(...durations))} · max ${fmtMs(Math.max(...durations))}` : undefined} />
              <StatCard label="Flake score" value={`${Math.round(d.flaky.score * 100)}%`} hint={`${d.flaky.flips} flips · ${d.flaky.passedOnRetry} passed on retry (last 10)`} color={d.flaky.flaky ? 'grape' : undefined} />
            </SimpleGrid>

            <Paper withBorder p="md" mb="md">
              <Group justify="space-between" mb="sm">
                <div>
                  <Title order={5}>Status timeline</Title>
                  <Text size="xs" c="dimmed">
                    Oldest → newest. Click a square to open the run.
                  </Text>
                </div>
                {branches.length > 1 && <Select size="xs" placeholder="All branches" data={branches} value={branch} onChange={(v) => setSp(v ? { branch: v } : {}, { replace: true })} clearable w={200} />}
              </Group>
              <HistoryStrip
                size={16}
                items={chrono.map((r) => ({
                  category: r.category,
                  label: `${r.run.key} · ${r.status?.name ?? r.category}${r.run.branch ? ` · ${r.run.branch}` : ''} · ${fmtDateTime(r.createdAt)}${r.retries ? ` · ${r.retries} retr${r.retries === 1 ? 'y' : 'ies'}` : ''}`,
                  to: `/projects/${pid}/automation/runs/${r.run.id}`,
                }))}
              />
              {d.flaky.flaky && (
                <Alert mt="md" color="grape" variant="light" icon={<IconRefreshAlert size={18} />} title="Flaky evidence">
                  Across the last 10 completed results this test flipped between pass and fail {d.flaky.flips} time{d.flaky.flips === 1 ? '' : 's'} and passed on retry {d.flaky.passedOnRetry} time
                  {d.flaky.passedOnRetry === 1 ? '' : 's'} (flaky = ≥ 1 pass on retry or ≥ 2 flips).
                  {retried.length > 0 && ` ${retried.length} of the results shown needed retries.`}
                </Alert>
              )}
            </Paper>

            <Grid gap="md" mb="md">
              <Grid.Col span={{ base: 12, lg: 7 }}>
                <Paper withBorder p="md" h="100%">
                  <Title order={5} mb="sm">
                    Duration
                  </Title>
                  {durations.length < 2 ? (
                    <Text size="sm" c="dimmed">
                      Not enough timed results to chart.
                    </Text>
                  ) : (
                    <LineChart
                      h={200}
                      data={chrono.filter((r) => r.durationMs != null).map((r) => ({ run: r.run.key, seconds: Math.round(r.durationMs / 100) / 10 }))}
                      dataKey="run"
                      unit="s"
                      curveType="monotone"
                      series={[{ name: 'seconds', label: 'Duration', color: 'indigo.6' }]}
                    />
                  )}
                </Paper>
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 5 }}>
                <Paper withBorder p="md" h="100%">
                  <Title order={5} mb="sm">
                    Linked issues
                  </Title>
                  {issueIds.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No issues linked. Create one from a failing result on the run page.
                    </Text>
                  ) : (
                    <Stack gap={6}>
                      {issues.map((iq, i) => {
                        const issue = iq.data?.issue;
                        return issue ? (
                          <Group key={issue.id} gap="xs" wrap="nowrap">
                            <Anchor component={Link} to={`/projects/${pid}/issues/${issue.id}`} size="sm" lineClamp={1} style={{ flex: 1 }}>
                              <span className="ex-key">{issue.key}</span> {issue.title}
                            </Anchor>
                            {issue.severity && <SeverityBadge value={issue.severity} size="xs" />}
                            <IssueStatusBadge value={issue.status} size="xs" variant="light" />
                          </Group>
                        ) : (
                          <Text key={issueIds[i]} size="sm" c="dimmed">
                            {iq.isLoading ? 'Loading…' : 'Issue unavailable'}
                          </Text>
                        );
                      })}
                    </Stack>
                  )}
                </Paper>
              </Grid.Col>
            </Grid>

            {latestFailure && (
              <Paper withBorder p="md" mb="md">
                <Group justify="space-between" mb="xs">
                  <Title order={5}>Latest failure</Title>
                  <Text size="xs" c="dimmed">
                    <Anchor component={Link} to={`/projects/${pid}/automation/runs/${latestFailure.run.id}`} size="xs">
                      {latestFailure.run.key}
                    </Anchor>{' '}
                    · {fromNow(latestFailure.createdAt)}
                  </Text>
                </Group>
                {latestFailure.message ? (
                  <ScrollArea.Autosize mah={140}>
                    <Code block c="red.8" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {latestFailure.message}
                    </Code>
                  </ScrollArea.Autosize>
                ) : (
                  <Text size="sm" c="dimmed">
                    No message recorded.
                  </Text>
                )}
                {latestFailure.stackTrace && (
                  <ScrollArea.Autosize mah={260} mt="xs" type="auto">
                    <Code block fz={11} style={{ whiteSpace: 'pre' }}>
                      {latestFailure.stackTrace}
                    </Code>
                  </ScrollArea.Autosize>
                )}
              </Paper>
            )}

            <Paper withBorder>
              <Table.ScrollContainer minWidth={800}>
                <Table verticalSpacing="xs" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Run</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Branch · commit</Table.Th>
                      <Table.Th>Duration</Table.Th>
                      <Table.Th>Retries</Table.Th>
                      <Table.Th>Message</Table.Th>
                      <Table.Th>When</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {results.map((r) => (
                      <Table.Tr key={r.id}>
                        <Table.Td maw={240}>
                          <Anchor component={Link} to={`/projects/${pid}/automation/runs/${r.run.id}`} size="sm" lineClamp={1}>
                            <span className="ex-key">{r.run.key}</span> {r.run.name}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <StatusPill status={r.status} />
                            {r.issueId && (
                              <Badge size="xs" variant="outline" color="red">
                                issue
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{r.run.branch ?? '—'}</Text>
                          {r.run.commitSha && (
                            <Text size="xs" c="dimmed" ff="monospace">
                              {r.run.commitSha.slice(0, 10)}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>{fmtMs(r.durationMs)}</Table.Td>
                        <Table.Td>{r.retries || '—'}</Table.Td>
                        <Table.Td maw={320}>
                          <Tooltip label={r.message} disabled={!r.message} multiline maw={500}>
                            <Text size="xs" ff="monospace" c={r.message ? 'red.7' : 'dimmed'} lineClamp={1}>
                              {r.message ?? '—'}
                            </Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={fmtDateTime(r.createdAt)}>
                            <Text size="sm">{fromNow(r.createdAt)}</Text>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </>
        );
      }}
    </QueryState>
  );
}
