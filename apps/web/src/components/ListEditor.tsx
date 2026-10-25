import { useState } from 'react';
import { ActionIcon, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconPlus, IconX } from '@tabler/icons-react';

/** Editable ordered list of short strings (test ideas, heuristics, risks). */
export function ListEditor({
  label,
  description,
  value,
  onChange,
  placeholder = 'Add an item and press Enter',
  error,
  max = 100,
}: {
  label: string;
  description?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  error?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t || value.length >= max) return;
    onChange([...value, t]);
    setDraft('');
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <Stack gap={6}>
      <div>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </div>
      {value.map((item, i) => (
        <Group key={i} gap={4} wrap="nowrap">
          <Text size="xs" c="dimmed" w={20} ta="right">
            {i + 1}.
          </Text>
          <TextInput
            aria-label={`${label} item ${i + 1}`}
            value={item}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.currentTarget.value : x)))}
            onBlur={() => !item.trim() && onChange(value.filter((_, j) => j !== i))}
            style={{ flex: 1 }}
            size="xs"
          />
          <ActionIcon variant="subtle" color="gray" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            <IconArrowUp size={14} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            <IconArrowDown size={14} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="red" aria-label={`Remove ${item || 'item'}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <IconX size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Group gap={4} wrap="nowrap">
        <TextInput
          aria-label={`Add to ${label}`}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          style={{ flex: 1 }}
          size="xs"
          maxLength={500}
          error={error}
        />
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={add} disabled={!draft.trim() || value.length >= max}>
          Add
        </Button>
      </Group>
    </Stack>
  );
}
