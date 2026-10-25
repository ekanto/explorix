import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Chip,
  Collapse,
  FileButton,
  Group,
  Kbd,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPaperclip, IconSparkles, IconX } from '@tabler/icons-react';
import { api, ApiError, p } from '../lib/api';
import { useAiStatus, type AiMeta } from '../lib/ai';
import { options, PRIORITY, SEVERITY } from '../lib/constants';
import { bytes } from '../lib/format';
import { useProject } from '../lib/project';
import { AiDraftBadge } from './AiNotice';
import { uploadAttachment } from './Attachments';
import { CustomFieldsInput } from './CustomFields';
import { toastError } from './ui';

export type FindingValues = {
  title: string;
  classificationId: string;
  severity: string;
  priority: string;
  description: string;
  reproSteps: string;
  expected: string;
  actual: string;
  environment: string;
  ownerId: string | null;
  requirementId: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
};

const blank = (classificationId: string): FindingValues => ({
  title: '',
  classificationId,
  severity: '',
  priority: 'MEDIUM',
  description: '',
  reproSteps: '',
  expected: '',
  actual: '',
  environment: '',
  ownerId: null,
  requirementId: null,
  tags: [],
  customFields: {},
});

/**
 * Create or edit a finding. In a session, `sessionId` links the finding to the session
 * timeline (the server stamps the elapsed session time). Files chosen/pasted here are
 * uploaded as evidence right after the finding is created.
 */
export function FindingFormModal({
  opened,
  onClose,
  sessionId,
  charterId,
  finding,
  defaults,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  sessionId?: string;
  charterId?: string;
  /** Existing finding for edit mode. */
  finding?: any;
  defaults?: Partial<FindingValues>;
  onSaved: (finding: any) => void;
}) {
  const { pid, classifications, memberOptions, tagNames } = useProject();
  const active = classifications.filter((c) => !c.archivedAt).sort((a, b) => a.position - b.position);
  const fallback = active.find((c) => c.key === 'observation')?.id ?? active[0]?.id ?? '';
  const [v, setV] = useState<FindingValues>(blank(fallback));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);
  const [aiNotes, setAiNotes] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMeta, setAiMeta] = useState<AiMeta | null>(null);
  const ai = useAiStatus();
  const editing = !!finding;

  useEffect(() => {
    if (!opened) return;
    setErrors({});
    setFiles([]);
    setAiMeta(null);
    setAiOpen(false);
    if (finding) {
      setV({
        title: finding.title ?? '',
        classificationId: finding.classificationId ?? finding.classification?.id ?? fallback,
        severity: finding.severity ?? '',
        priority: finding.priority ?? 'MEDIUM',
        description: finding.description ?? '',
        reproSteps: finding.reproSteps ?? '',
        expected: finding.expected ?? '',
        actual: finding.actual ?? '',
        environment: finding.environment ?? '',
        ownerId: finding.ownerId ?? finding.owner?.id ?? null,
        requirementId: finding.requirementId ?? finding.requirement?.id ?? null,
        tags: finding.tags ?? [],
        customFields: finding.customFields ?? {},
      });
      setMore(true);
    } else {
      setV({ ...blank(fallback), ...defaults });
      setMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const set = <K extends keyof FindingValues>(k: K, val: FindingValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const cls = active.find((c) => c.id === v.classificationId);

  // Classification shortcuts: Alt+<digit/letter> inside the modal.
  useEffect(() => {
    if (!opened) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const hit = active.find((c) => c.shortcut && c.shortcut.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        set('classificationId', hit.id);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        setFiles((f) => [...f, ...pasted.map((x) => (x.name === 'image.png' ? new File([x], `screenshot-${Date.now()}.png`, { type: x.type }) : x))]);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, active.length]);

  const [debouncedTitle] = useDebouncedValue(v.title, 500);
  const similar = useQuery({
    queryKey: ['similar-findings', pid, debouncedTitle],
    queryFn: () => api.post(p(pid, '/findings/similar'), { title: debouncedTitle, text: v.actual || undefined }),
    enabled: opened && !editing && debouncedTitle.trim().length >= 5,
  });
  const reqs = useQuery({
    queryKey: ['requirements-options', pid],
    queryFn: () => api.get(p(pid, '/requirements'), { pageSize: 200 }),
    enabled: opened && more,
    staleTime: 60_000,
  });

  const runAi = async () => {
    setAiBusy(true);
    try {
      const r = await api.post(p(pid, '/ai/defect-report'), { notes: aiNotes, sessionId });
      const d = r.draft;
      const c = active.find((x) => x.key === d.classificationKey);
      setV((s) => ({
        ...s,
        title: d.title ?? s.title,
        description: d.description ?? s.description,
        reproSteps: d.reproSteps ?? s.reproSteps,
        expected: d.expected ?? s.expected,
        actual: d.actual ?? s.actual,
        severity: d.severity ?? s.severity,
        environment: d.environment ?? s.environment,
        classificationId: c?.id ?? s.classificationId,
      }));
      setAiMeta(r.meta);
      setMore(true);
      setAiOpen(false);
    } catch (e) {
      toastError(e, 'AI draft failed');
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async () => {
    if (!v.title.trim()) {
      setErrors({ title: 'Title is required' });
      return;
    }
    setSaving(true);
    setErrors({});
    const body = {
      title: v.title.trim(),
      classificationId: v.classificationId,
      severity: v.severity || undefined,
      priority: v.priority,
      description: v.description || null,
      reproSteps: v.reproSteps || null,
      expected: v.expected || null,
      actual: v.actual || null,
      environment: v.environment || (editing ? null : undefined),
      ownerId: v.ownerId,
      requirementId: v.requirementId,
      tags: v.tags,
      customFields: v.customFields,
    };
    try {
      let saved: any;
      if (editing) {
        saved = (await api.patch(p(pid, `/findings/${finding.id}`), body)).finding;
      } else {
        saved = (await api.post(p(pid, '/findings'), { ...body, sessionId, charterId: sessionId ? undefined : charterId })).finding;
        for (const f of files) {
          try {
            await uploadAttachment(pid, 'finding', saved.id, f);
          } catch (e) {
            toastError(e, `Could not upload ${f.name}`);
          }
        }
      }
      onSaved(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e, 'Could not save finding');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      title={<Text fw={700}>{editing ? `Edit ${finding.key}` : 'Capture finding'}</Text>}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
    >
      <Stack gap="sm">
        <div>
          <Text size="sm" fw={500} mb={6}>
            Classification
          </Text>
          <Chip.Group value={v.classificationId} onChange={(x) => set('classificationId', x as string)}>
            <Group gap={6}>
              {active.map((c) => (
                <Chip key={c.id} value={c.id} color={c.color} size="sm" variant="light">
                  {c.name}
                  {c.shortcut ? <Kbd size="xs" ml={6}>Alt+{c.shortcut}</Kbd> : null}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
          {cls && (
            <Text size="xs" c="dimmed" mt={4}>
              {cls.isDefect ? 'Counts as a defect in reports.' : 'Not counted as a defect — observations stay separate from confirmed bugs.'}
            </Text>
          )}
        </div>

        {ai.data?.enabled && !editing && (
          <>
            <Group gap="xs">
              <Button size="compact-sm" variant="light" color="grape" leftSection={<IconSparkles size={14} />} onClick={() => setAiOpen((o) => !o)}>
                Structure from rough notes
              </Button>
              <AiDraftBadge meta={aiMeta} />
            </Group>
            <Collapse expanded={aiOpen}>
              <Paper withBorder p="sm">
                <Textarea
                  autosize
                  minRows={3}
                  placeholder="Paste or type what you saw; AI drafts title, steps, expected/actual. You review everything before saving."
                  value={aiNotes}
                  onChange={(e) => setAiNotes(e.currentTarget.value)}
                />
                <Group justify="flex-end" mt="xs">
                  <Button size="xs" color="grape" onClick={runAi} loading={aiBusy} disabled={aiNotes.trim().length < 10}>
                    Draft fields
                  </Button>
                </Group>
              </Paper>
            </Collapse>
          </>
        )}

        <TextInput
          label="Title"
          required
          data-autofocus
          placeholder="What did you notice?"
          value={v.title}
          onChange={(e) => set('title', e.currentTarget.value)}
          error={errors.title}
          maxLength={300}
        />

        {!editing && (similar.data?.suggestions?.length ?? 0) > 0 && (
          <Paper withBorder p="xs" bg="var(--ex-subtle)">
            <Text size="xs" fw={600} mb={4}>
              Possibly similar findings (nothing is merged automatically)
            </Text>
            <Stack gap={2}>
              {similar.data.suggestions.map((s: any) => (
                <Group key={s.id} gap={6}>
                  <Anchor href={`/projects/${pid}/findings/${s.id}`} target="_blank" size="xs" className="ex-key">
                    {s.key}
                  </Anchor>
                  <Text size="xs" lineClamp={1} style={{ flex: 1 }}>
                    {s.title}
                  </Text>
                  <Badge size="xs" variant="outline">
                    {Math.round(s.score * 100)}% match
                  </Badge>
                </Group>
              ))}
            </Stack>
          </Paper>
        )}

        <SimpleGrid cols={2}>
          <Select label="Severity" placeholder={cls?.isDefect ? 'Default: Major' : 'Default: Minor'} data={options(SEVERITY)} value={v.severity || null} onChange={(x) => set('severity', x ?? '')} clearable />
          <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Textarea label="Actual behavior" autosize minRows={2} maxRows={8} value={v.actual} onChange={(e) => set('actual', e.currentTarget.value)} error={errors.actual} />
          <Textarea label="Expected behavior" autosize minRows={2} maxRows={8} value={v.expected} onChange={(e) => set('expected', e.currentTarget.value)} error={errors.expected} />
        </SimpleGrid>
        <Textarea
          label="Reproduction steps"
          placeholder={'1. …\n2. …'}
          autosize
          minRows={2}
          maxRows={10}
          value={v.reproSteps}
          onChange={(e) => set('reproSteps', e.currentTarget.value)}
          error={errors.reproSteps}
        />

        <Anchor component="button" type="button" size="sm" onClick={() => setMore((m) => !m)} ta="left">
          {more ? 'Hide' : 'Show'} details (description, owner, requirement, tags, environment, custom fields)
        </Anchor>
        <Collapse expanded={more}>
          <Stack gap="sm">
            <Textarea label="Description / context" autosize minRows={2} maxRows={10} value={v.description} onChange={(e) => set('description', e.currentTarget.value)} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select label="Owner" data={memberOptions} value={v.ownerId} onChange={(x) => set('ownerId', x)} clearable searchable />
              <Select
                label="Related requirement"
                data={(reqs.data?.requirements ?? []).map((r: any) => ({ value: r.id, label: `${r.key} ${r.title}` }))}
                value={v.requirementId}
                onChange={(x) => set('requirementId', x)}
                clearable
                searchable
                nothingFoundMessage={reqs.isLoading ? 'Loading…' : 'No requirements'}
              />
            </SimpleGrid>
            <TextInput
              label="Environment"
              placeholder={sessionId ? 'Defaults to the session environment' : 'Browser / OS / build'}
              value={v.environment}
              onChange={(e) => set('environment', e.currentTarget.value)}
            />
            <TagsInput label="Tags" data={tagNames} value={v.tags} onChange={(x) => set('tags', x)} clearable />
            <CustomFieldsInput entity="FINDING" value={v.customFields} onChange={(x) => set('customFields', x)} />
          </Stack>
        </Collapse>

        {!editing && (
          <Group gap="xs">
            <FileButton onChange={(f) => setFiles((s) => [...s, ...f])} multiple>
              {(props) => (
                <Button {...props} variant="default" size="xs" leftSection={<IconPaperclip size={14} />}>
                  Add evidence
                </Button>
              )}
            </FileButton>
            <Text size="xs" c="dimmed">
              or paste a screenshot (Ctrl+V)
            </Text>
            {files.map((f, i) => (
              <Badge
                key={i}
                variant="light"
                rightSection={
                  <ActionIcon size="xs" variant="transparent" aria-label={`Remove ${f.name}`} onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}>
                    <IconX size={10} />
                  </ActionIcon>
                }
              >
                {f.name} · {bytes(f.size)}
              </Badge>
            ))}
          </Group>
        )}

        <Group justify="space-between" mt="xs">
          <Text size="xs" c="dimmed">
            <Kbd size="xs">Ctrl</Kbd>+<Kbd size="xs">Enter</Kbd> to save
          </Text>
          <Group>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              {editing ? 'Save changes' : 'Save finding'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
