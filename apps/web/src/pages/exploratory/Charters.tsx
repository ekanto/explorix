import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Avatar, Badge, Button, Group, Menu, MultiSelect, Paper, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArchive, IconArrowBackUp, IconCopy, IconDots, IconEdit, IconFilterOff, IconPlayerPlay, IconPlus, IconTargetArrow, IconTemplate } from '@tabler/icons-react';
import { api, p } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { CHARTER_STATUS, options, PRIORITY, RISK } from '../../lib/constants';
import { duration, fmtDateTime, fromNow, minutes } from '../../lib/format';
import { useProject } from '../../lib/project';
import { LaunchSessionModal } from '../../components/LaunchSessionModal';
import { ListPager, SearchInput, useUrlFilters } from '../../components/ListFilters';
import { CharterStatusBadge, EmptyState, PageHeader, PriorityBadge, QueryState, toastError, toastOk, UserAvatar } from '../../components/ui';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['q', 'status', 'priority', 'riskLevel', 'milestoneId', 'assigneeId', 'tag'];

export default function Charters() {
  const { pid, can, project, milestoneOptions, memberOptions, tagNames } = useProject();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const f = useUrlFilters();
  const [launch, setLaunch] = useState<any | null>(null);

  const params = {
    q: f.get('q'),
    status: f.list('status'),
    priority: f.list('priority'),
    riskLevel: f.list('riskLevel'),
    milestoneId: f.get('milestoneId'),
    assigneeId: f.get('assigneeId'),
    tag: f.get('tag'),
    sort: f.get('sort'),
    page: f.page,
    pageSize: PAGE_SIZE,
  };
  const q = useQuery({ queryKey: ['charters', pid, params], queryFn: () => api.get(p(pid, '/charters'), params), placeholderData: (prev) => prev });
  const filtered = FILTER_KEYS.some((k) => f.get(k));

  const canEdit = (c: any) => can('LEAD') || (can('TESTER') && (c.createdById === user?.id || project.settings.allowTesterCharterEdit));
  const canArchive = (c: any) => can('LEAD') || (can('TESTER') && c.createdById === user?.id);
  const refresh = () => qc.invalidateQueries({ queryKey: ['charters', pid] });

  const duplicate = async (c: any) => {
    try {
      const r = await api.post(p(pid, `/charters/${c.id}/duplicate`));
      toastOk(`Created ${r.charter.key} as a draft copy`);
      refresh();
      navigate(`/projects/${pid}/charters/${r.charter.id}/edit`);
    } catch (e) {
      toastError(e, 'Could not duplicate charter');
    }
  };

  const archive = (c: any, action: 'archive' | 'unarchive') => {
    const run = async () => {
      try {
        await api.post(p(pid, `/charters/${c.id}/${action}`));
        toastOk(action === 'archive' ? `${c.key} archived` : `${c.key} restored as Ready`);
        refresh();
      } catch (e) {
        toastError(e);
      }
    };
    if (action === 'unarchive') return void run();
    modals.openConfirmModal({
      title: `Archive ${c.key}?`,
      children: <Text size="sm">Archived charters are hidden from the library and cannot launch new sessions. Existing sessions and findings are kept. You can unarchive it later.</Text>,
      labels: { confirm: 'Archive', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: run,
    });
  };

  return (
    <>
      <PageHeader
        title="Charters"
        subtitle="Missions that guide exploratory sessions. Launch a charter as often as needed — each launch is an independent session."
        actions={
          <>
            <Button variant="default" leftSection={<IconTemplate size={16} />} component={Link} to={`/projects/${pid}/templates`}>
              Templates
            </Button>
            {can('TESTER') && (
              <Button leftSection={<IconPlus size={16} />} component={Link} to={`/projects/${pid}/charters/new`}>
                New charter
              </Button>
            )}
          </>
        }
      />

      <Paper withBorder p="sm" mb="md">
        <Group gap="xs" wrap="wrap">
          <SearchInput value={f.get('q')} onChange={(v) => f.set({ q: v })} placeholder="Search title, mission, CH-12…" />
          <MultiSelect
            aria-label="Status"
            placeholder={f.list('status').length ? undefined : 'Draft + Ready'}
            data={options(CHARTER_STATUS)}
            value={f.list('status')}
            onChange={(v) => f.set({ status: v })}
            w={220}
            clearable
          />
          <MultiSelect aria-label="Priority" placeholder={f.list('priority').length ? undefined : 'Priority'} data={options(PRIORITY)} value={f.list('priority')} onChange={(v) => f.set({ priority: v })} w={160} clearable />
          <MultiSelect aria-label="Risk level" placeholder={f.list('riskLevel').length ? undefined : 'Risk'} data={options(RISK)} value={f.list('riskLevel')} onChange={(v) => f.set({ riskLevel: v })} w={160} clearable />
          <Select aria-label="Milestone" placeholder="Milestone" data={milestoneOptions} value={f.get('milestoneId') || null} onChange={(v) => f.set({ milestoneId: v })} w={170} clearable />
          <Select
            aria-label="Assignee"
            placeholder="Assignee"
            data={[{ value: 'me', label: 'Assigned to me' }, ...memberOptions]}
            value={f.get('assigneeId') || null}
            onChange={(v) => f.set({ assigneeId: v })}
            w={180}
            clearable
            searchable
          />
          <Select aria-label="Tag" placeholder="Tag" data={tagNames} value={f.get('tag') || null} onChange={(v) => f.set({ tag: v })} w={140} clearable searchable />
          <Select
            aria-label="Sort"
            data={[
              { value: 'updated', label: 'Recently updated' },
              { value: 'created', label: 'Newest first' },
              { value: 'number', label: 'Key (desc)' },
              { value: 'title', label: 'Title A–Z' },
            ]}
            value={f.get('sort') || 'updated'}
            onChange={(v) => f.set({ sort: v === 'updated' ? null : v })}
            w={170}
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
          d.charters.length === 0 ? (
            <Paper withBorder>
              <EmptyState
                icon={<IconTargetArrow size={26} />}
                title={filtered ? 'No charters match these filters' : 'No charters yet'}
                description={
                  filtered
                    ? 'Try removing a filter or searching for something else.'
                    : 'A charter states what to explore, how, and what information you hope to find. Start from a template or write your own mission.'
                }
                action={
                  filtered ? (
                    <Button variant="light" onClick={() => f.clear(['sort'])}>
                      Clear filters
                    </Button>
                  ) : (
                    can('TESTER') && (
                      <Group gap="xs">
                        <Button component={Link} to={`/projects/${pid}/charters/new`} leftSection={<IconPlus size={16} />}>
                          New charter
                        </Button>
                        <Button variant="default" component={Link} to={`/projects/${pid}/templates`}>
                          Browse templates
                        </Button>
                      </Group>
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
                        <Table.Th w={80}>Key</Table.Th>
                        <Table.Th>Charter</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Priority</Table.Th>
                        <Table.Th>Risk</Table.Th>
                        <Table.Th>Assignees</Table.Th>
                        <Table.Th>Sessions</Table.Th>
                        <Table.Th>Time</Table.Th>
                        <Table.Th>Updated</Table.Th>
                        <Table.Th w={40} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.charters.map((c: any) => (
                        <Table.Tr key={c.id}>
                          <Table.Td>
                            <Link to={`/projects/${pid}/charters/${c.id}`} className="ex-link ex-key">
                              {c.key}
                            </Link>
                          </Table.Td>
                          <Table.Td miw={280} maw={420}>
                            <Link to={`/projects/${pid}/charters/${c.id}`} className="ex-link">
                              <Text size="sm" fw={600} lineClamp={1}>
                                {c.title}
                              </Text>
                            </Link>
                            <Text size="xs" c="dimmed" lineClamp={2}>
                              {c.mission}
                            </Text>
                            {(c.milestone || c.tags.length > 0) && (
                              <Group gap={4} mt={4}>
                                {c.milestone && (
                                  <Badge size="xs" variant="outline" color="gray">
                                    {c.milestone.name}
                                  </Badge>
                                )}
                                {c.tags.slice(0, 4).map((t: string) => (
                                  <Badge key={t} size="xs" variant="light" color="gray">
                                    {t}
                                  </Badge>
                                ))}
                              </Group>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <CharterStatusBadge value={c.status} variant="light" />
                          </Table.Td>
                          <Table.Td>
                            <PriorityBadge value={c.priority} />
                          </Table.Td>
                          <Table.Td>
                            <PriorityBadge value={c.riskLevel} variant="light" />
                          </Table.Td>
                          <Table.Td>
                            {c.assignees.length ? (
                              <Avatar.Group spacing="xs">
                                {c.assignees.slice(0, 4).map((a: any) => (
                                  <UserAvatar key={a.id} user={a} size={26} />
                                ))}
                                {c.assignees.length > 4 && (
                                  <Avatar size={26} radius="xl">
                                    +{c.assignees.length - 4}
                                  </Avatar>
                                )}
                              </Avatar.Group>
                            ) : (
                              <Text size="xs" c="dimmed">
                                —
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td className="ex-nowrap">
                            <Tooltip label={`${c.sessionCounts.active} active · ${c.sessionCounts.completed} completed · ${c.findingsCount} findings`}>
                              <Stack gap={0}>
                                <Text size="sm">{c.sessionCounts.total}</Text>
                                <Text size="xs" c="dimmed">
                                  {c.sessionCounts.active ? `${c.sessionCounts.active} active` : `${c.findingsCount} findings`}
                                </Text>
                              </Stack>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td className="ex-nowrap">
                            <Text size="sm">{minutes(c.timeboxMinutes)} box</Text>
                            {c.actualSeconds > 0 && (
                              <Text size="xs" c="dimmed">
                                {duration(c.actualSeconds)} spent
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td className="ex-nowrap">
                            <Tooltip label={fmtDateTime(c.updatedAt)}>
                              <Text size="sm" c="dimmed">
                                {fromNow(c.updatedAt)}
                              </Text>
                            </Tooltip>
                          </Table.Td>
                          <Table.Td>
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${c.key}`}>
                                  <IconDots size={16} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                {can('TESTER') && c.status !== 'ARCHIVED' && (
                                  <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => setLaunch(c)}>
                                    Launch session
                                  </Menu.Item>
                                )}
                                {canEdit(c) && c.status !== 'ARCHIVED' && (
                                  <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => navigate(`/projects/${pid}/charters/${c.id}/edit`)}>
                                    Edit
                                  </Menu.Item>
                                )}
                                {can('TESTER') && (
                                  <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => duplicate(c)}>
                                    Duplicate
                                  </Menu.Item>
                                )}
                                {canArchive(c) &&
                                  (c.status === 'ARCHIVED' ? (
                                    <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => archive(c, 'unarchive')}>
                                      Unarchive
                                    </Menu.Item>
                                  ) : (
                                    <Menu.Item leftSection={<IconArchive size={14} />} color="red" onClick={() => archive(c, 'archive')}>
                                      Archive
                                    </Menu.Item>
                                  ))}
                                {!can('TESTER') && <Menu.Label>Read-only access</Menu.Label>}
                              </Menu.Dropdown>
                            </Menu>
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

      <LaunchSessionModal
        opened={!!launch}
        onClose={() => setLaunch(null)}
        charter={launch}
        onLaunched={(s) => {
          refresh();
          qc.invalidateQueries({ queryKey: ['sessions', pid] });
          navigate(`/projects/${pid}/sessions/${s.id}`);
        }}
      />
    </>
  );
}
