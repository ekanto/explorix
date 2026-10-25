import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type AiStatus = { enabled: boolean; provider: string; model: string | null; isMock: boolean; misconfigured: boolean; setupInstructions: string | null };
export type AiMeta = { provider: string; model: string; isMock: boolean; generatedAt: string; reviewRequired: true };

/** Server-side AI configuration. AI is optional; callers must degrade gracefully when disabled. */
export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<AiStatus>('/ai/status'), staleTime: 5 * 60_000 });
}
