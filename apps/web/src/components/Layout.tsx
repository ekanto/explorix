import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Divider,
  Group,
  Indicator,
  Kbd,
  Menu,
  Modal,
  NavLink,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure, useHotkeys } from '@mantine/hooks';
import { Spotlight, spotlight, type SpotlightActionData } from '@mantine/spotlight';
import {
  IconAdjustments,
  IconBell,
  IconBug,
  IconChartBar,
  IconChecklist,
  IconCompass,
  IconFileDescription,
  IconFlask,
  IconFolders,
  IconHome,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPlayerPlay,
  IconPlugConnected,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShieldLock,
  IconSun,
  IconTargetArrow,
  IconTemplate,
  IconTimeline,
  IconUser,
  IconUserCheck,
  IconListCheck,
  IconBulb,
  IconDeviceDesktop,
  IconKeyboard,
  IconReportAnalytics,
} from '@tabler/icons-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { desktop, isDesktop } from '../lib/desktop';
import { fromNow } from '../lib/format';
import { Logo } from './Logo';
import { UserAvatar } from './ui';

type ProjectLite = { id: string; key: string; name: string; color: string; archivedAt: string | null; role?: string };

const LAST_PROJECT = 'explorix.lastProject';

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ projects: ProjectLite[] }>('/projects'), staleTime: 30_000 });
}

function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [opened, { toggle, close }] = useDisclosure(false);
  const q = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => api.get<{ items: any[]; unread: number }>('/notifications', { pageSize: 12 }),
    refetchInterval: 30_000,
  });
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api.post('/notifications/read', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  return (
    <Popover opened={opened} onChange={(o) => !o && close()} width={380} position="bottom-end" shadow="md">
      <Popover.Target>
        <Indicator disabled={!unread} label={unread > 99 ? '99+' : unread} size={16} offset={4} color="amber.5">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggle} aria-label={`Notifications (${unread} unread)`}>
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" p="sm">
          <Text fw={600} size="sm">
            Notifications
          </Text>
          <Group gap={4}>
            {unread > 0 && (
              <UnstyledButton onClick={() => read.mutate({ all: true })}>
                <Text size="xs" c="explorix">
                  Mark all read
                </Text>
              </UnstyledButton>
            )}
            <Text size="xs" c="dimmed">
              ·
            </Text>
            <UnstyledButton
              onClick={() => {
                close();
                navigate('/notifications');
              }}
            >
              <Text size="xs" c="explorix">
                View all
              </Text>
            </UnstyledButton>
          </Group>
        </Group>
        <Divider />
        <ScrollArea.Autosize mah={420}>
          {(q.data?.items ?? []).length === 0 && (
            <Text size="sm" c="dimmed" p="md">
              You're all caught up.
            </Text>
          )}
          {(q.data?.items ?? []).map((n) => (
            <UnstyledButton
              key={n.id}
              w="100%"
              p="sm"
              style={{ borderBottom: '1px solid var(--ex-border)', background: n.readAt ? undefined : 'var(--ex-subtle)' }}
              onClick={() => {
                if (!n.readAt) read.mutate({ ids: [n.id] });
                close();
                if (n.link) navigate(n.link);
              }}
            >
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <UserAvatar user={n.actor} size={24} />
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" lineClamp={2} fw={n.readAt ? 400 : 600}>
                    {n.title}
                  </Text>
                  {n.body && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {n.body}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    {n.project?.key ? `${n.project.key} · ` : ''}
                    {fromNow(n.createdAt)}
                  </Text>
                </Box>
              </Group>
            </UnstyledButton>
          ))}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  charter: <IconTargetArrow size={18} />,
  session: <IconPlayerPlay size={18} />,
  finding: <IconBulb size={18} />,
  issue: <IconBug size={18} />,
  test_case: <IconChecklist size={18} />,
  requirement: <IconFileDescription size={18} />,
};

function GlobalSearch({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 200);
  const q = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<{ results: any[] }>('/search', { q: debounced }),
    enabled: debounced.trim().length >= 2,
  });
  const actions: SpotlightActionData[] = useMemo(() => {
    const results = (q.data?.results ?? []).map((r) => ({
      id: `${r.type}-${r.id}`,
      label: `${r.key} · ${r.title}`,
      description: `${r.project.key} · ${r.type.replace('_', ' ')}${r.subtitle ? ` · ${String(r.subtitle).slice(0, 80)}` : ''}`,
      leftSection: TYPE_ICON[r.type],
      onClick: () => navigate(r.link),
    }));
    if (results.length || query.trim().length >= 2) return results;
    const base = projectId ? `/projects/${projectId}` : null;
    return [
      { id: 'nav-mywork', label: 'My Work', description: 'Assigned charters, active sessions, reviews', leftSection: <IconUserCheck size={18} />, onClick: () => navigate('/my-work') },
      ...(base
        ? [
            { id: 'nav-new-charter', label: 'New charter', description: 'Create an exploratory testing charter', leftSection: <IconTargetArrow size={18} />, onClick: () => navigate(`${base}/charters/new`) },
            { id: 'nav-sessions', label: 'Sessions', description: 'Exploratory session repository', leftSection: <IconPlayerPlay size={18} />, onClick: () => navigate(`${base}/sessions`) },
            { id: 'nav-findings', label: 'Findings', description: 'Observations, risks and defects', leftSection: <IconBulb size={18} />, onClick: () => navigate(`${base}/findings`) },
            { id: 'nav-reports', label: 'Reports', description: 'Dashboards and release readiness', leftSection: <IconChartBar size={18} />, onClick: () => navigate(`${base}/reports`) },
            { id: 'nav-new-report', label: 'New report', description: 'Build a PDF, Word, Markdown or HTML report with evidence', leftSection: <IconReportAnalytics size={18} />, onClick: () => navigate(`${base}/reports/new`) },
          ]
        : []),
      ...(isDesktop ? [{ id: 'nav-desktop-settings', label: 'Desktop settings', description: 'Storage folders, size limits, startup', leftSection: <IconDeviceDesktop size={18} />, onClick: () => navigate('/settings/desktop') }] : []),
    ];
  }, [q.data, query, navigate, projectId]);

  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      filter={(_, a) => a}
      nothingFound={debounced.length < 2 ? 'Type at least 2 characters' : q.isFetching ? 'Searching…' : 'Nothing found'}
      shortcut={['mod + K', '/']}
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search charters, sessions, findings, issues, test cases… (try S-12)' }}
      limit={30}
      scrollable
      maxHeight={480}
    />
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + K  or  /', 'Search and jump to anything'],
  ['Ctrl + J', 'Switch light / dark theme'],
  ['G then M', 'Go to My Work'],
  ...(isDesktop
    ? ([
        ['Ctrl + Shift + R', 'New report'],
        ['Ctrl + ,', 'Desktop settings'],
        ['Ctrl + 0 / + / −', 'Reset / increase / decrease zoom'],
      ] as [string, string][])
    : []),
  ['?', 'In a session workbench: its own shortcuts (capture finding, notes, timer…)'],
];

function ShortcutsHelp({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Keyboard shortcuts" centered>
      <Table>
        <Table.Tbody>
          {SHORTCUTS.map(([k, d]) => (
            <Table.Tr key={k}>
              <Table.Td w={170}>
                <Kbd>{k}</Kbd>
              </Table.Td>
              <Table.Td>{d}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Modal>
  );
}

export function AppLayout() {
  const { user, org, logout, isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sp, setSp] = useSearchParams();
  const match = useMatch('/projects/:projectId/*');
  const inWorkbench = !!useMatch('/projects/:projectId/sessions/:id');
  const [opened, { toggle, close }] = useDisclosure();
  const [helpOpen, setHelpOpen] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const projects = useProjects();
  const urlPid = match?.params.projectId;
  const [lastPid, setLastPid] = useState<string | null>(() => localStorage.getItem(LAST_PROJECT));

  useEffect(() => {
    if (urlPid && urlPid !== lastPid) {
      localStorage.setItem(LAST_PROJECT, urlPid);
      setLastPid(urlPid);
    }
  }, [urlPid, lastPid]);

  useEffect(() => close(), [location.pathname, close]);

  // Desktop menu commands (File › New Report, Settings, Help › Keyboard Shortcuts…).
  useEffect(() => desktop?.onNavigate((to) => navigate(to)), [navigate]);
  useEffect(() => {
    if (sp.get('shortcuts') === '1') {
      setHelpOpen(true);
      const rest = new URLSearchParams(sp);
      rest.delete('shortcuts');
      setSp(rest, { replace: true });
    }
  }, [sp, setSp]);

  const list = projects.data?.projects ?? [];
  const pid = urlPid ?? (list.some((x) => x.id === lastPid) ? lastPid : list.find((x) => !x.archivedAt)?.id) ?? undefined;
  const current = list.find((x) => x.id === pid);

  useHotkeys([
    ['mod+J', () => setColorScheme(scheme === 'dark' ? 'light' : 'dark')],
    ['g m', () => navigate('/my-work')],
    ['shift+/', () => !inWorkbench && setHelpOpen(true)],
  ]);

  const path = location.pathname;
  const base = pid ? `/projects/${pid}` : '';
  const isActive = (to: string, exact = false) => (exact ? path === to : path === to || path.startsWith(`${to}/`));
  const item = (to: string, label: string, icon: React.ReactNode, exact = false) => (
    <NavLink key={to} component={Link} to={to} label={label} leftSection={icon} active={isActive(to, exact)} variant="light" style={{ borderRadius: 6 }} />
  );

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <UnstyledButton component={Link} to="/" aria-label="Explorix home">
              <Logo size={26} />
            </UnstyledButton>
            {org && (
              <Badge variant="outline" color="gray" visibleFrom="md" radius="sm">
                {org.name}
              </Badge>
            )}
          </Group>
          <UnstyledButton
            onClick={() => spotlight.open()}
            visibleFrom="sm"
            style={{ border: '1px solid var(--ex-border)', borderRadius: 8, padding: '6px 10px', width: 360, maxWidth: '40vw' }}
            aria-label="Search"
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap={8} wrap="nowrap">
                <IconSearch size={16} />
                <Text size="sm" c="dimmed" truncate>
                  Search or jump to…
                </Text>
              </Group>
              <Kbd size="xs">Ctrl K</Kbd>
            </Group>
          </UnstyledButton>
          <Group gap={6} wrap="nowrap">
            <ActionIcon variant="subtle" color="gray" size="lg" hiddenFrom="sm" onClick={() => spotlight.open()} aria-label="Search">
              <IconSearch size={20} />
            </ActionIcon>
            <Tooltip label={`Switch to ${scheme === 'dark' ? 'light' : 'dark'} theme (Ctrl+J)`}>
              <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color scheme">
                {scheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
              </ActionIcon>
            </Tooltip>
            <NotificationsBell />
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <UnstyledButton aria-label="Account menu">
                  <UserAvatar user={user} size={30} />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  {user?.name}
                  <br />
                  <Text span size="xs" c="dimmed">
                    {user?.email}
                  </Text>
                </Menu.Label>
                <Menu.Item leftSection={<IconUser size={16} />} component={Link} to="/profile">
                  Profile & preferences
                </Menu.Item>
                {isOrgAdmin && (
                  <Menu.Item leftSection={<IconShieldLock size={16} />} component={Link} to="/admin">
                    Administration
                  </Menu.Item>
                )}
                {isDesktop && (
                  <Menu.Item leftSection={<IconDeviceDesktop size={16} />} component={Link} to="/settings/desktop">
                    Desktop settings
                  </Menu.Item>
                )}
                <Menu.Item leftSection={<IconKeyboard size={16} />} onClick={() => setHelpOpen(true)}>
                  Keyboard shortcuts
                </Menu.Item>
                <Menu.Item component="a" href="/api/docs" target="_blank" leftSection={<IconFileDescription size={16} />}>
                  API documentation
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconLogout size={16} />}
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section>
          <Stack gap={2}>
            {item('/', 'Overview', <IconHome size={18} />, true)}
            {item('/my-work', 'My Work', <IconUserCheck size={18} />)}
            {item('/projects', 'Projects', <IconFolders size={18} />, true)}
          </Stack>
          <Divider my="sm" />
          <Select
            size="xs"
            aria-label="Current project"
            placeholder="Select a project"
            data={list.map((x) => ({ value: x.id, label: `${x.key} · ${x.name}${x.archivedAt ? ' (archived)' : ''}` }))}
            value={pid ?? null}
            onChange={(v) => v && navigate(`/projects/${v}`)}
            allowDeselect={false}
            leftSection={current ? <Box w={10} h={10} style={{ borderRadius: 3, background: current.color }} /> : undefined}
            mb={6}
          />
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} type="scroll">
          {pid && (
            <Stack gap={2}>
              {item(base, 'Project dashboard', <IconLayoutDashboard size={18} />, true)}
              <NavLink
                label="Exploratory Testing"
                leftSection={<IconCompass size={18} />}
                defaultOpened
                childrenOffset={14}
                style={{ borderRadius: 6 }}
                active={false}
              >
                {item(`${base}/charters`, 'Charters', <IconTargetArrow size={16} />)}
                {item(`${base}/sessions`, 'Sessions', <IconPlayerPlay size={16} />)}
                {item(`${base}/templates`, 'Session Templates', <IconTemplate size={16} />)}
                {item(`${base}/findings`, 'Findings', <IconBulb size={16} />)}
              </NavLink>
              {item(`${base}/test-cases`, 'Test Cases', <IconChecklist size={18} />)}
              {item(`${base}/test-runs`, 'Test Runs', <IconListCheck size={18} />)}
              {item(`${base}/automation`, 'Automation', <IconRobot size={18} />)}
              {item(`${base}/issues`, 'Issues', <IconBug size={18} />)}
              {item(`${base}/requirements`, 'Requirements', <IconFlask size={18} />)}
              {item(`${base}/reports`, 'Reports', <IconChartBar size={18} />, true)}
              {item(`${base}/reports/new`, 'Report builder', <IconReportAnalytics size={18} />)}
              {item(`${base}/activity`, 'Activity', <IconTimeline size={18} />)}
              {item(`${base}/integrations`, 'Integrations', <IconPlugConnected size={18} />)}
              {item(`${base}/settings`, 'Project settings', <IconAdjustments size={18} />)}
            </Stack>
          )}
        </AppShell.Section>
        {(isOrgAdmin || isDesktop) && (
          <AppShell.Section>
            <Divider my="xs" />
            {isOrgAdmin && item('/admin', 'Administration', <IconSettings size={18} />)}
            {isDesktop && item('/settings/desktop', 'Desktop settings', <IconDeviceDesktop size={18} />)}
          </AppShell.Section>
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={1440} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
      <GlobalSearch projectId={pid} />
      <ShortcutsHelp opened={helpOpen} onClose={() => setHelpOpen(false)} />
    </AppShell>
  );
}
