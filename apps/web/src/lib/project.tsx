import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { ROLE_RANK } from './constants';
import { useAuth } from './auth';

export type Member = { id: string; role: string; user: { id: string; name: string; email: string; avatarColor: string; deactivatedAt: string | null } };
export type Milestone = { id: string; name: string; status: string; dueDate: string | null; startDate: string | null; description: string | null };
export type Environment = { id: string; name: string; url: string | null; browser: string | null; os: string | null; device: string | null; description: string | null };
export type Tag = { id: string; name: string; color: string | null };
export type CustomField = {
  id: string;
  entity: 'CHARTER' | 'SESSION' | 'FINDING' | 'TEST_CASE' | 'ISSUE';
  key: string;
  label: string;
  type: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'CHECKBOX' | 'DATE' | 'URL';
  options: string[];
  required: boolean;
  helpText: string | null;
  position: number;
  archivedAt: string | null;
};
export type Classification = { id: string; key: string; name: string; color: string; isDefect: boolean; shortcut: string | null; position: number; archivedAt?: string | null };
export type ResultStatus = { id: string; key: string; name: string; color: string; category: string; scope: string; position: number; isSystem: boolean };
export type ProjectSettings = { requireReview: boolean; allowSelfReview: boolean; lockCompletedSessions: boolean; defaultTimeboxMinutes: number; allowTesterCharterEdit: boolean };
export type Project = { id: string; key: string; name: string; description: string | null; color: string; archivedAt: string | null; settings: ProjectSettings };

export type ProjectConfig = {
  project: Project;
  role: 'ADMIN' | 'LEAD' | 'TESTER' | 'VIEWER';
  members: Member[];
  milestones: Milestone[];
  environments: Environment[];
  tags: Tag[];
  customFields: CustomField[];
  classifications: Classification[];
  statuses: ResultStatus[];
};

type Ctx = ProjectConfig & {
  pid: string;
  /** True when the current user has at least `role` in this project. */
  can: (role: 'VIEWER' | 'TESTER' | 'LEAD' | 'ADMIN') => boolean;
  readOnly: boolean;
  memberOptions: { value: string; label: string }[];
  milestoneOptions: { value: string; label: string }[];
  environmentOptions: { value: string; label: string }[];
  tagNames: string[];
  fieldsFor: (entity: CustomField['entity']) => CustomField[];
};

const ProjectContext = createContext<Ctx | null>(null);

export const projectKey = (pid: string) => ['project', pid] as const;

export function useProjectConfig(pid: string | undefined) {
  return useQuery({
    queryKey: projectKey(pid ?? ''),
    queryFn: () => api.get<ProjectConfig>(`/projects/${pid}`),
    enabled: !!pid,
    staleTime: 30_000,
  });
}

export function ProjectProvider({ config, children }: { config: ProjectConfig; children: ReactNode }) {
  const { user } = useAuth();
  const role = config.role;
  const value: Ctx = {
    ...config,
    pid: config.project.id,
    can: (r) => (ROLE_RANK[role] ?? 0) >= ROLE_RANK[r] && (!config.project.archivedAt || r === 'VIEWER'),
    readOnly: !!config.project.archivedAt || role === 'VIEWER',
    memberOptions: config.members
      .filter((m) => !m.user.deactivatedAt)
      .map((m) => ({ value: m.user.id, label: m.user.id === user?.id ? `${m.user.name} (me)` : m.user.name })),
    milestoneOptions: config.milestones.map((m) => ({ value: m.id, label: m.status === 'RELEASED' ? `${m.name} (released)` : m.name })),
    environmentOptions: config.environments.map((e) => ({ value: e.id, label: e.name })),
    tagNames: config.tags.map((t) => t.name),
    fieldsFor: (entity) => config.customFields.filter((f) => f.entity === entity && !f.archivedAt).sort((a, b) => a.position - b.position),
  };
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside a project route');
  return ctx;
}

/** Same as useProject but returns null outside a project route (for global layout). */
export function useOptionalProject() {
  return useContext(ProjectContext);
}
