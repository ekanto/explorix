import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Group, Image, Modal, SimpleGrid, Stack, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core';
import { IconCamera, IconDownload, IconFlag, IconPhotoStar, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { contentUrl, fmtDuration, grabFrame, uploadDerivative, type Evidence } from './media';
import { toastError, toastOk } from '../ui';

/**
 * Plays video evidence and manages its report material: important-moment
 * markers, captured frames (used as static previews in PDF/DOCX) and the
 * representative thumbnail. The original video file is never modified.
 */
export function VideoEvidence({ pid, item, opened, canEdit, onClose, onChange }: { pid: string; item: Evidence | null; opened: boolean; canEdit: boolean; onClose: () => void; onChange: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playError, setPlayError] = useState(false);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [withFrame, setWithFrame] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setPlayError(false);
    setLabel('');
    setNote('');
  }, [item?.id]);

  if (!item) return null;
  const v = () => videoRef.current!;
  const base = item.fileName.replace(/\.[^.]+$/, '');

  const captureFrame = async (caption?: string) => {
    const t = v().currentTime;
    const blob = await grabFrame(v());
    const res = await uploadDerivative(pid, item.id, blob, { derivation: 'FRAME', frameTimeSeconds: t, caption, fileName: `${base}_frame_${fmtDuration(t).replace(/:/g, '-')}.jpg` });
    return res.attachment.frames?.slice(-1)[0]?.id ?? null;
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      onChange();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const addMarker = () =>
    run('marker', async () => {
      v().pause();
      const t = v().currentTime;
      const frameId = withFrame && !playError ? await captureFrame(label.trim()) : null;
      await api.post(p(pid, `/attachments/${item.id}/markers`), { timeSeconds: Math.round(t * 100) / 100, label: label.trim(), note: note.trim() || null, frameId });
      setLabel('');
      setNote('');
      toastOk(`Marker added at ${fmtDuration(t)}`);
    });

  const jump = (t: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = t;
    el.play().catch(() => undefined);
  };

  const frameById = new Map((item.frames ?? []).map((f) => [f.id, f]));

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={item.displayName ?? item.fileName} centered>
      <Stack gap="sm">
        {playError ? (
          <Alert color="orange" title="This video cannot be played inside Explorix">
            The file was stored unchanged, but its codec is not supported by the built-in player (common for some MOV/HEVC recordings).
            It will still be listed in reports and packaged as the original file. <Anchor href={contentUrl(pid, item.id, { download: true })}>Download the original</Anchor> to view it in another player.
          </Alert>
        ) : (
          <video
            ref={videoRef}
            src={contentUrl(pid, item.id)}
            controls
            preload="metadata"
            style={{ width: '100%', maxHeight: '55vh', background: '#000', borderRadius: 6 }}
            onError={() => setPlayError(true)}
            aria-label={`Video: ${item.displayName ?? item.fileName}`}
          />
        )}
        <Group gap="xs" justify="space-between">
          <Group gap="xs">
            {item.durationSeconds != null && <Badge variant="light">Duration {fmtDuration(item.durationSeconds)}</Badge>}
            {item.width && item.height && (
              <Badge variant="light" color="gray">
                {item.width}×{item.height}
              </Badge>
            )}
            <Badge variant="light" color="gray">
              {(item.size / 1048576).toFixed(1)} MB
            </Badge>
          </Group>
          <Group gap="xs">
            {canEdit && !playError && (
              <>
                <Button size="xs" variant="default" leftSection={<IconCamera size={14} />} loading={busy === 'frame'} onClick={() => run('frame', async () => {
                  v().pause();
                  await captureFrame();
                  toastOk('Frame captured for reports');
                })}>
                  Capture frame
                </Button>
                <Button size="xs" variant="default" leftSection={<IconPhotoStar size={14} />} loading={busy === 'thumb'} onClick={() => run('thumb', async () => {
                  v().pause();
                  const blob = await grabFrame(v(), 1280);
                  await uploadDerivative(pid, item.id, blob, { derivation: 'THUMBNAIL', fileName: `${base}_thumbnail.jpg` });
                  toastOk('Thumbnail updated');
                })}>
                  Use as thumbnail
                </Button>
              </>
            )}
            <Button size="xs" variant="subtle" component="a" href={contentUrl(pid, item.id, { download: true })} leftSection={<IconDownload size={14} />}>
              Original
            </Button>
          </Group>
        </Group>

        <Text fw={600} size="sm" mt="xs">
          Important moments
        </Text>
        {item.markers?.length ? (
          <Table verticalSpacing={4} fz="sm">
            <Table.Tbody>
              {item.markers.map((m) => {
                const frame = m.frameId ? frameById.get(m.frameId) : null;
                return (
                  <Table.Tr key={m.id}>
                    <Table.Td w={70}>
                      <Anchor component="button" type="button" onClick={() => jump(m.timeSeconds)} size="sm" ff="monospace">
                        {fmtDuration(m.timeSeconds)}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {m.label}
                      </Text>
                      {m.note && (
                        <Text size="xs" c="dimmed">
                          {m.note}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td w={90}>{frame && <Image src={contentUrl(pid, frame.id, { thumb: true })} h={40} w={72} fit="cover" radius="xs" alt={`Frame at ${fmtDuration(m.timeSeconds)}`} />}</Table.Td>
                    <Table.Td w={40}>
                      {canEdit && (
                        <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Delete marker ${m.label}`} onClick={() => run('del-' + m.id, async () => void (await api.del(p(pid, `/attachments/${item.id}/markers/${m.id}`))))}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="xs" c="dimmed">
            No markers yet. Pause at an important moment and add a marker — it is listed with its timestamp (and a captured frame) in reports.
          </Text>
        )}
        {canEdit && !playError && (
          <Group align="flex-end" gap="xs">
            <TextInput label="Marker label" placeholder="e.g. Checkout button stops responding" value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={200} style={{ flex: 2 }} />
            <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize maxRows={3} maxLength={2000} style={{ flex: 2 }} />
            <Stack gap={4}>
              <Checkbox size="xs" label="Capture frame" checked={withFrame} onChange={(e) => setWithFrame(e.currentTarget.checked)} />
              <Button leftSection={<IconFlag size={14} />} disabled={!label.trim()} loading={busy === 'marker'} onClick={addMarker}>
                Add at current time
              </Button>
            </Stack>
          </Group>
        )}

        {!!item.frames?.length && (
          <>
            <Text fw={600} size="sm" mt="xs">
              Captured frames ({item.frames.length})
            </Text>
            <SimpleGrid cols={{ base: 3, sm: 5 }} spacing="xs">
              {item.frames.map((f) => (
                <Stack key={f.id} gap={2}>
                  <Image src={contentUrl(pid, f.id, { thumb: true })} h={70} fit="cover" radius="xs" alt={`Frame at ${fmtDuration(f.frameTimeSeconds)}`} />
                  <Group justify="space-between" gap={2} wrap="nowrap">
                    <Tooltip label="Play from here">
                      <Anchor component="button" type="button" size="xs" ff="monospace" onClick={() => f.frameTimeSeconds != null && jump(f.frameTimeSeconds)}>
                        <IconPlayerPlay size={10} /> {fmtDuration(f.frameTimeSeconds)}
                      </Anchor>
                    </Tooltip>
                    {canEdit && (
                      <ActionIcon variant="subtle" color="red" size="xs" aria-label="Remove frame" onClick={() => run('fdel-' + f.id, async () => void (await api.del(p(pid, `/attachments/${f.id}`))))}>
                        <IconTrash size={12} />
                      </ActionIcon>
                    )}
                  </Group>
                </Stack>
              ))}
            </SimpleGrid>
          </>
        )}
        <Text size="xs" c="dimmed">
          PDF and Word reports cannot play video: they show the thumbnail, captured frames, markers and a reference to the original file, which is included in report packages.
        </Text>
      </Stack>
    </Modal>
  );
}
