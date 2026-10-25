import { Alert, Badge, Code, Text } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import type { AiMeta, AiStatus } from '../lib/ai';

/** Shown in place of AI actions when no provider is configured. */
export function AiSetupNotice({ status }: { status: AiStatus | undefined }) {
  if (!status || status.enabled) return null;
  return (
    <Alert color="gray" icon={<IconSparkles size={18} />} title="AI assistance is not configured">
      <Text size="sm">Everything else in Explorix works without AI. To enable optional drafting and summaries, an administrator sets server environment variables:</Text>
      <Code block mt="xs">
        {status.setupInstructions ?? 'AI_PROVIDER=openai\nAI_API_KEY=...\nAI_MODEL=gpt-4o-mini'}
      </Code>
    </Alert>
  );
}

/** Label every AI-generated draft so it is never mistaken for reviewed content. */
export function AiDraftBadge({ meta }: { meta: AiMeta | undefined | null }) {
  if (!meta) return null;
  return (
    <Badge variant="light" color="grape" leftSection={<IconSparkles size={12} />}>
      AI draft · {meta.isMock ? 'mock provider' : meta.model} · review before saving
    </Badge>
  );
}
