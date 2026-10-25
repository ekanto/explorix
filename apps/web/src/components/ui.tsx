import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert, Avatar, Badge, Box, Center, Group, Loader, Stack, Text, ThemeIcon, Title, Tooltip, type BadgeProps } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCompass, IconLock } from '@tabler/icons-react';
import { ApiError, errorMessage } from '../lib/api';
import { CHARTER_STATUS, FINDING_STATUS, ISSUE_STATUS, PRIORITY, RESULT_CATEGORY, SESSION_STATUS, SEVERITY } from '../lib/constants';
import { initials, titleCase } from '../lib/format';

type Meta = Record<string, { label: string; color: string }>;

function EnumBadge({ value, meta, ...rest }: { value: string | null | undefined; meta: Meta } & BadgeProps) {
  if (!value) return null;
  const m = meta[value] ?? { label: titleCase(value), color: 'gray' };
  return (
    <Badge color={m.color} {...rest}>
      {m.label}
    </Badge>
  );
}

export const SessionStatusBadge = (p: { value: string } & BadgeProps) => <EnumBadge meta={SESSION_STATUS} {...p} />;
export const CharterStatusBadge = (p: { value: string } & BadgeProps) => <EnumBadge meta={CHARTER_STATUS} {...p} />;
export const FindingStatusBadge = (p: { value: string } & BadgeProps) => <EnumBadge meta={FINDING_STATUS} {...p} />;
export const IssueStatusBadge = (p: { value: string } & BadgeProps) => <EnumBadge meta={ISSUE_STATUS} {...p} />;
export const ResultBadge = (p: { value: string } & BadgeProps) => <EnumBadge meta={RESULT_CATEGORY} {...p} />;

export function PriorityBadge({ value, ...rest }: { value: string | null | undefined } & BadgeProps) {
  if (!value) return null;
  return <EnumBadge value={value} meta={PRIORITY} variant="outline" {...rest} />;
}

export function SeverityBadge({ value, ...rest }: { value: string | null | undefined } & BadgeProps) {
  if (!value) return null;
  return <EnumBadge value={value} meta={SEVERITY} variant="filled" {...rest} />;
}

export function ClassificationBadge({ c, ...rest }: { c: { name: string; color: string; isDefect?: boolean } | null | undefined } & Omit<BadgeProps, 'c'>) {
  if (!c) return null;
  return (
    <Badge color={c.color} variant={c.isDefect ? 'filled' : 'light'} {...rest}>
      {c.name}
    </Badge>
  );
}

export function StatusPill({ status }: { status: { name: string; color: string } | null | undefined }) {
  if (!status) return <Badge color="gray" variant="outline">Untested</Badge>;
  return <Badge color={status.color}>{status.name}</Badge>;
}

export function UserAvatar({ user, size = 26 }: { user: { name: string; avatarColor?: string | null } | null | undefined; size?: number }) {
  if (!user)
    return (
      <Avatar size={size} radius="xl" color="gray">
        ?
      </Avatar>
    );
  return (
    <Tooltip label={user.name}>
      <Avatar size={size} radius="xl" variant="filled" color={user.avatarColor ?? 'explorix'} aria-label={user.name} styles={{ placeholder: { fontSize: size * 0.4, fontWeight: 600 } }}>
        {initials(user.name)}
      </Avatar>
    </Tooltip>
  );
}

export function UserLabel({ user, fallback = 'Unassigned' }: { user: { name: string; avatarColor?: string | null } | null | undefined; fallback?: string }) {
  if (!user)
    return (
      <Text size="sm" c="dimmed">
        {fallback}
      </Text>
    );
  return (
    <Group gap={6} wrap="nowrap">
      <UserAvatar user={user} size={22} />
      <Text size="sm" truncate>
        {user.name}
      </Text>
    </Group>
  );
}

export function KeyLink({ to, k, children }: { to: string; k?: string; children?: ReactNode }) {
  return (
    <Link to={to} className="ex-link">
      {k && <span className="ex-key">{k}</span>} {children}
    </Link>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  kicker,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  kicker?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
      <Box style={{ minWidth: 0, flex: 1 }}>
        {kicker && (
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={2} style={{ letterSpacing: '0.04em' }}>
            {kicker}
          </Text>
        )}
        <Title order={2} fz={24}>
          {title}
        </Title>
        {subtitle && (
          <Text c="dimmed" size="sm" mt={4}>
            {subtitle}
          </Text>
        )}
      </Box>
      {actions && (
        <Group gap="xs" className="ex-no-print">
          {actions}
        </Group>
      )}
    </Group>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Center py={48}>
      <Stack align="center" gap="xs" maw={420} ta="center">
        <ThemeIcon size={48} radius="xl" variant="light">
          {icon ?? <IconCompass size={26} />}
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
        {action}
      </Stack>
    </Center>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <Center py={48}>
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          {label ?? 'Loading…'}
        </Text>
      </Group>
    </Center>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 404);
  return (
    <Alert color={forbidden ? 'gray' : 'red'} icon={forbidden ? <IconLock size={18} /> : <IconAlertTriangle size={18} />} title={forbidden ? 'Not available' : 'Something went wrong'} my="md">
      {errorMessage(error)}
    </Alert>
  );
}

/** Renders loading / error / content for a react-query result. */
export function QueryState<T>({ query, children }: { query: { isLoading: boolean; error: unknown; data: T | undefined }; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  if (query.data === undefined) return null;
  return <>{children(query.data)}</>;
}

export function toastError(err: unknown, title = 'Action failed') {
  notifications.show({ color: 'red', title, message: errorMessage(err), autoClose: 7000 });
}

export function toastOk(message: string, title?: string) {
  notifications.show({ color: 'teal', title, message, autoClose: 3000 });
}

/** Read-only rich text (HTML is sanitized server-side on write). */
export function RichView({ html, empty = 'Nothing here yet.' }: { html: string | null | undefined; empty?: string }) {
  if (!html || !html.replace(/<[^>]*>/g, '').trim())
    return (
      <Text size="sm" c="dimmed" fs="italic">
        {empty}
      </Text>
    );
  return <div className="ex-rich" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Plain text field display that preserves line breaks. */
export function TextBlock({ label, value }: { label: string; value: ReactNode | null | undefined }) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <Box>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={2} style={{ letterSpacing: '0.03em' }}>
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text size="sm" className="ex-prewrap">
          {value}
        </Text>
      ) : (
        value
      )}
    </Box>
  );
}

export function StatCard({ label, value, hint, color, icon }: { label: string; value: ReactNode; hint?: ReactNode; color?: string; icon?: ReactNode }) {
  return (
    <Box p="md" style={{ border: '1px solid var(--ex-border)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--ex-surface)' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.03em' }}>
          {label}
        </Text>
        {icon && (
          <ThemeIcon variant="light" color={color ?? 'explorix'} size="md">
            {icon}
          </ThemeIcon>
        )}
      </Group>
      <Text fz={26} fw={700} mt={4} c={color && color !== 'explorix' ? `${color}.7` : undefined}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      )}
    </Box>
  );
}
