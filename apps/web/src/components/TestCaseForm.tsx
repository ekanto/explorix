import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Alert, Autocomplete, Badge, Box, Button, Divider, Group, Modal, MultiSelect, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, TagsInput, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { api, ApiError, p } from '../lib/api';
import { options, PRIORITY } from '../lib/constants';
import { useProject } from '../lib/project';
import { CustomFieldsInput } from './CustomFields';
import { CASE_TYPES, GherkinView, TEST_CASE_STATUS, useFolders, validateGherkin } from './TestingWidgets';
import { toastError, toastOk } from './ui';

type EditStep = { uid: number; action: string; expected: string; data: string };
let uidSeq = 1;
const newStep = (s?: Partial<EditStep>): EditStep => ({ uid: uidSeq++, action: s?.action ?? '', expected: s?.expected ?? '', data: s?.data ?? '' });

const GHERKIN_TEMPLATE = `Feature: 

  Scenario: 
    Given 
    When 
    Then `;

/** Ordered step editor: action / test data / expected result with add, remove and reorder. */
export function StepsEditor({ steps, onChange, errors }: { steps: EditStep[]; onChange: (s: EditStep[]) => void; errors?: Record<string, string> }) {
  const update = (uid: number, patch: Partial<EditStep>) => onChange(steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    onChange(next);
  };
  return (
    <Stack gap="xs">
      {steps.map((s, i) => (
        <Paper key={s.uid} withBorder p="xs" className="ex-fade-in">
          <Group align="flex-start" wrap="nowrap" gap="xs">
            <Badge variant="light" circle mt={6}>
              {i + 1}
            </Badge>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" style={{ flex: 1 }}>
              <Textarea
                aria-label={`Step ${i + 1} action`}
                placeholder="Action"
                autosize
                minRows={1}
                maxRows={6}
                value={s.action}
                onChange={(e) => update(s.uid, { action: e.currentTarget.value })}
                error={errors?.[`steps.${i}.action`]}
              />
              <Textarea aria-label={`Step ${i + 1} test data`} placeholder="Test data (optional)" autosize minRows={1} maxRows={6} value={s.data} onChange={(e) => update(s.uid, { data: e.currentTarget.value })} />
              <Textarea aria-label={`Step ${i + 1} expected result`} placeholder="Expected result" autosize minRows={1} maxRows={6} value={s.expected} onChange={(e) => update(s.uid, { expected: e.currentTarget.value })} />
            </SimpleGrid>
            <Stack gap={2}>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <IconArrowUp size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                <IconArrowDown size={14} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((x) => x.uid !== s.uid))}>
                <IconTrash size={14} />
              </ActionIcon>
            </Stack>
          </Group>
        </Paper>
      ))}
      <Group>
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => onChange([...steps, newStep()])}>
          Add step
        </Button>
        {steps.length === 0 && (
          <Text size="xs" c="dimmed">
            No steps yet.
          </Text>
        )}
      </Group>
    </Stack>
  );
}

type FormState = {
  title: string;
  folderId: string | null;
  status: string;
  priority: string;
  type: string;
  estimateMinutes: number | null;
  automationKey: string;
  description: string;
  preconditions: string;
  testData: string;
  format: string;
  gherkin: string;
  steps: EditStep[];
  tags: string[];
  requirementIds: string[];
  customFields: Record<string, unknown>;
};

function initial(tc?: any, defaults?: Partial<FormState>): FormState {
  if (tc)
    return {
      title: tc.title,
      folderId: tc.folderId ?? null,
      status: tc.status,
      priority: tc.priority,
      type: tc.type ?? 'Functional',
      estimateMinutes: tc.estimateMinutes ?? null,
      automationKey: tc.automationKey ?? '',
      description: tc.description ?? '',
      preconditions: tc.preconditions ?? '',
      testData: tc.testData ?? '',
      format: tc.format,
      gherkin: tc.gherkin ?? '',
      steps: (tc.steps ?? []).map((s: any) => newStep({ action: s.action, expected: s.expected ?? '', data: s.data ?? '' })),
      tags: tc.tags ?? [],
      requirementIds: (tc.requirements ?? []).map((r: any) => r.id),
      customFields: tc.customFields ?? {},
    };
  return {
    title: '',
    folderId: null,
    status: 'ACTIVE',
    priority: 'MEDIUM',
    type: 'Functional',
    estimateMinutes: null,
    automationKey: '',
    description: '',
    preconditions: '',
    testData: '',
    format: 'STEPS',
    gherkin: '',
    steps: [newStep()],
    tags: [],
    requirementIds: [],
    customFields: {},
    ...defaults,
  };
}

/** Create or edit a test case (steps, Gherkin or free-text format). */
export function TestCaseFormModal({
  opened,
  onClose,
  testCase,
  defaults,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  testCase?: any;
  defaults?: Partial<FormState>;
  onSaved: (tc: any) => void;
}) {
  const { pid, tagNames, fieldsFor } = useProject();
  const { folderOptions } = useFolders();
  const [v, setV] = useState<FormState>(() => initial(testCase, defaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const reqs = useQuery({ queryKey: ['requirements', pid, 'options'], queryFn: () => api.get(p(pid, '/requirements'), { pageSize: 200 }), enabled: opened });
  const reqOptions = (reqs.data?.requirements ?? []).map((r: any) => ({ value: r.id, label: `${r.key} · ${r.title}` }));

  useEffect(() => {
    if (opened) {
      setV(initial(testCase, defaults));
      setErrors({});
    }
    // Reset only when the modal opens or the edited case changes.
  }, [opened, testCase?.id, testCase?.version]);

  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => setV((s) => ({ ...s, [k]: val }));
  const gherkinIssues = v.format === 'GHERKIN' ? validateGherkin(v.gherkin) : [];

  const submit = async () => {
    const errs: Record<string, string> = {};
    const steps = v.steps.filter((s) => s.action.trim() || s.expected.trim() || s.data.trim());
    steps.forEach((s, i) => {
      if (!s.action.trim()) errs[`steps.${i}.action`] = 'Each step needs an action';
    });
    if (!v.title.trim()) errs.title = 'Title is required';
    if (v.format === 'GHERKIN' && gherkinIssues.length) errs.gherkin = gherkinIssues.join('; ');
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    const body: Record<string, unknown> = {
      title: v.title,
      folderId: v.folderId,
      status: v.status,
      priority: v.priority,
      type: v.type.trim() || 'Functional',
      estimateMinutes: v.estimateMinutes,
      automationKey: v.automationKey.trim() || null,
      description: v.description.trim() || null,
      preconditions: v.preconditions.trim() || null,
      testData: v.testData.trim() || null,
      format: v.format,
      tags: v.tags,
      requirementIds: v.requirementIds,
      customFields: v.customFields,
    };
    if (v.format === 'GHERKIN') body.gherkin = v.gherkin;
    if (v.format === 'STEPS') body.steps = steps.map((s) => ({ action: s.action.trim(), expected: s.expected.trim() || null, data: s.data.trim() || null }));
    if (testCase) body.baseVersion = testCase.version;
    if (!fieldsFor('TEST_CASE').length) delete body.customFields;
    setBusy(true);
    setErrors({});
    try {
      const r = testCase ? await api.patch(p(pid, `/test-cases/${testCase.id}`), body) : await api.post(p(pid, '/test-cases'), body);
      toastOk(testCase ? 'Test case saved' : `Created ${r.testCase.key}`);
      onSaved(r.testCase);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) {
        const fe = e.fieldErrors;
        // Server reports Gherkin problems as several entries on the same path.
        const g = ((e.details as any)?.fields ?? []).filter((f: any) => f.path === 'gherkin').map((f: any) => f.message);
        setErrors({ ...fe, ...(g.length ? { gherkin: g.join('; ') } : {}) });
        toastError(e, 'Please fix the highlighted fields');
      } else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={testCase ? `Edit ${testCase.key}` : 'New test case'} size="xl" closeOnClickOutside={false}>
      <Stack>
        <TextInput label="Title" required value={v.title} onChange={(e) => set('title', e.currentTarget.value)} error={errors.title} data-autofocus placeholder="e.g. Guest can pay with a saved card" />
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
          <Select label="Folder" placeholder="Unfiled" data={folderOptions} value={v.folderId} onChange={(x) => set('folderId', x)} clearable searchable error={errors.folderId} />
          <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
          <Select label="Status" data={options(TEST_CASE_STATUS)} value={v.status} onChange={(x) => set('status', x ?? 'ACTIVE')} allowDeselect={false} />
          <Autocomplete label="Type" data={CASE_TYPES} value={v.type} onChange={(x) => set('type', x)} error={errors.type} />
        </SimpleGrid>
        <Textarea label="Description" autosize minRows={2} maxRows={8} value={v.description} onChange={(e) => set('description', e.currentTarget.value)} error={errors.description} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Textarea label="Preconditions" autosize minRows={2} maxRows={8} value={v.preconditions} onChange={(e) => set('preconditions', e.currentTarget.value)} error={errors.preconditions} />
          <Textarea label="Test data" autosize minRows={2} maxRows={8} value={v.testData} onChange={(e) => set('testData', e.currentTarget.value)} error={errors.testData} />
        </SimpleGrid>

        <Divider
          label={
            <SegmentedControl
              size="xs"
              value={v.format}
              onChange={(x) => {
                set('format', x);
                if (x === 'GHERKIN' && !v.gherkin.trim()) set('gherkin', GHERKIN_TEMPLATE);
              }}
              data={[
                { value: 'STEPS', label: 'Steps' },
                { value: 'GHERKIN', label: 'Gherkin (BDD)' },
                { value: 'TEXT', label: 'Free text' },
              ]}
              aria-label="Test case format"
            />
          }
          labelPosition="left"
        />
        {v.format === 'STEPS' && <StepsEditor steps={v.steps} onChange={(s) => set('steps', s)} errors={errors} />}
        {v.format === 'GHERKIN' && (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Textarea
              label="Scenario"
              description="Feature / Scenario / Given / When / Then"
              ff="monospace"
              autosize
              minRows={8}
              maxRows={24}
              value={v.gherkin}
              onChange={(e) => set('gherkin', e.currentTarget.value)}
              error={errors.gherkin}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            />
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Preview
              </Text>
              <GherkinView source={v.gherkin} />
              {gherkinIssues.length > 0 && (
                <Alert color="yellow" mt="xs" p="xs">
                  {gherkinIssues.join(' · ')}
                </Alert>
              )}
            </Box>
          </SimpleGrid>
        )}
        {v.format === 'TEXT' && (
          <Text size="sm" c="dimmed">
            Free-text cases use the description above as the test instructions.
            {testCase?.steps?.length ? ' Existing steps are kept but hidden while this format is selected.' : ''}
          </Text>
        )}

        <Divider />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TagsInput label="Tags" data={tagNames} value={v.tags} onChange={(x) => set('tags', x)} clearable placeholder="Type and press Enter" />
          <MultiSelect
            label="Requirements"
            data={reqOptions}
            value={v.requirementIds}
            onChange={(x) => set('requirementIds', x)}
            searchable
            clearable
            placeholder={reqs.isLoading ? 'Loading…' : 'Link requirements'}
            nothingFoundMessage="No requirements"
          />
          <NumberInput label="Estimate (minutes)" min={0} max={10000} value={v.estimateMinutes ?? ''} onChange={(n) => set('estimateMinutes', n === '' ? null : Number(n))} error={errors.estimateMinutes} />
          <TextInput
            label={
              <Tooltip label="Link this case to an automated test (e.g. spec file::test name)" withArrow>
                <span>Automation key</span>
              </Tooltip>
            }
            placeholder="path/to/spec.ts::suite::test"
            value={v.automationKey}
            onChange={(e) => set('automationKey', e.currentTarget.value)}
            error={errors.automationKey}
          />
        </SimpleGrid>
        <CustomFieldsInput entity="TEST_CASE" value={v.customFields} onChange={(x) => set('customFields', x)} />
        {Object.keys(errors).some((k) => k.startsWith('customFields')) && <Alert color="red">{Object.entries(errors).filter(([k]) => k.startsWith('customFields')).map(([, m]) => m).join('; ')}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {testCase ? 'Save changes' : 'Create test case'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
