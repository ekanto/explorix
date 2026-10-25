import { Button, Menu } from '@mantine/core';
import { IconDownload, IconFileTypeCsv, IconJson } from '@tabler/icons-react';
import { download, qs } from '../lib/api';
import { toastError } from './ui';

/** CSV / JSON export button for an API export endpoint that accepts ?format=csv|json. */
export function ExportMenu({ url, params, name, label = 'Export' }: { url: string; params?: Record<string, string | undefined>; name: string; label?: string }) {
  const go = (format: 'csv' | 'json') =>
    download(`${url}${qs({ ...(params ?? {}), format })}`, `${name}.${format}`).catch((e) => toastError(e, 'Export failed'));
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="default" leftSection={<IconDownload size={16} />} size="sm">
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconFileTypeCsv size={16} />} onClick={() => go('csv')}>
          CSV (spreadsheet-safe)
        </Menu.Item>
        <Menu.Item leftSection={<IconJson size={16} />} onClick={() => go('json')}>
          JSON
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
