import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Menu,
  Modal,
  Paper,
  PasswordInput,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconBrandGithub,
  IconCheck,
  IconDots,
  IconEdit,
  IconHistory,
  IconLock,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconTrash,
  IconWebhook,
  IconX,
} from '@tabler/icons-react';
import { api, ApiError, p } from '../../lib/api';
import { fmtDateTime, fromNow } from '../../lib/format';
import { ROLE_RANK } from '../../lib/constants';
import { useProject } from '../../lib/project';
import { EmptyState, PageHeader, QueryState, toastError, toastOk } from '../../components/ui';
import { CopyCode } from '../../components/CopyCode';

type Integration = {
  id: string;
  provider: 'WEBHOOK' | 'GITHUB' | string;
  name: string;
  config: { url?: string; repo?: string; apiUrl?: string; labels?: string[] };
  events: string[];
  enabled: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastDeliveryAt: string | null;
  createdAt: string;
  hasSecret: boolean;
};

const EVENT_HELP: Record<string, string> = {
  'session.started': 'A session timer starts for the first time',
  'session.completed': 'A tester completes a session',
  'session.reviewed': 'A lead approves or requests changes',
  'finding.created': 'A finding is logged',
  'finding.converted': 'A finding is converted to an issue',
  'issue.created': 'An issue is created',
  'issue.updated': 'An issue changes',
  'test_run.closed': 'A manual test run is closed',
  'automation_run.completed': 'An automation run finishes ingesting',
};

export default function Integrations() {
  const { pid, project, role, can } = useProject();
  const canView = (ROLE_RANK[role] ?? 0) >= ROLE_RANK.LEAD;
  const canEdit = can('ADMIN');
  const q = useQuery({ queryKey: ['integrations', pid], queryFn: () => api.get(p(pid, '/integrations')), enabled: canView });
  const [webhook, setWebhook] = useState<Integration | 'new' | null>(null);
  const [github, setGithub] = useState<Integration | 'new' | null>(null);
  const [deliveries, setDeliveries] = useState<Integration | null>(null);

  return (
    <>
      <PageHeader kicker={project.key} title="Integrations" subtitle="Connect Explorix to CI pipelines, issue trackers and your own services." />
      {!canView ? (
        <Stack>
          <Alert color="gray" icon={<IconLock size={18} />} title="Leads and project admins only">
            Integration settings are visible to project leads and admins. You can still send automation results from CI with your own API token.
          </Alert>
          <IngestionCard pid={pid} />
        </Stack>
      ) : (
        <QueryState query={q}>
          {(d: any) => {
            const hooks = (d.integrations as Integration[]).filter((i) => i.provider === 'WEBHOOK');
            const gh = (d.integrations as Integration[]).filter((i) => i.provider === 'GITHUB');
            return (
              <Stack gap="xl">
                {!canEdit && (
                  <Alert color="blue" variant="light">
                    {project.archivedAt ? 'This project is archived — integrations are read-only.' : 'Only project admins can add, change or test integrations.'}
                  </Alert>
                )}
                <section>
                  <Title order={4} mb="sm">
                    Available integrations
                  </Title>
                  <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
                    {d.catalog.map((c: any) => (
                      <Paper key={c.key} withBorder p="sm" opacity={c.status === 'planned' ? 0.75 : 1}>
                        <Group justify="space-between" mb={4} wrap="nowrap">
                          <Text fw={600} size="sm">
                            {c.name}
                          </Text>
                          {c.status === 'available' ? (
                            <Badge size="xs" color="teal" variant="light">
                              Available
                            </Badge>
                          ) : (
                            <Badge size="xs" color="gray" variant="outline">
                              Planned — not yet implemented
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">
                          {c.description}
                        </Text>
                      </Paper>
                    ))}
                  </SimpleGrid>
                </section>

                <section>
                  <Group justify="space-between" mb="sm">
                    <Group gap={6}>
                      <IconWebhook size={20} />
                      <Title order={4}>Outgoing webhooks</Title>
                    </Group>
                    {canEdit && (
                      <Button leftSection={<IconPlus size={16} />} onClick={() => setWebhook('new')}>
                        Add webhook
                      </Button>
                    )}
                  </Group>
                  {hooks.length === 0 ? (
                    <EmptyState icon={<IconWebhook size={26} />} title="No webhooks" description="Send signed JSON events to your own services, chat relays or automation tools." />
                  ) : (
                    <IntegrationTable items={hooks} canEdit={canEdit} onEdit={setWebhook} onDeliveries={setDeliveries} />
                  )}
                  <WebhookDocs events={d.webhookEvents} />
                </section>

                <section>
                  <Group justify="space-between" mb="sm">
                    <Group gap={6}>
                      <IconBrandGithub size={20} />
                      <Title order={4}>GitHub Issues</Title>
                    </Group>
                    {canEdit && (
                      <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setGithub('new')}>
                        Connect repository
                      </Button>
                    )}
                  </Group>
                  <Text size="sm" c="dimmed" mb="sm">
                    One-way push: open an issue in Explorix and use <b>Push to GitHub</b> to create a linked GitHub issue. Status changes in GitHub are not synced back.
                  </Text>
                  {gh.length === 0 ? (
                    <EmptyState icon={<IconBrandGithub size={26} />} title="No GitHub repositories connected" />
                  ) : (
                    <IntegrationTable items={gh} canEdit={canEdit} onEdit={setGithub} />
                  )}
                </section>

                <IngestionCard pid={pid} />
              </Stack>
            );
          }}
        </QueryState>
      )}
      <WebhookModal value={webhook} events={q.data?.webhookEvents ?? []} onClose={() => setWebhook(null)} />
      <GithubModal value={github} onClose={() => setGithub(null)} />
      <DeliveriesModal integration={deliveries} onClose={() => setDeliveries(null)} />
    </>
  );
}

function StatusBadge({ i }: { i: Integration }) {
  if (!i.lastStatus) return <Text size="xs" c="dimmed">Never used</Text>;
  const ok = i.lastStatus === 'ok';
  return (
    <Tooltip label={i.lastError ?? 'Last delivery succeeded'} multiline maw={360}>
      <div>
        <Badge size="sm" variant="light" color={ok ? 'teal' : 'red'} leftSection={ok ? <IconCheck size={12} /> : <IconX size={12} />}>
          {ok ? 'OK' : 'Failing'}
        </Badge>
        {i.lastDeliveryAt && (
          <Text size="xs" c="dimmed">
            {fromNow(i.lastDeliveryAt)}
          </Text>
        )}
      </div>
    </Tooltip>
  );
}

function IntegrationTable({ items, canEdit, onEdit, onDeliveries }: { items: Integration[]; canEdit: boolean; onEdit: (i: Integration) => void; onDeliveries?: (i: Integration) => void }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['integrations', pid] });
  const toggle = useMutation({
    mutationFn: (i: Integration) => api.patch(p(pid, `/integrations/${i.id}`), { enabled: !i.enabled }),
    onSuccess: invalidate,
    onError: (e) => toastError(e),
  });
  const test = useMutation({
    mutationFn: (i: Integration) => api.post(p(pid, `/integrations/${i.id}/test`), {}),
    onSuccess: (r: any) => {
      const res = r.result;
      if (!res) toastError(new Error('Integration not found'));
      else if (res.success) toastOk(res.message ?? `Delivered (HTTP ${res.statusCode}) in ${res.durationMs} ms`, 'Test succeeded');
      else toastError(new Error(res.message ?? res.error ?? `HTTP ${res.statusCode}`), 'Test failed');
      invalidate();
      qc.invalidateQueries({ queryKey: ['integration-deliveries'] });
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: (i: Integration) => api.del(p(pid, `/integrations/${i.id}`)),
    onSuccess: () => {
      toastOk('Integration removed');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>{items[0]?.provider === 'GITHUB' ? 'Repository' : 'Endpoint & events'}</Table.Th>
              <Table.Th>Last delivery</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th w={60} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {i.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Added {fmtDateTime(i.createdAt)}
                  </Text>
                </Table.Td>
                <Table.Td maw={420}>
                  {i.provider === 'GITHUB' ? (
                    <>
                      <Text size="sm" ff="monospace">
                        {i.config.repo}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {i.config.apiUrl}
                        {i.config.labels?.length ? ` · labels: ${i.config.labels.join(', ')}` : ''} · token {i.hasSecret ? 'stored (encrypted)' : 'missing'}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text size="sm" ff="monospace" lineClamp={1}>
                        {i.config.url}
                      </Text>
                      <Group gap={4} mt={2}>
                        {i.events.map((e) => (
                          <Badge key={e} size="xs" variant="light" color="gray" tt="none">
                            {e}
                          </Badge>
                        ))}
                        {i.hasSecret ? (
                          <Badge size="xs" variant="outline" color="teal" leftSection={<IconLock size={10} />} tt="none">
                            signed
                          </Badge>
                        ) : (
                          <Badge size="xs" variant="outline" color="yellow" tt="none">
                            unsigned
                          </Badge>
                        )}
                      </Group>
                    </>
                  )}
                </Table.Td>
                <Table.Td>
                  <StatusBadge i={i} />
                </Table.Td>
                <Table.Td>
                  <Switch checked={i.enabled} disabled={!canEdit} onChange={() => toggle.mutate(i)} aria-label={`Enable ${i.name}`} />
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${i.name}`}>
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {canEdit && (
                        <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => test.mutate(i)} disabled={test.isPending}>
                          {i.provider === 'GITHUB' ? 'Test connection' : 'Send test ping'}
                        </Menu.Item>
                      )}
                      {onDeliveries && (
                        <Menu.Item leftSection={<IconHistory size={14} />} onClick={() => onDeliveries(i)}>
                          Delivery log
                        </Menu.Item>
                      )}
                      {canEdit && (
                        <>
                          <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEdit(i)}>
                            Edit
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() =>
                              modals.openConfirmModal({
                                title: `Remove ${i.name}?`,
                                children: <Text size="sm">The integration and its delivery log are deleted. Issues already pushed to GitHub keep their links.</Text>,
                                labels: { confirm: 'Remove', cancel: 'Cancel' },
                                confirmProps: { color: 'red' },
                                onConfirm: () => del.mutate(i),
                              })
                            }
                          >
                            Remove
                          </Menu.Item>
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

function WebhookModal({ value, events, onClose }: { value: Integration | 'new' | null; events: string[]; onClose: () => void }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const editing = value && value !== 'new' ? value : null;
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [secretMode, setSecretMode] = useState<'keep' | 'set' | 'remove'>('set');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!value) return;
    setErrors({});
    setSecret('');
    if (value === 'new') {
      setName('');
      setUrl('');
      setSelected([...events]);
      setEnabled(true);
      setSecretMode('set');
      setSecret(randomSecret());
    } else {
      setName(value.name);
      setUrl(value.config.url ?? '');
      setSelected(value.events);
      setEnabled(value.enabled);
      setSecretMode(value.hasSecret ? 'keep' : 'set');
    }
  }, [value, events]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: name.trim(), url: url.trim(), events: selected, enabled };
      if (secretMode === 'set' && secret) body.secret = secret;
      if (editing && secretMode === 'remove') body.secret = null;
      return editing ? api.patch(p(pid, `/integrations/${editing.id}`), body) : api.post(p(pid, '/integrations'), { provider: 'WEBHOOK', ...body });
    },
    onSuccess: () => {
      toastOk(editing ? 'Webhook updated' : 'Webhook created');
      qc.invalidateQueries({ queryKey: ['integrations', pid] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e);
    },
  });

  return (
    <Modal opened={!!value} onClose={onClose} title={editing ? `Edit webhook · ${editing.name}` : 'Add webhook'} size="lg">
      <Stack gap="sm">
        <TextInput label="Name" required value={name} onChange={(e) => setName(e.currentTarget.value)} error={errors.name} maxLength={100} />
        <TextInput label="Payload URL" required placeholder="https://example.com/hooks/explorix" value={url} onChange={(e) => setUrl(e.currentTarget.value)} error={errors.url} description="Must be http(s). In production, private and loopback addresses are rejected." />
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>
              Events
            </Text>
            <Group gap="xs">
              <Anchor size="xs" component="button" type="button" onClick={() => setSelected([...events])}>
                All
              </Anchor>
              <Anchor size="xs" component="button" type="button" onClick={() => setSelected([])}>
                None
              </Anchor>
            </Group>
          </Group>
          <Checkbox.Group value={selected} onChange={setSelected} error={errors.events}>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
              {events.map((e) => (
                <Checkbox key={e} value={e} label={<Code>{e}</Code>} description={EVENT_HELP[e]} />
              ))}
            </SimpleGrid>
          </Checkbox.Group>
        </div>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Signing secret
          </Text>
          {editing && (
            <SegmentedControl
              size="xs"
              mb="xs"
              value={secretMode}
              onChange={(v) => {
                setSecretMode(v as 'keep' | 'set' | 'remove');
                if (v === 'set' && !secret) setSecret(randomSecret());
              }}
              data={[
                ...(editing.hasSecret ? [{ value: 'keep', label: 'Keep current' }] : []),
                { value: 'set', label: editing.hasSecret ? 'Replace' : 'Set secret' },
                ...(editing.hasSecret ? [{ value: 'remove', label: 'Remove' }] : []),
              ]}
            />
          )}
          {secretMode === 'set' && (
            <>
              <Group gap="xs" align="flex-start" wrap="nowrap">
                <TextInput style={{ flex: 1 }} value={secret} onChange={(e) => setSecret(e.currentTarget.value)} error={errors.secret} ff="monospace" placeholder="Leave empty to send unsigned requests" />
                <Tooltip label="Generate a new random secret">
                  <ActionIcon variant="default" size="lg" onClick={() => setSecret(randomSecret())} aria-label="Generate secret">
                    <IconRefresh size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Text size="xs" c="orange.8" mt={4}>
                Copy this secret into your receiver now — it is stored encrypted and can't be shown again. 8–200 characters. Requires <Code>ENCRYPTION_KEY</Code> on the server.
              </Text>
            </>
          )}
          {secretMode === 'keep' && (
            <Text size="xs" c="dimmed">
              A secret is configured. It cannot be displayed; replace it if you lost it.
            </Text>
          )}
          {secretMode === 'remove' && (
            <Text size="xs" c="orange.8">
              Requests will be sent without an <Code>x-explorix-signature</Code> header.
            </Text>
          )}
        </div>
        <Switch label="Enabled" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || !url.trim() || selected.length === 0 || (secretMode === 'set' && !!secret && secret.length < 8)}>
            {editing ? 'Save' : 'Create webhook'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function GithubModal({ value, onClose }: { value: Integration | 'new' | null; onClose: () => void }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const editing = value && value !== 'new' ? value : null;
  const [form, setForm] = useState({ name: '', repo: '', token: '', apiUrl: '', labels: [] as string[], enabled: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!value) return;
    setErrors({});
    setForm(
      value === 'new'
        ? { name: 'GitHub', repo: '', token: '', apiUrl: '', labels: ['explorix'], enabled: true }
        : { name: value.name, repo: value.config.repo ?? '', token: '', apiUrl: value.config.apiUrl ?? '', labels: value.config.labels ?? [], enabled: value.enabled },
    );
  }, [value]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name: form.name.trim(), repo: form.repo.trim(), labels: form.labels, enabled: form.enabled };
      if (form.apiUrl.trim()) body.apiUrl = form.apiUrl.trim();
      if (form.token) body.token = form.token;
      return editing ? api.patch(p(pid, `/integrations/${editing.id}`), body) : api.post(p(pid, '/integrations'), { provider: 'GITHUB', ...body });
    },
    onSuccess: () => {
      toastOk(editing ? 'GitHub integration updated' : 'GitHub repository connected');
      qc.invalidateQueries({ queryKey: ['integrations', pid] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toastError(e);
    },
  });
  return (
    <Modal opened={!!value} onClose={onClose} title={editing ? `Edit · ${editing.name}` : 'Connect GitHub repository'} size="md">
      <Stack gap="sm">
        <TextInput label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} error={errors.name} />
        <TextInput label="Repository" required placeholder="owner/repository" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.currentTarget.value })} error={errors.repo} />
        <PasswordInput
          label="Access token"
          required={!editing}
          placeholder={editing ? 'Leave empty to keep the stored token' : 'github_pat_…'}
          description="Fine-grained token with Issues: read & write on this repository. Stored encrypted (requires ENCRYPTION_KEY on the server); never shown again."
          value={form.token}
          onChange={(e) => setForm({ ...form, token: e.currentTarget.value })}
          error={errors.token}
        />
        <TextInput label="API URL" placeholder="https://api.github.com" description="Only for GitHub Enterprise Server" value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.currentTarget.value })} error={errors.apiUrl} />
        <TagsInput label="Labels" description="Applied to issues created in GitHub (max 10)" value={form.labels} onChange={(v) => setForm({ ...form, labels: v.slice(0, 10) })} error={errors.labels} />
        <Switch label="Enabled" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim() || !form.repo.trim() || (!editing && form.token.length < 10)}>
            {editing ? 'Save' : 'Connect'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function DeliveriesModal({ integration, onClose }: { integration: Integration | null; onClose: () => void }) {
  const { pid } = useProject();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['integration-deliveries', integration?.id],
    queryFn: () => api.get(p(pid, `/integrations/${integration!.id}/deliveries`)),
    enabled: !!integration,
  });
  return (
    <Modal opened={!!integration} onClose={onClose} title={`Delivery log · ${integration?.name ?? ''}`} size="xl">
      <Group justify="space-between" mb="xs">
        <Text size="xs" c="dimmed">
          Latest 50 attempts. Failed deliveries are recorded but not retried automatically.
        </Text>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={() => q.refetch()} loading={q.isFetching}>
          Refresh
        </Button>
      </Group>
      <QueryState query={q}>
        {(d: any) =>
          d.deliveries.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="lg">
              No deliveries yet. Send a test ping to try it.
            </Text>
          ) : (
            <Table verticalSpacing={6} fz="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Event</Table.Th>
                  <Table.Th>Result</Table.Th>
                  <Table.Th>Duration</Table.Th>
                  <Table.Th>Error</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.deliveries.map((x: any) => (
                  <Fragment key={x.id}>
                    <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === x.id ? null : x.id)}>
                      <Table.Td>{fmtDateTime(x.createdAt)}</Table.Td>
                      <Table.Td>
                        <Code>{x.event}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={x.success ? 'teal' : 'red'}>
                          {x.statusCode ?? '—'} {x.success ? 'OK' : 'failed'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{x.durationMs != null ? `${x.durationMs} ms` : '—'}</Table.Td>
                      <Table.Td>
                        <Text size="xs" c="red.7" lineClamp={1}>
                          {x.error ?? ''}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                    {open === x.id && (
                      <Table.Tr>
                        <Table.Td colSpan={5}>
                          <ScrollArea.Autosize mah={260}>
                            <Code block fz={11}>
                              {JSON.stringify(x.payload, null, 2)}
                            </Code>
                          </ScrollArea.Autosize>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                ))}
              </Table.Tbody>
            </Table>
          )
        }
      </QueryState>
    </Modal>
  );
}

function WebhookDocs({ events }: { events: string[] }) {
  const verify = `// Node.js (Express) — verify an Explorix webhook
import crypto from 'node:crypto';

app.post('/hooks/explorix', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.header('x-explorix-timestamp');
  const sig = req.header('x-explorix-signature') ?? '';
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.EXPLORIX_WEBHOOK_SECRET)
    .update(\`\${ts}.\${req.body}\`).digest('hex');
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.status(401).end();
  const { event, deliveredAt, projectId, data } = JSON.parse(req.body);
  // ...handle event
  res.status(204).end();
});`;
  return (
    <Paper withBorder p="md" mt="md">
      <Title order={6} mb={4}>
        Delivery format
      </Title>
      <Text size="sm" mb="xs">
        Each event is sent as <Code>POST</Code> with a JSON body <Code>{'{ event, deliveredAt, projectId, data }'}</Code> and headers <Code>x-explorix-event</Code>,{' '}
        <Code>x-explorix-timestamp</Code> (Unix seconds) and, when a secret is set, <Code>x-explorix-signature: sha256=HMAC_SHA256(secret, "&lt;timestamp&gt;.&lt;raw body&gt;")</Code>. Requests time out
        after 10 s; any non-2xx response is recorded as a failure. Events: {events.map((e) => e).join(', ')} (plus <Code>ping</Code> for tests).
      </Text>
      <CopyCode code={verify} label="Signature verification example" maxHeight={260} />
    </Paper>
  );
}

function IngestionCard({ pid }: { pid: string }) {
  return (
    <Paper withBorder p="md">
      <Group gap={6} mb={4}>
        <IconRobot size={20} />
        <Title order={4}>Automation results from CI</Title>
        <Badge size="xs" color="teal" variant="light">
          Available via REST API
        </Badge>
      </Group>
      <Text size="sm" mb="sm">
        GitHub Actions, GitLab CI, Jenkins and any other CI can upload JUnit XML, Playwright JSON or native JSON results with a personal API token. There are no CI plugins to install — the pipeline step is
        a single <Code>curl</Code> call.
      </Text>
      <Group gap="sm">
        <Button component={Link} to={`/projects/${pid}/automation?tab=setup`} variant="light">
          Open CI setup guide
        </Button>
        <Button component={Link} to="/profile" variant="default">
          Manage API tokens
        </Button>
      </Group>
    </Paper>
  );
}
