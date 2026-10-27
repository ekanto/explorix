import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Grid,
  Group,
  Menu,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  TagsInput,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconArchive,
  IconArchiveOff,
  IconChevronDown,
  IconChevronRight,
  IconCompass,
  IconDots,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFolders,
  IconInbox,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRobot,
  IconTag,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { options, PRIORITY } from '../../lib/constants';
import { fromNow, fmtDateTime } from '../../lib/format';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, PriorityBadge, QueryState, StatusPill, toastError, toastOk } from '../../components/ui';
import { ExportMenu } from '../../components/ExportMenu';
import { TestCaseFormModal } from '../../components/TestCaseForm';
import { AddToRunModal, CASE_TYPES, CsvImportModal, flattenFolders, SearchInput, TEST_CASE_STATUS, useFolders, useUrlState, type Folder } from '../../components/TestingWidgets';

const PAGE_SIZE = 50;
const FILTER_KEYS = ['q', 'priority', 'status', 'type', 'tag'] as const;

export default function TestCases() {
  const { pid, can, tagNames } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sp, get, set } = useUrlState();
  const { folders, folderOptions } = useFolders();
  const canEdit = can('TESTER');

  const folder = get('folder');
  const archived = get('archived') === 'true';
  const page = Number(get('page')) || 1;
  const filters = {
    q: get('q') || undefined,
    folderId: folder || undefined,
    priority: get('priority') || undefined,
    status: get('status') || undefined,
    type: get('type') || undefined,
    tag: get('tag') || undefined,
    archived: archived ? 'true' : undefined,
  };
  const sort = get('sort') || 'number';
  const list = useQuery({
    queryKey: ['test-cases', pid, filters, sort, page],
    queryFn: () => api.get(p(pid, '/test-cases'), { ...filters, sort, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const filterSig = JSON.stringify(filters);
  useEffect(() => setSelected([]), [filterSig, page]);

  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFormat, setImportFormat] = useState('auto');
  const [importSeparator, setImportSeparator] = useState('auto');
  const [bulk, setBulk] = useState<null | 'move' | 'tag' | 'run'>(null);

  const anyFilter = FILTER_KEYS.some((k) => sp.get(k));
  const clearFilters = { q: null, priority: null, status: null, type: null, tag: null };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['test-cases', pid] });
    qc.invalidateQueries({ queryKey: ['test-folders', pid] });
  };

  const bulkAction = async (action: 'archive' | 'unarchive' | 'move' | 'tag', extra: Record<string, unknown> = {}) => {
    try {
      const r = await api.post(p(pid, '/test-cases/bulk'), { ids: selected, action, ...extra });
      toastOk(`${r.count} test case(s) updated`);
      setSelected([]);
      invalidate();
    } catch (e) {
      toastError(e);
    }
  };

  const confirmArchive = () =>
    modals.openConfirmModal({
      title: archived ? 'Restore test cases' : 'Archive test cases',
      children: (
        <Text size="sm">
          {archived
            ? `Restore ${selected.length} archived test case(s) to the repository?`
            : `Archive ${selected.length} test case(s)? Archived cases are hidden from the repository and cannot be added to new runs. Existing run results are kept.`}
        </Text>
      ),
      labels: { confirm: archived ? 'Restore' : 'Archive', cancel: 'Cancel' },
      confirmProps: { color: archived ? 'teal' : 'red' },
      onConfirm: () => bulkAction(archived ? 'unarchive' : 'archive'),
    });

  const folderName = folder === 'none' ? 'Unfiled' : folders.find((f) => f.id === folder)?.name;

  return (
    <>
      <PageHeader
        title="Test cases"
        subtitle="Reusable scripted and BDD test cases, organised in folders and executed in test runs."
        actions={
          <>
            <ExportMenu url={p(pid, '/test-cases/export')} params={filters} name="test-cases" />
            {canEdit && (
              <>
                <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setImporting(true)}>
                  Import CSV
                </Button>
                <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                  New test case
                </Button>
              </>
            )}
          </>
        }
      />
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 3 }}>
          <FolderTree folders={folders} selected={folder} onSelect={(id) => set({ folder: id })} canEdit={canEdit} canDelete={can('LEAD')} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 9 }}>
          <Stack gap="sm">
            <Group gap="xs" wrap="wrap">
              <SearchInput value={get('q')} onChange={(q) => set({ q })} placeholder="Search title, description or C-12" />
              <Select placeholder="Priority" data={options(PRIORITY)} value={get('priority') || null} onChange={(v) => set({ priority: v })} clearable w={130} aria-label="Priority filter" />
              <Select placeholder="Status" data={options(TEST_CASE_STATUS)} value={get('status') || null} onChange={(v) => set({ status: v })} clearable w={140} aria-label="Status filter" />
              <Select
                placeholder="Type"
                data={[...new Set([...CASE_TYPES, ...(get('type') ? [get('type')] : [])])]}
                value={get('type') || null}
                onChange={(v) => set({ type: v })}
                clearable
                searchable
                w={150}
                aria-label="Type filter"
              />
              <Select placeholder="Tag" data={tagNames} value={get('tag') || null} onChange={(v) => set({ tag: v })} clearable searchable w={140} aria-label="Tag filter" />
              <Select
                data={[
                  { value: 'number', label: 'Sort: key' },
                  { value: 'updated', label: 'Sort: recently updated' },
                  { value: 'title', label: 'Sort: title' },
                ]}
                value={sort}
                onChange={(v) => set({ sort: v === 'number' ? null : v })}
                allowDeselect={false}
                w={200}
                aria-label="Sort"
              />
              <SegmentedControl
                size="sm"
                value={archived ? 'archived' : 'active'}
                onChange={(v) => set({ archived: v === 'archived' ? 'true' : null })}
                data={[
                  { value: 'active', label: 'Current' },
                  { value: 'archived', label: 'Archived' },
                ]}
                aria-label="Archived filter"
              />
              {anyFilter && (
                <Button variant="subtle" size="sm" leftSection={<IconX size={14} />} onClick={() => set(clearFilters)}>
                  Clear
                </Button>
              )}
            </Group>

            {selected.length > 0 && canEdit && (
              <Paper withBorder p="xs" bg="var(--ex-subtle)" className="ex-fade-in">
                <Group gap="xs">
                  <Text size="sm" fw={600} mr="xs">
                    {selected.length} selected
                  </Text>
                  {!archived && (
                    <>
                      <Button size="xs" variant="default" leftSection={<IconFolders size={14} />} onClick={() => setBulk('move')}>
                        Move to folder
                      </Button>
                      <Button size="xs" variant="default" leftSection={<IconTag size={14} />} onClick={() => setBulk('tag')}>
                        Add tags
                      </Button>
                      <Button size="xs" variant="default" leftSection={<IconPlayerPlay size={14} />} onClick={() => setBulk('run')}>
                        Add to run
                      </Button>
                    </>
                  )}
                  <Button size="xs" variant="light" color={archived ? 'teal' : 'red'} leftSection={archived ? <IconArchiveOff size={14} /> : <IconArchive size={14} />} onClick={confirmArchive}>
                    {archived ? 'Restore' : 'Archive'}
                  </Button>
                  <Button size="xs" variant="subtle" onClick={() => setSelected([])}>
                    Clear selection
                  </Button>
                </Group>
              </Paper>
            )}

            <QueryState query={list}>
              {(d: any) =>
                d.testCases.length === 0 ? (
                  <Paper withBorder>
                    {anyFilter || folder || archived ? (
                      <EmptyState
                        title={archived ? 'No archived test cases' : 'No matching test cases'}
                        description={folderName ? `Nothing in “${folderName}” matches the current filters.` : 'Try different filters.'}
                        action={
                          <Button variant="light" onClick={() => set({ ...clearFilters, folder: null, archived: null })}>
                            Show all test cases
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState
                        title="No test cases yet"
                        description="Write step-by-step or Gherkin test cases, import them from CSV, or convert exploratory findings into regression cases."
                        action={
                          canEdit && (
                            <Group>
                              <Button onClick={() => setCreating(true)}>New test case</Button>
                              <Button variant="default" onClick={() => setImporting(true)}>
                                Import CSV
                              </Button>
                            </Group>
                          )
                        }
                      />
                    )}
                  </Paper>
                ) : (
                  <>
                    <Paper withBorder>
                      <Table.ScrollContainer minWidth={860}>
                        <Table highlightOnHover verticalSpacing="sm">
                          <Table.Thead>
                            <Table.Tr>
                              {canEdit && (
                                <Table.Th w={36}>
                                  <Checkbox
                                    aria-label="Select all on this page"
                                    checked={d.testCases.every((c: any) => selected.includes(c.id))}
                                    indeterminate={selected.length > 0 && !d.testCases.every((c: any) => selected.includes(c.id))}
                                    onChange={(e) => setSelected(e.currentTarget.checked ? d.testCases.map((c: any) => c.id) : [])}
                                  />
                                </Table.Th>
                              )}
                              <Table.Th w={70}>Key</Table.Th>
                              <Table.Th>Title</Table.Th>
                              <Table.Th w={100}>Priority</Table.Th>
                              <Table.Th w={80}>Steps</Table.Th>
                              <Table.Th>Tags</Table.Th>
                              <Table.Th w={110}>Last result</Table.Th>
                              <Table.Th w={110}>Updated</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {d.testCases.map((c: any) => (
                              <Table.Tr
                                key={c.id}
                                className="ex-row-link"
                                onClick={() => navigate(`/projects/${pid}/test-cases/${c.id}`)}
                                bg={selected.includes(c.id) ? 'var(--mantine-primary-color-light)' : undefined}
                              >
                                {canEdit && (
                                  <Table.Td onClick={(e) => e.stopPropagation()}>
                                    <Checkbox
                                      aria-label={`Select ${c.key}`}
                                      checked={selected.includes(c.id)}
                                      onChange={(e) => {
                                        const on = e.currentTarget.checked;
                                        setSelected((s) => (on ? [...s, c.id] : s.filter((x) => x !== c.id)));
                                      }}
                                    />
                                  </Table.Td>
                                )}
                                <Table.Td>
                                  <span className="ex-key">{c.key}</span>
                                </Table.Td>
                                <Table.Td miw={260}>
                                  <Group gap={6} wrap="nowrap">
                                    <Text size="sm" fw={500} component={Link} to={`/projects/${pid}/test-cases/${c.id}`} className="ex-link" onClick={(e: MouseEvent) => e.stopPropagation()} lineClamp={1}>
                                      {c.title}
                                    </Text>
                                    {c.status !== 'ACTIVE' && (
                                      <Badge size="xs" variant="light" color={TEST_CASE_STATUS[c.status]?.color}>
                                        {TEST_CASE_STATUS[c.status]?.label}
                                      </Badge>
                                    )}
                                    {c.automationKey && (
                                      <Tooltip label={`Automated: ${c.automationKey}`}>
                                        <IconRobot size={15} color="var(--mantine-color-cyan-6)" aria-label="Automated" style={{ flexShrink: 0 }} />
                                      </Tooltip>
                                    )}
                                    {(c.sourceFindingId || c.sourceCharterId) && (
                                      <Tooltip label={c.sourceFindingId ? 'Created from an exploratory finding' : 'Created from a charter'}>
                                        <ActionIcon
                                          size="xs"
                                          variant="subtle"
                                          component={Link}
                                          to={c.sourceFindingId ? `/projects/${pid}/findings/${c.sourceFindingId}` : `/projects/${pid}/charters/${c.sourceCharterId}`}
                                          onClick={(e: MouseEvent) => e.stopPropagation()}
                                          aria-label="Open exploratory source"
                                        >
                                          <IconCompass size={14} />
                                        </ActionIcon>
                                      </Tooltip>
                                    )}
                                  </Group>
                                  {c.folder && !folder && (
                                    <Text size="xs" c="dimmed">
                                      {c.folder.name}
                                    </Text>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <PriorityBadge value={c.priority} size="sm" />
                                </Table.Td>
                                <Table.Td>
                                  {c.format === 'GHERKIN' ? (
                                    <Badge size="sm" variant="light" color="grape" title="Gherkin scenario">
                                      BDD
                                    </Badge>
                                  ) : c.format === 'TEXT' ? (
                                    <Text size="xs" c="dimmed">
                                      Text
                                    </Text>
                                  ) : (
                                    <Text size="sm">{c._count?.steps ?? 0}</Text>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <Group gap={4}>
                                    {c.tags.slice(0, 3).map((t: string) => (
                                      <Badge key={t} size="xs" variant="outline" color="gray">
                                        {t}
                                      </Badge>
                                    ))}
                                    {c.tags.length > 3 && (
                                      <Text size="xs" c="dimmed">
                                        +{c.tags.length - 3}
                                      </Text>
                                    )}
                                  </Group>
                                </Table.Td>
                                <Table.Td>
                                  {c.lastResult ? (
                                    <StatusPill status={c.lastResult} />
                                  ) : (
                                    <Text size="xs" c="dimmed">
                                      Never run
                                    </Text>
                                  )}
                                </Table.Td>
                                <Table.Td className="ex-nowrap">
                                  <Tooltip label={fmtDateTime(c.updatedAt)}>
                                    <Text size="xs" c="dimmed">
                                      {fromNow(c.updatedAt)}
                                    </Text>
                                  </Tooltip>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </Table.ScrollContainer>
                    </Paper>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        {d.total} test case{d.total === 1 ? '' : 's'}
                        {folderName ? ` in “${folderName}”` : ''}
                      </Text>
                      {d.total > PAGE_SIZE && <Pagination total={Math.ceil(d.total / PAGE_SIZE)} value={page} onChange={(n) => set({ page: String(n) })} size="sm" />}
                    </Group>
                  </>
                )
              }
            </QueryState>
          </Stack>
        </Grid.Col>
      </Grid>

      <TestCaseFormModal opened={creating} onClose={() => setCreating(false)} defaults={{ folderId: folder && folder !== 'none' ? folder : null }} onSaved={invalidate} />
      <CsvImportModal
        opened={importing}
        onClose={() => setImporting(false)}
        title="Import test cases from CSV"
        url={p(pid, `/test-cases/import?format=${importFormat}&separator=${importSeparator}`)}
        onImported={invalidate}
        options={
          <Group grow align="flex-start">
            <Select
              label="Test case format"
              description="How each row is stored"
              data={[
                { value: 'auto', label: 'Auto-detect' },
                { value: 'steps', label: 'Steps (action + expected)' },
                { value: 'gherkin', label: 'Gherkin (BDD)' },
                { value: 'text', label: 'Text (free form)' },
              ]}
              value={importFormat}
              onChange={(v) => setImportFormat(v ?? 'auto')}
              allowDeselect={false}
            />
            <Select
              label="Step separator"
              description="How a Steps cell is split"
              data={[
                { value: 'auto', label: 'Auto-detect' },
                { value: 'newline', label: 'New line' },
                { value: 'pipe', label: 'Pipe ( | )' },
                { value: 'semicolon', label: 'Semicolon ( ; )' },
                { value: 'numbered', label: 'Inline numbering (1. … 2. …)' },
              ]}
              value={importSeparator}
              onChange={(v) => setImportSeparator(v ?? 'auto')}
              allowDeselect={false}
            />
          </Group>
        }
        help={
          <>
            The first row must be a header. Recognised columns (case-insensitive): <b>Title</b> (required), Folder, Priority, Type, Status, Description, Preconditions, Steps, Expected, Test data,
            Tags, Gherkin, Estimate (min), Automation key. Steps and Expected are split with the chosen separator and paired in order; a single Expected value goes on the last step.{' '}
            <i>Gherkin</i> builds a scenario from plain columns (Given = preconditions, When = steps, Then = expected) and <i>Steps</i> can turn Gherkin into steps. Unknown folders are created at
            the top level. Files exported here can be re-imported.
          </>
        }
      />
      <BulkMoveModal opened={bulk === 'move'} onClose={() => setBulk(null)} folderOptions={folderOptions} count={selected.length} onConfirm={(folderId) => bulkAction('move', { folderId })} />
      <BulkTagModal opened={bulk === 'tag'} onClose={() => setBulk(null)} tagNames={tagNames} count={selected.length} onConfirm={(tags) => bulkAction('tag', { tags })} />
      <AddToRunModal opened={bulk === 'run'} onClose={() => setBulk(null)} caseIds={selected} onDone={() => setSelected([])} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Folder tree
// ---------------------------------------------------------------------------

function FolderTree({ folders, selected, onSelect, canEdit, canDelete }: { folders: Folder[]; selected: string; onSelect: (id: string | null) => void; canEdit: boolean; canDelete: boolean }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const { unfiledCount, query } = useFolders();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [edit, setEdit] = useState<null | { folder?: Folder; parentId?: string | null }>(null);
  const flat = useMemo(() => flattenFolders(folders), [folders]);
  const total = folders.reduce((a, f) => a + f.caseCount, 0) + unfiledCount;

  const hidden = (f: Folder): boolean => {
    let cur = f.parentId;
    while (cur) {
      if (collapsed.includes(cur)) return true;
      cur = folders.find((x) => x.id === cur)?.parentId ?? null;
    }
    return false;
  };
  const hasChildren = (id: string) => folders.some((f) => f.parentId === id);
  const toggle = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const remove = (f: Folder) =>
    modals.openConfirmModal({
      title: `Delete folder “${f.name}”?`,
      children: <Text size="sm">Sub-folders are deleted too. Test cases inside are not deleted — they move to the parent folder{f.parentId ? '' : ' (Unfiled)'}.</Text>,
      labels: { confirm: 'Delete folder', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.del(p(pid, `/test-folders/${f.id}`));
          if (selected === f.id) onSelect(null);
          qc.invalidateQueries({ queryKey: ['test-folders', pid] });
          qc.invalidateQueries({ queryKey: ['test-cases', pid] });
          toastOk('Folder deleted');
        } catch (e) {
          toastError(e);
        }
      },
    });

  const row = ({ id, label, count, depth = 0, icon, folder }: { id: string | null; label: string; count: number; depth?: number; icon: ReactNode; folder?: Folder }) => {
    const active = (selected || null) === id;
    return (
      <Group
        key={id ?? 'all'}
        gap={4}
        wrap="nowrap"
        align="flex-start"
        pl={6 + depth * 14}
        pr={4}
        py={3}
        style={{ borderRadius: 'var(--mantine-radius-sm)', background: active ? 'var(--mantine-primary-color-light)' : undefined }}
      >
        {folder && hasChildren(folder.id) ? (
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label={collapsed.includes(folder.id) ? `Expand ${folder.name}` : `Collapse ${folder.name}`} onClick={() => toggle(folder.id)}>
            {collapsed.includes(folder.id) ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
          </ActionIcon>
        ) : (
          <Box w={18} style={{ flexShrink: 0 }} />
        )}
        <UnstyledButton onClick={() => onSelect(id)} style={{ flex: 1, minWidth: 0 }} aria-current={active ? 'true' : undefined}>
          <Group gap={6} wrap="nowrap" align="flex-start">
            <Box component="span" display="flex" mt={2} style={{ flexShrink: 0 }}>
              {icon}
            </Box>
            <Text size="sm" fw={active ? 600 : 400} className="ex-wrap-anywhere">
              {label}
            </Text>
          </Group>
        </UnstyledButton>
        <Text size="xs" c="dimmed" mt={2}>
          {count}
        </Text>
        {folder && canEdit ? (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`Folder actions for ${folder.name}`}>
                <IconDots size={12} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconFolderPlus size={14} />} onClick={() => setEdit({ parentId: folder.id })}>
                New sub-folder
              </Menu.Item>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setEdit({ folder })}>
                Rename / move
              </Menu.Item>
              {canDelete && (
                <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => remove(folder)}>
                  Delete
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        ) : (
          canEdit && <Box w={18} />
        )}
      </Group>
    );
  };

  return (
    <Paper withBorder p="xs" component="nav" aria-label="Test case folders">
      <Group justify="space-between" px={6} mb={4}>
        <Text className="ex-label">
          Folders
        </Text>
        {canEdit && (
          <Tooltip label="New folder">
            <ActionIcon size="sm" variant="subtle" aria-label="New folder" onClick={() => setEdit({ parentId: null })}>
              <IconFolderPlus size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <Stack gap={1}>
        {row({ id: null, label: 'All cases', count: total, icon: <IconFolders size={16} /> })}
        {flat
          .filter(({ folder }) => !hidden(folder))
          .map(({ folder, depth }) =>
            row({
              id: folder.id,
              label: folder.name,
              count: folder.caseCount,
              depth,
              folder,
              icon: selected === folder.id ? <IconFolderOpen size={16} color="var(--mantine-color-yellow-7)" /> : <IconFolder size={16} color="var(--mantine-color-yellow-7)" />,
            }),
          )}
        {row({ id: 'none', label: 'Unfiled', count: unfiledCount, icon: <IconInbox size={16} /> })}
      </Stack>
      {!query.isLoading && folders.length === 0 && (
        <Text size="xs" c="dimmed" px={6} mt="xs">
          No folders yet.{canEdit ? ' Create one to organise your cases.' : ''}
        </Text>
      )}
      <Text size="xs" c="dimmed" px={6} mt="xs">
        Counts show cases directly in each folder (archived excluded).
      </Text>
      <FolderModal state={edit} folders={folders} onClose={() => setEdit(null)} />
    </Paper>
  );
}

function FolderModal({ state, folders, onClose }: { state: null | { folder?: Folder; parentId?: string | null }; folders: Folder[]; onClose: () => void }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = state?.folder;
  useEffect(() => {
    if (!state) return;
    setName(state.folder?.name ?? '');
    setParentId(state.folder ? state.folder.parentId : (state.parentId ?? null));
  }, [state]);

  // A folder cannot be moved under itself or its descendants.
  const blocked = useMemo(() => {
    const out = new Set<string>();
    if (!editing) return out;
    out.add(editing.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders)
        if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
          out.add(f.id);
          grew = true;
        }
    }
    return out;
  }, [editing, folders]);
  const parentOptions = flattenFolders(folders)
    .filter(({ folder }) => !blocked.has(folder.id))
    .map(({ folder, path }) => ({ value: folder.id, label: path }));

  const submit = async () => {
    setBusy(true);
    try {
      if (editing) await api.patch(p(pid, `/test-folders/${editing.id}`), { name, parentId });
      else await api.post(p(pid, '/test-folders'), { name, parentId });
      qc.invalidateQueries({ queryKey: ['test-folders', pid] });
      toastOk(editing ? 'Folder updated' : 'Folder created');
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={!!state} onClose={onClose} title={editing ? 'Edit folder' : 'New folder'} size="sm">
      <Stack>
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} />
        <Select label="Parent folder" placeholder="Top level" data={parentOptions} value={parentId} onChange={setParentId} clearable searchable />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim()}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function BulkMoveModal({
  opened,
  onClose,
  folderOptions,
  count,
  onConfirm,
}: {
  opened: boolean;
  onClose: () => void;
  folderOptions: { value: string; label: string }[];
  count: number;
  onConfirm: (folderId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal opened={opened} onClose={onClose} title={`Move ${count} test case(s)`} size="sm">
      <Stack>
        <Select label="Destination folder" data={[{ value: '__none', label: 'Unfiled' }, ...folderOptions]} value={target} onChange={setTarget} searchable data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!target}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(target === '__none' ? null : target);
              setBusy(false);
              onClose();
            }}
          >
            Move
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function BulkTagModal({ opened, onClose, tagNames, count, onConfirm }: { opened: boolean; onClose: () => void; tagNames: string[]; count: number; onConfirm: (tags: string[]) => Promise<void> }) {
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal opened={opened} onClose={onClose} title={`Add tags to ${count} test case(s)`} size="sm">
      <Stack>
        <TagsInput label="Tags to add" description="Existing tags are kept." data={tagNames} value={tags} onChange={setTags} data-autofocus />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!tags.length}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm(tags);
              setBusy(false);
              setTags([]);
              onClose();
            }}
          >
            Add tags
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
