import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  ColorInput,
  ColorSwatch,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { IconArchive, IconArchiveOff, IconCheck, IconDots, IconEdit, IconLock, IconPlus, IconTrash, IconUserPlus } from '@tabler/icons-react';
import { api, ApiError, p } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, titleCase } from '../../lib/format';
import { RESULT_CATEGORY, ROLE_LABEL, SESSION_STATUS } from '../../lib/constants';
import { projectKey, useProject } from '../../lib/project';
import { PageHeader, UserAvatar, toastError, toastOk } from '../../components/ui';

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'members', label: 'Members' },
  { value: 'milestones', label: 'Milestones' },
  { value: 'environments', label: 'Environments' },
  { value: 'tags', label: 'Tags' },
  { value: 'fields', label: 'Custom fields' },
  { value: 'classifications', label: 'Finding classifications' },
  { value: 'statuses', label: 'Statuses' },
  { value: 'danger', label: 'Danger zone' },
];

const COLOR_NAMES = ['gray', 'red', 'pink', 'grape', 'violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'dark'];
const ROLES = ['VIEWER', 'TESTER', 'LEAD', 'ADMIN'] as const;
const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

function useInvalidateProject() {
  const { pid } = useProject();
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: projectKey(pid) });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };
}

function ReadOnlyNote({ need }: { need: 'LEAD' | 'ADMIN' }) {
  const { project, can } = useProject();
  if (can(need)) return null;
  return (
    <Alert color="gray" variant="light" icon={<IconLock size={16} />} mb="md">
      {project.archivedAt ? 'This project is archived, so its settings are read-only.' : `Read-only — only ${need === 'LEAD' ? 'leads and project admins' : 'project admins'} can change these settings.`}
    </Alert>
  );
}

export default function ProjectSettings() {
  const { project } = useProject();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab')! : 'general';

  return (
    <>
      <PageHeader kicker={project.key} title="Project settings" subtitle="Configure how this project works: people, workflow vocabulary and defaults." />
      {project.archivedAt && (
        <Alert color="orange" icon={<IconArchive size={18} />} mb="md" title="Archived project">
          Archived {fmtDate(project.archivedAt)}. Everything is read-only until a project admin restores it from the Danger zone tab.
        </Alert>
      )}
      <Tabs
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(sp);
          if (!v || v === 'general') next.delete('tab');
          else next.set('tab', v);
          setSp(next, { replace: true });
        }}
        keepMounted={false}
      >
        <Tabs.List mb="md" className="ex-no-print">
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value} color={t.value === 'danger' ? 'red' : undefined}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="general">
          <GeneralTab />
        </Tabs.Panel>
        <Tabs.Panel value="members">
          <MembersTab />
        </Tabs.Panel>
        <Tabs.Panel value="milestones">
          <MilestonesTab />
        </Tabs.Panel>
        <Tabs.Panel value="environments">
          <EnvironmentsTab />
        </Tabs.Panel>
        <Tabs.Panel value="tags">
          <TagsTab />
        </Tabs.Panel>
        <Tabs.Panel value="fields">
          <FieldsTab />
        </Tabs.Panel>
        <Tabs.Panel value="classifications">
          <ClassificationsTab />
        </Tabs.Panel>
        <Tabs.Panel value="statuses">
          <StatusesTab />
        </Tabs.Panel>
        <Tabs.Panel value="danger">
          <DangerTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------- General

function GeneralTab() {
  const { pid, project, can } = useProject();
  const editable = can('ADMIN');
  const invalidate = useInvalidateProject();
  const initial = useMemo(
    () => ({ name: project.name, description: project.description ?? '', color: project.color, ...project.settings }),
    [project],
  );
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setF(initial), [initial]);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () =>
      api.patch(p(pid), {
        name: f.name.trim(),
        description: f.description.trim() || null,
        color: f.color,
        settings: {
          requireReview: f.requireReview,
          allowSelfReview: f.allowSelfReview,
          lockCompletedSessions: f.lockCompletedSessions,
          defaultTimeboxMinutes: f.defaultTimeboxMinutes,
          allowTesterCharterEdit: f.allowTesterCharterEdit,
        },
      }),
    onSuccess: () => {
      setErrors({});
      toastOk('Project settings saved');
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e);
    },
  });

  return (
    <Stack maw={760}>
      <ReadOnlyNote need="ADMIN" />
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Project details
        </Title>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Name" required value={f.name} onChange={(e) => set('name', e.currentTarget.value)} readOnly={!editable} error={errors.name} maxLength={100} />
            <TextInput label="Key" value={project.key} readOnly description="Prefix for IDs such as findings and issues — cannot be changed." styles={{ input: { fontFamily: 'monospace' } }} />
          </SimpleGrid>
          <Textarea label="Description" autosize minRows={2} maxRows={6} value={f.description} onChange={(e) => set('description', e.currentTarget.value)} readOnly={!editable} error={errors.description} />
          <ColorInput
            label="Color"
            w={220}
            format="hex"
            value={f.color}
            onChange={(v) => set('color', v)}
            readOnly={!editable}
            disallowInput={!editable}
            withPicker={editable}
            swatches={['#0ca678', '#1c7ed6', '#7048e8', '#e8590c', '#f08c00', '#c2255c', '#2f9e44', '#495057']}
            error={errors.color}
          />
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Workflow
        </Title>
        <Stack gap="md">
          <Switch
            label="Require review of completed sessions"
            description="Finishing a session sends it straight to In review for a lead's approval. Otherwise it becomes Completed and can optionally be submitted for review."
            checked={f.requireReview}
            onChange={(e) => set('requireReview', e.currentTarget.checked)}
            disabled={!editable}
          />
          <Switch
            label="Allow self-review"
            description="Leads may approve sessions they ran themselves."
            checked={f.allowSelfReview}
            onChange={(e) => set('allowSelfReview', e.currentTarget.checked)}
            disabled={!editable}
          />
          <Switch
            label="Lock completed sessions"
            description="Session notes and content can't be edited once the session is finished."
            checked={f.lockCompletedSessions}
            onChange={(e) => set('lockCompletedSessions', e.currentTarget.checked)}
            disabled={!editable}
          />
          <Switch
            label="Testers can edit charters"
            description="Testers may edit charters created by others. Otherwise testers can only edit their own charters."
            checked={f.allowTesterCharterEdit}
            onChange={(e) => set('allowTesterCharterEdit', e.currentTarget.checked)}
            disabled={!editable}
          />
          <NumberInput
            label="Default timebox (minutes)"
            description="Suggested session length for new charters (5–480)."
            w={260}
            min={5}
            max={480}
            step={15}
            value={f.defaultTimeboxMinutes}
            onChange={(v) => set('defaultTimeboxMinutes', typeof v === 'number' ? v : Number(v) || 60)}
            readOnly={!editable}
            error={errors['settings.defaultTimeboxMinutes']}
          />
        </Stack>
      </Paper>
      {editable && (
        <Group>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || f.name.trim().length < 2 || f.defaultTimeboxMinutes < 5 || f.defaultTimeboxMinutes > 480}>
            Save changes
          </Button>
          {dirty && (
            <Button variant="subtle" color="gray" onClick={() => setF(initial)}>
              Discard
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------- Members

function MembersTab() {
  const { pid, members, can } = useProject();
  const { user } = useAuth();
  const editable = can('ADMIN');
  const invalidate = useInvalidateProject();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: { id: string; name: string; email: string }[] }>('/users'), enabled: editable });
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string>('TESTER');
  const memberIds = new Set(members.map((m) => m.user.id));
  const candidates = (users.data?.users ?? []).filter((u) => !memberIds.has(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }));
  const adminCount = members.filter((m) => m.role === 'ADMIN').length;

  const add = useMutation({
    mutationFn: () => api.post(p(pid, '/members'), { userId, role }),
    onSuccess: () => {
      toastOk('Member added');
      setUserId(null);
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const change = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(p(pid, `/members/${id}`), { role }),
    onSuccess: () => {
      toastOk('Role updated');
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(p(pid, `/members/${id}`)),
    onSuccess: () => {
      toastOk('Member removed');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  return (
    <Stack>
      <ReadOnlyNote need="ADMIN" />
      {editable && (
        <Paper withBorder p="md">
          <Text fw={600} size="sm" mb="xs">
            Add a member
          </Text>
          <Group align="flex-end" gap="sm">
            <Select
              label="Organization user"
              placeholder={users.isLoading ? 'Loading users…' : candidates.length ? 'Search by name or email' : 'Everyone is already a member'}
              searchable
              data={candidates}
              value={userId}
              onChange={setUserId}
              w={360}
              nothingFoundMessage="No matching users"
            />
            <Select label="Role" data={roleOptions} value={role} onChange={(v) => setRole(v ?? 'TESTER')} w={170} allowDeselect={false} />
            <Button leftSection={<IconUserPlus size={16} />} onClick={() => add.mutate()} loading={add.isPending} disabled={!userId}>
              Add
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            Only existing organization users can be added. Organization admins create accounts in <Link to="/admin" className="ex-link">Administration</Link>. Org owners and admins can open every project
            as implicit project admins.
          </Text>
        </Paper>
      )}
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Member</Table.Th>
              <Table.Th w={220}>Role</Table.Th>
              <Table.Th w={60} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {members.map((m) => {
              const lastAdmin = m.role === 'ADMIN' && adminCount <= 1;
              return (
                <Table.Tr key={m.id} opacity={m.user.deactivatedAt ? 0.6 : 1}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <UserAvatar user={m.user} />
                      <div>
                        <Text size="sm" fw={500}>
                          {m.user.name}
                          {m.user.id === user?.id && (
                            <Text span c="dimmed" size="xs">
                              {' '}
                              (you)
                            </Text>
                          )}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {m.user.email}
                        </Text>
                      </div>
                      {m.user.deactivatedAt && (
                        <Badge size="xs" color="gray" variant="outline">
                          Deactivated
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {editable ? (
                      <Tooltip label="A project must keep at least one project admin" disabled={!lastAdmin}>
                        <Select
                          size="xs"
                          data={roleOptions.map((o) => ({ ...o, disabled: lastAdmin && o.value !== 'ADMIN' }))}
                          value={m.role}
                          allowDeselect={false}
                          onChange={(v) => v && v !== m.role && change.mutate({ id: m.id, role: v })}
                          w={180}
                        />
                      </Tooltip>
                    ) : (
                      <Badge variant="light" color={m.role === 'ADMIN' ? 'grape' : m.role === 'LEAD' ? 'blue' : m.role === 'TESTER' ? 'teal' : 'gray'}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {editable && (
                      <Tooltip label={lastAdmin ? 'Cannot remove the last project admin' : 'Remove from project'}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={lastAdmin}
                          aria-label={`Remove ${m.user.name}`}
                          onClick={() =>
                            modals.openConfirmModal({
                              title: `Remove ${m.user.name}?`,
                              children: <Text size="sm">They lose access to this project. Their sessions, findings and results are kept.</Text>,
                              labels: { confirm: 'Remove', cancel: 'Cancel' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => remove.mutate(m.id),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Paper>
      <Paper withBorder p="md">
        <Text fw={600} size="sm" mb={6}>
          What each role can do
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
          {[
            ['VIEWER', 'Read-only access to everything in the project.'],
            ['TESTER', 'Run sessions, log findings, write charters and test cases, execute test runs, create issues, import automation results.'],
            ['LEAD', 'Plus: review sessions, test plans, templates, milestones, environments, tags, view integrations, delete runs.'],
            ['ADMIN', 'Plus: members, project details, custom fields, classifications, statuses, integrations and archiving.'],
          ].map(([r, d]) => (
            <div key={r}>
              <Text size="sm" fw={500}>
                {ROLE_LABEL[r]}
              </Text>
              <Text size="xs" c="dimmed">
                {d}
              </Text>
            </div>
          ))}
        </SimpleGrid>
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------- Generic CRUD

type Values = Record<string, any>;
type FieldSpec = {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'color' | 'date' | 'switch' | 'number' | 'tags';
  required?: boolean;
  options?: { value: string; label: string }[];
  description?: ReactNode;
  placeholder?: string;
  createOnly?: boolean;
  show?: (v: Values) => boolean;
  mono?: boolean;
  span?: 1 | 2;
};
type Column<T> = { label: string; render: (item: T) => ReactNode; w?: number };

function ColorNamePicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const theme = useMantineTheme();
  return (
    <Group gap={6}>
      {COLOR_NAMES.map((c) => (
        <Tooltip key={c} label={c}>
          <ColorSwatch
            component="button"
            type="button"
            color={theme.colors[c][6]}
            size={22}
            onClick={() => !disabled && onChange(c)}
            style={{ cursor: disabled ? 'default' : 'pointer', color: '#fff' }}
            aria-label={c}
          >
            {value === c && <IconCheck size={13} />}
          </ColorSwatch>
        </Tooltip>
      ))}
    </Group>
  );
}

function ColorDot({ color }: { color?: string | null }) {
  const theme = useMantineTheme();
  const c = color && theme.colors[color] ? theme.colors[color][6] : color || theme.colors.gray[5];
  return <ColorSwatch color={c} size={14} />;
}

function FieldInput({ spec, values, setValue, errors, editing }: { spec: FieldSpec; values: Values; setValue: (k: string, v: unknown) => void; errors: Record<string, string>; editing: boolean }) {
  const v = values[spec.key];
  const ro = editing && spec.createOnly;
  const common = { label: spec.label, description: spec.description, error: errors[spec.key], required: spec.required };
  switch (spec.kind) {
    case 'textarea':
      return <Textarea {...common} autosize minRows={2} maxRows={6} value={v ?? ''} onChange={(e) => setValue(spec.key, e.currentTarget.value)} />;
    case 'select':
      return <Select {...common} data={spec.options ?? []} value={v ?? null} onChange={(x) => setValue(spec.key, x)} allowDeselect={!spec.required} disabled={ro} />;
    case 'color':
      return (
        <div>
          <Text size="sm" fw={500} mb={4}>
            {spec.label}
          </Text>
          <ColorNamePicker value={v} onChange={(x) => setValue(spec.key, x)} />
        </div>
      );
    case 'date':
      return <DatePickerInput {...common} clearable value={v || null} onChange={(x) => setValue(spec.key, x)} valueFormat="YYYY-MM-DD" />;
    case 'switch':
      return <Switch label={spec.label} description={spec.description} checked={!!v} onChange={(e) => setValue(spec.key, e.currentTarget.checked)} mt="xs" />;
    case 'number':
      return <NumberInput {...common} value={v ?? 0} min={0} max={1000} onChange={(x) => setValue(spec.key, typeof x === 'number' ? x : Number(x) || 0)} />;
    case 'tags':
      return <TagsInput {...common} value={v ?? []} onChange={(x) => setValue(spec.key, x)} placeholder={spec.placeholder} clearable />;
    default:
      return (
        <TextInput
          {...common}
          value={v ?? ''}
          placeholder={spec.placeholder}
          readOnly={ro}
          onChange={(e) => setValue(spec.key, e.currentTarget.value)}
          styles={spec.mono ? { input: { fontFamily: 'monospace' } } : undefined}
        />
      );
  }
}

function CrudSection<T extends { id: string }>({
  path,
  noun,
  intro,
  items,
  need,
  columns,
  fields,
  toForm,
  toBody,
  archivable,
  canDelete,
  deleteHint,
  rowKey,
}: {
  path: string;
  noun: string;
  intro?: ReactNode;
  items: T[];
  need: 'LEAD' | 'ADMIN';
  columns: Column<T>[];
  fields: FieldSpec[];
  toForm: (item: T | null) => Values;
  toBody: (v: Values, editing: boolean) => Values;
  archivable?: boolean;
  canDelete?: (item: T) => boolean | string;
  deleteHint?: string;
  rowKey?: (item: T) => string;
}) {
  const { pid, can } = useProject();
  const editable = can(need);
  const invalidate = useInvalidateProject();
  const [modal, setModal] = useState<T | 'new' | null>(null);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editingItem = modal && modal !== 'new' ? modal : null;

  const open = (item: T | 'new') => {
    setErrors({});
    setValues(toForm(item === 'new' ? null : item));
    setModal(item);
  };
  const save = useMutation({
    mutationFn: () => {
      const body = toBody(values, !!editingItem);
      return editingItem ? api.patch(p(pid, `/${path}/${editingItem.id}`), body) : api.post(p(pid, `/${path}`), body);
    },
    onSuccess: () => {
      toastOk(editingItem ? `${noun} updated` : `${noun} created`);
      invalidate();
      setModal(null);
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e);
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Values }) => api.patch(p(pid, `/${path}/${id}`), body),
    onSuccess: () => invalidate(),
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(pid, `/${path}/${id}`)),
    onSuccess: () => {
      toastOk(`${noun} deleted`);
      invalidate();
    },
    onError: (e) => toastError(e, `Could not delete ${noun.toLowerCase()}`),
  });

  const missingRequired = fields.some((f) => f.required && (!f.show || f.show(values)) && (values[f.key] === undefined || values[f.key] === null || String(values[f.key]).trim() === ''));

  return (
    <Stack>
      <ReadOnlyNote need={need} />
      <Group justify="space-between" align="flex-start">
        <Text size="sm" c="dimmed" maw={720}>
          {intro}
        </Text>
        {editable && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')}>
            New {noun.toLowerCase()}
          </Button>
        )}
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {columns.map((c) => (
                  <Table.Th key={c.label} w={c.w}>
                    {c.label}
                  </Table.Th>
                ))}
                {editable && <Table.Th w={50} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={columns.length + 1}>
                    <Text size="sm" c="dimmed" ta="center" py="md">
                      Nothing here yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {items.map((item) => {
                const archived = !!(item as any).archivedAt;
                const deletable = canDelete ? canDelete(item) : true;
                return (
                  <Table.Tr key={rowKey ? rowKey(item) : item.id} opacity={archived ? 0.55 : 1}>
                    {columns.map((c) => (
                      <Table.Td key={c.label}>{c.render(item)}</Table.Td>
                    ))}
                    {editable && (
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label="Actions">
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => open(item)}>
                              Edit
                            </Menu.Item>
                            {archivable && (
                              <Menu.Item
                                leftSection={archived ? <IconArchiveOff size={14} /> : <IconArchive size={14} />}
                                onClick={() => patch.mutate({ id: item.id, body: { archived: !archived } })}
                              >
                                {archived ? 'Restore' : 'Archive'}
                              </Menu.Item>
                            )}
                            <Menu.Divider />
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              disabled={deletable !== true}
                              onClick={() =>
                                modals.openConfirmModal({
                                  title: `Delete this ${noun.toLowerCase()}?`,
                                  children: <Text size="sm">{deleteHint ?? 'This cannot be undone.'}</Text>,
                                  labels: { confirm: 'Delete', cancel: 'Cancel' },
                                  confirmProps: { color: 'red' },
                                  onConfirm: () => del.mutate(item.id),
                                })
                              }
                            >
                              {typeof deletable === 'string' ? deletable : 'Delete'}
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    )}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={!!modal} onClose={() => setModal(null)} title={editingItem ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`} size="lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {fields
              .filter((f) => !f.show || f.show(values))
              .map((f) => (
                <div key={f.key} style={{ gridColumn: f.span === 2 || f.kind === 'textarea' || f.kind === 'color' || f.kind === 'tags' ? '1 / -1' : undefined }}>
                  <FieldInput spec={f} values={values} errors={errors} editing={!!editingItem} setValue={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
                </div>
              ))}
          </SimpleGrid>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={missingRequired}>
              {editingItem ? 'Save' : 'Create'}
            </Button>
          </Group>
        </form>
      </Modal>
    </Stack>
  );
}

const nn = (v: unknown) => (typeof v === 'string' ? v.trim() || null : (v ?? null));
const dayOf = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
const ArchivedBadge = ({ item }: { item: any }) =>
  item.archivedAt ? (
    <Badge size="xs" color="gray" variant="outline" ml={6}>
      Archived
    </Badge>
  ) : null;

// ---------------------------------------------------------------------------- Milestones

const MILESTONE_STATUS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: 'Planned', color: 'gray' },
  ACTIVE: { label: 'Active', color: 'blue' },
  RELEASED: { label: 'Released', color: 'teal' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
};

function MilestonesTab() {
  const { milestones, pid } = useProject();
  return (
    <CrudSection
      path="milestones"
      noun="Milestone"
      intro="Milestones (releases, sprints) group charters, sessions, test runs, automation runs and issues for reporting and readiness."
      items={milestones}
      need="LEAD"
      columns={[
        {
          label: 'Name',
          render: (m) => (
            <>
              <Link to={`/projects/${pid}/reports?milestoneId=${m.id}`} className="ex-link">
                {m.name}
              </Link>
              {m.description && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {m.description}
                </Text>
              )}
            </>
          ),
        },
        {
          label: 'Status',
          w: 130,
          render: (m) => (
            <Badge variant="light" color={MILESTONE_STATUS[m.status]?.color}>
              {MILESTONE_STATUS[m.status]?.label ?? m.status}
            </Badge>
          ),
        },
        { label: 'Start', w: 130, render: (m) => (m.startDate ? fmtDate(m.startDate) : '—') },
        { label: 'Due', w: 130, render: (m) => (m.dueDate ? fmtDate(m.dueDate) : '—') },
      ]}
      fields={[
        { key: 'name', label: 'Name', kind: 'text', required: true },
        { key: 'status', label: 'Status', kind: 'select', required: true, options: Object.entries(MILESTONE_STATUS).map(([value, v]) => ({ value, label: v.label })) },
        { key: 'startDate', label: 'Start date', kind: 'date' },
        { key: 'dueDate', label: 'Due date', kind: 'date' },
        { key: 'description', label: 'Description', kind: 'textarea' },
      ]}
      toForm={(m) => ({ name: m?.name ?? '', status: m?.status ?? 'PLANNED', startDate: dayOf(m?.startDate), dueDate: dayOf(m?.dueDate), description: m?.description ?? '' })}
      toBody={(v) => ({ name: v.name.trim(), status: v.status, startDate: v.startDate || null, dueDate: v.dueDate || null, description: nn(v.description) })}
      deleteHint="Items linked to this milestone are kept but lose the link. Consider setting the status to Released or Cancelled instead."
    />
  );
}

// ---------------------------------------------------------------------------- Environments

function EnvironmentsTab() {
  const { environments } = useProject();
  return (
    <CrudSection
      path="environments"
      noun="Environment"
      intro="Environments describe where testing happens. Testers pick one when starting sessions and test runs; automation runs reference them by name."
      items={environments}
      need="LEAD"
      columns={[
        {
          label: 'Name',
          render: (e) => (
            <>
              <Text size="sm" fw={500}>
                {e.name}
              </Text>
              {e.description && (
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {e.description}
                </Text>
              )}
            </>
          ),
        },
        {
          label: 'URL',
          render: (e) =>
            e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="ex-link">
                {e.url}
              </a>
            ) : (
              '—'
            ),
        },
        { label: 'Browser / OS / device', render: (e) => [e.browser, e.os, e.device].filter(Boolean).join(' · ') || '—' },
      ]}
      fields={[
        { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Staging' },
        { key: 'url', label: 'URL', kind: 'text', placeholder: 'https://staging.example.com' },
        { key: 'browser', label: 'Browser', kind: 'text', placeholder: 'Chrome 126' },
        { key: 'os', label: 'OS', kind: 'text', placeholder: 'macOS 14' },
        { key: 'device', label: 'Device', kind: 'text', placeholder: 'Desktop' },
        { key: 'description', label: 'Description', kind: 'textarea' },
      ]}
      toForm={(e) => ({ name: e?.name ?? '', url: e?.url ?? '', browser: e?.browser ?? '', os: e?.os ?? '', device: e?.device ?? '', description: e?.description ?? '' })}
      toBody={(v) => ({ name: v.name.trim(), url: v.url.trim(), browser: nn(v.browser), os: nn(v.os), device: nn(v.device), description: nn(v.description) })}
      deleteHint="Sessions and runs that used this environment keep their history but lose the link."
    />
  );
}

// ---------------------------------------------------------------------------- Tags

function TagsTab() {
  const { tags } = useProject();
  return (
    <CrudSection
      path="tags"
      noun="Tag"
      intro="Tags are shared across charters, sessions, findings, test cases and issues. Names are stored in lowercase. Tags typed elsewhere may also be created on the fly."
      items={tags}
      need="LEAD"
      columns={[
        {
          label: 'Tag',
          render: (t) => (
            <Badge variant="light" color={t.color ?? 'gray'} tt="none">
              {t.name}
            </Badge>
          ),
        },
        {
          label: 'Color',
          w: 160,
          render: (t) => (
            <Group gap={6}>
              <ColorDot color={t.color} />
              <Text size="xs">{t.color ?? 'gray'}</Text>
            </Group>
          ),
        },
      ]}
      fields={[
        { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'checkout' },
        { key: 'color', label: 'Color', kind: 'color' },
      ]}
      toForm={(t) => ({ name: t?.name ?? '', color: t?.color ?? 'gray' })}
      toBody={(v) => ({ name: v.name.trim(), color: v.color })}
      deleteHint="The tag is removed from this list. Items that already carry the tag name keep it."
    />
  );
}

// ---------------------------------------------------------------------------- Custom fields

const ENTITY_LABEL: Record<string, string> = { CHARTER: 'Charter', SESSION: 'Session', FINDING: 'Finding', TEST_CASE: 'Test case', ISSUE: 'Issue' };
const FIELD_TYPE_LABEL: Record<string, string> = {
  TEXT: 'Text',
  TEXTAREA: 'Long text',
  NUMBER: 'Number',
  SELECT: 'Single select',
  MULTI_SELECT: 'Multi select',
  CHECKBOX: 'Checkbox',
  DATE: 'Date',
  URL: 'URL',
};
const toOpts = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
const isSelect = (v: Values) => v.type === 'SELECT' || v.type === 'MULTI_SELECT';

function FieldsTab() {
  const { customFields } = useProject();
  const [entity, setEntity] = useState<string | null>(null);
  const items = customFields.filter((f) => !entity || f.entity === entity);
  return (
    <Stack>
      <Group>
        <Select placeholder="All entities" data={toOpts(ENTITY_LABEL)} value={entity} onChange={setEntity} clearable w={200} size="xs" />
      </Group>
      <CrudSection
        path="custom-fields"
        noun="Custom field"
        intro="Custom fields add project-specific attributes to forms and detail pages. Archive a field to hide it from forms while keeping existing values."
        items={items}
        need="ADMIN"
        archivable
        columns={[
          {
            label: 'Field',
            render: (f) => (
              <>
                <Text size="sm" fw={500} span>
                  {f.label}
                </Text>
                {f.required && (
                  <Text span c="red" size="sm">
                    {' '}
                    *
                  </Text>
                )}
                <ArchivedBadge item={f} />
                <Text size="xs" c="dimmed" ff="monospace">
                  {f.key}
                </Text>
              </>
            ),
          },
          { label: 'Entity', w: 120, render: (f) => ENTITY_LABEL[f.entity] ?? f.entity },
          {
            label: 'Type',
            w: 260,
            render: (f) => (
              <>
                <Text size="sm">{FIELD_TYPE_LABEL[f.type] ?? f.type}</Text>
                {f.options?.length > 0 && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {f.options.join(', ')}
                  </Text>
                )}
              </>
            ),
          },
          { label: 'Order', w: 70, render: (f) => f.position },
        ]}
        fields={[
          { key: 'entity', label: 'Applies to', kind: 'select', required: true, options: toOpts(ENTITY_LABEL), createOnly: true },
          { key: 'type', label: 'Type', kind: 'select', required: true, options: toOpts(FIELD_TYPE_LABEL) },
          { key: 'label', label: 'Label', kind: 'text', required: true, placeholder: 'Browser build' },
          {
            key: 'key',
            label: 'Key',
            kind: 'text',
            required: true,
            mono: true,
            createOnly: true,
            placeholder: 'browser_build',
            description: 'Lowercase letters, digits and underscores; used in exports and the API.',
          },
          { key: 'options', label: 'Options', kind: 'tags', required: true, placeholder: 'Type an option and press Enter', show: isSelect },
          { key: 'helpText', label: 'Help text', kind: 'text', span: 2 },
          { key: 'position', label: 'Order', kind: 'number' },
          { key: 'required', label: 'Required', kind: 'switch' },
        ]}
        toForm={(f) => ({
          entity: f?.entity ?? entity ?? 'FINDING',
          type: f?.type ?? 'TEXT',
          label: f?.label ?? '',
          key: f?.key ?? '',
          options: f?.options ?? [],
          helpText: f?.helpText ?? '',
          position: f?.position ?? customFields.length,
          required: f?.required ?? false,
        })}
        toBody={(v, editing) => ({
          ...(editing ? {} : { entity: v.entity, key: v.key.trim() }),
          type: v.type,
          label: v.label.trim(),
          options: isSelect(v) ? v.options : [],
          helpText: nn(v.helpText),
          position: v.position,
          required: v.required,
        })}
        deleteHint="Values already stored for this field remain in the records' data but will no longer be displayed. Archiving is usually safer."
      />
    </Stack>
  );
}

// ---------------------------------------------------------------------------- Classifications

function ClassificationsTab() {
  const { classifications } = useProject();
  return (
    <CrudSection
      path="classifications"
      noun="Classification"
      intro={
        <>
          Classifications categorise findings logged during sessions (bug, question, idea…). Those marked <b>defect</b> count towards defect metrics and readiness. The shortcut is the key used for quick
          capture in the session workbench. Classifications in use can't be deleted — archive them instead.
        </>
      }
      items={classifications}
      need="ADMIN"
      archivable
      columns={[
        {
          label: 'Classification',
          render: (c) => (
            <Group gap={6}>
              <ColorDot color={c.color} />
              <Text size="sm" fw={500}>
                {c.name}
              </Text>
              <Code fz={11}>{c.key}</Code>
              <ArchivedBadge item={c} />
            </Group>
          ),
        },
        {
          label: 'Defect',
          w: 90,
          render: (c) =>
            c.isDefect ? (
              <Badge size="sm" color="red" variant="light">
                Defect
              </Badge>
            ) : (
              <Text size="xs" c="dimmed">
                —
              </Text>
            ),
        },
        { label: 'Shortcut', w: 90, render: (c) => (c.shortcut ? <Code>{c.shortcut}</Code> : '—') },
        { label: 'Order', w: 70, render: (c) => c.position },
      ]}
      fields={[
        { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Bug' },
        { key: 'key', label: 'Key', kind: 'text', required: true, mono: true, createOnly: true, placeholder: 'bug', description: 'Lowercase, used in filters and the API.' },
        { key: 'shortcut', label: 'Shortcut', kind: 'text', placeholder: 'b', description: 'Up to 2 characters' },
        { key: 'position', label: 'Order', kind: 'number' },
        { key: 'color', label: 'Color', kind: 'color' },
        { key: 'isDefect', label: 'Counts as a defect', kind: 'switch', description: 'Included in defect counts, defect density and release readiness.' },
      ]}
      toForm={(c) => ({
        name: c?.name ?? '',
        key: c?.key ?? '',
        shortcut: c?.shortcut ?? '',
        position: c?.position ?? classifications.length,
        color: c?.color ?? 'gray',
        isDefect: c?.isDefect ?? false,
      })}
      toBody={(v, editing) => ({
        ...(editing ? {} : { key: v.key.trim() }),
        name: v.name.trim(),
        shortcut: nn(v.shortcut)?.toString().slice(0, 2) ?? null,
        position: v.position,
        color: v.color,
        isDefect: v.isDefect,
      })}
      deleteHint="Deleting fails if any finding uses this classification; archive it in that case."
    />
  );
}

// ---------------------------------------------------------------------------- Statuses

const SCOPE_LABEL: Record<string, string> = { BOTH: 'Manual & automation', MANUAL: 'Manual only', AUTOMATION: 'Automation only' };

function StatusesTab() {
  const { statuses } = useProject();
  return (
    <Stack gap="xl">
      <section>
        <Title order={5} mb={4}>
          Test result statuses
        </Title>
        <CrudSection
          path="statuses"
          noun="Status"
          intro={
            <>
              Statuses used for manual test results and imported automation results. Each maps to a fixed <b>category</b> that drives pass rates and reports. Aliases map raw statuses from CI reports (e.g.{' '}
              <Code>xfail</Code>) onto this status. Built-in statuses can be renamed or archived but not deleted.
            </>
          }
          items={statuses}
          need="ADMIN"
          archivable
          columns={[
            {
              label: 'Status',
              render: (s) => (
                <Group gap={6}>
                  <ColorDot color={s.color} />
                  <Text size="sm" fw={500}>
                    {s.name}
                  </Text>
                  <Code fz={11}>{s.key}</Code>
                  {s.isSystem && (
                    <Badge size="xs" variant="outline" color="gray">
                      Built-in
                    </Badge>
                  )}
                  <ArchivedBadge item={s} />
                </Group>
              ),
            },
            {
              label: 'Category',
              w: 120,
              render: (s) => (
                <Badge size="sm" variant="light" color={RESULT_CATEGORY[s.category]?.color}>
                  {RESULT_CATEGORY[s.category]?.label ?? s.category}
                </Badge>
              ),
            },
            { label: 'Used for', w: 170, render: (s) => SCOPE_LABEL[s.scope] ?? s.scope },
            {
              label: 'Aliases',
              render: (s) => {
                const a: string[] = (s as any).aliases ?? [];
                return a.length ? (
                  <Text size="xs" ff="monospace" lineClamp={1}>
                    {a.join(', ')}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                );
              },
            },
            { label: 'Order', w: 70, render: (s) => s.position },
          ]}
          fields={[
            { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Known issue' },
            { key: 'key', label: 'Key', kind: 'text', required: true, mono: true, createOnly: true, placeholder: 'known_issue' },
            { key: 'category', label: 'Category', kind: 'select', required: true, options: Object.entries(RESULT_CATEGORY).map(([value, v]) => ({ value, label: v.label })) },
            { key: 'scope', label: 'Used for', kind: 'select', required: true, options: toOpts(SCOPE_LABEL) },
            { key: 'aliases', label: 'Aliases', kind: 'tags', placeholder: 'xfail, known_failure', description: 'Raw result statuses from imports that should map to this status (max 20).' },
            { key: 'position', label: 'Order', kind: 'number' },
            { key: 'color', label: 'Color', kind: 'color' },
          ]}
          toForm={(s) => ({
            name: s?.name ?? '',
            key: s?.key ?? '',
            category: s?.category ?? 'FAILED',
            scope: s?.scope ?? 'BOTH',
            aliases: (s as any)?.aliases ?? [],
            position: s?.position ?? statuses.length,
            color: s?.color ?? 'gray',
          })}
          toBody={(v, editing) => ({
            ...(editing ? {} : { key: v.key.trim() }),
            name: v.name.trim(),
            category: v.category,
            scope: v.scope,
            aliases: (v.aliases as string[]).map((a) => a.trim().toLowerCase()).filter(Boolean),
            position: v.position,
            color: v.color,
          })}
          canDelete={(s) => (s.isSystem ? 'Built-in — archive instead' : true)}
          deleteHint="Deleting fails if results already use this status; archive it in that case."
        />
      </section>
      <section>
        <Title order={5} mb={4}>
          Exploratory session workflow
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Session statuses are a fixed workflow and can't be customised. With <b>Require review</b> (General tab) finished sessions go straight to review.
        </Text>
        <Paper withBorder p="md">
          <Group gap="xs">
            {Object.entries(SESSION_STATUS).map(([k, v], i, arr) => (
              <Group key={k} gap="xs">
                <Badge variant="light" color={v.color}>
                  {v.label}
                </Badge>
                {i < arr.length - 1 && (
                  <Text c="dimmed" size="xs">
                    {k === 'APPROVED' ? '·' : '→'}
                  </Text>
                )}
              </Group>
            ))}
          </Group>
          <Text size="xs" c="dimmed" mt="sm">
            Draft → In progress ⇄ Paused → Completed or In review → Approved or Changes requested (the tester resumes and finishes again). Sessions can be abandoned before they are finished; leads can reopen finished sessions.
          </Text>
        </Paper>
      </section>
    </Stack>
  );
}

// ---------------------------------------------------------------------------- Danger zone

function DangerTab() {
  const { pid, project, role } = useProject();
  const { isOrgAdmin } = useAuth();
  const invalidate = useInvalidateProject();
  const isAdmin = role === 'ADMIN';
  const archive = useMutation({
    mutationFn: (archive: boolean) => api.post(p(pid, archive ? '/archive' : '/unarchive'), {}),
    onSuccess: (_d, archive) => {
      toastOk(archive ? 'Project archived' : 'Project restored');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  return (
    <Stack maw={760}>
      {!isAdmin && (
        <Alert color="gray" variant="light" icon={<IconLock size={16} />}>
          Only project admins can archive or restore this project.
        </Alert>
      )}
      <Paper withBorder p="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Text fw={600}>{project.archivedAt ? 'Restore project' : 'Archive project'}</Text>
            <Text size="sm" c="dimmed">
              {project.archivedAt
                ? `Archived on ${fmtDate(project.archivedAt)}. Restoring makes the project editable again for its members.`
                : 'Archiving makes the whole project read-only: no new sessions, findings, runs or setting changes. All data stays visible and can be restored at any time. Projects cannot be deleted from the UI.'}
            </Text>
          </div>
          {isAdmin &&
            (project.archivedAt ? (
              <Button leftSection={<IconArchiveOff size={16} />} variant="default" loading={archive.isPending} onClick={() => archive.mutate(false)}>
                Restore
              </Button>
            ) : (
              <Button
                color="red"
                variant="light"
                leftSection={<IconArchive size={16} />}
                loading={archive.isPending}
                onClick={() =>
                  modals.openConfirmModal({
                    title: `Archive ${project.name}?`,
                    children: <Text size="sm">The project becomes read-only for everyone until a project admin restores it.</Text>,
                    labels: { confirm: 'Archive project', cancel: 'Cancel' },
                    confirmProps: { color: 'red' },
                    onConfirm: () => archive.mutate(true),
                  })
                }
              >
                Archive
              </Button>
            ))}
        </Group>
      </Paper>
      <Paper withBorder p="md">
        <Text fw={600}>Export project data</Text>
        <Text size="sm" c="dimmed">
          There is no single-project export yet. Lists (sessions, findings, issues, test cases…) and reports offer CSV/JSON exports on their pages.{' '}
          {isOrgAdmin ? (
            <>
              A complete organization export (JSON) is available in{' '}
              <Link to="/admin?tab=data" className="ex-link">
                Administration → Data export
              </Link>
              .
            </>
          ) : (
            'Organization admins can download a complete organization backup.'
          )}
        </Text>
      </Paper>
      <Text size="xs" c="dimmed">
        Your role in this project: {ROLE_LABEL[role] ?? titleCase(role)}
        {isOrgAdmin ? ' — organization owners and admins are implicit admins of every project.' : '.'}
      </Text>
    </Stack>
  );
}
