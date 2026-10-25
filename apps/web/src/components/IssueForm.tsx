import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { api, ApiError, p } from '../lib/api';
import { options, PRIORITY, SEVERITY } from '../lib/constants';
import { useProject } from '../lib/project';
import { CustomFieldsInput } from './CustomFields';
import { toastError } from './ui';

type V = {
  title: string;
  description: string;
  severity: string;
  priority: string;
  assigneeId: string | null;
  milestoneId: string | null;
  externalUrl: string;
  customFields: Record<string, unknown>;
};

/** Create or edit an internal issue. Descriptions are plain text (rendered with line breaks). */
export function IssueFormModal({ opened, onClose, issue, onSaved }: { opened: boolean; onClose: () => void; issue?: any; onSaved: (issue: any) => void }) {
  const { pid, memberOptions, milestoneOptions } = useProject();
  const blank: V = { title: '', description: '', severity: 'MAJOR', priority: 'MEDIUM', assigneeId: null, milestoneId: null, externalUrl: '', customFields: {} };
  const [v, setV] = useState<V>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editing = !!issue;

  useEffect(() => {
    if (!opened) return;
    setErrors({});
    setV(
      issue
        ? {
            title: issue.title ?? '',
            description: issue.description ?? '',
            severity: issue.severity,
            priority: issue.priority,
            assigneeId: issue.assigneeId ?? null,
            milestoneId: issue.milestoneId ?? null,
            externalUrl: issue.externalUrl ?? '',
            customFields: issue.customFields ?? {},
          }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const set = <K extends keyof V>(k: K, val: V[K]) => setV((s) => ({ ...s, [k]: val }));

  const submit = async () => {
    if (!v.title.trim()) return setErrors({ title: 'Title is required' });
    setBusy(true);
    setErrors({});
    const body = {
      title: v.title.trim(),
      description: v.description.trim() || null,
      severity: v.severity,
      priority: v.priority,
      assigneeId: v.assigneeId,
      milestoneId: v.milestoneId,
      externalUrl: v.externalUrl.trim() || null,
      customFields: v.customFields,
    };
    try {
      const r = editing ? await api.patch(p(pid, `/issues/${issue.id}`), body) : await api.post(p(pid, '/issues'), body);
      onSaved(r.issue);
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e, 'Could not save issue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="lg" title={<Text fw={700}>{editing ? `Edit ${issue.key}` : 'New issue'}</Text>}>
      <Stack gap="sm">
        <TextInput label="Title" required data-autofocus value={v.title} onChange={(e) => set('title', e.currentTarget.value)} error={errors.title} maxLength={300} />
        <Textarea
          label="Description"
          description="Steps, expected vs. actual, environment and anything a developer needs."
          autosize
          minRows={5}
          maxRows={16}
          value={v.description}
          onChange={(e) => set('description', e.currentTarget.value)}
          error={errors.description}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Severity" data={options(SEVERITY)} value={v.severity} onChange={(x) => set('severity', x ?? 'MAJOR')} allowDeselect={false} />
          <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
          <Select label="Assignee" data={memberOptions} value={v.assigneeId} onChange={(x) => set('assigneeId', x)} clearable searchable placeholder="Unassigned" error={errors.assigneeId} />
          <Select label="Milestone" data={milestoneOptions} value={v.milestoneId} onChange={(x) => set('milestoneId', x)} clearable error={errors.milestoneId} />
        </SimpleGrid>
        <TextInput
          label="External link"
          description="Optional URL of a matching ticket in another tracker (stored as a link only)."
          placeholder="https://"
          type="url"
          value={v.externalUrl}
          onChange={(e) => set('externalUrl', e.currentTarget.value)}
          error={errors.externalUrl}
        />
        <CustomFieldsInput entity="ISSUE" value={v.customFields} onChange={(x) => set('customFields', x)} />
        {!editing && (
          <Alert color="gray" variant="light" icon={<IconPlugConnected size={16} />} p="xs">
            <Text size="xs">
              Labels and a separate environment field are not available on issues yet. Two-way Jira/GitLab sync: <b>planned</b>. GitHub push is available from the issue page when a
              GitHub integration is configured.
            </Text>
          </Alert>
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {editing ? 'Save changes' : 'Create issue'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
