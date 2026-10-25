import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Group, Pagination, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';

type Patch = Record<string, string | number | string[] | null | undefined>;

/**
 * List filters stored in the URL query string so filtered views are linkable and survive refresh.
 * Multi-value filters are stored comma-separated (the API accepts the same format).
 */
export function useUrlFilters() {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const list = (k: string) => (sp.get(k) ?? '').split(',').filter(Boolean);
  const set = (patch: Patch) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          const s = Array.isArray(v) ? v.join(',') : v == null ? '' : String(v);
          if (s) next.set(k, s);
          else next.delete(k);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  const clear = (keep: string[] = []) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams();
        for (const k of keep) if (prev.get(k)) next.set(k, prev.get(k)!);
        return next;
      },
      { replace: true },
    );
  const page = Math.max(1, Number(sp.get('page')) || 1);
  return { sp, get, list, set, clear, page };
}

/** Search box that debounces typing before reporting the value. */
export function SearchInput({ value, onChange, placeholder = 'Search…', w = 260 }: { value: string; onChange: (v: string) => void; placeholder?: string; w?: number | string }) {
  const [v, setV] = useState(value);
  const [debounced] = useDebouncedValue(v, 350);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <TextInput
      aria-label="Search"
      placeholder={placeholder}
      leftSection={<IconSearch size={16} />}
      value={v}
      onChange={(e) => setV(e.currentTarget.value)}
      w={w}
    />
  );
}

/** "Showing x–y of n" plus pagination when the result spans several pages. */
export function ListPager({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (page: number) => void }) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <Group justify="space-between" mt="md">
      <Text size="sm" c="dimmed">
        Showing {from}–{to} of {total}
      </Text>
      {total > pageSize && <Pagination total={Math.ceil(total / pageSize)} value={page} onChange={onChange} size="sm" />}
    </Group>
  );
}
