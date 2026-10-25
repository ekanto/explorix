import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, Image, Loader, Modal, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCamera, IconPlayerRecordFilled, IconPlayerStopFilled, IconRefresh } from '@tabler/icons-react';
import { desktop, type CaptureSource } from '../../lib/desktop';
import { fmtDuration } from './media';
import { toastError } from '../ui';

function pickMime() {
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
  return 'video/webm';
}

/**
 * Explorix Desktop only: capture a screenshot of a screen or window, or record
 * one as a WebM video. The captured file is handed to `onCaptured` which
 * uploads it like any other evidence (and is validated by the server).
 */
export function CaptureModal({ opened, onClose, onCaptured, maxVideoBytes }: { opened: boolean; onClose: () => void; onCaptured: (file: File) => Promise<void>; maxVideoBytes: number }) {
  const [mode, setMode] = useState<'screenshot' | 'recording'>('screenshot');
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hide, setHide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ started: number; size: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const recRef = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; size: number } | null>(null);

  const load = async () => {
    if (!desktop) return;
    setSources(null);
    setError(null);
    try {
      const list = await desktop.captureSources();
      setSources(list);
      setSelected((s) => (s && list.some((x) => x.id === s) ? s : (list.find((x) => x.kind === 'screen')?.id ?? list[0]?.id ?? null)));
    } catch (e) {
      setError((e as Error).message);
      setSources([]);
    }
  };

  useEffect(() => {
    if (opened) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [recording]);

  // Stop any live recording if the dialog is unmounted.
  useEffect(() => () => recRef.current?.stream.getTracks().forEach((t) => t.stop()), []);

  if (!desktop) return null;

  const takeScreenshot = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await desktop!.captureScreenshot(selected, hide);
      const bytes = new Uint8Array(shot.data);
      await onCaptured(new File([bytes], shot.fileName, { type: 'image/png' }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (!selected) return;
    setError(null);
    try {
      await desktop!.selectRecordingSource(selected);
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 2_500_000 });
      const state = { rec, stream, chunks: [] as Blob[], size: 0 };
      recRef.current = state;
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        state.chunks.push(e.data);
        state.size += e.data.size;
        setRecording((r) => (r ? { ...r, size: state.size } : r));
        // Stop before the recording exceeds the configured video limit.
        if (state.size > maxVideoBytes * 0.95 && rec.state === 'recording') {
          toastError(new Error('The recording reached the maximum video size and was stopped.'), 'Recording stopped');
          rec.stop();
        }
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recRef.current = null;
        setRecording(null);
        const blob = new Blob(state.chunks, { type: 'video/webm' });
        if (!blob.size) return setError('Nothing was recorded.');
        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        setBusy(true);
        try {
          await onCaptured(new File([blob], `Recording_${ts}.webm`, { type: 'video/webm' }));
          onClose();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      };
      // The user may also end sharing from the OS; treat that as "stop".
      stream.getVideoTracks()[0]?.addEventListener('ended', () => rec.state === 'recording' && rec.stop());
      rec.start(1000);
      setRecording({ started: Date.now(), size: 0 });
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message || 'Recording could not be started');
    }
  };

  const stopRecording = () => recRef.current?.rec.state === 'recording' && recRef.current.rec.stop();

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (recording) return;
        onClose();
      }}
      title="Capture evidence"
      size="xl"
      centered
      closeOnClickOutside={!recording}
      closeOnEscape={!recording}
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as typeof mode)}
            disabled={!!recording || busy}
            data={[
              { value: 'screenshot', label: 'Screenshot' },
              { value: 'recording', label: 'Screen recording' },
            ]}
          />
          <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={load} disabled={!!recording || busy}>
            Refresh
          </Button>
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {!sources ? (
          <Group justify="center" p="lg">
            <Loader />
          </Group>
        ) : !sources.length ? (
          <Text c="dimmed" size="sm">
            No screens or windows are available for capture.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
            {sources.map((s) => (
              <Card
                key={s.id}
                withBorder
                padding={6}
                onClick={() => !recording && setSelected(s.id)}
                style={{ cursor: recording ? 'default' : 'pointer', outline: selected === s.id ? '2px solid var(--mantine-color-explorix-5)' : undefined }}
                role="radio"
                aria-checked={selected === s.id}
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(s.id)}
              >
                <Image src={s.thumbnail} h={100} fit="contain" alt="" />
                <Group gap={4} mt={4} wrap="nowrap">
                  <Badge size="xs" variant="light" color={s.kind === 'screen' ? 'blue' : 'gray'}>
                    {s.kind}
                  </Badge>
                  <Text size="xs" truncate title={s.name}>
                    {s.isExplorix ? 'Explorix (this window)' : s.name}
                  </Text>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        )}
        {mode === 'screenshot' ? (
          <Group justify="space-between">
            <Checkbox label="Hide Explorix while capturing" checked={hide} onChange={(e) => setHide(e.currentTarget.checked)} />
            <Button leftSection={<IconCamera size={16} />} onClick={takeScreenshot} loading={busy} disabled={!selected}>
              Capture screenshot
            </Button>
          </Group>
        ) : (
          <Group justify="space-between">
            <Text size="xs" c="dimmed" maw={420}>
              {recording
                ? `Recording… ${fmtDuration((now - recording.started) / 1000)} · ${(recording.size / 1048576).toFixed(1)} MB. Minimize Explorix and reproduce the problem, then come back and stop.`
                : 'Records the selected screen or window as WebM video (no audio). Explorix keeps running while you record.'}
            </Text>
            {recording ? (
              <Button color="red" leftSection={<IconPlayerStopFilled size={16} />} onClick={stopRecording}>
                Stop and attach
              </Button>
            ) : (
              <Button color="red" variant="light" leftSection={<IconPlayerRecordFilled size={16} />} onClick={startRecording} loading={busy} disabled={!selected}>
                Start recording
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
