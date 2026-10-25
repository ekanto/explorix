import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Anchor, Badge, Button, Group, Menu, Pagination, Paper, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconExternalLink, IconFileTypeCsv, IconListDetails, IconPlus, IconUpload } from '@tabler/icons-react';
import { api, download, p } from '../../lib/api';
import { options } from '../../lib/constants';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, PriorityBadge, QueryState, toastError } from '../../components/ui';
import { CoverageBadge, CsvImportModal, REQUIREMENT_STATUS, RequirementFormModal, SearchInput, useUrlState } from '../../components/TestingWidgets';

const PAGE_SIZE = 50;
const CLIENT_LIMIT = 200;
const COVERAGE_FILTERS = [
  { value: 'covered', label: 'Covered' },
  { value: 'uncovered', label: 'Not covered' },
  { value: 'passing', label: 'Passing' },
  { value: 'failing', label: 'Failing' },
  { value: 'partial', label: 'Partial' },
];

const matchesCoverage = (r: any, f: string) => (f === 'covered' ? r.coverage.covered : f === 'uncovered' ? !r.coverage.covered : r.coverage.status === f);

export default function Requirements() {
  const { pid, can } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { get, set } = useUrlState();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const cov = get('coverage');
  const page = Number(get('page')) || 1;
  const serverFilters = { q: get('q') || undefined, status: get('status') || undefined };
  // Coverage is computed per requirement on the server but cannot be filtered there, so filter one large page client-side.
  const params = cov ? { ...serverFilters, page: 1, pageSize: CLIENT_LIMIT } : { ...serverFilters, page, pageSize: PAGE_SIZE };
  const q = useQuery({ queryKey: ['requirements', pid, params], queryFn: () => api.get(p(pid, '/requirements'), params), placeholderData: keepPreviousData });
  const filtered = !!(get('q') || get('status') || cov);

  const exportCsv = () => download(p(pid, `/requirements?format=csv${get('q') ? `&q=${encodeURIComponent(get('q'))}` : ''}${get('status') ? `&status=${get('status')}` : ''}`), 'requirements.csv').catch((e) => toastError(e, 'Export failed'));

  return (
    <>
      <PageHeader
        title="Requirements"
        subtitle="Trace requirements to test cases, charters and findings to see what is covered and how it is doing."
        actions={
          <>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" leftSection={<IconDownload size={16} />}>
                  Export
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconFileTypeCsv size={14} />} onClick={exportCsv}>
                  CSV (current search &amp; status filter)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {can('LEAD') && (
              <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => setImporting(true)}>
                Import CSV
              </Button>
            )}
            {can('TESTER') && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                New requirement
              </Button>
            )}
          </>
        }
      />
      <Stack gap="md">
        <Group gap="sm" align="flex-end" wrap="wrap">
          <SearchInput value={get('q')} onChange={(v) => set({ q: v })} placeholder="Search title or external key…" w={280} />
          <Select placeholder="Any status" data={options(REQUIREMENT_STATUS)} value={get('status') || null} onChange={(v) => set({ status: v })} clearable w={170} aria-label="Status" />
          <Select placeholder="Any coverage" data={COVERAGE_FILTERS} value={cov || null} onChange={(v) => set({ coverage: v })} clearable w={170} aria-label="Coverage" />
          {filtered && (
            <Button variant="subtle" size="xs" mb={6} onClick={() => set({ q: null, status: null, coverage: null })}>
              Clear filters
            </Button>
          )}
        </Group>
        <QueryState query={q}>
          {(d: any) => {
            const rows: any[] = cov ? d.requirements.filter((r: any) => matchesCoverage(r, cov)) : d.requirements;
            const total = cov ? rows.length : d.total;
            if (!rows.length)
              return (
                <EmptyState
                  title={filtered ? 'No requirements match these filters' : 'No requirements yet'}
                  description={filtered ? 'Try clearing filters.' : 'Add requirements or user stories, or import them from CSV, then link test cases and charters to track coverage.'}
                  icon={<IconListDetails size={26} />}
                  action={
                    !filtered &&
                    can('TESTER') && (
                      <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                        New requirement
                      </Button>
                    )
                  }
                />
              );
            return (
              <>
                {cov && d.total > CLIENT_LIMIT && (
                  <Alert color="yellow" p="xs">
                    <Text size="sm">
                      Coverage filtering only checks the first {CLIENT_LIMIT} of {d.total} matching requirements. Narrow the search or status filter to see the rest.
                    </Text>
                  </Alert>
                )}
                <Paper withBorder>
                  <Table.ScrollContainer minWidth={900}>
                    <Table highlightOnHover verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th w={80}>Key</Table.Th>
                          <Table.Th>Requirement</Table.Th>
                          <Table.Th w={110}>Status</Table.Th>
                          <Table.Th w={100}>Priority</Table.Th>
                          <Table.Th w={120}>Test cases</Table.Th>
                          <Table.Th w={100}>Charters</Table.Th>
                          <Table.Th w={110}>Open findings</Table.Th>
                          <Table.Th w={140}>Coverage</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {rows.map((r) => (
                          <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${pid}/requirements/${r.id}`)}>
                            <Table.Td>
                              <span className="ex-key">{r.key}</span>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" fw={500} component={Link} to={`/projects/${pid}/requirements/${r.id}`} className="ex-link" onClick={(e) => e.stopPropagation()} lineClamp={2}>
                                {r.title}
                              </Text>
                              {(r.externalKey || r.externalUrl) && (
                                <Group gap={4} mt={2}>
                                  {r.externalUrl ? (
                                    <Anchor href={r.externalUrl} target="_blank" rel="noopener noreferrer" size="xs" onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                      {r.externalKey || 'External link'} <IconExternalLink size={12} />
                                    </Anchor>
                                  ) : (
                                    <Text size="xs" c="dimmed">
                                      {r.externalKey}
                                    </Text>
                                  )}
                                </Group>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="light" color={REQUIREMENT_STATUS[r.status]?.color}>
                                {REQUIREMENT_STATUS[r.status]?.label ?? r.status}
                              </Badge>
                            </Table.Td>
                            <Table.Td>
                              <PriorityBadge value={r.priority} size="sm" />
                            </Table.Td>
                            <Table.Td>
                              <Tooltip label={`${r.coverage.executedTestCases} executed, ${r.coverage.failedTestCases} failing or blocked`}>
                                <Text size="sm">
                                  {r.coverage.testCases}
                                  {r.coverage.testCases > 0 && (
                                    <Text span size="xs" c="dimmed">
                                      {' '}
                                      ({r.coverage.executedTestCases} run{r.coverage.failedTestCases ? `, ` : ''}
                                      {r.coverage.failedTestCases ? (
                                        <Text span c="red" size="xs" fw={600}>
                                          {r.coverage.failedTestCases} failing
                                        </Text>
                                      ) : null}
                                      )
                                    </Text>
                                  )}
                                </Text>
                              </Tooltip>
                            </Table.Td>
                            <Table.Td>
                              <Tooltip label={`${r.coverage.exploredCharters} with a completed session`}>
                                <Text size="sm">
                                  {r.coverage.charters}
                                  {r.coverage.charters > 0 && (
                                    <Text span size="xs" c="dimmed">
                                      {' '}
                                      ({r.coverage.exploredCharters} explored)
                                    </Text>
                                  )}
                                </Text>
                              </Tooltip>
                            </Table.Td>
                            <Table.Td>
                              <Text size="sm" c={r.coverage.openDefects ? 'red' : undefined}>
                                {r.coverage.openFindings}
                                {r.coverage.openDefects > 0 && (
                                  <Text span size="xs">
                                    {' '}
                                    ({r.coverage.openDefects} defect{r.coverage.openDefects === 1 ? '' : 's'})
                                  </Text>
                                )}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              <CoverageBadge coverage={r.coverage} />
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Paper>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {total} requirement{total === 1 ? '' : 's'}
                  </Text>
                  {!cov && d.total > PAGE_SIZE && <Pagination value={page} onChange={(n) => set({ page: String(n) })} total={Math.ceil(d.total / PAGE_SIZE)} />}
                </Group>
              </>
            );
          }}
        </QueryState>
      </Stack>

      <RequirementFormModal
        opened={creating}
        onClose={() => setCreating(false)}
        onSaved={(r) => {
          qc.invalidateQueries({ queryKey: ['requirements', pid] });
          if (r?.id) navigate(`/projects/${pid}/requirements/${r.id}`);
        }}
      />
      <CsvImportModal
        opened={importing}
        onClose={() => setImporting(false)}
        title="Import requirements from CSV"
        url={p(pid, '/requirements/import')}
        help={
          <>
            First row must be a header. Recognised columns: <b>Title</b> (required), Description, External key, External URL, Priority (LOW, MEDIUM, HIGH, CRITICAL; default MEDIUM) and Status (DRAFT, APPROVED, IMPLEMENTED, DEPRECATED).
          </>
        }
        onImported={() => qc.invalidateQueries({ queryKey: ['requirements', pid] })}
      />
    </>
  );
}
