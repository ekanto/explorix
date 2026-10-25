import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Badge, Button, Grid, Group, Menu, Paper, Select, Stack, Table, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconBrandGithub, IconCheck, IconChevronDown, IconEdit, IconExternalLink, IconHistory, IconMessage, IconPlayerPlay, IconRotate, IconX } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ISSUE_STATUS, options, PRIORITY, SEVERITY } from '../../lib/constants';
import { fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { Attachments } from '../../components/Attachments';
import { Comments } from '../../components/Comments';
import { CustomFieldsView } from '../../components/CustomFields';
import { HistoryList } from '../../components/History';
import { IssueFormModal } from '../../components/IssueForm';
import {
  ClassificationBadge,
  FindingStatusBadge,
  IssueStatusBadge,
  PageHeader,
  PriorityBadge,
  QueryState,
  ResultBadge,
  SeverityBadge,
  StatusPill,
  TextBlock,
  toastError,
  toastOk,
  UserLabel,
} from '../../components/ui';

export default function IssueDetail() {
  const { id = '' } = useParams();
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['issue', pid, id], queryFn: () => api.get(p(pid, `/issues/${id}`)) });
  return <QueryState query={q}>{(d: any) => <IssueView issue={d.issue} history={d.history} pushTargets={d.pushTargets ?? []} canEdit={!!d.permissions?.canEdit} />}</QueryState>;
}

type Transition = { to: string; label: string; icon: React.ReactNode; closing?: boolean };

const TRANSITIONS: Record<string, Transition[]> = {
  OPEN: [
    { to: 'IN_PROGRESS', label: 'Start progress', icon: <IconPlayerPlay size={14} /> },
    { to: 'RESOLVED', label: 'Resolve', icon: <IconCheck size={14} /> },
    { to: 'WONT_FIX', label: "Won't fix", icon: <IconX size={14} />, closing: true },
    { to: 'CLOSED', label: 'Close', icon: <IconX size={14} />, closing: true },
  ],
  IN_PROGRESS: [
    { to: 'RESOLVED', label: 'Resolve', icon: <IconCheck size={14} /> },
    { to: 'OPEN', label: 'Back to open', icon: <IconRotate size={14} /> },
    { to: 'WONT_FIX', label: "Won't fix", icon: <IconX size={14} />, closing: true },
  ],
  RESOLVED: [
    { to: 'CLOSED', label: 'Close', icon: <IconCheck size={14} />, closing: true },
    { to: 'OPEN', label: 'Reopen', icon: <IconRotate size={14} /> },
  ],
  CLOSED: [{ to: 'OPEN', label: 'Reopen', icon: <IconRotate size={14} /> }],
  WONT_FIX: [{ to: 'OPEN', label: 'Reopen', icon: <IconRotate size={14} /> }],
};

function IssueView({ issue: i, history, pushTargets, canEdit }: { issue: any; history: any[]; pushTargets: { id: string; name: string }[]; canEdit: boolean }) {
  const { pid, can, memberOptions, milestoneOptions } = useProject();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const canClose = can('LEAD') || i.reporterId === user?.id || i.assigneeId === user?.id;
  const transitions = (TRANSITIONS[i.status] ?? []).filter((t) => !t.closing || canClose);
  const [primary, ...more] = transitions;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['issue', pid, i.id] });
    qc.invalidateQueries({ queryKey: ['issues', pid] });
    qc.invalidateQueries({ queryKey: ['findings', pid] });
  };

  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(p(pid, `/issues/${i.id}`), body);
      toastOk(msg);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const transition = (t: Transition) => {
    const linkedOpen = i.findings.filter((f: any) => ['NEW', 'TRIAGED', 'CONVERTED'].includes(f.status)).length;
    const run = () => patch({ status: t.to }, `${i.key} is now ${ISSUE_STATUS[t.to].label.toLowerCase()}`);
    if ((t.to === 'RESOLVED' || t.to === 'CLOSED') && linkedOpen > 0) {
      modals.openConfirmModal({
        title: `${t.label} ${i.key}?`,
        children: <Text size="sm">{linkedOpen} linked finding(s) that are still open will be marked Resolved as well. Their history is kept.</Text>,
        labels: { confirm: t.label, cancel: 'Cancel' },
        onConfirm: run,
      });
    } else run();
  };

  const push = async (target: { id: string; name: string }) => {
    setPushing(true);
    try {
      const r = await api.post(p(pid, `/integrations/${target.id}/push-issue`), { issueId: i.id });
      toastOk(`Created ${r.issue.externalKey} on GitHub`);
      refresh();
    } catch (e) {
      toastError(e, 'GitHub push failed');
    } finally {
      setPushing(false);
    }
  };

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link to={`/projects/${pid}/issues`} className="ex-link">
              Issues
            </Link>{' '}
            / {i.key}
          </>
        }
        title={i.title}
        actions={
          canEdit && (
            <>
              {primary && (
                <Group gap={0} wrap="nowrap">
                  <Button leftSection={primary.icon} onClick={() => transition(primary)} style={more.length ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}>
                    {primary.label}
                  </Button>
                  {more.length > 0 && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button px={8} aria-label="More status changes" style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid var(--mantine-color-body)' }}>
                          <IconChevronDown size={16} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {more.map((t) => (
                          <Menu.Item key={t.to} leftSection={t.icon} onClick={() => transition(t)}>
                            {t.label}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              )}
              <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            </>
          )
        }
      />
      <Group gap="xs" mt={-8} mb="lg">
        <IssueStatusBadge value={i.status} />
        <SeverityBadge value={i.severity} />
        <PriorityBadge value={i.priority} />
        {i.milestone && (
          <Badge variant="outline" color="gray">
            {i.milestone.name}
          </Badge>
        )}
        {!canClose && canEdit && ['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(i.status) && (
          <Text size="xs" c="dimmed">
            Only leads, the reporter or the assignee can close this issue.
          </Text>
        )}
      </Group>

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <TextBlock label="Description" value={i.description ? <span className="ex-prewrap">{i.description}</span> : null} />
              {!i.description && (
                <Text size="sm" c="dimmed">
                  No description.
                </Text>
              )}
            </Paper>

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Linked findings ({i.findings.length})
              </Title>
              {i.findings.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No findings linked. Link findings from a finding's page (“Link to existing issue”).
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={560}>
                  <Table>
                    <Table.Tbody>
                      {i.findings.map((f: any) => (
                        <Table.Tr key={f.id}>
                          <Table.Td>
                            <Link to={`/projects/${pid}/findings/${f.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                <span className="ex-key">{f.key}</span> {f.title}
                              </Text>
                            </Link>
                            {f.id === i.sourceFinding?.id && (
                              <Text size="xs" c="dimmed">
                                Source finding
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <ClassificationBadge c={f.classification} size="sm" />
                          </Table.Td>
                          <Table.Td>
                            <SeverityBadge value={f.severity} size="sm" />
                          </Table.Td>
                          <Table.Td>
                            <FindingStatusBadge value={f.status} size="sm" variant="light" />
                          </Table.Td>
                          <Table.Td>
                            {f.sessionId ? (
                              <Anchor component={Link} to={`/projects/${pid}/sessions/${f.sessionId}`} size="xs">
                                Session
                              </Anchor>
                            ) : null}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Paper>

            {(i.testResults.length > 0 || i.automationResults.length > 0) && (
              <Paper withBorder p="md">
                <Title order={5} mb="sm">
                  Linked test results
                </Title>
                <Table.ScrollContainer minWidth={560}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Test</Table.Th>
                        <Table.Th>Run</Table.Th>
                        <Table.Th>Result</Table.Th>
                        <Table.Th>When</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {i.testResults.map((r: any) => (
                        <Table.Tr key={r.id}>
                          <Table.Td>
                            {r.runItem?.testCase ? (
                              <Link to={`/projects/${pid}/test-cases/${r.runItem.testCase.id}`} className="ex-link">
                                <Text size="sm" lineClamp={1}>
                                  <span className="ex-key">C-{r.runItem.testCase.number}</span> {r.runItem.testCase.title}
                                </Text>
                              </Link>
                            ) : (
                              '—'
                            )}
                          </Table.Td>
                          <Table.Td>
                            {r.runItem?.runId ? (
                              <Anchor component={Link} to={`/projects/${pid}/test-runs/${r.runItem.runId}`} size="sm">
                                Manual run
                              </Anchor>
                            ) : (
                              '—'
                            )}
                          </Table.Td>
                          <Table.Td>
                            <StatusPill status={r.status} />
                          </Table.Td>
                          <Table.Td className="ex-nowrap">
                            <Text size="sm" c="dimmed">
                              {fromNow(r.createdAt)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {i.automationResults.map((r: any) => (
                        <Table.Tr key={r.id}>
                          <Table.Td>
                            <Link to={`/projects/${pid}/automation/tests/${r.test.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                {r.test.name}
                              </Text>
                            </Link>
                          </Table.Td>
                          <Table.Td>
                            <Anchor component={Link} to={`/projects/${pid}/automation/runs/${r.run.id}`} size="sm">
                              Automation run #{r.run.number}
                            </Anchor>
                          </Table.Td>
                          <Table.Td>
                            <ResultBadge value={r.category} variant="light" />
                          </Table.Td>
                          <Table.Td className="ex-nowrap">
                            <Text size="sm" c="dimmed">
                              {fromNow(r.createdAt)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                {(i._count.testResults > i.testResults.length || i._count.automationResults > i.automationResults.length) && (
                  <Text size="xs" c="dimmed" mt="xs">
                    Showing the 20 most recent of each kind.
                  </Text>
                )}
              </Paper>
            )}

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Attachments
              </Title>
              <Attachments targetType="issue" targetId={i.id} items={i.attachments ?? []} canUpload={can('TESTER')} onChange={refresh} />
            </Paper>

            <Paper withBorder p={0}>
              <Tabs defaultValue="comments" keepMounted={false}>
                <Tabs.List px="sm">
                  <Tabs.Tab value="comments" leftSection={<IconMessage size={14} />}>
                    Comments
                  </Tabs.Tab>
                  <Tabs.Tab value="history" leftSection={<IconHistory size={14} />}>
                    History ({history.length})
                  </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="comments" p="md">
                  <Comments targetType="issue" targetId={i.id} />
                </Tabs.Panel>
                <Tabs.Panel value="history" p="md">
                  <HistoryList events={history} />
                </Tabs.Panel>
              </Tabs>
            </Paper>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Fields
              </Title>
              <Stack gap="sm">
                <Select
                  label="Assignee"
                  placeholder="Unassigned"
                  data={memberOptions}
                  value={i.assigneeId ?? null}
                  onChange={(v) => patch({ assigneeId: v }, v ? 'Assignee updated' : 'Assignee cleared')}
                  disabled={!canEdit}
                  searchable
                  clearable
                />
                <Group grow>
                  <Select label="Severity" data={options(SEVERITY)} value={i.severity} onChange={(v) => v && patch({ severity: v }, 'Severity updated')} disabled={!canEdit} allowDeselect={false} />
                  <Select label="Priority" data={options(PRIORITY)} value={i.priority} onChange={(v) => v && patch({ priority: v }, 'Priority updated')} disabled={!canEdit} allowDeselect={false} />
                </Group>
                <Select label="Milestone" placeholder="None" data={milestoneOptions} value={i.milestoneId ?? null} onChange={(v) => patch({ milestoneId: v }, 'Milestone updated')} disabled={!canEdit} clearable />
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Details
              </Title>
              <Stack gap="xs">
                <Row label="Reporter">
                  <UserLabel user={i.reporter} fallback="Unknown" />
                </Row>
                <Row label="Source">
                  {i.sourceFinding ? (
                    <Tooltip label={i.sourceFinding.title}>
                      <Link to={`/projects/${pid}/findings/${i.sourceFinding.id}`} className="ex-link ex-key">
                        {i.sourceFinding.key}
                      </Link>
                    </Tooltip>
                  ) : (
                    'Created manually'
                  )}
                </Row>
                <Row label="Created">
                  <Tooltip label={fmtDateTime(i.createdAt)}>
                    <span>{fromNow(i.createdAt)}</span>
                  </Tooltip>
                </Row>
                <Row label="Updated">
                  <Tooltip label={fmtDateTime(i.updatedAt)}>
                    <span>{fromNow(i.updatedAt)}</span>
                  </Tooltip>
                </Row>
                {i.resolvedAt && (
                  <Row label="Resolved">
                    <Tooltip label={fmtDateTime(i.resolvedAt)}>
                      <span>{fromNow(i.resolvedAt)}</span>
                    </Tooltip>
                  </Row>
                )}
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                External tracker
              </Title>
              {i.externalUrl ? (
                <Anchor href={i.externalUrl} target="_blank" rel="noreferrer" size="sm">
                  <Group gap={4} wrap="nowrap">
                    {i.externalProvider === 'GITHUB' ? <IconBrandGithub size={16} /> : <IconExternalLink size={16} />}
                    <Text size="sm" lineClamp={1} span>
                      {i.externalKey ?? i.externalUrl}
                    </Text>
                  </Group>
                </Anchor>
              ) : (
                <Text size="sm" c="dimmed">
                  Not linked to an external tracker.
                </Text>
              )}
              {!i.externalKey && can('TESTER') && pushTargets.length > 0 && (
                <Stack gap={4} mt="sm">
                  {pushTargets.map((t) => (
                    <Button key={t.id} size="xs" variant="default" leftSection={<IconBrandGithub size={14} />} loading={pushing} onClick={() => push(t)}>
                      Push to GitHub ({t.name})
                    </Button>
                  ))}
                </Stack>
              )}
              <Text size="xs" c="dimmed" mt="sm">
                {pushTargets.length === 0 ? 'GitHub push needs an enabled GitHub integration (Project settings → Integrations). ' : ''}Jira / GitLab sync: planned.
              </Text>
            </Paper>

            {i.customFields && Object.keys(i.customFields).length > 0 && (
              <Paper withBorder p="md">
                <Title order={5} mb="sm">
                  Custom fields
                </Title>
                <CustomFieldsView entity="ISSUE" value={i.customFields} />
              </Paper>
            )}
          </Stack>
        </Grid.Col>
      </Grid>

      <IssueFormModal
        opened={editing}
        onClose={() => setEditing(false)}
        issue={i}
        onSaved={() => {
          toastOk(`${i.key} updated`);
          refresh();
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
