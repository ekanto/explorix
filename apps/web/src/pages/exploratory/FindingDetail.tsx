import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  IconArrowsDiff,
  IconBug,
  IconCopy,
  IconDots,
  IconEdit,
  IconHistory,
  IconLink,
  IconLinkOff,
  IconMessage,
  IconPlus,
  IconSparkles,
  IconTestPipe,
  IconTrash,
  IconReportAnalytics,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { useAiStatus, type AiMeta } from '../../lib/ai';
import { FINDING_STATUS } from '../../lib/constants';
import { clock, fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { AiDraftBadge, AiSetupNotice } from '../../components/AiNotice';
import { Attachments } from '../../components/Attachments';
import { Comments } from '../../components/Comments';
import { CustomFieldsView } from '../../components/CustomFields';
import { FindingFormModal } from '../../components/FindingForm';
import { HistoryList } from '../../components/History';
import {
  ClassificationBadge,
  FindingStatusBadge,
  IssueStatusBadge,
  PageHeader,
  PriorityBadge,
  QueryState,
  SeverityBadge,
  TextBlock,
  toastError,
  toastOk,
  UserLabel,
} from '../../components/ui';

export default function FindingDetail() {
  const { id = '' } = useParams();
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['finding', pid, id], queryFn: () => api.get(p(pid, `/findings/${id}`)) });
  return <QueryState query={q}>{(d: any) => <FindingView finding={d.finding} history={d.history} permissions={d.permissions} />}</QueryState>;
}

type Perms = { canEdit: boolean; canTriage: boolean };

function FindingView({ finding: f, history, permissions }: { finding: any; history: any[]; permissions: Perms }) {
  const { pid, project, can, memberOptions } = useProject();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [tcOpen, setTcOpen] = useState(false);
  const isTester = can('TESTER');
  const canEdit = permissions.canEdit;

  const similar = useQuery({ queryKey: ['finding-similar', pid, f.id], queryFn: () => api.get(p(pid, `/findings/${f.id}/similar`)), enabled: f.status !== 'DUPLICATE', staleTime: 60_000 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['finding', pid, f.id] });
    qc.invalidateQueries({ queryKey: ['findings', pid] });
    qc.invalidateQueries({ queryKey: ['finding-similar', pid, f.id] });
  };

  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(p(pid, `/findings/${f.id}`), body);
      toastOk(msg);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };

  const unlinkIssue = () =>
    modals.openConfirmModal({
      title: `Unlink ${f.issue.key}?`,
      children: <Text size="sm">The issue itself is kept; only the link from this finding is removed.</Text>,
      labels: { confirm: 'Unlink', cancel: 'Cancel' },
      onConfirm: async () => {
        try {
          await api.post(p(pid, `/findings/${f.id}/link-issue`), { issueId: null });
          toastOk('Issue unlinked');
          refresh();
          qc.invalidateQueries({ queryKey: ['issues', pid] });
        } catch (e) {
          toastError(e);
        }
      },
    });

  const markDuplicate = (target: { id: string; key: string; title: string } | null) =>
    modals.openConfirmModal({
      title: target ? `Mark ${f.key} as a duplicate of ${target.key}?` : `${f.key} is not a duplicate`,
      children: (
        <Text size="sm">
          {target ? (
            <>
              {f.key} will get status <b>Duplicate</b> and point to <b>{target.key}</b> “{target.title}”. Nothing is merged — both findings, their evidence and comments stay intact.
            </>
          ) : (
            <>The duplicate link is removed and the status is reset to New.</>
          )}
        </Text>
      ),
      labels: { confirm: target ? 'Mark as duplicate' : 'Remove duplicate link', cancel: 'Cancel' },
      onConfirm: async () => {
        try {
          await api.post(p(pid, `/findings/${f.id}/mark-duplicate`), { duplicateOfId: target?.id ?? null });
          toastOk(target ? `${f.key} marked as duplicate of ${target.key}` : 'Duplicate link removed');
          setDupOpen(false);
          refresh();
        } catch (e) {
          toastError(e);
        }
      },
    });

  const statusOptions = Object.entries(FINDING_STATUS).map(([value, m]) => ({
    value,
    label: m.label,
    disabled: value !== f.status && (value === 'DUPLICATE' || value === 'CONVERTED'),
  }));
  const suggestions: any[] = (similar.data?.suggestions ?? []).filter((s: any) => s.id !== f.duplicateOf?.id);
  const sourceOfIssues: any[] = f.sourceOfIssues ?? [];

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link to={`/projects/${pid}/findings`} className="ex-link">
              Findings
            </Link>{' '}
            / {f.key}
          </>
        }
        title={f.title}
        actions={
          <>
            <Button variant="default" leftSection={<IconReportAnalytics size={16} />} component={Link} to={`/projects/${pid}/reports/new?scope=finding&id=${f.id}&kind=BUG_INVESTIGATION`}>
              Report
            </Button>
            {isTester && !f.issue && (
              <Button leftSection={<IconBug size={16} />} onClick={() => setConverting(true)}>
                Convert to issue
              </Button>
            )}
            {canEdit && (
              <Button variant="default" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {isTester && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="default" size="lg" aria-label="More finding actions">
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {canEdit &&
                    (f.issue ? (
                      <Menu.Item leftSection={<IconLinkOff size={14} />} onClick={unlinkIssue}>
                        Unlink issue {f.issue.key}
                      </Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconLink size={14} />} onClick={() => setLinking(true)}>
                        Link to existing issue
                      </Menu.Item>
                    ))}
                  {canEdit &&
                    (f.duplicateOf ? (
                      <Menu.Item leftSection={<IconArrowsDiff size={14} />} onClick={() => markDuplicate(null)}>
                        Not a duplicate
                      </Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => setDupOpen(true)}>
                        Mark as duplicate…
                      </Menu.Item>
                    ))}
                  <Menu.Item leftSection={<IconTestPipe size={14} />} onClick={() => setTcOpen(true)}>
                    Create regression test case
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </>
        }
      />
      <Group gap="xs" mt={-8} mb="md">
        <ClassificationBadge c={f.classification} />
        <SeverityBadge value={f.severity} />
        <PriorityBadge value={f.priority} />
        <FindingStatusBadge value={f.status} variant="light" />
        {f.tags.map((t: string) => (
          <Badge key={t} variant="light" color="gray">
            {t}
          </Badge>
        ))}
      </Group>

      {f.duplicateOf && (
        <Alert color="gray" variant="light" mb="md" icon={<IconCopy size={18} />}>
          Duplicate of{' '}
          <Link to={`/projects/${pid}/findings/${f.duplicateOf.id}`} className="ex-link">
            <span className="ex-key">{f.duplicateOf.key}</span> {f.duplicateOf.title}
          </Link>
        </Alert>
      )}
      {f.issue && (
        <Alert color="violet" variant="light" mb="md" icon={<IconBug size={18} />}>
          <Group gap="xs">
            <Text size="sm">Tracked as issue</Text>
            <Link to={`/projects/${pid}/issues/${f.issue.id}`} className="ex-link">
              <span className="ex-key">{f.issue.key}</span> {f.issue.title}
            </Link>
            <IssueStatusBadge value={f.issue.status} size="sm" variant="light" />
            {f.issue.externalUrl && (
              <Anchor href={f.issue.externalUrl} target="_blank" rel="noreferrer" size="sm">
                external ↗
              </Anchor>
            )}
          </Group>
        </Alert>
      )}

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Stack gap="md">
                <TextBlock label="Description" value={f.description ? <span className="ex-prewrap">{f.description}</span> : null} />
                <TextBlock label="Preconditions" value={f.preconditions ? <span className="ex-prewrap">{f.preconditions}</span> : null} />
                <div className="ex-field-pair">
                  <TextBlock label="Actual behavior" value={f.actual ? <span className="ex-prewrap">{f.actual}</span> : null} />
                  <TextBlock label="Expected behavior" value={f.expected ? <span className="ex-prewrap">{f.expected}</span> : null} />
                </div>
                <TextBlock label="Steps to reproduce" value={f.reproSteps ? <span className="ex-prewrap">{f.reproSteps}</span> : null} />
                <div className="ex-field-pair">
                  <TextBlock label="Environment" value={f.environment ? <span className="ex-prewrap">{f.environment}</span> : null} />
                  <TextBlock label="Browser / client" value={f.browser ? <span className="ex-prewrap">{f.browser}</span> : null} />
                </div>
                <TextBlock label="Follow-up actions" value={f.followUp ? <span className="ex-prewrap">{f.followUp}</span> : null} />
                <TextBlock label="Resolution" value={f.resolution ? <span className="ex-prewrap">{f.resolution}</span> : null} />
                {!f.description && !f.actual && !f.expected && !f.reproSteps && !f.environment && !f.preconditions && !f.browser && (
                  <Text size="sm" c="dimmed">
                    No details recorded yet.{canEdit ? ' Use Edit to add actual/expected behavior and repro steps.' : ''}
                  </Text>
                )}
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Evidence
              </Title>
              <Attachments targetType="finding" targetId={f.id} items={f.attachments ?? []} canUpload={isTester} onChange={refresh} pasteToAttach={!editing && !converting} />
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
                  <Comments targetType="finding" targetId={f.id} />
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
                Triage
              </Title>
              <Stack gap="sm">
                <Select
                  label="Status"
                  data={statusOptions}
                  value={f.status}
                  onChange={(v) => v && v !== f.status && patch({ status: v }, `Status set to ${FINDING_STATUS[v]?.label ?? v}`)}
                  disabled={!canEdit}
                  allowDeselect={false}
                  description={!canEdit ? 'Only the author, owner or a lead can change this finding.' : undefined}
                />
                <Select
                  label="Owner"
                  placeholder="No owner"
                  data={memberOptions}
                  value={f.ownerId ?? null}
                  onChange={(v) => patch({ ownerId: v }, v ? 'Owner updated' : 'Owner cleared')}
                  disabled={!canEdit}
                  searchable
                  clearable
                />
              </Stack>
            </Paper>

            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Context
              </Title>
              <Stack gap="xs">
                <Row label="Reported by">
                  <UserLabel user={f.author} fallback="Unknown" />
                </Row>
                <Row label="Session">
                  {f.session ? (
                    <Link to={`/projects/${pid}/sessions/${f.session.id}`} className="ex-link">
                      <span className="ex-key">{f.session.key}</span>
                      {f.sessionElapsedSeconds != null && (
                        <Tooltip label="Time into the session when this was logged">
                          <Text span size="xs" c="dimmed" ml={6}>
                            @ {clock(f.sessionElapsedSeconds)}
                          </Text>
                        </Tooltip>
                      )}
                    </Link>
                  ) : (
                    'Logged outside a session'
                  )}
                </Row>
                <Row label="Charter">
                  {f.charter ? (
                    <Tooltip label={f.charter.title}>
                      <Link to={`/projects/${pid}/charters/${f.charter.id}`} className="ex-link ex-key">
                        {f.charter.key}
                      </Link>
                    </Tooltip>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Requirement">
                  {f.requirement ? (
                    <Tooltip label={f.requirement.title}>
                      <Link to={`/projects/${pid}/requirements/${f.requirement.id}`} className="ex-link ex-key">
                        {f.requirement.key}
                      </Link>
                    </Tooltip>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Created">
                  <Tooltip label={fmtDateTime(f.createdAt)}>
                    <span>{fromNow(f.createdAt)}</span>
                  </Tooltip>
                </Row>
                <Row label="Updated">
                  <Tooltip label={fmtDateTime(f.updatedAt)}>
                    <span>{fromNow(f.updatedAt)}</span>
                  </Tooltip>
                </Row>
              </Stack>
            </Paper>

            {(f.duplicates.length > 0 || f.testCases.length > 0 || sourceOfIssues.length > 0) && (
              <Paper withBorder p="md">
                <Title order={5} mb="sm">
                  Linked work
                </Title>
                <Stack gap="sm">
                  {sourceOfIssues.length > 0 && (
                    <TextBlock
                      label="Issues created from this finding"
                      value={
                        <Stack gap={2}>
                          {sourceOfIssues.map((i) => (
                            <Link key={i.id} to={`/projects/${pid}/issues/${i.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                <span className="ex-key">
                                  {project.key}-{i.number}
                                </span>{' '}
                                {i.title}
                              </Text>
                            </Link>
                          ))}
                        </Stack>
                      }
                    />
                  )}
                  {f.testCases.length > 0 && (
                    <TextBlock
                      label="Regression test cases"
                      value={
                        <Stack gap={2}>
                          {f.testCases.map((t: any) => (
                            <Link key={t.id} to={`/projects/${pid}/test-cases/${t.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                <span className="ex-key">{t.key}</span> {t.title}
                              </Text>
                            </Link>
                          ))}
                        </Stack>
                      }
                    />
                  )}
                  {f.duplicates.length > 0 && (
                    <TextBlock
                      label="Marked as duplicates of this"
                      value={
                        <Stack gap={2}>
                          {f.duplicates.map((d: any) => (
                            <Link key={d.id} to={`/projects/${pid}/findings/${d.id}`} className="ex-link">
                              <Text size="sm" lineClamp={1}>
                                <span className="ex-key">{d.key}</span> {d.title}
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

            {f.status !== 'DUPLICATE' && (
              <Paper withBorder p="md">
                <Title order={5} mb={2}>
                  Possibly similar
                </Title>
                <Text size="xs" c="dimmed" mb="sm">
                  Text-similarity suggestions — nothing is merged automatically.
                </Text>
                {similar.isLoading ? (
                  <Loader size="sm" />
                ) : suggestions.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No similar findings found.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {suggestions.map((s) => (
                      <Group key={s.id} justify="space-between" wrap="nowrap" align="flex-start">
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/projects/${pid}/findings/${s.id}`} className="ex-link">
                            <Text size="sm" lineClamp={2}>
                              <span className="ex-key">{s.key}</span> {s.title}
                            </Text>
                          </Link>
                          <Group gap={4} mt={2}>
                            <FindingStatusBadge value={s.status} size="xs" variant="light" />
                            <Text size="xs" c="dimmed">
                              {Math.round(s.score * 100)}% match
                            </Text>
                          </Group>
                        </div>
                        {canEdit && (
                          <Tooltip label={`Mark ${f.key} as duplicate of ${s.key}`}>
                            <ActionIcon variant="subtle" color="gray" onClick={() => markDuplicate(s)} aria-label={`Mark as duplicate of ${s.key}`}>
                              <IconCopy size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    ))}
                  </Stack>
                )}
              </Paper>
            )}

            {f.customFields && Object.keys(f.customFields).length > 0 && (
              <Paper withBorder p="md">
                <Title order={5} mb="sm">
                  Custom fields
                </Title>
                <CustomFieldsView entity="FINDING" value={f.customFields} />
              </Paper>
            )}
          </Stack>
        </Grid.Col>
      </Grid>

      <FindingFormModal
        opened={editing}
        onClose={() => setEditing(false)}
        finding={f}
        onSaved={() => {
          toastOk(`${f.key} updated`);
          refresh();
        }}
      />
      <ConvertModal
        opened={converting}
        onClose={() => setConverting(false)}
        finding={f}
        onDone={(issue) => {
          refresh();
          qc.invalidateQueries({ queryKey: ['issues', pid] });
          navigate(`/projects/${pid}/issues/${issue.id}`);
        }}
      />
      <LinkIssueModal
        opened={linking}
        onClose={() => setLinking(false)}
        finding={f}
        onDone={() => {
          refresh();
          qc.invalidateQueries({ queryKey: ['issues', pid] });
        }}
      />
      <DuplicatePicker opened={dupOpen} onClose={() => setDupOpen(false)} finding={f} suggestions={suggestions} onPick={markDuplicate} />
      <TestCaseModal
        opened={tcOpen}
        onClose={() => setTcOpen(false)}
        finding={f}
        onDone={(tc) => {
          refresh();
          qc.invalidateQueries({ queryKey: ['test-cases', pid] });
          toastOk(`Created ${tc.key}`);
          navigate(`/projects/${pid}/test-cases/${tc.id}`);
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

function ConvertModal({ opened, onClose, finding: f, onDone }: { opened: boolean; onClose: () => void; finding: any; onDone: (issue: any) => void }) {
  const { pid, memberOptions, milestoneOptions } = useProject();
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [confirmDefect, setConfirmDefect] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title: title.trim() || undefined, assigneeId, confirmDefect: confirmDefect || undefined };
      if (milestoneId) body.milestoneId = milestoneId;
      const r = await api.post(p(pid, `/findings/${f.id}/convert-to-issue`), body);
      toastOk(`Created issue ${r.issue.key} from ${f.key}`);
      onClose();
      onDone(r.issue);
    } catch (e) {
      toastError(e, 'Could not convert finding');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Convert ${f.key} to an issue`} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          Creates an internal issue with the description, repro steps, expected/actual and environment copied from this finding. The finding is kept, linked to the issue and marked “Converted”.
        </Text>
        <TextInput label="Issue title" placeholder={f.title} value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={300} data-autofocus />
        <Group grow>
          <Select label="Assignee" placeholder="Unassigned" data={memberOptions} value={assigneeId} onChange={setAssigneeId} searchable clearable />
          <Select label="Milestone" placeholder={f.session ? "Session's milestone" : 'None'} data={milestoneOptions} value={milestoneId} onChange={setMilestoneId} clearable />
        </Group>
        {!f.classification?.isDefect && (
          <Checkbox
            label="Confirm as defect"
            description={`Reclassify this ${f.classification?.name?.toLowerCase() ?? 'finding'} as the project's first defect type.`}
            checked={confirmDefect}
            onChange={(e) => setConfirmDefect(e.currentTarget.checked)}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} leftSection={<IconBug size={16} />}>
            Create issue
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function LinkIssueModal({ opened, onClose, finding: f, onDone }: { opened: boolean; onClose: () => void; finding: any; onDone: () => void }) {
  const { pid } = useProject();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const issues = useQuery({ queryKey: ['issues', pid, 'pick', debounced], queryFn: () => api.get(p(pid, '/issues'), { q: debounced || undefined, pageSize: 30 }), enabled: opened });
  const data = (issues.data?.issues ?? []).map((i: any) => ({ value: i.id, label: `${i.key} · ${i.title}` }));

  const submit = async () => {
    if (!issueId) return;
    setBusy(true);
    try {
      await api.post(p(pid, `/findings/${f.id}/link-issue`), { issueId });
      toastOk('Issue linked');
      onClose();
      setIssueId(null);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Link ${f.key} to an existing issue`}>
      <Stack>
        <Select
          label="Issue"
          placeholder="Search by key or title"
          data={data}
          value={issueId}
          onChange={setIssueId}
          searchable
          searchValue={search}
          onSearchChange={setSearch}
          filter={({ options }) => options}
          nothingFoundMessage={issues.isFetching ? 'Searching…' : 'No issues found'}
          rightSection={issues.isFetching ? <Loader size="xs" /> : undefined}
          data-autofocus
        />
        <Text size="xs" c="dimmed">
          New findings move to “Triaged” when linked. The issue's description is not changed.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!issueId} leftSection={<IconLink size={16} />}>
            Link issue
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DuplicatePicker({ opened, onClose, finding: f, suggestions, onPick }: { opened: boolean; onClose: () => void; finding: any; suggestions: any[]; onPick: (t: any) => void }) {
  const { pid } = useProject();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [targetId, setTargetId] = useState<string | null>(null);
  const results = useQuery({ queryKey: ['findings', pid, 'pick', debounced], queryFn: () => api.get(p(pid, '/findings'), { q: debounced || undefined, pageSize: 30 }), enabled: opened });
  const pool: any[] = [...suggestions, ...(results.data?.findings ?? [])].filter((x, i, a) => x.id !== f.id && a.findIndex((y) => y.id === x.id) === i);
  const target = pool.find((x) => x.id === targetId);

  return (
    <Modal opened={opened} onClose={onClose} title={`Mark ${f.key} as a duplicate`} size="lg">
      <Stack>
        {suggestions.length > 0 && (
          <div>
            <Text size="sm" fw={500} mb={4}>
              Suggested (text similarity)
            </Text>
            <Stack gap={4}>
              {suggestions.map((s) => (
                <Paper
                  key={s.id}
                  withBorder
                  p="xs"
                  style={{ cursor: 'pointer', borderColor: targetId === s.id ? 'var(--mantine-color-explorix-filled)' : undefined }}
                  onClick={() => setTargetId(s.id)}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" lineClamp={1}>
                      <span className="ex-key">{s.key}</span> {s.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {Math.round(s.score * 100)}%
                    </Text>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </div>
        )}
        <Select
          label="Original finding"
          placeholder="Search by key or title"
          data={pool.map((x) => ({ value: x.id, label: `${x.key} · ${x.title}` }))}
          value={targetId}
          onChange={setTargetId}
          searchable
          searchValue={search}
          onSearchChange={setSearch}
          filter={({ options }) => options}
          nothingFoundMessage={results.isFetching ? 'Searching…' : 'No findings found'}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!target} onClick={() => target && onPick(target)} leftSection={<IconCopy size={16} />}>
            Continue
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type Step = { action: string; expected: string };

function parseSteps(f: any): Step[] {
  const lines = (f.reproSteps ?? '')
    .split(/\r?\n/)
    .map((l: string) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
  if (!lines.length) return [{ action: f.title, expected: f.expected ?? '' }];
  return lines.map((action: string, i: number) => ({ action, expected: i === lines.length - 1 ? (f.expected ?? '') : '' }));
}

function TestCaseModal({ opened, onClose, finding: f, onDone }: { opened: boolean; onClose: () => void; finding: any; onDone: (tc: any) => void }) {
  const { pid } = useProject();
  const ai = useAiStatus();
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState<{ testCases: any[]; meta: AiMeta } | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  const folders = useQuery({ queryKey: ['test-folders', pid], queryFn: () => api.get(p(pid, '/test-folders')), enabled: opened });

  if (opened !== lastOpen) {
    setLastOpen(opened);
    if (opened) {
      setTitle(`Regression: ${f.title}`.slice(0, 300));
      setSteps(parseSteps(f));
      setAiDraft(null);
    }
  }

  const folderData = (folders.data?.folders ?? []).map((x: any) => ({ value: x.id, label: x.name }));
  const setStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const suggest = async () => {
    setAiBusy(true);
    try {
      const r = await api.post(p(pid, `/ai/findings/${f.id}/test-cases`));
      const list = Array.isArray(r.draft?.testCases) ? r.draft.testCases : [];
      if (!list.length) toastOk('The assistant returned no suggestions');
      setAiDraft({ testCases: list, meta: r.meta });
    } catch (e) {
      toastError(e, 'AI suggestion failed');
    } finally {
      setAiBusy(false);
    }
  };

  const applySuggestion = (tc: any) => {
    if (tc.title) setTitle(String(tc.title).slice(0, 300));
    const s = (Array.isArray(tc.steps) ? tc.steps : []).filter((x: any) => x?.action).map((x: any) => ({ action: String(x.action), expected: x.expected ? String(x.expected) : '' }));
    if (s.length) setSteps(s);
  };

  const valid = steps.filter((s) => s.action.trim());
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(p(pid, `/findings/${f.id}/create-test-case`), {
        title: title.trim() || undefined,
        folderId,
        steps: valid.length ? valid.map((s) => ({ action: s.action.trim(), expected: s.expected.trim() || null })) : undefined,
      });
      onClose();
      onDone(r.testCase);
    } catch (e) {
      toastError(e, 'Could not create test case');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Regression test case from ${f.key}`} size="xl">
      <Stack>
        <Text size="sm" c="dimmed">
          Turns this finding into a reusable scripted test (type “Regression”) linked back to {f.key}
          {f.charter ? ` and ${f.charter.key}` : ''}. Steps are prefilled from the repro steps — review them before saving.
        </Text>
        <Group grow align="flex-start">
          <TextInput label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={300} required />
          <Select label="Folder" placeholder="Unfiled" data={folderData} value={folderId} onChange={setFolderId} clearable searchable />
        </Group>
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>
              Steps
            </Text>
            <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => setSteps((s) => [...s, { action: '', expected: '' }])} disabled={steps.length >= 100}>
              Add step
            </Button>
          </Group>
          <Stack gap="xs">
            {steps.map((s, i) => (
              <Group key={i} align="flex-start" wrap="nowrap" gap="xs">
                <Text size="sm" c="dimmed" w={20} pt={8} ta="right">
                  {i + 1}.
                </Text>
                <Textarea placeholder="Action" autosize minRows={1} value={s.action} onChange={(e) => setStep(i, { action: e.currentTarget.value })} style={{ flex: 1 }} aria-label={`Step ${i + 1} action`} />
                <Textarea placeholder="Expected result" autosize minRows={1} value={s.expected} onChange={(e) => setStep(i, { expected: e.currentTarget.value })} style={{ flex: 1 }} aria-label={`Step ${i + 1} expected`} />
                <ActionIcon variant="subtle" color="gray" mt={6} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </div>

        <Paper withBorder p="sm" bg="var(--mantine-color-default-hover)">
          <Group justify="space-between" mb={aiDraft ? 'xs' : 0}>
            <Group gap={6}>
              <IconSparkles size={16} />
              <Text size="sm" fw={500}>
                AI suggestions
              </Text>
              {aiDraft && <AiDraftBadge meta={aiDraft.meta} />}
            </Group>
            {ai.data?.enabled && (
              <Button size="compact-sm" variant="light" onClick={suggest} loading={aiBusy}>
                {aiDraft ? 'Regenerate' : 'Suggest test cases'}
              </Button>
            )}
          </Group>
          {!ai.data?.enabled && <AiSetupNotice status={ai.data} />}
          {aiDraft && (
            <Stack gap="xs">
              {aiDraft.testCases.map((tc, i) => (
                <Paper key={i} withBorder p="xs">
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600}>
                        {tc.title}
                      </Text>
                      {tc.preconditions && (
                        <Text size="xs" c="dimmed">
                          Preconditions: {tc.preconditions}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {(tc.steps ?? []).length} step(s)
                      </Text>
                    </div>
                    <Button size="compact-xs" variant="default" onClick={() => applySuggestion(tc)}>
                      Use this
                    </Button>
                  </Group>
                </Paper>
              ))}
              <Text size="xs" c="dimmed">
                “Use this” replaces the title and steps above for you to review; nothing is saved until you click Create. AI preconditions aren't stored (the server derives preconditions from the finding's environment).
              </Text>
            </Stack>
          )}
        </Paper>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim()} leftSection={<IconTestPipe size={16} />}>
            Create test case
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
