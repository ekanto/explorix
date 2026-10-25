import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Anchor, Button, Code, Group, NumberInput, Paper, SimpleGrid, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { IconDatabase, IconDeviceDesktop, IconFolder, IconFolderOpen, IconInfoCircle } from '@tabler/icons-react';
import { desktop, type DesktopSettings as Settings } from '../lib/desktop';
import { useAuth } from '../lib/auth';
import { EmptyState, PageHeader, toastError, toastOk } from '../components/ui';

/** `/settings/desktop`: options that only exist in Explorix Desktop (storage, limits, startup). */
export default function DesktopSettings() {
  if (!desktop) return <EmptyState title="Desktop settings" description="These settings are only available in the Explorix Desktop application." icon={<IconDeviceDesktop size={26} />} />;
  return <DesktopSettingsInner />;
}

function DesktopSettingsInner() {
  const bridge = desktop!;
  const qc = useQueryClient();
  const { user, isOrgAdmin, refresh } = useAuth();
  const isOwner = user?.orgRole === 'OWNER';
  const info = useQuery({ queryKey: ['desktop-info'], queryFn: () => bridge.info() });
  const settings = useQuery({ queryKey: ['desktop-settings'], queryFn: () => bridge.getSettings() });
  const [limits, setLimits] = useState<Settings['limits'] | null>(null);
  const [keep, setKeep] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setLimits(settings.data.limits);
      setKeep(settings.data.keepBackups);
    }
  }, [settings.data]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toastOk(ok);
      await qc.invalidateQueries({ queryKey: ['desktop-settings'] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const s = settings.data;
  const dirty = !!(s && limits && (limits.uploadMb !== s.limits.uploadMb || limits.imageMb !== s.limits.imageMb || limits.videoMb !== s.limits.videoMb));
  const folderRow = (label: string, path: string | null | undefined, which: 'data' | 'evidence' | 'backups' | 'logs') => (
    <Table.Tr key={which}>
      <Table.Td w={140}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
      </Table.Td>
      <Table.Td>
        <Code style={{ wordBreak: 'break-all' }}>{path ?? '—'}</Code>
      </Table.Td>
      <Table.Td w={90}>
        <Button size="compact-xs" variant="light" leftSection={<IconFolderOpen size={12} />} onClick={() => bridge.openFolder(which).catch((e) => toastError(e))}>
          Open
        </Button>
      </Table.Td>
    </Table.Tr>
  );

  return (
    <>
      <PageHeader title="Desktop settings" subtitle="Storage, upload limits and startup options for Explorix on this computer." />
      {settings.error && <Alert color="red">{(settings.error as Error).message}</Alert>}
      <Stack gap="lg" maw={900}>
        <Paper withBorder p="md">
          <Group gap="xs" mb="xs">
            <IconFolder size={18} />
            <Title order={4}>Where your data is stored</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">
            Projects are stored in a local database and evidence files in the evidence folder. Nothing leaves this computer unless you export it or set up an integration. Uninstalling Explorix keeps these folders.
          </Text>
          <Table fz="sm" verticalSpacing={6}>
            <Table.Tbody>
              {folderRow('Data folder', s?.dataDir, 'data')}
              {folderRow('Evidence', s?.evidenceDir, 'evidence')}
              {folderRow('Backups', s?.backupsDir, 'backups')}
              {folderRow('Logs', s?.logsDir, 'logs')}
            </Table.Tbody>
          </Table>
          {s?.pendingEvidenceMove && (
            <Alert color="yellow" mt="sm">
              Evidence will be moved to <Code>{s.pendingEvidenceMove.to}</Code> on the next start.
            </Alert>
          )}
          {s?.previousEvidenceDir && (
            <Alert color="blue" mt="sm" icon={<IconInfoCircle size={16} />}>
              Evidence was moved from <Code>{s.previousEvidenceDir}</Code>. The old folder was kept; you can delete it once you have checked your evidence.
            </Alert>
          )}
          {isOwner && (
            <Group mt="sm">
              <Button
                size="xs"
                variant="default"
                loading={busy === 'move'}
                onClick={() =>
                  run('move', async () => {
                    const r = await bridge.chooseEvidenceFolder();
                    if (r.status === 'restarting') toastOk('Explorix is restarting to move your evidence…');
                  })
                }
              >
                Move evidence folder…
              </Button>
              <Text size="xs" c="dimmed">
                Explorix restarts, copies and verifies every file, then uses the new folder.
              </Text>
            </Group>
          )}
        </Paper>

        <Paper withBorder p="md">
          <Group gap="xs" mb="xs">
            <IconDatabase size={18} />
            <Title order={4}>Evidence size limits</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">
            Maximum size per file. Original files are stored unchanged; large screen recordings are copied by streaming, not loaded into memory.
          </Text>
          {limits && (
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput label="Screenshots and images (MB)" min={1} max={2048} value={limits.imageMb} onChange={(v) => setLimits({ ...limits, imageMb: Number(v) || 1 })} disabled={!isOrgAdmin} />
              <NumberInput label="Videos (MB)" min={1} max={20480} value={limits.videoMb} onChange={(v) => setLimits({ ...limits, videoMb: Number(v) || 1 })} disabled={!isOrgAdmin} />
              <NumberInput label="Other attachments (MB)" min={1} max={2048} value={limits.uploadMb} onChange={(v) => setLimits({ ...limits, uploadMb: Number(v) || 1 })} disabled={!isOrgAdmin} />
            </SimpleGrid>
          )}
          {isOrgAdmin && (
            <Group mt="sm">
              <Button
                size="xs"
                disabled={!dirty}
                loading={busy === 'limits'}
                onClick={() =>
                  run(
                    'limits',
                    async () => {
                      await bridge.setSettings({ limits: limits! });
                      await refresh();
                    },
                    'Limits saved',
                  )
                }
              >
                Save limits
              </Button>
            </Group>
          )}
        </Paper>

        <Paper withBorder p="md">
          <Group gap="xs" mb="xs">
            <IconDeviceDesktop size={18} />
            <Title order={4}>Startup and backups</Title>
          </Group>
          <Stack gap="sm">
            <Switch
              label="Start Explorix when I sign in to Windows"
              checked={!!s?.launchAtLogin}
              disabled={!isOrgAdmin || busy === 'login'}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                run('login', () => bridge.setSettings({ launchAtLogin: v }), v ? 'Explorix will start with Windows' : 'Explorix will not start with Windows');
              }}
            />
            <Group align="flex-end">
              <NumberInput label="Automatic backups to keep" description="Explorix backs up your data before an update changes the database. Manual backups are never deleted automatically." min={1} max={100} w={340} value={keep ?? 10} onChange={(v) => setKeep(Number(v) || 1)} disabled={!isOrgAdmin} />
              {isOrgAdmin && (
                <Button size="xs" variant="default" disabled={keep === s?.keepBackups} loading={busy === 'keep'} onClick={() => run('keep', () => bridge.setSettings({ keepBackups: keep! }), 'Saved')}>
                  Save
                </Button>
              )}
            </Group>
            {isOwner && (
              <Text size="sm">
                Create, download and restore backups in{' '}
                <Anchor component={Link} to="/admin?tab=backups">
                  Administration › Backups
                </Anchor>
                .
              </Text>
            )}
          </Stack>
        </Paper>

        {info.data && (
          <Paper withBorder p="md">
            <Title order={4} mb="xs">
              About
            </Title>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td w={180}>Explorix</Table.Td>
                  <Table.Td>
                    {info.data.appVersion}
                    {info.data.portable ? ' (portable)' : ''}
                    {!info.data.packaged ? ' (development)' : ''}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Data version</Table.Td>
                  <Table.Td>{info.data.dataVersion ?? '—'}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>Runtime</Table.Td>
                  <Table.Td>
                    Electron {info.data.electron} · Chromium {info.data.chrome} · Node.js {info.data.node}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Paper>
        )}
      </Stack>
    </>
  );
}
