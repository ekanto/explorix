import { ActionIcon, Box, Code, CopyButton, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

/** Monospace code block with a copy-to-clipboard button. */
export function CopyCode({ code, label, maxHeight = 360 }: { code: string; label?: string; maxHeight?: number }) {
  return (
    <Box>
      {label && (
        <Text size="xs" fw={600} c="dimmed" mb={4}>
          {label}
        </Text>
      )}
      <Box pos="relative">
        <Code block style={{ maxHeight, overflow: 'auto', paddingRight: 40, whiteSpace: 'pre' }}>
          {code}
        </Code>
        <CopyButton value={code} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="left">
              <ActionIcon variant="default" size="sm" onClick={copy} aria-label={label ? `Copy ${label}` : 'Copy code'} pos="absolute" top={6} right={6} className="ex-no-print">
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Box>
    </Box>
  );
}
