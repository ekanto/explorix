import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  FileInput,
  Group,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCheck, IconCircleCheck, IconCircleDashed, IconFileUpload, IconSearch } from '@tabler/icons-react';
import { api, ApiError, p } from '../lib/api';
import { options, PRIORITY, RESULT_CATEGORY } from '../lib/constants';
import { useProject } from '../lib/project';
import { toastError, toastOk } from './ui';

// ---------------------------------------------------------------------------
// Enum metadata for the test management module
// ---------------------------------------------------------------------------

export const TEST_CASE_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  ACTIVE: { label: 'Active', color: 'teal' },
  DEPRECATED: { label: 'Deprecated', color: 'dark' },
};
export const CASE_FORMAT: Record<string, { label: string; color: string }> = {
  STEPS: { label: 'Steps', color: 'blue' },
  GHERKIN: { label: 'Gherkin', color: 'grape' },
  TEXT: { label: 'Free text', color: 'gray' },
};
export const REQUIREMENT_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'gray' },
  APPROVED: { label: 'Approved', color: 'blue' },
  IMPLEMENTED: { label: 'Implemented', color: 'teal' },
  DEPRECATED: { label: 'Deprecated', color: 'dark' },
};
export const COVERAGE_STATUS: Record<string, { label: string; color: string; hint: string }> = {
  passing: { label: 'Passing', color: 'green', hint: 'Every executed linked test case passed and there are no open defects' },
  failing: { label: 'Failing', color: 'red', hint: 'A linked test case failed/blocked or an open defect finding exists' },
  partial: { label: 'Partial', color: 'yellow', hint: 'Covered, but results are mixed (e.g. retest or skipped)' },
  untested: { label: 'Not covered', color: 'gray', hint: 'No explored charter and no executed test case yet' },
};
export const RUN_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Open', color: 'teal' },
  CLOSED: { label: 'Closed', color: 'gray' },
};
export const PLAN_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: 'teal' },
  COMPLETED: { label: 'Completed', color: 'blue' },
  ARCHIVED: { label: 'Archived', color: 'dark' },
};
export const CASE_TYPES = ['Functional', 'Regression', 'Smoke', 'Acceptance', 'Integration', 'Security', 'Performance', 'Usability', 'Accessibility'];

// ---------------------------------------------------------------------------
// URL-synced filter state
// ---------------------------------------------------------------------------

/** Read/write list filters in the query string (refresh- and link-safe). Changing a filter resets `page`. */
export function useUrlState() {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const set = (patch: Record<string, string | null | undefined>) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        if (!('page' in patch)) n.delete('page');
        return n;
      },
      { replace: true },
    );
  return { sp, get, set };
}

/** Search box that debounces before reporting changes; stays in sync with external resets. */
export function SearchInput({ value, onChange, placeholder = 'Search…', w = 240, label = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string; w?: number | string; label?: string }) {
  const [text, setText] = useState(value);
  const [debounced] = useDebouncedValue(text, 300);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
  }, [debounced]);
  return <TextInput leftSection={<IconSearch size={16} />} placeholder={placeholder} value={text} onChange={(e) => setText(e.currentTarget.value)} w={w} aria-label={label} />;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export type Folder = { id: string; name: string; parentId: string | null; position: number; caseCount: number };

export function useFolders() {
  const { pid } = useProject();
  const q = useQuery({ queryKey: ['test-folders', pid], queryFn: () => api.get<{ folders: Folder[]; unfiledCount: number }>(p(pid, '/test-folders')) });
  const folderOptions = useMemo(() => flattenFolders(q.data?.folders ?? []).map(({ folder, path }) => ({ value: folder.id, label: path })), [q.data]);
  return { query: q, folders: q.data?.folders ?? [], unfiledCount: q.data?.unfiledCount ?? 0, folderOptions };
}

/** Depth-first ordering with a full path label ("Checkout / Payments"). */
export function flattenFolders(folders: Folder[]) {
  const out: { folder: Folder; depth: number; path: string }[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .forEach((f) => {
        const path = prefix ? `${prefix} / ${f.name}` : f.name;
        out.push({ folder: f, depth, path });
        walk(f.id, depth + 1, path);
      });
  };
  walk(null, 0, '');
  return out;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type RunProgress = { total: number; done: number; passed: number; failed: number; blocked?: number; skipped?: number; retest?: number; untested?: number };

const SEGMENTS = [
  ['passed', 'PASSED'],
  ['failed', 'FAILED'],
  ['blocked', 'BLOCKED'],
  ['retest', 'RETEST'],
  ['skipped', 'SKIPPED'],
] as const;

const segColor = (cat: string) => (cat === 'SKIPPED' ? 'gray.5' : `${RESULT_CATEGORY[cat]?.color ?? 'gray'}.6`);

/** Stacked progress bar by result category; the unfilled remainder is untested. */
export function RunProgressBar({ progress, size = 'md', otherDone }: { progress: RunProgress | null | undefined; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; otherDone?: boolean }) {
  const total = progress?.total ?? 0;
  if (!progress || !total) return <Progress value={0} size={size} aria-label="No tests" />;
  const known = SEGMENTS.reduce((a, [k]) => a + (progress[k] ?? 0), 0);
  // Plans only report passed/failed; show the rest of "done" as a neutral segment.
  const rest = otherDone ? Math.max(0, progress.done - known) : 0;
  return (
    <Progress.Root size={size} aria-label={`${progress.done} of ${total} tests executed`}>
      {SEGMENTS.map(([k, cat]) => {
        const n = progress[k] ?? 0;
        if (!n) return null;
        return (
          <Tooltip key={k} label={`${RESULT_CATEGORY[cat].label}: ${n} (${Math.round((n / total) * 100)}%)`}>
            <Progress.Section value={(n / total) * 100} color={segColor(cat)} />
          </Tooltip>
        );
      })}
      {rest > 0 && (
        <Tooltip label={`Other results: ${rest}`}>
          <Progress.Section value={(rest / total) * 100} color="gray.5" />
        </Tooltip>
      )}
    </Progress.Root>
  );
}

export const passRate = (pr: RunProgress | null | undefined) => (pr && pr.done ? Math.round((pr.passed / pr.done) * 100) : null);

// ---------------------------------------------------------------------------
// Gherkin
// ---------------------------------------------------------------------------

/** Mirrors the server's light validation so authors get feedback before saving. */
export function validateGherkin(src: string) {
  const lines = src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const errors: string[] = [];
  if (!lines.some((l) => /^(Scenario|Scenario Outline|Example):/i.test(l))) errors.push('Add a "Scenario:" line');
  if (!lines.some((l) => /^(Given|When|Then|And|But|\*)\s/i.test(l))) errors.push('Add at least one Given/When/Then step');
  return errors;
}

const BLOCK_KW = /^(\s*)(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios):(.*)$/i;
const STEP_KW = /^(\s*)(Given|When|Then|And|But|\*)(\s.*)?$/i;

/** Read-only Gherkin with keyword highlighting. */
export function GherkinView({ source }: { source: string | null | undefined }) {
  if (!source?.trim())
    return (
      <Text size="sm" c="dimmed" fs="italic">
        No scenario written yet.
      </Text>
    );
  return (
    <Box
      component="pre"
      ff="monospace"
      fz="sm"
      p="sm"
      m={0}
      style={{ background: 'var(--ex-subtle)', border: '1px solid var(--ex-border)', borderRadius: 'var(--mantine-radius-md)', overflowX: 'auto', lineHeight: 1.6 }}
      aria-label="Gherkin scenario"
    >
      {source.split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        let node: ReactNode = line || ' ';
        if (t.startsWith('#')) node = <span style={{ color: 'var(--ex-muted)', fontStyle: 'italic' }}>{line}</span>;
        else if (t.startsWith('@')) node = <span style={{ color: 'var(--mantine-color-teal-7)' }}>{line}</span>;
        else if (t.startsWith('|')) node = <span style={{ color: 'var(--mantine-color-orange-8)' }}>{line}</span>;
        else if (t.startsWith('"""') || t.startsWith('```')) node = <span style={{ color: 'var(--ex-muted)' }}>{line}</span>;
        else {
          const b = BLOCK_KW.exec(line);
          const s = !b && STEP_KW.exec(line);
          if (b)
            node = (
              <>
                {b[1]}
                <span style={{ color: 'var(--mantine-color-violet-7)', fontWeight: 700 }}>{b[2]}:</span>
                <span style={{ fontWeight: 600 }}>{b[3]}</span>
              </>
            );
          else if (s)
            node = (
              <>
                {s[1]}
                <span style={{ color: 'var(--mantine-color-blue-7)', fontWeight: 700 }}>{s[2]}</span>
                {s[3]}
              </>
            );
        }
        return <div key={i}>{node}</div>;
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Steps (read-only)
// ---------------------------------------------------------------------------

export type Step = { id?: string; position?: number; action: string; expected: string | null; data: string | null };

export function StepsTable({ steps }: { steps: Step[] }) {
  if (!steps.length)
    return (
      <Text size="sm" c="dimmed" fs="italic">
        No steps defined.
      </Text>
    );
  const hasData = steps.some((s) => s.data);
  return (
    <Table.ScrollContainer minWidth={520}>
      <Table verticalSpacing="sm" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}>#</Table.Th>
            <Table.Th>Action</Table.Th>
            {hasData && <Table.Th>Test data</Table.Th>}
            <Table.Th>Expected result</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {steps.map((s, i) => (
            <Table.Tr key={s.id ?? i}>
              <Table.Td>
                <Text size="sm" c="dimmed" fw={600}>
                  {i + 1}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" className="ex-prewrap">
                  {s.action}
                </Text>
              </Table.Td>
              {hasData && (
                <Table.Td>
                  <Text size="sm" ff="monospace" className="ex-prewrap">
                    {s.data}
                  </Text>
                </Table.Td>
              )}
              <Table.Td>
                <Text size="sm" className="ex-prewrap" c={s.expected ? undefined : 'dimmed'}>
                  {s.expected || '—'}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export function CsvImportModal({
  opened,
  onClose,
  title,
  url,
  help,
  options,
  onImported,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  url: string;
  help: ReactNode;
  /** Extra import settings shown above the file picker. */
  options?: ReactNode;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: { row: number; message: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setText('');
    setResult(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const csv = file ? await file.text() : text;
      const r = await api.postText<{ imported: number; errors: { row: number; message: string }[] }>(url, csv, 'text/csv');
      setResult(r);
      if (r.imported) {
        toastOk(`Imported ${r.imported} row(s)`);
        onImported();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title={title} size="lg">
      <Stack>
        <Text size="sm" c="dimmed" component="div">
          {help}
        </Text>
        {result ? (
          <>
            <Alert color={result.errors.length ? 'yellow' : 'teal'} icon={<IconCheck size={18} />} title={`Imported ${result.imported} row(s)`}>
              {result.errors.length ? `${result.errors.length} row(s) were skipped.` : 'No errors.'}
            </Alert>
            {result.errors.length > 0 && (
              <ScrollArea.Autosize mah={220}>
                <Table striped withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={80}>Row</Table.Th>
                      <Table.Th>Problem</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.errors.map((e, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>{e.row}</Table.Td>
                        <Table.Td>{e.message}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={reset}>
                Import another file
              </Button>
              <Button onClick={close}>Done</Button>
            </Group>
          </>
        ) : (
          <>
            {options}
            <FileInput label="CSV file" placeholder="Choose a .csv file" accept=".csv,text/csv" value={file} onChange={setFile} clearable leftSection={<IconFileUpload size={16} />} />
            <Textarea
              label="…or paste CSV"
              placeholder={'Title,Priority\nLogin works with SSO,HIGH'}
              autosize
              minRows={4}
              maxRows={10}
              ff="monospace"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              disabled={!!file}
            />
            {error && <Alert color="red">{error}</Alert>}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancel
              </Button>
              <Button onClick={submit} loading={busy} disabled={!file && !text.trim()}>
                Import
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Search pickers
// ---------------------------------------------------------------------------

export type PickItem = { id: string; key: string; title: string; hint?: ReactNode };

/** Searchable, checkable list. Selection persists across searches. */
export function SearchPickList({
  queryKey,
  fetchItems,
  value,
  onChange,
  exclude = [],
  filters,
  height = 300,
  placeholder = 'Search by key or title…',
}: {
  queryKey: unknown[];
  fetchItems: (q: string) => Promise<PickItem[]>;
  value: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  filters?: ReactNode;
  height?: number;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 250);
  const res = useQuery({ queryKey: [...queryKey, dq], queryFn: () => fetchItems(dq) });
  const items = (res.data ?? []).filter((i) => !exclude.includes(i.id));
  const allShown = items.length > 0 && items.every((i) => value.includes(i.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toggleAll = () => {
    const ids = items.map((i) => i.id);
    onChange(allShown ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])]);
  };
  return (
    <Stack gap="xs">
      <Group gap="xs" grow preventGrowOverflow={false}>
        <TextInput leftSection={<IconSearch size={16} />} placeholder={placeholder} value={q} onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search items" />
        {filters}
      </Group>
      <Box style={{ border: '1px solid var(--ex-border)', borderRadius: 'var(--mantine-radius-md)' }}>
        <Group justify="space-between" px="sm" py={6} style={{ borderBottom: '1px solid var(--ex-border)', background: 'var(--ex-subtle)' }}>
          <Checkbox size="xs" label={`Select all shown (${items.length})`} checked={allShown} indeterminate={!allShown && items.some((i) => value.includes(i.id))} onChange={toggleAll} disabled={!items.length} />
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              {value.length} selected
            </Text>
            {value.length > 0 && (
              <Button size="compact-xs" variant="subtle" onClick={() => onChange([])}>
                Clear
              </Button>
            )}
          </Group>
        </Group>
        <ScrollArea h={height}>
          {res.isLoading ? (
            <Text size="sm" c="dimmed" p="sm">
              Loading…
            </Text>
          ) : items.length === 0 ? (
            <Text size="sm" c="dimmed" p="sm">
              Nothing matches.
            </Text>
          ) : (
            <Stack gap={0}>
              {items.map((i) => (
                <Checkbox
                  key={i.id}
                  px="sm"
                  py={6}
                  checked={value.includes(i.id)}
                  onChange={() => toggle(i.id)}
                  label={
                    <Group gap={6} wrap="nowrap">
                      <span className="ex-key">{i.key}</span>
                      <Text size="sm" lineClamp={1}>
                        {i.title}
                      </Text>
                      {i.hint}
                    </Group>
                  }
                />
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Box>
    </Stack>
  );
}

/** Test case picker with a folder filter (non-archived cases only). */
export function TestCasePickList({ value, onChange, exclude, height }: { value: string[]; onChange: (ids: string[]) => void; exclude?: string[]; height?: number }) {
  const { pid } = useProject();
  const { folderOptions } = useFolders();
  const [folderId, setFolderId] = useState<string | null>(null);
  return (
    <SearchPickList
      queryKey={['pick-cases', pid, folderId]}
      fetchItems={async (q) => {
        const r = await api.get(p(pid, '/test-cases'), { q, folderId, pageSize: 200 });
        return r.testCases.map((c: any) => ({ id: c.id, key: c.key, title: c.title, hint: c.folder ? <Text size="xs" c="dimmed" truncate>· {c.folder.name}</Text> : undefined }));
      }}
      value={value}
      onChange={onChange}
      exclude={exclude}
      height={height}
      filters={<Select placeholder="All folders" data={[{ value: 'none', label: 'Unfiled' }, ...folderOptions]} value={folderId} onChange={setFolderId} clearable aria-label="Folder" maw={220} />}
    />
  );
}

export function CharterPickList({ value, onChange, exclude, height }: { value: string[]; onChange: (ids: string[]) => void; exclude?: string[]; height?: number }) {
  const { pid } = useProject();
  return (
    <SearchPickList
      queryKey={['pick-charters', pid]}
      fetchItems={async (q) => {
        const r = await api.get(p(pid, '/charters'), { q, pageSize: 100 });
        return r.charters.map((c: any) => ({ id: c.id, key: c.key, title: c.title }));
      }}
      value={value}
      onChange={onChange}
      exclude={exclude}
      height={height}
    />
  );
}

/** Modal wrapper around a picker; resolves with the chosen ids. */
export function LinkPickerModal({
  opened,
  onClose,
  title,
  kind,
  exclude,
  confirmLabel = 'Link selected',
  onConfirm,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  kind: 'testCase' | 'charter';
  exclude?: string[];
  confirmLabel?: string;
  onConfirm: (ids: string[]) => Promise<void>;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setIds([]);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(ids);
      close();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={close} title={title} size="lg">
      <Stack>
        {kind === 'testCase' ? <TestCasePickList value={ids} onChange={setIds} exclude={exclude} /> : <CharterPickList value={ids} onChange={setIds} exclude={exclude} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ids.length}>
            {confirmLabel} {ids.length ? `(${ids.length})` : ''}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add test cases to a run
// ---------------------------------------------------------------------------

export function AddToRunModal({ opened, onClose, caseIds, onDone }: { opened: boolean; onClose: () => void; caseIds: string[]; onDone?: () => void }) {
  const { pid, milestoneOptions, environmentOptions } = useProject();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [runId, setRunId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runs = useQuery({ queryKey: ['test-runs', pid, 'open-picker'], queryFn: () => api.get(p(pid, '/test-runs'), { status: 'ACTIVE', pageSize: 200 }), enabled: opened });
  const runOptions = (runs.data?.runs ?? []).map((r: any) => ({ value: r.id, label: `${r.key} · ${r.name}` }));

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'existing') {
        const r = await api.post(p(pid, `/test-runs/${runId}/items`), { testCaseIds: caseIds });
        const skipped = caseIds.length - r.added;
        toastOk(`Added ${r.added} test(s) to the run${skipped ? ` (${skipped} already included)` : ''}`);
        onDone?.();
        onClose();
        navigate(`/projects/${pid}/test-runs/${runId}`);
      } else {
        const r = await api.post(p(pid, '/test-runs'), { name, milestoneId, environmentId, testCaseIds: caseIds });
        toastOk(`Created run ${r.run.key}`);
        onDone?.();
        onClose();
        navigate(`/projects/${pid}/test-runs/${r.run.id}`);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Add ${caseIds.length} test case(s) to a run`}>
      <Stack>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'existing' | 'new')}
          data={[
            { value: 'existing', label: 'Existing open run' },
            { value: 'new', label: 'New run' },
          ]}
        />
        {mode === 'existing' ? (
          <Select
            label="Run"
            placeholder={runs.isLoading ? 'Loading…' : runOptions.length ? 'Choose an open run' : 'No open runs'}
            data={runOptions}
            value={runId}
            onChange={setRunId}
            searchable
            nothingFoundMessage="No open runs"
          />
        ) : (
          <>
            <TextInput label="Run name" required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Smoke – build 512" data-autofocus />
            <Select label="Milestone" data={milestoneOptions} value={milestoneId} onChange={setMilestoneId} clearable />
            <Select label="Environment" data={environmentOptions} value={environmentId} onChange={setEnvironmentId} clearable />
          </>
        )}
        <Text size="xs" c="dimmed">
          Archived test cases cannot be added to runs.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={mode === 'existing' ? !runId : !name.trim()}>
            {mode === 'existing' ? 'Add to run' : 'Create run'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Requirement form
// ---------------------------------------------------------------------------

export function RequirementFormModal({ opened, onClose, requirement, onSaved }: { opened: boolean; onClose: () => void; requirement?: any; onSaved: (r: any) => void }) {
  const { pid } = useProject();
  const blank = { title: '', externalKey: '', externalUrl: '', status: 'APPROVED', priority: 'MEDIUM', description: '' };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) return;
    setErrors({});
    setV(
      requirement
        ? {
            title: requirement.title,
            externalKey: requirement.externalKey ?? '',
            externalUrl: requirement.externalUrl ?? '',
            status: requirement.status,
            priority: requirement.priority,
            description: requirement.description ?? '',
          }
        : blank,
    );
  }, [opened, requirement]);
  const set = (k: keyof typeof blank, val: string) => setV((s) => ({ ...s, [k]: val }));

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const body = {
      title: v.title,
      externalKey: v.externalKey.trim() || null,
      externalUrl: v.externalUrl.trim() || null,
      status: v.status,
      priority: v.priority,
      description: v.description.trim() || null,
    };
    try {
      const r = requirement ? await api.patch(p(pid, `/requirements/${requirement.id}`), body) : await api.post(p(pid, '/requirements'), body);
      toastOk(requirement ? 'Requirement updated' : `Created ${r.requirement.key}`);
      onSaved(r.requirement);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={requirement ? `Edit ${requirement.key}` : 'New requirement'} size="lg">
      <Stack>
        <TextInput label="Title" required value={v.title} onChange={(e) => set('title', e.currentTarget.value)} error={errors.title} data-autofocus />
        <Group grow>
          <TextInput label="External key" placeholder="e.g. JIRA-123" value={v.externalKey} onChange={(e) => set('externalKey', e.currentTarget.value)} error={errors.externalKey} />
          <TextInput label="External URL" placeholder="https://…" type="url" value={v.externalUrl} onChange={(e) => set('externalUrl', e.currentTarget.value)} error={errors.externalUrl} />
        </Group>
        <Group grow>
          <Select label="Status" data={options(REQUIREMENT_STATUS)} value={v.status} onChange={(x) => set('status', x ?? 'APPROVED')} allowDeselect={false} />
          <Select label="Priority" data={options(PRIORITY)} value={v.priority} onChange={(x) => set('priority', x ?? 'MEDIUM')} allowDeselect={false} />
        </Group>
        <Textarea label="Description / acceptance criteria" autosize minRows={4} maxRows={14} value={v.description} onChange={(e) => set('description', e.currentTarget.value)} error={errors.description} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!v.title.trim()}>
            {requirement ? 'Save changes' : 'Create requirement'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Requirement coverage status with a covered/uncovered icon. */
export function CoverageBadge({ coverage }: { coverage: { status: string; covered: boolean } | null | undefined }) {
  const meta = COVERAGE_STATUS[coverage?.status ?? 'untested'] ?? COVERAGE_STATUS.untested!;
  return (
    <Tooltip label={meta.hint} multiline w={240}>
      <Badge variant="light" color={meta.color} leftSection={coverage?.covered ? <IconCircleCheck size={12} /> : <IconCircleDashed size={12} />}>
        {meta.label}
      </Badge>
    </Tooltip>
  );
}