const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010/api';

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
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
    try {
      const body = await res.json();
      message = body.message?.message || body.message || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === 'string' ? message : 'Request failed');
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
  mrpType: 'PD' | 'ND';
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
    rawMatId: number,
    overrides?: {
      plant?: string;
      storageLocation?: string;
      locationId?: number;
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
      };
    }>('/sap-items/lookups'),
  exportUrl: (batchId: string, regenerate = false) =>
    `${API_URL}/sap-items/batches/${batchId}/export${regenerate ? '?regenerate=true' : ''}`,

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
  ) =>
    request<{
      success: boolean;
      data: SapPipelineEntry[];
      counts: Record<SapPipelineStage, number>;
    }>('/sap-items/pipeline/enqueue', {
      method: 'POST',
      body: JSON.stringify({ rawMatIds, hints }),
    }),

  updatePipelineSapCode: (id: string, sapItemCode: string) =>
    request<{
      success: boolean;
      data: SapPipelineEntry;
      counts: Record<SapPipelineStage, number>;
    }>(`/sap-items/pipeline/${id}/sap-code`, {
      method: 'PATCH',
      body: JSON.stringify({ sapItemCode }),
    }),

  removePipelineEntry: (id: string) =>
    request<{
      success: boolean;
      counts: Record<SapPipelineStage, number>;
    }>(`/sap-items/pipeline/${id}`, { method: 'DELETE' }),

  exportBatch: async (batchId: string, regenerate = false) => {
    const res = await fetch(
      `${API_URL}/sap-items/batches/${batchId}/export${regenerate ? '?regenerate=true' : ''}`,
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
    const res = await fetch(`${API_URL}/sap-items/pipeline/export`, {
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
    return { blob, filename, regenerated, format };
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
