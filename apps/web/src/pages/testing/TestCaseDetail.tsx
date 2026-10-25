import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Alert, Anchor, Badge, Button, Divider, Grid, Group, Menu, Modal, Paper, Select, Stack, Table, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArchive,
  IconArchiveOff,
  IconArrowBackUp,
  IconChevronLeft,
  IconCompass,
  IconCopy,
  IconDots,
  IconHistory,
  IconListCheck,
  IconMessage,
  IconPencil,
  IconPlayerPlay,
  IconRobot,
  IconX,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { duration, fmtDateTime, fromNow, minutes, titleCase } from '../../lib/format';
import { projectKey, useProject } from '../../lib/project';
import { EmptyState, PageHeader, PriorityBadge, QueryState, StatusPill, TextBlock, toastError, toastOk, UserLabel } from '../../components/ui';
import { Comments } from '../../components/Comments';
import { CustomFieldsView } from '../../components/CustomFields';
import { TestCaseFormModal } from '../../components/TestCaseForm';
import { AddToRunModal, CASE_FORMAT, GherkinView, StepsTable, TEST_CASE_STATUS, useFolders, type Step } from '../../components/TestingWidgets';

export default function TestCaseDetail() {
  const { id } = useParams();
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['test-case', pid, id], queryFn: () => api.get(p(pid, `/test-cases/${id}`)) });
  return <QueryState query={q}>{(d: any) => <CaseView tc={d.testCase} results={d.recentResults} />}</QueryState>;
}

function CaseView({ tc, results }: { tc: any; results: any[] }) {
  const { pid, can } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { folderOptions } = useFolders();
  const canEdit = can('TESTER');
  const [editing, setEditing] = useState(false);
  const [toRun, setToRun] = useState(false);
  const [tab, setTab] = useState<string | null>('results');
  const folderPath = folderOptions.find((f) => f.value === tc.folderId)?.label ?? tc.folder?.name;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['test-case', pid, tc.id] });
    qc.invalidateQueries({ queryKey: ['test-case-revisions', pid, tc.id] });
    qc.invalidateQueries({ queryKey: ['test-cases', pid] });
    qc.invalidateQueries({ queryKey: ['test-folders', pid] });
    qc.invalidateQueries({ queryKey: projectKey(pid) });
  };

  const duplicate = async () => {
    try {
      const r = await api.post(p(pid, `/test-cases/${tc.id}/duplicate`));
      toastOk(`Created ${r.testCase.key}`);
      qc.invalidateQueries({ queryKey: ['test-cases', pid] });
      navigate(`/projects/${pid}/test-cases/${r.testCase.id}`);
    } catch (e) {
      toastError(e);
    }
  };

  const toggleArchive = () =>
    modals.openConfirmModal({
      title: tc.archivedAt ? `Restore ${tc.key}?` : `Archive ${tc.key}?`,
      children: (
        <Text size="sm">
          {tc.archivedAt ? 'The case returns to the repository and can be added to runs again.' : 'Archived cases are hidden from the repository and cannot be added to new runs. Results are kept.'}
        </Text>
      ),
      labels: { confirm: tc.archivedAt ? 'Restore' : 'Archive', cancel: 'Cancel' },
      confirmProps: { color: tc.archivedAt ? 'teal' : 'red' },
      onConfirm: async () => {
        try {
          await api.post(p(pid, `/test-cases/${tc.id}/${tc.archivedAt ? 'unarchive' : 'archive'}`));
          toastOk(tc.archivedAt ? 'Test case restored' : 'Test case archived');
          refresh();
        } catch (e) {
          toastError(e);
        }
      },
    });

  return (
    <>
      <Anchor component={Link} to={`/projects/${pid}/test-cases${tc.folderId ? `?folder=${tc.folderId}` : ''}`} size="sm" c="dimmed" mb="xs" display="inline-flex" style={{ alignItems: 'center', gap: 4 }}>
        <IconChevronLeft size={14} /> Test cases{folderPath ? ` / ${folderPath}` : ''}
      </Anchor>
      <PageHeader
        kicker={tc.key}
        title={tc.title}
        actions={
          canEdit && (
            <>
              {!tc.archivedAt && (
                <Button variant="default" leftSection={<IconPlayerPlay size={16} />} onClick={() => setToRun(true)}>
                  Add to run
                </Button>
              )}
              <Button leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="default" size="lg" aria-label="More actions">
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconCopy size={14} />} onClick={duplicate}>
                    Duplicate
                  </Menu.Item>
                  <Menu.Item color={tc.archivedAt ? 'teal' : 'red'} leftSection={tc.archivedAt ? <IconArchiveOff size={14} /> : <IconArchive size={14} />} onClick={toggleArchive}>
                    {tc.archivedAt ? 'Restore' : 'Archive'}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )
        }
      />
      <Group gap="xs" mt={-8} mb="md">
        <Badge color={TEST_CASE_STATUS[tc.status]?.color} variant="light">
          {TEST_CASE_STATUS[tc.status]?.label ?? tc.status}
        </Badge>
        <PriorityBadge value={tc.priority} />
        <Badge variant="outline" color="gray">
          {tc.type}
        </Badge>
        <Badge variant="light" color={CASE_FORMAT[tc.format]?.color}>
          {CASE_FORMAT[tc.format]?.label ?? titleCase(tc.format)}
        </Badge>
        <Tooltip label="Version increments when content (title, steps, Gherkin…) changes">
          <Badge variant="default">v{tc.version}</Badge>
        </Tooltip>
        {tc.tags.map((t: string) => (
          <Badge key={t} variant="outline" color="gray" size="sm" component={Link} to={`/projects/${pid}/test-cases?tag=${encodeURIComponent(t)}`} style={{ cursor: 'pointer' }}>
            #{t}
          </Badge>
        ))}
      </Group>
      {tc.archivedAt && (
        <Alert color="gray" icon={<IconArchive size={18} />} mb="md">
          Archived {fromNow(tc.archivedAt)}. It is hidden from the repository and cannot be added to new runs.
        </Alert>
      )}

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="lg">
            <Paper withBorder p="md">
              <Stack gap="md">
                <TextBlock label="Description" value={tc.description} />
                <TextBlock label="Preconditions" value={tc.preconditions} />
                <TextBlock label="Test data" value={tc.testData} />
                {tc.format !== 'TEXT' && (
                  <div>
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: '0.03em' }}>
                      {tc.format === 'GHERKIN' ? 'Scenario' : `Steps (${tc.steps.length})`}
                    </Text>
                    {tc.format === 'GHERKIN' ? <GherkinView source={tc.gherkin} /> : <StepsTable steps={tc.steps} />}
                  </div>
                )}
                {tc.format === 'TEXT' && !tc.description && (
                  <Text size="sm" c="dimmed" fs="italic">
                    Free-text case without a description.
                  </Text>
                )}
                <CustomFieldsView entity="TEST_CASE" value={tc.customFields} />
              </Stack>
            </Paper>

            <Tabs value={tab} onChange={setTab} keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="results" leftSection={<IconListCheck size={16} />}>
                  Recent results ({results.length})
                </Tabs.Tab>
                <Tabs.Tab value="history" leftSection={<IconHistory size={16} />}>
                  Revisions
                </Tabs.Tab>
                <Tabs.Tab value="comments" leftSection={<IconMessage size={16} />}>
                  Comments
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="results" pt="md">
                <ResultsTable results={results} />
              </Tabs.Panel>
              <Tabs.Panel value="history" pt="md">
                <Revisions tc={tc} canEdit={canEdit} onRestored={refresh} />
              </Tabs.Panel>
              <Tabs.Panel value="comments" pt="md">
                <Comments targetType="testCase" targetId={tc.id} />
              </Tabs.Panel>
            </Tabs>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="lg">
            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Details
              </Title>
              <Stack gap={8}>
                <Detail label="Folder">
                  {folderPath ?? (
                    <Text size="sm" c="dimmed">
                      Unfiled
                    </Text>
                  )}
                </Detail>
                <Detail label="Estimate">{minutes(tc.estimateMinutes)}</Detail>
                <Detail label="Automation">
                  {tc.automationKey ? (
                    <Group gap={4} wrap="nowrap">
                      <IconRobot size={14} color="var(--mantine-color-cyan-6)" />
                      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {tc.automationKey}
                      </Text>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Manual only
                    </Text>
                  )}
                </Detail>
                <Detail label="Created">
                  <Stack gap={2} align="flex-end">
                    <UserLabel user={tc.createdBy} fallback="Unknown" />
                    <Text size="xs" c="dimmed">
                      {fmtDateTime(tc.createdAt)}
                    </Text>
                  </Stack>
                </Detail>
                <Detail label="Updated">
                  <Stack gap={2} align="flex-end">
                    {tc.updatedBy && <UserLabel user={tc.updatedBy} />}
                    <Text size="xs" c="dimmed">
                      {fmtDateTime(tc.updatedAt)}
                    </Text>
                  </Stack>
                </Detail>
              </Stack>
            </Paper>
            <RequirementLinks tc={tc} canEdit={canEdit} onChanged={refresh} />
            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Exploratory source
              </Title>
              {tc.sourceFinding || tc.sourceCharter ? (
                <Stack gap={6}>
                  {tc.sourceFinding && (
                    <Group gap={6} wrap="nowrap">
                      <IconCompass size={16} color="var(--mantine-color-orange-6)" />
                      <Text size="sm" component={Link} to={`/projects/${pid}/findings/${tc.sourceFinding.id}`} className="ex-link" lineClamp={2}>
                        <span className="ex-key">{tc.sourceFinding.key}</span> {tc.sourceFinding.title}
                      </Text>
                    </Group>
                  )}
                  {tc.sourceCharter && (
                    <Group gap={6} wrap="nowrap">
                      <IconCompass size={16} color="var(--mantine-color-teal-6)" />
                      <Text size="sm" component={Link} to={`/projects/${pid}/charters/${tc.sourceCharter.id}`} className="ex-link" lineClamp={2}>
                        <span className="ex-key">{tc.sourceCharter.key}</span> {tc.sourceCharter.title}
                      </Text>
                    </Group>
                  )}
                  <Text size="xs" c="dimmed">
                    This case was created from exploratory testing.
                  </Text>
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Written directly, not converted from a finding or charter.
                </Text>
              )}
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>

      <TestCaseFormModal opened={editing} onClose={() => setEditing(false)} testCase={tc} onSaved={refresh} />
      <AddToRunModal opened={toRun} onClose={() => setToRun(false)} caseIds={[tc.id]} />
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <div style={{ minWidth: 0, textAlign: 'right' }}>{typeof children === 'string' ? <Text size="sm">{children}</Text> : children}</div>
    </Group>
  );
}

function ResultsTable({ results }: { results: any[] }) {
  const { pid } = useProject();
  if (!results.length) return <EmptyState title="Not executed yet" description="Results recorded in test runs appear here." icon={<IconListCheck size={26} />} />;
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Result</Table.Th>
              <Table.Th>Run</Table.Th>
              <Table.Th>Tested by</Table.Th>
              <Table.Th>When</Table.Th>
              <Table.Th>Elapsed</Table.Th>
              <Table.Th>Comment</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {results.map((r) => {
              const run = r.runItem?.run;
              return (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <StatusPill status={r.status} />
                  </Table.Td>
                  <Table.Td>
                    {run && (
                      <Text size="sm" component={Link} to={`/projects/${pid}/test-runs/${run.id}`} className="ex-link" lineClamp={1}>
                        <span className="ex-key">R-{run.number}</span> {run.name}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <UserLabel user={r.createdBy} fallback="Unknown" />
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label={fmtDateTime(r.createdAt)}>
                      <Text size="xs" c="dimmed">
                        {fromNow(r.createdAt)}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.elapsedSeconds != null ? duration(r.elapsedSeconds) : '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2} className="ex-prewrap">
                      {r.comment || '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

function RequirementLinks({ tc, canEdit, onChanged }: { tc: any; canEdit: boolean; onChanged: () => void }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const reqs = useQuery({ queryKey: ['requirements', pid, 'options'], queryFn: () => api.get(p(pid, '/requirements'), { pageSize: 200 }), enabled: canEdit });
  const linked: string[] = tc.requirements.map((r: any) => r.id);
  const opts: { value: string; label: string }[] = (reqs.data?.requirements ?? []).filter((r: any) => !linked.includes(r.id)).map((r: any) => ({ value: r.id, label: `${r.key} · ${r.title}` }));
  const save = async (ids: string[]) => {
    setBusy(true);
    try {
      await api.patch(p(pid, `/test-cases/${tc.id}`), { requirementIds: ids });
      qc.invalidateQueries({ queryKey: ['requirements', pid] });
      qc.invalidateQueries({ queryKey: ['requirement', pid] });
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper withBorder p="md">
      <Title order={5} mb="sm">
        Requirements ({tc.requirements.length})
      </Title>
      <Stack gap={6}>
        {tc.requirements.length === 0 && (
          <Text size="sm" c="dimmed">
            Not linked to any requirement. Link one to count this case towards coverage.
          </Text>
        )}
        {tc.requirements.map((r: any) => (
          <Group key={r.id} justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm" component={Link} to={`/projects/${pid}/requirements/${r.id}`} className="ex-link" lineClamp={1}>
              <span className="ex-key">{r.key}</span> {r.title}
            </Text>
            {canEdit && (
              <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Unlink ${r.key}`} disabled={busy} onClick={() => save(linked.filter((x) => x !== r.id))}>
                <IconX size={14} />
              </ActionIcon>
            )}
          </Group>
        ))}
        {canEdit && (
          <Select
            placeholder={reqs.isLoading ? 'Loading…' : 'Link a requirement…'}
            data={opts}
            value={null}
            onChange={(v) => v && save([...linked, v])}
            searchable
            disabled={busy}
            nothingFoundMessage="No other requirements"
            aria-label="Link a requirement"
            size="xs"
            mt={4}
          />
        )}
      </Stack>
    </Paper>
  );
}

const SNAP_FIELDS: [string, string][] = [
  ['title', 'Title'],
  ['description', 'Description'],
  ['preconditions', 'Preconditions'],
  ['testData', 'Test data'],
  ['format', 'Format'],
  ['gherkin', 'Gherkin'],
  ['priority', 'Priority'],
  ['type', 'Type'],
  ['status', 'Status'],
  ['estimateMinutes', 'Estimate (min)'],
  ['automationKey', 'Automation key'],
];

type Change = { label: string; from: string; to: string };
const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));
const stepKey = (s: Step) => `${s.action}\u0000${s.expected ?? ''}\u0000${s.data ?? ''}`;
const tagNames = (tags: any[] | undefined) =>
  (tags ?? [])
    .map((t) => (typeof t === 'string' ? t : t?.name ?? t?.tag?.name ?? ''))
    .filter(Boolean) as string[];

/** Older/imported snapshots may be partial and store steps as [action, expected, data] tuples. */
const normSnap = (s: any) => ({
  ...(s ?? {}),
  format: s?.format ?? (s?.gherkin ? 'GHERKIN' : 'STEPS'),
  steps: (s?.steps ?? []).map((x: any) => (Array.isArray(x) ? { action: String(x[0] ?? ''), expected: x[1] ?? null, data: x[2] ?? null } : x)),
});

function diffSnapshots(prev: any | undefined, cur: any): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  for (const [k, label] of SNAP_FIELDS) if (k in prev && k in cur && show(prev[k]) !== show(cur[k])) out.push({ label, from: show(prev[k]), to: show(cur[k]) });
  const a: Step[] = prev.steps ?? [];
  const b: Step[] = cur.steps ?? [];
  const changed = b.filter((s, i) => !a[i] || stepKey(a[i]!) !== stepKey(s)).length;
  if (a.length !== b.length || changed) out.push({ label: 'Steps', from: `${a.length} step(s)`, to: `${b.length} step(s)${changed ? `, ${changed} changed/added` : ''}` });
  if ('tags' in prev && 'tags' in cur) {
    const ta = tagNames(prev.tags).sort().join(', ');
    const tb = tagNames(cur.tags).sort().join(', ');
    if (ta !== tb) out.push({ label: 'Tags', from: ta || '—', to: tb || '—' });
  }
  return out;
}

function Revisions({ tc, canEdit, onRestored }: { tc: any; canEdit: boolean; onRestored: () => void }) {
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['test-case-revisions', pid, tc.id, tc.version], queryFn: () => api.get(p(pid, `/test-cases/${tc.id}/revisions`)) });
  const [open, setOpen] = useState<any | null>(null);
  return (
    <QueryState query={q}>
      {(d: any) => {
        const revs: any[] = d.revisions.map((r: any) => ({ ...r, snapshot: normSnap(r.snapshot) })).sort((a: any, b: any) => b.version - a.version);
        if (!revs.length) return <EmptyState title="No revisions recorded" icon={<IconHistory size={26} />} />;
        const prevOf = (r: any) => revs.find((x) => x.version < r.version);
        return (
          <>
            <Paper withBorder>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={100}>Version</Table.Th>
                    <Table.Th>Author</Table.Th>
                    <Table.Th>Saved</Table.Th>
                    <Table.Th>Changes vs previous</Table.Th>
                    <Table.Th w={80} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {revs.map((r) => {
                    const prev = prevOf(r);
                    const changes = diffSnapshots(prev?.snapshot, r.snapshot);
                    return (
                      <Table.Tr key={r.id}>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Text size="sm" fw={600}>
                              v{r.version}
                            </Text>
                            {r.version === tc.version && (
                              <Badge size="xs" variant="light">
                                current
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <UserLabel user={r.author} fallback="Unknown" />
                        </Table.Td>
                        <Table.Td>
                          <Tooltip label={fmtDateTime(r.createdAt)}>
                            <Text size="xs" c="dimmed">
                              {fromNow(r.createdAt)}
                            </Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c={changes.length ? undefined : 'dimmed'} lineClamp={1}>
                            {prev ? (changes.length ? changes.map((c) => c.label).join(', ') : 'No content differences') : 'Initial version'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Button size="compact-xs" variant="subtle" onClick={() => setOpen(r)}>
                            View
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Paper>
            <RevisionModal rev={open} prev={open ? prevOf(open) : undefined} tc={tc} canEdit={canEdit} onClose={() => setOpen(null)} onRestored={onRestored} />
          </>
        );
      }}
    </QueryState>
  );
}

function RevisionModal({ rev, prev, tc, canEdit, onClose, onRestored }: { rev: any | null; prev: any | undefined; tc: any; canEdit: boolean; onClose: () => void; onRestored: () => void }) {
  const { pid } = useProject();
  const [busy, setBusy] = useState(false);
  const changes = useMemo(() => (rev ? diffSnapshots(prev?.snapshot, rev.snapshot) : []), [rev, prev]);
  const s = rev?.snapshot;
  const restore = async () => {
    setBusy(true);
    try {
      // Only restore fields the snapshot actually recorded (seeded/legacy snapshots can be partial).
      const has = (k: string) => k in s;
      const body: Record<string, unknown> = {
        baseVersion: tc.version,
        title: s.title,
        format: s.format,
        ...(s.format === 'GHERKIN' ? { gherkin: s.gherkin } : {}),
        steps: (s.steps ?? []).map((x: Step) => ({ action: x.action, expected: x.expected ?? null, data: x.data ?? null })),
      };
      for (const k of ['description', 'preconditions', 'testData', 'estimateMinutes', 'automationKey']) if (has(k)) body[k] = s[k] ?? null;
      for (const k of ['priority', 'type']) if (has(k) && s[k]) body[k] = s[k];
      if (has('tags')) body.tags = tagNames(s.tags);
      await api.patch(p(pid, `/test-cases/${tc.id}`), body);
      toastOk(`Restored content of v${rev.version} as a new version`);
      onRestored();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={!!rev} onClose={onClose} title={rev ? `${tc.key} · version ${rev.version}` : ''} size="xl">
      {rev && s && (
        <Stack>
          <Text size="sm" c="dimmed">
            Saved by {rev.author?.name ?? 'unknown'} on {fmtDateTime(rev.createdAt)}
          </Text>
          {prev ? (
            changes.length ? (
              <Paper withBorder>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={140}>Field</Table.Th>
                      <Table.Th>v{prev.version}</Table.Th>
                      <Table.Th>v{rev.version}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {changes.map((c) => (
                      <Table.Tr key={c.label}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {c.label}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="red.8" td="line-through" className="ex-prewrap" lineClamp={6}>
                            {c.from}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="teal.8" className="ex-prewrap" lineClamp={6}>
                            {c.to}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>
            ) : (
              <Text size="sm">No content differences from v{prev.version}.</Text>
            )
          ) : (
            <Text size="sm">Initial version.</Text>
          )}
          <Divider label="Snapshot" labelPosition="left" />
          <Title order={4}>{s.title}</Title>
          <Group gap="xs">
            {s.priority && <PriorityBadge value={s.priority} size="sm" />}
            <Badge size="sm" variant="light" color={CASE_FORMAT[s.format]?.color}>
              {CASE_FORMAT[s.format]?.label ?? titleCase(s.format)}
            </Badge>
            {tagNames(s.tags).map((t) => (
              <Badge key={t} size="sm" variant="outline" color="gray">
                #{t}
              </Badge>
            ))}
          </Group>
          <TextBlock label="Description" value={s.description} />
          <TextBlock label="Preconditions" value={s.preconditions} />
          <TextBlock label="Test data" value={s.testData} />
          {s.format === 'GHERKIN' ? <GherkinView source={s.gherkin} /> : s.format === 'STEPS' ? <StepsTable steps={s.steps ?? []} /> : null}
          {canEdit && rev.version !== tc.version && (
            <Group justify="flex-end">
              <Button variant="light" leftSection={<IconArrowBackUp size={16} />} loading={busy} onClick={restore}>
                Restore this version
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </Modal>
  );
}
