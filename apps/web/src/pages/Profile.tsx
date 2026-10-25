import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, ColorInput, Group, Paper, PasswordInput, SegmentedControl, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, useMantineColorScheme } from '@mantine/core';
import { IconCopy, IconKey } from '@tabler/icons-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { PageHeader, toastError, toastOk } from '../components/ui';
import { useProjects } from '../components/Layout';

export default function Profile() {
  const { user, refresh } = useAuth();
  const qc = useQueryClient();
  const { setColorScheme, colorScheme } = useMantineColorScheme();
  const [name, setName] = useState(user?.name ?? '');
  const [color, setColor] = useState(user?.avatarColor ?? '#0f766e');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });

  const save = useMutation({
    mutationFn: (body: object) => api.patch('/auth/me', body),
    onSuccess: () => {
      refresh();
      toastOk('Profile saved');
    },
    onError: (e) => toastError(e),
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/auth/me/password', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      toastOk('Password changed. Other sessions were signed out.');
    },
    onError: (e) => toastError(e),
  });

  // Personal API tokens (for CI automation ingestion)
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api.get('/tokens') });
  const projects = useProjects();
  const [tokenName, setTokenName] = useState('');
  const [tokenProject, setTokenProject] = useState<string>('');
  const [secret, setSecret] = useState<string | null>(null);
  const createToken = useMutation({
    mutationFn: () => api.post('/tokens', { name: tokenName, projectId: tokenProject || undefined }),
    onSuccess: (r: any) => {
      setSecret(r.secret);
      setTokenName('');
      qc.invalidateQueries({ queryKey: ['tokens'] });
    },
    onError: (e) => toastError(e),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
    onError: (e) => toastError(e),
  });

  return (
    <>
      <PageHeader title="Profile & preferences" subtitle={user?.email} />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Paper withBorder p="lg">
          <Title order={5} mb="md">
            Profile
          </Title>
          <Stack>
            <TextInput label="Display name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <ColorInput label="Avatar color" value={color} onChange={setColor} format="hex" />
            <Switch
              label="Email notifications (requires SMTP to be configured by an admin)"
              checked={!!user?.preferences?.emailNotifications}
              onChange={(e) => save.mutate({ preferences: { emailNotifications: e.currentTarget.checked } })}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>
                Theme
              </Text>
              <SegmentedControl
                value={colorScheme}
                onChange={(v) => {
                  setColorScheme(v as 'light' | 'dark' | 'auto');
                  save.mutate({ preferences: { theme: v } });
                }}
                data={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'auto', label: 'System' },
                ]}
              />
            </div>
            <Group justify="flex-end">
              <Button onClick={() => save.mutate({ name, avatarColor: color })} loading={save.isPending}>
                Save profile
              </Button>
            </Group>
          </Stack>
        </Paper>
        <Paper withBorder p="lg">
          <Title order={5} mb="md">
            Change password
          </Title>
          <Stack>
            <PasswordInput label="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.currentTarget.value })} />
            <PasswordInput
              label="New password"
              description="At least 10 characters with letters and numbers"
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.currentTarget.value })}
            />
            <Group justify="flex-end">
              <Button onClick={() => changePw.mutate()} loading={changePw.isPending} disabled={!pw.currentPassword || !pw.newPassword}>
                Change password
              </Button>
            </Group>
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="lg" mt="lg">
        <Group gap={6} mb="xs">
          <IconKey size={18} />
          <Title order={5}>Personal API tokens</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          Use tokens to call the REST API from CI (e.g. upload JUnit or Playwright results). Tokens act with your permissions; restrict them to one project where possible. Send as{' '}
          <code>Authorization: Bearer &lt;token&gt;</code>.
        </Text>
        {secret && (
          <Alert color="amber" mb="md" title="Copy your new token now — it won't be shown again">
            <Group gap="xs" wrap="nowrap">
              <code style={{ wordBreak: 'break-all' }}>{secret}</code>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconCopy size={14} />}
                onClick={() => {
                  navigator.clipboard.writeText(secret);
                  toastOk('Copied');
                }}
              >
                Copy
              </Button>
            </Group>
          </Alert>
        )}
        <Group align="flex-end" mb="md">
          <TextInput label="Token name" placeholder="e.g. GitHub Actions – shop-web" value={tokenName} onChange={(e) => setTokenName(e.currentTarget.value)} style={{ flex: 1 }} />
          <SegmentedControl
            value={tokenProject}
            onChange={setTokenProject}
            data={[{ value: '', label: 'All my projects' }, ...(projects.data?.projects ?? []).map((pr) => ({ value: pr.id, label: pr.key }))]}
          />
          <Button onClick={() => createToken.mutate()} disabled={!tokenName.trim()} loading={createToken.isPending}>
            Create token
          </Button>
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Prefix</Table.Th>
              <Table.Th>Scope</Table.Th>
              <Table.Th>Last used</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(tokens.data?.tokens ?? []).map((t: any) => (
              <Table.Tr key={t.id}>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td>
                  <code>{t.prefix}…</code>
                </Table.Td>
                <Table.Td>{t.project ? <Badge variant="outline">{t.project.key}</Badge> : 'All my projects'}</Table.Td>
                <Table.Td>{t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : 'Never'}</Table.Td>
                <Table.Td>{fmtDateTime(t.createdAt)}</Table.Td>
                <Table.Td>
                  <Button size="xs" color="red" variant="subtle" onClick={() => revoke.mutate(t.id)}>
                    Revoke
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {tokens.data?.tokens?.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text size="sm" c="dimmed">
                    No tokens yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>
    </>
  );
}
