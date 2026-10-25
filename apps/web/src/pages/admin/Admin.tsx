import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Button,
  Code,
  Group,
  List,
  Menu,
  Modal,
  MultiSelect,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import {
  IconCheck,
  IconCloudDownload,
  IconDatabase,
  IconDots,
  IconEdit,
  IconFilterOff,
  IconHistory,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShieldLock,
  IconSparkles,
  IconTrash,
  IconUserOff,
  IconUserCheck,
  IconUserPlus,
  IconUsersGroup,
  IconX,
} from '@tabler/icons-react';
import { api, ApiError, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAiStatus } from '../../lib/ai';
import { fmtDate, fromNow } from '../../lib/format';
import { ROLE_LABEL } from '../../lib/constants';
import { EmptyState, PageHeader, QueryState, UserAvatar, toastError, toastOk } from '../../components/ui';
import { AiSetupNotice } from '../../components/AiNotice';
import { AuditFeed, AUDIT_ENTITY_TYPES } from '../../components/AuditLog';
import { CopyCode } from '../../components/CopyCode';
import { useProjects } from '../../components/Layout';

type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';
type AdminUser = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  orgRole: OrgRole;
  projects: { id: string; name: string; key: string; role: string }[];
  teams: { id: string; name: string }[];
};
type Team = { id: string; name: string; description: string | null; createdAt: string; members: { id: string; name: string; email: string; avatarColor: string }[] };

const ORG_ROLE: Record<OrgRole, { label: string; color: string; help: string }> = {
  OWNER: { label: 'Owner', color: 'grape', help: 'Full control, including other owners' },
  ADMIN: { label: 'Admin', color: 'blue', help: 'Manage users, teams, settings; admin of every project' },
  MEMBER: { label: 'Member', color: 'gray', help: 'Access only to projects they are a member of' },
};
const PROJECT_ROLES = ['VIEWER', 'TESTER', 'LEAD', 'ADMIN'].map((r) => ({ value: r, label: ROLE_LABEL[r] }));

const TABS = [
  { value: 'users', label: 'Users' },
  { value: 'teams', label: 'Teams' },
  { value: 'org', label: 'Organization' },
  { value: 'auth', label: 'Authentication' },
  { value: 'ai', label: 'AI assistant' },
  { value: 'audit', label: 'Audit log' },
  { value: 'data', label: 'Data & backup' },
];

const useAdminUsers = (enabled = true) => useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<{ users: AdminUser[] }>('/admin/users'), enabled });

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  const chars = Array.from(bytes, (b, i) => (i % 4 === 3 ? digits[b % digits.length] : alphabet[b % alphabet.length]));
  return chars.join('');
}
const passwordValid = (p: string) => p.length >= 10 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p);

export default function Admin() {
  const { isOrgAdmin, org } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab')! : 'users';

  if (!isOrgAdmin) {
    return (
      <>
        <PageHeader title="Administration" />
        <EmptyState
          icon={<IconLock size={26} />}
          title="Organization admins only"
          description="Administration is available to organization owners and admins. Ask one of them if you need a new account, a role change or a data export."
          action={
            <Button component={Link} to="/" variant="light">
              Back to home
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader kicker={org?.name} title="Administration" subtitle="Users, teams, organization settings, security and data." />
      <Tabs
        value={tab}
        onChange={(v) => setSp(v && v !== 'users' ? { tab: v } : {}, { replace: true })}
        keepMounted={false}
      >
        <Tabs.List mb="md" className="ex-no-print">
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value}>
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="users">
          <UsersTab />
        </Tabs.Panel>
        <Tabs.Panel value="teams">
          <TeamsTab />
        </Tabs.Panel>
        <Tabs.Panel value="org">
          <OrgTab />
        </Tabs.Panel>
        <Tabs.Panel value="auth">
          <AuthTab />
        </Tabs.Panel>
        <Tabs.Panel value="ai">
          <AiTab />
        </Tabs.Panel>
        <Tabs.Panel value="audit">
          <AuditTab />
        </Tabs.Panel>
        <Tabs.Panel value="data">
          <DataTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

// ---------------------------------------------------------------------------- Users

function OrgRoleBadge({ role }: { role: OrgRole }) {
  return (
    <Badge variant="light" color={ORG_ROLE[role]?.color}>
      {ORG_ROLE[role]?.label ?? role}
    </Badge>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const q = useAdminUsers();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const isOwner = me?.orgRole === 'OWNER';

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/admin/users/${id}`, body),
    onSuccess: (_d, v) => {
      toastOk(v.body.deactivated === true ? 'User deactivated and signed out' : v.body.deactivated === false ? 'User reactivated' : 'User updated');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toastError(e),
  });

  return (
    <QueryState query={q}>
      {(d) => {
        const term = search.trim().toLowerCase();
        const users = d.users.filter((u) => (showInactive || !u.deactivatedAt) && (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)));
        const active = d.users.filter((u) => !u.deactivatedAt).length;
        return (
          <Stack>
            <Group justify="space-between">
              <Group gap="sm">
                <TextInput placeholder="Search name or email" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={260} />
                <Switch label={`Show deactivated (${d.users.length - active})`} checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
              </Group>
              <Group gap="sm">
                <Text size="sm" c="dimmed">
                  {active} active user{active === 1 ? '' : 's'}
                </Text>
                <Button leftSection={<IconUserPlus size={16} />} onClick={() => setCreating(true)}>
                  Add user
                </Button>
              </Group>
            </Group>
            <Paper withBorder>
              <Table.ScrollContainer minWidth={900}>
                <Table verticalSpacing="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>User</Table.Th>
                      <Table.Th w={150}>Org role</Table.Th>
                      <Table.Th>Projects</Table.Th>
                      <Table.Th>Teams</Table.Th>
                      <Table.Th w={130}>Last sign-in</Table.Th>
                      <Table.Th w={50} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {users.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={6}>
                          <Text ta="center" c="dimmed" size="sm" py="md">
                            No users match.
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                    {users.map((u) => {
                      const self = u.id === me?.id;
                      const roleLocked = self || (!isOwner && u.orgRole === 'OWNER');
                      return (
                        <Table.Tr key={u.id} opacity={u.deactivatedAt ? 0.55 : 1}>
                          <Table.Td>
                            <Group gap="sm" wrap="nowrap">
                              <UserAvatar user={u} size={30} />
                              <div>
                                <Group gap={6}>
                                  <Text size="sm" fw={500}>
                                    {u.name}
                                  </Text>
                                  {self && (
                                    <Badge size="xs" variant="outline">
                                      you
                                    </Badge>
                                  )}
                                  {u.deactivatedAt && (
                                    <Badge size="xs" color="red" variant="light">
                                      Deactivated {fmtDate(u.deactivatedAt)}
                                    </Badge>
                                  )}
                                </Group>
                                <Text size="xs" c="dimmed">
                                  {u.email}
                                </Text>
                              </div>
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            {roleLocked ? (
                              <Tooltip label={self ? "You can't change your own role" : 'Only owners can change owner roles'}>
                                <span>
                                  <OrgRoleBadge role={u.orgRole} />
                                </span>
                              </Tooltip>
                            ) : (
                              <Select
                                size="xs"
                                w={130}
                                allowDeselect={false}
                                value={u.orgRole}
                                data={(Object.keys(ORG_ROLE) as OrgRole[]).map((r) => ({ value: r, label: ORG_ROLE[r].label, disabled: r === 'OWNER' && !isOwner }))}
                                onChange={(v) => v && v !== u.orgRole && update.mutate({ id: u.id, body: { orgRole: v } })}
                              />
                            )}
                          </Table.Td>
                          <Table.Td>
                            {u.orgRole !== 'MEMBER' ? (
                              <Text size="xs" c="dimmed">
                                All projects (implicit admin)
                                {u.projects.length ? ` · member of ${u.projects.length}` : ''}
                              </Text>
                            ) : u.projects.length === 0 ? (
                              <Text size="xs" c="dimmed">
                                No projects
                              </Text>
                            ) : (
                              <Group gap={4}>
                                {u.projects.map((p) => (
                                  <Tooltip key={p.id} label={`${p.name} · ${ROLE_LABEL[p.role] ?? p.role}`}>
                                    <Badge component={Link} to={`/projects/${p.id}/settings?tab=members`} size="sm" variant="default" tt="none" style={{ cursor: 'pointer' }}>
                                      {p.key} · {ROLE_LABEL[p.role] ?? p.role}
                                    </Badge>
                                  </Tooltip>
                                ))}
                              </Group>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4}>
                              {u.teams.map((t) => (
                                <Badge key={t.id} size="sm" variant="light" color="indigo" tt="none">
                                  {t.name}
                                </Badge>
                              ))}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c={u.lastLoginAt ? undefined : 'dimmed'}>
                              {u.lastLoginAt ? fromNow(u.lastLoginAt) : 'Never'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${u.name}`}>
                                  <IconDots size={16} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(u)}>
                                  Rename
                                </Menu.Item>
                                <Menu.Item leftSection={<IconKey size={14} />} onClick={() => setResetting(u)}>
                                  Set temporary password
                                </Menu.Item>
                                {!self && (
                                  <>
                                    <Menu.Divider />
                                    {u.deactivatedAt ? (
                                      <Menu.Item leftSection={<IconUserCheck size={14} />} onClick={() => update.mutate({ id: u.id, body: { deactivated: false } })}>
                                        Reactivate
                                      </Menu.Item>
                                    ) : (
                                      <Menu.Item
                                        color="red"
                                        leftSection={<IconUserOff size={14} />}
                                        onClick={() =>
                                          modals.openConfirmModal({
                                            title: `Deactivate ${u.name}?`,
                                            children: (
                                              <Text size="sm">
                                                They are signed out immediately and can no longer sign in or use API tokens. Their work stays in place and they can be reactivated later.
                                              </Text>
                                            ),
                                            labels: { confirm: 'Deactivate', cancel: 'Cancel' },
                                            confirmProps: { color: 'red' },
                                            onConfirm: () => update.mutate({ id: u.id, body: { deactivated: true } }),
                                          })
                                        }
                                      >
                                        Deactivate
                                      </Menu.Item>
                                    )}
                                  </>
                                )}
                              </Menu.Dropdown>
                            </Menu>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
            <Text size="xs" c="dimmed">
              Users can't be deleted — deactivate them to revoke access while keeping their history. Project roles are managed in each project's settings → Members.
            </Text>
            <CreateUserModal opened={creating} onClose={() => setCreating(false)} canCreateOwner={isOwner} />
            <RenameModal user={editing} onClose={() => setEditing(null)} />
            <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
          </Stack>
        );
      }}
    </QueryState>
  );
}

function TempPasswordInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Stack gap={4}>
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label="Temporary password"
          required
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          error={error ?? (value && !passwordValid(value) ? 'At least 10 characters with letters and numbers' : undefined)}
          styles={{ input: { fontFamily: 'monospace' } }}
        />
        <Tooltip label="Generate">
          <ActionIcon variant="default" size="lg" mb={error || (value && !passwordValid(value)) ? 22 : 0} onClick={() => onChange(generatePassword())} aria-label="Generate password">
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed">
        Share it with the user through a secure channel — Explorix does not send invitation emails. They can change it under Profile after signing in.
      </Text>
    </Stack>
  );
}

function CreateUserModal({ opened, onClose, canCreateOwner }: { opened: boolean; onClose: () => void; canCreateOwner: boolean }) {
  const qc = useQueryClient();
  const projects = useProjects();
  const [f, setF] = useState({ name: '', email: '', password: '', orgRole: 'MEMBER' as OrgRole });
  const [memberships, setMemberships] = useState<{ projectId: string | null; role: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  useEffect(() => {
    if (opened) {
      setF({ name: '', email: '', password: generatePassword(), orgRole: 'MEMBER' });
      setMemberships([]);
      setErrors({});
      setCreated(null);
    }
  }, [opened]);
  const save = useMutation({
    mutationFn: () =>
      api.post('/admin/users', {
        name: f.name.trim(),
        email: f.email.trim(),
        password: f.password,
        orgRole: f.orgRole,
        projects: f.orgRole === 'MEMBER' ? memberships.filter((m) => m.projectId).map((m) => ({ projectId: m.projectId, role: m.role })) : [],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['project'] });
      setCreated({ email: f.email.trim().toLowerCase(), password: f.password });
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e, 'Could not create user');
    },
  });
  const projectOptions = (projects.data?.projects ?? []).filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }));

  return (
    <Modal opened={opened} onClose={onClose} title={created ? 'User created' : 'Add user'} size="lg">
      {created ? (
        <Stack>
          <Alert color="teal" icon={<IconCheck size={18} />}>
            The account is ready. Send these credentials to the user securely — the password is not shown again.
          </Alert>
          <CopyCode code={`Sign-in URL: ${window.location.origin}/login\nEmail: ${created.email}\nTemporary password: ${created.password}`} label="Credentials" />
          <Group justify="flex-end">
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} error={errors.name} />
            <TextInput label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.currentTarget.value })} error={errors.email} />
          </SimpleGrid>
          <TempPasswordInput value={f.password} onChange={(password) => setF({ ...f, password })} error={errors.password} />
          <Select
            label="Organization role"
            allowDeselect={false}
            value={f.orgRole}
            onChange={(v) => setF({ ...f, orgRole: (v as OrgRole) ?? 'MEMBER' })}
            data={(Object.keys(ORG_ROLE) as OrgRole[]).map((r) => ({ value: r, label: `${ORG_ROLE[r].label} — ${ORG_ROLE[r].help}`, disabled: r === 'OWNER' && !canCreateOwner }))}
            error={errors.orgRole}
          />
          {f.orgRole === 'MEMBER' ? (
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>
                  Project access
                </Text>
                <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => setMemberships([...memberships, { projectId: null, role: 'TESTER' }])}>
                  Add project
                </Button>
              </Group>
              {memberships.length === 0 && (
                <Text size="xs" c="dimmed">
                  No projects yet — the user will only see projects they are added to later.
                </Text>
              )}
              <Stack gap={6}>
                {memberships.map((m, i) => (
                  <Group key={i} gap="xs" wrap="nowrap">
                    <Select
                      style={{ flex: 1 }}
                      placeholder="Project"
                      searchable
                      data={projectOptions.filter((o) => o.value === m.projectId || !memberships.some((x) => x.projectId === o.value))}
                      value={m.projectId}
                      onChange={(v) => setMemberships(memberships.map((x, j) => (j === i ? { ...x, projectId: v } : x)))}
                    />
                    <Select w={160} allowDeselect={false} data={PROJECT_ROLES} value={m.role} onChange={(v) => setMemberships(memberships.map((x, j) => (j === i ? { ...x, role: v ?? 'TESTER' } : x)))} />
                    <ActionIcon variant="subtle" color="gray" onClick={() => setMemberships(memberships.filter((_, j) => j !== i))} aria-label="Remove project">
                      <IconX size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            </div>
          ) : (
            <Text size="xs" c="dimmed">
              Owners and admins automatically have admin access to every project.
            </Text>
          )}
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim() || !f.email.trim() || !passwordValid(f.password)}>
              Create user
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function RenameModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  useEffect(() => setName(user?.name ?? ''), [user]);
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/users/${user!.id}`, { name: name.trim() }),
    onSuccess: () => {
      toastOk('User renamed');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Modal opened={!!user} onClose={onClose} title={`Rename ${user?.email ?? ''}`}>
      <Stack>
        <TextInput label="Display name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={100} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (user) {
      setPassword(generatePassword());
      setDone(false);
    }
  }, [user]);
  const save = useMutation({
    mutationFn: () => api.patch(`/admin/users/${user!.id}`, { password }),
    onSuccess: () => setDone(true),
    onError: (e) => toastError(e),
  });
  return (
    <Modal opened={!!user} onClose={onClose} title={`Set temporary password · ${user?.name ?? ''}`}>
      {done ? (
        <Stack>
          <Alert color="teal" icon={<IconCheck size={18} />}>
            Password updated. All of {user?.name}'s browser sessions were signed out and any login lockout was cleared.
          </Alert>
          <CopyCode code={`Email: ${user?.email}\nTemporary password: ${password}`} label="New credentials" />
          <Group justify="flex-end">
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <TempPasswordInput value={password} onChange={setPassword} />
          <Text size="xs" c="dimmed">
            Existing API tokens are not revoked by a password change.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button color="orange" onClick={() => save.mutate()} loading={save.isPending} disabled={!passwordValid(password)}>
              Set password
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------- Teams

function TeamsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-teams'], queryFn: () => api.get<{ teams: Team[] }>('/admin/teams') });
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [adding, setAdding] = useState<Team | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/admin/teams/${id}`),
    onSuccess: () => {
      toastOk('Team deleted');
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => toastError(e),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed" maw={700}>
          Teams are named groups of users. Use them to add many people to a project in one step; project roles are then managed per member.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          New team
        </Button>
      </Group>
      <QueryState query={q}>
        {(d) =>
          d.teams.length === 0 ? (
            <EmptyState icon={<IconUsersGroup size={26} />} title="No teams yet" description="Create a team, e.g. “Mobile QA”, to onboard its members to projects together." />
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
              {d.teams.map((t) => (
                <Paper key={t.id} withBorder p="md">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <div>
                      <Text fw={600}>{t.name}</Text>
                      {t.description && (
                        <Text size="sm" c="dimmed" lineClamp={2}>
                          {t.description}
                        </Text>
                      )}
                    </div>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${t.name}`}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEditing(t)}>
                          Edit
                        </Menu.Item>
                        <Menu.Item leftSection={<IconUserPlus size={14} />} onClick={() => setAdding(t)} disabled={t.members.length === 0}>
                          Add members to project…
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() =>
                            modals.openConfirmModal({
                              title: `Delete team ${t.name}?`,
                              children: <Text size="sm">The team is removed. Its members keep their accounts and project memberships.</Text>,
                              labels: { confirm: 'Delete', cancel: 'Cancel' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => del.mutate(t.id),
                            })
                          }
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                  <Group mt="sm" gap="xs">
                    {t.members.length ? (
                      <Tooltip.Group>
                        <Avatar.Group spacing="sm">
                          {t.members.slice(0, 8).map((m) => (
                            <Tooltip key={m.id} label={m.name}>
                              <UserAvatar user={m} size={28} />
                            </Tooltip>
                          ))}
                          {t.members.length > 8 && (
                            <Avatar size={28} radius="xl">
                              +{t.members.length - 8}
                            </Avatar>
                          )}
                        </Avatar.Group>
                      </Tooltip.Group>
                    ) : null}
                    <Text size="xs" c="dimmed">
                      {t.members.length} member{t.members.length === 1 ? '' : 's'}
                    </Text>
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          )
        }
      </QueryState>
      <TeamModal value={editing} onClose={() => setEditing(null)} />
      <AddTeamToProjectModal team={adding} onClose={() => setAdding(null)} />
    </Stack>
  );
}

function TeamModal({ value, onClose }: { value: Team | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const users = useAdminUsers(!!value);
  const editing = value && value !== 'new' ? value : null;
  const [f, setF] = useState({ name: '', description: '', userIds: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!value) return;
    setErrors({});
    setF(value === 'new' ? { name: '', description: '', userIds: [] } : { name: value.name, description: value.description ?? '', userIds: value.members.map((m) => m.id) });
  }, [value]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), description: f.description.trim() || null, userIds: f.userIds };
      return editing ? api.patch(`/admin/teams/${editing.id}`, body) : api.post('/admin/teams', body);
    },
    onSuccess: () => {
      toastOk(editing ? 'Team updated' : 'Team created');
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e);
    },
  });
  const options = (users.data?.users ?? []).filter((u) => !u.deactivatedAt || f.userIds.includes(u.id)).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }));
  return (
    <Modal opened={!!value} onClose={onClose} title={editing ? `Edit team · ${editing.name}` : 'New team'} size="lg">
      <Stack gap="sm">
        <TextInput label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.currentTarget.value })} error={errors.name} maxLength={80} />
        <Textarea label="Description" autosize minRows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.currentTarget.value })} error={errors.description} maxLength={500} />
        <MultiSelect label="Members" searchable data={options} value={f.userIds} onChange={(v) => setF({ ...f, userIds: v })} placeholder={users.isLoading ? 'Loading users…' : 'Pick users'} error={errors.userIds} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()}>
            {editing ? 'Save' : 'Create team'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AddTeamToProjectModal({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [role, setRole] = useState('TESTER');
  useEffect(() => {
    if (team) {
      setProjectId(null);
      setRole('TESTER');
    }
  }, [team]);
  const save = useMutation({
    mutationFn: () => api.post<{ added: number }>(`/admin/teams/${team!.id}/add-to-project`, { projectId, role }),
    onSuccess: (r) => {
      toastOk(r.added ? `${r.added} member${r.added === 1 ? '' : 's'} added to the project` : 'Everyone in the team was already a member');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Modal opened={!!team} onClose={onClose} title={`Add ${team?.name ?? ''} to a project`}>
      <Stack gap="sm">
        <Select
          label="Project"
          searchable
          required
          data={(projects.data?.projects ?? []).filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
          value={projectId}
          onChange={setProjectId}
        />
        <Select label="Role for new members" allowDeselect={false} data={PROJECT_ROLES} value={role} onChange={(v) => setRole(v ?? 'TESTER')} />
        <Text size="xs" c="dimmed">
          Team members who already belong to the project keep their current role.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!projectId}>
            Add {team?.members.length ?? 0} member{team?.members.length === 1 ? '' : 's'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- Organization

function OrgTab() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<{ org: { id: string; name: string; slug: string; settings: { allowMemberProjectCreation: boolean } } }>('/admin/settings') });
  const [name, setName] = useState('');
  const [allow, setAllow] = useState(false);
  useEffect(() => {
    if (q.data) {
      setName(q.data.org.name);
      setAllow(!!q.data.org.settings.allowMemberProjectCreation);
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch('/admin/settings', { name: name.trim(), settings: { allowMemberProjectCreation: allow } }),
    onSuccess: () => {
      toastOk('Organization settings saved');
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      refresh();
    },
    onError: (e) => toastError(e),
  });
  return (
    <QueryState query={q}>
      {(d) => {
        const dirty = name.trim() !== d.org.name || allow !== !!d.org.settings.allowMemberProjectCreation;
        return (
          <Stack maw={680}>
            <Paper withBorder p="md">
              <Stack gap="sm">
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput label="Organization name" required value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={100} />
                  <TextInput label="Slug" value={d.org.slug} readOnly description="Internal identifier — cannot be changed" styles={{ input: { fontFamily: 'monospace' } }} />
                </SimpleGrid>
                <Switch
                  mt="xs"
                  label="Members can create projects"
                  description="When off, only owners and admins can create new projects. The creator becomes the project's admin."
                  checked={allow}
                  onChange={(e) => setAllow(e.currentTarget.checked)}
                />
              </Stack>
            </Paper>
            <Group>
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty || !name.trim()}>
                Save changes
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Explorix runs a single organization per installation. Project-level defaults (review policy, timebox, custom fields, statuses) are configured in each project's settings.
            </Text>
          </Stack>
        );
      }}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------- Authentication

function Feature({ title, status, children }: { title: string; status: 'active' | 'config' | 'planned'; children: ReactNode }) {
  const badge =
    status === 'active' ? (
      <Badge size="sm" color="teal" variant="light">
        Active
      </Badge>
    ) : status === 'config' ? (
      <Badge size="sm" color="blue" variant="light">
        Server configuration
      </Badge>
    ) : (
      <Badge size="sm" color="gray" variant="outline">
        Planned — not yet implemented
      </Badge>
    );
  return (
    <Paper withBorder p="md" opacity={status === 'planned' ? 0.8 : 1}>
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text fw={600} size="sm">
          {title}
        </Text>
        {badge}
      </Group>
      <Text size="sm" c="dimmed" component="div">
        {children}
      </Text>
    </Paper>
  );
}

function AuthTab() {
  return (
    <Stack>
      <Alert color="blue" variant="light" icon={<IconShieldLock size={18} />}>
        Authentication settings are fixed by the server and its environment variables; they are shown here for reference and can't be changed from the UI.
      </Alert>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Feature title="Email & password" status="active">
          Passwords are hashed with scrypt and must be at least 10 characters with letters and numbers. Admins create accounts and set temporary passwords; users change their own password under
          Profile. There is no self-service sign-up or email-based reset.
        </Feature>
        <Feature title="Browser sessions" status="active">
          httpOnly session cookies, valid for <Code>SESSION_TTL_HOURS</Code> (default 72 h). Cookies are marked <Code>Secure</Code> in production or when <Code>COOKIE_SECURE=true</Code>. Deactivating
          a user or resetting their password signs out all of their sessions.
        </Feature>
        <Feature title="Brute-force protection" status="active">
          Sign-in is rate-limited, and an account is locked for 15 minutes after 8 consecutive failed attempts. Setting a new password clears the lock.
        </Feature>
        <Feature title="CSRF protection" status="active">
          State-changing browser requests must carry the <Code>X-Requested-With: explorix</Code> header, which cross-site forms can't send.
        </Feature>
        <Feature title="Personal API tokens" status="active">
          Users create Bearer tokens (<Code>exp_…</Code>) under{' '}
          <Anchor component={Link} to="/profile">
            Profile
          </Anchor>
          , optionally restricted to one project, for CI uploads and scripts.           Tokens act with the user's permissions, can't be used for administration, profile changes or creating new tokens, and stop working when the user is
          deactivated.
        </Feature>
        <Feature title="Email delivery" status="config">
          Optional via <Code>SMTP_URL</Code> and <Code>EMAIL_FROM</Code>. Account invitations are not emailed — share temporary passwords yourself.
        </Feature>
        <Feature title="Single sign-on (OIDC / SAML)" status="planned">
          Sign-in through Okta, Entra ID, Google Workspace and similar identity providers is not available yet.
        </Feature>
        <Feature title="Multi-factor authentication" status="planned">
          TOTP / WebAuthn second factors are not available yet. Put Explorix behind your SSO-aware reverse proxy if you need MFA today.
        </Feature>
        <Feature title="SCIM user provisioning" status="planned">
          Automatic user provisioning and deprovisioning from an identity provider is not available yet.
        </Feature>
      </SimpleGrid>
    </Stack>
  );
}

// ---------------------------------------------------------------------------- AI

function AiTab() {
  const q = useAiStatus();
  return (
    <QueryState query={q}>
      {(s) => (
        <Stack maw={860}>
          <Paper withBorder p="md">
            <Group gap="md" wrap="nowrap">
              <ThemeIcon size={42} radius="md" variant="light" color={s.enabled && !s.misconfigured ? (s.isMock ? 'yellow' : 'teal') : 'gray'}>
                <IconSparkles size={22} />
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Group gap="xs">
                  <Text fw={600}>AI assistant</Text>
                  {s.misconfigured ? (
                    <Badge color="red" variant="light">
                      Misconfigured
                    </Badge>
                  ) : s.enabled ? (
                    <Badge color={s.isMock ? 'yellow' : 'teal'} variant="light">
                      {s.isMock ? 'Enabled (mock provider)' : 'Enabled'}
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="light">
                      Disabled
                    </Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  Provider: <Code>{s.provider}</Code>
                  {s.model && (
                    <>
                      {' '}
                      · Model: <Code>{s.model}</Code>
                    </>
                  )}
                  {' '}· API keys are kept on the server and never exposed to browsers.
                </Text>
              </div>
            </Group>
          </Paper>
          <AiSetupNotice status={s} />
          <Paper withBorder p="md">
            <Title order={6} mb="xs">
              Configuration
            </Title>
            <Text size="sm" mb="sm">
              AI is optional and configured with server environment variables; restart the server after changing them. Any OpenAI-compatible endpoint works via <Code>AI_BASE_URL</Code>. The{' '}
              <Code>mock</Code> provider returns canned text for demos and tests.
            </Text>
            <CopyCode
              label="Server environment (.env)"
              code={`AI_PROVIDER=openai          # none | openai | mock\nAI_API_KEY=<your key>\nAI_MODEL=gpt-4o-mini\nAI_BASE_URL=https://api.openai.com/v1`}
            />
            <Title order={6} mt="md" mb={4}>
              What AI is used for
            </Title>
            <List size="sm" spacing={2}>
              <List.Item>Charter drafts and test ideas</List.Item>
              <List.Item>Session summaries and defect report drafts from findings</List.Item>
              <List.Item>Test case suggestions from findings</List.Item>
              <List.Item>Release risk summaries in Reports</List.Item>
            </List>
            <Text size="xs" c="dimmed" mt="sm">
              Every AI output is a draft labelled as AI-generated and must be reviewed and saved by a person. Selected project content (e.g. charter text, notes, findings) is sent to the configured
              provider when someone uses an AI action.
            </Text>
          </Paper>
        </Stack>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------- Audit

const AUDIT_PAGE_SIZE = 50;

function AuditTab() {
  const [sp, setSp] = useSearchParams();
  const projects = useProjects();
  const users = useAdminUsers();
  const get = (k: string) => sp.get(k) ?? '';
  const page = Number(sp.get('page')) || 1;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const [action, setAction] = useState(get('action'));
  const [debouncedAction] = useDebouncedValue(action, 400);
  useEffect(() => {
    if (debouncedAction !== get('action')) set({ action: debouncedAction || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedAction]);

  const filters = useMemo(
    () => ({ projectId: get('projectId'), entityType: get('entityType'), actorId: get('actorId'), action: get('action'), from: get('from'), to: get('to') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sp],
  );
  const q = useQuery({
    queryKey: ['admin-audit', filters, page],
    queryFn: () =>
      api.get('/admin/audit', {
        projectId: filters.projectId,
        entityType: filters.entityType,
        actorId: filters.actorId,
        action: filters.action,
        from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
        to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
        page,
        pageSize: AUDIT_PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <Stack>
      <Paper withBorder p="sm" className="ex-no-print">
        <Group gap="sm" align="flex-end">
          <Select
            label="Project"
            placeholder="All projects & org"
            searchable
            clearable
            w={220}
            data={(projects.data?.projects ?? []).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
            value={filters.projectId || null}
            onChange={(v) => set({ projectId: v })}
          />
          <Select label="Entity type" placeholder="All types" searchable clearable w={200} data={AUDIT_ENTITY_TYPES} value={filters.entityType || null} onChange={(v) => set({ entityType: v })} />
          <Select
            label="Actor"
            placeholder="Anyone"
            searchable
            clearable
            w={200}
            data={(users.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
            value={filters.actorId || null}
            onChange={(v) => set({ actorId: v })}
          />
          <TextInput label="Action" placeholder="e.g. created" value={action} onChange={(e) => setAction(e.currentTarget.value.trim())} w={160} />
          <DatePickerInput
            type="range"
            label="Date range"
            placeholder="Any time"
            clearable
            w={250}
            value={[filters.from || null, filters.to || null]}
            onChange={([from, to]) => set({ from, to })}
          />
          {hasFilters && (
            <Button
              variant="subtle"
              leftSection={<IconFilterOff size={16} />}
              onClick={() => {
                setAction('');
                setSp({ tab: 'audit' }, { replace: true });
              }}
            >
              Clear
            </Button>
          )}
        </Group>
      </Paper>
      <QueryState query={q}>
        {(d: any) =>
          d.events.length === 0 ? (
            <EmptyState icon={<IconHistory size={26} />} title="No audit events" description={hasFilters ? 'No events match these filters.' : 'Changes across the organization will appear here.'} />
          ) : (
            <Paper withBorder px="md">
              <AuditFeed events={d.events} showProject />
              <Group justify="space-between" py="sm">
                <Text size="xs" c="dimmed">
                  {d.total} event{d.total === 1 ? '' : 's'} · newest first
                </Text>
                {d.total > d.pageSize && <Pagination size="sm" total={Math.ceil(d.total / d.pageSize)} value={d.page} onChange={(pg) => set({ page: String(pg) })} />}
              </Group>
            </Paper>
          )
        }
      </QueryState>
      <Text size="xs" c="dimmed">
        Audit events can't be edited or deleted from the UI. There is no separate audit export endpoint yet — the organization export on the Data & backup tab includes the records.
      </Text>
    </Stack>
  );
}

// ---------------------------------------------------------------------------- Data & backup

function DataTab() {
  const [busy, setBusy] = useState(false);
  const exportAll = async () => {
    setBusy(true);
    try {
      await download('/admin/export', `explorix-export-${new Date().toISOString().slice(0, 10)}.json`);
      toastOk('Export downloaded');
    } catch (e) {
      toastError(e, 'Export failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack maw={900}>
      <Paper withBorder p="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="md" wrap="nowrap" align="flex-start">
            <ThemeIcon size={42} radius="md" variant="light">
              <IconCloudDownload size={22} />
            </ThemeIcon>
            <div>
              <Text fw={600}>Export organization data (JSON)</Text>
              <Text size="sm" c="dimmed">
                A single JSON document (<Code>explorix-export</Code>, version 1) with users (no password hashes), templates and every project with its configuration, charters, sessions, findings,
                issues, requirements, test cases, runs and automation results. Attachments are listed as metadata only — the files themselves are not included.
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                Use it for archiving, analysis or migration. There is no import/restore from this file in the UI; for disaster recovery use database backups below.
              </Text>
            </div>
          </Group>
          <Button leftSection={<IconCloudDownload size={16} />} onClick={exportAll} loading={busy} style={{ flexShrink: 0 }}>
            Download
          </Button>
        </Group>
      </Paper>

      <Paper withBorder p="md">
        <Group gap="xs" mb="xs">
          <IconDatabase size={20} />
          <Title order={5}>Backup & recovery</Title>
          <Badge size="sm" variant="outline" color="gray">
            Operator guidance
          </Badge>
        </Group>
        <Text size="sm" mb="sm">
          Explorix does not schedule backups itself. A complete backup consists of three things — back them up together on a schedule (e.g. nightly) and test restores regularly:
        </Text>
        <List size="sm" spacing={4} mb="md">
          <List.Item>
            <b>PostgreSQL database</b> (<Code>DATABASE_URL</Code>) — all application data.
          </List.Item>
          <List.Item>
            <b>Uploaded files</b> in <Code>STORAGE_DIR</Code> (default <Code>./.data/uploads</Code>) — screenshots and attachments.
          </List.Item>
          <List.Item>
            <b>
              <Code>ENCRYPTION_KEY</Code>
            </b>{' '}
            — needed to decrypt stored integration secrets (webhook signing secrets, GitHub tokens). Keep it in your secret manager, separate from the backups.
          </List.Item>
        </List>
        <Stack gap="sm">
          <CopyCode
            label="Back up"
            code={`# Database (custom format, compressed)\npg_dump --format=custom --no-owner --file=explorix-$(date +%F).dump "$DATABASE_URL"\n\n# Uploaded files\ntar -czf explorix-uploads-$(date +%F).tar.gz -C "\${STORAGE_DIR:-./.data/uploads}" .`}
          />
          <CopyCode
            label="Restore (into an empty database, with the server stopped)"
            code={`pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" explorix-YYYY-MM-DD.dump\nmkdir -p "\${STORAGE_DIR:-./.data/uploads}" && tar -xzf explorix-uploads-YYYY-MM-DD.tar.gz -C "\${STORAGE_DIR:-./.data/uploads}"\n\n# Then start the server with the same ENCRYPTION_KEY; pending migrations are applied with:\nnpx prisma migrate deploy`}
          />
        </Stack>
        <Text size="xs" c="dimmed" mt="sm">
          Managed PostgreSQL services (RDS, Cloud SQL, Azure Database…) offer automated snapshots and point-in-time recovery — prefer those where available.
        </Text>
      </Paper>
    </Stack>
  );
}
