import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Anchor, Avatar, Badge, Button, Grid, Group, List, Menu, Paper, Progress, Stack, Table, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArchive,
  IconArrowBackUp,
  IconBulb,
  IconCheck,
  IconCopy,
  IconDots,
  IconEdit,
  IconHistory,
  IconMessage,
  IconPencilMinus,
  IconPlayerPlay,
  IconTimeline,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { duration, fmtDate, fmtDateTime, fromNow, minutes } from '../../lib/format';
import { useProject } from '../../lib/project';
import { Comments } from '../../components/Comments';
import { CustomFieldsView } from '../../components/CustomFields';
import { FindingFormModal } from '../../components/FindingForm';
import { HistoryList } from '../../components/History';
import { LaunchSessionModal } from '../../components/LaunchSessionModal';
import {
  CharterStatusBadge,
  ClassificationBadge,
  EmptyState,
  FindingStatusBadge,
  PageHeader,
  PriorityBadge,
  QueryState,
  SessionStatusBadge,
  SeverityBadge,
  TextBlock,
  toastError,
  toastOk,
  UserAvatar,
  UserLabel,
} from '../../components/ui';

export default function CharterDetail() {
  const { id = '' } = useParams();
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['charter', pid, id], queryFn: () => api.get(p(pid, `/charters/${id}`)) });
  return <QueryState query={q}>{(d: any) => <CharterView charter={d.charter} permissions={d.permissions} />}</QueryState>;
}

function CharterView({ charter: c, permissions }: { charter: any; permissions: { canEdit: boolean; canLaunch: boolean; canArchive: boolean } }) {
  const { pid, can, classifications } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [launch, setLaunch] = useState(false);
  const [newFinding, setNewFinding] = useState(false);
  const [tab, setTab] = useState<string | null>('sessions');
  const archived = c.status === 'ARCHIVED';

  const findings = useQuery({ queryKey: ['findings', pid, { charterId: c.id }], queryFn: () => api.get(p(pid, '/findings'), { charterId: c.id, pageSize: 100 }) });
  const history = useQuery({ queryKey: ['charter-history', pid, c.id], queryFn: () => api.get(p(pid, `/charters/${c.id}/history`)), enabled: tab === 'history' });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['charter', pid, c.id] });
    qc.invalidateQueries({ queryKey: ['charters', pid] });
    qc.invalidateQueries({ queryKey: ['charter-history', pid, c.id] });
  };

  const setStatus = async (status: 'DRAFT' | 'READY') => {
    try {
      await api.patch(p(pid, `/charters/${c.id}`), { status });
      toastOk(status === 'READY' ? `${c.key} is ready to launch` : `${c.key} moved back to draft`);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const duplicate = async () => {
    try {
      const r = await api.post(p(pid, `/charters/${c.id}/duplicate`));
      toastOk(`Created ${r.charter.key} as a draft copy`);
      qc.invalidateQueries({ queryKey: ['charters', pid] });
      navigate(`/projects/${pid}/charters/${r.charter.id}/edit`);
    } catch (e) {
      toastError(e, 'Could not duplicate charter');
    }
  };

  const archive = (action: 'archive' | 'unarchive') => {
    const run = async () => {
      try {
        await api.post(p(pid, `/charters/${c.id}/${action}`));
        toastOk(action === 'archive' ? `${c.key} archived` : `${c.key} restored as Ready`);
        refresh();
      } catch (e) {
        toastError(e);
      }
    };
    if (action === 'unarchive') return void run();
    modals.openConfirmModal({
      title: `Archive ${c.key}?`,
      children: <Text size="sm">The charter is hidden from the library and can't launch new sessions. Its {c.sessions.length} session(s) and findings are kept.</Text>,
      labels: { confirm: 'Archive', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: run,
    });
  };

  const spent = c.sessions.reduce((a: number, s: any) => a + (s.elapsedSeconds ?? 0), 0);
  const env = [c.environment?.name, c.browser, c.os, c.device].filter(Boolean).join(' · ');
  const risks = (c.risks ?? '').split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean);
  const byClass = (c.findingsByClassification ?? [])
    .map((f: any) => ({ ...f, cls: classifications.find((x) => x.id === f.classificationId) }))
    .sort((a: any, b: any) => (a.cls?.position ?? 99) - (b.cls?.position ?? 99));
  const totalFindings = byClass.reduce((a: number, f: any) => a + f.count, 0);
  const hasMenu = (permissions.canEdit && !archived) || can('TESTER') || permissions.canArchive;

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link to={`/projects/${pid}/charters`} className="ex-link">
              Charters
            </Link>{' '}
            / {c.key}
          </>
        }
        title={c.title}
        actions={
          <>
            {permissions.canLaunch && (
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => setLaunch(true)}>
                Launch session
              </Button>
            )}
            {permissions.canEdit && !archived && (
              <Button variant="default" leftSection={<IconEdit size={16} />} component={Link} to={`/projects/${pid}/charters/${c.id}/edit`}>
                Edit
              </Button>
            )}
            {hasMenu && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="default" size="lg" aria-label="More charter actions">
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {permissions.canEdit && !archived && c.status === 'DRAFT' && (
                    <Menu.Item leftSection={<IconCheck size={14} />} onClick={() => setStatus('READY')}>
                      Mark as ready
                    </Menu.Item>
                  )}
                  {permissions.canEdit && !archived && c.status === 'READY' && (
                    <Menu.Item leftSection={<IconPencilMinus size={14} />} onClick={() => setStatus('DRAFT')}>
                      Move back to draft
                    </Menu.Item>
                  )}
                  {can('TESTER') && (
                    <Menu.Item leftSection={<IconBulb size={14} />} onClick={() => setNewFinding(true)}>
                      Log finding (outside a session)
                    </Menu.Item>
                  )}
                  {can('TESTER') && (
                    <Menu.Item leftSection={<IconCopy size={14} />} onClick={duplicate}>
                      Duplicate
                    </Menu.Item>
                  )}
                  {permissions.canArchive &&
                    (archived ? (
                      <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => archive('unarchive')}>
                        Unarchive
                      </Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconArchive size={14} />} color="red" onClick={() => archive('archive')}>
                        Archive
                      </Menu.Item>
                    ))}
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />
      <Group gap="xs" mt={-8} mb="lg">
        <CharterStatusBadge value={c.status} />
        <PriorityBadge value={c.priority} />
        <Badge variant="light" color="gray">
          Risk: {c.riskLevel.toLowerCase()}
        </Badge>
        <Badge variant="outline" color="gray">
          {minutes(c.timeboxMinutes)} timebox
        </Badge>
        {c.tags.map((t: string) => (
          <Badge key={t} variant="light" color="gray">
            {t}
          </Badge>
        ))}
      </Group>

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4} style={{ letterSpacing: '0.03em' }}>
                Mission
              </Text>
              <Text size="lg" className="ex-prewrap" mb="md">
                {c.mission}
              </Text>
              <Stack gap="md">
                <TextBlock label="Target / feature" value={c.target} />
                <Grid gap="md">
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextBlock label="In scope" value={c.scope} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextBlock label="Out of scope" value={c.outOfScope} />
                  </Grid.Col>
                </Grid>
                <TextBlock label="Objectives" value={c.objectives} />
                <TextBlock label="Learning goals" value={c.learningGoals} />
                <TextBlock
                  label="Target risks"
                  value={
                    risks.length ? (
                      <List size="sm" spacing={2}>
                        {risks.map((r: string, i: number) => (
                          <List.Item key={i}>{r}</List.Item>
                        ))}
                      </List>
                    ) : null
                  }
                />
                <TextBlock label="Assumptions & constraints" value={c.assumptions} />
                <TextBlock
                  label="Test ideas"
                  value={
                    c.testIdeas.length ? (
                      <List size="sm" spacing={2} type="ordered">
                        {c.testIdeas.map((t: string, i: number) => (
                          <List.Item key={i}>{t}</List.Item>
                        ))}
                      </List>
                    ) : null
                  }
                />
                <TextBlock
                  label="Heuristics"
                  value={
                    c.heuristics.length ? (
                      <Group gap={6}>
                        {c.heuristics.map((h: string) => (
                          <Badge key={h} variant="light" color="grape" style={{ textTransform: 'none' }}>
                            {h}
                          </Badge>
                        ))}
                      </Group>
                    ) : null
                  }
                />
                <Grid gap="md">
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextBlock label="Prerequisites" value={c.prerequisites} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <TextBlock label="Test data" value={c.testData} />
                  </Grid.Col>
                </Grid>
                <TextBlock label="Exit criteria" value={c.exitCriteria} />
                <TextBlock label="Environment notes" value={c.environmentNotes} />
              </Stack>
            </Paper>

            <Paper withBorder p={0}>
              <Tabs value={tab} onChange={setTab} keepMounted={false}>
                <Tabs.List px="sm">
                  <Tabs.Tab value="sessions" leftSection={<IconTimeline size={14} />}>
                    Sessions ({c.sessions.length})
                  </Tabs.Tab>
                  <Tabs.Tab value="findings" leftSection={<IconBulb size={14} />}>
                    Findings ({findings.data?.total ?? totalFindings})
                  </Tabs.Tab>
                  <Tabs.Tab value="comments" leftSection={<IconMessage size={14} />}>
                    Comments
                  </Tabs.Tab>
                  <Tabs.Tab value="history" leftSection={<IconHistory size={14} />}>
                    History
                  </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="sessions" p="md">
                  {c.sessions.length === 0 ? (
                    <EmptyState
                      title="No sessions yet"
                      description="Launch this charter to start a timeboxed exploratory session. You can launch it many times, e.g. per tester, build or environment."
                      action={
                        permissions.canLaunch && (
                          <Button leftSection={<IconPlayerPlay size={16} />} onClick={() => setLaunch(true)}>
                            Launch session
                          </Button>
                        )
                      }
                    />
                  ) : (
                    <Table.ScrollContainer minWidth={700}>
                      <Table highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Session</Table.Th>
                            <Table.Th>Tester</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Time</Table.Th>
                            <Table.Th>Findings</Table.Th>
                            <Table.Th>Started</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {c.sessions.map((s: any) => {
                            const ratio = s.timeboxMinutes ? s.elapsedSeconds / (s.timeboxMinutes * 60) : 0;
                            return (
                              <Table.Tr key={s.id}>
                                <Table.Td>
                                  <Link to={`/projects/${pid}/sessions/${s.id}`} className="ex-link">
                                    <span className="ex-key">{s.key}</span> {s.title}
                                  </Link>
                                  {s.archivedAt && (
                                    <Badge size="xs" color="dark" variant="light" ml={6}>
                                      archived
                                    </Badge>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <UserLabel user={s.tester} />
                                </Table.Td>
                                <Table.Td>
                                  <SessionStatusBadge value={s.status} variant="light" />
                                </Table.Td>
                                <Table.Td miw={140}>
                                  <Text size="xs" c={ratio > 1 ? 'red' : undefined}>
                                    {duration(s.elapsedSeconds)} / {minutes(s.timeboxMinutes)}
                                    {ratio > 1 ? ' (overtime)' : ''}
                                  </Text>
                                  <Progress value={Math.min(100, ratio * 100)} color={ratio > 1 ? 'red' : 'explorix'} size="xs" mt={2} aria-label="Elapsed vs timebox" />
                                </Table.Td>
                                <Table.Td>{s.findingsCount}</Table.Td>
                                <Table.Td>
                                  <Text size="sm" c="dimmed">
                                    {s.startedAt ? fmtDate(s.startedAt) : 'Not started'}
                                  </Text>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  )}
                </Tabs.Panel>
                <Tabs.Panel value="findings" p="md">
                  <QueryState query={findings}>
                    {(d: any) =>
                      d.findings.length === 0 ? (
                        <EmptyState icon={<IconBulb size={26} />} title="No findings yet" description="Findings captured in this charter's sessions appear here." />
                      ) : (
                        <>
                          <Table.ScrollContainer minWidth={700}>
                            <Table highlightOnHover>
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Finding</Table.Th>
                                  <Table.Th>Type</Table.Th>
                                  <Table.Th>Severity</Table.Th>
                                  <Table.Th>Status</Table.Th>
                                  <Table.Th>Session</Table.Th>
                                  <Table.Th>Created</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {d.findings.map((f: any) => (
                                  <Table.Tr key={f.id}>
                                    <Table.Td>
                                      <Link to={`/projects/${pid}/findings/${f.id}`} className="ex-link">
                                        <span className="ex-key">{f.key}</span> {f.title}
                                      </Link>
                                    </Table.Td>
                                    <Table.Td>
                                      <ClassificationBadge c={f.classification} size="sm" />
                                    </Table.Td>
                                    <Table.Td>
                                      <SeverityBadge value={f.severity} size="sm" />
                                    </Table.Td>
                                    <Table.Td>
                                      <FindingStatusBadge value={f.status} variant="light" size="sm" />
                                    </Table.Td>
                                    <Table.Td>
                                      {f.session ? (
                                        <Link to={`/projects/${pid}/sessions/${f.session.id}`} className="ex-link ex-key">
                                          {f.session.key}
                                        </Link>
                                      ) : (
                                        <Text size="xs" c="dimmed">
                                          —
                                        </Text>
                                      )}
                                    </Table.Td>
                                    <Table.Td>
                                      <Text size="sm" c="dimmed">
                                        {fromNow(f.createdAt)}
                                      </Text>
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </Table.ScrollContainer>
                          {d.total > d.findings.length && (
                            <Anchor component={Link} to={`/projects/${pid}/findings?charterId=${c.id}`} size="sm" mt="sm" display="block">
                              View all {d.total} findings
                            </Anchor>
                          )}
                        </>
                      )
                    }
                  </QueryState>
                </Tabs.Panel>
                <Tabs.Panel value="comments" p="md">
                  <Comments targetType="charter" targetId={c.id} />
                </Tabs.Panel>
                <Tabs.Panel value="history" p="md">
                  <QueryState query={history}>{(d: any) => <HistoryList events={d.events} />}</QueryState>
                </Tabs.Panel>
              </Tabs>
            </Paper>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Details
              </Title>
              <Stack gap="xs">
                <Row label="Timebox">{minutes(c.timeboxMinutes)} per session</Row>
                <Row label="Estimate">{c.estimatedMinutes ? minutes(c.estimatedMinutes) : '—'}</Row>
                <Row label="Time spent">
                  {duration(spent)} across {c.sessions.length} session{c.sessions.length === 1 ? '' : 's'}
                </Row>
                <Row label="Milestone">{c.milestone?.name ?? '—'}</Row>
                <Row label="Environment">{env || '—'}</Row>
                <Row label="Assignees">
                  {c.assignees.length ? (
                    <Avatar.Group spacing="xs">
                      {c.assignees.map((a: any) => (
                        <UserAvatar key={a.id} user={a} size={26} />
                      ))}
                    </Avatar.Group>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Template">
                  {c.template ? (
                    <Anchor component={Link} to={`/projects/${pid}/templates`} size="sm">
                      {c.template.name}
                    </Anchor>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Created">
                  <Tooltip label={fmtDateTime(c.createdAt)}>
                    <span>
                      {fromNow(c.createdAt)} by {c.createdBy?.name ?? 'unknown'}
                    </span>
                  </Tooltip>
                </Row>
                <Row label="Updated">
                  <Tooltip label={fmtDateTime(c.updatedAt)}>
                    <span>
                      {fromNow(c.updatedAt)}
                      {c.updatedBy ? ` by ${c.updatedBy.name}` : ''}
                    </span>
                  </Tooltip>
                </Row>
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Group justify="space-between" mb="sm">
                <Title order={5}>Findings by type</Title>
                {totalFindings > 0 && (
                  <Anchor component={Link} to={`/projects/${pid}/findings?charterId=${c.id}`} size="xs">
                    Open list
                  </Anchor>
                )}
              </Group>
              {byClass.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No findings yet.
                </Text>
              ) : (
                <Stack gap={6}>
                  {byClass.map((f: any) => (
                    <Group key={f.classificationId} justify="space-between" wrap="nowrap">
                      {f.cls ? (
                        <Link to={`/projects/${pid}/findings?charterId=${c.id}&classification=${f.cls.key}`}>
                          <ClassificationBadge c={f.cls} style={{ cursor: 'pointer' }} />
                        </Link>
                      ) : (
                        <Badge color="gray">Archived type</Badge>
                      )}
                      <Text size="sm" fw={600}>
                        {f.count}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Paper>

            {(c.requirements.length > 0 || c.testCases.length > 0) && (
              <Paper withBorder p="md">
                <Title order={5} mb="sm">
                  Traceability
                </Title>
                <Stack gap="sm">
                  {c.requirements.length > 0 && (
                    <TextBlock
                      label="Requirements"
                      value={
                        <Stack gap={2}>
                          {c.requirements.map((r: any) => (
                            <Link key={r.id} to={`/projects/${pid}/requirements/${r.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                <span className="ex-key">{r.key}</span> {r.title}
                              </Text>
                            </Link>
                          ))}
                        </Stack>
                      }
                    />
                  )}
                  {c.testCases.length > 0 && (
                    <TextBlock
                      label="Test cases derived from this charter"
                      value={
                        <Stack gap={2}>
                          {c.testCases.map((t: any) => (
                            <Link key={t.id} to={`/projects/${pid}/test-cases/${t.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                <span className="ex-key">C-{t.number}</span> {t.title}
                              </Text>
                            </Link>
                          ))}
                        </Stack>
                      }
                    />
                  )}
                </Stack>
              </Paper>
            )}

            {c.customFields && Object.keys(c.customFields).length > 0 && (
              <Paper withBorder p="md">
                <Title order={5} mb="sm">
                  Custom fields
                </Title>
                <CustomFieldsView entity="CHARTER" value={c.customFields} />
              </Paper>
            )}
          </Stack>
        </Grid.Col>
      </Grid>

      <LaunchSessionModal
        opened={launch}
        onClose={() => setLaunch(false)}
        charter={c}
        onLaunched={(s) => {
          refresh();
          qc.invalidateQueries({ queryKey: ['sessions', pid] });
          navigate(`/projects/${pid}/sessions/${s.id}`);
        }}
      />
      <FindingFormModal
        opened={newFinding}
        onClose={() => setNewFinding(false)}
        charterId={c.id}
        onSaved={(f) => {
          toastOk(`${f.key} logged`);
          refresh();
          qc.invalidateQueries({ queryKey: ['findings', pid] });
        }}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start" gap="md">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" component="div" ta="right">
        {children}
      </Text>
    </Group>
  );
}

