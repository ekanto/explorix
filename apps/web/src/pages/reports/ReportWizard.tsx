import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  ColorInput,
  Divider,
  FileButton,
  Grid,
  Group,
  Image,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  Radio,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconDeviceFloppy,
  IconDownload,
  IconExternalLink,
  IconFileTypeDocx,
  IconFileTypeHtml,
  IconFileTypePdf,
  IconFolder,
  IconHistory,
  IconMarkdown,
  IconPhoto,
  IconRefresh,
  IconReportAnalytics,
  IconVideo,
  IconX,
} from '@tabler/icons-react';
import { api, download, p } from '../../lib/api';
import { desktop } from '../../lib/desktop';
import { bytes, fmtDateTime } from '../../lib/format';
import { useProject } from '../../lib/project';
import { ClassificationBadge, EmptyState, PageHeader, SeverityBadge, toastError, toastOk } from '../../components/ui';
import { fmtDuration } from '../../components/evidence/media';

// ----------------------------------------------------------------------------- API types

type Kind = 'SESSION' | 'BUG_INVESTIGATION' | 'PROJECT_SUMMARY' | 'RELEASE_READINESS' | 'REGRESSION' | 'SECURITY' | 'EVIDENCE' | 'CUSTOM';
type Format = 'pdf' | 'docx' | 'md' | 'html';
type PackageMode = 'none' | 'folder' | 'zip';
type Scope =
  | { type: 'finding'; findingId: string }
  | { type: 'findings'; findingIds: string[] }
  | { type: 'session'; sessionId: string }
  | { type: 'charter'; charterId: string }
  | { type: 'milestone'; milestoneId: string }
  | { type: 'project' };
type ScopeType = Scope['type'];

interface Options {
  title?: string;
  subtitle?: string;
  author?: string;
  sections?: Record<string, boolean>;
  severities?: string[];
  dateFrom?: string;
  dateTo?: string;
  findingIds?: string[];
  excludeEvidenceIds?: string[];
  includeImages?: boolean;
  includeVideos?: boolean;
  includeAttachments?: boolean;
  includeComments?: boolean;
  preferAnnotated?: boolean;
  showMetadata?: boolean;
  orientation?: 'portrait' | 'landscape';
  imageSize?: 'small' | 'medium' | 'large';
  branding?: { organization?: string; accentColor?: string; logoDataUrl?: string; confidentiality?: string };
}

interface Templates {
  builtIn: { kind: Kind; name: string; description: string; sections: Record<string, boolean>; defaults: Options; defaultBaseName: string }[];
  saved: { id: string; name: string; kind: Kind; description: string | null; options: Options; createdBy: { id: string; name: string } | null }[];
  sections: { key: string; title: string }[];
  formats: Format[];
  pdfAvailable: boolean;
}

interface Candidates {
  scopeLabel: string | null;
  findings: { id: string; key: string; title: string; severity: string | null; priority: string; status: string; classification: { name: string; color: string; isDefect?: boolean } | null; sessionKey: string | null; evidenceCount: number }[];
  evidence: { id: string; kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'OTHER'; title: string; fileName: string; size: number; caption: string | null; findingId: string | null; findingKey: string | null; sessionKey: string | null; durationSeconds: number | null; annotated: boolean; thumbUrl: string | null }[];
}

interface Preview {
  html: string;
  title: string;
  findingCount: number;
  evidenceCount: number;
  videoCount: number;
  defaultBaseName: string;
}

interface Job {
  id: string;
  runId: string | null;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  phase: string;
  progress: number;
  error: string | null;
  warnings: string[];
  baseName: string;
  formats: Format[];
  packageMode: PackageMode;
  outputs: { name: string; type: 'file' | 'folder'; formats: Format[]; bytes: number; description: string }[];
  findingCount: number;
  evidenceCount: number;
}

// ----------------------------------------------------------------------------- constants

const FORMAT_META: Record<Format, { label: string; icon: React.ReactNode; video: string }> = {
  pdf: { label: 'PDF', icon: <IconFileTypePdf size={18} />, video: 'Thumbnail, captured frames, timestamps and the original file name (bundled in packages).' },
  docx: { label: 'Word (DOCX)', icon: <IconFileTypeDocx size={18} />, video: 'Editable document with static preview images, timestamps and a reference to the original video.' },
  md: { label: 'Markdown', icon: <IconMarkdown size={18} />, video: 'Preview image plus a relative link to the video in the evidence/ folder.' },
  html: { label: 'HTML', icon: <IconFileTypeHtml size={18} />, video: 'Plays the bundled video inline when opened from its folder.' },
};
const SEVERITY_OPTIONS = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'].map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }));
const DEFAULT_KIND: Record<ScopeType, Kind> = { finding: 'BUG_INVESTIGATION', findings: 'BUG_INVESTIGATION', session: 'SESSION', charter: 'SESSION', milestone: 'RELEASE_READINESS', project: 'PROJECT_SUMMARY' };
const SCOPE_LABEL: Record<ScopeType, string> = { session: 'Exploratory session', charter: 'Charter and its sessions', finding: 'Single finding', findings: 'Selected findings', milestone: 'Milestone / release', project: 'Whole project' };

function buildScope(t: ScopeType, id: string | null, ids: string[]): Scope | null {
  switch (t) {
    case 'project':
      return { type: 'project' };
    case 'findings':
      return ids.length ? { type: 'findings', findingIds: ids } : null;
    case 'finding':
      return id ? { type: 'finding', findingId: id } : null;
    case 'session':
      return id ? { type: 'session', sessionId: id } : null;
    case 'charter':
      return id ? { type: 'charter', charterId: id } : null;
    case 'milestone':
      return id ? { type: 'milestone', milestoneId: id } : null;
  }
}

const readDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the logo'));
    r.readAsDataURL(f);
  });

// ----------------------------------------------------------------------------- page

export default function ReportWizard() {
  const { pid, project, milestoneOptions, can } = useProject();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<string | null>('new');
  const templates = useQuery({ queryKey: ['report-templates', pid], queryFn: () => api.get<Templates>(p(pid, '/reporting/templates')) });

  const [step, setStep] = useState(0);
  const initialScope: ScopeType = (Object.keys(SCOPE_LABEL) as ScopeType[]).includes(sp.get('scope') as ScopeType) ? (sp.get('scope') as ScopeType) : 'session';
  const [scopeType, setScopeType] = useState<ScopeType>(initialScope);
  const [scopeId, setScopeId] = useState<string | null>(sp.get('id'));
  const [scopeIds, setScopeIds] = useState<string[]>(sp.get('ids')?.split(',').filter(Boolean) ?? []);
  const [kind, setKind] = useState<Kind>((sp.get('kind') as Kind | null) ?? DEFAULT_KIND[initialScope]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [formats, setFormats] = useState<Format[]>(['pdf']);
  const [pkg, setPkg] = useState<PackageMode>('none');
  const [opts, setOpts] = useState<Options>({});
  const [selectedFindings, setSelectedFindings] = useState<string[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  // Options restored from a previous run must survive the template-change reset below.
  const restored = useRef<Options | null>(null);

  const scope = buildScope(scopeType, scopeId, scopeIds);
  const builtIn = templates.data?.builtIn.find((t) => t.kind === kind);
  const saved = templates.data?.saved.find((t) => t.id === templateId);

  // Fall back to PDF-less defaults when PDF rendering is unavailable.
  useEffect(() => {
    if (templates.data && !templates.data.pdfAvailable) setFormats((f) => (f.includes('pdf') ? ['docx'] : f));
  }, [templates.data]);

  // When the template changes, reset presentation options to its defaults (keeping titles and filters).
  useEffect(() => {
    if (!builtIn) return;
    if (restored.current) {
      setOpts(restored.current);
      restored.current = null;
      return;
    }
    const base: Options = { ...builtIn.defaults, ...(saved?.options ?? {}) };
    setOpts((o) => ({
      ...base,
      title: o.title ?? base.title,
      subtitle: o.subtitle ?? base.subtitle,
      author: o.author ?? base.author,
      branding: { ...base.branding, ...o.branding },
      sections: { ...builtIn.sections, ...(saved?.options.sections ?? {}) },
      severities: o.severities ?? base.severities,
      dateFrom: o.dateFrom,
      dateTo: o.dateTo,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, templateId, builtIn]);

  const body = (extra: Partial<Options> = {}) => ({
    kind,
    scope,
    templateId: templateId ?? undefined,
    options: { ...opts, findingIds: selectedFindings ?? undefined, excludeEvidenceIds: excluded, ...extra },
  });

  const loadRun = async (runId: string) => {
    try {
      const run = await api.get<{ kind: Kind; scope: Scope; options: Options; formats: Format[] }>(p(pid, `/reporting/runs/${runId}`));
      const s = run.scope;
      setScopeType(s.type);
      setScopeId('findingId' in s ? s.findingId : 'sessionId' in s ? s.sessionId : 'charterId' in s ? s.charterId : 'milestoneId' in s ? s.milestoneId : null);
      setScopeIds('findingIds' in s ? s.findingIds : []);
      restored.current = run.options;
      if (run.kind === kind && !templateId) setOpts(run.options);
      setKind(run.kind);
      setTemplateId(null);
      setSelectedFindings(run.options.findingIds ?? null);
      setExcluded(run.options.excludeEvidenceIds ?? []);
      setFormats(run.formats.filter((f) => f !== 'pdf' || templates.data?.pdfAvailable));
      setJob(null);
      setStep(1);
      setTab('new');
      toastOk('Settings loaded. Review them and generate again.');
    } catch (e) {
      toastError(e, 'Could not load that report');
    }
  };

  const canNext = [!!scope, formats.length > 0 && !!builtIn, selectedFindings === null || selectedFindings.length > 0 || scopeType === 'project' || scopeType === 'milestone', true, true][step];

  return (
    <>
      <PageHeader
        kicker={
          <>
            <Link to={`/projects/${pid}/reports`} className="ex-link">
              Reports
            </Link>{' '}
            / {project.key}
          </>
        }
        title="Report builder"
        subtitle="Create PDF, Word, Markdown and HTML reports from stored findings and evidence."
      />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="new" leftSection={<IconReportAnalytics size={14} />}>
            New report
          </Tabs.Tab>
          <Tabs.Tab value="history" leftSection={<IconHistory size={14} />}>
            History
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="new">
          {templates.isLoading ? (
            <Loader />
          ) : templates.error || !templates.data ? (
            <Alert color="red">Report templates could not be loaded.</Alert>
          ) : (
            <Paper withBorder p="md">
              <Stepper active={step} onStepClick={(s) => s < step && !(job && job.status === 'running') && setStep(s)} size="sm" allowNextStepsSelect={false} mb="lg">
                <Stepper.Step label="Scope" description="What to report on" />
                <Stepper.Step label="Template" description="Type and formats" />
                <Stepper.Step label="Content" description="Findings & evidence" />
                <Stepper.Step label="Layout" description="Sections & branding" />
                <Stepper.Step label="Preview" description="Check the result" />
                <Stepper.Step label="Generate" description="Save the report" />
              </Stepper>

              {step === 0 && (
                <ScopeStep
                  pid={pid}
                  scopeType={scopeType}
                  setScopeType={(t) => {
                    setScopeType(t);
                    setScopeId(null);
                    setScopeIds([]);
                    setSelectedFindings(null);
                    setExcluded([]);
                    setKind(DEFAULT_KIND[t]);
                    setTemplateId(null);
                  }}
                  scopeId={scopeId}
                  setScopeId={(v) => {
                    setScopeId(v);
                    setSelectedFindings(null);
                    setExcluded([]);
                  }}
                  scopeIds={scopeIds}
                  setScopeIds={(v) => {
                    setScopeIds(v);
                    setSelectedFindings(null);
                  }}
                  milestoneOptions={milestoneOptions}
                />
              )}
              {step === 1 && <TemplateStep t={templates.data} kind={kind} setKind={setKind} templateId={templateId} setTemplateId={setTemplateId} formats={formats} setFormats={setFormats} pkg={pkg} setPkg={setPkg} />}
              {step === 2 && scope && (
                <ContentStep
                  pid={pid}
                  req={{ kind, scope, options: { severities: opts.severities, dateFrom: opts.dateFrom, dateTo: opts.dateTo, includeImages: true, includeVideos: true, includeAttachments: true } }}
                  opts={opts}
                  setOpts={setOpts}
                  selected={selectedFindings}
                  setSelected={setSelectedFindings}
                  excluded={excluded}
                  setExcluded={setExcluded}
                />
              )}
              {step === 3 && <LayoutStep pid={pid} t={templates.data} kind={kind} opts={opts} setOpts={setOpts} canSave={can('TESTER')} />}
              {step === 4 && scope && <PreviewStep pid={pid} req={body()} formats={formats} />}
              {step === 5 && scope && (
                <GenerateStep
                  pid={pid}
                  req={{ ...body(), formats, package: pkg }}
                  job={job}
                  setJob={setJob}
                  onAnotherFormat={() => {
                    setJob(null);
                    setStep(1);
                  }}
                />
              )}

              {!(step === 5 && job) && (
                <Group justify="space-between" mt="lg">
                  <Button variant="default" leftSection={<IconArrowLeft size={16} />} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                    Back
                  </Button>
                  {step < 5 && (
                    <Button rightSection={<IconArrowRight size={16} />} disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                      {step === 4 ? 'Continue to generate' : 'Next'}
                    </Button>
                  )}
                </Group>
              )}
            </Paper>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="history">
          <RunHistory pid={pid} onRegenerate={loadRun} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

// ----------------------------------------------------------------------------- step 1: scope

function ScopeStep(props: {
  pid: string;
  scopeType: ScopeType;
  setScopeType: (t: ScopeType) => void;
  scopeId: string | null;
  setScopeId: (v: string | null) => void;
  scopeIds: string[];
  setScopeIds: (v: string[]) => void;
  milestoneOptions: { value: string; label: string }[];
}) {
  const { pid, scopeType } = props;
  const need = (t: ScopeType[]) => t.includes(scopeType);
  const sessions = useQuery({ queryKey: ['wiz-sessions', pid], queryFn: () => api.get<any>(p(pid, '/sessions'), { pageSize: 200 }), enabled: need(['session']) });
  const charters = useQuery({ queryKey: ['wiz-charters', pid], queryFn: () => api.get<any>(p(pid, '/charters'), { pageSize: 200 }), enabled: need(['charter']) });
  const findings = useQuery({ queryKey: ['wiz-findings', pid], queryFn: () => api.get<any>(p(pid, '/findings'), { pageSize: 200 }), enabled: need(['finding', 'findings']) });
  const opt = (rows: any[] | undefined, current: string[]) => {
    const list = (rows ?? []).map((r) => ({ value: r.id as string, label: `${r.key} · ${r.title}` }));
    // Keep preselected items (e.g. from a deep link) selectable even when outside the first page.
    for (const id of current) if (id && !list.some((o) => o.value === id)) list.unshift({ value: id, label: 'Selected item' });
    return list;
  };
  const cur = props.scopeId ? [props.scopeId] : [];

  return (
    <Stack gap="md" maw={720}>
      <Radio.Group label="Report on" value={scopeType} onChange={(v) => props.setScopeType(v as ScopeType)}>
        <SimpleGrid cols={{ base: 1, sm: 2 }} mt="xs" spacing="xs">
          {(Object.keys(SCOPE_LABEL) as ScopeType[]).map((t) => (
            <Radio key={t} value={t} label={SCOPE_LABEL[t]} />
          ))}
        </SimpleGrid>
      </Radio.Group>
      {scopeType === 'session' && <Select label="Session" placeholder={sessions.isLoading ? 'Loading…' : 'Choose a session'} data={opt(sessions.data?.sessions, cur)} value={props.scopeId} onChange={props.setScopeId} searchable nothingFoundMessage="No sessions" />}
      {scopeType === 'charter' && <Select label="Charter" placeholder={charters.isLoading ? 'Loading…' : 'Choose a charter'} data={opt(charters.data?.charters, cur)} value={props.scopeId} onChange={props.setScopeId} searchable nothingFoundMessage="No charters" />}
      {scopeType === 'finding' && <Select label="Finding" placeholder={findings.isLoading ? 'Loading…' : 'Choose a finding'} data={opt(findings.data?.findings, cur)} value={props.scopeId} onChange={props.setScopeId} searchable nothingFoundMessage="No findings" />}
      {scopeType === 'findings' && (
        <MultiSelect label="Findings" placeholder={findings.isLoading ? 'Loading…' : 'Choose findings'} data={opt(findings.data?.findings, props.scopeIds)} value={props.scopeIds} onChange={props.setScopeIds} searchable clearable nothingFoundMessage="No findings" />
      )}
      {scopeType === 'milestone' &&
        (props.milestoneOptions.length ? (
          <Select label="Milestone" placeholder="Choose a milestone" data={props.milestoneOptions} value={props.scopeId} onChange={props.setScopeId} searchable />
        ) : (
          <Alert color="gray">This project has no milestones yet. Create one in project settings to build a release-readiness report.</Alert>
        ))}
      {scopeType === 'project' && (
        <Text size="sm" c="dimmed">
          Includes every finding in the project. You can narrow it with severity and date filters on the Content step.
        </Text>
      )}
    </Stack>
  );
}

// ----------------------------------------------------------------------------- step 2: template and formats

function TemplateCard({ on, title, description, onPick }: { on: boolean; title: string; description: string; onPick: () => void }) {
  return (
    <Card
      withBorder
      padding="sm"
      style={{ cursor: 'pointer', outline: on ? '2px solid var(--mantine-primary-color-filled)' : undefined }}
      onClick={onPick}
      role="radio"
      aria-checked={on}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())}
    >
      <Group gap={6} wrap="nowrap">
        {on && <IconCheck size={14} color="var(--mantine-primary-color-filled)" />}
        <Text fw={600} size="sm">
          {title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {description}
      </Text>
    </Card>
  );
}

function TemplateStep(props: {
  t: Templates;
  kind: Kind;
  setKind: (k: Kind) => void;
  templateId: string | null;
  setTemplateId: (v: string | null) => void;
  formats: Format[];
  setFormats: (f: Format[]) => void;
  pkg: PackageMode;
  setPkg: (p: PackageMode) => void;
}) {
  const { t } = props;
  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Text fw={600} size="sm" mb="xs">
          Report template
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" role="radiogroup" aria-label="Report template">
          {t.builtIn.map((b) => (
            <TemplateCard
              key={b.kind}
              on={props.kind === b.kind && !props.templateId}
              title={b.name}
              description={b.description}
              onPick={() => {
                props.setKind(b.kind);
                props.setTemplateId(null);
              }}
            />
          ))}
        </SimpleGrid>
        {t.saved.length > 0 && (
          <>
            <Text fw={600} size="sm" mt="md" mb="xs">
              Saved templates
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" role="radiogroup" aria-label="Saved templates">
              {t.saved.map((s) => (
                <TemplateCard
                  key={s.id}
                  on={props.templateId === s.id}
                  title={s.name}
                  description={`${s.description || t.builtIn.find((b) => b.kind === s.kind)?.name || ''}${s.createdBy ? ` · by ${s.createdBy.name}` : ''}`}
                  onPick={() => {
                    props.setKind(s.kind);
                    props.setTemplateId(s.id);
                  }}
                />
              ))}
            </SimpleGrid>
          </>
        )}
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Stack gap="md">
          <Checkbox.Group label="Output formats" description="Generate several formats from the same settings at once." value={props.formats} onChange={(v) => props.setFormats(v as Format[])}>
            <Stack gap={6} mt="xs">
              {t.formats.map((f) => (
                <Checkbox
                  key={f}
                  value={f}
                  disabled={f === 'pdf' && !t.pdfAvailable}
                  label={
                    <Group gap={6}>
                      {FORMAT_META[f].icon}
                      {FORMAT_META[f].label}
                      {f === 'pdf' && !t.pdfAvailable && (
                        <Badge size="xs" color="gray">
                          not available here
                        </Badge>
                      )}
                    </Group>
                  }
                  description={`Video: ${FORMAT_META[f].video}`}
                />
              ))}
            </Stack>
          </Checkbox.Group>
          <Radio.Group label="Evidence package" description="Bundles original screenshots, videos and attachments with relative links, a manifest and a README." value={props.pkg} onChange={(v) => props.setPkg(v as PackageMode)}>
            <Stack gap={6} mt="xs">
              <Radio value="none" label="Report files only" description="Screenshots are embedded. Videos and attachments are referenced by name." />
              <Radio value="folder" label="Report package folder" description="A self-contained folder that keeps working after you move it to another computer." />
              <Radio value="zip" label="Report package (ZIP)" description="The same package as a single ZIP file for sharing." />
            </Stack>
          </Radio.Group>
          {props.pkg === 'none' && props.formats.includes('md') && (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
              Markdown references screenshots by relative path, so a Markdown report is always produced as a folder containing the report and an evidence/ folder.
            </Alert>
          )}
        </Stack>
      </Grid.Col>
    </Grid>
  );
}

// ----------------------------------------------------------------------------- step 3: content

function ContentStep(props: {
  pid: string;
  req: object;
  opts: Options;
  setOpts: (fn: (o: Options) => Options) => void;
  selected: string[] | null;
  setSelected: (v: string[] | null) => void;
  excluded: string[];
  setExcluded: (v: string[]) => void;
}) {
  const { pid, opts, setOpts } = props;
  const key = JSON.stringify(props.req);
  const q = useQuery({ queryKey: ['report-candidates', pid, key], queryFn: () => api.post<Candidates>(p(pid, '/reporting/candidates'), props.req) });
  const findings = q.data?.findings ?? [];
  const all = findings.map((f) => f.id);
  const sel = new Set((props.selected ?? all).filter((id) => all.includes(id)));
  const exc = new Set(props.excluded);
  const setSel = (ids: string[]) => props.setSelected(ids.length === all.length ? null : ids);
  const kindOn = (k: string) => (k === 'IMAGE' ? opts.includeImages !== false : k === 'VIDEO' ? opts.includeVideos !== false : opts.includeAttachments !== false);
  const evidence = (q.data?.evidence ?? []).filter((e) => !e.findingId || sel.has(e.findingId));
  const included = evidence.filter((e) => kindOn(e.kind) && !exc.has(e.id));

  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <MultiSelect label="Severities" placeholder="All severities" data={SEVERITY_OPTIONS} value={opts.severities ?? []} onChange={(v) => setOpts((o) => ({ ...o, severities: v.length ? v : undefined }))} clearable w={280} />
        <DatePickerInput
          type="range"
          label="Findings created between"
          placeholder="Any time"
          value={[opts.dateFrom ?? null, opts.dateTo ?? null]}
          onChange={([from, to]) => setOpts((o) => ({ ...o, dateFrom: from ?? undefined, dateTo: to ?? undefined }))}
          clearable
          w={280}
        />
      </Group>
      <Group gap="lg">
        <Switch label="Screenshots" checked={opts.includeImages !== false} onChange={(e) => setOpts((o) => ({ ...o, includeImages: e.currentTarget.checked }))} />
        <Switch label="Videos" checked={opts.includeVideos !== false} onChange={(e) => setOpts((o) => ({ ...o, includeVideos: e.currentTarget.checked }))} />
        <Switch label="Other attachments" checked={opts.includeAttachments !== false} onChange={(e) => setOpts((o) => ({ ...o, includeAttachments: e.currentTarget.checked }))} />
        <Switch label="Prefer annotated screenshots" checked={opts.preferAnnotated !== false} onChange={(e) => setOpts((o) => ({ ...o, preferAnnotated: e.currentTarget.checked }))} />
      </Group>
      {q.isLoading && <Loader size="sm" />}
      {q.error && <Alert color="red">Could not load the findings for this scope: {(q.error as Error).message}</Alert>}
      {q.data && (
        <>
          <Paper withBorder p={0}>
            <Group justify="space-between" p="xs">
              <Text fw={600} size="sm">
                Findings · {sel.size} of {findings.length} selected
                {q.data.scopeLabel ? ` · ${q.data.scopeLabel}` : ''}
              </Text>
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle" onClick={() => props.setSelected(null)}>
                  Select all
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={() => props.setSelected([])}>
                  Select none
                </Button>
              </Group>
            </Group>
            {!findings.length ? (
              <Text size="sm" c="dimmed" p="sm">
                No findings match this scope and these filters. The report still includes the scope details, such as the mission, timeline and metadata.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={600} mah={300}>
                <Table fz="sm" verticalSpacing={4} stickyHeader>
                  <Table.Tbody>
                    {findings.map((f) => (
                      <Table.Tr key={f.id}>
                        <Table.Td w={30}>
                          <Checkbox aria-label={`Include ${f.key}`} checked={sel.has(f.id)} onChange={(e) => setSel(e.currentTarget.checked ? [...sel, f.id] : [...sel].filter((x) => x !== f.id))} />
                        </Table.Td>
                        <Table.Td w={90}>
                          <Text size="xs" ff="monospace">
                            {f.key}
                          </Text>
                        </Table.Td>
                        <Table.Td>{f.title}</Table.Td>
                        <Table.Td w={120}>
                          <ClassificationBadge c={f.classification} size="xs" />
                        </Table.Td>
                        <Table.Td w={90}>
                          <SeverityBadge value={f.severity} size="xs" />
                        </Table.Td>
                        <Table.Td w={80}>
                          <Text size="xs" c="dimmed">
                            {f.evidenceCount} files
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>

          <Paper withBorder p="xs">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Evidence · {included.length} of {evidence.length} included
              </Text>
              <Text size="xs" c="dimmed">
                Evidence marked “exclude from reports” in its gallery is not listed.
              </Text>
            </Group>
            {!evidence.length ? (
              <Text size="sm" c="dimmed">
                The selected items have no evidence attached.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 2, sm: 4, md: 6 }} spacing="xs">
                {evidence.map((e) => {
                  const on = kindOn(e.kind) && !exc.has(e.id);
                  return (
                    <Card key={e.id} withBorder padding={4} style={{ opacity: on ? 1 : 0.45 }}>
                      {e.thumbUrl ? (
                        <Image src={e.thumbUrl} h={70} fit="cover" radius="xs" alt="" />
                      ) : (
                        <Stack h={70} justify="center" align="center" gap={0} style={{ background: 'var(--mantine-color-default-hover)', borderRadius: 4 }}>
                          {e.kind === 'VIDEO' ? <IconVideo size={22} /> : <Text size="xs">{e.fileName.split('.').pop()?.toUpperCase()}</Text>}
                        </Stack>
                      )}
                      <Checkbox
                        mt={4}
                        size="xs"
                        disabled={!kindOn(e.kind)}
                        checked={on}
                        onChange={(ev) => props.setExcluded(ev.currentTarget.checked ? props.excluded.filter((x) => x !== e.id) : [...props.excluded, e.id])}
                        label={
                          <Tooltip label={`${e.fileName} · ${bytes(e.size)}${e.caption ? ` · ${e.caption}` : ''}`} multiline w={240}>
                            <Text size="xs" lineClamp={1}>
                              {e.findingKey ?? e.sessionKey ?? ''} {e.title}
                              {e.kind === 'VIDEO' && e.durationSeconds != null ? ` (${fmtDuration(e.durationSeconds)})` : ''}
                            </Text>
                          </Tooltip>
                        }
                      />
                    </Card>
                  );
                })}
              </SimpleGrid>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}

// ----------------------------------------------------------------------------- step 4: layout

function LayoutStep({ pid, t, kind, opts, setOpts, canSave }: { pid: string; t: Templates; kind: Kind; opts: Options; setOpts: (fn: (o: Options) => Options) => void; canSave: boolean }) {
  const qc = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const b = opts.branding ?? {};
  const setB = (patch: Partial<NonNullable<Options['branding']>>) => setOpts((o) => ({ ...o, branding: { ...o.branding, ...patch } }));
  const sections = opts.sections ?? {};

  const saveTemplate = async () => {
    setBusy(true);
    try {
      const { findingIds: _f, excludeEvidenceIds: _e, dateFrom: _d1, dateTo: _d2, ...reusable } = opts;
      await api.post(p(pid, '/reporting/templates'), { name: name.trim(), kind, options: reusable });
      qc.invalidateQueries({ queryKey: ['report-templates', pid] });
      toastOk(`Template “${name.trim()}” saved`);
      setSaveOpen(false);
      setName('');
    } catch (e) {
      toastError(e, 'Could not save the template');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="sm">
          <TextInput label="Report title" placeholder="Default: based on the scope" value={opts.title ?? ''} onChange={(e) => setOpts((o) => ({ ...o, title: e.currentTarget.value || undefined }))} maxLength={200} />
          <TextInput label="Subtitle" value={opts.subtitle ?? ''} onChange={(e) => setOpts((o) => ({ ...o, subtitle: e.currentTarget.value || undefined }))} maxLength={300} />
          <TextInput label="Author" placeholder="Default: you" value={opts.author ?? ''} onChange={(e) => setOpts((o) => ({ ...o, author: e.currentTarget.value || undefined }))} maxLength={120} />
          <Divider label="Branding" labelPosition="left" />
          <SimpleGrid cols={2}>
            <TextInput label="Organization" value={b.organization ?? ''} onChange={(e) => setB({ organization: e.currentTarget.value || undefined })} maxLength={120} />
            <ColorInput label="Accent colour" placeholder="Default" value={b.accentColor ?? ''} onChange={(v) => setB({ accentColor: /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined })} format="hex" />
          </SimpleGrid>
          <TextInput label="Confidentiality notice" placeholder="e.g. Internal — do not distribute" value={b.confidentiality ?? ''} onChange={(e) => setB({ confidentiality: e.currentTarget.value || undefined })} maxLength={200} />
          <Group gap="sm" align="center">
            {b.logoDataUrl && <Image src={b.logoDataUrl} h={36} w="auto" fit="contain" alt="Report logo" />}
            <FileButton
              accept="image/png,image/jpeg"
              onChange={async (f) => {
                if (!f) return;
                if (!/^image\/(png|jpeg)$/.test(f.type)) return toastError(new Error('Use a PNG or JPEG image.'), 'Unsupported logo');
                if (f.size > 500 * 1024) return toastError(new Error('Use a PNG or JPEG logo under 500 KB.'), 'Logo too large');
                try {
                  setB({ logoDataUrl: await readDataUrl(f) });
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              {(fp) => (
                <Button {...fp} size="xs" variant="default" leftSection={<IconPhoto size={14} />}>
                  {b.logoDataUrl ? 'Change logo' : 'Add logo'}
                </Button>
              )}
            </FileButton>
            {b.logoDataUrl && (
              <Button size="xs" variant="subtle" color="red" onClick={() => setB({ logoDataUrl: undefined })}>
                Remove
              </Button>
            )}
          </Group>
          <Divider label="Presentation" labelPosition="left" />
          <Group gap="lg" align="flex-end">
            <div>
              <Text size="sm" fw={500} mb={4}>
                Orientation
              </Text>
              <SegmentedControl size="xs" value={opts.orientation ?? 'portrait'} onChange={(v) => setOpts((o) => ({ ...o, orientation: v as Options['orientation'] }))} data={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            </div>
            <div>
              <Text size="sm" fw={500} mb={4}>
                Evidence size
              </Text>
              <SegmentedControl size="xs" value={opts.imageSize ?? 'medium'} onChange={(v) => setOpts((o) => ({ ...o, imageSize: v as Options['imageSize'] }))} data={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />
            </div>
            <Select label="Language" data={[{ value: 'en', label: 'English' }]} value="en" w={120} readOnly />
          </Group>
          <Switch label="Show metadata tables (IDs, authors, timestamps)" checked={opts.showMetadata !== false} onChange={(e) => setOpts((o) => ({ ...o, showMetadata: e.currentTarget.checked }))} />
          <Switch label="Include comments on findings" checked={!!opts.includeComments} onChange={(e) => setOpts((o) => ({ ...o, includeComments: e.currentTarget.checked }))} />
          <Text size="xs" c="dimmed">
            Orientation applies to PDF and Word. Images keep their aspect ratio. Original files are never resized; reports use optimized copies.
          </Text>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Group justify="space-between" mb="xs">
          <Text fw={600} size="sm">
            Sections
          </Text>
          <Text size="xs" c="dimmed">
            Sections without data are left out automatically.
          </Text>
        </Group>
        <SimpleGrid cols={2} spacing={6}>
          {t.sections.map((s) => (
            <Checkbox key={s.key} label={s.title} checked={!!sections[s.key]} onChange={(e) => setOpts((o) => ({ ...o, sections: { ...o.sections, [s.key]: e.currentTarget.checked } }))} />
          ))}
        </SimpleGrid>
        {canSave && (
          <Button mt="lg" size="xs" variant="light" leftSection={<IconDeviceFloppy size={14} />} onClick={() => setSaveOpen(true)}>
            Save these settings as a template
          </Button>
        )}
      </Grid.Col>
      <Modal opened={saveOpen} onClose={() => setSaveOpen(false)} title="Save report template" centered>
        <Stack>
          <TextInput label="Template name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={120} data-autofocus />
          <Text size="xs" c="dimmed">
            Saves the template type, sections, presentation and branding, but not the selected findings or dates. Templates are shared with your organization.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTemplate} loading={busy} disabled={!name.trim()}>
              Save template
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Grid>
  );
}

// ----------------------------------------------------------------------------- step 5: preview

function PreviewStep({ pid, req, formats }: { pid: string; req: object; formats: Format[] }) {
  const key = JSON.stringify(req);
  const q = useQuery({ queryKey: ['report-preview', pid, key], queryFn: () => api.post<Preview>(p(pid, '/reporting/preview'), req), staleTime: 0, gcTime: 0 });
  if (q.isLoading)
    return (
      <Group p="xl" justify="center">
        <Loader size="sm" />
        <Text size="sm">Building preview…</Text>
      </Group>
    );
  if (q.error || !q.data) return <Alert color="red">{(q.error as Error | null)?.message ?? 'Preview failed'}</Alert>;
  const d = q.data;
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge variant="light">{d.findingCount} findings</Badge>
        <Badge variant="light">{d.evidenceCount} evidence items</Badge>
        {d.videoCount > 0 && (
          <Badge variant="light" color="grape">
            {d.videoCount} videos
          </Badge>
        )}
        <Button size="compact-xs" variant="subtle" leftSection={<IconRefresh size={12} />} onClick={() => q.refetch()} loading={q.isFetching}>
          Refresh
        </Button>
      </Group>
      {d.videoCount > 0 && (
        <Alert color="grape" variant="light" icon={<IconVideo size={16} />} title="How videos appear">
          {formats.map((f) => (
            <Text size="xs" key={f}>
              <b>{FORMAT_META[f].label}:</b> {FORMAT_META[f].video}
            </Text>
          ))}
        </Alert>
      )}
      <iframe
        title="Report preview"
        srcDoc={d.html}
        sandbox="allow-same-origin"
        style={{ width: '100%', height: '70vh', border: '1px solid var(--mantine-color-default-border)', borderRadius: 6, background: '#fff' }}
      />
      <Text size="xs" c="dimmed">
        The preview shows the report content. PDF and Word add the cover page, page numbers, headers and footers.
      </Text>
    </Stack>
  );
}

// ----------------------------------------------------------------------------- step 6: generate

type SavedState = Record<string, { savedId: string; folder: string } | 'downloaded'>;

function GenerateStep({ pid, req, job, setJob, onAnotherFormat }: { pid: string; req: object; job: Job | null; setJob: (j: Job | null) => void; onAnotherFormat: () => void }) {
  const [starting, setStarting] = useState(false);
  const [saved, setSaved] = useState<SavedState>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const timer = setTimeout(async () => {
      try {
        setJob(await api.get<Job>(p(pid, `/reporting/jobs/${job.id}`)));
      } catch (e) {
        toastError(e, 'Lost track of the report job');
        setJob({ ...job, status: 'failed', error: 'The report job is no longer available. Generate it again.' });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [job, pid, setJob]);

  const start = async () => {
    setStarting(true);
    setSaved({});
    try {
      setJob(await api.post<Job>(p(pid, '/reporting/jobs'), req));
    } catch (e) {
      toastError(e, 'Could not start the report');
    } finally {
      setStarting(false);
    }
  };

  const save = async (name: string, type: 'file' | 'folder') => {
    if (!job) return;
    setSaving(name);
    try {
      if (desktop) {
        const r = await desktop.saveReport(job.id, name);
        if (r.status === 'saved') {
          setSaved((s) => ({ ...s, [name]: { savedId: r.savedId, folder: r.folder } }));
          toastOk(`Saved ${r.fileName}`);
        }
      } else {
        await download(p(pid, `/reporting/jobs/${job.id}/download?name=${encodeURIComponent(name)}`), type === 'folder' ? `${name}.zip` : name);
        setSaved((s) => ({ ...s, [name]: 'downloaded' }));
      }
    } catch (e) {
      toastError(e, 'Could not save the report');
    } finally {
      setSaving(null);
    }
  };

  if (!job)
    return (
      <Stack align="center" gap="sm" p="lg">
        <ThemeIcon size={48} radius="xl" variant="light">
          <IconReportAnalytics size={26} />
        </ThemeIcon>
        <Text size="sm" c="dimmed" ta="center" maw={480}>
          Explorix builds the report from your stored findings and evidence, and nothing is uploaded anywhere. {desktop ? 'Next, you choose where to save each file.' : 'The files are ready to download when generation finishes.'}
        </Text>
        <Button size="md" onClick={start} loading={starting} leftSection={<IconReportAnalytics size={18} />}>
          Generate report
        </Button>
      </Stack>
    );

  return (
    <Stack gap="md">
      {job.status === 'running' && (
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="sm">{job.phase}…</Text>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconX size={14} />}
              onClick={async () => {
                try {
                  setJob(await api.post<Job>(p(pid, `/reporting/jobs/${job.id}/cancel`)));
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Cancel
            </Button>
          </Group>
          <Progress value={job.progress} animated size="lg" aria-label="Report generation progress" />
        </Stack>
      )}
      {job.status === 'failed' && (
        <Alert color="red" title="The report could not be generated" icon={<IconAlertTriangle size={18} />}>
          {job.error}
        </Alert>
      )}
      {job.status === 'cancelled' && <Alert color="gray">Report generation was cancelled, and the partial files were discarded.</Alert>}
      {job.warnings.length > 0 && (
        <Alert color="yellow" title="Generated with warnings" icon={<IconAlertTriangle size={18} />}>
          {job.warnings.map((w, i) => (
            <Text size="xs" key={i}>
              • {w}
            </Text>
          ))}
        </Alert>
      )}
      {job.status === 'done' && (
        <>
          <Alert color="teal" icon={<IconCheck size={18} />} title="Report ready">
            Includes {job.findingCount} {job.findingCount === 1 ? 'finding' : 'findings'} and {job.evidenceCount} evidence {job.evidenceCount === 1 ? 'item' : 'items'}. {desktop ? 'Choose where to save each output.' : 'Download each output.'}
          </Alert>
          <Stack gap="xs">
            {job.outputs.map((o) => {
              const s = saved[o.name];
              return (
                <Paper key={o.name} withBorder p="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <ThemeIcon variant="light" size="lg">
                        {o.type === 'folder' ? <IconFolder size={18} /> : FORMAT_META[o.formats[0]!]?.icon}
                      </ThemeIcon>
                      <div>
                        <Text size="sm" fw={600}>
                          {o.name}
                          {o.type === 'folder' ? '\\' : ''}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {o.description} · {bytes(o.bytes)}
                        </Text>
                        {s && s !== 'downloaded' && (
                          <Text size="xs" c="teal">
                            Saved to {s.folder}
                          </Text>
                        )}
                      </div>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      {s && s !== 'downloaded' && desktop && (
                        <>
                          <Button size="xs" variant="light" leftSection={<IconExternalLink size={14} />} onClick={() => desktop!.openSaved(s.savedId).catch((e) => toastError(e))}>
                            Open
                          </Button>
                          <Button size="xs" variant="default" leftSection={<IconFolder size={14} />} onClick={() => desktop!.showSavedInFolder(s.savedId).catch((e) => toastError(e))}>
                            Show in folder
                          </Button>
                        </>
                      )}
                      <Button size="xs" variant={s ? 'subtle' : 'filled'} leftSection={desktop ? <IconDeviceFloppy size={14} /> : <IconDownload size={14} />} loading={saving === o.name} onClick={() => save(o.name, o.type)}>
                        {desktop ? (s ? 'Save again…' : 'Save as…') : s ? 'Download again' : o.type === 'folder' ? 'Download ZIP' : 'Download'}
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        </>
      )}
      {job.status !== 'running' && (
        <Group justify="space-between">
          <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={onAnotherFormat}>
            Generate another format
          </Button>
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={start} loading={starting}>
            Generate again
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// ----------------------------------------------------------------------------- history

function RunHistory({ pid, onRegenerate }: { pid: string; onRegenerate: (id: string) => void }) {
  const q = useQuery({ queryKey: ['report-runs', pid], queryFn: () => api.get<any[]>(p(pid, '/reporting/runs')) });
  const rows = useMemo(() => q.data ?? [], [q.data]);
  if (q.isLoading) return <Loader />;
  if (q.error) return <Alert color="red">Report history could not be loaded.</Alert>;
  if (!rows.length) return <EmptyState title="No reports generated yet" description="Reports you generate are listed here so you can produce them again later." icon={<IconReportAnalytics size={26} />} />;
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={760}>
        <Table fz="sm" verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Report</Table.Th>
              <Table.Th>Formats</Table.Th>
              <Table.Th>Content</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {r.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {r.templateName}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {(r.formats ?? []).map((f: string) => (
                      <Badge key={f} size="xs" variant="outline">
                        {f}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {r.findingCount} findings · {r.evidenceCount} evidence
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={r.error ?? ''} disabled={!r.error} multiline w={280}>
                    <Badge size="sm" variant="light" color={r.status === 'done' ? 'teal' : r.status === 'failed' ? 'red' : 'gray'}>
                      {r.status}
                    </Badge>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{fmtDateTime(r.createdAt)}</Text>
                  <Text size="xs" c="dimmed">
                    {r.createdBy?.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Anchor component="button" size="sm" onClick={() => onRegenerate(r.id)}>
                    Reuse settings
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
