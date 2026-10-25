import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Box, Button, Card, ColorInput, Group, Modal, SimpleGrid, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { IconPlus, IconSparkles } from '@tabler/icons-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/constants';
import { EmptyState, PageHeader, QueryState, toastError, toastOk } from '../components/ui';

type ProjectRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string;
  archivedAt: string | null;
  role?: string;
  counts: { charters: number; sessions: number; findings: number; testCases: number; members: number; openFindings: number; activeSessions: number };
};

function NewProjectModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ key: '', name: '', description: '', color: '#0f766e' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => api.post<{ project: { id: string } }>('/projects', { ...form, key: form.key.toUpperCase(), description: form.description || null }),
    onSuccess: ({ project }) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toastOk('Project created with default classifications, statuses and templates.');
      onClose();
      navigate(`/projects/${project.id}`);
    },
    onError: (e: any) => {
      setErrors(e?.fieldErrors ?? {});
      toastError(e);
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="New project">
      <Stack>
        <TextInput label="Name" required value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} />
        <TextInput
          label="Key"
          description="Short prefix used in issue keys, e.g. SHOP-42"
          required
          maxLength={10}
          value={form.key}
          error={errors.key}
          onChange={(e) => setForm({ ...form, key: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
        />
        <Textarea label="Description" autosize minRows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.currentTarget.value })} />
        <ColorInput label="Color" value={form.color} onChange={(color) => setForm({ ...form, color })} format="hex" />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name || !form.key}>
            Create project
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Creates a fully populated demo project so a fresh workspace can be explored immediately. */
export function SampleProjectButton({ variant = 'light' }: { variant?: 'light' | 'default' | 'filled' }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => api.post<{ project: { id: string; name: string } }>('/admin/sample-project'),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toastOk(`Sample project “${d.project.name}” created`);
      navigate(`/projects/${d.project.id}`);
    },
    onError: (e) => toastError(e, 'Could not create the sample project'),
  });
  return (
    <Button variant={variant} leftSection={<IconSparkles size={16} />} loading={m.isPending} onClick={() => m.mutate()}>
      Load sample project
    </Button>
  );
}

export default function Projects() {
  const { isOrgAdmin } = useAuth();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['projects', 'full', includeArchived],
    queryFn: () => api.get<{ projects: ProjectRow[] }>('/projects', { includeArchived: includeArchived || undefined }),
  });
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Projects you are a member of. Each project has its own members, charters, sessions, test cases and configuration."
        actions={
          <>
            <Switch label="Show archived" checked={includeArchived} onChange={(e) => setIncludeArchived(e.currentTarget.checked)} />
            {isOrgAdmin && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
                New project
              </Button>
            )}
          </>
        }
      />
      <QueryState query={q}>
        {(d) =>
          d.projects.length === 0 ? (
            isOrgAdmin ? (
              <EmptyState
                title="No projects yet"
                description="Create your first project, or load a sample project with charters, sessions, findings and evidence to explore Explorix."
                action={
                  <Group>
                    <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen(true)}>
                      New project
                    </Button>
                    <SampleProjectButton variant="default" />
                  </Group>
                }
              />
            ) : (
              <EmptyState title="No projects yet" description="Ask an organization admin to add you to a project." />
            )
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {d.projects.map((pr) => (
                <Card key={pr.id} component={Link} to={`/projects/${pr.id}`} padding="lg" style={{ borderTop: `4px solid ${pr.color}` }}>
                  <Group justify="space-between" mb={4}>
                    <Text fw={700}>{pr.name}</Text>
                    <Group gap={4}>
                      {pr.archivedAt && <Badge color="gray">Archived</Badge>}
                      <Badge variant="outline" color="gray">
                        {pr.key}
                      </Badge>
                    </Group>
                  </Group>
                  <Text size="sm" c="dimmed" lineClamp={2} mih={40}>
                    {pr.description || 'No description'}
                  </Text>
                  <SimpleGrid cols={3} mt="md" spacing={6}>
                    {[
                      ['Charters', pr.counts.charters],
                      ['Sessions', pr.counts.sessions],
                      ['Active', pr.counts.activeSessions],
                      ['Findings', pr.counts.findings],
                      ['Open', pr.counts.openFindings],
                      ['Test cases', pr.counts.testCases],
                    ].map(([l, v]) => (
                      <Box key={l as string}>
                        <Text fw={700}>{v}</Text>
                        <Text size="xs" c="dimmed">
                          {l}
                        </Text>
                      </Box>
                    ))}
                  </SimpleGrid>
                  <Text size="xs" c="dimmed" mt="sm">
                    Your role: {pr.role ? ROLE_LABEL[pr.role] : '—'} · {pr.counts.members} members
                  </Text>
                </Card>
              ))}
            </SimpleGrid>
          )
        }
      </QueryState>
      <NewProjectModal opened={open} onClose={() => setOpen(false)} />
    </>
  );
}
