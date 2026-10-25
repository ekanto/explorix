import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Alert, Anchor, Badge, Group, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, Tooltip } from '@mantine/core';
import { IconArrowRight, IconArrowsExchange, IconInfoCircle } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, QueryState, ResultBadge, StatCard } from '../../components/ui';
import { RunResultBar, fmtMs } from '../../components/AutomationBits';

const CATEGORIES = [
  { key: 'newFailures', label: 'New failures', color: 'red', hint: 'Failed in head, not failing in base' },
  { key: 'fixed', label: 'Fixed', color: 'green', hint: 'Failing in base, not failing in head' },
  { key: 'stillFailing', label: 'Still failing', color: 'orange', hint: 'Failed in both runs' },
  { key: 'added', label: 'Added', color: 'blue', hint: 'Only in head' },
  { key: 'removed', label: 'Removed', color: 'gray', hint: 'Only in base' },
] as const;

export default function AutomationCompare() {
  const { pid } = useProject();
  const [sp, setSp] = useSearchParams();
  const base = sp.get('base');
  const head = sp.get('head');
  const tab = sp.get('tab') ?? 'newFailures';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setSp(next, { replace: true });
  };

  const runs = useQuery({ queryKey: ['automation-runs-pick', pid], queryFn: () => api.get(p(pid, '/automation/runs'), { pageSize: 100 }) });
  const options = useMemo(
    () =>
      (runs.data?.runs ?? []).map((r: any) => ({
        value: r.id,
        label: `${r.key} · ${r.name}${r.branch ? ` (${r.branch})` : ''} · ${fmtDateTime(r.startedAt)}`,
      })),
    [runs.data],
  );
  const cmp = useQuery({
    queryKey: ['automation-compare', pid, base, head],
    queryFn: () => api.get(p(pid, '/automation/compare'), { base, head }),
    enabled: !!base && !!head && base !== head,
  });

  return (
    <>
      <PageHeader
        kicker={
          <Anchor component={Link} to={`/projects/${pid}/automation`} size="xs" c="dimmed">
            Automation
          </Anchor>
        }
        title="Compare runs"
        subtitle="Test-by-test differences between a base run and a head run."
      />
      <Paper withBorder p="md" mb="md">
        <Group align="flex-end" gap="sm" wrap="nowrap">
          <Select label="Base (before)" placeholder="Pick a run" data={options} value={base} onChange={(v) => set({ base: v })} searchable style={{ flex: 1 }} nothingFoundMessage="No runs" />
          <Tooltip label="Swap base and head">
            <ActionIcon variant="default" size="lg" mb={2} onClick={() => set({ base: head, head: base })} disabled={!base && !head} aria-label="Swap base and head">
              <IconArrowsExchange size={18} />
            </ActionIcon>
          </Tooltip>
          <Select label="Head (after)" placeholder="Pick a run" data={options} value={head} onChange={(v) => set({ head: v })} searchable style={{ flex: 1 }} nothingFoundMessage="No runs" />
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          The 100 most recent runs are listed. Runs are matched by test identity (suite + name or explicit key).
        </Text>
      </Paper>

      {!base || !head ? (
        <EmptyState title="Pick two runs" description="Choose a base and a head run, or select two runs in the Automation list and press Compare." />
      ) : base === head ? (
        <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
          Base and head are the same run — choose two different runs.
        </Alert>
      ) : (
        <QueryState query={cmp}>
          {(d: any) => {
            const passRate = (r: any) => {
              const denom = r.totalCount - r.skippedCount;
              return denom > 0 ? Math.round((r.passedCount / denom) * 1000) / 10 : null;
            };
            const pb = passRate(d.base);
            const ph = passRate(d.head);
            const rows: any[] = d[tab] ?? [];
            return (
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                  {[
                    ['Base', d.base],
                    ['Head', d.head],
                  ].map(([label, r]: any) => (
                    <Paper key={label} withBorder p="sm">
                      <Group justify="space-between" wrap="nowrap">
                        <div style={{ minWidth: 0 }}>
                          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                            {label}
                          </Text>
                          <Anchor component={Link} to={`/projects/${pid}/automation/runs/${r.id}`} size="sm" lineClamp={1}>
                            <span className="ex-key">{r.key}</span> {r.name}
                          </Anchor>
                          <Text size="xs" c="dimmed">
                            {[r.branch, r.commitSha?.slice(0, 10), r.buildNumber && `#${r.buildNumber}`, fmtDateTime(r.startedAt)].filter(Boolean).join(' · ')}
                          </Text>
                        </div>
                        <RunResultBar passed={r.passedCount} failed={r.failedCount} skipped={r.skippedCount} other={r.otherCount} total={r.totalCount} />
                      </Group>
                    </Paper>
                  ))}
                </SimpleGrid>

                <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }} spacing="sm">
                  {CATEGORIES.map((c) => (
                    <StatCard key={c.key} label={c.label} value={d[c.key].length} hint={c.hint} color={d[c.key].length ? c.color : undefined} />
                  ))}
                  <StatCard label="Pass rate" value={pb == null || ph == null ? '—' : `${ph}%`} hint={pb == null || ph == null ? 'n/a' : `${ph - pb >= 0 ? '+' : ''}${(ph - pb).toFixed(1)} pts vs base (${pb}%)`} color={pb != null && ph != null ? (ph >= pb ? 'green' : 'red') : undefined} />
                  <StatCard
                    label="Duration change"
                    value={`${d.durationDeltaMs >= 0 ? '+' : '−'}${fmtMs(Math.abs(d.durationDeltaMs))}`}
                    hint={`${fmtMs(d.base.durationMs)} → ${fmtMs(d.head.durationMs)}`}
                    color={d.durationDeltaMs > 0 ? 'orange' : 'green'}
                  />
                </SimpleGrid>

                <Paper withBorder>
                  <Tabs value={tab} onChange={(v) => set({ tab: v === 'newFailures' ? null : v })}>
                    <Tabs.List px="sm" pt="xs">
                      {CATEGORIES.map((c) => (
                        <Tabs.Tab
                          key={c.key}
                          value={c.key}
                          rightSection={
                            <Badge size="xs" variant="light" color={d[c.key].length ? c.color : 'gray'}>
                              {d[c.key].length}
                            </Badge>
                          }
                        >
                          {c.label}
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>
                  </Tabs>
                  {rows.length === 0 ? (
                    <Text c="dimmed" ta="center" py="xl" size="sm">
                      No tests in this category.
                    </Text>
                  ) : (
                    <Table.ScrollContainer minWidth={760}>
                      <Table verticalSpacing="xs" highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Test</Table.Th>
                            <Table.Th>Change</Table.Th>
                            {tab !== 'removed' && <Table.Th>Duration</Table.Th>}
                            {tab !== 'removed' && tab !== 'fixed' && <Table.Th>Message</Table.Th>}
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {[...rows]
                            .sort((a, b) => (a.suite ?? '').localeCompare(b.suite ?? '') || a.name.localeCompare(b.name))
                            .map((r) => {
                              const delta = r.durationMs != null && r.previousDurationMs != null ? r.durationMs - r.previousDurationMs : null;
                              return (
                                <Table.Tr key={r.testId}>
                                  <Table.Td maw={420}>
                                    <Anchor component={Link} to={`/projects/${pid}/automation/tests/${r.testId}`} size="sm" lineClamp={1}>
                                      {r.name}
                                    </Anchor>
                                    {r.suite && (
                                      <Text size="xs" c="dimmed" lineClamp={1}>
                                        {r.suite}
                                      </Text>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    <Group gap={4} wrap="nowrap">
                                      {r.before ? <ResultBadge value={r.before} size="sm" variant="light" /> : <Badge size="sm" variant="outline" color="gray">absent</Badge>}
                                      <IconArrowRight size={12} />
                                      {r.after ? <ResultBadge value={r.after} size="sm" variant="light" /> : <Badge size="sm" variant="outline" color="gray">absent</Badge>}
                                    </Group>
                                  </Table.Td>
                                  {tab !== 'removed' && (
                                    <Table.Td>
                                      <Text size="sm">{fmtMs(r.durationMs)}</Text>
                                      {delta != null && delta !== 0 && (
                                        <Text size="xs" c={delta > 0 ? 'orange.7' : 'green.7'}>
                                          {delta > 0 ? '+' : '−'}
                                          {fmtMs(Math.abs(delta))}
                                        </Text>
                                      )}
                                    </Table.Td>
                                  )}
                                  {tab !== 'removed' && tab !== 'fixed' && (
                                    <Table.Td maw={380}>
                                      <Tooltip label={r.message} disabled={!r.message} multiline maw={500} style={{ whiteSpace: 'pre-wrap' }}>
                                        <Text size="xs" ff="monospace" c={r.message ? 'red.7' : 'dimmed'} lineClamp={2}>
                                          {r.message ?? '—'}
                                        </Text>
                                      </Tooltip>
                                    </Table.Td>
                                  )}
                                </Table.Tr>
                              );
                            })}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  )}
                </Paper>
              </Stack>
            );
          }}
        </QueryState>
      )}
    </>
  );
}
