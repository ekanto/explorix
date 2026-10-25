import type { OrgRole, ProjectRole, Project } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  orgId: string;
  orgRole: OrgRole;
  preferences: Record<string, unknown>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      auth?: { type: 'session' | 'token'; sessionId?: string; tokenProjectId?: string | null };
      project?: Project;
      projectRole?: ProjectRole;
    }
  }
}

export {};
