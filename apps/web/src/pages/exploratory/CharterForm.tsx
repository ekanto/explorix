import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Grid,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconBulb, IconChecklist, IconInfoCircle, IconLock, IconPlus, IconSparkles, IconTemplate, IconWand } from '@tabler/icons-react';
import { api, ApiError, errorMessage, p } from '../../lib/api';
import { useAiStatus, type AiMeta } from '../../lib/ai';
import { options, PRIORITY, RISK } from '../../lib/constants';
import { useProject } from '../../lib/project';
import { AiDraftBadge, AiSetupNotice } from '../../components/AiNotice';
import { CustomFieldsInput } from '../../components/CustomFields';
import { ListEditor } from '../../components/ListEditor';
import { EmptyState, ErrorState, Loading, PageHeader, toastError, toastOk } from '../../components/ui';

type V = {
  title: string;
  mission: string;
  target: string;
  scope: string;
  outOfScope: string;
  objectives: string;
  learningGoals: string;
  risks: string[];
  assumptions: string;
  testIdeas: string[];
  heuristics: string[];
  prerequisites: string;
  testData: string;
  environmentId: string | null;
  browser: string;
  os: string;
  device: string;
  environmentNotes: string;
  estimatedMinutes: number | null;
  timeboxMinutes: number;
  assigneeIds: string[];
  priority: string;
  riskLevel: string;
  milestoneId: string | null;
  tags: string[];
  exitCriteria: string;
  customFields: Record<string, unknown>;
  templateId: string | null;
  requirementIds: string[];
};

const TEXT_KEYS = ['target', 'scope', 'outOfScope', 'objectives', 'learningGoals', 'assumptions', 'prerequisites', 'testData', 'exitCriteria', 'environmentNotes', 'browser', 'os', 'device'] as const;

const SECTIONS: { value: string; label: string; fields: string[] }[] = [
  { value: 'scope', label: 'Target & scope', fields: ['target', 'scope', 'outOfScope'] },
  { value: 'objectives', label: 'Objectives, learning goals & exit criteria', fields: ['objectives', 'learningGoals', 'exitCriteria'] },
  { value: 'risks', label: 'Target risks & assumptions', fields: ['risks', 'assumptions'] },
  { value: 'ideas', label: 'Test ideas & heuristics', fields: ['testIdeas', 'heuristics'] },
  { value: 'setup', label: 'Prerequisites & test data', fields: ['prerequisites', 'testData'] },
  { value: 'environment', label: 'Environment', fields: ['environmentId', 'browser', 'os', 'device', 'environmentNotes'] },
  { value: 'custom', label: 'Custom fields', fields: ['customFields'] },
];

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  mission: 'Mission',
  target: 'Target',
  scope: 'Scope',
  outOfScope: 'Out of scope',
  objectives: 'Objectives',
  risks: 'Risks',
  exitCriteria: 'Exit criteria',
  timeboxMinutes: 'Timebox',
  testIdeas: 'Test ideas',
};

const splitLines = (s: string | null | undefined) =>
  (s ?? '')
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
const uniq = (a: string[]) => Array.from(new Set(a.map((x) => x.trim()).filter(Boolean)));

function fromCharter(c: any): V {
  return {
    title: c.title ?? '',
    mission: c.mission ?? '',
    target: c.target ?? '',
    scope: c.scope ?? '',
    outOfScope: c.outOfScope ?? '',
    objectives: c.objectives ?? '',
    learningGoals: c.learningGoals ?? '',
    risks: splitLines(c.risks),
    assumptions: c.assumptions ?? '',
    testIdeas: c.testIdeas ?? [],
    heuristics: c.heuristics ?? [],
    prerequisites: c.prerequisites ?? '',
    testData: c.testData ?? '',
    environmentId: c.environmentId ?? null,
    browser: c.browser ?? '',
    os: c.os ?? '',
    device: c.device ?? '',
    environmentNotes: c.environmentNotes ?? '',
    estimatedMinutes: c.estimatedMinutes ?? null,
    timeboxMinutes: c.timeboxMinutes ?? 60,
    assigneeIds: (c.assignees ?? []).map((a: any) => a.id),
    priority: c.priority ?? 'MEDIUM',
    riskLevel: c.riskLevel ?? 'MEDIUM',
    milestoneId: c.milestoneId ?? null,
    tags: c.tags ?? [],
    exitCriteria: c.exitCriteria ?? '',
    customFields: c.customFields ?? {},
    templateId: c.templateId ?? null,
    requirementIds: (c.requirements ?? []).map((r: any) => r.id),
  };
}

function withTemplate(s: V, t: any, replaceMission: boolean): V {
  const n: V = {
    ...s,
    templateId: t.id,
    mission: replaceMission || !s.mission.trim() ? t.missionTemplate : s.mission,
    timeboxMinutes: t.timeboxMinutes ?? s.timeboxMinutes,
    heuristics: uniq([...s.heuristics, ...(t.heuristics ?? [])]),
    testIdeas: uniq([...s.testIdeas, ...(t.testIdeas ?? [])]),
  };
  for (const [k, val] of Object.entries((t.defaults ?? {}) as Record<string, string>)) {
    if (!val) continue;
    if (k === 'risks') n.risks = n.risks.length ? n.risks : splitLines(val);
    else if ((TEXT_KEYS as readonly string[]).includes(k) && !(n as any)[k]) (n as any)[k] = val;
  }
  return n;
}

export default function CharterForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const templateId = sp.get('template');
  const { pid, can } = useProject();
  const existing = useQuery({ queryKey: ['charter', pid, id], queryFn: () => api.get(p(pid, `/charters/${id}`)), enabled: !!id });
  const template = useQuery({ queryKey: ['template', pid, templateId], queryFn: () => api.get(p(pid, `/templates/${templateId}`)), enabled: !id && !!templateId });

  if (!can('TESTER'))
    return <EmptyState icon={<IconLock size={26} />} title="You can't edit charters" description="Testers, leads and admins can create and edit charters. Ask a project admin for access." />;
  if (existing.isLoading || template.isLoading) return <Loading />;
  if (existing.error) return <ErrorState error={existing.error} />;
  if (id && existing.data) {
    const c = existing.data.charter;
    if (!existing.data.permissions?.canEdit || c.status === 'ARCHIVED')
      return (
        <EmptyState
          icon={<IconLock size={26} />}
          title={c.status === 'ARCHIVED' ? 'This charter is archived' : "You can't edit this charter"}
          description={c.status === 'ARCHIVED' ? 'Unarchive the charter before editing it.' : 'Only the author or a lead can edit this charter in this project.'}
          action={
            <Button variant="light" component={Link} to={`/projects/${pid}/charters/${c.id}`}>
              Back to {c.key}
            </Button>
          }
        />
      );
  }
  return <CharterEditor key={id ?? `new-${templateId ?? ''}`} charter={id ? existing.data?.charter : undefined} template={template.data?.template} templateError={template.error} />;
}

function CharterEditor({ charter, template, templateError }: { charter?: any; template?: any; templateError?: unknown }) {
  const { pid, project, memberOptions, milestoneOptions, environmentOptions, environments, tagNames, fieldsFor } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ai = useAiStatus();
  const editing = !!charter;

  const blank: V = useMemo(
    () => ({
      ...fromCharter({}),
      timeboxMinutes: project.settings.defaultTimeboxMinutes ?? 60,
    }),
    [project.settings.defaultTimeboxMinutes],
  );
  const [initial] = useState<V>(() => (charter ? fromCharter(charter) : template ? withTemplate(blank, template, true) : blank));
  const [v, setV] = useState<V>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'DRAFT' | 'READY'>(null);
  const [open, setOpen] = useState<string[]>(() => {
    const filled = SECTIONS.filter((s) => s.fields.some((f) => hasValue((initial as any)[f]))).map((s) => s.value);
    return filled.length ? filled : ['scope'];
  });
  const [draftOpen, setDraftOpen] = useState(false);

  const set = <K extends keyof V>(k: K, val: V[K]) => setV((s) => ({ ...s, [k]: val }));

  const templates = useQuery({ queryKey: ['templates', pid, false], queryFn: () => api.get(p(pid, '/templates')), staleTime: 60_000 });
  const reqs = useQuery({ queryKey: ['requirements-options', pid], queryFn: () => api.get(p(pid, '/requirements'), { pageSize: 200 }), staleTime: 60_000 });
  const customFieldCount = fieldsFor('CHARTER').length;

  const templateGroups = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const t of templates.data?.templates ?? []) {
      const g = groups.get(t.category) ?? [];
      g.push({ value: t.id, label: t.name });
      groups.set(t.category, g);
    }
    return Array.from(groups, ([group, items]) => ({ group, items }));
  }, [templates.data]);

  const pickTemplate = (tid: string | null) => {
    if (!tid) return set('templateId', null);
    const t = templates.data?.templates?.find((x: any) => x.id === tid);
    if (!t) return;
    if (v.mission.trim() && v.mission.trim() !== t.missionTemplate) {
      modals.openConfirmModal({
        title: `Apply "${t.name}"?`,
        children: (
          <Text size="sm">
            The template adds its heuristics and test ideas, sets the timebox to {t.timeboxMinutes} minutes and fills empty fields. Do you also want to replace your current mission with the
            template mission?
          </Text>
        ),
        labels: { confirm: 'Replace mission', cancel: 'Keep my mission' },
        onConfirm: () => setV((s) => withTemplate(s, t, true)),
        onCancel: () => setV((s) => withTemplate(s, t, false)),
      });
    } else setV((s) => withTemplate(s, t, true));
  };

  const pickEnvironment = (eid: string | null) => {
    const env = environments.find((e) => e.id === eid);
    setV((s) => ({ ...s, environmentId: eid, browser: s.browser || env?.browser || '', os: s.os || env?.os || '', device: s.device || env?.device || '' }));
  };

  const contextText = [v.title, v.mission, v.target, v.scope, v.objectives, v.risks.join('\n')].filter(Boolean).join('\n');

  const save = async (status: 'DRAFT' | 'READY') => {
    const errs: Record<string, string> = {};
    if (!v.title.trim()) errs.title = 'Title is required';
    if (!v.mission.trim()) errs.mission = 'Mission is required';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    const nz = (s: string) => (s.trim() ? s.trim() : null);
    const body = {
      title: v.title.trim(),
      mission: v.mission.trim(),
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, nz(v[k])])),
      risks: v.risks.length ? v.risks.join('\n') : null,
      testIdeas: uniq(v.testIdeas),
      heuristics: uniq(v.heuristics),
      environmentId: v.environmentId,
      estimatedMinutes: v.estimatedMinutes || null,
      timeboxMinutes: v.timeboxMinutes,
      priority: v.priority,
      riskLevel: v.riskLevel,
      milestoneId: v.milestoneId,
      templateId: v.templateId,
      assigneeIds: v.assigneeIds,
      tags: v.tags,
      requirementIds: v.requirementIds,
      customFields: v.customFields,
      status,
    };
    setSaving(status);
    try {
      const r = editing ? await api.patch(p(pid, `/charters/${charter.id}`), body) : await api.post(p(pid, '/charters'), body);
      qc.invalidateQueries({ queryKey: ['charters', pid] });
      qc.invalidateQueries({ queryKey: ['charter', pid, r.charter.id] });
      toastOk(editing ? `${r.charter.key} saved` : `${r.charter.key} created${status === 'READY' ? ' and ready to launch' : ' as a draft'}`);
      navigate(`/projects/${pid}/charters/${r.charter.id}`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        const fe = Object.fromEntries(Object.entries(e.fieldErrors).map(([k, m]) => [k.split('.')[0], m]));
        setErrors(fe);
        setOpen((o) => uniq([...o, ...SECTIONS.filter((s) => s.fields.some((f) => fe[f])).map((s) => s.value)]));
      }
      setFormError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const focusField = (field: string) => {
    const s = SECTIONS.find((x) => x.fields.includes(field));
    if (s) setOpen((o) => uniq([...o, s.value]));
  };

  return (
    <>
      <PageHeader
        kicker={editing ? charter.key : 'New charter'}
        title={editing ? `Edit: ${charter.title}` : 'New charter'}
        subtitle="Start with a natural-language mission. Everything else is optional — add only what helps the tester."
        actions={
          <>
            <Button variant="default" component={Link} to={editing ? `/projects/${pid}/charters/${charter.id}` : `/projects/${pid}/charters`}>
              Cancel
            </Button>
            <Button variant="default" onClick={() => save('DRAFT')} loading={saving === 'DRAFT'} disabled={!!saving && saving !== 'DRAFT'}>
              Save as draft
            </Button>
            <Button onClick={() => save('READY')} loading={saving === 'READY'} disabled={!!saving && saving !== 'READY'}>
              Save as ready
            </Button>
          </>
        }
      />

      {templateError ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mb="md" title="Template not available">
          {errorMessage(templateError)}
        </Alert>
      ) : null}
      {formError && (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="md" title="Could not save the charter" withCloseButton onClose={() => setFormError(null)}>
          {formError}
        </Alert>
      )}

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Group justify="space-between" mb="sm">
                <Title order={5}>Mission</Title>
                <Group gap="xs">
                  <Select
                    aria-label="Charter template"
                    placeholder="Start from a template…"
                    leftSection={<IconTemplate size={16} />}
                    data={templateGroups}
                    value={v.templateId}
                    onChange={pickTemplate}
                    clearable
                    searchable
                    w={260}
                    nothingFoundMessage={templates.isLoading ? 'Loading…' : 'No templates'}
                  />
                  <Button variant="light" color="grape" leftSection={<IconSparkles size={16} />} onClick={() => setDraftOpen(true)}>
                    Draft from user story
                  </Button>
                </Group>
              </Group>
              <Stack gap="sm">
                <TextInput
                  label="Title"
                  required
                  placeholder="e.g. Checkout with saved cards"
                  value={v.title}
                  onChange={(e) => set('title', e.currentTarget.value)}
                  error={errors.title}
                  maxLength={200}
                  data-autofocus
                />
                <Textarea
                  label="Mission"
                  required
                  description={
                    <>
                      Format: <i>Explore [target] using [approach] to discover [risks]</i>
                      {!v.mission && (
                        <Anchor component="button" type="button" size="xs" ml={8} onClick={() => set('mission', 'Explore [target] using [approach] to discover [risks]')}>
                          Insert skeleton
                        </Anchor>
                      )}
                    </>
                  }
                  placeholder="Explore the checkout flow using saved cards, expired cards and network interruptions to discover payment failures and confusing errors."
                  autosize
                  minRows={3}
                  maxRows={10}
                  value={v.mission}
                  onChange={(e) => set('mission', e.currentTarget.value)}
                  error={errors.mission}
                  maxLength={2000}
                />
              </Stack>
            </Paper>

            <Paper withBorder p={0}>
              <Accordion multiple value={open} onChange={setOpen} variant="default" chevronPosition="left">
                {SECTIONS.filter((s) => s.value !== 'custom' || customFieldCount > 0).map((s) => {
                  const filled = s.fields.filter((f) => hasValue((v as any)[f])).length;
                  const hasErr = s.fields.some((f) => errors[f]);
                  return (
                    <Accordion.Item key={s.value} value={s.value}>
                      <Accordion.Control>
                        <Group gap="xs">
                          <Text fw={600} size="sm">
                            {s.label}
                          </Text>
                          {filled > 0 && (
                            <Badge size="xs" variant="light">
                              {filled} filled
                            </Badge>
                          )}
                          {hasErr && (
                            <Badge size="xs" color="red">
                              check fields
                            </Badge>
                          )}
                        </Group>
                      </Accordion.Control>
                      <Accordion.Panel>
                        <SectionFields section={s.value} v={v} set={set} errors={errors} pickEnvironment={pickEnvironment} environmentOptions={environmentOptions} />
                      </Accordion.Panel>
                    </Accordion.Item>
                  );
                })}
              </Accordion>
            </Paper>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Title order={5} mb="sm">
                Planning
              </Title>
              <Stack gap="sm">
                <SimpleGrid cols={2}>
                  <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
                  <Select label="Risk level" data={options(RISK)} value={v.riskLevel} onChange={(x) => set('riskLevel', x ?? 'MEDIUM')} allowDeselect={false} />
                  <NumberInput
                    label="Timebox (min)"
                    min={5}
                    max={480}
                    step={15}
                    value={v.timeboxMinutes}
                    onChange={(x) => set('timeboxMinutes', Number(x) || 60)}
                    error={errors.timeboxMinutes}
                  />
                  <NumberInput
                    label="Estimate (min)"
                    description="Total effort, all sessions"
                    min={1}
                    max={10000}
                    value={v.estimatedMinutes ?? ''}
                    onChange={(x) => set('estimatedMinutes', x === '' ? null : Number(x))}
                    error={errors.estimatedMinutes}
                  />
                </SimpleGrid>
                <Select label="Milestone" data={milestoneOptions} value={v.milestoneId} onChange={(x) => set('milestoneId', x)} clearable error={errors.milestoneId} />
                <MultiSelect label="Assignees" data={memberOptions} value={v.assigneeIds} onChange={(x) => set('assigneeIds', x)} searchable clearable placeholder="Nobody yet" />
                <TagsInput label="Tags" data={tagNames} value={v.tags} onChange={(x) => set('tags', x)} clearable maxTags={30} />
                <MultiSelect
                  label="Related requirements"
                  data={(reqs.data?.requirements ?? []).map((r: any) => ({ value: r.id, label: `${r.key} ${r.title}` }))}
                  value={v.requirementIds}
                  onChange={(x) => set('requirementIds', x)}
                  searchable
                  clearable
                  nothingFoundMessage={reqs.isLoading ? 'Loading…' : 'No requirements'}
                />
              </Stack>
            </Paper>

            <AssistantPanel v={v} contextText={contextText} onAddIdeas={(ideas) => set('testIdeas', uniq([...v.testIdeas, ...ideas]))} onAddHeuristics={(h) => set('heuristics', uniq([...v.heuristics, ...h]))} onFocusField={focusField} aiEnabled={!!ai.data?.enabled} aiStatus={ai.data} />
          </Stack>
        </Grid.Col>
      </Grid>

      <CharterDraftModal
        opened={draftOpen}
        onClose={() => setDraftOpen(false)}
        defaultTarget={v.target}
        aiStatus={ai.data}
        onApply={(patch) => {
          setV((s) => ({
            ...s,
            ...patch,
            testIdeas: patch.testIdeas ? uniq([...s.testIdeas, ...patch.testIdeas]) : s.testIdeas,
            heuristics: patch.heuristics ? uniq([...s.heuristics, ...patch.heuristics]) : s.heuristics,
          }));
          setOpen((o) => uniq([...o, ...SECTIONS.filter((s) => s.fields.some((f) => f in patch)).map((s) => s.value)]));
          toastOk('Draft applied to the form. Review it, then save.');
        }}
      />
    </>
  );
}

function hasValue(x: unknown) {
  if (Array.isArray(x)) return x.length > 0;
  if (x && typeof x === 'object') return Object.values(x).some((y) => y !== null && y !== '' && y !== undefined);
  return x !== null && x !== undefined && x !== '';
}

function SectionFields({
  section,
  v,
  set,
  errors,
  pickEnvironment,
  environmentOptions,
}: {
  section: string;
  v: V;
  set: <K extends keyof V>(k: K, val: V[K]) => void;
  errors: Record<string, string>;
  pickEnvironment: (id: string | null) => void;
  environmentOptions: { value: string; label: string }[];
}) {
  const area = (k: (typeof TEXT_KEYS)[number], label: string, placeholder?: string, description?: string) => (
    <Textarea label={label} description={description} placeholder={placeholder} autosize minRows={2} maxRows={10} value={v[k]} onChange={(e) => set(k, e.currentTarget.value)} error={errors[k]} />
  );
  switch (section) {
    case 'scope':
      return (
        <Stack gap="sm">
          <TextInput label="Target / feature under test" placeholder="e.g. Checkout › Payment step" value={v.target} onChange={(e) => set('target', e.currentTarget.value)} error={errors.target} maxLength={300} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {area('scope', 'In scope', 'Areas, flows and data to cover')}
            {area('outOfScope', 'Out of scope', 'What to deliberately leave alone')}
          </SimpleGrid>
        </Stack>
      );
    case 'objectives':
      return (
        <Stack gap="sm">
          {area('objectives', 'Objectives', 'What should this exploration achieve?')}
          {area('learningGoals', 'Learning goals', 'What do we want to understand better?')}
          {area('exitCriteria', 'Exit criteria', 'How will the tester know the mission is complete?')}
        </Stack>
      );
    case 'risks':
      return (
        <Stack gap="sm">
          <ListEditor label="Target risks" description="Product risks this charter should investigate, most important first." value={v.risks} onChange={(x) => set('risks', x)} error={errors.risks} placeholder="e.g. Double charge on retry" />
          {area('assumptions', 'Assumptions & constraints')}
        </Stack>
      );
    case 'ideas':
      return (
        <Stack gap="md">
          <ListEditor label="Test ideas" description="Starting points, not scripted steps. Testers check them off in the workbench." value={v.testIdeas} onChange={(x) => set('testIdeas', x)} error={errors.testIdeas} />
          <ListEditor label="Heuristics" description="Heuristics or oracles to apply (e.g. Goldilocks, CRUD, Interruptions)." value={v.heuristics} onChange={(x) => set('heuristics', x)} error={errors.heuristics} />
        </Stack>
      );
    case 'setup':
      return (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {area('prerequisites', 'Prerequisites', 'Accounts, feature flags, tools…')}
          {area('testData', 'Test data', 'Cards, users, files, datasets…')}
        </SimpleGrid>
      );
    case 'environment':
      return (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Environment" data={environmentOptions} value={v.environmentId} onChange={pickEnvironment} clearable error={errors.environmentId} placeholder="Any" />
            <TextInput label="Browser" value={v.browser} onChange={(e) => set('browser', e.currentTarget.value)} />
            <TextInput label="OS" value={v.os} onChange={(e) => set('os', e.currentTarget.value)} />
            <TextInput label="Device" value={v.device} onChange={(e) => set('device', e.currentTarget.value)} />
          </SimpleGrid>
          {area('environmentNotes', 'Environment notes')}
        </Stack>
      );
    case 'custom':
      return <CustomFieldsInput entity="CHARTER" value={v.customFields} onChange={(x) => set('customFields', x)} />;
    default:
      return null;
  }
}

function AssistantPanel({
  v,
  contextText,
  onAddIdeas,
  onAddHeuristics,
  onFocusField,
  aiEnabled,
  aiStatus,
}: {
  v: V;
  contextText: string;
  onAddIdeas: (ideas: string[]) => void;
  onAddHeuristics: (names: string[]) => void;
  onFocusField: (field: string) => void;
  aiEnabled: boolean;
  aiStatus: any;
}) {
  const { pid } = useProject();
  const lintInput = useMemo(
    () => ({
      title: v.title,
      mission: v.mission,
      target: v.target,
      scope: v.scope,
      outOfScope: v.outOfScope,
      objectives: v.objectives,
      risks: v.risks.join('\n'),
      exitCriteria: v.exitCriteria,
      timeboxMinutes: v.timeboxMinutes,
      testIdeas: v.testIdeas,
    }),
    [v.title, v.mission, v.target, v.scope, v.outOfScope, v.objectives, v.risks, v.exitCriteria, v.timeboxMinutes, v.testIdeas],
  );
  const [debounced] = useDebouncedValue(lintInput, 800);
  const lint = useQuery({
    queryKey: ['charter-lint', pid, debounced],
    queryFn: () => api.post(p(pid, '/ai/charter-lint'), debounced),
    enabled: !!(debounced.mission || debounced.title),
    placeholderData: (prev) => prev,
    staleTime: Infinity,
  });

  const [ideas, setIdeas] = useState<{ list: { idea: string; rationale: string }[]; meta: AiMeta } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [heur, setHeur] = useState<any[] | null>(null);
  const [heurBusy, setHeurBusy] = useState(false);

  const suggestIdeas = async () => {
    setIdeasBusy(true);
    try {
      const r = await api.post(p(pid, '/ai/test-ideas'), { text: contextText });
      const list = (r.draft?.ideas ?? []).filter((i: any) => !v.testIdeas.includes(i.idea));
      setIdeas({ list, meta: r.meta });
      setPicked([]);
    } catch (e) {
      toastError(e, 'Could not suggest test ideas');
    } finally {
      setIdeasBusy(false);
    }
  };

  const recommend = async () => {
    setHeurBusy(true);
    try {
      const r = await api.post(p(pid, '/ai/heuristics/recommend'), { text: contextText });
      setHeur(r.heuristics ?? []);
    } catch (e) {
      toastError(e, 'Could not recommend heuristics');
    } finally {
      setHeurBusy(false);
    }
  };

  const score: number | undefined = lint.data?.score;
  const tooShort = contextText.trim().length < 5;

  return (
    <Paper withBorder p="md" style={{ position: 'sticky', top: 16 }}>
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="grape" size="sm">
          <IconWand size={14} />
        </ThemeIcon>
        <Title order={5}>Charter assistant</Title>
      </Group>

      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>
        Quality check
      </Text>
      {!lint.data ? (
        <Text size="sm" c="dimmed">
          {lint.isFetching ? 'Checking…' : 'Write a mission to get feedback on clarity and completeness.'}
        </Text>
      ) : (
        <Stack gap={6}>
          <Group gap="xs" wrap="nowrap">
            <Progress value={score ?? 0} color={(score ?? 0) >= 80 ? 'teal' : (score ?? 0) >= 55 ? 'yellow' : 'red'} style={{ flex: 1 }} aria-label="Charter quality score" />
            <Text size="sm" fw={700} w={36} ta="right">
              {score}
            </Text>
          </Group>
          {lint.data.issues.length === 0 ? (
            <Text size="sm" c="teal">
              No ambiguity warnings. Nice and focused.
            </Text>
          ) : (
            lint.data.issues.map((i: any, idx: number) => (
              <UnstyledButton key={idx} onClick={() => onFocusField(i.field)} aria-label={`Go to ${FIELD_LABEL[i.field] ?? i.field}`}>
                <Group gap={6} wrap="nowrap" align="flex-start">
                  <Box mt={2}>{i.level === 'warning' ? <IconAlertTriangle size={14} color="var(--mantine-color-yellow-7)" /> : <IconInfoCircle size={14} color="var(--mantine-color-blue-6)" />}</Box>
                  <Text size="xs">
                    <b>{FIELD_LABEL[i.field] ?? i.field}:</b> {i.message}
                  </Text>
                </Group>
              </UnstyledButton>
            ))
          )}
          <Text size="xs" c="dimmed">
            Deterministic rules — no AI involved.
          </Text>
        </Stack>
      )}

      <Divider my="md" />
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6}>
        Suggestions (you choose what to add)
      </Text>
      <Group gap="xs" mb="xs">
        <Button size="xs" variant="light" leftSection={<IconChecklist size={14} />} onClick={recommend} loading={heurBusy} disabled={tooShort}>
          Recommend heuristics
        </Button>
        {aiEnabled && (
          <Button size="xs" variant="light" color="grape" leftSection={<IconBulb size={14} />} onClick={suggestIdeas} loading={ideasBusy} disabled={tooShort}>
            Suggest test ideas
          </Button>
        )}
      </Group>
      {!aiEnabled && <AiSetupNotice status={aiStatus} />}

      {heur && (
        <Stack gap="xs" mt="xs">
          <Text size="xs" c="dimmed">
            Matched by keywords in your charter (deterministic).
          </Text>
          {heur.length === 0 && <Text size="sm">No matching heuristics.</Text>}
          {heur.map((h: any) => {
            const added = v.heuristics.includes(h.name);
            return (
              <Paper key={h.name} withBorder p="xs" bg="var(--ex-subtle)">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div>
                    <Text size="sm" fw={600}>
                      {h.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {h.description}
                    </Text>
                  </div>
                  <Button size="compact-xs" variant={added ? 'subtle' : 'light'} disabled={added} onClick={() => onAddHeuristics([h.name])}>
                    {added ? 'Added' : 'Add'}
                  </Button>
                </Group>
                {h.ideas?.length > 0 && (
                  <Stack gap={2} mt={6}>
                    {h.ideas.map((idea: string) => {
                      const has = v.testIdeas.includes(idea);
                      return (
                        <Group key={idea} gap={4} wrap="nowrap" align="flex-start">
                          <Button size="compact-xs" variant="subtle" px={4} disabled={has} onClick={() => onAddIdeas([idea])} aria-label={`Add test idea: ${idea}`}>
                            <IconPlus size={12} />
                          </Button>
                          <Text size="xs" c={has ? 'dimmed' : undefined} td={has ? 'line-through' : undefined}>
                            {idea}
                          </Text>
                        </Group>
                      );
                    })}
                  </Stack>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}

      {ideas && (
        <Stack gap={6} mt="sm">
          <AiDraftBadge meta={ideas.meta} />
          {ideas.list.length === 0 && <Text size="sm">No new ideas beyond the ones you already have.</Text>}
          {ideas.list.map((i) => (
            <Checkbox
              key={i.idea}
              size="xs"
              checked={picked.includes(i.idea)}
              onChange={(e) => { const on = e.currentTarget.checked; setPicked((s) => (on ? [...s, i.idea] : s.filter((x) => x !== i.idea))); }}
              label={
                <>
                  <Text size="xs">{i.idea}</Text>
                  {i.rationale && (
                    <Text size="xs" c="dimmed">
                      {i.rationale}
                    </Text>
                  )}
                </>
              }
            />
          ))}
          {ideas.list.length > 0 && (
            <Group gap="xs">
              <Button
                size="xs"
                disabled={!picked.length}
                onClick={() => {
                  onAddIdeas(picked);
                  setIdeas((s) => (s ? { ...s, list: s.list.filter((x) => !picked.includes(x.idea)) } : s));
                  setPicked([]);
                }}
              >
                Add {picked.length || ''} selected
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setIdeas(null)}>
                Dismiss
              </Button>
            </Group>
          )}
        </Stack>
      )}
    </Paper>
  );
}

const DRAFT_FIELDS: { key: string; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'mission', label: 'Mission' },
  { key: 'target', label: 'Target' },
  { key: 'scope', label: 'Scope' },
  { key: 'outOfScope', label: 'Out of scope' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'risks', label: 'Risks' },
  { key: 'testIdeas', label: 'Test ideas (added)' },
  { key: 'heuristics', label: 'Heuristics (added)' },
  { key: 'exitCriteria', label: 'Exit criteria' },
  { key: 'timeboxMinutes', label: 'Timebox' },
];

function CharterDraftModal({
  opened,
  onClose,
  defaultTarget,
  aiStatus,
  onApply,
}: {
  opened: boolean;
  onClose: () => void;
  defaultTarget: string;
  aiStatus: any;
  onApply: (patch: Partial<V>) => void;
}) {
  const { pid } = useProject();
  const [story, setStory] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (opened) {
      setTarget(defaultTarget);
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post(p(pid, '/ai/charter-draft'), { text: story, target: target.trim() || undefined });
      setResult(r);
      setSelected(DRAFT_FIELDS.filter((f) => hasValue(r.draft?.[f.key])).map((f) => f.key));
    } catch (e) {
      toastError(e, 'AI draft failed');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const d = result.draft;
    const patch: Partial<V> = {};
    for (const k of selected) {
      if (k === 'risks') patch.risks = splitLines(d.risks);
      else if (k === 'timeboxMinutes') patch.timeboxMinutes = Math.min(480, Math.max(5, Number(d.timeboxMinutes) || 60));
      else (patch as any)[k] = d[k];
    }
    onApply(patch);
    onClose();
  };

  const show = (k: string, val: any) => (Array.isArray(val) ? val.map((x: string) => `• ${x}`).join('\n') : k === 'timeboxMinutes' ? `${val} minutes` : String(val ?? ''));

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={<Text fw={700}>Draft a charter from a user story</Text>}>
      {!aiStatus?.enabled ? (
        <AiSetupNotice status={aiStatus} />
      ) : !result ? (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Paste a user story, requirement or acceptance criteria. AI drafts a charter you can review field by field. Nothing is saved until you save the charter.
          </Text>
          <TextInput label="Feature under test (optional)" value={target} onChange={(e) => setTarget(e.currentTarget.value)} maxLength={200} />
          <Textarea
            label="User story / requirement"
            required
            autosize
            minRows={6}
            maxRows={16}
            placeholder="As a returning shopper I want to pay with a saved card so that checkout is faster…"
            value={story}
            onChange={(e) => setStory(e.currentTarget.value)}
            maxLength={20000}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button color="grape" leftSection={<IconSparkles size={16} />} onClick={generate} loading={busy} disabled={story.trim().length < 10}>
              Generate draft
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <Group justify="space-between">
            <AiDraftBadge meta={result.meta} />
            {result.lint && (
              <Badge variant="light" color={result.lint.score >= 80 ? 'teal' : result.lint.score >= 55 ? 'yellow' : 'red'}>
                Quality score {result.lint.score}
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            Choose which fields to copy into the form. Text fields replace what you have; test ideas and heuristics are appended.
          </Text>
          {DRAFT_FIELDS.filter((f) => hasValue(result.draft?.[f.key])).map((f) => (
            <Paper key={f.key} withBorder p="xs">
              <Checkbox
                checked={selected.includes(f.key)}
                onChange={(e) => { const on = e.currentTarget.checked; setSelected((s) => (on ? [...s, f.key] : s.filter((x) => x !== f.key))); }}
                label={
                  <Text size="sm" fw={600}>
                    {f.label}
                  </Text>
                }
              />
              <Text size="sm" className="ex-prewrap" mt={4} ml={30}>
                {show(f.key, result.draft[f.key])}
              </Text>
            </Paper>
          ))}
          {result.lint?.issues?.length > 0 && (
            <Alert color="yellow" variant="light" title="Things to tighten before saving" icon={<IconAlertTriangle size={16} />}>
              <Stack gap={2}>
                {result.lint.issues.map((i: any, idx: number) => (
                  <Text key={idx} size="xs">
                    <b>{FIELD_LABEL[i.field] ?? i.field}:</b> {i.message}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}
          <Group justify="space-between">
            <Button variant="subtle" onClick={() => setResult(null)}>
              Back
            </Button>
            <Group>
              <Button variant="default" onClick={onClose}>
                Discard
              </Button>
              <Button onClick={apply} disabled={!selected.length}>
                Apply {selected.length} field{selected.length === 1 ? '' : 's'}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
