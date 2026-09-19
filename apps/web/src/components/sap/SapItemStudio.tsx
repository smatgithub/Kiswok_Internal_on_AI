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
  Upload,
  X,
} from 'lucide-react';
import {
  api,
  Batch,
  BulkSapCodeResult,
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
import { toIsoUom, WEIGHT_UOM_ISO, applyProductTypeStandards, isServiceProduct, isSpareProduct, isConsumableProduct } from '@kiswok/shared';
import { NewSapItemDialog } from '@/components/sap/NewSapItemDialog';

type Phase = 'select' | 'wizard' | 'preview' | 'batch';

function withIsoUoms(answers: WizardAnswers): WizardAnswers {
  const next = applyProductTypeStandards({
    ...answers,
    baseUom: toIsoUom(answers.baseUom) || answers.baseUom,
  });
  return next;
}

function pipelineMatType(entry: SapPipelineEntry): string {
  return (
    entry.productType ||
    entry.answers?.productType ||
    entry.source?.productType ||
    '—'
  );
}

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
      'XML/Excel already generated · enter SAP codes (Save / Update) or bulk upload · rows with a code cannot be re-selected for regenerate',
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
  baseUom: 'Base UoM (ISO)',
  oldProductNumber: 'Old Product No. (IcSoft)',
  batchManaged: 'Batch Managed',
  grossWeight: 'Gross Weight',
  netWeight: 'Net Weight',
  weightUom: 'Unit of Weight (ISO)',
  viewQuality: 'Quality view',
  viewSales: 'Sales view',
  viewStorage: 'Storage view (blank for Service)',
  viewPurchasing: 'Purchasing view',
  salesOrganization: 'Sales Org',
  distributionChannels: 'Dist. Channels',
  distributionChannel: 'Dist. Channel',
  itemCategoryGroup: 'Item Cat. Group (NORM/SERV)',
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
  const [newOpen, setNewOpen] = useState(false);

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
  const [bulkSapSummary, setBulkSapSummary] = useState<BulkSapCodeResult | null>(null);
  const sapCodeFileRef = useRef<HTMLInputElement>(null);
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
    storageLocationsByPlant?: Record<string, string[]>;
    plants: Array<{ value: string; label: string }>;
    productTypes: Array<{ value: string; label: string }>;
    distributionChannels: Array<{ value: string; label: string }>;
    mrpTypes: Array<{ value: string; label: string }>;
    procurementTypes: Array<{ value: string; label: string }>;
    materialGroups?: Array<{ value: string; label: string }>;
    hsnCodes?: Array<{ value: string; label: string; kind?: string }>;
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
        e.productType,
        e.answers?.productType,
        e.source?.productType,
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

  // Drop regenerate selection once a SAP code is saved on that row
  useEffect(() => {
    if (bucket !== 'exported') return;
    const coded = new Set(
      pipeline
        .filter((e) => e.stage === 'exported' && (e.sapItemCode || '').trim())
        .map((e) => e.id),
    );
    setExportSelectedIds((prev) => prev.filter((id) => !coded.has(id)));
  }, [pipeline, bucket]);

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
        setAnswers(withIsoUoms(res.data.defaults));
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

  useEffect(() => {
    const pipelineId = searchParams.get('pipelineId');
    if (!pipelineId) return;
    if (extendHandled.current === `pipe:${pipelineId}`) return;
    extendHandled.current = `pipe:${pipelineId}`;
    (async () => {
      setError('');
      setLoading(true);
      try {
        const pipe = await refreshPipeline();
        const entry = pipe.data.find((e) => e.id === pipelineId);
        if (!entry) {
          throw new Error('Created item was not found in the pipeline.');
        }
        setBucket(entry.stage);
        await processEntry(entry);
        router.replace('/sap-items', { scroll: false });
      } catch (e) {
        setError((e as Error).message);
        setPhase('select');
      } finally {
        setLoading(false);
      }
    })();
    // processEntry is stable enough for this one-shot query param
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router, refreshPipeline]);

  const step = STEP_META[stepIdx];

  const stepValid = useMemo(() => {
    if (!answers) return false;
    const service = isServiceProduct(answers.productType);
    const spare = isSpareProduct(answers.productType);
    const optional = [
      'oldProductNumber',
      'grossWeight',
      'netWeight',
      'weightUom',
      'loadingGroup',
      'priceControlDetermination',
      ...(spare ? ['accountAssignmentGroup'] : []),
      ...(service
        ? [
            'mrpType',
            'mrpController',
            'lotSizingProcedure',
            'strategyGroup',
            'storageLocations',
            'valuationClass',
            'priceControl',
            'currency',
            'viewStorage',
            'viewQuality',
          ]
        : []),
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
        pipelineEntryId: entry.id,
        plants: entry.plants || undefined,
        slocs: entry.slocs || undefined,
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
            productType: defaults.productType || prev.answers.productType,
            valuationClass:
              defaults.valuationClass || prev.answers.valuationClass,
            productGroup: defaults.productGroup || prev.answers.productGroup,
            baseUom: toIsoUom(defaults.baseUom || prev.answers.baseUom) ||
              defaults.baseUom ||
              prev.answers.baseUom,
            weightUom: WEIGHT_UOM_ISO,
            plant: defaults.plant || prev.answers.plant,
            profitCenter: `${defaults.plant || prev.answers.plant}01`,
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
      setAnswers(withIsoUoms(defaults));
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
    const isUpdate = Boolean((entry.sapItemCode || '').trim());
    setLoading(true);
    try {
      await api.updatePipelineSapCode(entry.id, code);
      setExportSelectedIds((prev) => prev.filter((id) => id !== entry.id));
      await refreshPipeline();
      setToast(
        isUpdate
          ? `SAP code updated to ${code} · sap_new_item_master updated`
          : `SAP code ${code} saved · sap_new_item_master updated`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function entryHasSapCode(entry: SapPipelineEntry): boolean {
    return Boolean((entry.sapItemCode || '').trim());
  }

  function isAlreadyInSap(entry: SapPipelineEntry): boolean {
    return Boolean(entry.alreadyInSap?.sapCode);
  }

  function selectableExportIds(entries: SapPipelineEntry[]): string[] {
    return entries
      .filter((e) => !isAlreadyInSap(e))
      .filter((e) => !(bucket === 'exported' && entryHasSapCode(e)))
      .map((e) => e.id);
  }

  function toggleExportSelect(id: string) {
    const entry = pipeline.find((e) => e.id === id);
    if (entry && isAlreadyInSap(entry)) return;
    if (bucket === 'exported' && entry && entryHasSapCode(entry)) return;
    setExportSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleExportSelectAllVisible() {
    const ids = selectableExportIds(bucketEntries);
    const allOn = ids.length > 0 && ids.every((id) => exportSelectedIds.includes(id));
    setExportSelectedIds((prev) =>
      allOn
        ? prev.filter((id) => !ids.includes(id))
        : Array.from(new Set([...prev, ...ids])),
    );
  }

  async function downloadSapCodeTemplate() {
    setLoading(true);
    setError('');
    try {
      const { blob, filename } = await api.downloadSapCodeTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setToast(`Downloaded ${filename}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSapCodeFileSelected(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.bulkUploadSapCodes(file);
      setPipelineCounts(res.counts);
      await refreshPipeline();
      setBulkSapSummary(res.data);
      const t = res.data.totals;
      setToast(
        `Bulk SAP codes · ${t.updated} updated · ${t.mismatches} mismatch(es) · ${t.skippedBlank} blank`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      if (sapCodeFileRef.current) sapCodeFileRef.current.value = '';
    }
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
      const { blob, filename, excludedCount, excludedSample } = await api.exportPipelineEntries(
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
          ? `Template regenerated · ${exportedIds.length - (excludedCount || 0)} item(s) · ${filename}`
          : `Template created · ${exportedIds.length - (excludedCount || 0)} item(s) · ${filename}` +
            (excludedCount
              ? ` · ${excludedCount} already in SAP excluded${excludedSample ? ` (${excludedSample})` : ''}`
              : ''),
      );
      if (excludedCount) {
        setError(
          `${excludedCount} item(s) already exist in SAP and were excluded from the template${
            excludedSample ? `: ${excludedSample}` : ''
          }`,
        );
      }
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
    if (key === 'plant') {
      // Accept single plant string or multi via valuationAreas updates elsewhere
      const raw = String(value || '');
      const plants = raw
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const primary = plants[0] || '';
      setAnswers({
        ...answers,
        plant: primary,
        profitCenter: primary ? `${primary}01` : answers.profitCenter,
        valuationAreas: plants.length ? plants : answers.valuationAreas,
      });
      return;
    }
    if (key === 'productType') {
      const productType = String(value || 'ZRAW').trim().toUpperCase();
      const valuationByType: Record<string, string> = {
        ZFGM: '7920',
        ZSFG: '7900',
        ZRAW: '3000',
        ZROM: '3000',
        ZPKG: '3050',
        ZSPT: '3040',
        ZCON: '3060',
      };
      const next = applyProductTypeStandards({
        ...answers,
        productType,
        valuationClass: isServiceProduct(productType)
          ? ''
          : valuationByType[productType] || answers.valuationClass,
      });
      if (!isServiceProduct(productType)) {
        next.viewStorage = true;
        next.viewQuality = true;
        if (!next.valuationClass) {
          next.valuationClass = valuationByType[productType] || next.valuationClass;
        }
        if (!next.priceControl) next.priceControl = 'V';
        if (!next.priceControlDetermination) next.priceControlDetermination = '2';
        if (!next.currency) next.currency = 'INR';
        if (!next.loadingGroup) next.loadingGroup = '0001';
      }
      setAnswers(next);
      return;
    }
    if (key === 'distributionChannels' && isServiceProduct(answers.productType)) {
      setAnswers({ ...answers, distributionChannels: ['SS'], distributionChannel: 'SS' });
      return;
    }
    if (
      (key === 'itemCategoryGroup' || key === 'accountAssignmentGroup') &&
      (isServiceProduct(answers.productType) || isSpareProduct(answers.productType))
    ) {
      setAnswers(
        applyProductTypeStandards({
          ...answers,
          itemCategoryGroup: isServiceProduct(answers.productType) ? 'SERV' : 'NORM',
          accountAssignmentGroup: '',
        }),
      );
      return;
    }
    if (key === 'storageLocations' && isServiceProduct(answers.productType)) {
      setAnswers({ ...answers, storageLocations: [] });
      return;
    }
    if (key === 'viewStorage' && isServiceProduct(answers.productType)) {
      setAnswers({ ...answers, viewStorage: false });
      return;
    }
    if (key === 'viewStorage' && isConsumableProduct(answers.productType)) {
      setAnswers({ ...answers, viewStorage: true });
      return;
    }
    if (key === 'weightUom') {
      if (isServiceProduct(answers.productType)) {
        setAnswers({ ...answers, weightUom: '' });
        return;
      }
      setAnswers({ ...answers, weightUom: WEIGHT_UOM_ISO });
      return;
    }
    setAnswers({ ...answers, [key]: value });
  }

  function togglePlant(plantCode: string) {
    if (!answers) return;
    const current = (
      answers.valuationAreas?.length
        ? answers.valuationAreas
        : String(answers.plant || '')
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean)
    );
    const on = current.includes(plantCode);
    const next = on
      ? current.filter((p) => p !== plantCode)
      : [...current, plantCode];
    const primary = next[0] || '';
    setAnswers({
      ...answers,
      plant: primary,
      profitCenter: primary ? `${primary}01` : '',
      valuationAreas: next,
    });
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

  async function commitPendingToReady() {
    if (!pipelineCounts.pending) return;
    const ok = window.confirm(
      `Mark all ${pipelineCounts.pending} pending items as Ready for template?\n\n` +
        'Service (ZSRV): plants 1001, 2001–2006\n' +
        'Other items: plants 2001–2006, storage MXST at minimum',
    );
    if (!ok) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.commitPipelinePending();
      await refreshPipeline();
      if (res.data.failed.length) {
        setError(
          `Ready for template: ${res.data.committed} ok, ${res.data.failed.length} failed. First: ${res.data.failed[0].icsoftCode} — ${res.data.failed[0].error}`,
        );
      }
      setToast(
        `${res.data.committed} items Ready for template` +
          (res.data.failed.length ? ` · ${res.data.failed.length} failed` : ''),
      );
      if (res.data.committed) setBucket('committed');
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
      <NewSapItemDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={async (entry) => {
          const pipe = await refreshPipeline();
          const latest = pipe.data.find((e) => e.id === entry.id) || entry;
          setBucket(latest.stage);
          await processEntry(latest);
        }}
      />
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
          <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}>
            <PackagePlus className="h-4 w-4" />
            New SAP item
          </Button>
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
            {bucket === 'exported' ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={loading}
                  onClick={() => void downloadSapCodeTemplate()}
                  title="Download Excel template to fill SAP item codes in bulk"
                >
                  <Download className="h-4 w-4" />
                  Download SAP codes template
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={loading}
                  onClick={() => sapCodeFileRef.current?.click()}
                  title="Upload filled template — blank rows get codes; existing codes are skipped"
                >
                  <Upload className="h-4 w-4" />
                  Upload SAP codes
                </Button>
                <input
                  ref={sapCodeFileRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) =>
                    void onSapCodeFileSelected(e.target.files?.[0] ?? null)
                  }
                />
              </>
            ) : null}
            {bucket === 'pending' ? (
              <Button
                size="sm"
                variant="primary"
                disabled={!pipelineCounts.pending}
                loading={loading}
                onClick={() => void commitPendingToReady()}
                title="Commit pending items with plant extension and MXST"
              >
                <CheckCircle2 className="h-4 w-4" />
                Ready for template ({pipelineCounts.pending})
              </Button>
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
                          checked={(() => {
                            const ids = selectableExportIds(bucketEntries);
                            return (
                              ids.length > 0 &&
                              ids.every((id) => exportSelectedIds.includes(id))
                            );
                          })()}
                          disabled={selectableExportIds(bucketEntries).length === 0}
                          onChange={() => toggleExportSelectAllVisible()}
                        />
                      </th>
                    ) : null}
                    <th className="sticky-col left-0">IcSoft Code</th>
                    <th>Description</th>
                    <th>Mat Type</th>
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
                          {isAlreadyInSap(entry) ? (
                            <span
                              className="inline-block w-4 text-center text-[11px] text-[var(--text-muted)]"
                              title={entry.alreadyInSap?.reason || 'Already created in SAP — excluded from template'}
                            >
                              —
                            </span>
                          ) : bucket === 'exported' && entryHasSapCode(entry) ? (
                            <span
                              className="inline-block w-4 text-center text-[11px] text-[var(--text-muted)]"
                              title="Selection disabled — SAP item code already saved"
                            >
                              —
                            </span>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`Include ${entry.icsoftCode} in template export`}
                              checked={exportSelectedIds.includes(entry.id)}
                              onChange={() => toggleExportSelect(entry.id)}
                            />
                          )}
                        </td>
                      ) : null}
                      <td className="sticky-col left-0 font-semibold">
                        <div className="flex items-center gap-1.5">
                          <span className="numeric">{entry.icsoftCode}</span>
                          <Badge tone={BUCKET_META[entry.stage].badge}>
                            {entry.stage}
                          </Badge>
                          {isAlreadyInSap(entry) ? (
                            <span
                              title={entry.alreadyInSap?.reason || ''}
                            >
                              <Badge tone="danger">
                                Already in SAP {entry.alreadyInSap?.sapCode}
                              </Badge>
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[280px] truncate">{entry.rawMatName}</td>
                      <td>
                        <Badge>{pipelineMatType(entry)}</Badge>
                      </td>
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
                              variant={entryHasSapCode(entry) ? 'ghost' : 'secondary'}
                              disabled={(() => {
                                const draft = (
                                  sapCodeDrafts[entry.id] ??
                                  entry.sapItemCode ??
                                  ''
                                ).trim();
                                if (!draft) return true;
                                return draft === (entry.sapItemCode || '').trim();
                              })()}
                              onClick={() => void saveSapItemCode(entry)}
                            >
                              {entryHasSapCode(entry) ? 'Update' : 'Save SAP code'}
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
                  ? 'Rows with SAP code cannot be selected · blank codes: Save · corrections: Update · bulk via Download/Upload template'
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
                  const serviceItem = isServiceProduct(answers.productType);
                  const spareItem = isSpareProduct(answers.productType);
                  const consumableItem = isConsumableProduct(answers.productType);
                  // Valuation area mirrors selected plants — one BWKEY row per plant on export
                  if (field === 'valuationAreas') {
                    const plants = (
                      answers.valuationAreas?.length
                        ? answers.valuationAreas
                        : answers.plant
                          ? [answers.plant]
                          : []
                    ).join(', ');
                    return (
                      <Input
                        key={field}
                        label={`${LABELS[field]} (same as Plant)`}
                        requiredMark
                        value={plants}
                        className="numeric"
                        readOnly
                      />
                    );
                  }
                  if (field === 'plant') {
                    const options =
                      (lookups?.plants || []).map((p) => p.value).length > 0
                        ? (lookups?.plants || []).map((p) => p.value)
                        : ['1001', '1002', '2001', '2002', '2003', '2004', '2005', '2006', '3001', '3002', '3003'];
                    const selected = answers.valuationAreas?.length
                      ? answers.valuationAreas
                      : answers.plant
                        ? [answers.plant]
                        : [];
                    return (
                      <div key={field} className="md:col-span-2 xl:col-span-3">
                        <p className="mb-1.5 text-[13px] font-medium">
                          {LABELS[field]}
                          <span className="text-[var(--danger)]"> *</span>
                          <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">
                            Default 2001–2006 · each plant becomes its own Plant / Valuation / SLoc row
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {options.map((opt) => {
                            const on = selected.includes(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => togglePlant(opt)}
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
                        {selected.length > 0 ? (
                          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                            Profit centers:{' '}
                            {selected.map((p) => `${p}→${p}01`).join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    );
                  }
                  if (
                    field === 'storageLocations' ||
                    field === 'distributionChannels'
                  ) {
                    if (field === 'storageLocations' && serviceItem) {
                      return (
                        <div key={field} className="md:col-span-2 xl:col-span-3">
                          <Input
                            label={LABELS[field]}
                            value=""
                            disabled
                            readOnly
                            hint="Blank for Service — Storage Location sheet is not written"
                          />
                        </div>
                      );
                    }
                    const options =
                      field === 'storageLocations'
                        ? (() => {
                            const selectedPlants = answers.valuationAreas?.length
                              ? answers.valuationAreas
                              : answers.plant
                                ? [answers.plant]
                                : [];
                            const byPlant = lookups?.storageLocationsByPlant;
                            if (byPlant && selectedPlants.length) {
                              return Array.from(
                                new Set(
                                  selectedPlants.flatMap(
                                    (p) => byPlant[p] || [],
                                  ),
                                ),
                              ).sort();
                            }
                            return lookups?.storageLocations || [];
                          })()
                        : serviceItem
                          ? ['SS']
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
                          {field === 'distributionChannels' && serviceItem ? (
                            <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">
                              Service is always SS
                            </span>
                          ) : null}
                          {field === 'storageLocations' && consumableItem ? (
                            <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">
                              Required for Consumable · Storage view marked X
                            </span>
                          ) : null}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {options.map((opt) => {
                            const on = selected.includes(opt);
                            const locked = field === 'distributionChannels' && serviceItem;
                            return (
                              <button
                                key={opt}
                                type="button"
                                disabled={locked}
                                onClick={() => {
                                  if (locked) return;
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
                                  locked && 'cursor-not-allowed opacity-80',
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
                    const lockOff =
                      serviceItem && (field === 'viewStorage' || field === 'viewQuality');
                    const lockOn = consumableItem && field === 'viewStorage';
                    return (
                      <label
                        key={field}
                        className="flex h-9 items-center gap-2 rounded-[10px] border border-[var(--border)] px-3 text-[13px]"
                      >
                        <input
                          type="checkbox"
                          checked={lockOn ? true : lockOff ? false : value}
                          disabled={lockOff || lockOn}
                          onChange={(e) => setField(field, e.target.checked)}
                        />
                        <span className="font-medium">{LABELS[field]}</span>
                      </label>
                    );
                  }

                  if (field === 'productGroup' && (lookups?.materialGroups || []).length) {
                    return (
                      <Select
                        key={field}
                        label={LABELS[field]}
                        requiredMark
                        value={String(value || '')}
                        onChange={(e) => setField(field, e.target.value as never)}
                        options={[
                          { value: '', label: 'Select material group' },
                          ...(lookups?.materialGroups || []),
                        ]}
                      />
                    );
                  }

                  if (field === 'hsnCode' && (lookups?.hsnCodes || []).length) {
                    return (
                      <Select
                        key={field}
                        label={LABELS[field]}
                        requiredMark
                        value={String(value || '')}
                        onChange={(e) => setField(field, e.target.value as never)}
                        options={[
                          { value: '', label: 'Select HSN / SAC from master' },
                          ...(lookups?.hsnCodes || []).map((h) => ({
                            value: h.value,
                            label: h.label,
                          })),
                        ]}
                      />
                    );
                  }

                  if (field === 'itemCategoryGroup' || field === 'accountAssignmentGroup') {
                    const lockAcct = field === 'accountAssignmentGroup' && spareItem;
                    const lockItemCat = field === 'itemCategoryGroup' && serviceItem;
                    const opts =
                      field === 'itemCategoryGroup'
                        ? [
                            { value: 'NORM', label: 'NORM — Standard item' },
                            { value: 'SERV', label: 'SERV — Service' },
                          ]
                        : [
                            { value: '', label: '— Not required (Spare)' },
                            { value: '01', label: '01 — Default / Service' },
                            { value: '02', label: '02 — Raw material' },
                            { value: '03', label: '03 — Finished goods' },
                          ];
                    return (
                      <Select
                        key={field}
                        label={LABELS[field]}
                        requiredMark={field === 'itemCategoryGroup'}
                        disabled={lockAcct || lockItemCat}
                        value={String(value || '')}
                        onChange={(e) => setField(field, e.target.value as never)}
                        options={opts}
                      />
                    );
                  }

                  if (
                    field === 'mrpType' ||
                    field === 'procurementType' ||
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
                      productType: [
                        { value: 'ZFGM', label: 'ZFGM — FINISHED GOODS' },
                        { value: 'ZSFG', label: 'ZSFG — SEMI FINISHED GOODS' },
                        { value: 'ZRAW', label: 'ZRAW — RAW MATERIAL' },
                        { value: 'ZPKG', label: 'ZPKG — PACKAGING MATERIAL' },
                        { value: 'ZSPT', label: 'ZSPT — SPARES' },
                        { value: 'ZCON', label: 'ZCON — CONSUMABLES' },
                        { value: 'ZSRV', label: 'ZSRV — SERVICES' },
                        { value: 'ZSCP', label: 'ZSCP — SCRAP' },
                        { value: 'ZCAP', label: 'ZCAP — FIXED ASSETS' },
                        { value: 'ZPAT', label: 'ZPAT — PATTERN & COREBOX (PRODUCT)' },
                        { value: 'ZEMP', label: 'ZEMP — EMPTIES (RETURNABLES)' },
                        { value: 'ZBYP', label: 'ZBYP — BY-PRODUCT' },
                        { value: 'ZCOP', label: 'ZCOP — CO-PRODUCTS (GENERAL)' },
                        { value: 'ZFRT', label: 'ZFRT — FOUNDRY RETURN (CO-PROD)' },
                        { value: 'ZBRG', label: 'ZBRG — BORING SCRAP (CO-PROD)' },
                        { value: 'ZPRT', label: 'ZPRT — PRT ASSETS' },
                        { value: 'ZPRA', label: 'ZPRA — PRT REGULAR' },
                        { value: 'ZCMP', label: 'ZCMP — COMBINED PRODUCT' },
                        { value: 'ZINP', label: 'ZINP — INTERNAL PRODUCT' },
                      ],
                    };
                    const lookupMap: Record<string, string> = {
                      mrpType: 'mrpTypes',
                      procurementType: 'procurementTypes',
                      productType: 'productTypes',
                    };
                    let opts: Array<{ value: string; label: string }> =
                      (lookups as any)?.[lookupMap[field]]?.length
                        ? (lookups as any)[lookupMap[field]]
                        : fallback[field] || [];
                    // Keep suggested/current value selectable even if lookups lag
                    const current = String(value || '').trim().toUpperCase();
                    if (
                      field === 'productType' &&
                      current &&
                      !opts.some((o) => o.value === current)
                    ) {
                      opts = [{ value: current, label: current }, ...opts];
                    }
                    if (field === 'mrpType' && serviceItem) {
                      opts = [{ value: '', label: '— Blank (Service)' }, ...opts];
                    }
                    const lockMrp = field === 'mrpType' && serviceItem;
                    return (
                      <Select
                        key={field}
                        label={LABELS[field]}
                        requiredMark={field !== 'mrpType' || !serviceItem}
                        disabled={lockMrp}
                        value={String(value ?? '')}
                        onChange={(e) => setField(field, e.target.value as never)}
                        options={opts}
                      />
                    );
                  }

                  if (serviceItem && ['grossWeight', 'netWeight', 'weightUom'].includes(field)) {
                    return null;
                  }

                  const required = ![
                    'oldProductNumber',
                    'grossWeight',
                    'netWeight',
                    'weightUom',
                    'loadingGroup',
                    'priceControlDetermination',
                  ].includes(field);

                  if (field === 'weightUom') {
                    return (
                      <Input
                        key={field}
                        label={LABELS[field]}
                        value={WEIGHT_UOM_ISO}
                        disabled
                        readOnly
                        hint="Always KGM (ISO kilogram) — not used for Service"
                        className="numeric"
                      />
                    );
                  }

                  const serviceLocked = serviceItem &&
                    [
                      'mrpController',
                      'lotSizingProcedure',
                      'strategyGroup',
                      'valuationClass',
                      'priceControl',
                      'priceControlDetermination',
                    ].includes(field);

                  return (
                    <Input
                      key={field}
                      label={LABELS[field]}
                      requiredMark={required && !serviceLocked}
                      value={String(value ?? '')}
                      disabled={serviceLocked}
                      readOnly={serviceLocked}
                      maxLength={
                        field === 'description' ? 40 : field === 'baseUom' ? 3 : undefined
                      }
                      className={
                        ['productNumber', 'baseUom', 'plant', 'profitCenter', 'hsnCode'].includes(
                          field,
                        )
                          ? 'numeric'
                          : undefined
                      }
                      hint={
                        serviceLocked
                          ? 'Blank for Service (ZSRV)'
                          : field === 'baseUom'
                            ? 'ISO format — KG becomes KGM, L becomes LTR, M becomes MTR'
                            : field === 'valuationClass'
                              ? 'ZROM/ZRAW 3000 · ZSPT 3040 · ZCON 3060 · FG 7920'
                              : undefined
                      }
                      onChange={(e) => setField(field, e.target.value as never)}
                      onBlur={
                        field === 'baseUom'
                          ? (e) => {
                              const iso = toIsoUom(e.target.value);
                              if (iso) setField('baseUom', iso);
                            }
                          : undefined
                      }
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
                    <th>Mat Type</th>
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
                        <Badge>{item.answers.productType || '—'}</Badge>
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
                          className="numeric h-8 w-28 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px]"
                          defaultValue={(
                            item.answers.valuationAreas?.length
                              ? item.answers.valuationAreas
                              : [item.answers.plant]
                          ).join(',')}
                          title="Comma-separated plants, e.g. 2002,2004"
                          onBlur={(e) => {
                            const plants = e.target.value
                              .split(/[,;]/)
                              .map((s) => s.trim())
                              .filter(Boolean);
                            const primary = plants[0] || '';
                            void saveGridRow(item.id, {
                              ...item.answers,
                              plant: primary,
                              profitCenter: primary ? `${primary}01` : '',
                              valuationAreas: plants,
                            });
                          }}
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

      {bulkSapSummary ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-sap-summary-title"
            className="max-h-[min(80vh,640px)] w-full max-w-2xl overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--card)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2
                  id="bulk-sap-summary-title"
                  className="text-[15px] font-semibold text-[var(--text)]"
                >
                  Bulk SAP code upload summary
                </h2>
                <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                  {bulkSapSummary.totals.rowsRead} row(s) read ·{' '}
                  {bulkSapSummary.totals.updated} updated ·{' '}
                  {bulkSapSummary.totals.mismatches} mismatch(es) ·{' '}
                  {bulkSapSummary.totals.skippedBlank} blank ·{' '}
                  {bulkSapSummary.totals.notFound} not found
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBulkSapSummary(null)}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="scroll-panel max-h-[min(60vh,480px)] space-y-4 p-4 text-[13px]">
              {bulkSapSummary.updated.length ? (
                <section>
                  <h3 className="mb-1.5 font-semibold text-[var(--success)]">
                    Updated ({bulkSapSummary.updated.length})
                  </h3>
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {bulkSapSummary.updated.map((r) => (
                      <li key={`${r.rawMatId}-${r.sapItemCode}`}>
                        <span className="numeric font-medium text-[var(--text)]">
                          {r.icsoftCode}
                        </span>{' '}
                        → {r.sapItemCode}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {bulkSapSummary.mismatches.length ? (
                <section>
                  <h3 className="mb-1.5 font-semibold text-[var(--warning)]">
                    Mismatch — skipped, already had a code (
                    {bulkSapSummary.mismatches.length})
                  </h3>
                  <p className="mb-1.5 text-[12px] text-[var(--text-muted)]">
                    Use row Update in the grid to correct an existing SAP code.
                  </p>
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {bulkSapSummary.mismatches.map((r) => (
                      <li key={`${r.rawMatId}-mm`}>
                        <span className="numeric font-medium text-[var(--text)]">
                          {r.icsoftCode}
                        </span>
                        : old <span className="numeric">{r.oldSapItemCode}</span> ≠
                        upload <span className="numeric">{r.newSapItemCode}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {bulkSapSummary.skippedUnchanged.length ? (
                <section>
                  <h3 className="mb-1.5 font-semibold text-[var(--text-secondary)]">
                    Unchanged ({bulkSapSummary.skippedUnchanged.length})
                  </h3>
                  <ul className="space-y-1 text-[var(--text-muted)]">
                    {bulkSapSummary.skippedUnchanged.slice(0, 20).map((r) => (
                      <li key={`${r.rawMatId}-same`}>
                        {r.icsoftCode} · {r.sapItemCode}
                      </li>
                    ))}
                    {bulkSapSummary.skippedUnchanged.length > 20 ? (
                      <li>
                        …and {bulkSapSummary.skippedUnchanged.length - 20} more
                      </li>
                    ) : null}
                  </ul>
                </section>
              ) : null}
              {bulkSapSummary.skippedBlank.length ? (
                <section>
                  <h3 className="mb-1.5 font-semibold text-[var(--text-secondary)]">
                    Blank upload cell — skipped ({bulkSapSummary.skippedBlank.length})
                  </h3>
                  <ul className="space-y-1 text-[var(--text-muted)]">
                    {bulkSapSummary.skippedBlank.slice(0, 20).map((r) => (
                      <li key={`${r.rawMatId}-blank`}>{r.icsoftCode}</li>
                    ))}
                    {bulkSapSummary.skippedBlank.length > 20 ? (
                      <li>…and {bulkSapSummary.skippedBlank.length - 20} more</li>
                    ) : null}
                  </ul>
                </section>
              ) : null}
              {bulkSapSummary.notFound.length ? (
                <section>
                  <h3 className="mb-1.5 font-semibold text-[var(--danger)]">
                    Not found in Template created ({bulkSapSummary.notFound.length})
                  </h3>
                  <ul className="space-y-1 text-[var(--text-secondary)]">
                    {bulkSapSummary.notFound.map((r, i) => (
                      <li key={`nf-${i}`}>
                        {r.icsoftCode || '—'} / RawMatID {r.rawMatId ?? '—'}
                        {r.sapItemCode ? ` · ${r.sapItemCode}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {!bulkSapSummary.updated.length &&
              !bulkSapSummary.mismatches.length &&
              !bulkSapSummary.skippedBlank.length &&
              !bulkSapSummary.skippedUnchanged.length &&
              !bulkSapSummary.notFound.length ? (
                <p className="text-[var(--text-muted)]">No data rows processed.</p>
              ) : null}
            </div>
            <div className="flex justify-end border-t border-[var(--border)] px-4 py-3">
              <Button size="sm" variant="primary" onClick={() => setBulkSapSummary(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
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
