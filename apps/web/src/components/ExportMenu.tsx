import { Button, Menu } from '@mantine/core';
import { IconDownload, IconFileTypeCsv, IconFileTypeDocx, IconJson, IconMarkdown } from '@tabler/icons-react';
import { download, qs } from '../lib/api';
import { toastError } from './ui';

type Format = 'csv' | 'json' | 'md' | 'docx';
const EXT: Record<Format, string> = { csv: 'csv', json: 'json', md: 'zip', docx: 'docx' };

/**
 * Export button for an API export endpoint that accepts ?format=csv|json.
 * `documents` adds Markdown (ZIP with attachments) and Word, for endpoints that also accept format=md|docx.
 */
export function ExportMenu({ url, params, name, label = 'Export', documents = false, dataLabel = 'Latest results only' }: { url: string; params?: Record<string, string | undefined>; name: string; label?: string; documents?: boolean; dataLabel?: string }) {
  const go = (format: Format) => download(`${url}${qs({ ...(params ?? {}), format })}`, `${name}.${EXT[format]}`).catch((e) => toastError(e, 'Export failed'));
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="default" leftSection={<IconDownload size={16} />} size="sm">
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {documents && (
          <>
            <Menu.Label>Report with attachments</Menu.Label>
            <Menu.Item leftSection={<IconMarkdown size={16} />} onClick={() => go('md')}>
              Markdown (.zip with attachments)
            </Menu.Item>
            <Menu.Item leftSection={<IconFileTypeDocx size={16} />} onClick={() => go('docx')}>
              Word (.docx, images embedded)
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>{dataLabel}</Menu.Label>
          </>
        )}
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
