import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ActionIcon,
  AppShell,
  Box,
  Collapse,
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
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure, useHotkeys, useMediaQuery } from '@mantine/hooks';
import { Spotlight, spotlight, type SpotlightActionData } from '@mantine/spotlight';
import {
  IconAdjustments,
  IconCheck,
  IconChevronDown,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSelector,
  IconBell,
  IconBug,
  IconChartBar,
  IconChecklist,
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
  ['Ctrl + B', 'Collapse / expand the sidebar'],
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

const NAV_COLLAPSED = 'explorix.navCollapsed';
const NAV_GROUPS = 'explorix.navGroups';

type NavEntry = { to: string; label: string; icon: React.ReactNode; exact?: boolean };

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue] as const;
}

function ProjectSwitcher({ list, current, rail, onPick }: { list: ProjectLite[]; current?: ProjectLite; rail: boolean; onPick: (id: string) => void }) {
  const mark = (x?: ProjectLite) => (
    <span className="ex-project-mark" style={{ background: x?.color ?? 'var(--mantine-color-gray-6)' }} aria-hidden>
      {(x?.key ?? '?').slice(0, 3)}
    </span>
  );
  const active = list.filter((x) => !x.archivedAt);
  const archived = list.filter((x) => x.archivedAt);
  return (
    <Menu position={rail ? 'right-start' : 'bottom-start'} width={280} offset={6}>
      <Menu.Target>
        {rail ? (
          <Tooltip label={current ? `${current.key} · ${current.name}` : 'Select a project'} position="right">
            <UnstyledButton aria-label="Current project" style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: '4px 0' }}>
              {mark(current)}
            </UnstyledButton>
          </Tooltip>
        ) : (
          <UnstyledButton className="ex-project-switch" aria-label="Current project">
            {mark(current)}
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" c="dimmed" lh={1.3}>
                Project
              </Text>
              <Text size="sm" fw={600} truncate lh={1.35}>
                {current ? current.name : 'Select a project'}
              </Text>
            </Box>
            <IconSelector size={16} color="var(--ex-muted)" />
          </UnstyledButton>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Switch project</Menu.Label>
        <ScrollArea.Autosize mah={360}>
          {active.map((x) => (
            <Menu.Item key={x.id} leftSection={mark(x)} rightSection={x.id === current?.id ? <IconCheck size={16} /> : null} onClick={() => onPick(x.id)}>
              <Text size="sm" fw={500} truncate>
                {x.name}
              </Text>
              <Text size="xs" c="dimmed">
                {x.key}
              </Text>
            </Menu.Item>
          ))}
          {archived.length > 0 && <Menu.Label>Archived</Menu.Label>}
          {archived.map((x) => (
            <Menu.Item key={x.id} leftSection={mark(x)} onClick={() => onPick(x.id)} rightSection={x.id === current?.id ? <IconCheck size={16} /> : null}>
              <Text size="sm" c="dimmed" truncate>
                {x.name}
              </Text>
            </Menu.Item>
          ))}
        </ScrollArea.Autosize>
        <Menu.Divider />
        <Menu.Item component={Link} to="/projects" leftSection={<IconFolders size={16} />}>
          All projects
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
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
  const [collapsed, setCollapsed] = useStoredState(NAV_COLLAPSED, false);
  const [closedGroups, setClosedGroups] = useStoredState<string[]>(NAV_GROUPS, []);
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
  // The mobile drawer always shows full labels; the icon rail applies from the `sm` breakpoint up.
  // Between `sm` and `md` the content area is too narrow for a full sidebar, so the rail is the
  // default there; the toggle expands it for this window size without changing the saved preference.
  const midWidth = useMediaQuery('(min-width: 48em) and (max-width: 61.99em)');
  const [midExpanded, setMidExpanded] = useState(false);
  const isCollapsed = midWidth ? !midExpanded : collapsed;
  const toggleRail = () => (midWidth ? setMidExpanded((v) => !v) : setCollapsed((v) => !v));
  const rail = isCollapsed && !opened;

  useHotkeys([
    ['mod+J', () => setColorScheme(scheme === 'dark' ? 'light' : 'dark')],
    ['mod+B', toggleRail],
    ['g m', () => navigate('/my-work')],
    ['shift+/', () => !inWorkbench && setHelpOpen(true)],
  ]);

  const path = location.pathname;
  const base = pid ? `/projects/${pid}` : '';
  const isActive = (to: string, exact = false) => (exact ? path === to : path === to || path.startsWith(`${to}/`));
  const item = ({ to, label, icon, exact }: NavEntry) => (
    <Tooltip key={to} label={label} position="right" disabled={!rail} openDelay={150}>
      <NavLink
        component={Link}
        to={to}
        label={label}
        aria-label={rail ? label : undefined}
        leftSection={icon}
        active={isActive(to, exact)}
        variant="subtle"
        className="ex-nav"
        data-rail={rail || undefined}
      />
    </Tooltip>
  );
  const group = (id: string, title: string, entries: NavEntry[]) => {
    const isOpen = rail || !closedGroups.includes(id);
    return (
      <Box key={id} role="group" aria-label={title}>
        {rail ? (
          <Divider my={8} mx={8} />
        ) : (
          <UnstyledButton
            className="ex-nav-section"
            aria-expanded={isOpen}
            onClick={() => setClosedGroups((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))}
          >
            <span>{title}</span>
            <IconChevronDown size={14} style={{ transform: isOpen ? undefined : 'rotate(-90deg)', transition: 'transform 150ms' }} aria-hidden />
          </UnstyledButton>
        )}
        <Collapse expanded={isOpen} transitionDuration={150}>
          <Stack gap={2} pt={rail ? 0 : 2}>
            {entries.map(item)}
          </Stack>
        </Collapse>
      </Box>
    );
  };

  const I = 18;
  return (
    <AppShell
      header={{ height: 52 }}
      navbar={{ width: rail ? 68 : 256, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding={{ base: 'md', md: 'lg' }}
      transitionDuration={150}
    >
      <AppShell.Header>
        <Group h="100%" px="sm" justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Tooltip label={`${isCollapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}>
              <ActionIcon variant="subtle" color="gray" size="lg" visibleFrom="sm" onClick={toggleRail} aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                {isCollapsed ? <IconLayoutSidebarLeftExpand size={20} /> : <IconLayoutSidebarLeftCollapse size={20} />}
              </ActionIcon>
            </Tooltip>
            <UnstyledButton component={Link} to="/" aria-label="Explorix home" px={4}>
              <Logo size={24} />
            </UnstyledButton>
            {org && (
              <Group gap={6} wrap="nowrap" visibleFrom="md" style={{ minWidth: 0 }}>
                <Text c="dimmed" aria-hidden>
                  /
                </Text>
                <Text size="sm" fw={500} c="dimmed" truncate maw={180}>
                  {org.name}
                </Text>
                {current && urlPid && (
                  <>
                    <Text c="dimmed" aria-hidden>
                      /
                    </Text>
                    <Text size="sm" fw={600} truncate maw={220} component={Link} to={base}>
                      {current.name}
                    </Text>
                  </>
                )}
              </Group>
            )}
          </Group>
          <UnstyledButton onClick={() => spotlight.open()} visibleFrom="sm" className="ex-header-search" aria-label="Search">
            <IconSearch size={16} />
            <Text size="sm" c="dimmed" truncate style={{ flex: 1 }}>
              Search or jump to…
            </Text>
            <Kbd size="xs">Ctrl K</Kbd>
          </UnstyledButton>
          <Group gap={4} wrap="nowrap" justify="flex-end" style={{ flex: 1 }}>
            <ActionIcon variant="subtle" color="gray" size="lg" hiddenFrom="sm" onClick={() => spotlight.open()} aria-label="Search">
              <IconSearch size={20} />
            </ActionIcon>
            <Tooltip label="Keyboard shortcuts (?)">
              <ActionIcon variant="subtle" color="gray" size="lg" visibleFrom="md" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
                <IconKeyboard size={20} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={`Switch to ${scheme === 'dark' ? 'light' : 'dark'} theme (Ctrl+J)`}>
              <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color scheme">
                {scheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
              </ActionIcon>
            </Tooltip>
            <NotificationsBell />
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <UnstyledButton aria-label="Account menu" ml={4} style={{ borderRadius: 999 }}>
                  <UserAvatar user={user} size={30} />
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Box px="sm" py={8}>
                  <Text size="sm" fw={600} truncate>
                    {user?.name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {user?.email}
                  </Text>
                </Box>
                <Menu.Divider />
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

      <AppShell.Navbar px={rail ? 6 : 'sm'} pt="sm" pb={6} aria-label="Main navigation">
        <AppShell.Section>
          <Stack gap={2}>
            {item({ to: '/', label: 'Overview', icon: <IconHome size={I} />, exact: true })}
            {item({ to: '/my-work', label: 'My Work', icon: <IconUserCheck size={I} /> })}
            {item({ to: '/projects', label: 'Projects', icon: <IconFolders size={I} />, exact: true })}
          </Stack>
          <Box mt="sm" mb={4}>
            <ProjectSwitcher list={list} current={current} rail={rail} onPick={(v) => navigate(`/projects/${v}`)} />
          </Box>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea} type="hover" scrollbarSize={6} mx={rail ? -6 : -12} px={rail ? 6 : 12}>
          {pid && (
            <Box pb="xs">
              <Stack gap={2} mt={4}>
                {item({ to: base, label: 'Project dashboard', icon: <IconLayoutDashboard size={I} />, exact: true })}
              </Stack>
              {group('explore', 'Exploratory testing', [
                { to: `${base}/charters`, label: 'Charters', icon: <IconTargetArrow size={I} /> },
                { to: `${base}/sessions`, label: 'Sessions', icon: <IconPlayerPlay size={I} /> },
                { to: `${base}/templates`, label: 'Session Templates', icon: <IconTemplate size={I} /> },
                { to: `${base}/findings`, label: 'Findings', icon: <IconBulb size={I} /> },
              ])}
              {group('quality', 'Test management', [
                { to: `${base}/test-cases`, label: 'Test Cases', icon: <IconChecklist size={I} /> },
                { to: `${base}/test-runs`, label: 'Test Runs', icon: <IconListCheck size={I} /> },
                { to: `${base}/automation`, label: 'Automation', icon: <IconRobot size={I} /> },
                { to: `${base}/issues`, label: 'Issues', icon: <IconBug size={I} /> },
                { to: `${base}/requirements`, label: 'Requirements', icon: <IconFlask size={I} /> },
              ])}
              {group('insights', 'Insights', [
                { to: `${base}/reports`, label: 'Reports', icon: <IconChartBar size={I} />, exact: true },
                { to: `${base}/reports/new`, label: 'Report builder', icon: <IconReportAnalytics size={I} /> },
                { to: `${base}/activity`, label: 'Activity', icon: <IconTimeline size={I} /> },
              ])}
              {group('project', 'Project', [
                { to: `${base}/integrations`, label: 'Integrations', icon: <IconPlugConnected size={I} /> },
                { to: `${base}/settings`, label: 'Project settings', icon: <IconAdjustments size={I} /> },
              ])}
            </Box>
          )}
        </AppShell.Section>
        {(isOrgAdmin || isDesktop) && (
          <AppShell.Section pt={6} style={{ borderTop: '1px solid var(--ex-border)' }}>
            <Stack gap={2}>
              {isOrgAdmin && item({ to: '/admin', label: 'Administration', icon: <IconSettings size={I} /> })}
              {isDesktop && item({ to: '/settings/desktop', label: 'Desktop settings', icon: <IconDeviceDesktop size={I} /> })}
            </Stack>
          </AppShell.Section>
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        <div className="ex-page">
          <Outlet />
        </div>
      </AppShell.Main>
      <GlobalSearch projectId={pid} />
      <ShortcutsHelp opened={helpOpen} onClose={() => setHelpOpen(false)} />
    </AppShell>
  );
}
