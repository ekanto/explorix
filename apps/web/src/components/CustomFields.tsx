import { Fragment } from 'react';
import { Checkbox, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useProject, type CustomField } from '../lib/project';
import { fmtDate } from '../lib/format';

type Values = Record<string, unknown>;

/** Editor for project-defined custom fields of one entity type. */
export function CustomFieldsInput({
  entity,
  value,
  onChange,
  cols = 2,
}: {
  entity: CustomField['entity'];
  value: Values;
  onChange: (v: Values) => void;
  cols?: number;
}) {
  const { fieldsFor } = useProject();
  const fields = fieldsFor(entity);
  if (!fields.length) return null;
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });

  const renderField = (f: (typeof fields)[number]) => {
    const common = { label: f.label, description: f.helpText ?? undefined, required: f.required };
    const v = value?.[f.key];
    switch (f.type) {
      case 'TEXTAREA':
        return <Textarea {...common} autosize minRows={2} value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value)} />;
      case 'NUMBER':
        return <NumberInput {...common} value={(v as number) ?? ''} onChange={(n) => set(f.key, n === '' ? null : Number(n))} />;
      case 'SELECT':
        return <Select {...common} data={f.options} value={(v as string) ?? null} onChange={(x) => set(f.key, x)} clearable />;
      case 'MULTI_SELECT':
        return <MultiSelect {...common} data={f.options} value={(v as string[]) ?? []} onChange={(x) => set(f.key, x)} clearable />;
      case 'CHECKBOX':
        return <Checkbox {...common} mt="lg" checked={!!v} onChange={(e) => set(f.key, e.currentTarget.checked)} />;
      case 'DATE':
        return <TextInput {...common} type="date" value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value || null)} />;
      case 'URL':
        return <TextInput {...common} type="url" placeholder="https://" value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value || null)} />;
      default:
        return <TextInput {...common} value={(v as string) ?? ''} onChange={(e) => set(f.key, e.currentTarget.value)} />;
    }
  };

  return (
    <SimpleGrid cols={{ base: 1, sm: cols }} spacing="sm">
      {fields.map((f) => (
        <Fragment key={f.id}>{renderField(f)}</Fragment>
      ))}
    </SimpleGrid>
  );
}

/** Read-only display of custom field values. */
export function CustomFieldsView({ entity, value }: { entity: CustomField['entity']; value: Values | null | undefined }) {
  const { fieldsFor } = useProject();
  const fields = fieldsFor(entity).filter((f) => value && value[f.key] !== undefined && value[f.key] !== null && value[f.key] !== '');
  if (!fields.length) return null;
  return (
    <Stack gap={6}>
      {fields.map((f) => {
        const v = value![f.key];
        const display = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : f.type === 'DATE' ? fmtDate(String(v)) : String(v);
        return (
          <div key={f.id}>
            <Text size="xs" c="dimmed" fw={600}>
              {f.label}
            </Text>
            {f.type === 'URL' ? (
              <a className="ex-link" href={String(v)} target="_blank" rel="noopener noreferrer">
                {display}
              </a>
            ) : (
              <Text size="sm">{display}</Text>
            )}
          </div>
        );
      })}
    </Stack>
  );
}