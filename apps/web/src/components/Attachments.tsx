import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Menu,
  Modal,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import {
  IconArrowDown,
  IconArrowUp,
  IconCamera,
  IconDots,
  IconDownload,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFile,
  IconGripVertical,
  IconPencil,
  IconPhoto,
  IconPlayerPlay,
  IconRestore,
  IconTrash,
  IconTrashX,
  IconUpload,
  IconVideo,
  IconX,
} from '@tabler/icons-react';
import { api, p } from '../lib/api';
import { useAuth } from '../lib/auth';
import { desktop } from '../lib/desktop';
import { bytes, fmtDateTime } from '../lib/format';
import { useProject } from '../lib/project';
import { ACCEPT, ACCEPT_HINT, contentUrl, fmtDuration, kindOf, nameClipboardFile, uploadAttachment, type Evidence, type TargetType } from './evidence/media';
import { ImageAnnotator } from './evidence/ImageAnnotator';
import { VideoEvidence } from './evidence/VideoEvidence';
import { CaptureModal } from './evidence/CaptureModal';
import { toastError, toastOk } from './ui';

export { ACCEPT, contentUrl, uploadAttachment, nameClipboardFile };
export type Attachment = Evidence;

type Upload = { key: string; name: string; progress: number; error?: string };

const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(f.name);

/** Uploads files to a target with per-file progress and client-side size checks (the server re-validates). */
export function useEvidenceUpload(targetType: TargetType, targetId: string, onDone: () => void) {
  const { pid } = useProject();
  const { uploadLimits } = useAuth();
  const [uploads, setUploads] = useState<Upload[]>([]);

  const limitFor = (f: File) => (isVideoFile(f) ? uploadLimits.videoBytes : isImageFile(f) ? uploadLimits.imageBytes : uploadLimits.otherBytes);

  const upload = async (files: File[], meta: { caption?: string } = {}) => {
    let ok = 0;
    for (const raw of files) {
      const f = nameClipboardFile(raw);
      const key = `${f.name}-${Math.random().toString(36).slice(2)}`;
      if (f.size > limitFor(f)) {
        toastError(new Error(`${f.name} is ${bytes(f.size)}; the maximum for this type is ${bytes(limitFor(f))}.`), 'File too large');
        continue;
      }
      if (f.size === 0) {
        toastError(new Error(`${f.name} is empty.`), 'Upload rejected');
        continue;
      }
      setUploads((u) => [...u, { key, name: f.name, progress: 0 }]);
      try {
        await uploadAttachment(pid, targetType, targetId, f, { caption: meta.caption, onProgress: (x) => setUploads((u) => u.map((y) => (y.key === key ? { ...y, progress: x } : y))) });
        ok++;
      } catch (e) {
        toastError(e, `Could not attach ${f.name}`);
      } finally {
        setUploads((u) => u.filter((y) => y.key !== key));
      }
    }
    if (ok) onDone();
    return ok;
  };

  return { upload, uploads, maxBytes: Math.max(uploadLimits.otherBytes, uploadLimits.imageBytes, uploadLimits.videoBytes), videoBytes: uploadLimits.videoBytes };
}

function Thumb({ pid, a, h }: { pid: string; a: Evidence; h: number }) {
  const kind = kindOf(a);
  const [broken, setBroken] = useState(false);
  const src = kind === 'IMAGE' ? contentUrl(pid, a.annotatedId ?? a.id, { thumb: true }) : kind === 'VIDEO' && a.thumbnailId ? contentUrl(pid, a.thumbnailId, { thumb: true }) : null;
  if (src && !broken)
    return (
      <div style={{ position: 'relative' }}>
        <Image src={src} alt={a.caption || a.displayName || a.fileName} h={h} fit="cover" radius="sm" onError={() => setBroken(true)} draggable={false} />
        {kind === 'VIDEO' && (
          <Group gap={4} style={{ position: 'absolute', inset: 0, justifyContent: 'center', pointerEvents: 'none' }}>
            <IconPlayerPlay size={28} color="white" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.7))' }} />
          </Group>
        )}
      </div>
    );
  return (
    <Stack h={h} justify="center" align="center" gap={2} bg="var(--ex-subtle)" style={{ borderRadius: 6 }}>
      {kind === 'VIDEO' ? <IconVideo size={28} stroke={1.4} /> : broken ? <IconPhoto size={28} stroke={1.4} /> : <IconFile size={28} stroke={1.4} />}
      <Text size="xs" c="dimmed">
        {a.fileName.split('.').pop()?.toUpperCase()}
      </Text>
    </Stack>
  );
}

/**
 * Evidence gallery and uploader used for sessions, findings, issues and test
 * results. Supports drag & drop, file picker, clipboard paste, desktop
 * screenshot/recording capture, ordering, captions, report inclusion,
 * screenshot annotation, video markers/frames, and a recoverable trash.
 */
export function Attachments({
  targetType,
  targetId,
  items,
  canUpload,
  onChange,
  compact,
  pasteToAttach,
}: {
  targetType: TargetType;
  targetId: string;
  items: Evidence[];
  canUpload: boolean;
  onChange: () => void;
  compact?: boolean;
  /** Listen for Ctrl+V anywhere on the page (skipped while typing in a field). */
  pasteToAttach?: boolean;
}) {
  const { pid, can } = useProject();
  const { user } = useAuth();
  const { upload, uploads, maxBytes, videoBytes } = useEvidenceUpload(targetType, targetId, onChange);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Evidence | null>(null);
  const [showAnnotated, setShowAnnotated] = useState(true);
  const [annotate, setAnnotate] = useState<Evidence | null>(null);
  const [video, setVideo] = useState<Evidence | null>(null);
  const [edit, setEdit] = useState<Evidence | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // Keep modals pointed at the freshest version of an item after refreshes.
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const sorted = useMemo(() => (order ? order.map((id) => byId.get(id)).filter((x): x is Evidence => !!x) : items), [order, items, byId]);
  useEffect(() => setOrder(null), [items]);
  const fresh = (x: Evidence | null) => (x ? (byId.get(x.id) ?? x) : null);

  const canManage = (a: Evidence) => canUpload && (a.uploader?.id === user?.id || can('LEAD'));

  useEffect(() => {
    if (!pasteToAttach || !canUpload) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || document.querySelector('.mantine-Modal-root')) return;
      e.preventDefault();
      upload(files).then((n) => n && toastOk(`${n} file${n > 1 ? 's' : ''} attached`));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pasteToAttach, canUpload, upload]);

  const patch = async (a: Evidence, body: Record<string, unknown>) => {
    try {
      await api.patch(p(pid, `/attachments/${a.id}`), body);
      onChange();
    } catch (e) {
      toastError(e);
    }
  };

  const saveOrder = async (ids: string[]) => {
    setOrder(ids);
    try {
      await api.post(p(pid, '/attachments/reorder'), { targetType, targetId, ids });
      onChange();
    } catch (e) {
      setOrder(null);
      toastError(e, 'Could not reorder evidence');
    }
  };
  const move = (a: Evidence, delta: number) => {
    const ids = sorted.map((x) => x.id);
    const i = ids.indexOf(a.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveOrder(ids);
  };
  const dropOn = (targetIdx: number) => {
    if (!dragId) return;
    const ids = sorted.map((x) => x.id).filter((id) => id !== dragId);
    ids.splice(targetIdx, 0, dragId);
    setDragId(null);
    if (ids.join() !== sorted.map((x) => x.id).join()) saveOrder(ids);
  };

  const trash = async (a: Evidence) => {
    try {
      await api.del(p(pid, `/attachments/${a.id}`));
      onChange();
      const id = `trash-${a.id}`;
      notifications.show({
        id,
        title: 'Moved to trash',
        autoClose: 8000,
        message: (
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" truncate>
              {a.displayName ?? a.fileName}
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              onClick={async () => {
                notifications.hide(id);
                try {
                  await api.post(p(pid, `/attachments/${a.id}/restore`));
                  onChange();
                } catch (e) {
                  toastError(e, 'Could not restore');
                }
              }}
            >
              Undo
            </Button>
          </Group>
        ),
      });
    } catch (e) {
      toastError(e);
    }
  };

  const open = (a: Evidence) => {
    const k = kindOf(a);
    if (k === 'IMAGE') {
      setShowAnnotated(true);
      setPreview(a);
    } else if (k === 'VIDEO') setVideo(a);
    else window.open(contentUrl(pid, a.id, { download: true }), '_self');
  };

  const h = compact ? 70 : 110;
  const pv = fresh(preview);

  return (
    <Stack gap="sm">
      {sorted.length > 0 && (
        <SimpleGrid cols={compact ? { base: 2, sm: 3 } : { base: 2, sm: 3, md: 4 }} spacing="xs">
          {sorted.map((a, idx) => {
            const kind = kindOf(a);
            const excluded = a.includeInReports === false;
            return (
              <Paper
                key={a.id}
                withBorder
                p={6}
                className="ex-fade-in"
                draggable={canUpload && sorted.length > 1}
                onDragStart={(e) => {
                  setDragId(a.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/x-explorix-evidence', a.id);
                }}
                onDragOver={(e) => dragId && (e.preventDefault(), (e.dataTransfer.dropEffect = 'move'))}
                onDrop={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.stopPropagation();
                  dropOn(idx);
                }}
                onDragEnd={() => setDragId(null)}
                style={{ opacity: dragId === a.id ? 0.4 : excluded ? 0.6 : 1, position: 'relative' }}
                data-testid="evidence-card"
              >
                <Badge size="xs" variant="filled" color="dark" style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, opacity: 0.85 }}>
                  E{idx + 1}
                </Badge>
                {a.annotatedId && (
                  <Tooltip label="Has an annotated copy">
                    <Badge size="xs" variant="filled" color="orange" style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}>
                      <IconPencil size={10} />
                    </Badge>
                  </Tooltip>
                )}
                {kind === 'VIDEO' && a.durationSeconds != null && (
                  <Badge size="xs" variant="filled" color="dark" style={{ position: 'absolute', top: h - 12, right: 10, zIndex: 1, opacity: 0.85 }}>
                    {fmtDuration(a.durationSeconds)}
                  </Badge>
                )}
                <div style={{ cursor: 'pointer' }} onClick={() => open(a)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(a)} aria-label={`Open ${a.displayName ?? a.fileName}`}>
                  <Thumb pid={pid} a={a} h={h} />
                </div>
                <Group justify="space-between" gap={2} mt={4} wrap="nowrap">
                  {canUpload && sorted.length > 1 && <IconGripVertical size={12} style={{ cursor: 'grab', flexShrink: 0, opacity: 0.5 }} aria-hidden />}
                  <Tooltip
                    multiline
                    w={260}
                    label={
                      <>
                        <b>{a.displayName ?? a.fileName}</b>
                        {a.caption ? <div>{a.caption}</div> : null}
                        <div>
                          {a.fileName} · {bytes(a.size)}
                          {a.width && a.height ? ` · ${a.width}×${a.height}` : ''}
                        </div>
                        {a.createdAt && (
                          <div>
                            {fmtDateTime(a.createdAt)}
                            {a.uploader ? ` · ${a.uploader.name}` : ''}
                          </div>
                        )}
                        {excluded && <div>Excluded from reports</div>}
                      </>
                    }
                  >
                    <Text size="xs" truncate style={{ flex: 1 }} td={excluded ? 'line-through' : undefined}>
                      {a.caption || a.displayName || a.fileName}
                    </Text>
                  </Tooltip>
                  <Group gap={0} wrap="nowrap">
                    {canUpload && (
                      <Tooltip label={excluded ? 'Excluded from reports — click to include' : 'Included in reports — click to exclude'}>
                        <ActionIcon variant="subtle" size="sm" color={excluded ? 'gray' : 'explorix'} aria-label={excluded ? 'Include in reports' : 'Exclude from reports'} aria-pressed={!excluded} onClick={() => patch(a, { includeInReports: excluded })}>
                          {excluded ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" size="sm" color="gray" aria-label={`Actions for ${a.displayName ?? a.fileName}`}>
                          <IconDots size={14} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {canUpload && (
                          <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => setEdit(a)}>
                            Edit label & caption
                          </Menu.Item>
                        )}
                        {canUpload && kind === 'IMAGE' && (
                          <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setAnnotate(a)}>
                            Annotate…
                          </Menu.Item>
                        )}
                        {kind === 'VIDEO' && (
                          <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => setVideo(a)}>
                            Play, markers & frames
                          </Menu.Item>
                        )}
                        {canUpload && sorted.length > 1 && (
                          <>
                            <Menu.Item leftSection={<IconArrowUp size={14} />} disabled={idx === 0} onClick={() => move(a, -1)}>
                              Move earlier
                            </Menu.Item>
                            <Menu.Item leftSection={<IconArrowDown size={14} />} disabled={idx === sorted.length - 1} onClick={() => move(a, 1)}>
                              Move later
                            </Menu.Item>
                          </>
                        )}
                        <Menu.Item leftSection={<IconDownload size={14} />} component="a" href={contentUrl(pid, a.id, { download: true })}>
                          Download original
                        </Menu.Item>
                        {canManage(a) && (
                          <>
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => trash(a)}>
                              Move to trash
                            </Menu.Item>
                          </>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
      {sorted.length === 0 && !canUpload && (
        <Text size="sm" c="dimmed">
          No evidence attached.
        </Text>
      )}
      {uploads.map((u) => (
        <Stack key={u.key} gap={2}>
          <Text size="xs">Uploading {u.name}…</Text>
          <Progress value={u.progress * 100} size="sm" animated={u.progress >= 1} aria-label={`Upload progress for ${u.name}`} />
        </Stack>
      ))}
      {canUpload && (
        <Stack gap={6}>
          <Dropzone
            onDrop={(files) => upload(files)}
            accept={ACCEPT}
            maxSize={maxBytes}
            multiple
            onReject={(r) =>
              toastError(
                new Error(
                  r
                    .map((x) => `${x.file.name}: ${x.errors[0]?.code === 'file-too-large' ? `larger than ${bytes(maxBytes)}` : x.errors[0]?.code === 'file-invalid-type' ? 'unsupported file type' : x.errors[0]?.message}`)
                    .join('; '),
                ),
                'Upload rejected',
              )
            }
            p="sm"
          >
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
                <Text size="sm">Drop screenshots, recordings or files, or click to browse</Text>
                <Text size="xs" c="dimmed">
                  {ACCEPT_HINT}. Paste screenshots with Ctrl+V.
                </Text>
              </div>
            </Group>
          </Dropzone>
          <Group gap="xs" justify="space-between">
            {desktop ? (
              <Button size="xs" variant="light" leftSection={<IconCamera size={14} />} onClick={() => setCaptureOpen(true)}>
                Capture screen…
              </Button>
            ) : (
              <span />
            )}
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconTrashX size={14} />} onClick={() => setTrashOpen(true)}>
              Evidence trash
            </Button>
          </Group>
        </Stack>
      )}

      <Modal opened={!!pv} onClose={() => setPreview(null)} size="xl" title={pv?.displayName ?? pv?.fileName} centered>
        {pv && (
          <Stack>
            {pv.annotatedId && (
              <SegmentedControl
                size="xs"
                value={showAnnotated ? 'annotated' : 'original'}
                onChange={(v) => setShowAnnotated(v === 'annotated')}
                data={[
                  { value: 'annotated', label: 'Annotated copy' },
                  { value: 'original', label: 'Original' },
                ]}
              />
            )}
            <Image src={contentUrl(pid, pv.annotatedId && showAnnotated ? pv.annotatedId : pv.id)} alt={pv.caption || pv.fileName} fit="contain" mah="70vh" />
            {pv.caption && <Text size="sm">{pv.caption}</Text>}
            {pv.description && (
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                {pv.description}
              </Text>
            )}
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {pv.fileName} · {bytes(pv.size)}
                {pv.width && pv.height ? ` · ${pv.width}×${pv.height}` : ''}
                {pv.sha256 ? ` · SHA-256 ${pv.sha256.slice(0, 12)}…` : ''}
              </Text>
              <Group gap="xs">
                {canUpload && (
                  <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setAnnotate(pv)}>
                    Annotate
                  </Button>
                )}
                {pv.annotatedId && canUpload && (
                  <Button size="xs" variant="subtle" color="red" onClick={async () => {
                    try {
                      await api.del(p(pid, `/attachments/${pv.annotatedId}`));
                      onChange();
                    } catch (e) {
                      toastError(e);
                    }
                  }}>
                    Discard annotations
                  </Button>
                )}
                <Anchor href={contentUrl(pid, pv.id, { download: true })} size="sm">
                  Download original
                </Anchor>
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>

      <ImageAnnotator pid={pid} item={fresh(annotate)} opened={!!annotate} onClose={() => setAnnotate(null)} onSaved={onChange} />
      <VideoEvidence pid={pid} item={fresh(video)} opened={!!video} canEdit={canUpload} onClose={() => setVideo(null)} onChange={onChange} />
      <EditEvidence item={fresh(edit)} onClose={() => setEdit(null)} onSave={async (body) => {
        if (edit) await patch(edit, body);
        setEdit(null);
      }} />
      {desktop && <CaptureModal opened={captureOpen} onClose={() => setCaptureOpen(false)} maxVideoBytes={videoBytes} onCaptured={async (file) => {
        const n = await upload([file]);
        if (n) toastOk(`${file.name} attached`);
      }} />}
      <EvidenceTrash opened={trashOpen} onClose={() => setTrashOpen(false)} onRestored={onChange} />
    </Stack>
  );
}

function EditEvidence({ item, onClose, onSave }: { item: Evidence | null; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [caption, setCaption] = useState('');
  const [description, setDescription] = useState('');
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!item) return;
    setLabel(item.label ?? '');
    setCaption(item.caption ?? '');
    setDescription(item.description ?? '');
    setInclude(item.includeInReports !== false);
  }, [item]);
  return (
    <Modal opened={!!item} onClose={onClose} title="Evidence details" centered>
      {item && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onSave({ label: label.trim() || null, caption: caption.trim() || null, description: description.trim() || null, includeInReports: include });
            setBusy(false);
          }}
        >
          <Stack gap="sm">
            <TextInput label="Display label" description={`Shown instead of the file name (${item.fileName}). The stored file is not renamed.`} value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={200} />
            <TextInput label="Caption" description="Printed under the evidence in reports" value={caption} onChange={(e) => setCaption(e.currentTarget.value)} maxLength={500} />
            <Textarea label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} maxRows={8} maxLength={5000} />
            <Switch label="Include in reports by default" checked={include} onChange={(e) => setInclude(e.currentTarget.checked)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}

type TrashItem = Evidence & { finding?: { id: string; key: string; title: string } | null; session?: { id: string; key: string; title: string } | null; purgeAt: string; deletedAt: string };

/** Project-wide evidence trash: restore or permanently delete. Items are purged automatically after the retention period. */
export function EvidenceTrash({ opened, onClose, onRestored }: { opened: boolean; onClose: () => void; onRestored?: () => void }) {
  const { pid, can } = useProject();
  const q = useQuery({ queryKey: ['evidence-trash', pid], queryFn: () => api.get<{ retentionDays: number; items: TrashItem[] }>(p(pid, '/attachments'), { trash: '1' }), enabled: opened });
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toastOk(msg);
      q.refetch();
      onRestored?.();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title="Evidence trash" size="lg" centered>
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Evidence moved to the trash keeps its file and links so it can be restored{q.data ? `. It is permanently deleted after ${q.data.retentionDays} days` : ''}. Findings and sessions are archived rather than deleted, so their evidence is never orphaned.
        </Text>
        {q.data && !q.data.items.length && <Text size="sm">The trash is empty.</Text>}
        {!!q.data?.items.length && (
          <Table fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              {q.data.items.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>
                    <Text size="sm" truncate maw={240}>
                      {a.displayName ?? a.fileName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {a.finding ? `${a.finding.key} · ` : a.session ? `${a.session.key} · ` : ''}
                      {bytes(a.size)} · deleted {fmtDateTime(a.deletedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td w={190}>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Button size="compact-xs" variant="light" leftSection={<IconRestore size={12} />} onClick={() => act(() => api.post(p(pid, `/attachments/${a.id}/restore`)), 'Evidence restored')}>
                        Restore
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => window.confirm(`Permanently delete ${a.fileName}? This cannot be undone.`) && act(() => api.del(p(pid, `/attachments/${a.id}/permanent`)), 'Evidence permanently deleted')}
                      >
                        Delete forever
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {can('LEAD') && !!q.data?.items.length && (
          <Group justify="flex-end">
            <Button
              size="xs"
              color="red"
              variant="light"
              leftSection={<IconTrashX size={14} />}
              onClick={() => window.confirm('Permanently delete everything in the evidence trash for this project?') && act(() => api.post(p(pid, '/attachments/trash/empty')), 'Trash emptied')}
            >
              Empty trash
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
