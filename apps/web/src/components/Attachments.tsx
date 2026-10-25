import { useState } from 'react';
import { ActionIcon, Anchor, Group, Image, Modal, Paper, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { IconDownload, IconFile, IconPhoto, IconTrash, IconUpload, IconX } from '@tabler/icons-react';
import { api, p } from '../lib/api';
import { bytes, fmtDateTime } from '../lib/format';
import { useProject } from '../lib/project';
import { toastError } from './ui';

export type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  caption?: string | null;
  createdAt?: string;
  uploader?: { id: string; name: string } | null;
};

// react-dropzone matches a file by MIME type or by any listed extension; the server re-validates by content.
export const ACCEPT: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'application/zip': ['.zip'],
  'text/plain': ['.txt', '.log'],
  'text/markdown': ['.md'],
  'application/json': ['.json', '.har'],
  'text/csv': ['.csv'],
  'application/xml': ['.xml'],
  'text/xml': ['.xml'],
};

export const contentUrl = (pid: string, id: string, download = false) => `/api/projects/${pid}/attachments/${id}/content${download ? '?download=1' : ''}`;

export async function uploadAttachment(pid: string, targetType: string, targetId: string, file: File, caption?: string) {
  const fd = new FormData();
  fd.append('targetType', targetType);
  fd.append('targetId', targetId);
  if (caption) fd.append('caption', caption);
  fd.append('file', file);
  return api.post<{ attachment: Attachment & { url: string } }>(p(pid, '/attachments'), fd);
}

/** Evidence gallery + uploader. Images preview inline; everything else downloads. */
export function Attachments({
  targetType,
  targetId,
  items,
  canUpload,
  onChange,
  compact,
}: {
  targetType: 'session' | 'finding' | 'issue' | 'testResult' | 'automationResult';
  targetId: string;
  items: Attachment[];
  canUpload: boolean;
  onChange: () => void;
  compact?: boolean;
}) {
  const { pid } = useProject();
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState('');
  const [preview, setPreview] = useState<Attachment | null>(null);

  const onDrop = async (files: File[]) => {
    setBusy(true);
    try {
      for (const f of files) await uploadAttachment(pid, targetType, targetId, f, caption || undefined);
      setCaption('');
      onChange();
    } catch (e) {
      toastError(e, 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Attachment) => {
    try {
      await api.del(p(pid, `/attachments/${a.id}`));
      onChange();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Stack gap="sm">
      {items.length > 0 && (
        <SimpleGrid cols={compact ? { base: 2, sm: 3 } : { base: 2, sm: 3, md: 4 }} spacing="xs">
          {items.map((a) => {
            const isImg = a.mimeType.startsWith('image/');
            return (
              <Paper key={a.id} withBorder p={6} className="ex-fade-in">
                {isImg ? (
                  <Image
                    src={contentUrl(pid, a.id)}
                    alt={a.caption || a.fileName}
                    h={compact ? 70 : 100}
                    fit="cover"
                    radius="sm"
                    style={{ cursor: 'zoom-in' }}
                    onClick={() => setPreview(a)}
                  />
                ) : (
                  <Group h={compact ? 70 : 100} justify="center" bg="var(--ex-subtle)" style={{ borderRadius: 6 }}>
                    <IconFile size={30} stroke={1.4} />
                  </Group>
                )}
                <Group justify="space-between" gap={4} mt={4} wrap="nowrap">
                  <Tooltip label={`${a.fileName} · ${bytes(a.size)}${a.createdAt ? ` · ${fmtDateTime(a.createdAt)}` : ''}`}>
                    <Text size="xs" truncate style={{ flex: 1 }}>
                      {a.caption || a.fileName}
                    </Text>
                  </Tooltip>
                  <Group gap={0} wrap="nowrap">
                    <ActionIcon component="a" href={contentUrl(pid, a.id, true)} variant="subtle" size="sm" color="gray" aria-label={`Download ${a.fileName}`}>
                      <IconDownload size={14} />
                    </ActionIcon>
                    {canUpload && (
                      <ActionIcon variant="subtle" size="sm" color="gray" aria-label={`Delete ${a.fileName}`} onClick={() => remove(a)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
      {items.length === 0 && !canUpload && (
        <Text size="sm" c="dimmed">
          No evidence attached.
        </Text>
      )}
      {canUpload && (
        <Stack gap={6}>
          <TextInput size="xs" placeholder="Caption for the next upload (optional)" value={caption} onChange={(e) => setCaption(e.currentTarget.value)} aria-label="Attachment caption" />
          <Dropzone onDrop={onDrop} loading={busy} accept={ACCEPT} maxSize={15 * 1024 * 1024} onReject={(r) => toastError(new Error(r[0]?.errors[0]?.message ?? 'File rejected'), 'Upload rejected')} p="sm">
            <Group justify="center" gap="sm" mih={compact ? 40 : 60} style={{ pointerEvents: 'none' }}>
              <Dropzone.Accept>
                <IconUpload size={22} />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={22} />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconPhoto size={22} stroke={1.5} />
              </Dropzone.Idle>
              <div>
                <Text size="sm">Drop screenshots or files, or click to browse</Text>
                <Text size="xs" c="dimmed">
                  Images, PDF, video, ZIP, logs, HAR, JSON, CSV · max 15 MB · paste screenshots with Ctrl+V in the workbench
                </Text>
              </div>
            </Group>
          </Dropzone>
        </Stack>
      )}
      <Modal opened={!!preview} onClose={() => setPreview(null)} size="xl" title={preview?.caption || preview?.fileName}>
        {preview && (
          <Stack>
            <Image src={contentUrl(pid, preview.id)} alt={preview.caption || preview.fileName} fit="contain" mah="75vh" />
            <Anchor href={contentUrl(pid, preview.id, true)} size="sm">
              Download original
            </Anchor>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
