import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Badge, Button, Group, MultiSelect, Paper, SegmentedControl, Select, Table, Text, Tooltip } from '@mantine/core';
import { IconBug, IconExternalLink, IconFilterOff, IconMessage, IconPlus } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { ISSUE_STATUS, options, PRIORITY, SEVERITY } from '../../lib/constants';
import { fmtDateTime, fromNow } from '../../lib/format';
import { useProject } from '../../lib/project';
import { ExportMenu } from '../../components/ExportMenu';
import { IssueFormModal } from '../../components/IssueForm';
import { ListPager, SearchInput, useUrlFilters } from '../../components/ListFilters';
import { EmptyState, IssueStatusBadge, PageHeader, PriorityBadge, QueryState, SeverityBadge, toastOk, UserLabel } from '../../components/ui';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['q', 'status', 'open', 'priority', 'severity', 'assigneeId', 'milestoneId'];

export default function Issues() {
  const { pid, can, memberOptions, milestoneOptions } = useProject();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const f = useUrlFilters();
  const [creating, setCreating] = useState(false);

  const params: Record<string, string | undefined> = {
    q: f.get('q') || undefined,
    status: f.get('status') || undefined,
    open: f.get('open') || undefined,
    priority: f.get('priority') || undefined,
    severity: f.get('severity') || undefined,
    assigneeId: f.get('assigneeId') || undefined,
    milestoneId: f.get('milestoneId') || undefined,
  };
  const listParams = { ...params, sort: f.get('sort') || undefined, page: f.page, pageSize: PAGE_SIZE };
  const q = useQuery({ queryKey: ['issues', pid, listParams], queryFn: () => api.get(p(pid, '/issues'), listParams), placeholderData: (prev) => prev });
  const filtered = FILTER_KEYS.some((k) => f.get(k));

  return (
    <>
      <PageHeader
        title="Issues"
        subtitle="Internal defect tracker. Issues are usually created from findings and keep the link back to the session evidence."
        actions={
          <>
            <ExportMenu url={p(pid, '/issues/export')} params={params} name="issues" />
            {can('TESTER') && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                New issue
              </Button>
            )}
          </>
        }
      />

      <Paper withBorder p="sm" mb="md">
        <Group gap="xs" wrap="wrap">
          <SegmentedControl
            size="sm"
            value={f.get('open') ? 'open' : 'all'}
            onChange={(v) => f.set(v === 'open' ? { open: 'true', status: null } : { open: null })}
            data={[
              { value: 'all', label: 'All' },
              { value: 'open', label: 'Open' },
            ]}
          />
          <SearchInput value={f.get('q')} onChange={(v) => f.set({ q: v })} placeholder="Search title, description, key…" />
          <MultiSelect
            aria-label="Status"
            placeholder={f.list('status').length || f.get('open') ? undefined : 'Status'}
            data={options(ISSUE_STATUS)}
            value={f.get('open') ? [] : f.list('status')}
            onChange={(v) => f.set({ status: v, open: null })}
            disabled={!!f.get('open')}
            w={200}
            clearable
          />
          <MultiSelect aria-label="Severity" placeholder={f.list('severity').length ? undefined : 'Severity'} data={options(SEVERITY)} value={f.list('severity')} onChange={(v) => f.set({ severity: v })} w={160} clearable />
          <MultiSelect aria-label="Priority" placeholder={f.list('priority').length ? undefined : 'Priority'} data={options(PRIORITY)} value={f.list('priority')} onChange={(v) => f.set({ priority: v })} w={150} clearable />
          <Select
            aria-label="Assignee"
            placeholder="Assignee"
            data={[{ value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Unassigned' }, ...memberOptions]}
            value={f.get('assigneeId') || null}
            onChange={(v) => f.set({ assigneeId: v })}
            w={170}
            clearable
            searchable
          />
          <Select aria-label="Milestone" placeholder="Milestone" data={milestoneOptions} value={f.get('milestoneId') || null} onChange={(v) => f.set({ milestoneId: v })} w={160} clearable />
          <Select
            aria-label="Sort"
            data={[
              { value: 'number', label: 'Newest key' },
              { value: 'updated', label: 'Recently updated' },
              { value: 'severity', label: 'Severity' },
            ]}
            value={f.get('sort') || 'number'}
            onChange={(v) => f.set({ sort: v === 'number' ? null : v })}
            w={160}
            allowDeselect={false}
          />
          {filtered && (
            <Button variant="subtle" color="gray" leftSection={<IconFilterOff size={16} />} onClick={() => f.clear(['sort'])}>
              Clear
            </Button>
          )}
        </Group>
      </Paper>

      <QueryState query={q}>
        {(d: any) =>
          d.issues.length === 0 ? (
            <Paper withBorder>
              <EmptyState
                icon={<IconBug size={26} />}
                title={filtered ? 'No issues match these filters' : 'No issues yet'}
                description={
                  filtered ? (
                    'Try removing a filter or searching for something else.'
                  ) : (
                    <>
                      Convert a defect finding into an issue from its finding page, or create one directly.{' '}
                      <Anchor component={Link} to={`/projects/${pid}/findings?open=true&defects=true`} size="sm">
                        Open defect findings
                      </Anchor>
                    </>
                  )
                }
                action={
                  filtered ? (
                    <Button variant="light" onClick={() => f.clear(['sort'])}>
                      Clear filters
                    </Button>
                  ) : (
                    can('TESTER') && (
                      <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                        New issue
                      </Button>
                    )
                  )
                }
              />
            </Paper>
          ) : (
            <>
              <Paper withBorder>
                <Table.ScrollContainer minWidth={1000}>
                  <Table highlightOnHover verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={90}>Key</Table.Th>
                        <Table.Th>Issue</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Severity</Table.Th>
                        <Table.Th>Priority</Table.Th>
                        <Table.Th>Assignee</Table.Th>
                        <Table.Th>Source</Table.Th>
                        <Table.Th>Updated</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.issues.map((i: any) => (
                        <Table.Tr key={i.id}>
                          <Table.Td>
                            <Link to={`/projects/${pid}/issues/${i.id}`} className="ex-link ex-key">
                              {i.key}
                            </Link>
                          </Table.Td>
                          <Table.Td maw={420}>
                            <Link to={`/projects/${pid}/issues/${i.id}`} className="ex-link">
                              <Text size="sm" fw={600} lineClamp={2}>
                                {i.title}
                              </Text>
                            </Link>
                            <Group gap={6} mt={2}>
                              <Text size="xs" c="dimmed">
                                by {i.reporter?.name ?? 'unknown'}
                              </Text>
                              {i.milestone && (
                                <Badge size="xs" variant="outline" color="gray">
                                  {i.milestone.name}
                                </Badge>
                              )}
                              {i._count.findings > 0 && (
                                <Badge size="xs" variant="light" color="violet">
                                  {i._count.findings} finding{i._count.findings === 1 ? '' : 's'}
                                </Badge>
                              )}
                              {i._count.testResults + i._count.automationResults > 0 && (
                                <Badge size="xs" variant="light" color="orange">
                                  {i._count.testResults + i._count.automationResults} test result{i._count.testResults + i._count.automationResults === 1 ? '' : 's'}
                                </Badge>
                              )}
                              {i._count.comments > 0 && (
                                <Group gap={2} c="dimmed">
                                  <IconMessage size={12} />
                                  <Text size="xs">{i._count.comments}</Text>
                                </Group>
                              )}
                              {i.externalUrl && (
                                <Anchor href={i.externalUrl} target="_blank" rel="noreferrer" size="xs" onClick={(e) => e.stopPropagation()}>
                                  <Group gap={2}>
                                    <IconExternalLink size={12} />
                                    {i.externalKey ?? 'external'}
                                  </Group>
                                </Anchor>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <IssueStatusBadge value={i.status} variant="light" />
                          </Table.Td>
                          <Table.Td>
                            <SeverityBadge value={i.severity} />
                          </Table.Td>
                          <Table.Td>
                            <PriorityBadge value={i.priority} />
                          </Table.Td>
                          <Table.Td>
                            <UserLabel user={i.assignee} />
                          </Table.Td>
                          <Table.Td>
                            {i.sourceFinding ? (
                              <Tooltip label={i.sourceFinding.title}>
                                <Link to={`/projects/${pid}/findings/${i.sourceFinding.id}`} className="ex-link ex-key">
                                  {i.sourceFinding.key}
                                </Link>
                              </Tooltip>
                            ) : (
                              <Text size="xs" c="dimmed">
                                Manual
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Tooltip label={fmtDateTime(i.updatedAt)}>
                              <Text size="sm" c="dimmed">
                                {fromNow(i.updatedAt)}
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

      <Text size="xs" c="dimmed" mt="md">
        External trackers: GitHub push is available per issue when a GitHub integration is enabled. Jira / GitLab sync: planned.
      </Text>

      <IssueFormModal
        opened={creating}
        onClose={() => setCreating(false)}
        onSaved={(i) => {
          toastOk(`Created ${i.key}`);
          qc.invalidateQueries({ queryKey: ['issues', pid] });
          navigate(`/projects/${pid}/issues/${i.id}`);
        }}
      />
    </>
  );
}
