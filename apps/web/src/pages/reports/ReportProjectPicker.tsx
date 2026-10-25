import { Link, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, SimpleGrid, Text } from '@mantine/core';
import { api } from '../../lib/api';
import { EmptyState, PageHeader, QueryState } from '../../components/ui';

/** `/reports/new` (desktop menu): continue in the last project, or ask which project to report on. */
export default function ReportProjectPicker() {
  const q = useQuery({ queryKey: ['projects', 'picker'], queryFn: () => api.get<{ projects: { id: string; key: string; name: string; color: string }[] }>('/projects') });
  const last = localStorage.getItem('explorix.lastProject');
  if (q.data) {
    const list = q.data.projects;
    const target = list.find((pr) => pr.id === last) ?? (list.length === 1 ? list[0] : undefined);
    if (target) return <Navigate to={`/projects/${target.id}/reports/new`} replace />;
  }
  return (
    <>
      <PageHeader title="New report" subtitle="Choose the project to report on." />
      <QueryState query={q}>
        {(d) =>
          d.projects.length === 0 ? (
            <EmptyState title="No projects yet" description="Create a project and record some findings before generating a report." />
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {d.projects.map((pr) => (
                <Card key={pr.id} component={Link} to={`/projects/${pr.id}/reports/new`} padding="md" style={{ borderTop: `4px solid ${pr.color}` }}>
                  <Text fw={700}>{pr.name}</Text>
                  <Text size="xs" c="dimmed">
                    {pr.key}
                  </Text>
                </Card>
              ))}
            </SimpleGrid>
          )
        }
      </QueryState>
    </>
  );
}
