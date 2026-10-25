import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Anchor, Badge, Button, Grid, Group, Menu, Paper, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArchive,
  IconArrowBackUp,
  IconBug,
  IconChevronLeft,
  IconClipboardList,
  IconCompass,
  IconDots,
  IconExternalLink,
  IconFlag,
  IconLink,
  IconPencil,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useProject } from '../../lib/project';
import {
  CharterStatusBadge,
  ClassificationBadge,
  FindingStatusBadge,
  IssueStatusBadge,
  PageHeader,
  PriorityBadge,
  QueryState,
  SessionStatusBadge,
  SeverityBadge,
  StatusPill,
  toastError,
  toastOk,
  UserLabel,
} from '../../components/ui';
import { CoverageBadge, LinkPickerModal, REQUIREMENT_STATUS, RequirementFormModal, TEST_CASE_STATUS } from '../../components/TestingWidgets';

export default function RequirementDetail() {
  const { id } = useParams();
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['requirement', pid, id], queryFn: () => api.get(p(pid, `/requirements/${id}`)) });
  return <QueryState query={q}>{(d: any) => <RequirementView req={d.requirement} />}</QueryState>;
}

function RequirementView({ req }: { req: any }) {
  const { pid, can } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = can('TESTER');
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState<'testCase' | 'charter' | null>(null);
  const cov = req.coverage;
  const caseIds: string[] = req.testCases.map((t: any) => t.id);
  const charterIds: string[] = req.charters.map((c: any) => c.id);

  const cases = useQuery({ queryKey: ['test-cases', pid, 'by-requirement', req.id], queryFn: () => api.get(p(pid, '/test-cases'), { requirementId: req.id, pageSize: 200 }) });
  const lastResult = new Map<string, any>((cases.data?.testCases ?? []).map((t: any) => [t.id, t]));
  const findings = useQuery({ queryKey: ['findings', pid, 'by-requirement', req.id], queryFn: () => api.get(p(pid, '/findings'), { requirementId: req.id, pageSize: 200 }) });
  const sessions = useQueries({
    queries: charterIds.map((cid) => ({ queryKey: ['sessions', pid, 'by-charter', cid], queryFn: () => api.get(p(pid, '/sessions'), { charterId: cid, pageSize: 100 }) })),
  });
  const sessionRows: any[] = sessions.flatMap((s) => s.data?.sessions ?? []);
  const sessionsLoading = sessions.some((s) => s.isLoading);
  const findingRows: any[] = findings.data?.findings ?? req.findings;
  const issueRows: any[] = [...new Map(findingRows.filter((f) => f.issue).map((f) => [f.issue.id, { ...f.issue, via: f }])).values()];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['requirement', pid, req.id] });
    qc.invalidateQueries({ queryKey: ['requirements', pid] });
    qc.invalidateQueries({ queryKey: ['test-cases', pid] });
    qc.invalidateQueries({ queryKey: ['test-case', pid] });
  };

  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(p(pid, `/requirements/${req.id}`), body);
      toastOk(msg);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const unlink = (kind: 'testCase' | 'charter', item: any) =>
    modals.openConfirmModal({
      title: `Unlink ${item.key}?`,
      children: <Text size="sm">It will no longer count towards the coverage of {req.key}.</Text>,
      labels: { confirm: 'Unlink', cancel: 'Cancel' },
      onConfirm: () =>
        kind === 'testCase'
          ? patch({ testCaseIds: caseIds.filter((x) => x !== item.id) }, `Unlinked ${item.key}`)
          : patch({ charterIds: charterIds.filter((x) => x !== item.id) }, `Unlinked ${item.key}`),
    });

  const remove = () =>
    modals.openConfirmModal({
      title: `Delete ${req.key}?`,
      children: (
        <Text size="sm">
          The requirement and its links are deleted permanently. Linked test cases, charters and findings are kept. To keep the history, mark it as deprecated instead.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(p(pid, `/requirements/${req.id}`));
          toastOk(`${req.key} deleted`);
          qc.invalidateQueries({ queryKey: ['requirements', pid] });
          navigate(`/projects/${pid}/requirements`);
        } catch (e) {
          toastError(e);
        }
      },
    });

  const deprecated = req.status === 'DEPRECATED';

  return (
    <>
      <Anchor component={Link} to={`/projects/${pid}/requirements`} size="sm" c="dimmed" mb="xs" display="inline-flex" style={{ alignItems: 'center', gap: 4 }}>
        <IconChevronLeft size={14} /> Requirements
      </Anchor>
      <PageHeader
        kicker={req.key}
        title={req.title}
        actions={
          canEdit && (
            <>
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
                  {deprecated ? (
                    <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => patch({ status: 'APPROVED' }, 'Requirement restored to Approved')}>
                      Restore (mark approved)
                    </Menu.Item>
                  ) : (
                    <Menu.Item leftSection={<IconArchive size={14} />} onClick={() => patch({ status: 'DEPRECATED' }, 'Requirement deprecated')}>
                      Mark deprecated
                    </Menu.Item>
                  )}
                  {can('LEAD') && (
                    <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={remove}>
                      Delete
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </>
          )
        }
      />
      <Group gap="xs" mt={-8} mb="md">
        <Badge variant="light" color={REQUIREMENT_STATUS[req.status]?.color}>
          {REQUIREMENT_STATUS[req.status]?.label ?? req.status}
        </Badge>
        <PriorityBadge value={req.priority} />
        <CoverageBadge coverage={cov} />
        {(req.externalKey || req.externalUrl) &&
          (req.externalUrl ? (
            <Anchor href={req.externalUrl} target="_blank" rel="noopener noreferrer" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {req.externalKey || 'External link'} <IconExternalLink size={14} />
            </Anchor>
          ) : (
            <Badge variant="outline" color="gray">
              {req.externalKey}
            </Badge>
          ))}
      </Group>

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="lg">
            <Paper withBorder p="md">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={6} style={{ letterSpacing: '0.03em' }}>
                Description
              </Text>
              {req.description ? (
                <Text size="sm" className="ex-prewrap">
                  {req.description}
                </Text>
              ) : (
                <Text size="sm" c="dimmed" fs="italic">
                  No description.
                </Text>
              )}
            </Paper>

            <Section
              title="Test cases"
              count={req.testCases.length}
              icon={<IconClipboardList size={18} />}
              action={
                canEdit && (
                  <Button size="xs" variant="light" leftSection={<IconLink size={14} />} onClick={() => setPicker('testCase')}>
                    Link test cases
                  </Button>
                )
              }
            >
              {req.testCases.length === 0 ? (
                <Empty>No test cases linked. Link cases that verify this requirement.</Empty>
              ) : (
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Test case</Table.Th>
                      <Table.Th w={110}>Case status</Table.Th>
                      <Table.Th w={130}>Latest result</Table.Th>
                      {canEdit && <Table.Th w={40} />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {req.testCases.map((t: any) => {
                      const row = lastResult.get(t.id);
                      return (
                        <Table.Tr key={t.id}>
                          <Table.Td>
                            <Text size="sm" component={Link} to={`/projects/${pid}/test-cases/${t.id}`} className="ex-link" lineClamp={1}>
                              <span className="ex-key">{t.key}</span> {t.title}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="sm" variant="light" color={TEST_CASE_STATUS[t.status]?.color}>
                              {TEST_CASE_STATUS[t.status]?.label ?? t.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            {cases.isLoading ? (
                              <Text size="xs" c="dimmed">
                                …
                              </Text>
                            ) : row ? (
                              <StatusPill status={row.lastResult} />
                            ) : (
                              <Tooltip label="Archived test case">
                                <Badge size="sm" variant="outline" color="gray">
                                  Archived
                                </Badge>
                              </Tooltip>
                            )}
                          </Table.Td>
                          {canEdit && (
                            <Table.Td>
                              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => unlink('testCase', t)} aria-label={`Unlink ${t.key}`}>
                                <IconX size={14} />
                              </ActionIcon>
                            </Table.Td>
                          )}
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              )}
            </Section>

            <Section
              title="Charters"
              count={req.charters.length}
              icon={<IconCompass size={18} />}
              action={
                canEdit && (
                  <Button size="xs" variant="light" leftSection={<IconLink size={14} />} onClick={() => setPicker('charter')}>
                    Link charters
                  </Button>
                )
              }
            >
              {req.charters.length === 0 ? (
                <Empty>No charters linked. Link exploratory charters that investigate this requirement.</Empty>
              ) : (
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Charter</Table.Th>
                      <Table.Th w={130}>Status</Table.Th>
                      <Table.Th w={90}>Sessions</Table.Th>
                      {canEdit && <Table.Th w={40} />}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {req.charters.map((c: any) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>
                          <Text size="sm" component={Link} to={`/projects/${pid}/charters/${c.id}`} className="ex-link" lineClamp={1}>
                            <span className="ex-key">{c.key}</span> {c.title}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <CharterStatusBadge value={c.status} size="sm" />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{sessionsLoading ? '…' : sessionRows.filter((s) => s.charter?.id === c.id).length}</Text>
                        </Table.Td>
                        {canEdit && (
                          <Table.Td>
                            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => unlink('charter', c)} aria-label={`Unlink ${c.key}`}>
                              <IconX size={14} />
                            </ActionIcon>
                          </Table.Td>
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Section>

            <Section title="Sessions" count={sessionsLoading ? undefined : sessionRows.length} icon={<IconPlayerPlay size={18} />} hint="Sessions run against the linked charters">
              {sessionsLoading ? (
                <Empty>Loading…</Empty>
              ) : sessionRows.length === 0 ? (
                <Empty>{req.charters.length ? 'No sessions have been run for the linked charters yet.' : 'Link a charter to trace its sessions here.'}</Empty>
              ) : (
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Session</Table.Th>
                      <Table.Th>Charter</Table.Th>
                      <Table.Th>Tester</Table.Th>
                      <Table.Th w={130}>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sessionRows.map((s) => (
                      <Table.Tr key={s.id}>
                        <Table.Td>
                          <Text size="sm" component={Link} to={`/projects/${pid}/sessions/${s.id}`} className="ex-link" lineClamp={1}>
                            <span className="ex-key">{s.key}</span> {s.title}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {s.charter?.key}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <UserLabel user={s.tester} />
                        </Table.Td>
                        <Table.Td>
                          <SessionStatusBadge value={s.status} size="sm" />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Section>

            <Section title="Findings" count={findingRows.length} icon={<IconFlag size={18} />} hint="Findings reported against this requirement">
              {findingRows.length === 0 ? (
                <Empty>No findings reference this requirement.</Empty>
              ) : (
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Finding</Table.Th>
                      <Table.Th w={130}>Type</Table.Th>
                      <Table.Th w={100}>Severity</Table.Th>
                      <Table.Th w={120}>Status</Table.Th>
                      <Table.Th w={100}>Issue</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {findingRows.map((f) => (
                      <Table.Tr key={f.id}>
                        <Table.Td>
                          <Text size="sm" component={Link} to={`/projects/${pid}/findings/${f.id}`} className="ex-link" lineClamp={1}>
                            <span className="ex-key">{f.key}</span> {f.title}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <ClassificationBadge c={f.classification} size="sm" />
                        </Table.Td>
                        <Table.Td>
                          <SeverityBadge value={f.severity} size="sm" />
                        </Table.Td>
                        <Table.Td>
                          <FindingStatusBadge value={f.status} size="sm" />
                        </Table.Td>
                        <Table.Td>
                          {f.issue ? (
                            <Text size="sm" component={Link} to={`/projects/${pid}/issues/${f.issue.id}`} className="ex-link">
                              <span className="ex-key">{f.issue.key}</span>
                            </Text>
                          ) : (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Section>

            <Section title="Issues" count={findings.isLoading ? undefined : issueRows.length} icon={<IconBug size={18} />} hint="Issues filed from the findings above">
              {findings.isLoading ? (
                <Empty>Loading…</Empty>
              ) : issueRows.length === 0 ? (
                <Empty>No issues have been filed from this requirement's findings.</Empty>
              ) : (
                <Table verticalSpacing="xs">
                  <Table.Tbody>
                    {issueRows.map((i) => (
                      <Table.Tr key={i.id}>
                        <Table.Td>
                          <Text size="sm" component={Link} to={`/projects/${pid}/issues/${i.id}`} className="ex-link" lineClamp={1}>
                            <span className="ex-key">{i.key}</span> {i.title}
                          </Text>
                        </Table.Td>
                        <Table.Td w={130}>
                          <IssueStatusBadge value={i.status} size="sm" />
                        </Table.Td>
                        <Table.Td w={130}>
                          <Text size="xs" c="dimmed">
                            via {i.via.key}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Section>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="lg">
            <Paper withBorder p="md">
              <Group justify="space-between" mb="sm">
                <Title order={5}>Coverage</Title>
                <CoverageBadge coverage={cov} />
              </Group>
              <SimpleGrid cols={2} spacing="sm">
                <Metric label="Test cases" value={cov.testCases} hint={`${cov.executedTestCases} executed`} />
                <Metric label="Failing" value={cov.failedTestCases} color={cov.failedTestCases ? 'red' : undefined} hint="failed or blocked" />
                <Metric label="Charters" value={cov.charters} hint={`${cov.exploredCharters} explored`} />
                <Metric label="Open defects" value={cov.openDefects} color={cov.openDefects ? 'red' : undefined} hint={`${cov.openFindings} open findings`} />
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="sm">
                Covered means at least one linked charter has a completed session or one linked test case has been executed.
              </Text>
            </Paper>
            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Details
              </Title>
              <Stack gap={8}>
                <Row label="External key">{req.externalKey ?? '—'}</Row>
                <Row label="Created">{fmtDateTime(req.createdAt)}</Row>
                <Row label="Updated">{fmtDateTime(req.updatedAt)}</Row>
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>

      <RequirementFormModal opened={editing} onClose={() => setEditing(false)} requirement={req} onSaved={refresh} />
      <LinkPickerModal
        opened={picker === 'testCase'}
        onClose={() => setPicker(null)}
        title={`Link test cases to ${req.key}`}
        kind="testCase"
        exclude={caseIds}
        onConfirm={async (ids) => {
          await api.patch(p(pid, `/requirements/${req.id}`), { testCaseIds: [...caseIds, ...ids] });
          toastOk(`Linked ${ids.length} test case(s)`);
          refresh();
        }}
      />
      <LinkPickerModal
        opened={picker === 'charter'}
        onClose={() => setPicker(null)}
        title={`Link charters to ${req.key}`}
        kind="charter"
        exclude={charterIds}
        onConfirm={async (ids) => {
          await api.patch(p(pid, `/requirements/${req.id}`), { charterIds: [...charterIds, ...ids] });
          toastOk(`Linked ${ids.length} charter(s)`);
          refresh();
        }}
      />
    </>
  );
}

function Section({ title, count, icon, action, hint, children }: { title: string; count?: number; icon: ReactNode; action?: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <Paper withBorder>
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--ex-border)' }}>
        <Group gap="xs">
          {icon}
          <Title order={5}>
            {title}
            {count !== undefined && (
              <Text span c="dimmed" fw={400}>
                {' '}
                ({count})
              </Text>
            )}
          </Title>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Group>
        {action}
      </Group>
      {children}
    </Paper>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed" p="md">
      {children}
    </Text>
  );
}

function Metric({ label, value, hint, color }: { label: string; value: number; hint?: string; color?: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.03em' }}>
        {label}
      </Text>
      <Text fz={22} fw={700} c={color}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right" style={{ minWidth: 0, wordBreak: 'break-all' }}>
        {children}
      </Text>
    </Group>
  );
}

