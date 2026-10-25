import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Group, Pagination, Paper, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core';
import { api } from '../lib/api';
import { fmtDateTime, fromNow, titleCase } from '../lib/format';
import { EmptyState, PageHeader, QueryState, UserAvatar } from '../components/ui';

export default function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['notifications', 'page', filter, page],
    queryFn: () => api.get('/notifications', { unread: filter === 'unread' || undefined, page, pageSize: 25 }),
  });
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api.post('/notifications/read', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Mentions, assignments, review requests and decisions."
        actions={
          <>
            <SegmentedControl
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              data={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: 'Unread' },
              ]}
            />
            <Button variant="default" onClick={() => read.mutate({ all: true })}>
              Mark all read
            </Button>
          </>
        }
      />
      <QueryState query={q}>
        {(d: any) =>
          d.items.length === 0 ? (
            <EmptyState title="No notifications" />
          ) : (
            <Stack gap="xs">
              {d.items.map((n: any) => (
                <Paper key={n.id} withBorder p="sm" bg={n.readAt ? undefined : 'var(--ex-subtle)'}>
                  <UnstyledButton
                    w="100%"
                    onClick={() => {
                      if (!n.readAt) read.mutate({ ids: [n.id] });
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <Group wrap="nowrap" align="flex-start">
                      <UserAvatar user={n.actor} />
                      <Stack gap={2} style={{ flex: 1 }}>
                        <Group gap={6}>
                          <Badge size="xs" variant="outline">
                            {titleCase(n.type)}
                          </Badge>
                          {n.project && (
                            <Text size="xs" c="dimmed">
                              {n.project.key}
                            </Text>
                          )}
                          {!n.readAt && (
                            <Badge size="xs" color="amber.5" variant="filled">
                              New
                            </Badge>
                          )}
                        </Group>
                        <Text size="sm" fw={n.readAt ? 400 : 600}>
                          {n.title}
                        </Text>
                        {n.body && (
                          <Text size="sm" c="dimmed" className="ex-prewrap">
                            {n.body}
                          </Text>
                        )}
                      </Stack>
                      <Text size="xs" c="dimmed" title={fmtDateTime(n.createdAt)}>
                        {fromNow(n.createdAt)}
                      </Text>
                    </Group>
                  </UnstyledButton>
                </Paper>
              ))}
              {d.total > d.pageSize && <Pagination total={Math.ceil(d.total / d.pageSize)} value={page} onChange={setPage} mt="sm" />}
            </Stack>
          )
        }
      </QueryState>
    </>
  );
}
