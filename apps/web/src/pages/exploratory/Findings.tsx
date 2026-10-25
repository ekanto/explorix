import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, CloseButton, Group, MultiSelect, Paper, SegmentedControl, Select, Table, Text, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconBulb, IconFilterOff, IconMessage, IconPaperclip, IconPlus } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { FINDING_STATUS, options, PRIORITY, SEVERITY } from '../../lib/constants';
import { fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { ExportMenu } from '../../components/ExportMenu';
import { FindingFormModal } from '../../components/FindingForm';
import { ListPager, SearchInput, useUrlFilters } from '../../components/ListFilters';
import { ClassificationBadge, EmptyState, FindingStatusBadge, IssueStatusBadge, PageHeader, PriorityBadge, QueryState, SeverityBadge, toastOk, UserLabel } from '../../components/ui';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['q', 'classification', 'severity', 'priority', 'status', 'open', 'ownerId', 'authorId', 'sessionId', 'charterId', 'requirementId', 'milestoneId', 'tag', 'from', 'to', 'defects'];
const CLOSED_STATUSES = ['CONVERTED', 'RESOLVED', 'DUPLICATE', 'WONT_FIX', 'CLOSED'];

export default function Findings() {
  const { pid, can, classifications, memberOptions, milestoneOptions, tagNames } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const f = useUrlFilters();
  const [creating, setCreating] = useState(false);

  const params: Record<string, string | undefined> = {
    q: f.get('q') || undefined,
    classification: f.get('classification') || undefined,
    defects: f.get('defects') || undefined,
    severity: f.get('severity') || undefined,
    priority: f.get('priority') || undefined,
    status: f.get('status') || undefined,
    open: f.get('open') || undefined,
    ownerId: f.get('ownerId') || undefined,
    authorId: f.get('authorId') || undefined,
    sessionId: f.get('sessionId') || undefined,
    charterId: f.get('charterId') || undefined,
    requirementId: f.get('requirementId') || undefined,
    milestoneId: f.get('milestoneId') || undefined,
    tag: f.get('tag') || undefined,
    from: f.get('from') || undefined,
    to: f.get('to') || undefined,
  };
  const listParams = { ...params, sort: f.get('sort') || undefined, page: f.page, pageSize: PAGE_SIZE };
  const q = useQuery({ queryKey: ['findings', pid, listParams], queryFn: () => api.get(p(pid, '/findings'), listParams), placeholderData: (prev) => prev });
  const charters = useQuery({ queryKey: ['charters', pid, 'options'], queryFn: () => api.get(p(pid, '/charters'), { pageSize: 200, sort: 'number' }), staleTime: 60_000 });
  const requirements = useQuery({ queryKey: ['requirements', pid, 'options'], queryFn: () => api.get(p(pid, '/requirements'), { pageSize: 200 }), staleTime: 60_000 });
  const session = useQuery({
    queryKey: ['session', pid, f.get('sessionId'), 'label'],
    queryFn: () => api.get(p(pid, `/sessions/${f.get('sessionId')}`)),
    enabled: !!f.get('sessionId'),
    staleTime: 60_000,
  });

  const charterOptions = (charters.data?.charters ?? []).map((c: any) => ({ value: c.id, label: `${c.key} · ${c.title}` }));
  const requirementOptions = (requirements.data?.requirements ?? []).map((r: any) => ({ value: r.id, label: `${r.key ?? `R-${r.number}`} · ${r.title}` }));
  const classOptions = [...classifications]
    .filter((c) => !c.archivedAt || f.list('classification').includes(c.key))
    .sort((a, b) => a.position - b.position)
    .map((c) => ({ value: c.key, label: c.name }));
  const filtered = FILTER_KEYS.some((k) => f.get(k));
  const statusList = f.list('status');
  const state = f.get('open') ? 'open' : statusList.length === CLOSED_STATUSES.length && CLOSED_STATUSES.every((s) => statusList.includes(s)) ? 'resolved' : statusList.length ? 'custom' : 'all';

  return (
    <>
      <PageHeader
        title="Findings"
        subtitle="Bugs, questions, ideas and observations captured during exploration — triage them, convert defects to issues, or turn them into regression tests."
        actions={
          <>
            <ExportMenu url={p(pid, '/findings/export')} params={params} name="findings" />
            {can('TESTER') && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                New finding
              </Button>
            )}
          </>
        }
      />

      <Paper withBorder p="sm" mb="md">
        <Group gap="xs" wrap="wrap" mb="xs">
          <SegmentedControl
            size="sm"
            value={state === 'custom' ? 'all' : state}
            onChange={(v) => f.set(v === 'open' ? { open: 'true', status: null } : v === 'resolved' ? { open: null, status: CLOSED_STATUSES } : { open: null, status: null })}
            data={[
              { value: 'all', label: 'All' },
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved / closed' },
            ]}
          />
          <SearchInput value={f.get('q')} onChange={(v) => f.set({ q: v })} placeholder="Search title, description, F-12…" />
          <MultiSelect
            aria-label="Classification"
            placeholder={f.list('classification').length ? undefined : 'Type'}
            data={classOptions}
            value={f.list('classification')}
            onChange={(v) => f.set({ classification: v, defects: null })}
            w={190}
            clearable
          />
          <MultiSelect aria-label="Severity" placeholder={f.list('severity').length ? undefined : 'Severity'} data={options(SEVERITY)} value={f.list('severity')} onChange={(v) => f.set({ severity: v })} w={160} clearable />
          <MultiSelect aria-label="Priority" placeholder={f.list('priority').length ? undefined : 'Priority'} data={options(PRIORITY)} value={f.list('priority')} onChange={(v) => f.set({ priority: v })} w={150} clearable />
          <MultiSelect
            aria-label="Status"
            placeholder={statusList.length || f.get('open') ? undefined : 'Status'}
            data={options(FINDING_STATUS)}
            value={f.get('open') ? [] : statusList}
            onChange={(v) => f.set({ status: v, open: null })}
            w={190}
            clearable
            disabled={!!f.get('open')}
          />
        </Group>
        <Group gap="xs" wrap="wrap">
          <Select
            aria-label="Owner"
            placeholder="Owner"
            data={[{ value: 'me', label: 'Owned by me' }, { value: 'none', label: 'No owner' }, ...memberOptions]}
            value={f.get('ownerId') || null}
            onChange={(v) => f.set({ ownerId: v })}
            w={160}
            clearable
            searchable
          />
          <Select
            aria-label="Reporter"
            placeholder="Reporter"
            data={[{ value: 'me', label: 'Reported by me' }, ...memberOptions]}
            value={f.get('authorId') || null}
            onChange={(v) => f.set({ authorId: v })}
            w={160}
            clearable
            searchable
          />
          <Select aria-label="Charter" placeholder="Charter" data={charterOptions} value={f.get('charterId') || null} onChange={(v) => f.set({ charterId: v })} w={200} clearable searchable />
          <Select aria-label="Requirement" placeholder="Requirement" data={requirementOptions} value={f.get('requirementId') || null} onChange={(v) => f.set({ requirementId: v })} w={200} clearable searchable />
          <Select aria-label="Milestone" placeholder="Milestone" data={milestoneOptions} value={f.get('milestoneId') || null} onChange={(v) => f.set({ milestoneId: v })} w={150} clearable />
          <Select aria-label="Tag" placeholder="Tag" data={tagNames} value={f.get('tag') || null} onChange={(v) => f.set({ tag: v })} w={130} clearable searchable />
          <DatePickerInput
            type="range"
            aria-label="Created between"
            placeholder="Created any time"
            value={[f.get('from') || null, f.get('to') || null]}
            onChange={([from, to]) => f.set({ from, to })}
            clearable
            w={230}
          />
          <Select
            aria-label="Sort"
            data={[
              { value: 'created', label: 'Newest first' },
              { value: 'updated', label: 'Recently updated' },
              { value: 'severity', label: 'Severity' },
              { value: 'number', label: 'Key (desc)' },
            ]}
            value={f.get('sort') || 'created'}
            onChange={(v) => f.set({ sort: v === 'created' ? null : v })}
            w={160}
            allowDeselect={false}
          />
          {f.get('sessionId') && (
            <Badge variant="light" size="lg" rightSection={<CloseButton size="xs" aria-label="Remove session filter" onClick={() => f.set({ sessionId: null })} />}>
              Session {session.data?.session?.key ?? '…'}
            </Badge>
          )}
          {f.get('defects') && (
            <Badge variant="light" color="red" size="lg" rightSection={<CloseButton size="xs" aria-label="Remove defects filter" onClick={() => f.set({ defects: null })} />}>
              Defects only
            </Badge>
          )}
          {filtered && (
            <Button variant="subtle" color="gray" leftSection={<IconFilterOff size={16} />} onClick={() => f.clear(['sort'])}>
              Clear
            </Button>
          )}
        </Group>
      </Paper>

      <QueryState query={q}>
        {(d: any) =>
          d.findings.length === 0 ? (
            <Paper withBorder>
              <EmptyState
                icon={<IconBulb size={26} />}
                title={filtered ? 'No findings match these filters' : 'No findings yet'}
                description={filtered ? 'Try removing a filter or searching for something else.' : 'Findings are usually captured in the session workbench while exploring. You can also log one directly.'}
                action={
                  filtered ? (
                    <Button variant="light" onClick={() => f.clear(['sort'])}>
                      Clear filters
                    </Button>
                  ) : (
                    can('TESTER') && (
                      <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                        New finding
                      </Button>
                    )
                  )
                }
              />
            </Paper>
          ) : (
            <>
              <Paper withBorder>
                <Table.ScrollContainer minWidth={1100}>
                  <Table highlightOnHover verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={70}>Key</Table.Th>
                        <Table.Th>Finding</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Severity</Table.Th>
                        <Table.Th>Priority</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Owner</Table.Th>
                        <Table.Th>Session</Table.Th>
                        <Table.Th>Issue</Table.Th>
                        <Table.Th>Created</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.findings.map((x: any) => (
                        <Table.Tr key={x.id}>
                          <Table.Td>
                            <Link to={`/projects/${pid}/findings/${x.id}`} className="ex-link ex-key">
                              {x.key}
                            </Link>
                          </Table.Td>
                          <Table.Td maw={380}>
                            <Link to={`/projects/${pid}/findings/${x.id}`} className="ex-link">
                              <Text size="sm" fw={600} lineClamp={2}>
                                {x.title}
                              </Text>
                            </Link>
                            <Group gap={6} mt={2}>
                              <Text size="xs" c="dimmed">
                                by {x.author?.name ?? 'unknown'}
                              </Text>
                              {x.requirement && (
                                <Tooltip label={x.requirement.title}>
                                  <Badge size="xs" variant="outline" color="gray">
                                    {x.requirement.key}
                                  </Badge>
                                </Tooltip>
                              )}
                              {x.tags.slice(0, 3).map((t: string) => (
                                <Badge key={t} size="xs" variant="light" color="gray">
                                  {t}
                                </Badge>
                              ))}
                              {x._count?.attachments > 0 && (
                                <Group gap={2} c="dimmed">
                                  <IconPaperclip size={12} />
                                  <Text size="xs">{x._count.attachments}</Text>
                                </Group>
                              )}
                              {x._count?.comments > 0 && (
                                <Group gap={2} c="dimmed">
                                  <IconMessage size={12} />
                                  <Text size="xs">{x._count.comments}</Text>
                                </Group>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <ClassificationBadge c={x.classification} />
                          </Table.Td>
                          <Table.Td>
                            <SeverityBadge value={x.severity} />
                          </Table.Td>
                          <Table.Td>
                            <PriorityBadge value={x.priority} />
                          </Table.Td>
                          <Table.Td>
                            <FindingStatusBadge value={x.status} variant="light" />
                          </Table.Td>
                          <Table.Td>
                            <UserLabel user={x.owner} fallback="—" />
                          </Table.Td>
                          <Table.Td>
                            {x.session ? (
                              <Tooltip label={x.session.title}>
                                <Link to={`/projects/${pid}/sessions/${x.session.id}`} className="ex-link ex-key">
                                  {x.session.key}
                                </Link>
                              </Tooltip>
                            ) : x.charter ? (
                              <Tooltip label={x.charter.title}>
                                <Link to={`/projects/${pid}/charters/${x.charter.id}`} className="ex-link ex-key">
                                  {x.charter.key}
                                </Link>
                              </Tooltip>
                            ) : (
                              <Text size="xs" c="dimmed">
                                —
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            {x.issue ? (
                              <Group gap={4} wrap="nowrap">
                                <Link to={`/projects/${pid}/issues/${x.issue.id}`} className="ex-link ex-key">
                                  {x.issue.key}
                                </Link>
                                <IssueStatusBadge value={x.issue.status} size="xs" variant="light" />
                              </Group>
                            ) : (
                              <Text size="xs" c="dimmed">
                                —
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td className="ex-nowrap">
                            <Tooltip label={fmtDateTime(x.createdAt)}>
                              <Text size="sm" c="dimmed">
                                {fromNow(x.createdAt)}
                              </Text>
                            </Tooltip>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Paper>
              <ListPager total={d.total} page={d.page} pageSize={d.pageSize} onChange={(page) => f.set({ page })} />
            </>
          )
        }
      </QueryState>

      <FindingFormModal
        opened={creating}
        onClose={() => setCreating(false)}
        onSaved={(x) => {
          toastOk(`${x.key} logged`);
          qc.invalidateQueries({ queryKey: ['findings', pid] });
          navigate(`/projects/${pid}/findings/${x.id}`);
        }}
      />
    </>
  );
}
