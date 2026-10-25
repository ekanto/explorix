import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Group, Modal, NumberInput, Select, SimpleGrid, Stack, TagsInput, Text, TextInput, Textarea } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { api, ApiError, p } from '../lib/api';
import { useAuth } from '../lib/auth';
import { options, PRIORITY } from '../lib/constants';
import { useProject } from '../lib/project';
import { toastError } from './ui';

type Charter = {
  id: string;
  key: string;
  title: string;
  timeboxMinutes: number;
  priority: string;
  milestoneId: string | null;
  environmentId: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  environmentNotes?: string | null;
  tags?: string[];
};

/**
 * Launch a new exploratory session from a charter. Each launch creates an independent
 * session with its own timer, notes, log and findings.
 */
export function LaunchSessionModal({
  opened,
  onClose,
  charter,
  onLaunched,
}: {
  opened: boolean;
  onClose: () => void;
  /** When omitted the user picks a charter. */
  charter?: Charter | null;
  onLaunched: (session: { id: string; key: string }) => void;
}) {
  const { user } = useAuth();
  const { pid, can, memberOptions, milestoneOptions, environmentOptions, environments, tagNames, project } = useProject();
  const isLead = can('LEAD');
  const [charterId, setCharterId] = useState<string | null>(charter?.id ?? null);
  const charters = useQuery({
    queryKey: ['charters', pid, 'launchable'],
    queryFn: () => api.get(p(pid, '/charters'), { status: ['READY', 'DRAFT'], pageSize: 200, sort: 'title' }),
    enabled: opened && !charter,
  });
  const selected: Charter | undefined = charter ?? charters.data?.charters?.find((c: Charter) => c.id === charterId);

  const init = (c?: Charter) => ({
    title: '',
    testerId: user?.id ?? null,
    environmentId: c?.environmentId ?? null,
    browser: c?.browser ?? '',
    os: c?.os ?? '',
    device: c?.device ?? '',
    buildVersion: '',
    environmentNotes: c?.environmentNotes ?? '',
    timeboxMinutes: c?.timeboxMinutes ?? project.settings.defaultTimeboxMinutes ?? 60,
    dueDate: null as string | null,
    milestoneId: c?.milestoneId ?? null,
    priority: c?.priority ?? 'MEDIUM',
    tags: [] as string[],
    start: true,
  });
  const [v, setV] = useState(init(charter ?? undefined));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (opened) {
      setCharterId(charter?.id ?? null);
      setV(init(charter ?? undefined));
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, charter?.id]);

  useEffect(() => {
    if (!charter && selected) setV((s) => ({ ...init(selected), testerId: s.testerId, start: s.start }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  const pickEnvironment = (id: string | null) => {
    const env = environments.find((e) => e.id === id);
    setV((s) => ({ ...s, environmentId: id, browser: env?.browser ?? s.browser, os: env?.os ?? s.os, device: env?.device ?? s.device }));
  };

  const submit = async () => {
    if (!selected) {
      setErrors({ charterId: 'Choose a charter' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const body = {
        ...v,
        title: v.title.trim() || undefined,
        browser: v.browser || null,
        os: v.os || null,
        device: v.device || null,
        buildVersion: v.buildVersion || null,
        environmentNotes: v.environmentNotes || null,
        start: v.start && v.testerId === user?.id,
      };
      const r = await api.post(p(pid, `/charters/${selected.id}/sessions`), body);
      onLaunched(r.session);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e, 'Could not launch session');
    } finally {
      setBusy(false);
    }
  };

  const forOther = v.testerId !== user?.id;

  return (
    <Modal opened={opened} onClose={onClose} size="lg" title={<Text fw={700}>Launch exploratory session</Text>}>
      <Stack gap="sm">
        {charter ? (
          <Text size="sm">
            From charter{' '}
            <Text span className="ex-key">
              {charter.key}
            </Text>{' '}
            <b>{charter.title}</b>
          </Text>
        ) : (
          <Select
            label="Charter"
            required
            searchable
            data={(charters.data?.charters ?? []).map((c: any) => ({ value: c.id, label: `${c.key} ${c.title}${c.status === 'DRAFT' ? ' (draft)' : ''}` }))}
            value={charterId}
            onChange={setCharterId}
            error={errors.charterId}
            nothingFoundMessage={charters.isLoading ? 'Loading…' : 'No charters'}
          />
        )}
        <TextInput label="Session title" placeholder={selected ? `Defaults to "${selected.title} #n"` : 'Optional'} value={v.title} onChange={(e) => set('title', e.currentTarget.value)} error={errors.title} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Tester"
            data={isLead ? memberOptions : memberOptions.filter((m) => m.value === user?.id)}
            value={v.testerId}
            onChange={(x) => set('testerId', x)}
            clearable={isLead}
            placeholder="Unassigned"
            description={isLead ? undefined : 'Only leads can assign sessions to others'}
            searchable
          />
          <NumberInput label="Timebox (minutes)" min={5} max={480} step={15} value={v.timeboxMinutes} onChange={(x) => set('timeboxMinutes', Number(x) || 60)} error={errors.timeboxMinutes} />
          <Select label="Environment" data={environmentOptions} value={v.environmentId} onChange={pickEnvironment} clearable />
          <TextInput label="Build / version" placeholder="e.g. 2.14.0-rc1" value={v.buildVersion} onChange={(e) => set('buildVersion', e.currentTarget.value)} />
          <TextInput label="Browser" value={v.browser} onChange={(e) => set('browser', e.currentTarget.value)} />
          <TextInput label="OS" value={v.os} onChange={(e) => set('os', e.currentTarget.value)} />
          <TextInput label="Device" value={v.device} onChange={(e) => set('device', e.currentTarget.value)} />
          <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
          <Select label="Milestone" data={milestoneOptions} value={v.milestoneId} onChange={(x) => set('milestoneId', x)} clearable />
          <DateInput label="Due date" value={v.dueDate} onChange={(x) => set('dueDate', x)} clearable valueFormat="MMM D, YYYY" />
        </SimpleGrid>
        <Textarea label="Environment notes" autosize minRows={1} maxRows={4} value={v.environmentNotes} onChange={(e) => set('environmentNotes', e.currentTarget.value)} />
        <TagsInput label="Tags" data={tagNames} value={v.tags} onChange={(x) => set('tags', x)} clearable />
        <Checkbox
          label="Start the timer now and open the workbench"
          checked={v.start && !forOther}
          disabled={forOther}
          description={forOther ? 'Sessions assigned to someone else are created as drafts for them to start.' : undefined}
          onChange={(e) => set('start', e.currentTarget.checked)}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {v.start && !forOther ? 'Start session' : 'Create session'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
