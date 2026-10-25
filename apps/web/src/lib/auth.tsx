import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from './api';

export type Me = {
  id: string;
  email: string;
  name: string;
  avatarColor: string;
  orgRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  preferences: { theme?: 'light' | 'dark' | 'auto'; emailNotifications?: boolean; lastProjectId?: string };
};

export type UploadLimits = { otherBytes: number; imageBytes: number; videoBytes: number };
type MeResponse = { user: Me; org: AuthState['org']; desktop?: boolean; uploadLimits?: UploadLimits };

type AuthState = {
  user: Me | null;
  org: { id: string; name: string; slug: string } | null;
  uploadLimits: UploadLimits;
  loading: boolean;
  isOrgAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  setup: (body: { orgName: string; name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (qc.getQueryData(['me'])) {
        qc.setQueryData(['me'], null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      }
    });
  }, [qc]);

  const adopt = async () => {
    const fresh = await api.get<MeResponse>('/auth/me');
    // Drop everything cached for a previous user, but keep the ['me'] query (and its observer) alive.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.setQueryData(['me'], fresh);
  };

  const value: AuthState = {
    user: me.data?.user ?? null,
    org: me.data?.org ?? null,
    uploadLimits: me.data?.uploadLimits ?? { otherBytes: 15 * 1048576, imageBytes: 15 * 1048576, videoBytes: 15 * 1048576 },
    loading: me.isLoading,
    isOrgAdmin: me.data?.user.orgRole === 'OWNER' || me.data?.user.orgRole === 'ADMIN',
    login: async (email, password) => {
      await api.post('/auth/login', { email, password });
      await adopt();
    },
    setup: async (body) => {
      await api.post('/auth/setup', body);
      await adopt();
    },
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
    },
    refresh: () => me.refetch(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
