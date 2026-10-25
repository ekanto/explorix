import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Group,
  List,
  Menu,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArchive, IconArrowBackUp, IconCopy, IconDots, IconEdit, IconEye, IconPlus, IconTemplate, IconWand } from '@tabler/icons-react';
import { api, ApiError, p } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { minutes } from '../../lib/format';
import { useProject } from '../../lib/project';
import { ListEditor } from '../../components/ListEditor';
import { SearchInput } from '../../components/ListFilters';
import { EmptyState, PageHeader, QueryState, TextBlock, toastError, toastOk } from '../../components/ui';

/** Charter text fields a template may prefill (keys match the charter API / CharterForm). */
const DEFAULT_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'target', label: 'Target / feature' },
  { key: 'scope', label: 'In scope' },
  { key: 'outOfScope', label: 'Out of scope' },
  { key: 'objectives', label: 'Objectives' },
  { key: 'learningGoals', label: 'Learning goals' },
  { key: 'risks', label: 'Target risks', hint: 'One risk per line' },
  { key: 'assumptions', label: 'Assumptions & constraints' },
  { key: 'prerequisites', label: 'Prerequisites' },
  { key: 'testData', label: 'Test data' },
  { key: 'exitCriteria', label: 'Exit criteria' },
  { key: 'environmentNotes', label: 'Environment notes' },
];
const fieldLabel = (k: string) => DEFAULT_FIELDS.find((f) => f.key === k)?.label ?? k;

function scopeOf(t: any): { label: string; color: string; tip: string } {
  if (t.isSystem) return { label: 'Built-in', color: 'grape', tip: 'Shipped with Explorix, available in every project of the organization' };
  if (t.projectId === null) return { label: 'Organization', color: 'blue', tip: 'Shared by all projects in the organization' };
  return { label: 'Project', color: 'teal', tip: 'Only available in this project' };
}

export default function Templates() {
  const { pid, can } = useProject();
  const { isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null | 'new'>(null);

  const query = useQuery({
    queryKey: ['templates', pid, { includeArchived: showArchived }],
    queryFn: () => api.get(p(pid, '/templates'), showArchived ? { includeArchived: 'true' } : undefined),
  });

  const isLead = can('LEAD');
  const canManage = (t: any) => isLead && (t.projectId !== null || isOrgAdmin);
  const canUse = can('TESTER');
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates', pid] });

  const use = (t: any) => navigate(`/projects/${pid}/charters/new?template=${t.id}`);

  const duplicate = async (t: any) => {
    try {
      const r = await api.post(p(pid, `/templates/${t.id}/duplicate`));
      toastOk(`Created "${r.template.name}" in this project`);
      refresh();
      setEditing(r.template);
    } catch (e) {
      toastError(e, 'Could not duplicate template');
    }
  };

  const archive = (t: any, action: 'archive' | 'unarchive') => {
    const run = async () => {
      try {
        await api.post(p(pid, `/templates/${t.id}/${action}`));
        toastOk(action === 'archive' ? `"${t.name}" archived` : `"${t.name}" restored`);
        refresh();
      } catch (e) {
        toastError(e);
      }
    };
    if (action === 'unarchive') return void run();
    modals.openConfirmModal({
      title: `Archive "${t.name}"?`,
      children: (
        <Text size="sm">
          It will no longer be offered when creating charters{t.projectId === null ? ' in any project of the organization' : ''}. Existing charters created from it ({t._count?.charters ?? 0}) are not changed.
        </Text>
      ),
      labels: { confirm: 'Archive', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: run,
    });
  };

  return (
    <>
      <PageHeader
        title="Session templates"
        subtitle="Reusable charter blueprints — a mission pattern, timebox, heuristics and test ideas that prefill new charters."
        actions={
          isLead && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              New template
            </Button>
          )
        }
      />
      <QueryState query={query}>
        {(d: any) => (
          <TemplateGrid
            templates={d.templates}
            q={q}
            setQ={setQ}
            category={category}
            setCategory={setCategory}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            onView={setViewing}
            onUse={canUse ? use : undefined}
            onEdit={(t) => setEditing(t)}
            onDuplicate={isLead ? duplicate : undefined}
            onArchive={archive}
            canManage={canManage}
            onNew={isLead ? () => setEditing('new') : undefined}
          />
        )}
      </QueryState>

      <Modal opened={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} size="lg">
        {viewing && (
          <TemplateDetails
            template={viewing}
            onUse={
              canUse && !viewing.archivedAt
                ? () => {
                    setViewing(null);
                    use(viewing);
                  }
                : undefined
            }
          />
        )}
      </Modal>
      <TemplateEditor
        opened={editing !== null}
        template={editing === 'new' ? null : editing}
        canOrgScope={isOrgAdmin}
        onClose={() => setEditing(null)}
        onSaved={() => {
          refresh();
          setEditing(null);
        }}
      />
    </>
  );
}

function TemplateGrid(props: {
  templates: any[];
  q: string;
  setQ: (v: string) => void;
  category: string | null;
  setCategory: (v: string | null) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  onView: (t: any) => void;
  onUse?: (t: any) => void;
  onEdit: (t: any) => void;
  onDuplicate?: (t: any) => void;
  onArchive: (t: any, a: 'archive' | 'unarchive') => void;
  canManage: (t: any) => boolean;
  onNew?: () => void;
}) {
  const { templates, q, category } = props;
  const categories = useMemo(() => [...new Set(templates.map((t) => t.category))].sort(), [templates]);
  const filtered = templates.filter((t) => {
    if (category && t.category !== category) return false;
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [t.name, t.description, t.missionTemplate, t.category, ...(t.heuristics ?? [])].some((x) => x?.toLowerCase().includes(s));
  });
  const groups = new Map<string, any[]>();
  for (const t of filtered) groups.set(t.category, [...(groups.get(t.category) ?? []), t]);

  return (
    <>
      <Group mb="md" gap="sm">
        <SearchInput value={q} onChange={props.setQ} placeholder="Search templates…" w={260} />
        <Select placeholder="All categories" data={categories} value={category} onChange={props.setCategory} clearable w={200} />
        <Switch label="Show archived" checked={props.showArchived} onChange={(e) => props.setShowArchived(e.currentTarget.checked)} />
        <Text size="sm" c="dimmed" ml="auto">
          {filtered.length} template{filtered.length === 1 ? '' : 's'}
        </Text>
      </Group>
      {templates.length === 0 ? (
        <EmptyState
          icon={<IconTemplate size={26} />}
          title="No templates yet"
          description="Templates capture a proven way to explore — e.g. a security tour or an onboarding walkthrough — so anyone can start a charter from it."
          action={props.onNew && <Button onClick={props.onNew}>Create the first template</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No templates match" description="Try a different search or category." />
      ) : (
        <Stack gap="xl">
          {[...groups.entries()].map(([cat, items]) => (
            <div key={cat}>
              <Title order={5} mb="sm">
                {cat}{' '}
                <Text span c="dimmed" fw={400} size="sm">
                  ({items.length})
                </Text>
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md">
                {items.map((t) => (
                  <TemplateCard key={t.id} t={t} {...props} />
                ))}
              </SimpleGrid>
            </div>
          ))}
        </Stack>
      )}
    </>
  );
}

function TemplateCard({ t, onView, onUse, onEdit, onDuplicate, onArchive, canManage }: { t: any } & Parameters<typeof TemplateGrid>[0]) {
  const scope = scopeOf(t);
  const manage = canManage(t);
  const archived = !!t.archivedAt;
  return (
    <Card withBorder padding="md" style={{ display: 'flex', flexDirection: 'column', opacity: archived ? 0.7 : 1 }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" mb={6}>
        <Text fw={600} lineClamp={2} style={{ cursor: 'pointer' }} onClick={() => onView(t)}>
          {t.name}
        </Text>
        {(manage || onDuplicate) && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${t.name}`}>
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {manage && !archived && (
                <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEdit(t)}>
                  Edit
                </Menu.Item>
              )}
              {onDuplicate && (
                <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => onDuplicate(t)}>
                  Duplicate into project
                </Menu.Item>
              )}
              {manage &&
                (archived ? (
                  <Menu.Item leftSection={<IconArrowBackUp size={14} />} onClick={() => onArchive(t, 'unarchive')}>
                    Unarchive
                  </Menu.Item>
                ) : (
                  <Menu.Item leftSection={<IconArchive size={14} />} color="red" onClick={() => onArchive(t, 'archive')}>
                    Archive
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Group gap={6} mb="sm">
        <Tooltip label={scope.tip} withArrow>
          <Badge size="sm" variant="light" color={scope.color}>
            {scope.label}
          </Badge>
        </Tooltip>
        <Badge size="sm" variant="outline" color="gray">
          {minutes(t.timeboxMinutes)}
        </Badge>
        {archived && (
          <Badge size="sm" color="dark" variant="light">
            Archived
          </Badge>
        )}
      </Group>
      {t.description && (
        <Text size="sm" c="dimmed" lineClamp={2} mb="xs">
          {t.description}
        </Text>
      )}
      <Text size="sm" fs="italic" lineClamp={3} mb="sm">
        “{t.missionTemplate}”
      </Text>
      <Text size="xs" c="dimmed" mt="auto">
        {t.heuristics.length} heuristic{t.heuristics.length === 1 ? '' : 's'} · {t.testIdeas.length} test idea{t.testIdeas.length === 1 ? '' : 's'} · used by {t._count?.charters ?? 0} charter
        {t._count?.charters === 1 ? '' : 's'}
      </Text>
      <Group gap="xs" mt="sm">
        {onUse && !archived && (
          <Button size="xs" leftSection={<IconWand size={14} />} onClick={() => onUse(t)}>
            Use template
          </Button>
        )}
        <Button size="xs" variant="default" leftSection={<IconEye size={14} />} onClick={() => onView(t)}>
          Details
        </Button>
      </Group>
    </Card>
  );
}

function TemplateDetails({ template: t, onUse }: { template: any; onUse?: () => void }) {
  const scope = scopeOf(t);
  const defaults = Object.entries((t.defaults ?? {}) as Record<string, string>).filter(([, v]) => v);
  return (
    <Stack gap="md">
      <Group gap={6}>
        <Badge variant="light" color={scope.color}>
          {scope.label}
        </Badge>
        <Badge variant="light" color="gray">
          {t.category}
        </Badge>
        <Badge variant="outline" color="gray">
          {minutes(t.timeboxMinutes)} timebox
        </Badge>
      </Group>
      <TextBlock label="Description" value={t.description} />
      <TextBlock label="Mission template" value={<span className="ex-prewrap">{t.missionTemplate}</span>} />
      <TextBlock
        label="Heuristics"
        value={
          t.heuristics.length ? (
            <Group gap={6}>
              {t.heuristics.map((h: string) => (
                <Badge key={h} variant="light" color="grape" style={{ textTransform: 'none' }}>
                  {h}
                </Badge>
              ))}
            </Group>
          ) : null
        }
      />
      <TextBlock
        label="Test ideas"
        value={
          t.testIdeas.length ? (
            <List size="sm" spacing={2}>
              {t.testIdeas.map((x: string, i: number) => (
                <List.Item key={i}>{x}</List.Item>
              ))}
            </List>
          ) : null
        }
      />
      {defaults.map(([k, v]) => (
        <TextBlock key={k} label={`Default: ${fieldLabel(k)}`} value={<span className="ex-prewrap">{v}</span>} />
      ))}
      <Text size="xs" c="dimmed">
        Used by {t._count?.charters ?? 0} charter(s){t.createdBy ? ` · created by ${t.createdBy.name}` : ''}
      </Text>
      {onUse && (
        <Group justify="flex-end">
          <Button leftSection={<IconWand size={16} />} onClick={onUse}>
            Use template
          </Button>
        </Group>
      )}
    </Stack>
  );
}

type Form = {
  name: string;
  category: string;
  description: string;
  missionTemplate: string;
  timeboxMinutes: number;
  heuristics: string[];
  testIdeas: string[];
  defaults: Record<string, string>;
  scope: 'project' | 'org';
};

const emptyForm: Form = {
  name: '',
  category: '',
  description: '',
  missionTemplate: 'Explore [target] using [resources/approach] to discover [information/risks]',
  timeboxMinutes: 60,
  heuristics: [],
  testIdeas: [],
  defaults: {},
  scope: 'project',
};

function TemplateEditor({ opened, template, canOrgScope, onClose, onSaved }: { opened: boolean; template: any | null; canOrgScope: boolean; onClose: () => void; onSaved: () => void }) {
  const { pid } = useProject();
  const qc = useQueryClient();
  const [v, setV] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState<unknown>(null);

  // Reset the form whenever the modal opens for a different target.
  const key = opened ? (template?.id ?? 'new') : null;
  if (key !== lastOpen) {
    setLastOpen(key);
    if (key) {
      setErrors({});
      setV(
        template
          ? {
              name: template.name,
              category: template.category,
              description: template.description ?? '',
              missionTemplate: template.missionTemplate,
              timeboxMinutes: template.timeboxMinutes,
              heuristics: template.heuristics ?? [],
              testIdeas: template.testIdeas ?? [],
              defaults: { ...((template.defaults ?? {}) as Record<string, string>) },
              scope: template.projectId === null ? 'org' : 'project',
            }
          : emptyForm,
      );
    }
  }

  const existingCats = qc.getQueriesData<any>({ queryKey: ['templates', pid] }).flatMap(([, d]) => (d?.templates ?? []).map((t: any) => t.category as string));
  const categories = [...new Set([...existingCats, 'General', 'Functional', 'Security', 'Usability', 'Performance', 'Accessibility', 'Regression'])].sort();

  const set = <K extends keyof Form>(k: K, val: Form[K]) => setV((s) => ({ ...s, [k]: val }));

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!v.name.trim()) errs.name = 'Name is required';
    if (!v.category.trim()) errs.category = 'Category is required';
    if (!v.missionTemplate.trim()) errs.missionTemplate = 'Mission template is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const defaults = Object.fromEntries(Object.entries(v.defaults).filter(([, x]) => x.trim()));
    const body: Record<string, unknown> = {
      name: v.name.trim(),
      category: v.category.trim(),
      description: v.description.trim() || null,
      missionTemplate: v.missionTemplate.trim(),
      timeboxMinutes: v.timeboxMinutes,
      heuristics: v.heuristics,
      testIdeas: v.testIdeas,
      defaults,
    };
    if (!template) body.scope = v.scope;
    setSaving(true);
    try {
      if (template) await api.patch(p(pid, `/templates/${template.id}`), body);
      else await api.post(p(pid, '/templates'), body);
      toastOk(template ? 'Template saved' : 'Template created');
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, m]) => [k.split('.')[0], m])));
      toastError(e, 'Could not save template');
    } finally {
      setSaving(false);
    }
  };

  const filledDefaults = DEFAULT_FIELDS.filter((f) => v.defaults[f.key]?.trim()).length;

  return (
    <Modal opened={opened} onClose={onClose} title={template ? `Edit template` : 'New session template'} size="xl">
      <Stack gap="md">
        <Group grow align="flex-start">
          <TextInput label="Name" required value={v.name} onChange={(e) => set('name', e.currentTarget.value)} error={errors.name} maxLength={120} data-autofocus />
          <Autocomplete
            label="Category"
            required
            data={categories}
            value={v.category}
            onChange={(x) => set('category', x)}
            placeholder="Pick or type a new one"
            error={errors.category}
            maxLength={60}
          />
          <NumberInput label="Default timebox (minutes)" min={5} max={480} step={15} value={v.timeboxMinutes} onChange={(x) => set('timeboxMinutes', Number(x) || 60)} error={errors.timeboxMinutes} />
        </Group>
        <Textarea label="Description" description="When should testers use this template?" autosize minRows={2} value={v.description} onChange={(e) => set('description', e.currentTarget.value)} error={errors.description} />
        <Textarea
          label="Mission template"
          required
          description="Use [brackets] for the parts testers fill in, e.g. Explore [target] using [approach] to discover [risks]"
          autosize
          minRows={2}
          value={v.missionTemplate}
          onChange={(e) => set('missionTemplate', e.currentTarget.value)}
          error={errors.missionTemplate}
        />
        <Group grow align="flex-start">
          <ListEditor label="Heuristics" description="Oracles / tours to apply, e.g. CRUD, Goldilocks, SFDIPOT" value={v.heuristics} onChange={(x) => set('heuristics', x)} placeholder="Add heuristic and press Enter" error={errors.heuristics} max={100} />
          <ListEditor label="Test ideas" value={v.testIdeas} onChange={(x) => set('testIdeas', x)} placeholder="Add test idea and press Enter" error={errors.testIdeas} max={100} />
        </Group>
        <Accordion variant="contained">
          <Accordion.Item value="defaults">
            <Accordion.Control>
              Default charter fields{' '}
              <Text span size="sm" c="dimmed">
                ({filledDefaults} set — only prefilled into empty charter fields)
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {DEFAULT_FIELDS.map((f) => (
                  <Textarea
                    key={f.key}
                    label={f.label}
                    description={f.hint}
                    autosize
                    minRows={2}
                    maxRows={6}
                    value={v.defaults[f.key] ?? ''}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setV((s) => ({ ...s, defaults: { ...s.defaults, [f.key]: val } }));
                    }}
                  />
                ))}
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt="sm">
                Custom field defaults aren't supported by templates yet — set custom fields on each charter.
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        {!template && (
          <div>
            <Text size="sm" fw={500} mb={4}>
              Availability
            </Text>
            <SegmentedControl
              value={v.scope}
              onChange={(x) => set('scope', x as Form['scope'])}
              data={[
                { value: 'project', label: 'This project' },
                { value: 'org', label: 'Whole organization', disabled: !canOrgScope },
              ]}
            />
            {!canOrgScope && (
              <Text size="xs" c="dimmed" mt={4}>
                Only organization admins can publish organization-wide templates.
              </Text>
            )}
          </div>
        )}
        {template?.projectId === null && (
          <Alert color="blue" variant="light">
            This is an organization-wide template — changes apply to every project.
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {template ? 'Save changes' : 'Create template'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
