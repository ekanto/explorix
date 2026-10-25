import { Group, Text } from '@mantine/core';

/**
 * Explorix mark: a compass ring with a tilted needle pointing toward an amber
 * "discovery" point — an exploration path from the centre outward.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Explorix logo">
      <rect width="32" height="32" rx="8" fill="var(--mantine-color-explorix-7)" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#ccfbf1" strokeWidth="2" />
      <path d="M16 7 L19 16 L16 25 L13 16 Z" fill="#ccfbf1" transform="rotate(35 16 16)" />
      <circle cx="16" cy="16" r="2" fill="var(--mantine-color-explorix-7)" />
      <path d="M18.5 13.5 Q21.5 10.5 24.5 9" stroke="#fbbf24" strokeWidth="1.4" strokeDasharray="1.6 1.6" fill="none" />
      <circle cx="24.5" cy="9" r="2.2" fill="#fbbf24" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Group gap={8} wrap="nowrap">
      <LogoMark size={size} />
      <Text fw={750} fz={size * 0.68} style={{ letterSpacing: '-0.02em' }}>
        Explori<Text span inherit c="amber.5">x</Text>
      </Text>
    </Group>
  );
}
