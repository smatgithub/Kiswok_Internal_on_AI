import { getApiBase } from '@/lib/api-base';
import type {
  DuplicateCheckResult,
  DuplicateOverride,
} from '@kiswok/shared';

export type { DuplicateCheckResult, DuplicateMatch, DuplicateOverride, DuplicateVerdict } from '@kiswok/shared';

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown> | null;
  constructor(
    message: string,
    status: number,
    body: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function duplicateConflictResults(err: unknown): DuplicateCheckResult[] {
  if (!(err instanceof ApiError) || err.status !== 409) return [];
  const msg = err.body?.message;
  if (msg && typeof msg === 'object' && Array.isArray((msg as { blocked?: unknown }).blocked)) {
    return (msg as { blocked: DuplicateCheckResult[] }).blocked;
  }
  return [];
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('userInfo');
    document.cookie = 'kiswok_auth=; path=/; Max-Age=0; SameSite=Lax';
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  }
  if (!res.ok) {
    let message = res.statusText;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
      const raw = body.message as { message?: string } | string | undefined;
      message =
        (typeof raw === 'object' && raw?.message) ||
        (typeof raw === 'string' ? raw : null) ||
        (typeof body.message === 'string' ? body.message : null) ||
        JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new ApiError(
      typeof message === 'string' ? message : 'Request failed',
      res.status,
      body,
    );
  }
  if (res.headers.get('content-type')?.includes('application/xml')) {
    return res as unknown as T;
  }
  return res.json();
}

export type SapSourceItem = {
  IcsoftCode: string;
  sap_item_code: string | null;
  ProductGroup: string | null;
  /** SAP MTART from sap_live_item_master (or peer mat_group majority). */
  productType?: string | null;
  Rawmatname: string | null;
  grntype?: string | null;
  sap_mat_grp_text?: string | null;
  baseuom: string | null;
  sap_plantcode: string | null;
  storage_location: string | null;
  hsncode: string | null;
  RawMatID: number;
  profitcentercode: string | null;
  weight: number | null;
  WeightUom: string | null;
  lang: string;
};

export type WizardAnswers = {
  productNumber: string;
  productType: string;
  productGroup: string;
  description: string;
  languageKey: string;
  baseUom: string;
  oldProductNumber: string;
  batchManaged: boolean;
  grossWeight: string;
  netWeight: string;
  weightUom: string;
  viewQuality: boolean;
  viewSales: boolean;
  viewStorage: boolean;
  viewPurchasing: boolean;
  salesOrganization: string;
  distributionChannels: string[];
  distributionChannel?: string;
  itemCategoryGroup: string;
  accountAssignmentGroup: string;
  country: string;
  plant: string;
  mrpType: string;
  mrpController: string;
  availabilityCheck: string;
  profitCenter: string;
  loadingGroup: string;
  coProduct: boolean;
  hsnCode: string;
  taxIndicator: string;
  strategyGroup: string;
  lotSizingProcedure: string;
  procurementType: 'E' | 'F' | 'X';
  storageLocations: string[];
  valuationAreas: string[];
  priceControlDetermination: string;
  valuationClass: string;
  priceControl: string;
  currency: string;
};

export type Batch = {
  id: string;
  name: string;
  items: Array<{
    id: string;
    source: SapSourceItem;
    answers: WizardAnswers;
    createdAt: string;
  }>;
  updatedAt: string;
  exportedAt?: string | null;
  exportHistory?: ExportRecord[];
};

export const api = {
  search: (q: string) =>
    request<{ success: boolean; data: SapSourceItem[] }>(
      `/sap-items/candidates?q=${encodeURIComponent(q)}&limit=50`,
    ),
  startWizard: (
    rawMatId: number | undefined,
    overrides?: {
      plant?: string;
      storageLocation?: string;
      locationId?: number;
      pipelineEntryId?: string;
      plants?: string[];
      slocs?: string[];
    },
  ) =>
    request<{
      success: boolean;
      data: {
        source: SapSourceItem;
        defaults: WizardAnswers;
        steps: Array<{ id: string; title: string; fields: string[] }>;
      };
    }>('/sap-items/wizard/start', {
      method: 'POST',
      body: JSON.stringify({
        rawMatId,
        plant: overrides?.plant,
        storageLocation: overrides?.storageLocation,
        locationId: overrides?.locationId,
        pipelineEntryId: overrides?.pipelineEntryId,
        plants: overrides?.plants,
        slocs: overrides?.slocs,
      }),
    }),
  preview: (source: SapSourceItem, answers: WizardAnswers) =>
    request<{
      success: boolean;
      data: { valid: boolean; errors: string[]; preview: Record<string, unknown> };
    }>('/sap-items/wizard/preview', {
      method: 'POST',
      body: JSON.stringify({ source, answers }),
    }),
  createBatch: (name?: string) =>
    request<{ success: boolean; data: Batch }>('/sap-items/batches', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  getBatch: (id: string) =>
    request<{ success: boolean; data: Batch }>(`/sap-items/batches/${id}`),
  listBatches: () =>
    request<{ success: boolean; data: Batch[] }>('/sap-items/batches'),
  commit: (payload: {
    batchId: string;
    source: SapSourceItem;
    answers: WizardAnswers;
    copyFromItemId?: string;
    pipelineEntryId?: string;
  }) =>
    request<{ success: boolean; data: { item: unknown; batch: Batch } }>(
      '/sap-items/commit',
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  updateItem: (batchId: string, itemId: string, answers: WizardAnswers) =>
    request<{ success: boolean; data: Batch }>(
      `/sap-items/batches/${batchId}/items/${itemId}`,
      { method: 'PATCH', body: JSON.stringify({ answers }) },
    ),
  removeItem: (batchId: string, itemId: string) =>
    request<{ success: boolean; data: Batch }>(
      `/sap-items/batches/${batchId}/items/${itemId}`,
      { method: 'DELETE' },
    ),
  lookups: () =>
    request<{
      success: boolean;
      data: {
        productTypes: Array<{ value: string; label: string }>;
        mrpTypes: Array<{ value: string; label: string }>;
        procurementTypes: Array<{ value: string; label: string }>;
        distributionChannels: Array<{ value: string; label: string }>;
        plants: Array<{ value: string; label: string }>;
        storageLocations: string[];
        storageLocationsByPlant?: Record<string, string[]>;
        materialGroups?: Array<{ value: string; label: string }>;
        hsnCodes?: Array<{ value: string; label: string; kind?: string }>;
        uoms?: Array<{ value: string; label: string }>;
        departments?: Array<{ value: string; label: string }>;
        locations?: Array<{ value: string; label: string; plant?: string }>;
        storageLocationOptions?: Array<{ value: string; label: string; plant?: string }>;
        masters?: { hsnCodes?: number; materialGroups?: number };
        masterPattern?: { loaded: boolean; rows?: number; uniqueProducts?: number };
      };
    }>('/sap-items/lookups'),
  exportUrl: (batchId: string, regenerate = false) =>
    `${getApiBase()}/sap-items/batches/${batchId}/export${regenerate ? '?regenerate=true' : ''}`,

  listPipeline: (stage?: SapPipelineStage) =>
    request<{
      success: boolean;
      data: SapPipelineEntry[];
      counts: Record<SapPipelineStage, number>;
    }>(`/sap-items/pipeline${stage ? `?stage=${stage}` : ''}`),

  enqueuePipeline: (
    rawMatIds: number[],
    hints?: Array<{
      rawMatId: number;
      plant?: string;
      storageLocation?: string;
      locationId?: number;
    }>,
    overrides?: Array<{ rawMatId: number; reason: string }>,
  ) =>
    request<{
      success: boolean;
      data: SapPipelineEntry[];
      counts: Record<SapPipelineStage, number>;
    }>('/sap-items/pipeline/enqueue', {
      method: 'POST',
      body: JSON.stringify({ rawMatIds, hints, overrides }),
    }),

  createManualItem: (payload: {
    requester: {
      name: string;
      empCode: string;
      loginId: string;
      email: string;
      deptId: number;
      deptName?: string;
      locationId?: number;
      locationName?: string;
      locationIds?: number[];
      locationNames?: string[];
      justification: string;
    };
    productType: string;
    description: string;
    productGroup: string;
    hsnCode: string;
    hsnOther?: boolean;
    baseUom: string;
    plants: string[];
    storageLocations?: string[];
    locationIds?: number[];
    proposedCode?: string;
    duplicateOverrideReason?: string;
  }) =>
    request<{
      success: boolean;
      data: SapPipelineEntry;
      counts: Record<SapPipelineStage, number>;
    }>('/sap-items/pipeline/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  commitPipelinePending: (pipelineEntryIds?: string[]) =>
    request<{
      success: boolean;
      data: {
        batchId: string;
        requested: number;
        committed: number;
        failed: Array<{ id: string; icsoftCode: string; error: string }>;
        sample: Array<{
          id: string;
          icsoftCode: string;
          productType: string;
          plants: string[];
          storageLocations: string[];
        }>;
        counts: Record<SapPipelineStage, number>;
      };
      counts: Record<SapPipelineStage, number>;
    }>('/sap-items/pipeline/commit-pending', {
      method: 'POST',
      body: JSON.stringify({ pipelineEntryIds }),
    }),

  reviewDuplicates: (body: {
    rawMatId?: number;
    rawMatIds?: number[];
    description?: string;
    rawMatCode?: string;
    hsn?: string;
    uom?: string;
    limit?: number;
  }) =>
    request<{ success: boolean; data: DuplicateCheckResult[] }>(
      '/sap-items/duplicates',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  updatePipelineSapCode: (id: string, sapItemCode: string) =>
    request<{
      success: boolean;
      data: SapPipelineEntry;
      counts: Record<SapPipelineStage, number>;
    }>(`/sap-items/pipeline/${id}/sap-code`, {
      method: 'PATCH',
      body: JSON.stringify({ sapItemCode }),
    }),

  downloadSapCodeTemplate: async () => {
    const res = await fetch(`${getApiBase()}/sap-items/pipeline/sap-code-template`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      let message = 'Template download failed';
      try {
        const body = await res.json();
        message = body.message?.message || body.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(typeof message === 'string' ? message : 'Template download failed');
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match?.[1] || 'SAP_Item_Codes_Upload.xlsx';
    return { blob, filename };
  },

  bulkUploadSapCodes: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${getApiBase()}/sap-items/pipeline/sap-code-bulk`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
    if (res.status === 401 && typeof window !== 'undefined') {
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('userInfo');
      document.cookie = 'kiswok_auth=; path=/; Max-Age=0; SameSite=Lax';
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    if (!res.ok) {
      let message = 'Bulk upload failed';
      try {
        const body = await res.json();
        message = body.message?.message || body.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(typeof message === 'string' ? message : 'Bulk upload failed');
    }
    return res.json() as Promise<{
      success: boolean;
      data: BulkSapCodeResult;
      counts: Record<SapPipelineStage, number>;
    }>;
  },

  removePipelineEntry: (id: string) =>
    request<{
      success: boolean;
      counts: Record<SapPipelineStage, number>;
    }>(`/sap-items/pipeline/${id}`, { method: 'DELETE' }),

  exportBatch: async (batchId: string, regenerate = false) => {
    const res = await fetch(
      `${getApiBase()}/sap-items/batches/${batchId}/export${regenerate ? '?regenerate=true' : ''}`,
      { headers: authHeaders() },
    );
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const regenerated = res.headers.get('X-SAP-Regenerated') === 'true';
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `SAP_Product_ZRAW_${batchId.slice(0, 8)}.xml`;
    return { blob, filename, regenerated };
  },

  exportPipelineEntries: async (
    pipelineEntryIds: string[],
    regenerate = false,
    format: 'xml' | 'xlsx' = 'xml',
  ) => {
    const res = await fetch(`${getApiBase()}/sap-items/pipeline/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ pipelineEntryIds, regenerate, format }),
    });
    if (!res.ok) {
      let message = 'Export failed';
      try {
        const body = await res.json();
        message = body.message?.message || body.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(typeof message === 'string' ? message : 'Export failed');
    }
    const blob = await res.blob();
    const regenerated = res.headers.get('X-SAP-Regenerated') === 'true';
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="([^"]+)"/);
    const fallback =
      format === 'xlsx' ? 'SAP_Product_ZRAW_selected.xlsx' : 'SAP_Product_ZRAW_selected.xml';
    const filename = match?.[1] || fallback;
    const excludedCount = Number(res.headers.get('X-SAP-Excluded-Count') || '0');
    const excludedSample = res.headers.get('X-SAP-Excluded-Sample') || '';
    return { blob, filename, regenerated, format, excludedCount, excludedSample };
  },

  icsoftCategories: () =>
    request<{ success: boolean; data: IcsoftCategory[] }>(
      '/icsoft-items/categories',
    ),
  icsoftItemOptions: (categories: string[], q = '') =>
    request<{ success: boolean; data: IcsoftItemOption[] }>(
      `/icsoft-items/options?categories=${encodeURIComponent(categories.join('|'))}&q=${encodeURIComponent(q)}`,
    ),
  icsoftGrid: (body: {
    selectedGrnTypes: string[];
    selectedRawMatIds: number[];
    allItems?: boolean;
  }) =>
    request<{ success: boolean; data: Record<string, unknown>[]; count: number }>(
      '/icsoft-items/grid',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  icsoftItemDetail: (rawMatId: number) =>
    request<{ success: boolean; data: IcsoftItemDetail }>(
      `/icsoft-items/detail/${rawMatId}`,
    ),
};

export type SapPipelineStage = 'pending' | 'committed' | 'exported';

export type ExportRecord = {
  at: string;
  filename: string;
  batchId: string;
  itemCount: number;
  regenerated?: boolean;
};

export type SapPipelineEntry = {
  id: string;
  rawMatId: number;
  icsoftCode: string;
  rawMatName: string | null;
  productType?: string | null;
  productGroup: string | null;
  baseUom: string | null;
  plant: string | null;
  storageLocation: string | null;
  locationId: number | null;
  stage: SapPipelineStage;
  source: SapSourceItem | null;
  batchId: string | null;
  batchItemId: string | null;
  answers: WizardAnswers | null;
  sheetRows: Record<string, Record<string, string>> | null;
  sapItemCode: string | null;
  exportHistory: ExportRecord[];
  queuedAt: string;
  processedAt: string | null;
  exportedAt: string | null;
  updatedAt: string;
  duplicateReview?: DuplicateOverride | null;
  alreadyInSap?: { sapCode: string; reason: string } | null;
  origin?: 'icsoft' | 'manual';
  requestedBy?: {
    name: string;
    empCode: string;
    loginId: string;
    email: string;
    deptId: number | null;
    deptName?: string | null;
    locationId: number | null;
    locationName?: string | null;
    locationIds?: number[];
    locationNames?: string[];
    justification: string;
  } | null;
  plants?: string[] | null;
  slocs?: string[] | null;
  locationIds?: number[] | null;
};

export type BulkSapCodeResult = {
  updated: Array<{ icsoftCode: string; rawMatId: number; sapItemCode: string }>;
  skippedExisting: Array<{
    icsoftCode: string;
    rawMatId: number;
    existingSapItemCode: string;
    uploadedSapItemCode: string;
  }>;
  mismatches: Array<{
    icsoftCode: string;
    rawMatId: number;
    oldSapItemCode: string;
    newSapItemCode: string;
  }>;
  skippedBlank: Array<{ icsoftCode: string; rawMatId: number }>;
  skippedUnchanged: Array<{
    icsoftCode: string;
    rawMatId: number;
    sapItemCode: string;
  }>;
  notFound: Array<{
    icsoftCode: string | null;
    rawMatId: number | null;
    sapItemCode: string | null;
  }>;
  totals: {
    rowsRead: number;
    updated: number;
    skippedExisting: number;
    mismatches: number;
    skippedBlank: number;
    skippedUnchanged: number;
    notFound: number;
  };
};

export type IcsoftCategory = {
  grnTypeId: number | null;
  grnType: string;
  subGrnTypeIds: number[];
  subGrnTypeIdsRaw: string | null;
};

export type IcsoftItemOption = {
  rawMatId: number;
  label: string;
  rawMatCode: string;
  rawMatName: string;
  grnTypeId: number | null;
};

export type IcsoftItemShop = {
  shopId: number | null;
  shopName: string | null;
  itemSubCategory: string | null;
};

export type IcsoftItemStoreLocation = {
  key: string;
  locationId: number;
  locationName: string | null;
  sapPlantCode: string | null;
  storageLocation: string | null;
  locationMaxLevel: number | null;
  locationMinLevel: number | null;
  locationLeadTime: number | null;
  locationBatchSize: number | null;
  locationReorderLevel: number | null;
  locationMinMaxReqd: string | null;
};

export type IcsoftItemDetail = {
  item: Record<string, unknown>;
  shops: IcsoftItemShop[];
  locations: IcsoftItemStoreLocation[];
};

/** Flatten master + nested shops/locations for popup rendering */
export function optimizeItemDetail(detail: IcsoftItemDetail): Record<string, unknown> {
  return {
    ...detail.item,
    shops: detail.shops,
    locations: detail.locations,
    LocationCount: detail.locations.length,
    ShopCount: detail.shops.length,
  };
}
