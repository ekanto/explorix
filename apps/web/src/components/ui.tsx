import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert, Avatar, Badge, Box, Center, Group, Loader, SimpleGrid, Text, Title, Tooltip, type BadgeProps, type BoxProps } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconBug, IconCompass, IconLock } from '@tabler/icons-react';
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
  return <EnumBadge value={value} meta={PRIORITY} variant="dot" {...rest} />;
}

export function SeverityBadge({ value, ...rest }: { value: string | null | undefined } & BadgeProps) {
  if (!value) return null;
  return <EnumBadge value={value} meta={SEVERITY} variant="light" {...rest} />;
}

export function ClassificationBadge({ c, ...rest }: { c: { name: string; color: string; isDefect?: boolean } | null | undefined } & Omit<BadgeProps, 'c'>) {
  if (!c) return null;
  return (
    <Badge color={c.color} variant="light" leftSection={c.isDefect ? <IconBug size={11} aria-hidden /> : undefined} {...rest}>
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

export function UserLabel({ user, fallback = 'Unassigned', size = 'sm' }: { user: { name: string; avatarColor?: string | null } | null | undefined; fallback?: string; size?: 'xs' | 'sm' }) {
  if (!user)
    return (
      <Text size={size} c="dimmed">
        {fallback}
      </Text>
    );
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <UserAvatar user={user} size={size === 'xs' ? 18 : 22} />
      <Text size={size} c={size === 'xs' ? 'dimmed' : undefined} truncate>
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

/** Standard page heading: optional kicker/breadcrumb, h1 title, description and right-aligned actions. */
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
    <header className="ex-page-header">
      <div className="ex-page-header__text">
        {kicker && <div className="ex-kicker">{kicker}</div>}
        <Title order={1} fz={26} lh={1.25} style={{ letterSpacing: '-0.015em', overflowWrap: 'anywhere' }}>
          {title}
        </Title>
        {subtitle && (
          <Text c="dimmed" size="md" mt={6} maw={760}>
            {subtitle}
          </Text>
        )}
      </div>
      {actions && <div className="ex-page-header__actions ex-no-print">{actions}</div>}
    </header>
  );
}

/**
 * Empty state. The default variant centres in its container (lists, pages); `compact` renders an
 * inline row for empty sections inside dashboards and cards so they don't reserve large blank areas.
 */
export function EmptyState({ title, description, action, icon, compact }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode; compact?: boolean }) {
  if (compact)
    return (
      <div className="ex-empty" data-compact>
        <span className="ex-empty__icon" aria-hidden>
          {icon ?? <IconCompass size={18} />}
        </span>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm">
            {title}
          </Text>
          {description && (
            <Text size="sm" c="dimmed">
              {description}
            </Text>
          )}
        </Box>
        {action}
      </div>
    );
  return (
    <div className="ex-empty">
      <span className="ex-empty__icon" aria-hidden>
        {icon ?? <IconCompass size={22} />}
      </span>
      <Text fw={600}>{title}</Text>
      {description && (
        <Text size="sm" c="dimmed" maw={440}>
          {description}
        </Text>
      )}
      {action && <Box mt="sm">{action}</Box>}
    </div>
  );
}

/** Heading for a group of cards on a page (sits outside the cards, aligned with the page grid). */
export function SectionHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Group justify="space-between" align="center" mb="sm" mt={4} wrap="nowrap">
      <Title order={2} fz={16} fw={600}>
        {children}
      </Title>
      {action}
    </Group>
  );
}

/**
 * Container-aware grid for StatCards: columns follow the space the grid actually has (sidebar
 * expanded or collapsed), not the window width, so cards never get squeezed into truncated labels.
 */
export function StatGrid({ children, max = 4 }: { children: ReactNode; max?: 3 | 4 | 6 | 7 }) {
  const cols = { 3: { base: 1, '520px': 3 }, 4: { base: 1, '420px': 2, '860px': 4 }, 6: { base: 1, '420px': 2, '700px': 3, '1240px': 6 }, 7: { base: 1, '420px': 2, '700px': 4, '1080px': 7 } }[max];
  return (
    <SimpleGrid type="container" cols={cols} spacing="md">
      {children}
    </SimpleGrid>
  );
}

/** Titled content section (card) with optional description and header actions. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  bodyProps,
  ...rest
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  bodyProps?: BoxProps;
} & Omit<BoxProps, 'title'>) {
  return (
    <Box component="section" className="ex-section" {...rest}>
      {(title || actions) && (
        <div className="ex-section__header">
          <Box style={{ minWidth: 0 }}>
            {title && (
              <Title order={2} className="ex-section__title">
                {title}
              </Title>
            )}
            {description && <div className="ex-section__desc">{description}</div>}
          </Box>
          {actions && (
            <Group gap={6} wrap="nowrap">
              {actions}
            </Group>
          )}
        </div>
      )}
      <Box className="ex-section__body" {...bodyProps}>
        {children}
      </Box>
    </Box>
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
      <Text size="sm" fw={600} c="var(--ex-fg-secondary)" mb={2}>
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

/**
 * Metric card with a fixed geometry (label row, value, hint) so cards in a grid always align.
 * `color` tints the value; use it only for metrics where the colour carries meaning (risk, defects).
 */
export function StatCard({
  label,
  value,
  hint,
  color,
  icon,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  color?: string;
  icon?: ReactNode;
  tooltip?: string;
}) {
  const card = (
    <div className="ex-stat" tabIndex={tooltip ? 0 : undefined}>
      <div className="ex-stat__label">
        <span className="ex-stat__label-text" title={label}>
          {label}
        </span>
        {icon && (
          <span className="ex-stat__icon" aria-hidden>
            {icon}
          </span>
        )}
      </div>
      <div>
        <div className="ex-stat__value" style={color && color !== 'explorix' ? { color: `var(--mantine-color-${color}-text)` } : undefined}>
          {value}
        </div>
        <div className="ex-stat__hint">{hint ?? '\u00a0'}</div>
      </div>
    </div>
  );
  if (!tooltip) return card;
  return (
    <Tooltip label={tooltip} multiline w={260}>
      {card}
    </Tooltip>
  );
}
