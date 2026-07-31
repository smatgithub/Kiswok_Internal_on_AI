'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Pencil,
} from 'lucide-react';
import {
  api,
  Batch,
  SapPipelineEntry,
  SapPipelineStage,
  SapSourceItem,
  WizardAnswers,
} from '@/lib/api';
import { Badge, StatusDot } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/ui/KpiCard';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';

type Phase = 'select' | 'wizard' | 'preview' | 'batch';

const BUCKET_META: Record<
  SapPipelineStage,
  { title: string; description: string; badge: 'warning' | 'info' | 'success' }
> = {
  pending: {
    title: 'Pending for processing',
    description:
      'Selected in IcSoft Items · not yet committed to SAP template · count reduces as each item is processed',
    badge: 'warning',
  },
  committed: {
    title: 'Ready for template',
    description:
      'Select items → Generate gold XML · only selected rows are written to the blank template',
    badge: 'info',
  },
  exported: {
    title: 'Template created',
    description:
      'XML/Excel already generated · re-generate selected rows if needed · enter SAP item code (ProcessID/DeptId blank)',
    badge: 'success',
  },
};

const STEP_META = [
  {
    id: 'identity',
    title: 'Identity',
    fields: [
      'productNumber',
      'productType',
      'productGroup',
      'description',
      'languageKey',
      'baseUom',
      'oldProductNumber',
    ] as const,
  },
  {
    id: 'basicFlags',
    title: 'Views & Weight',
    fields: [
      'batchManaged',
      'grossWeight',
      'netWeight',
      'weightUom',
      'viewQuality',
      'viewSales',
      'viewStorage',
      'viewPurchasing',
    ] as const,
  },
  {
    id: 'salesTax',
    title: 'Sales & Tax',
    fields: [
      'salesOrganization',
      'distributionChannels',
      'itemCategoryGroup',
      'accountAssignmentGroup',
      'country',
    ] as const,
  },
  {
    id: 'plant',
    title: 'Plant & MRP',
    fields: [
      'plant',
      'mrpType',
      'mrpController',
      'availabilityCheck',
      'profitCenter',
      'loadingGroup',
      'coProduct',
      'hsnCode',
      'taxIndicator',
      'strategyGroup',
      'lotSizingProcedure',
      'procurementType',
    ] as const,
  },
  {
    id: 'storageValuation',
    title: 'SLoc & Valuation',
    fields: [
      'storageLocations',
      'valuationAreas',
      'priceControlDetermination',
      'valuationClass',
      'priceControl',
      'currency',
    ] as const,
  },
];

const LABELS: Record<string, string> = {
  productNumber: 'Product Number',
  productType: 'Product Type',
  productGroup: 'Product Group',
  description: 'Description (max 40)',
  languageKey: 'Language',
  baseUom: 'Base UoM',
  oldProductNumber: 'Old Product No. (IcSoft)',
  batchManaged: 'Batch Managed',
  grossWeight: 'Gross Weight',
  netWeight: 'Net Weight',
  weightUom: 'Weight UoM',
  viewQuality: 'Quality view',
  viewSales: 'Sales view',
  viewStorage: 'Storage view',
  viewPurchasing: 'Purchasing view',
  salesOrganization: 'Sales Org',
  distributionChannels: 'Dist. Channels',
  distributionChannel: 'Dist. Channel',
  itemCategoryGroup: 'Item Cat. Group',
  accountAssignmentGroup: 'Acct Assign. Group',
  country: 'Country',
  plant: 'Plant',
  mrpType: 'MRP Type',
  mrpController: 'MRP Controller',
  availabilityCheck: 'Avail. Check',
  profitCenter: 'Profit Center',
  loadingGroup: 'Loading Group',
  coProduct: 'Co-Product',
  hsnCode: 'HSN Code',
  taxIndicator: 'Tax Indicator',
  strategyGroup: 'Strategy Group',
  lotSizingProcedure: 'Lot Size',
  procurementType: 'Procurement',
  storageLocations: 'Storage Locations',
  valuationAreas: 'Valuation Areas',
  priceControlDetermination: 'Price Ctrl Det.',
  valuationClass: 'Valuation Class',
  priceControl: 'Price Control',
  currency: 'Currency',
};

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'boolean') return false;
  return value === undefined || value === null || String(value).trim() === '';
}

function formatPreviewValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === undefined || value === null || String(value).trim() === '') return '—';
  return String(value);
}

export default function SapItemStudio() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const extendHandled = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('select');
  const [bucket, setBucket] = useState<SapPipelineStage>('pending');
  const [query, setQuery] = useState('');
  const [pipeline, setPipeline] = useState<SapPipelineEntry[]>([]);
  const [pipelineCounts, setPipelineCounts] = useState<
    Record<SapPipelineStage, number>
  >({ pending: 0, committed: 0, exported: 0 });
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [sapCodeDrafts, setSapCodeDrafts] = useState<Record<string, string>>({});
  const [exportSelectedIds, setExportSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [source, setSource] = useState<SapSourceItem | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [copyFromId, setCopyFromId] = useState('');
  const [density, setDensity] = useState<'compact' | 'default'>('compact');
  const [lookups, setLookups] = useState<{
    storageLocations: string[];
    plants: Array<{ value: string; label: string }>;
    productTypes: Array<{ value: string; label: string }>;
    distributionChannels: Array<{ value: string; label: string }>;
    mrpTypes: Array<{ value: string; label: string }>;
    procurementTypes: Array<{ value: string; label: string }>;
  } | null>(null);

  const refreshPipeline = useCallback(async () => {
    const res = await api.listPipeline();
    setPipeline(res.data);
    setPipelineCounts(res.counts);
    return res;
  }, []);

  useEffect(() => {
    refreshPipeline().catch(() => undefined);
    api.lookups().then((r) => setLookups(r.data)).catch(() => undefined);
    api
      .listBatches()
      .then((r) => {
        if (r.data[0]) setBatch(r.data[0]);
      })
      .catch(() => undefined);
  }, [refreshPipeline]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const bucketEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pipeline.filter((e) => {
      if (e.stage !== bucket) return false;
      if (!q) return true;
      const hay = [
        e.icsoftCode,
        e.rawMatName,
        e.productGroup,
        String(e.rawMatId),
        e.sapItemCode,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [pipeline, bucket, query]);

  useEffect(() => {
    const raw = searchParams.get('extendRawMatId');
    if (!raw) return;
    const plant = searchParams.get('plant') || undefined;
    const storageLocation = searchParams.get('sloc') || undefined;
    const locationIdRaw = searchParams.get('locationId');
    const locationId = locationIdRaw ? Number(locationIdRaw) : undefined;
    const handleKey = `${raw}|${plant || ''}|${storageLocation || ''}|${locationIdRaw || ''}`;
    if (extendHandled.current === handleKey) return;
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    extendHandled.current = handleKey;

    (async () => {
      setError('');
      setLoading(true);
      try {
        const res = await api.startWizard(id, {
          plant,
          storageLocation,
          locationId:
            locationId != null && Number.isFinite(locationId) ? locationId : undefined,
        });
        const pipe = await refreshPipeline();
        const entry = pipe.data.find((e) => e.rawMatId === id);
        setActivePipelineId(entry?.id || null);
        setSource(res.data.source);
        setAnswers(res.data.defaults);
        setStepIdx(0);
        setPhase('wizard');
        const locHint = [plant, storageLocation].filter(Boolean).join(' / ');
        setToast(
          locHint
            ? `Extend for SAP · ${res.data.source.IcsoftCode} · ${locHint}`
            : `Extend for SAP · ${res.data.source.IcsoftCode}`,
        );
        router.replace('/sap-items', { scroll: false });
      } catch (e) {
        setError((e as Error).message);
        setPhase('select');
      } finally {
        setLoading(false);
      }
    })();
  }, [searchParams, router, refreshPipeline]);

  const step = STEP_META[stepIdx];

  const stepValid = useMemo(() => {
    if (!answers) return false;
    const optional = [
      'oldProductNumber',
      'grossWeight',
      'netWeight',
      'weightUom',
      'loadingGroup',
      'hsnCode',
      'priceControlDetermination',
    ];
    return step.fields.every((field) => {
      if (optional.includes(field)) return true;
      return !isEmpty(answers[field as keyof WizardAnswers]);
    });
  }, [answers, step]);

  const kpis = useMemo(() => {
    const batchLines = batch?.items.length || 0;
    const plants = new Set((batch?.items || []).map((i) => i.answers.plant)).size;
    return [
      {
        label: 'Pending (IcSoft)',
        value: String(pipelineCounts.pending),
        delta: 'Selected · not processed',
        tone: pipelineCounts.pending ? ('warning' as const) : ('neutral' as const),
      },
      {
        label: 'Ready for Template',
        value: String(pipelineCounts.committed),
        delta: 'Processed · XML not exported',
        tone: pipelineCounts.committed ? ('info' as const) : ('neutral' as const),
      },
      {
        label: 'Template Created',
        value: String(pipelineCounts.exported),
        delta: 'Update SAP item code',
        tone: pipelineCounts.exported ? ('success' as const) : ('neutral' as const),
      },
      {
        label: 'Batch Lines',
        value: String(batchLines),
        delta: batchLines ? 'Active batch' : 'None yet',
        tone: batchLines ? ('success' as const) : ('neutral' as const),
      },
      {
        label: 'Plants in Batch',
        value: String(plants),
        delta: 'Distinct valuation scope',
        tone: 'neutral' as const,
      },
      {
        label: 'Filtered Rows',
        value: String(bucketEntries.length),
        delta: BUCKET_META[bucket].title,
        tone: 'info' as const,
      },
    ];
  }, [batch, bucket, bucketEntries.length, pipelineCounts]);

  async function ensureBatch() {
    if (batch) return batch;
    const created = await api.createBatch('ZRAW Migration Batch');
    setBatch(created.data);
    return created.data;
  }

  async function processEntry(entry: SapPipelineEntry) {
    setError('');
    setLoading(true);
    setActivePipelineId(entry.id);
    try {
      const res = await api.startWizard(entry.rawMatId, {
        plant: entry.plant || undefined,
        storageLocation: entry.storageLocation || undefined,
        locationId: entry.locationId ?? undefined,
      });
      let defaults = res.data.defaults;
      if (entry.stage === 'committed' && entry.answers) {
        defaults = { ...entry.answers, ...defaults, productNumber: entry.answers.productNumber };
      }
      if (copyFromId && batch) {
        const prev = batch.items.find((i) => i.id === copyFromId);
        if (prev) {
          defaults = {
            ...prev.answers,
            productNumber: defaults.productNumber,
            oldProductNumber: res.data.source.IcsoftCode,
            description: defaults.description,
            productGroup: defaults.productGroup || prev.answers.productGroup,
            baseUom: defaults.baseUom || prev.answers.baseUom,
            plant: defaults.plant || prev.answers.plant,
            profitCenter: defaults.profitCenter || prev.answers.profitCenter,
            hsnCode: defaults.hsnCode || prev.answers.hsnCode,
            storageLocations:
              defaults.storageLocations.length > 0
                ? defaults.storageLocations
                : prev.answers.storageLocations,
            valuationAreas:
              defaults.valuationAreas.length > 0
                ? defaults.valuationAreas
                : prev.answers.valuationAreas,
          };
        }
      }
      setSource(res.data.source);
      setAnswers(defaults);
      setStepIdx(0);
      setPhase('wizard');
      setToast(`Processing ${entry.icsoftCode}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSapItemCode(entry: SapPipelineEntry) {
    const code = (sapCodeDrafts[entry.id] ?? entry.sapItemCode ?? '').trim();
    if (!code) return;
    setLoading(true);
    try {
      await api.updatePipelineSapCode(entry.id, code);
      await refreshPipeline();
      setToast(`SAP code ${code} saved · sap_new_item_master updated`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggleExportSelect(id: string) {
    setExportSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleExportSelectAllVisible() {
    const ids = bucketEntries.map((e) => e.id);
    const allOn = ids.length > 0 && ids.every((id) => exportSelectedIds.includes(id));
    setExportSelectedIds((prev) =>
      allOn
        ? prev.filter((id) => !ids.includes(id))
        : Array.from(new Set([...prev, ...ids])),
    );
  }

  async function exportSelectedTemplate(
    format: 'xml' | 'xlsx' = 'xml',
    regenerate = false,
  ) {
    if (!exportSelectedIds.length) {
      setError('Select at least one item to generate the file');
      return;
    }
    const label = format === 'xlsx' ? 'Excel (.xlsx)' : 'gold XML';
    const fromExported = bucket === 'exported';
    const ok = window.confirm(
      fromExported
        ? `Re-generate ${label} for ${exportSelectedIds.length} selected item(s) from a clean template?`
        : `Generate ${label} for ${exportSelectedIds.length} selected item(s)?\n\nThose items will move to Template created.`,
    );
    if (!ok) return;
    setLoading(true);
    setError('');
    try {
      const { blob, filename } = await api.exportPipelineEntries(
        exportSelectedIds,
        regenerate || fromExported,
        format,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      const exportedIds = [...exportSelectedIds];
      setExportSelectedIds([]);
      await refreshPipeline();
      setBucket('exported');
      setToast(
        fromExported
          ? `Template regenerated · ${exportedIds.length} item(s) · ${filename}`
          : `Template created · ${exportedIds.length} item(s) · ${filename}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function dismissEntry(entry: SapPipelineEntry) {
    const ok = window.confirm(
      `Dismiss ${entry.icsoftCode} from the SAP pipeline?\n\nThis removes it from the queue. You can queue it again from IcSoft Items later.`,
    );
    if (!ok) return;
    setLoading(true);
    try {
      await api.removePipelineEntry(entry.id);
      setExportSelectedIds((prev) => prev.filter((id) => id !== entry.id));
      if (activePipelineId === entry.id) {
        setActivePipelineId(null);
        setPhase('select');
        setSource(null);
        setAnswers(null);
      }
      await refreshPipeline();
      setToast(`Dismissed ${entry.icsoftCode}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function setField<K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) {
    if (!answers) return;
    setAnswers({ ...answers, [key]: value });
  }

  async function goPreview() {
    if (!source || !answers) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.preview(source, answers);
      setPreviewErrors(res.data.errors || []);
      setPhase('preview');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!source || !answers) return;
    setLoading(true);
    setError('');
    try {
      const b = await ensureBatch();
      const res = await api.commit({
        batchId: b.id,
        source,
        answers,
        copyFromItemId: copyFromId || undefined,
        pipelineEntryId: activePipelineId || undefined,
      });
      setBatch(res.data.batch);
      await refreshPipeline();
      setPhase('select');
      setBucket('committed');
      setSource(null);
      setAnswers(null);
      setActivePipelineId(null);
      setCopyFromId(res.data.batch.items.at(-1)?.id || '');
      setToast(`${source.IcsoftCode} committed · ready for template export`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveGridRow(itemId: string, next: WizardAnswers) {
    if (!batch) return;
    const res = await api.updateItem(batch.id, itemId, next);
    setBatch(res.data);
    setToast('Row updated');
  }

  return (
    <div
      className="space-y-4"
      style={
        {
          ['--row-h' as string]: density === 'compact' ? '32px' : '36px',
        } as React.CSSProperties
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight text-[var(--text)]">
            SAP Item Creation
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-secondary)]">
            Extend IcSoft materials into Migration Cockpit Product (ZRAW) with
            mandatory-field gating, batch commit, and gold-template export.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={density === 'compact' ? 'primary' : 'secondary'}
            onClick={() => setDensity((d) => (d === 'compact' ? 'default' : 'compact'))}
          >
            Density: {density}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPhase('select')}>
            <RefreshCw className="h-4 w-4" />
            Candidates
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} delta={k.delta} tone={k.tone} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(['select', 'wizard', 'preview', 'batch'] as Phase[]).map((p, idx) => {
          const enabled =
            p === 'select' ||
            (p === 'batch' && Boolean(batch)) ||
            (p === 'wizard' && Boolean(answers)) ||
            (p === 'preview' && Boolean(answers));
          return (
            <button
              key={p}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && setPhase(p)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-[12px] font-semibold capitalize transition-colors',
                phase === p
                  ? 'border-[var(--primary)] bg-[var(--selected)] text-[var(--primary)]'
                  : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] hover:bg-[var(--hover)]',
                !enabled && 'opacity-40',
              )}
            >
              <span className="numeric text-[11px] opacity-70">{idx + 1}</span>
              {p}
              {idx < 3 ? <ChevronRight className="h-3.5 w-3.5 opacity-50" /> : null}
            </button>
          );
        })}
        <div className="ml-auto">
          <StatusDot
            tone={error ? 'danger' : loading ? 'warning' : 'success'}
            label={error ? 'Error' : loading ? 'Working…' : 'Ready'}
          />
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-[10px] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      {phase === 'select' ? (
        <Card>
          <CardHeader
            title="IcSoft → SAP pipeline"
            description={BUCKET_META[bucket].description}
            actions={
              <div className="flex items-center gap-2">
                {batch && batch.items.length > 0 ? (
                  <Select
                    label=""
                    className="min-w-[200px]"
                    value={copyFromId}
                    onChange={(e) => setCopyFromId(e.target.value)}
                    options={[
                      { value: '', label: 'Copy config: None' },
                      ...batch.items.map((item) => ({
                        value: item.id,
                        label: `${item.answers.productNumber} · ${item.answers.description.slice(0, 24)}`,
                      })),
                    ]}
                  />
                ) : null}
                <Badge tone="info">ZRAW</Badge>
              </div>
            }
          />
          <div className="flex flex-wrap gap-2 border-b border-[var(--border)] px-4 py-2.5">
            {(['pending', 'committed', 'exported'] as SapPipelineStage[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setBucket(s);
                  setExportSelectedIds([]);
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-semibold transition-colors',
                  bucket === s
                    ? 'border-[var(--primary)] bg-[var(--selected)] text-[var(--primary)]'
                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)] hover:bg-[var(--hover)]',
                )}
              >
                {BUCKET_META[s].title}
                <Badge tone={BUCKET_META[s].badge}>{pipelineCounts[s]}</Badge>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by code, name, group, RawMatID, SAP code…"
                className="h-9 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] pr-3 pl-9 text-[13px] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--focus-ring)]"
              />
            </div>
            {bucket === 'committed' || bucket === 'exported' ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!exportSelectedIds.length}
                  loading={loading}
                  onClick={() => void exportSelectedTemplate('xml')}
                  title="SAP Migration Cockpit SpreadsheetML (.xml)"
                >
                  <Download className="h-4 w-4" />
                  {bucket === 'exported' ? 'Regenerate XML' : 'Generate XML'} (
                  {exportSelectedIds.length})
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!exportSelectedIds.length}
                  loading={loading}
                  onClick={() => void exportSelectedTemplate('xlsx')}
                  title="Excel workbook with the same template columns (.xlsx)"
                >
                  <Download className="h-4 w-4" />
                  {bucket === 'exported' ? 'Regenerate Excel' : 'Generate Excel'} (
                  {exportSelectedIds.length})
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => void refreshPipeline()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          <div className="scroll-panel max-h-[min(560px,58vh)]">
            {bucketEntries.length === 0 ? (
              <EmptyState
                icon={PackagePlus}
                title={`No items in ${BUCKET_META[bucket].title}`}
                description={
                  bucket === 'pending'
                    ? 'Select items in IcSoft Items → Queue for SAP, or Extend for SAP from Item Properties.'
                    : bucket === 'committed'
                      ? 'Commit items from the wizard, select rows, then Generate gold XML.'
                      : 'Select rows to re-generate XML/Excel, or save SAP item codes.'
                }
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    {bucket === 'committed' || bucket === 'exported' ? (
                      <th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all for template export"
                          checked={
                            bucketEntries.length > 0 &&
                            bucketEntries.every((e) =>
                              exportSelectedIds.includes(e.id),
                            )
                          }
                          onChange={() => toggleExportSelectAllVisible()}
                        />
                      </th>
                    ) : null}
                    <th className="sticky-col left-0">IcSoft Code</th>
                    <th>Description</th>
                    <th>Group</th>
                    <th>UoM</th>
                    <th>Plant</th>
                    <th>SLoc</th>
                    {bucket === 'exported' ? <th>SAP Item Code</th> : null}
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketEntries.map((entry) => (
                    <tr key={entry.id}>
                      {bucket === 'committed' || bucket === 'exported' ? (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${entry.icsoftCode} in template export`}
                            checked={exportSelectedIds.includes(entry.id)}
                            onChange={() => toggleExportSelect(entry.id)}
                          />
                        </td>
                      ) : null}
                      <td className="sticky-col left-0 font-semibold">
                        <div className="flex items-center gap-1.5">
                          <span className="numeric">{entry.icsoftCode}</span>
                          <Badge tone={BUCKET_META[entry.stage].badge}>
                            {entry.stage}
                          </Badge>
                        </div>
                      </td>
                      <td className="max-w-[280px] truncate">{entry.rawMatName}</td>
                      <td>
                        <Badge>{entry.productGroup || '—'}</Badge>
                      </td>
                      <td className="numeric">{entry.baseUom || '—'}</td>
                      <td className="numeric">{entry.plant || '—'}</td>
                      <td className="numeric">{entry.storageLocation || '—'}</td>
                      {bucket === 'exported' ? (
                        <td>
                          <input
                            value={sapCodeDrafts[entry.id] ?? entry.sapItemCode ?? ''}
                            onChange={(e) =>
                              setSapCodeDrafts((d) => ({
                                ...d,
                                [entry.id]: e.target.value,
                              }))
                            }
                            placeholder="SAP material code"
                            className="h-8 w-full min-w-[140px] rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px] outline-none focus:border-[var(--primary)]"
                          />
                        </td>
                      ) : null}
                      <td className="text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {bucket === 'pending' ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void processEntry(entry)}
                            >
                              Process
                            </Button>
                          ) : bucket === 'committed' ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => void processEntry(entry)}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void saveSapItemCode(entry)}
                            >
                              Save SAP code
                            </Button>
                          )}
                          {bucket !== 'exported' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={`Dismiss ${entry.icsoftCode}`}
                              onClick={() => void dismissEntry(entry)}
                            >
                              <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                              Dismiss
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <CardFooter>
            <span className="text-[12px] text-[var(--text-muted)]">
              Showing {bucketEntries.length} row(s) in {BUCKET_META[bucket].title}
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">
              {bucket === 'committed'
                ? 'Select rows → Generate XML or Excel · selected items move to Template created'
                : bucket === 'exported'
                  ? 'Select rows to Regenerate XML/Excel · Save SAP code writes sap_new_item_master (ProcessID/DeptId blank)'
                  : 'Metadata saved on commit for template generation'}
            </span>
          </CardFooter>
        </Card>
      ) : null}

      {phase === 'wizard' && answers && source ? (
        <div className="grid gap-4 xl:grid-cols-12">
          <Card className="xl:col-span-3">
            <CardHeader title="Source snapshot" description="Read-only ERP defaults" />
            <CardBody className="space-y-2 text-[13px]">
              {[
                ['IcSoft', source.IcsoftCode],
                ['RawMatID', String(source.RawMatID)],
                ['Name', source.Rawmatname || '—'],
                ['Group', source.ProductGroup || '—'],
                ['Plant', source.sap_plantcode || '—'],
                ['SLoc', source.storage_location || '—'],
                ['HSN', source.hsncode || '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-1.5 last:border-0">
                  <span className="text-[var(--text-muted)]">{k}</span>
                  <span className="numeric text-right font-medium text-[var(--text)]">{v}</span>
                </div>
              ))}
              {copyFromId ? (
                <div className="mt-2 flex items-center gap-1.5 rounded-[10px] bg-[var(--info-bg)] px-2.5 py-2 text-[12px] text-[var(--info)]">
                  <Copy className="h-3.5 w-3.5" />
                  Copying prior batch config
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card className="xl:col-span-9">
            <CardHeader
              title={`Step ${stepIdx + 1}: ${step.title}`}
              description="Required fields must be completed before Next"
              actions={
                <div className="flex flex-wrap gap-1">
                  {STEP_META.map((s, i) => (
                    <span
                      key={s.id}
                      className={cn(
                        'rounded-md px-2 py-1 text-[11px] font-semibold',
                        i === stepIdx
                          ? 'bg-[var(--primary)] text-white'
                          : i < stepIdx
                            ? 'bg-[var(--success-bg)] text-[var(--success)]'
                            : 'bg-[var(--hover)] text-[var(--text-muted)]',
                      )}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
              }
            />
            <CardBody>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {step.fields.map((field) => {
                  const value = answers[field];
                  if (
                    field === 'storageLocations' ||
                    field === 'valuationAreas' ||
                    field === 'distributionChannels'
                  ) {
                    const options =
                      field === 'storageLocations'
                        ? lookups?.storageLocations || []
                        : field === 'valuationAreas'
                          ? (lookups?.plants || []).map((p) => p.value)
                          : (lookups?.distributionChannels || []).map((d) => d.value)
                              .length
                            ? (lookups?.distributionChannels || []).map((d) => d.value)
                            : ['ST', 'DS', 'ES', 'SS', 'FC', 'EF', 'TP', 'JW', 'AS', 'SR'];
                    const selected = (value as string[]) || [];
                    return (
                      <div key={field} className="md:col-span-2 xl:col-span-3">
                        <p className="mb-1.5 text-[13px] font-medium">
                          {LABELS[field]}
                          <span className="text-[var(--danger)]"> *</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {options.map((opt) => {
                            const on = selected.includes(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  const next = on
                                    ? selected.filter((x) => x !== opt)
                                    : [...selected, opt];
                                  setField(field, next);
                                }}
                                className={cn(
                                  'h-8 rounded-[10px] border px-2.5 text-[12px] font-semibold',
                                  on
                                    ? 'border-[var(--primary)] bg-[var(--selected)] text-[var(--primary)]'
                                    : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)]',
                                )}
                              >
                                <span className="numeric">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (typeof value === 'boolean') {
                    return (
                      <label
                        key={field}
                        className="flex h-9 items-center gap-2 rounded-[10px] border border-[var(--border)] px-3 text-[13px]"
                      >
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(e) => setField(field, e.target.checked)}
                        />
                        <span className="font-medium">{LABELS[field]}</span>
                      </label>
                    );
                  }

                  if (
                    field === 'mrpType' ||
                    field === 'procurementType' ||
                    field === 'distributionChannel' ||
                    field === 'productType'
                  ) {
                    const fallback: Record<string, Array<{ value: string; label: string }>> = {
                      mrpType: [
                        { value: 'PD', label: 'PD — MRP' },
                        { value: 'ND', label: 'ND — No MRP' },
                      ],
                      procurementType: [
                        { value: 'E', label: 'E — In-house' },
                        { value: 'F', label: 'F — External' },
                        { value: 'X', label: 'X — Both' },
                      ],
                      distributionChannel: [
                        { value: 'ST', label: 'ST' },
                        { value: 'DS', label: 'DS' },
                      ],
                      productType: [
                        { value: 'ZRAW', label: 'ZRAW — RAW MATERIAL' },
                      ],
                    };
                    const lookupMap: Record<string, string> = {
                      mrpType: 'mrpTypes',
                      procurementType: 'procurementTypes',
                      distributionChannel: 'distributionChannels',
                      productType: 'productTypes',
                    };
                    const opts =
                      (lookups as any)?.[lookupMap[field]]?.length
                        ? (lookups as any)[lookupMap[field]]
                        : fallback[field] || [];
                    return (
                      <Select
                        key={field}
                        label={LABELS[field]}
                        requiredMark
                        value={String(value)}
                        onChange={(e) => setField(field, e.target.value as never)}
                        options={opts}
                      />
                    );
                  }

                  const required = ![
                    'oldProductNumber',
                    'grossWeight',
                    'netWeight',
                    'weightUom',
                    'loadingGroup',
                    'hsnCode',
                    'priceControlDetermination',
                  ].includes(field);

                  return (
                    <Input
                      key={field}
                      label={LABELS[field]}
                      requiredMark={required}
                      value={String(value ?? '')}
                      maxLength={field === 'description' ? 40 : undefined}
                      className={
                        ['productNumber', 'baseUom', 'plant', 'profitCenter', 'hsnCode'].includes(
                          field,
                        )
                          ? 'numeric'
                          : undefined
                      }
                      onChange={(e) => setField(field, e.target.value as never)}
                    />
                  );
                })}
              </div>
            </CardBody>
            <CardFooter>
              <Button
                size="sm"
                variant="secondary"
                disabled={stepIdx === 0}
                onClick={() => setStepIdx((s) => s - 1)}
              >
                Back
              </Button>
              {stepIdx < STEP_META.length - 1 ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!stepValid}
                  onClick={() => setStepIdx((s) => s + 1)}
                >
                  Next
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!stepValid || loading}
                  loading={loading}
                  onClick={goPreview}
                >
                  Preview
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      ) : null}

      {phase === 'preview' && answers && source ? (
        <Card>
          <CardHeader
            title="Item preview"
            description={`${answers.productNumber} · ${answers.description}`}
            actions={
              previewErrors.length ? (
                <Badge tone="danger">{previewErrors.length} issues</Badge>
              ) : (
                <Badge tone="success">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Valid
                  </span>
                </Badge>
              )
            }
          />
          <CardBody className="space-y-4">
            {previewErrors.length > 0 ? (
              <ul className="list-disc space-y-1 rounded-[10px] bg-[var(--warning-bg)] px-5 py-3 text-[13px] text-[var(--warning)]">
                {previewErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {STEP_META.map((group) => (
              <section key={group.id}>
                <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-muted)] uppercase">
                  {group.title}
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.fields.map((field) => {
                    const raw = answers[field as keyof WizardAnswers];
                    const display = formatPreviewValue(raw);
                    const empty = isEmpty(raw);
                    return (
                      <div
                        key={field}
                        className="rounded-[10px] border border-[var(--border)] px-3 py-2"
                      >
                        <dt className="text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
                          {LABELS[field] || field}
                        </dt>
                        <dd
                          className={cn(
                            'mt-1 text-[13px] font-medium break-words',
                            empty ? 'text-[var(--text-muted)]' : 'text-[var(--text)]',
                            typeof raw !== 'boolean' && 'numeric',
                          )}
                        >
                          {display}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ))}
          </CardBody>
          <CardFooter>
            <Button size="sm" variant="secondary" onClick={() => setPhase('wizard')}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={previewErrors.length > 0 || loading}
              loading={loading}
              onClick={commit}
            >
              <Plus className="h-4 w-4" />
              Commit to batch
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {phase === 'batch' ? (
        <Card>
          <CardHeader
            title="Committed batch grid"
            description={
              batch
                ? `${batch.items.length} line(s) · ${batch.id.slice(0, 8)}… · inline edit on blur`
                : 'No active batch'
            }
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPhase('select')}>
                  <Plus className="h-4 w-4" />
                  Add item
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setPhase('select');
                    setBucket('committed');
                  }}
                >
                  <Download className="h-4 w-4" />
                  Go to Ready for template
                </Button>
              </div>
            }
          />
          {!batch || batch.items.length === 0 ? (
            <EmptyState
              icon={PackagePlus}
              title="Batch is empty"
              description="Commit at least one validated item to enable gold-template export."
              actionLabel="Select candidate"
              onAction={() => setPhase('select')}
            />
          ) : (
            <div className="scroll-panel max-h-[min(520px,55vh)]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sticky-col">Product</th>
                    <th>Description</th>
                    <th>Group</th>
                    <th>Plant</th>
                    <th>UoM</th>
                    <th>MRP</th>
                    <th>Proc</th>
                    <th>SLoc</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batch.items.map((item) => (
                    <tr key={item.id}>
                      <td className="sticky-col">
                        <input
                          className="numeric h-8 w-32 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px]"
                          defaultValue={item.answers.productNumber}
                          onBlur={(e) =>
                            saveGridRow(item.id, {
                              ...item.answers,
                              productNumber: e.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="h-8 w-52 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px]"
                          defaultValue={item.answers.description}
                          maxLength={40}
                          onBlur={(e) =>
                            saveGridRow(item.id, {
                              ...item.answers,
                              description: e.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="h-8 w-24 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px]"
                          defaultValue={item.answers.productGroup}
                          onBlur={(e) =>
                            saveGridRow(item.id, {
                              ...item.answers,
                              productGroup: e.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="numeric h-8 w-16 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px]"
                          defaultValue={item.answers.plant}
                          onBlur={(e) =>
                            saveGridRow(item.id, {
                              ...item.answers,
                              plant: e.target.value,
                              profitCenter: `${e.target.value}01`,
                              valuationAreas: [e.target.value],
                            })
                          }
                        />
                      </td>
                      <td className="numeric">{item.answers.baseUom}</td>
                      <td>
                        <Badge tone="info">{item.answers.mrpType}</Badge>
                      </td>
                      <td>
                        <Badge>{item.answers.procurementType}</Badge>
                      </td>
                      <td className="numeric text-[12px]">
                        {item.answers.storageLocations.join(', ')}
                      </td>
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove row"
                          onClick={async () => {
                            const res = await api.removeItem(batch.id, item.id);
                            setBatch(res.data);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-[var(--danger)]" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[13px] shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
