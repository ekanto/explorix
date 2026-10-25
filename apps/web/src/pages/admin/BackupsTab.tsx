import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Alert, Badge, Button, Code, FileButton, Group, List, Modal, Paper, Progress, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconDatabase, IconDeviceFloppy, IconDownload, IconFolderOpen, IconHistory, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { api, ApiError, download } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { desktop } from '../../lib/desktop';
import { bytes, fmtDateTime } from '../../lib/format';
import { EmptyState, toastError, toastOk } from '../../components/ui';
import { sendForm } from '../../components/evidence/media';

interface BackupInfo {
  name: string;
  bytes: number;
  createdAt: string;
  reason: 'manual' | 'auto' | 'before-restore' | 'before-migration' | 'uploaded' | null;
  appVersion: string | null;
  dataVersion: string | null;
  evidenceCount: number | null;
  valid: boolean;
  problem: string | null;
}

const REASON: Record<string, { label: string; color: string }> = {
  manual: { label: 'Manual', color: 'blue' },
  auto: { label: 'Automatic', color: 'gray' },
  'before-restore': { label: 'Before restore', color: 'orange' },
  'before-migration': { label: 'Before upgrade', color: 'grape' },
  uploaded: { label: 'Imported', color: 'teal' },
};

type RestoreTarget = { kind: 'existing'; name: string } | { kind: 'upload'; file: File } | { kind: 'desktop-file' };

/** Administration › Backups: complete, restorable backups of the database and all evidence (single-workspace installations). */
export function BackupsTab() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isOwner = user?.orgRole === 'OWNER';
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ backups: BackupInfo[]; location: string | null }>('/admin/backups'), enabled: isOwner, retry: false });
  const [creating, setCreating] = useState(false);
  const [restore, setRestore] = useState<RestoreTarget | null>(null);
  const [confirm, setConfirm] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  if (!isOwner) return <EmptyState icon={<IconDatabase size={26} />} title="Owner only" description="Only the workspace owner can create and restore backups." />;
  const multiTenant = q.error instanceof ApiError && q.error.code === 'multi_tenant';

  const create = async () => {
    setCreating(true);
    try {
      const r = await api.post<{ backup: BackupInfo }>('/admin/backups');
      toastOk(`Backup created (${bytes(r.backup.bytes)}, ${r.backup.evidenceCount ?? 0} evidence files)`);
      qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      toastError(e, 'Backup failed');
    } finally {
      setCreating(false);
    }
  };

  const saveCopy = async (b: BackupInfo) => {
    try {
      if (desktop) {
        const r = await desktop.saveBackupAs(b.name);
        if (r.status === 'saved') toastOk(`Saved ${r.fileName} to ${r.folder}`);
      } else await download(`/admin/backups/${encodeURIComponent(b.name)}/download`, b.name);
    } catch (e) {
      toastError(e, 'Could not save the backup');
    }
  };

  const remove = (b: BackupInfo) =>
    modals.openConfirmModal({
      title: 'Delete backup?',
      children: (
        <Text size="sm">
          <Code>{b.name}</Code> will be permanently deleted from the backups folder. Copies you saved elsewhere are not affected.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(`/admin/backups/${encodeURIComponent(b.name)}`);
          qc.invalidateQueries({ queryKey: ['backups'] });
          toastOk('Backup deleted');
        } catch (e) {
          toastError(e);
        }
      },
    });

  const afterRestore = async (summary: string) => {
    setRestore(null);
    toastOk(`${summary} Sign in again to continue.`, 'Backup restored');
    await logout();
    navigate('/login', { replace: true });
  };

  const doRestore = async () => {
    if (!restore) return;
    setRestoring(true);
    setProgress(null);
    try {
      if (restore.kind === 'existing') {
        const r = await api.post<{ rows: number; evidenceRestored: number; evidenceMissing: string[] }>(`/admin/backups/${encodeURIComponent(restore.name)}/restore`, { confirm });
        await afterRestore(`${r.rows} records and ${r.evidenceRestored} evidence files restored${r.evidenceMissing.length ? ` (${r.evidenceMissing.length} files were missing from the backup)` : ''}.`);
      } else if (restore.kind === 'upload') {
        const fd = new FormData();
        fd.append('confirm', confirm);
        fd.append('file', restore.file);
        const r = await sendForm<{ rows: number; evidenceRestored: number }>('/admin/backups/restore-upload', fd, { onProgress: (f) => setProgress(Math.round(f * 100)) });
        await afterRestore(`${r.rows} records and ${r.evidenceRestored} evidence files restored.`);
      } else {
        const r = await desktop!.restoreBackupFromFile();
        if (r.status === 'cancelled') {
          setRestoring(false);
          return;
        }
        await afterRestore(`${r.rows} records and ${r.evidenceRestored} evidence files restored.`);
      }
    } catch (e) {
      toastError(e, 'Restore failed — your current data was not changed');
    } finally {
      setRestoring(false);
      setProgress(null);
    }
  };

  return (
    <Stack maw={1000}>
      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconDatabase size={20} />
              <Title order={5}>Backups</Title>
            </Group>
            <Text size="sm" c="dimmed" maw={640} mt={4}>
              A backup is a single ZIP file containing the whole database and every evidence file (screenshots, videos, attachments), so evidence stays linked to its findings after a restore.
            </Text>
          </div>
          <Group gap="xs">
            {desktop && (
              <Button variant="default" leftSection={<IconFolderOpen size={16} />} onClick={() => desktop!.openFolder('backups').catch((e) => toastError(e))}>
                Open folder
              </Button>
            )}
            <Button leftSection={<IconPlus size={16} />} onClick={create} loading={creating} disabled={multiTenant}>
              Create backup
            </Button>
          </Group>
        </Group>
        {q.data?.location && (
          <Text size="xs" c="dimmed" mt="xs">
            Stored in <Code>{q.data.location}</Code>. Keep a copy on another drive too: use <b>Save a copy</b>.
          </Text>
        )}
      </Paper>

      {multiTenant ? (
        <Alert color="gray" title="Not available on this server">
          This installation hosts several organizations, so whole-installation backups are disabled. Use database-level backups (see the Data export tab).
        </Alert>
      ) : q.isLoading ? null : q.error ? (
        <Alert color="red">{(q.error as Error).message}</Alert>
      ) : !q.data?.backups.length ? (
        <EmptyState icon={<IconHistory size={26} />} title="No backups yet" description="Create your first backup now. Explorix also creates one automatically before an update changes the database and before every restore." />
      ) : (
        <Paper withBorder>
          <Table.ScrollContainer minWidth={760}>
            <Table fz="sm" verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Contents</Table.Th>
                  <Table.Th>Version</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.backups.map((b) => (
                  <Table.Tr key={b.name}>
                    <Table.Td>
                      <Text size="sm">{fmtDateTime(b.createdAt)}</Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {b.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {b.valid ? (
                        <Badge size="sm" variant="light" color={REASON[b.reason ?? '']?.color ?? 'gray'}>
                          {REASON[b.reason ?? '']?.label ?? 'Backup'}
                        </Badge>
                      ) : (
                        <Tooltip label={b.problem ?? 'Unreadable'} multiline w={260}>
                          <Badge size="sm" color="red" leftSection={<IconAlertTriangle size={10} />}>
                            Damaged
                          </Badge>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {bytes(b.bytes)}
                        {b.evidenceCount != null ? ` · ${b.evidenceCount} evidence files` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{b.appVersion ? `Explorix ${b.appVersion}` : '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Button size="compact-xs" variant="light" color="orange" disabled={!b.valid} onClick={() => (setConfirm(''), setRestore({ kind: 'existing', name: b.name }))}>
                          Restore…
                        </Button>
                        <Tooltip label={desktop ? 'Save a copy…' : 'Download'}>
                          <ActionIcon variant="subtle" aria-label={desktop ? `Save a copy of ${b.name}` : `Download ${b.name}`} onClick={() => saveCopy(b)}>
                            {desktop ? <IconDeviceFloppy size={16} /> : <IconDownload size={16} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete">
                          <ActionIcon variant="subtle" color="red" aria-label={`Delete ${b.name}`} onClick={() => remove(b)}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}

      {!multiTenant && (
        <Paper withBorder p="md">
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">
                Restore from a backup file
              </Text>
              <Text size="xs" c="dimmed">
                For example a backup saved to another drive, or copied from another computer running Explorix.
              </Text>
            </div>
            {desktop ? (
              <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => (setConfirm(''), setRestore({ kind: 'desktop-file' }))}>
                Choose backup file…
              </Button>
            ) : (
              <FileButton accept=".zip,application/zip" onChange={(f) => f && (setConfirm(''), setRestore({ kind: 'upload', file: f }))}>
                {(fp) => (
                  <Button {...fp} variant="default" leftSection={<IconUpload size={16} />}>
                    Upload backup…
                  </Button>
                )}
              </FileButton>
            )}
          </Group>
        </Paper>
      )}

      <Modal opened={!!restore} onClose={() => !restoring && setRestore(null)} title="Restore backup" centered size="lg" closeOnClickOutside={!restoring} withCloseButton={!restoring}>
        <Stack>
          <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="This replaces all current data">
            <List size="sm" spacing={2}>
              <List.Item>Every project, finding and evidence file is replaced with the contents of the backup.</List.Item>
              <List.Item>Explorix first saves a safety backup of the current data, so you can go back.</List.Item>
              <List.Item>Everyone, including you, has to sign in again afterwards.</List.Item>
              <List.Item>Integration secrets (such as API tokens) from another computer must be entered again.</List.Item>
            </List>
          </Alert>
          {restore?.kind === 'existing' && (
            <Text size="sm">
              Backup: <Code>{restore.name}</Code>
            </Text>
          )}
          {restore?.kind === 'upload' && (
            <Text size="sm">
              File: <Code>{restore.file.name}</Code> ({bytes(restore.file.size)})
            </Text>
          )}
          {restore?.kind === 'desktop-file' && <Text size="sm">After you confirm, choose the backup file. Explorix checks it before changing anything.</Text>}
          <TextInput label="Type RESTORE to confirm" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} data-autofocus autoComplete="off" disabled={restoring} />
          {restoring && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                {progress !== null && progress < 100 ? `Uploading… ${progress}%` : 'Restoring — this can take a few minutes for large evidence folders. Do not close Explorix.'}
              </Text>
              <Progress value={progress !== null && progress < 100 ? progress : 100} animated />
            </Stack>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRestore(null)} disabled={restoring}>
              Cancel
            </Button>
            <Button color="orange" onClick={doRestore} loading={restoring} disabled={confirm !== 'RESTORE'}>
              Restore
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
