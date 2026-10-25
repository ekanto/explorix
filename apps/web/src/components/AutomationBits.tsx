import { Link } from 'react-router';
import { Badge, Box, Group, Progress, Text, Tooltip } from '@mantine/core';
import { IconRefreshAlert } from '@tabler/icons-react';
import { RESULT_CATEGORY } from '../lib/constants';

/** Milliseconds → "850ms", "12.4s", "3m 05s", "1h 02m". */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export const categoryColor = (c: string | null | undefined) => (c ? RESULT_CATEGORY[c]?.color ?? 'gray' : 'gray');

/** Stacked passed / failed / skipped / other bar for an automation run. */
export function RunResultBar({ passed, failed, skipped, other = 0, total, w = 140 }: { passed: number; failed: number; skipped: number; other?: number; total: number; w?: number | string }) {
  const pctOf = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <Box w={w}>
      <Progress.Root size="md" aria-label={`${passed} passed, ${failed} failed, ${skipped} skipped of ${total}`}>
        <Tooltip label={`${passed} passed`}>
          <Progress.Section value={pctOf(passed)} color="green.6" />
        </Tooltip>
        <Tooltip label={`${failed} failed`}>
          <Progress.Section value={pctOf(failed)} color="red.6" />
        </Tooltip>
        <Tooltip label={`${skipped} skipped`}>
          <Progress.Section value={pctOf(skipped)} color="gray.5" />
        </Tooltip>
        {other > 0 && (
          <Tooltip label={`${other} other (blocked/retest/untested)`}>
            <Progress.Section value={pctOf(other)} color="orange.5" />
          </Tooltip>
        )}
      </Progress.Root>
      <Group gap={6} mt={2} wrap="nowrap">
        <Text size="xs" c="green.7" fw={600}>
          {passed}
        </Text>
        <Text size="xs" c="red.7" fw={600}>
          {failed}
        </Text>
        <Text size="xs" c="dimmed">
          {skipped} skip · {total} total
        </Text>
      </Group>
    </Box>
  );
}

/** Row of colored squares (oldest → newest) showing a test's result history. */
export function HistoryStrip({ items, size = 12 }: { items: { category: string; label?: string; to?: string }[]; size?: number }) {
  if (!items.length)
    return (
      <Text size="xs" c="dimmed">
        No history
      </Text>
    );
  return (
    <Group gap={3} wrap="nowrap" role="list" aria-label="Result history, oldest to newest">
      {items.map((it, i) => {
        const sq = (
          <Box
            role="listitem"
            aria-label={`${RESULT_CATEGORY[it.category]?.label ?? it.category}${it.label ? ` — ${it.label}` : ''}`}
            w={size}
            h={size}
            style={{ borderRadius: 3, background: `var(--mantine-color-${categoryColor(it.category)}-${it.category === 'SKIPPED' || it.category === 'UNTESTED' ? 4 : 6})`, flexShrink: 0 }}
          />
        );
        return (
          <Tooltip key={i} label={`${RESULT_CATEGORY[it.category]?.label ?? it.category}${it.label ? ` · ${it.label}` : ''}`}>
            {it.to ? (
              <Link to={it.to} style={{ display: 'inline-flex' }}>
                {sq}
              </Link>
            ) : (
              sq
            )}
          </Tooltip>
        );
      })}
    </Group>
  );
}

export type Flakiness = { flips: number; passedOnRetry: number; score: number; flaky: boolean };

/** "Flaky" badge with the evidence the server used (pass/fail flips and passes on retry). */
export function FlakyBadge({ flaky, showStable }: { flaky: Flakiness | null | undefined; showStable?: boolean }) {
  if (!flaky) return null;
  if (!flaky.flaky)
    return showStable ? (
      <Badge size="sm" variant="light" color="gray">
        Stable
      </Badge>
    ) : null;
  return (
    <Tooltip label={`${flaky.flips} pass/fail flips · ${flaky.passedOnRetry} passed on retry · flake score ${Math.round(flaky.score * 100)}% (last 10 completed results)`} multiline w={260}>
      <Badge size="sm" variant="light" color="grape" leftSection={<IconRefreshAlert size={12} />}>
        Flaky
      </Badge>
    </Tooltip>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  return status === 'RUNNING' ? (
    <Badge size="sm" color="blue" variant="light" className="ex-pulse">
      Running
    </Badge>
  ) : (
    <Badge size="sm" color="gray" variant="light">
      Completed
    </Badge>
  );
}
