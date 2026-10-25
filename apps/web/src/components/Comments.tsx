import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionIcon, Button, Group, MultiSelect, Paper, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { api, p } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fromNow, fmtDateTime } from '../lib/format';
import { useProject } from '../lib/project';
import { Loading, UserAvatar, toastError } from './ui';

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; name: string; avatarColor: string };
  mentions: { id: string; name: string }[];
};

/** Threaded comments with @mentions (explicit picker → server sends notifications). */
export function Comments({ targetType, targetId }: { targetType: 'charter' | 'session' | 'finding' | 'issue' | 'testCase'; targetId: string }) {
  const { pid, memberOptions, can } = useProject();
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['comments', pid, targetType, targetId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ comments: Comment[] }>(p(pid, '/comments'), { targetType, targetId }) });
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  const add = useMutation({
    mutationFn: () => api.post(p(pid, '/comments'), { targetType, targetId, body, mentions }),
    onSuccess: () => {
      setBody('');
      setMentions([]);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(p(pid, `/comments/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toastError(e),
  });

  return (
    <Stack gap="sm">
      {q.isLoading && <Loading />}
      {q.data?.comments.length === 0 && (
        <Text size="sm" c="dimmed">
          No comments yet.
        </Text>
      )}
      {q.data?.comments.map((c) => (
        <Paper key={c.id} p="sm" withBorder className="ex-fade-in">
          <Group justify="space-between" mb={4} wrap="nowrap">
            <Group gap={8}>
              <UserAvatar user={c.author} size={22} />
              <Text size="sm" fw={600}>
                {c.author.name}
              </Text>
              <Tooltip label={fmtDateTime(c.createdAt)}>
                <Text size="xs" c="dimmed">
                  {fromNow(c.createdAt)}
                  {c.editedAt ? ' · edited' : ''}
                </Text>
              </Tooltip>
            </Group>
            {(c.author.id === user?.id || can('LEAD')) && (
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Delete comment" onClick={() => del.mutate(c.id)}>
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
          <Text size="sm" className="ex-prewrap">
            {c.body}
          </Text>
          {c.mentions.length > 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              Mentioned: {c.mentions.map((m) => `@${m.name}`).join(', ')}
            </Text>
          )}
        </Paper>
      ))}
      {can('VIEWER') && (
        <Stack gap={6}>
          <Textarea
            placeholder="Add a comment…"
            aria-label="New comment"
            autosize
            minRows={2}
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) add.mutate();
            }}
          />
          <Group justify="space-between" align="flex-end">
            <MultiSelect
              size="xs"
              placeholder="@mention teammates"
              data={memberOptions.filter((m) => m.value !== user?.id)}
              value={mentions}
              onChange={setMentions}
              searchable
              clearable
              style={{ flex: 1, maxWidth: 360 }}
              aria-label="Mention teammates"
            />
            <Button size="xs" onClick={() => add.mutate()} loading={add.isPending} disabled={!body.trim()}>
              Comment
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
