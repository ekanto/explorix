import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Group,
  Kbd,
  List,
  Menu,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Table,
  Tabs,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useHotkeys, useInterval } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import type { Editor } from '@tiptap/react';
import {
  IconArchive,
  IconArrowBackUp,
  IconBan,
  IconBulb,
  IconCheck,
  IconCircleCheck,
  IconCloudCheck,
  IconCloudUpload,
  IconCopy,
  IconDots,
  IconDownload,
  IconEdit,
  IconFileDescription,
  IconFlag,
  IconKeyboard,
  IconLink,
  IconMessage,
  IconNote,
  IconPaperclip,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconPrinter,
  IconSend,
  IconSparkles,
  IconTarget,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { api, ApiError, download, p } from '../../lib/api';
import { useAiStatus } from '../../lib/ai';
import { useAuth } from '../../lib/auth';
import { options, PRIORITY } from '../../lib/constants';
import { clock, duration, fmtDate, fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { Attachments, contentUrl, uploadAttachment } from '../../components/Attachments';
import { Comments } from '../../components/Comments';
import { CustomFieldsInput, CustomFieldsView } from '../../components/CustomFields';
import { FindingFormModal } from '../../components/FindingForm';
import { RichText } from '../../components/RichText';
import { AiDraftBadge } from '../../components/AiNotice';
import {
  ClassificationBadge,
  EmptyState,
  ErrorState,
  FindingStatusBadge,
  KeyLink,
  Loading,
  PriorityBadge,
  RichView,
  SessionStatusBadge,
  SeverityBadge,
  TextBlock,
  toastError,
  toastOk,
  UserLabel,
} from '../../components/ui';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'rejected' | 'conflict';
type Draft = { notes: string; baseVersion: number; savedAt: number };

const draftKey = (id: string) => `explorix.session-notes.${id}`;
const readDraft = (id: string): Draft | null => {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
};

const LOG_META: Record<string, { icon: typeof IconNote; color: string; label: string }> = {
  NOTE: { icon: IconNote, color: 'gray', label: 'Note' },
  FINDING: { icon: IconBulb, color: 'orange', label: 'Finding' },
  STATUS_CHANGE: { icon: IconFlag, color: 'explorix', label: 'Status' },
  ATTACHMENT: { icon: IconPaperclip, color: 'blue', label: 'Evidence' },
  SYSTEM: { icon: IconFlag, color: 'gray', label: 'System' },
};

const TEST_IDEA_PREFIX = 'Test idea explored: ';

export default function Workbench() {
  const { id = '' } = useParams();
  const { pid } = useProject();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['session', pid, id],
    queryFn: async () => ({ ...(await api.get(p(pid, `/sessions/${id}`))), fetchedAt: Date.now() }),
    refetchOnWindowFocus: false,
  });
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['session', pid, id] });
    qc.invalidateQueries({ queryKey: ['sessions', pid] });
  }, [qc, pid, id]);

  if (q.isLoading) return <Loading label="Opening session…" />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return null;
  return <WorkbenchView key={id} data={q.data} refresh={refresh} refetch={() => q.refetch()} />;
}

function WorkbenchView({ data, refresh, refetch }: { data: any; refresh: () => void; refetch: () => Promise<unknown> }) {
  const s = data.session;
  const perms = data.permissions;
  const { pid, project, can } = useProject();
  const { user } = useAuth();
  const navigate = useNavigate();
  const ai = useAiStatus();

  // ---------------- Timer ----------------
  const running = s.status === 'IN_PROGRESS';
  const [now, setNow] = useState(Date.now());
  const tick = useInterval(() => setNow(Date.now()), 1000);
  useEffect(() => {
    if (running) tick.start();
    else tick.stop();
    return tick.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const elapsed = s.liveElapsedSeconds + (running ? Math.max(0, Math.floor((now - data.fetchedAt) / 1000)) : 0);
  const timeboxSec = s.timeboxMinutes * 60;
  const pctUsed = Math.min(100, (elapsed / timeboxSec) * 100);
  const over = elapsed > timeboxSec;

  // ---------------- Notes autosave with optimistic concurrency + local recovery ----------------
  const [notes, setNotes] = useState<string>(s.notes ?? '');
  const [resetKey, setResetKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(s.notesUpdatedAt ?? null);
  const versionRef = useRef<number>(s.version);
  const notesRef = useRef(notes);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const [conflict, setConflict] = useState<{ notes: string; version: number } | null>(null);
  const [recovered, setRecovered] = useState<Draft | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onEditor = useCallback((e: Editor | null) => {
    editorRef.current = e;
  }, []);

  // Restore an unsaved local draft (e.g. after a crash, refresh, or lost connection).
  useEffect(() => {
    const d = readDraft(s.id);
    if (!d) return;
    const norm = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const serverSavedAfterDraft = s.notesUpdatedAt && new Date(s.notesUpdatedAt).getTime() >= d.savedAt;
    if (serverSavedAfterDraft || norm(d.notes) === norm(s.notes ?? '')) {
      localStorage.removeItem(draftKey(s.id));
      return;
    }
    if (perms.canEdit) setRecovered(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (force = false) => {
      window.clearTimeout(timerRef.current);
      if (savingRef.current || (!dirtyRef.current && !force)) return;
      savingRef.current = true;
      setSaveState('saving');
      const sent = notesRef.current;
      try {
        const r = await api.put(p(pid, `/sessions/${s.id}/notes`), { notes: sent, baseVersion: versionRef.current, force: force || undefined });
        versionRef.current = r.version;
        setSavedAt(r.notesUpdatedAt);
        if (notesRef.current === sent) {
          dirtyRef.current = false;
          localStorage.removeItem(draftKey(s.id));
          setSaveState('saved');
        } else {
          setSaveState('dirty');
          timerRef.current = window.setTimeout(() => save(), 800);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.code === 'conflict') {
          const d = e.details as { notes: string; version: number };
          setConflict({ notes: d?.notes ?? '', version: d?.version ?? versionRef.current });
          setSaveState('conflict');
        } else if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
          // Not transient (e.g. session locked or permission revoked): keep the local draft, stop retrying.
          setSaveState('rejected');
          toastError(e, 'Notes not saved');
        } else {
          setSaveState('error');
          timerRef.current = window.setTimeout(() => save(), 5000);
        }
      } finally {
        savingRef.current = false;
      }
    },
    [pid, s.id],
  );

  const onNotesChange = (html: string) => {
    if (!perms.canEdit) return;
    setNotes(html);
    notesRef.current = html;
    dirtyRef.current = true;
    setSaveState('dirty');
    localStorage.setItem(draftKey(s.id), JSON.stringify({ notes: html, baseVersion: versionRef.current, savedAt: Date.now() } satisfies Draft));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => save(), 1200);
  };

  const replaceNotes = (html: string) => {
    setNotes(html);
    notesRef.current = html;
    setResetKey((k) => k + 1);
  };

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.clearTimeout(timerRef.current);
      // Flush pending notes when navigating away inside the app; the local draft remains as a fallback.
      if (dirtyRef.current) void save();
    };
  }, [save]);

  // ---------------- Actions ----------------
  const [busy, setBusy] = useState<string | null>(null);
  const transition = async (action: string, body?: object) => {
    setBusy(action);
    try {
      if (dirtyRef.current) await save();
      await api.post(p(pid, `/sessions/${s.id}/${action}`), body ?? {});
      await refetch();
      refresh();
      return true;
    } catch (e) {
      toastError(e);
      if (e instanceof ApiError && e.status === 409) await refetch();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const [findingOpen, setFindingOpen] = useState(false);
  const [findingDefaults, setFindingDefaults] = useState<object | undefined>(undefined);
  const [finishOpen, setFinishOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<null | 'approve' | 'request-changes'>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const logInputRef = useRef<HTMLInputElement>(null);

  const openFinding = (defaults?: object) => {
    if (!perms.canEdit) return;
    setFindingDefaults(defaults);
    setFindingOpen(true);
  };

  const togglePause = () => {
    if (!perms.canOperate || busy) return;
    if (s.status === 'IN_PROGRESS') transition('pause');
    else if (s.status === 'PAUSED' || s.status === 'CHANGES_REQUESTED') transition('resume');
    else if (s.status === 'DRAFT') transition('start');
  };

  useHotkeys([
    ['f', () => openFinding()],
    ['n', () => editorRef.current?.commands.focus('end')],
    ['l', () => logInputRef.current?.focus()],
    ['p', togglePause],
    ['shift+/', () => setHelpOpen(true)],
  ]);
  useHotkeys([['mod+shift+F', () => openFinding()]], [], true);

  // Paste a screenshot anywhere on the workbench to attach it as session evidence.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (findingOpen || !perms.canEdit) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      for (const f of files) {
        const file = f.name === 'image.png' ? new File([f], `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, { type: f.type }) : f;
        try {
          await uploadAttachment(pid, 'session', s.id, file);
          toastOk(`${file.name} attached to ${s.key}`);
        } catch (err) {
          toastError(err, 'Upload failed');
        }
      }
      refetch();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [findingOpen, perms.canEdit, pid, s.id, s.key, refetch]);

  const readOnlyReason = !perms.canEdit
    ? s.archivedAt
      ? 'This session is archived.'
      : !perms.canOperate
        ? `Only ${s.tester?.name ?? 'the assigned tester'} or a lead can work in this session.`
        : `This session is ${s.status.toLowerCase().replace('_', ' ')} and locked for editing.`
    : null;

  const exploredIdeas = useMemo(
    () => new Set<string>(s.logEntries.filter((l: any) => l.type === 'NOTE' && l.content?.startsWith(TEST_IDEA_PREFIX)).map((l: any) => l.content.slice(TEST_IDEA_PREFIX.length))),
    [s.logEntries],
  );

  return (
    <Box className="ex-fade-in">
      {/* ---------------- Header & control bar ---------------- */}
      <Paper withBorder p="md" mb="md" className="ex-workbench-bar">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Stack gap={4} style={{ minWidth: 280, flex: '1 1 380px' }}>
            <Group gap="xs">
              <Text className="ex-key" size="sm">
                {s.key}
              </Text>
              <SessionStatusBadge value={s.status} />
              <PriorityBadge value={s.priority} size="sm" />
              {s.archivedAt && (
                <Badge color="dark" size="sm">
                  Archived
                </Badge>
              )}
            </Group>
            <Title order={2} style={{ lineHeight: 1.2 }}>
              {s.title}
            </Title>
            <Group gap="md">
              <Text size="sm" c="dimmed">
                Charter{' '}
                <Anchor component={Link} to={`/projects/${pid}/charters/${s.charter.id}`} size="sm">
                  {s.charter.key} {s.charter.title}
                </Anchor>
              </Text>
              <Group gap={6}>
                <Text size="sm" c="dimmed">
                  Tester
                </Text>
                <UserLabel user={s.tester} />
              </Group>
              {s.dueDate && (
                <Text size="sm" c={new Date(s.dueDate) < new Date() && !['COMPLETED', 'APPROVED', 'IN_REVIEW'].includes(s.status) ? 'red' : 'dimmed'}>
                  Due {fmtDate(s.dueDate)}
                </Text>
              )}
            </Group>
          </Stack>

          <Group gap="md" wrap="wrap" justify="flex-end" className="ex-no-print">
            <Stack gap={2} align="flex-end" miw={170}>
              <Text className={`ex-timer${running ? ' ex-pulse' : ''}`} fz={32} fw={700} c={over ? 'orange' : undefined} aria-live="off" aria-label="Elapsed session time">
                {clock(elapsed)}
              </Text>
              <Progress value={pctUsed} w={170} size="sm" color={over ? 'orange' : 'explorix'} aria-label="Timebox used" />
              <Text size="xs" c="dimmed">
                {over ? `${duration(elapsed - timeboxSec)} over ` : `${duration(Math.max(0, timeboxSec - elapsed))} left of `}
                {s.timeboxMinutes}m timebox
              </Text>
            </Stack>
            <SessionControls s={s} perms={perms} busy={busy} transition={transition} onFinish={() => setFinishOpen(true)} onFinding={() => openFinding()} onReview={setReviewMode} />
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label="More session actions">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconEdit size={14} />} disabled={!perms.canOperate || !!s.archivedAt} onClick={() => setDetailsOpen(true)}>
                  Edit session details
                </Menu.Item>
                <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => download(p(pid, `/sessions/${s.id}/report`), `${s.key}.md`).catch((e) => toastError(e))}>
                  Download report (Markdown)
                </Menu.Item>
                <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => download(p(pid, `/sessions/${s.id}/report?format=json`), `${s.key}.json`).catch((e) => toastError(e))}>
                  Download report (JSON)
                </Menu.Item>
                <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => window.print()}>
                  Print
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconLink size={14} />}
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    toastOk('Link copied — share it with project members');
                  }}
                >
                  Copy share link
                </Menu.Item>
                {can('TESTER') && (
                  <Menu.Item
                    leftSection={<IconCopy size={14} />}
                    onClick={async () => {
                      try {
                        const r = await api.post(p(pid, `/sessions/${s.id}/duplicate`));
                        toastOk(`Created ${r.session.key}`);
                        navigate(`/projects/${pid}/sessions/${r.session.id}`);
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    Duplicate as new draft
                  </Menu.Item>
                )}
                <Menu.Item leftSection={<IconKeyboard size={14} />} onClick={() => setHelpOpen(true)}>
                  Keyboard shortcuts
                </Menu.Item>
                {(can('LEAD') || s.tester?.id === user?.id) && can('TESTER') && (
                  <>
                    <Menu.Divider />
                    {s.archivedAt ? (
                      <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => transition('unarchive')}>
                        Unarchive
                      </Menu.Item>
                    ) : (
                      <Menu.Item leftSection={<IconArchive size={14} />} disabled={running} onClick={() => transition('archive')}>
                        Archive
                      </Menu.Item>
                    )}
                  </>
                )}
                {perms.canManage && ['COMPLETED', 'APPROVED', 'ABANDONED', 'IN_REVIEW'].includes(s.status) && !s.archivedAt && (
                  <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => transition('reopen')}>
                    Reopen session
                  </Menu.Item>
                )}
                {perms.canOperate && ['DRAFT', 'IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'].includes(s.status) && !s.archivedAt && (
                  <Menu.Item
                    color="red"
                    leftSection={<IconBan size={14} />}
                    onClick={() =>
                      modals.openConfirmModal({
                        title: 'Abandon session?',
                        children: <Text size="sm">Abandoned sessions keep their notes and findings but count as started-not-completed in reports. A lead can reopen it later.</Text>,
                        labels: { confirm: 'Abandon', cancel: 'Keep exploring' },
                        confirmProps: { color: 'red' },
                        onConfirm: () => transition('abandon', { comment: 'Abandoned by tester' }),
                      })
                    }
                  >
                    Abandon session
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </Paper>

      {s.reviewComment && ['CHANGES_REQUESTED', 'APPROVED'].includes(s.status) && (
        <Alert mb="md" color={s.status === 'APPROVED' ? 'green' : 'orange'} title={s.status === 'APPROVED' ? `Approved by ${s.reviewer?.name ?? 'reviewer'}` : `Changes requested by ${s.reviewer?.name ?? 'reviewer'}`} icon={<IconMessage size={18} />}>
          <Text size="sm" className="ex-prewrap">
            {s.reviewComment}
          </Text>
        </Alert>
      )}
      {s.status === 'DRAFT' && perms.canOperate && (
        <Alert mb="md" color="explorix" icon={<IconPlayerPlay size={18} />} title="Ready to explore">
          Review the mission on the right, then press <b>Start</b> (or <Kbd size="xs">P</Kbd>) to begin the timer. Notes can be prepared before starting.
        </Alert>
      )}
      {readOnlyReason && (
        <Alert mb="md" color="gray" title="Read-only">
          {readOnlyReason}
        </Alert>
      )}
      {recovered && (
        <Alert
          mb="md"
          color="yellow"
          title="Unsaved notes recovered from this browser"
          withCloseButton
          onClose={() => {
            localStorage.removeItem(draftKey(s.id));
            setRecovered(null);
          }}
        >
          <Text size="sm" mb="xs">
            We found notes from {fromNow(new Date(recovered.savedAt))} that didn't reach the server
            {recovered.baseVersion !== s.version ? ' — and the server copy has changed since then' : ''}.
          </Text>
          <Group gap="xs">
            <Button
              size="xs"
              onClick={() => {
                replaceNotes(recovered.notes);
                dirtyRef.current = true;
                // Recovered drafts are based on an older version; overwrite deliberately after the user chose to restore.
                save(true);
                setRecovered(null);
              }}
            >
              Restore my unsaved notes
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                localStorage.removeItem(draftKey(s.id));
                setRecovered(null);
              }}
            >
              Discard
            </Button>
          </Group>
        </Alert>
      )}

      <Grid gap="md">
        {/* ---------------- Left: notes + log ---------------- */}
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="md">
            <Paper withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Group gap={6}>
                  <IconNote size={18} />
                  <Title order={5}>Session notes</Title>
                </Group>
                <SaveIndicator state={saveState} savedAt={savedAt} onRetry={() => save()} />
              </Group>
              <RichText
                value={notes}
                onChange={onNotesChange}
                editable={perms.canEdit}
                resetKey={resetKey}
                onEditor={onEditor}
                minHeight={260}
                ariaLabel="Session notes"
                placeholder="Write what you're trying, what you observe, questions and ideas. Saved automatically."
              />
            </Paper>

            <Paper withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Group gap={6}>
                  <IconFlag size={18} />
                  <Title order={5}>Activity log</Title>
                </Group>
                <Text size="xs" c="dimmed">
                  Timestamps are session time (paused time excluded)
                </Text>
              </Group>
              {perms.canEdit && <QuickLog inputRef={logInputRef} sessionId={s.id} onLogged={refetch} onAsFinding={(title) => openFinding({ title })} />}
              <Timeline entries={s.logEntries} canEdit={perms.canEdit} sessionId={s.id} currentUserId={user?.id} onChange={refetch} />
            </Paper>
          </Stack>
        </Grid.Col>

        {/* ---------------- Right: mission + findings + evidence ---------------- */}
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Paper withBorder p={0}>
            <Tabs defaultValue="mission" keepMounted={false}>
              <Tabs.List grow>
                <Tabs.Tab value="mission" leftSection={<IconTarget size={14} />}>
                  Mission
                </Tabs.Tab>
                <Tabs.Tab value="findings" leftSection={<IconBulb size={14} />}>
                  Findings ({s.findings.length})
                </Tabs.Tab>
                <Tabs.Tab value="evidence" leftSection={<IconPaperclip size={14} />}>
                  Evidence ({s.attachments.length})
                </Tabs.Tab>
                <Tabs.Tab value="details" leftSection={<IconFileDescription size={14} />}>
                  Details
                </Tabs.Tab>
              </Tabs.List>
              <ScrollArea.Autosize mah="calc(100vh - 260px)" type="auto">
                <Box p="md">
                  <Tabs.Panel value="mission">
                    <MissionPanel s={s} exploredIdeas={exploredIdeas} canLog={perms.canEdit} onLogIdea={async (idea) => {
                      try {
                        await api.post(p(pid, `/sessions/${s.id}/log`), { content: `${TEST_IDEA_PREFIX}${idea}` });
                        refetch();
                      } catch (e) {
                        toastError(e);
                      }
                    }} />
                  </Tabs.Panel>
                  <Tabs.Panel value="findings">
                    <FindingsPanel s={s} canCapture={perms.canEdit} onCapture={() => openFinding()} />
                  </Tabs.Panel>
                  <Tabs.Panel value="evidence">
                    <Text size="xs" c="dimmed" mb="sm">
                      Drop files here or paste a screenshot anywhere on this page (Ctrl+V). Images, video, PDF, logs, HAR and JSON up to 15 MB.
                    </Text>
                    <Attachments targetType="session" targetId={s.id} items={s.attachments} canUpload={perms.canEdit} onChange={refetch} />
                  </Tabs.Panel>
                  <Tabs.Panel value="details">
                    <DetailsPanel s={s} onEdit={perms.canOperate && !s.archivedAt ? () => setDetailsOpen(true) : undefined} />
                    <Divider my="md" />
                    <RelatedSessions s={s} canEdit={can('TESTER') && perms.canOperate} onChange={refetch} />
                  </Tabs.Panel>
                </Box>
              </ScrollArea.Autosize>
            </Tabs>
          </Paper>
        </Grid.Col>
      </Grid>

      {(s.summary || ['COMPLETED', 'IN_REVIEW', 'APPROVED', 'ABANDONED'].includes(s.status)) && (
        <Paper withBorder p="md" mt="md">
          <Title order={5} mb="sm">
            Session summary (debrief)
          </Title>
          <RichView html={s.summary} empty="No summary was written." />
          {s.setupPercent != null && (
            <Group gap="lg" mt="sm">
              <Text size="sm">
                Setup <b>{s.setupPercent}%</b>
              </Text>
              <Text size="sm">
                Testing <b>{s.testPercent}%</b>
              </Text>
              <Text size="sm">
                Bug investigation <b>{s.bugPercent}%</b>
              </Text>
              {s.charterVsOpportunity != null && (
                <Text size="sm">
                  On-charter <b>{s.charterVsOpportunity}%</b> / opportunity <b>{100 - s.charterVsOpportunity}%</b>
                </Text>
              )}
            </Group>
          )}
        </Paper>
      )}

      <Paper withBorder p="md" mt="md" className="ex-no-print">
        <Title order={5} mb="sm">
          Discussion
        </Title>
        <Comments targetType="session" targetId={s.id} />
      </Paper>

      {/* ---------------- Modals ---------------- */}
      <FindingFormModal
        opened={findingOpen}
        onClose={() => setFindingOpen(false)}
        sessionId={s.id}
        defaults={findingDefaults}
        onSaved={(f) => {
          toastOk(`${f.key} captured at ${clock(elapsed)}`);
          refetch();
          refresh();
        }}
      />
      <FinishModal
        opened={finishOpen}
        onClose={() => setFinishOpen(false)}
        s={s}
        aiEnabled={!!ai.data?.enabled}
        requireReview={project.settings.requireReview}
        onFinish={async (body) => {
          const ok = await transition('finish', body);
          if (ok) {
            setFinishOpen(false);
            toastOk(project.settings.requireReview ? 'Session finished and sent for review' : 'Session completed');
          }
        }}
        busy={busy === 'finish'}
      />
      <DetailsModal opened={detailsOpen} onClose={() => setDetailsOpen(false)} s={s} canManage={perms.canManage} onSaved={refetch} />
      <ReviewModal
        mode={reviewMode}
        onClose={() => setReviewMode(null)}
        busy={!!busy}
        onSubmit={async (comment) => {
          if (reviewMode && (await transition(reviewMode, { comment: comment || undefined }))) setReviewMode(null);
        }}
      />
      <ConflictModal
        conflict={conflict}
        mine={notes}
        onKeepMine={() => {
          if (!conflict) return;
          versionRef.current = conflict.version;
          setConflict(null);
          dirtyRef.current = true;
          save(true);
        }}
        onUseServer={() => {
          if (!conflict) return;
          versionRef.current = conflict.version;
          replaceNotes(conflict.notes);
          dirtyRef.current = false;
          localStorage.removeItem(draftKey(s.id));
          setConflict(null);
          setSaveState('saved');
        }}
      />
      <Modal opened={helpOpen} onClose={() => setHelpOpen(false)} title="Workbench keyboard shortcuts">
        <Table>
          <Table.Tbody>
            {[
              ['F', 'Capture a finding'],
              ['Ctrl/⌘ + Shift + F', 'Capture a finding (works while typing)'],
              ['N', 'Focus session notes'],
              ['L', 'Focus the quick log'],
              ['P', 'Start / pause / resume the timer'],
              ['Enter (in quick log)', 'Add a timestamped log entry'],
              ['Ctrl/⌘ + V', 'Paste a screenshot as evidence'],
              ['Alt + key (in finding form)', 'Pick a classification'],
              ['Ctrl/⌘ + Enter (in forms)', 'Save'],
              ['?', 'Show this help'],
            ].map(([k, d]) => (
              <Table.Tr key={k}>
                <Table.Td>
                  <Kbd>{k}</Kbd>
                </Table.Td>
                <Table.Td>{d}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Modal>
    </Box>
  );
}

// ============================================================================

function SessionControls({
  s,
  perms,
  busy,
  transition,
  onFinish,
  onFinding,
  onReview,
}: {
  s: any;
  perms: any;
  busy: string | null;
  transition: (a: string, b?: object) => Promise<boolean>;
  onFinish: () => void;
  onFinding: () => void;
  onReview: (m: 'approve' | 'request-changes') => void;
}) {
  if (s.archivedAt) return null;
  const st = s.status;
  return (
    <Group gap="xs" wrap="nowrap">
      {perms.canEdit && ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED', 'DRAFT'].includes(st) && (
        <Tooltip label="Capture finding (F)">
          <Button variant="light" color="orange" leftSection={<IconBulb size={16} />} onClick={onFinding}>
            Finding
          </Button>
        </Tooltip>
      )}
      {perms.canOperate && st === 'DRAFT' && (
        <Button leftSection={<IconPlayerPlay size={16} />} loading={busy === 'start'} onClick={() => transition('start')}>
          Start
        </Button>
      )}
      {perms.canOperate && st === 'IN_PROGRESS' && (
        <Button variant="default" leftSection={<IconPlayerPause size={16} />} loading={busy === 'pause'} onClick={() => transition('pause')}>
          Pause
        </Button>
      )}
      {perms.canOperate && (st === 'PAUSED' || st === 'CHANGES_REQUESTED') && (
        <Button leftSection={<IconPlayerPlay size={16} />} loading={busy === 'resume'} onClick={() => transition('resume')}>
          Resume
        </Button>
      )}
      {perms.canOperate && ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'].includes(st) && (
        <Button color="dark" variant="filled" leftSection={<IconPlayerStop size={16} />} onClick={onFinish}>
          Finish
        </Button>
      )}
      {perms.canOperate && st === 'COMPLETED' && (
        <Button variant="light" leftSection={<IconSend size={16} />} loading={busy === 'submit-review'} onClick={() => transition('submit-review')}>
          Submit for review
        </Button>
      )}
      {perms.canReview && st === 'IN_REVIEW' && (
        <>
          <Button color="green" leftSection={<IconCircleCheck size={16} />} onClick={() => onReview('approve')}>
            Approve
          </Button>
          <Button color="orange" variant="light" leftSection={<IconArrowBackUp size={16} />} onClick={() => onReview('request-changes')}>
            Request changes
          </Button>
        </>
      )}
    </Group>
  );
}

function SaveIndicator({ state, savedAt, onRetry }: { state: SaveState; savedAt: string | null; onRetry: () => void }) {
  if (state === 'saving' || state === 'dirty')
    return (
      <Group gap={4}>
        <IconCloudUpload size={14} />
        <Text size="xs" c="dimmed">
          {state === 'saving' ? 'Saving…' : 'Unsaved changes'}
        </Text>
      </Group>
    );
  if (state === 'error')
    return (
      <Group gap={4}>
        <Text size="xs" c="red">
          Offline — kept locally, retrying
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={onRetry}>
          Retry now
        </Button>
      </Group>
    );
  if (state === 'rejected')
    return (
      <Text size="xs" c="red">
        Not saved — kept in this browser only
      </Text>
    );
  if (state === 'conflict')
    return (
      <Text size="xs" c="orange">
        Edit conflict — choose a version
      </Text>
    );
  return (
    <Group gap={4}>
      <IconCloudCheck size={14} color="var(--mantine-color-green-6)" />
      <Text size="xs" c="dimmed">
        {savedAt ? `Saved ${fromNow(savedAt)}` : 'All changes saved'}
      </Text>
    </Group>
  );
}

function QuickLog({ inputRef, sessionId, onLogged, onAsFinding }: { inputRef: React.RefObject<HTMLInputElement | null>; sessionId: string; onLogged: () => void; onAsFinding: (title: string) => void }) {
  const { pid } = useProject();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await api.post(p(pid, `/sessions/${sessionId}/log`), { content });
      setText('');
      onLogged();
    } catch (e) {
      toastError(e, 'Could not add log entry');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group gap="xs" mb="md" wrap="nowrap">
      <TextInput
        ref={inputRef}
        style={{ flex: 1 }}
        placeholder="Quick observation… press Enter to log it with a timestamp (L)"
        aria-label="Quick log entry"
        value={text}
        maxLength={5000}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
      <Button variant="default" onClick={submit} loading={busy} disabled={!text.trim()}>
        Log
      </Button>
      <Tooltip label="Turn this text into a finding">
        <ActionIcon
          variant="light"
          color="orange"
          size="lg"
          aria-label="Log as finding"
          disabled={!text.trim()}
          onClick={() => {
            onAsFinding(text.trim());
            setText('');
          }}
        >
          <IconBulb size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function Timeline({ entries, canEdit, sessionId, currentUserId, onChange }: { entries: any[]; canEdit: boolean; sessionId: string; currentUserId?: string; onChange: () => void }) {
  const { pid } = useProject();
  const [filter, setFilter] = useState<string[]>([]);
  const shown = (filter.length ? entries.filter((e) => filter.includes(e.type)) : entries).slice().reverse();
  const remove = async (entryId: string) => {
    try {
      await api.del(p(pid, `/sessions/${sessionId}/log/${entryId}`));
      onChange();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <Chip.Group multiple value={filter} onChange={setFilter}>
        <Group gap={6} mb="sm">
          {['NOTE', 'FINDING', 'ATTACHMENT', 'STATUS_CHANGE'].map((t) => (
            <Chip key={t} value={t} size="xs" variant="outline">
              {LOG_META[t].label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {shown.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nothing logged yet. Starting the timer, notes, findings and evidence all appear here in order.
        </Text>
      ) : (
        <Stack gap={0} aria-label="Session activity log">
          {shown.map((e) => {
            const meta = LOG_META[e.type] ?? LOG_META.SYSTEM;
            return (
              <Group key={e.id} gap="sm" wrap="nowrap" align="flex-start" py={6} style={{ borderBottom: '1px solid var(--ex-border)' }}>
                <Tooltip label={fmtDateTime(e.createdAt)}>
                  <Text size="xs" className="ex-timer" c="dimmed" w={64} ta="right" pt={3}>
                    {clock(e.elapsedSeconds ?? 0)}
                  </Text>
                </Tooltip>
                <ThemeIcon size={22} radius="xl" variant="light" color={meta.color}>
                  <meta.icon size={13} />
                </ThemeIcon>
                <Box style={{ flex: 1, minWidth: 0 }}>
                  {e.type === 'FINDING' && e.finding ? (
                    <Group gap={6}>
                      <KeyLink to={`/projects/${pid}/findings/${e.finding.id}`} k={e.finding.key}>
                        {e.finding.title}
                      </KeyLink>
                      <ClassificationBadge c={e.finding.classification} size="xs" />
                      <SeverityBadge value={e.finding.severity} size="xs" />
                    </Group>
                  ) : e.type === 'ATTACHMENT' && e.attachment ? (
                    <Anchor href={contentUrl(pid, e.attachment.id)} target="_blank" rel="noopener" size="sm">
                      {e.content}
                    </Anchor>
                  ) : (
                    <Text size="sm" className="ex-prewrap" fw={e.type === 'STATUS_CHANGE' ? 600 : 400} c={e.type === 'STATUS_CHANGE' ? 'dimmed' : undefined}>
                      {e.content}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    {e.author?.name ?? 'System'} · {fmtDateTime(e.createdAt)}
                  </Text>
                </Box>
                {canEdit && e.type === 'NOTE' && e.author?.id === currentUserId && (
                  <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Delete log entry" onClick={() => remove(e.id)}>
                    <IconTrash size={13} />
                  </ActionIcon>
                )}
              </Group>
            );
          })}
        </Stack>
      )}
    </>
  );
}

function MissionPanel({ s, exploredIdeas, canLog, onLogIdea }: { s: any; exploredIdeas: Set<string>; canLog: boolean; onLogIdea: (idea: string) => void }) {
  const c = s.charter;
  return (
    <Stack gap="sm">
      <Paper p="sm" bg="var(--ex-subtle)" radius="md">
        <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={4}>
          Mission
        </Text>
        <Text fw={500} className="ex-prewrap">
          {c.mission}
        </Text>
      </Paper>
      <TextBlock label="Target" value={c.target} />
      <TextBlock label="Objectives" value={c.objectives && <span className="ex-prewrap">{c.objectives}</span>} />
      <SimpleGrid cols={2}>
        <TextBlock label="In scope" value={c.scope && <span className="ex-prewrap">{c.scope}</span>} />
        <TextBlock label="Out of scope" value={c.outOfScope && <span className="ex-prewrap">{c.outOfScope}</span>} />
      </SimpleGrid>
      <TextBlock label="Target risks" value={c.risks && <span className="ex-prewrap">{c.risks}</span>} />
      <TextBlock label="Learning goals" value={c.learningGoals && <span className="ex-prewrap">{c.learningGoals}</span>} />
      <TextBlock label="Assumptions & constraints" value={c.assumptions && <span className="ex-prewrap">{c.assumptions}</span>} />
      <TextBlock label="Prerequisites" value={c.prerequisites && <span className="ex-prewrap">{c.prerequisites}</span>} />
      <TextBlock label="Test data" value={c.testData && <span className="ex-prewrap">{c.testData}</span>} />
      {c.testIdeas?.length > 0 && (
        <div>
          <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={4}>
            Test ideas ({c.testIdeas.filter((i: string) => exploredIdeas.has(i)).length}/{c.testIdeas.length} explored)
          </Text>
          <Stack gap={4}>
            {c.testIdeas.map((idea: string) => {
              const done = exploredIdeas.has(idea);
              return (
                <Group key={idea} gap={6} wrap="nowrap" align="flex-start">
                  <ActionIcon
                    size="sm"
                    variant={done ? 'filled' : 'default'}
                    color="explorix"
                    disabled={!canLog || done}
                    aria-label={done ? `Explored: ${idea}` : `Mark explored: ${idea}`}
                    onClick={() => onLogIdea(idea)}
                  >
                    {done ? <IconCheck size={12} /> : null}
                  </ActionIcon>
                  <Text size="sm" td={done ? 'line-through' : undefined} c={done ? 'dimmed' : undefined}>
                    {idea}
                  </Text>
                </Group>
              );
            })}
          </Stack>
          {canLog && (
            <Text size="xs" c="dimmed" mt={4}>
              Marking an idea logs it to the timeline.
            </Text>
          )}
        </div>
      )}
      {c.heuristics?.length > 0 && (
        <div>
          <Text size="xs" tt="uppercase" fw={700} c="dimmed" mb={4}>
            Heuristics
          </Text>
          <Group gap={4}>
            {c.heuristics.map((h: string) => (
              <Badge key={h} variant="outline" size="sm">
                {h}
              </Badge>
            ))}
          </Group>
        </div>
      )}
      <TextBlock label="Exit criteria" value={c.exitCriteria && <span className="ex-prewrap">{c.exitCriteria}</span>} />
    </Stack>
  );
}

function FindingsPanel({ s, canCapture, onCapture }: { s: any; canCapture: boolean; onCapture: () => void }) {
  const { pid } = useProject();
  if (s.findings.length === 0)
    return (
      <EmptyState
        title="No findings yet"
        description="Capture observations, questions, risks and defects as you go. Observations stay separate from confirmed defects."
        action={
          canCapture && (
            <Button size="xs" leftSection={<IconBulb size={14} />} onClick={onCapture}>
              Capture finding (F)
            </Button>
          )
        }
      />
    );
  return (
    <Stack gap="xs">
      {canCapture && (
        <Button size="xs" variant="light" color="orange" leftSection={<IconBulb size={14} />} onClick={onCapture}>
          Capture finding (F)
        </Button>
      )}
      {s.findings.map((f: any) => (
        <Paper key={f.id} withBorder p="xs">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Box style={{ minWidth: 0 }}>
              <KeyLink to={`/projects/${pid}/findings/${f.id}`} k={f.key}>
                {f.title}
              </KeyLink>
              <Group gap={4} mt={4}>
                <ClassificationBadge c={f.classification} size="xs" />
                <SeverityBadge value={f.severity} size="xs" />
                <FindingStatusBadge value={f.status} size="xs" variant="outline" />
                {f.issue && (
                  <Badge size="xs" color="red" variant="outline" component={Link} to={`/projects/${pid}/issues/${f.issue.id}`} style={{ cursor: 'pointer' }}>
                    {f.issue.key}
                  </Badge>
                )}
              </Group>
            </Box>
            <Stack gap={0} align="flex-end">
              <Text size="xs" className="ex-timer" c="dimmed">
                @{clock(f.sessionElapsedSeconds ?? 0)}
              </Text>
              <Group gap={6}>
                {f._count?.attachments > 0 && (
                  <Group gap={2}>
                    <IconPaperclip size={12} />
                    <Text size="xs">{f._count.attachments}</Text>
                  </Group>
                )}
                {f._count?.comments > 0 && (
                  <Group gap={2}>
                    <IconMessage size={12} />
                    <Text size="xs">{f._count.comments}</Text>
                  </Group>
                )}
              </Group>
            </Stack>
          </Group>
          {f.actual && (
            <Text size="xs" c="dimmed" lineClamp={2} mt={4}>
              Actual: {f.actual}
            </Text>
          )}
        </Paper>
      ))}
    </Stack>
  );
}

function DetailsPanel({ s, onEdit }: { s: any; onEdit?: () => void }) {
  const est = s.timeboxMinutes * 60;
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>Environment & metadata</Text>
        {onEdit && (
          <Button size="compact-xs" variant="subtle" leftSection={<IconEdit size={12} />} onClick={onEdit}>
            Edit
          </Button>
        )}
      </Group>
      <SimpleGrid cols={2}>
        <TextBlock label="Environment" value={s.environment?.name} />
        <TextBlock label="Build / version" value={s.buildVersion} />
        <TextBlock label="Browser" value={s.browser} />
        <TextBlock label="OS" value={s.os} />
        <TextBlock label="Device" value={s.device} />
        <TextBlock label="Milestone" value={s.milestone?.name} />
        <TextBlock label="Started" value={s.startedAt && fmtDateTime(s.startedAt)} />
        <TextBlock label="Ended" value={s.endedAt && fmtDateTime(s.endedAt)} />
        <TextBlock label="Timebox (estimate)" value={duration(est)} />
        <TextBlock label="Tracked time (measured)" value={duration(s.liveElapsedSeconds)} />
        <TextBlock label="Created by" value={s.createdBy && <UserLabel user={s.createdBy} />} />
        <TextBlock label="Reviewer" value={s.reviewer && <UserLabel user={s.reviewer} />} />
      </SimpleGrid>
      {s.environment?.url && <TextBlock label="URL" value={<Anchor href={s.environment.url} target="_blank" rel="noopener noreferrer">{s.environment.url}</Anchor>} />}
      <TextBlock label="Environment notes" value={s.environmentNotes && <span className="ex-prewrap">{s.environmentNotes}</span>} />
      {s.tags?.length > 0 && (
        <Group gap={4}>
          {s.tags.map((t: string) => (
            <Badge key={t} variant="light" size="sm">
              {t}
            </Badge>
          ))}
        </Group>
      )}
      <CustomFieldsView entity="SESSION" value={s.customFields} />
    </Stack>
  );
}

function RelatedSessions({ s, canEdit, onChange }: { s: any; canEdit: boolean; onChange: () => void }) {
  const { pid } = useProject();
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: ['sessions', pid, 'related-search', search],
    queryFn: () => api.get(p(pid, '/sessions'), { view: 'all', q: search || undefined, pageSize: 20 }),
    enabled: canEdit,
  });
  const add = async (relatedId: string | null) => {
    if (!relatedId) return;
    try {
      await api.post(p(pid, `/sessions/${s.id}/relations`), { relatedId });
      setSearch('');
      onChange();
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (relatedId: string) => {
    try {
      await api.del(p(pid, `/sessions/${s.id}/relations/${relatedId}`));
      onChange();
    } catch (e) {
      toastError(e);
    }
  };
  const linked = new Set(s.related.map((r: any) => r.id));
  return (
    <Stack gap="xs">
      <Text fw={600}>Related sessions</Text>
      {s.related.length === 0 && (
        <Text size="sm" c="dimmed">
          None linked.
        </Text>
      )}
      {s.related.map((r: any) => (
        <Group key={r.id} justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <KeyLink to={`/projects/${pid}/sessions/${r.id}`} k={r.key}>
              {r.title}
            </KeyLink>
            <SessionStatusBadge value={r.status} size="xs" />
          </Group>
          {canEdit && (
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`Unlink ${r.key}`} onClick={() => remove(r.id)}>
              <IconX size={12} />
            </ActionIcon>
          )}
        </Group>
      ))}
      {canEdit && (
        <Select
          placeholder="Link a related session…"
          searchable
          searchValue={search}
          onSearchChange={setSearch}
          data={(found.data?.sessions ?? []).filter((x: any) => x.id !== s.id && !linked.has(x.id)).map((x: any) => ({ value: x.id, label: `${x.key} ${x.title}` }))}
          value={null}
          onChange={add}
          filter={({ options: o }) => o}
          nothingFoundMessage="No sessions"
        />
      )}
    </Stack>
  );
}

// ============================================================================

function FinishModal({
  opened,
  onClose,
  s,
  aiEnabled,
  requireReview,
  onFinish,
  busy,
}: {
  opened: boolean;
  onClose: () => void;
  s: any;
  aiEnabled: boolean;
  requireReview: boolean;
  onFinish: (body: object) => void;
  busy: boolean;
}) {
  const { pid } = useProject();
  const [summary, setSummary] = useState('');
  const [rk, setRk] = useState(0);
  const [split, setSplit] = useState<{ setup: number | ''; test: number | ''; bug: number | '' }>({ setup: '', test: '', bug: '' });
  const [onCharter, setOnCharter] = useState(80);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMeta, setAiMeta] = useState<any>(null);

  useEffect(() => {
    if (opened) {
      setSummary(s.summary ?? '');
      setRk((k) => k + 1);
      setSplit({ setup: s.setupPercent ?? '', test: s.testPercent ?? '', bug: s.bugPercent ?? '' });
      setOnCharter(s.charterVsOpportunity ?? 80);
      setAiMeta(null);
    }
  }, [opened, s.summary, s.setupPercent, s.testPercent, s.bugPercent, s.charterVsOpportunity]);

  const filled = [split.setup, split.test, split.bug].filter((x) => x !== '').length;
  const total = Number(split.setup || 0) + Number(split.test || 0) + Number(split.bug || 0);
  const splitError = filled > 0 && (filled < 3 || total !== 100) ? `Setup + testing + bug investigation must add up to 100% (now ${total}%)` : null;

  const draftWithAi = async () => {
    setAiBusy(true);
    try {
      const r = await api.post(p(pid, `/ai/sessions/${s.id}/summary`));
      const d = r.draft;
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const list = (title: string, items?: string[]) => (items?.length ? `<h3>${title}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
      const html = `<p>${esc(d.summary ?? '')}</p>${list('Key findings', d.keyFindings)}${list('Risks', d.risks)}${list('Follow-ups', d.followUps)}${d.coverageNotes ? `<h3>Coverage</h3><p>${esc(d.coverageNotes)}</p>` : ''}`;
      setSummary(html);
      setRk((k) => k + 1);
      setAiMeta(r.meta);
    } catch (e) {
      toastError(e, 'AI summary failed');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={<Text fw={700}>Finish {s.key} — debrief</Text>}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          The timer stops at finish. {requireReview ? 'This project requires review: the session goes to a lead for approval.' : 'The session will be marked completed.'} Your notes, log, and findings are kept as-is.
        </Text>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            Summary
          </Text>
          <Group gap="xs">
            <AiDraftBadge meta={aiMeta} />
            {aiEnabled && (
              <Button size="compact-sm" variant="light" color="grape" leftSection={<IconSparkles size={14} />} loading={aiBusy} onClick={draftWithAi}>
                Draft summary with AI
              </Button>
            )}
          </Group>
        </Group>
        <RichText value={summary} onChange={setSummary} resetKey={rk} minHeight={160} placeholder="What did you cover? What did you find? What's left and what are the risks?" ariaLabel="Session summary" />
        <Text size="sm" fw={500} mt="xs">
          Time breakdown (optional, session-based test management)
        </Text>
        <SimpleGrid cols={3}>
          <NumberInput label="Setup %" min={0} max={100} value={split.setup} onChange={(v) => setSplit((x) => ({ ...x, setup: v === '' ? '' : Number(v) }))} />
          <NumberInput label="Testing %" min={0} max={100} value={split.test} onChange={(v) => setSplit((x) => ({ ...x, test: v === '' ? '' : Number(v) }))} />
          <NumberInput label="Bug investigation %" min={0} max={100} value={split.bug} onChange={(v) => setSplit((x) => ({ ...x, bug: v === '' ? '' : Number(v) }))} />
        </SimpleGrid>
        {splitError && (
          <Text size="xs" c="red">
            {splitError}
          </Text>
        )}
        <div>
          <Text size="sm" fw={500}>
            On-charter vs. opportunity: {onCharter}% / {100 - onCharter}%
          </Text>
          <Slider value={onCharter} onChange={setOnCharter} step={5} min={0} max={100} label={(v) => `${v}% on charter`} mt={4} />
        </div>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Keep exploring
          </Button>
          <Button
            color="dark"
            loading={busy}
            disabled={!!splitError}
            leftSection={<IconPlayerStop size={16} />}
            onClick={() =>
              onFinish({
                summary,
                charterVsOpportunity: onCharter,
                ...(filled === 3 ? { setupPercent: Number(split.setup), testPercent: Number(split.test), bugPercent: Number(split.bug) } : {}),
              })
            }
          >
            {requireReview ? 'Finish & send for review' : 'Finish session'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ReviewModal({ mode, onClose, onSubmit, busy }: { mode: null | 'approve' | 'request-changes'; onClose: () => void; onSubmit: (comment: string) => void; busy: boolean }) {
  const [comment, setComment] = useState('');
  useEffect(() => setComment(''), [mode]);
  return (
    <Modal opened={!!mode} onClose={onClose} title={<Text fw={700}>{mode === 'approve' ? 'Approve session' : 'Request changes'}</Text>}>
      <Stack>
        <Textarea
          label={mode === 'approve' ? 'Comment (optional)' : 'What should the tester change or explore further?'}
          autosize
          minRows={3}
          value={comment}
          onChange={(e) => setComment(e.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color={mode === 'approve' ? 'green' : 'orange'} loading={busy} disabled={mode === 'request-changes' && !comment.trim()} onClick={() => onSubmit(comment.trim())}>
            {mode === 'approve' ? 'Approve' : 'Request changes'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ConflictModal({ conflict, mine, onKeepMine, onUseServer }: { conflict: { notes: string; version: number } | null; mine: string; onKeepMine: () => void; onUseServer: () => void }) {
  return (
    <Modal opened={!!conflict} onClose={() => undefined} withCloseButton={false} size="xl" title={<Text fw={700}>Notes were changed elsewhere</Text>}>
      <Text size="sm" mb="sm">
        Someone (or another tab) saved these notes after you started editing. Choose which version to keep. Your version is also kept in this browser until you decide.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="sm">
          <Text fw={600} size="sm" mb="xs">
            Your version
          </Text>
          <ScrollArea.Autosize mah={300}>
            <RichView html={mine} empty="(empty)" />
          </ScrollArea.Autosize>
        </Paper>
        <Paper withBorder p="sm">
          <Text fw={600} size="sm" mb="xs">
            Server version
          </Text>
          <ScrollArea.Autosize mah={300}>
            <RichView html={conflict?.notes} empty="(empty)" />
          </ScrollArea.Autosize>
        </Paper>
      </SimpleGrid>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onUseServer}>
          Use server version
        </Button>
        <Button onClick={onKeepMine}>Keep mine (overwrite)</Button>
      </Group>
    </Modal>
  );
}

function DetailsModal({ opened, onClose, s, canManage, onSaved }: { opened: boolean; onClose: () => void; s: any; canManage: boolean; onSaved: () => void }) {
  const { pid, memberOptions, milestoneOptions, environmentOptions, tagNames } = useProject();
  const init = () => ({
    title: s.title,
    testerId: s.testerId ?? s.tester?.id ?? null,
    environmentId: s.environmentId ?? null,
    browser: s.browser ?? '',
    os: s.os ?? '',
    device: s.device ?? '',
    buildVersion: s.buildVersion ?? '',
    environmentNotes: s.environmentNotes ?? '',
    timeboxMinutes: s.timeboxMinutes,
    priority: s.priority,
    dueDate: s.dueDate ? String(s.dueDate).slice(0, 10) : null,
    milestoneId: s.milestoneId ?? null,
    tags: s.tags ?? [],
    customFields: s.customFields ?? {},
  });
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (opened) {
      setV(init());
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const set = (k: string, val: unknown) => setV((x: any) => ({ ...x, [k]: val }));
  const submit = async () => {
    setBusy(true);
    try {
      await api.patch(p(pid, `/sessions/${s.id}`), {
        ...v,
        browser: v.browser || null,
        os: v.os || null,
        device: v.device || null,
        buildVersion: v.buildVersion || null,
        environmentNotes: v.environmentNotes || null,
      });
      onSaved();
      onClose();
      toastOk('Session updated');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} size="lg" title={<Text fw={700}>Session details</Text>}>
      <Stack gap="sm">
        <TextInput label="Title" value={v.title} onChange={(e) => set('title', e.currentTarget.value)} error={errors.title} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Tester" data={memberOptions} value={v.testerId} onChange={(x) => set('testerId', x)} disabled={!canManage} searchable clearable />
          <NumberInput label="Timebox (minutes)" min={5} max={480} value={v.timeboxMinutes} onChange={(x) => set('timeboxMinutes', Number(x) || 60)} error={errors.timeboxMinutes} />
          <Select label="Environment" data={environmentOptions} value={v.environmentId} onChange={(x) => set('environmentId', x)} clearable />
          <TextInput label="Build / version" value={v.buildVersion} onChange={(e) => set('buildVersion', e.currentTarget.value)} />
          <TextInput label="Browser" value={v.browser} onChange={(e) => set('browser', e.currentTarget.value)} />
          <TextInput label="OS" value={v.os} onChange={(e) => set('os', e.currentTarget.value)} />
          <TextInput label="Device" value={v.device} onChange={(e) => set('device', e.currentTarget.value)} />
          <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
          <Select label="Milestone" data={milestoneOptions} value={v.milestoneId} onChange={(x) => set('milestoneId', x)} clearable />
          <DateInput label="Due date" value={v.dueDate} onChange={(x) => set('dueDate', x)} clearable valueFormat="MMM D, YYYY" />
        </SimpleGrid>
        <Textarea label="Environment notes" autosize minRows={2} value={v.environmentNotes} onChange={(e) => set('environmentNotes', e.currentTarget.value)} />
        <TagsInput label="Tags" data={tagNames} value={v.tags} onChange={(x) => set('tags', x)} clearable />
        <CustomFieldsInput entity="SESSION" value={v.customFields} onChange={(x) => set('customFields', x)} />
        <List size="xs" c="dimmed">
          <List.Item>Only leads can reassign a session to another tester.</List.Item>
        </List>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
