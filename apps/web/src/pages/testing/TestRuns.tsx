import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconClipboardList, IconPencil, IconPlayerPlay, IconPlus, IconTargetArrow } from '@tabler/icons-react';
import { api, ApiError, p } from '../../lib/api';
import { options } from '../../lib/constants';
import { fmtDate, fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, QueryState, toastError, toastOk, UserLabel } from '../../components/ui';
import { PLAN_STATUS, passRate, RUN_STATUS, RunProgressBar, SearchInput, TestCasePickList, useFolders, useUrlState, type RunProgress } from '../../components/TestingWidgets';

const PAGE_SIZE = 25;

export default function TestRuns() {
  const { can } = useProject();
  const { get, set } = useUrlState();
  const tab = get('tab') === 'plans' ? 'plans' : 'runs';
  const [newRun, setNewRun] = useState<{ planId?: string | null; milestoneId?: string | null } | null>(null);
  const [planEdit, setPlanEdit] = useState<any | null | undefined>(undefined);

  return (
    <>
      <PageHeader
        title="Test runs"
        subtitle="Execute test cases against a build or environment and group runs into plans."
        actions={
          tab === 'runs'
            ? can('TESTER') && (
                <Button leftSection={<IconPlus size={16} />} onClick={() => setNewRun({})}>
                  New run
                </Button>
              )
            : can('LEAD') && (
                <Button leftSection={<IconPlus size={16} />} onClick={() => setPlanEdit(null)}>
                  New plan
                </Button>
              )
        }
      />
      <Tabs value={tab} onChange={(v) => set({ tab: v === 'plans' ? 'plans' : null, status: null, milestone: null, plan: null, mine: null, q: null })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="runs" leftSection={<IconPlayerPlay size={16} />}>
            Runs
          </Tabs.Tab>
          <Tabs.Tab value="plans" leftSection={<IconTargetArrow size={16} />}>
            Plans
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="runs">
          <RunsTab onNew={() => setNewRun({})} />
        </Tabs.Panel>
        <Tabs.Panel value="plans">
          <PlansTab onEdit={setPlanEdit} onNewRun={(plan) => setNewRun({ planId: plan.id, milestoneId: plan.milestoneId })} />
        </Tabs.Panel>
      </Tabs>
      <NewRunModal opened={!!newRun} defaults={newRun ?? {}} onClose={() => setNewRun(null)} />
      <PlanFormModal opened={planEdit !== undefined} plan={planEdit ?? undefined} onClose={() => setPlanEdit(undefined)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function RunsTab({ onNew }: { onNew: () => void }) {
  const { pid, can, milestoneOptions } = useProject();
  const navigate = useNavigate();
  const { get, set } = useUrlState();
  const status = get('status') || 'ACTIVE';
  const page = Number(get('page')) || 1;
  const plans = useQuery({ queryKey: ['test-plans', pid, 'options'], queryFn: () => api.get(p(pid, '/test-plans'), { status: undefined }) });
  const planOptions = (plans.data?.plans ?? []).map((pl: any) => ({ value: pl.id, label: pl.name }));
  const params = { status, milestoneId: get('milestone') || undefined, planId: get('plan') || undefined, assigneeId: get('mine') ? 'me' : undefined, q: get('q') || undefined, page, pageSize: PAGE_SIZE };
  const q = useQuery({ queryKey: ['test-runs', pid, params], queryFn: () => api.get(p(pid, '/test-runs'), params), placeholderData: keepPreviousData });
  const filtered = !!(get('milestone') || get('plan') || get('mine') || get('q'));

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="wrap" align="flex-end">
        <SegmentedControl
          value={status}
          onChange={(v) => set({ status: v === 'ACTIVE' ? null : v })}
          data={[
            { value: 'ACTIVE', label: 'Open' },
            { value: 'CLOSED', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
          aria-label="Run status"
        />
        <SearchInput value={get('q')} onChange={(v) => set({ q: v })} placeholder="Search run names…" />
        <Select placeholder="Any milestone" data={milestoneOptions} value={get('milestone') || null} onChange={(v) => set({ milestone: v })} clearable searchable w={200} aria-label="Milestone" />
        <Select placeholder="Any plan" data={planOptions} value={get('plan') || null} onChange={(v) => set({ plan: v })} clearable searchable w={200} aria-label="Plan" />
        <Checkbox label="Assigned to me" checked={!!get('mine')} onChange={(e) => set({ mine: e.currentTarget.checked ? '1' : null })} mb={8} />
        {filtered && (
          <Button variant="subtle" size="xs" mb={6} onClick={() => set({ milestone: null, plan: null, mine: null, q: null })}>
            Clear filters
          </Button>
        )}
      </Group>
      <QueryState query={q}>
        {(d: any) =>
          d.runs.length === 0 ? (
            <EmptyState
              title={filtered || status !== 'ACTIVE' ? 'No runs match these filters' : 'No open test runs'}
              description={filtered ? 'Try clearing filters.' : 'Create a run to execute test cases against a build or environment.'}
              icon={<IconPlayerPlay size={26} />}
              action={
                can('TESTER') &&
                !filtered && (
                  <Button leftSection={<IconPlus size={16} />} onClick={onNew}>
                    New run
                  </Button>
                )
              }
            />
          ) : (
            <>
              <Paper withBorder>
                <Table.ScrollContainer minWidth={960}>
                  <Table highlightOnHover verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={70}>Key</Table.Th>
                        <Table.Th>Run</Table.Th>
                        <Table.Th w={90}>Status</Table.Th>
                        <Table.Th w={260}>Progress</Table.Th>
                        <Table.Th>Milestone</Table.Th>
                        <Table.Th>Environment</Table.Th>
                        <Table.Th>Created</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.runs.map((r: any) => (
                        <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${pid}/test-runs/${r.id}`)}>
                          <Table.Td>
                            <span className="ex-key">{r.key}</span>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" fw={500} component={Link} to={`/projects/${pid}/test-runs/${r.id}`} className="ex-link" onClick={(e) => e.stopPropagation()} lineClamp={1}>
                              {r.name}
                            </Text>
                            {r.plan && (
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                Plan: {r.plan.name}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Badge variant="light" color={RUN_STATUS[r.status]?.color}>
                              {RUN_STATUS[r.status]?.label ?? r.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <ProgressCell progress={r.progress} />
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{r.milestone?.name ?? '—'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{r.environment?.name ?? '—'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              <UserLabel user={r.createdBy} fallback="Unknown" />
                              <Tooltip label={fmtDateTime(r.createdAt)}>
                                <Text size="xs" c="dimmed">
                                  {fromNow(r.createdAt)}
                                  {r.closedAt ? ` · closed ${fmtDate(r.closedAt)}` : ''}
                                </Text>
                              </Tooltip>
                            </Stack>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
              {d.total > PAGE_SIZE && (
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {d.total} runs
                  </Text>
                  <Pagination value={page} onChange={(n) => set({ page: String(n) })} total={Math.ceil(d.total / PAGE_SIZE)} />
                </Group>
              )}
            </>
          )
        }
      </QueryState>
    </Stack>
  );
}

function ProgressCell({ progress, otherDone }: { progress: RunProgress | undefined; otherDone?: boolean }) {
  const rate = passRate(progress);
  return (
    <Stack gap={4}>
      <RunProgressBar progress={progress} otherDone={otherDone} />
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed">
          {progress ? `${progress.done}/${progress.total} executed` : 'No tests'}
        </Text>
        {rate !== null && (
          <Text size="xs" c={rate >= 90 ? 'teal' : rate >= 70 ? 'yellow.8' : 'red'} fw={600}>
            {rate}% pass
          </Text>
        )}
      </Group>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// New run
// ---------------------------------------------------------------------------

type Selection = 'active' | 'folders' | 'pick' | 'none';

export function NewRunModal({ opened, onClose, defaults }: { opened: boolean; onClose: () => void; defaults: { planId?: string | null; milestoneId?: string | null } }) {
  const { pid, milestoneOptions, environmentOptions, memberOptions } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { folders, folderOptions } = useFolders();
  const plans = useQuery({ queryKey: ['test-plans', pid, 'options'], queryFn: () => api.get(p(pid, '/test-plans'), { status: undefined }), enabled: opened });
  const planOptions = (plans.data?.plans ?? []).filter((pl: any) => pl.status !== 'ARCHIVED').map((pl: any) => ({ value: pl.id, label: pl.name }));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [mode, setMode] = useState<Selection>('active');
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const [withSub, setWithSub] = useState(true);
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setName('');
    setDescription('');
    setMilestoneId(defaults.milestoneId ?? null);
    setEnvironmentId(null);
    setPlanId(defaults.planId ?? null);
    setAssigneeId(null);
    setMode('active');
    setFolderIds([]);
    setCaseIds([]);
    setError(null);
  }, [opened]);

  // The server matches folders exactly, so expand sub-folders client-side.
  const effectiveFolders = useMemo(() => {
    if (!withSub) return folderIds;
    const out = new Set(folderIds);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
          out.add(f.id);
          grew = true;
        }
      }
    }
    return [...out];
  }, [folderIds, withSub, folders]);
  const folderCaseCount = folders.filter((f) => effectiveFolders.includes(f.id)).reduce((a, f) => a + f.caseCount, 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(p(pid, '/test-runs'), {
        name,
        description: description || null,
        milestoneId,
        environmentId,
        planId,
        assigneeId,
        includeAllActive: mode === 'active' || undefined,
        folderIds: mode === 'folders' ? effectiveFolders : undefined,
        testCaseIds: mode === 'pick' ? caseIds : undefined,
      });
      toastOk(`Created run ${r.run.key}`);
      qc.invalidateQueries({ queryKey: ['test-runs', pid] });
      qc.invalidateQueries({ queryKey: ['test-plans', pid] });
      onClose();
      navigate(`/projects/${pid}/test-runs/${r.run.id}`);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const invalid = !name.trim() || (mode === 'folders' && !folderIds.length) || (mode === 'pick' && !caseIds.length);

  return (
    <Modal opened={opened} onClose={onClose} title="New test run" size="lg">
      <Stack>
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Regression – release 2.4 RC1" data-autofocus />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} maxRows={6} placeholder="Build number, scope notes…" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Milestone" data={milestoneOptions} value={milestoneId} onChange={setMilestoneId} clearable searchable />
          <Select label="Environment" data={environmentOptions} value={environmentId} onChange={setEnvironmentId} clearable searchable />
          <Select label="Test plan" data={planOptions} value={planId} onChange={setPlanId} clearable searchable placeholder={planOptions.length ? 'None' : 'No plans'} />
          <Select label="Assign all tests to" data={memberOptions} value={assigneeId} onChange={setAssigneeId} clearable searchable placeholder="Unassigned" />
        </SimpleGrid>
        <div>
          <Text size="sm" fw={500} mb={6}>
            Test cases
          </Text>
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={(v) => setMode(v as Selection)}
            data={[
              { value: 'active', label: 'All active' },
              { value: 'folders', label: 'By folder' },
              { value: 'pick', label: 'Select cases' },
              { value: 'none', label: 'Empty' },
            ]}
          />
        </div>
        {mode === 'active' && (
          <Text size="sm" c="dimmed">
            Includes every non-archived test case with status Active. Drafts and deprecated cases are left out.
          </Text>
        )}
        {mode === 'folders' && (
          <Stack gap="xs">
            <MultiSelect label="Folders" data={folderOptions} value={folderIds} onChange={setFolderIds} searchable placeholder={folderOptions.length ? 'Choose folders' : 'No folders yet'} />
            <Checkbox label="Include sub-folders" checked={withSub} onChange={(e) => setWithSub(e.currentTarget.checked)} />
            {folderIds.length > 0 && (
              <Text size="xs" c="dimmed">
                About {folderCaseCount} non-archived case(s) in {effectiveFolders.length} folder(s), drafts included.
              </Text>
            )}
          </Stack>
        )}
        {mode === 'pick' && (
          <Stack gap={4}>
            <TestCasePickList value={caseIds} onChange={setCaseIds} height={280} />
            <Text size="xs" c="dimmed">
              {caseIds.length} selected
            </Text>
          </Stack>
        )}
        {mode === 'none' && (
          <Text size="sm" c="dimmed">
            Creates an empty run. You can add test cases from the run or the repository later.
          </Text>
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={invalid}>
            Create run
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function PlansTab({ onEdit, onNewRun }: { onEdit: (plan: any) => void; onNewRun: (plan: any) => void }) {
  const { pid, can, milestoneOptions } = useProject();
  const { get, set } = useUrlState();
  const status = get('status') || '';
  const q = useQuery({ queryKey: ['test-plans', pid, status], queryFn: () => api.get(p(pid, '/test-plans'), { status: status || undefined }) });
  const milestone = get('milestone');
  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end">
        <SegmentedControl
          value={status}
          onChange={(v) => set({ status: v || null })}
          data={[
            { value: '', label: 'Current' },
            ...options(PLAN_STATUS).map((o) => ({ value: o.value, label: o.label })),
          ]}
          aria-label="Plan status"
        />
        <Select placeholder="Any milestone" data={milestoneOptions} value={milestone || null} onChange={(v) => set({ milestone: v })} clearable searchable w={220} aria-label="Milestone" />
      </Group>
      <QueryState query={q}>
        {(d: any) => {
          const plans = d.plans.filter((pl: any) => !milestone || pl.milestoneId === milestone);
          if (!plans.length)
            return (
              <EmptyState
                title="No test plans"
                description="Plans group related runs (e.g. all runs for a release) and report their combined progress."
                icon={<IconTargetArrow size={26} />}
                action={
                  can('LEAD') &&
                  !milestone && (
                    <Button leftSection={<IconPlus size={16} />} onClick={() => onEdit(null)}>
                      New plan
                    </Button>
                  )
                }
              />
            );
          return (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
              {plans.map((pl: any) => (
                <PlanCard key={pl.id} plan={pl} onEdit={() => onEdit(pl)} onNewRun={() => onNewRun(pl)} />
              ))}
            </SimpleGrid>
          );
        }}
      </QueryState>
    </Stack>
  );
}

function PlanCard({ plan, onEdit, onNewRun }: { plan: any; onEdit: () => void; onNewRun: () => void }) {
  const { pid, can } = useProject();
  const open = plan.runs.filter((r: any) => r.status === 'ACTIVE').length;
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
        <div style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Text fw={600} lineClamp={1}>
              {plan.name}
            </Text>
            <Badge size="sm" variant="light" color={PLAN_STATUS[plan.status]?.color}>
              {PLAN_STATUS[plan.status]?.label ?? plan.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {plan.milestone ? `Milestone: ${plan.milestone.name}` : 'No milestone'} · {plan.runs.length} run(s), {open} open
          </Text>
        </div>
        <Group gap={4} wrap="nowrap">
          {can('TESTER') && plan.status !== 'ARCHIVED' && (
            <Tooltip label="Create a run in this plan">
              <ActionIcon variant="light" onClick={onNewRun} aria-label="Create run in plan">
                <IconPlayerPlay size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          {can('LEAD') && (
            <Tooltip label="Edit plan">
              <ActionIcon variant="default" onClick={onEdit} aria-label="Edit plan">
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {plan.description && (
        <Text size="sm" c="dimmed" lineClamp={3} className="ex-prewrap" mb="sm">
          {plan.description}
        </Text>
      )}
      <ProgressCell progress={plan.progress} otherDone />
      <Stack gap={6} mt="sm">
        {plan.runs.length === 0 ? (
          <Text size="sm" c="dimmed">
            No runs yet.
          </Text>
        ) : (
          plan.runs.map((r: any) => (
            <Group key={r.id} gap="sm" wrap="nowrap">
              <IconClipboardList size={14} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
              <Text size="sm" component={Link} to={`/projects/${pid}/test-runs/${r.id}`} className="ex-link" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
                <span className="ex-key">{r.key}</span> {r.name}
              </Text>
              <Badge size="xs" variant="light" color={RUN_STATUS[r.status]?.color}>
                {RUN_STATUS[r.status]?.label}
              </Badge>
              <div style={{ width: 90, flexShrink: 0 }}>
                <RunProgressBar progress={r.progress} size="sm" />
              </div>
            </Group>
          ))
        )}
      </Stack>
    </Card>
  );
}

function PlanFormModal({ opened, plan, onClose }: { opened: boolean; plan?: any; onClose: () => void }) {
  const { pid, milestoneOptions } = useProject();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [status, setStatus] = useState('ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setName(plan?.name ?? '');
    setDescription(plan?.description ?? '');
    setMilestoneId(plan?.milestoneId ?? null);
    setStatus(plan?.status ?? 'ACTIVE');
    setError(null);
  }, [opened, plan]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name, description: description || null, milestoneId, status };
      if (plan) await api.patch(p(pid, `/test-plans/${plan.id}`), body);
      else await api.post(p(pid, '/test-plans'), body);
      toastOk(plan ? 'Plan updated' : 'Plan created');
      qc.invalidateQueries({ queryKey: ['test-plans', pid] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={plan ? `Edit plan · ${plan.name}` : 'New test plan'}>
      <Stack>
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Release 2.4 regression" data-autofocus />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={3} maxRows={8} placeholder="Scope, entry/exit criteria…" />
        <Select label="Milestone" data={milestoneOptions} value={milestoneId} onChange={setMilestoneId} clearable searchable />
        {plan && <Select label="Status" data={options(PLAN_STATUS)} value={status} onChange={(v) => v && setStatus(v)} allowDeselect={false} />}
        <Text size="xs" c="dimmed">
          Plans group runs; the cases themselves are chosen when you create each run in the plan.
        </Text>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim()}>
            {plan ? 'Save' : 'Create plan'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
