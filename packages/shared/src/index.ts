/** Auth user shape aligned with Internal-API login response */
export interface AuthUser {
  name: string;
  emplId: number;
  loginId: string;
  LocationId: number | null;
  EmpCode: string | null;
  Email: string | null;
  DeptId: number | null;
  DId: number | null;
  CatId: number | null;
  role: number | null;
  mfaEnabled?: boolean | string | number;
}

export interface AuthLoginSuccess {
  accessToken: string;
  user: AuthUser;
}

export interface AuthMfaChallenge {
  requiredMFA: true;
  userId: string;
  email?: string | null;
  phone?: string | null;
  otpExpiry?: string;
}

export type AuthLoginResult = AuthLoginSuccess | AuthMfaChallenge;

export function isMfaChallenge(
  data: AuthLoginResult,
): data is AuthMfaChallenge {
  return 'requiredMFA' in data && data.requiredMFA === true;
}

export type ItemStatus = 'draft' | 'committed';

/** Lifecycle stage for IcSoft → SAP pipeline */
export type SapPipelineStage = 'pending' | 'committed' | 'exported';

export interface ExportRecord {
  at: string;
  filename: string;
  batchId: string;
  itemCount: number;
  regenerated?: boolean;
}

export interface ExistingSapMaterial {
  sapCode: string;
  reason: string;
}

export interface SapItemRequester {
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
}

export interface SapPipelineEntry {
  id: string;
  rawMatId: number;
  icsoftCode: string;
  rawMatName: string | null;
  /** SAP MTART (ZRAW, ZSPT, ZCON, …) mapped from IcSoft GRN / live master. */
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
  /** Exact match to a material already created in SAP — exclude from create template. */
  alreadyInSap?: ExistingSapMaterial | null;
  /** Set when the row was raised from New SAP item (not IcSoft extend). */
  origin?: 'icsoft' | 'manual';
  requestedBy?: SapItemRequester | null;
  plants?: string[] | null;
  slocs?: string[] | null;
  locationIds?: number[] | null;
}

export interface SapSourceItem {
  IcsoftCode: string;
  sap_item_code: string | null;
  sap_mat_grp_text: string | null;
  grntype: string | null;
  ProductGroup: string | null;
  /** SAP MTART from sap_live_item_master (or peer mat_group majority). */
  productType?: string | null;
  Rawmatname: string | null;
  lang: string;
  baseuom: string | null;
  PurchaseUom: string | null;
  LONG_TEXT: string | null;
  WeightUom: string | null;
  weight: number | null;
  hsncode: string | null;
  LocationID: number | null;
  sap_plantcode: string | null;
  storage_location: string | null;
  GrnTypeId: number | null;
  RawMatID: number;
  profitcentercode: string | null;
}

export interface WizardAnswers {
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
  /** One Distribution Chains row per channel (default ST + DS). */
  distributionChannels: string[];
  /** @deprecated Legacy single channel — prefer distributionChannels */
  distributionChannel?: string;
  itemCategoryGroup: string;
  /** KTGRM — default 01 per mapping workbook */
  accountAssignmentGroup: string;
  country: string;
  plant: string;
  /** DISMM — PD/ND for stock materials; blank for Service (ZSRV). */
  mrpType: string;
  /** DISPO — always 0001 */
  mrpController: string;
  availabilityCheck: string;
  profitCenter: string;
  loadingGroup: string;
  coProduct: boolean;
  hsnCode: string;
  /** TAXIM — default 0 */
  taxIndicator: string;
  /** STRGR — default 10 */
  strategyGroup: string;
  lotSizingProcedure: string;
  procurementType: 'E' | 'F' | 'X';
  storageLocations: string[];
  valuationAreas: string[];
  priceControlDetermination: string;
  valuationClass: string;
  priceControl: string;
  currency: string;
}

export interface CommittedItem {
  id: string;
  status: ItemStatus;
  source: SapSourceItem;
  answers: WizardAnswers;
  sheetRows: Record<string, Record<string, string>>;
  pipelineEntryId?: string | null;
  exportedAt?: string | null;
  exportHistory?: ExportRecord[];
  sapItemCode?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchState {
  id: string;
  name: string;
  items: CommittedItem[];
  createdAt: string;
  updatedAt: string;
  exportedAt?: string | null;
  exportHistory?: ExportRecord[];
}

export const WIZARD_STEPS = [
  {
    id: 'identity',
    title: 'Product Identity',
    fields: [
      'productNumber',
      'productType',
      'productGroup',
      'description',
      'languageKey',
      'baseUom',
      'oldProductNumber',
    ],
  },
  {
    id: 'basicFlags',
    title: 'Basic Data Flags',
    fields: [
      'batchManaged',
      'grossWeight',
      'netWeight',
      'weightUom',
      'viewQuality',
      'viewSales',
      'viewStorage',
      'viewPurchasing',
    ],
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
    ],
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
    ],
  },
  {
    id: 'storageValuation',
    title: 'Storage & Valuation',
    fields: ['storageLocations', 'valuationAreas', 'priceControlDetermination', 'valuationClass', 'priceControl', 'currency'],
  },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

export type DuplicateVerdict = 'none' | 'similar' | 'duplicate';

export interface DuplicateMatch {
  product: string;
  description: string;
  productType: string | null;
  productGroup: string | null;
  uom: string | null;
  hsn: string | null;
  plants: string[];
  score: number;
  reason: string;
}

export interface DuplicateCheckQuery {
  rawMatId?: number | null;
  description: string;
  rawMatCode?: string | null;
  hsn?: string | null;
  uom?: string | null;
}

export interface DuplicateCheckResult {
  verdict: DuplicateVerdict;
  query: DuplicateCheckQuery;
  matches: DuplicateMatch[];
  catalog: {
    loaded: boolean;
    products: number;
    sourceFile: string | null;
  };
}

/** User confirmation that a blocking description match is not the same material. */
export interface DuplicateOverride {
  rawMatId: number;
  reason: string;
  reviewedAt: string;
  matches: DuplicateMatch[];
}

export const DUPLICATE_BLOCK_SCORE = 88;
export const DUPLICATE_SHOW_SCORE = 58;
export const DUPLICATE_OVERRIDE_MIN_REASON = 8;

/** Gold template GEWEI — Unit of Weight is always kilogram ISO. */
export const WEIGHT_UOM_ISO = 'KGM';

/**
 * Commercial / IcSoft / live-master UoM → UNECE Rec. 20 ISO codes
 * required by SAP Migration Cockpit (MEINS / GEWEI).
 */
const COMMERCIAL_TO_ISO_UOM: Record<string, string> = {
  KG: 'KGM',
  KGS: 'KGM',
  KILO: 'KGM',
  KGM: 'KGM',
  G: 'GRM',
  GM: 'GRM',
  GMS: 'GRM',
  GRM: 'GRM',
  TO: 'TNE',
  TON: 'TNE',
  TNE: 'TNE',
  L: 'LTR',
  LTR: 'LTR',
  LIT: 'LTR',
  ML: 'MLT',
  MLT: 'MLT',
  M: 'MTR',
  MTR: 'MTR',
  MTS: 'MTR',
  RM: 'MTR',
  MM: 'MMT',
  MMT: 'MMT',
  M2: 'MTK',
  SQM: 'MTK',
  MTK: 'MTK',
  M3: 'MTQ',
  MTQ: 'MTQ',
  FT: 'FOT',
  FOT: 'FOT',
  RFT: 'FOT',
  FT2: 'FTK',
  SQF: 'FTK',
  FTK: 'FTK',
  FT3: 'FTQ',
  CFT: 'FTQ',
  FTQ: 'FTQ',
  IN2: 'INK',
  INK: 'INK',
  INCH: 'INH',
  INH: 'INH',
  EA: 'EA',
  EACH: 'EA',
  NOS: 'EA',
  PCS: 'EA',
  SET: 'SET',
  BOX: 'BX',
  BX: 'BX',
  BAG: 'BA',
  BA: 'BA',
  BOT: 'BO',
  BTL: 'BO',
  BO: 'BO',
  PAK: 'PK',
  PK: 'PK',
  PAA: 'PR',
  PR: 'PR',
  PRS: 'PR',
  ROL: 'ROL',
  BDL: 'BE',
  BE: 'BE',
  CYL: 'CY',
  CY: 'CY',
  DZ: 'DZN',
  DOZ: 'DZN',
  DZN: 'DZN',
  KAN: 'CAN',
  DAY: 'DAY',
};

/** Map IcSoft / commercial UoM (KG, L, M) to SAP ISO codes (KGM, LTR, MTR). */
export function toIsoUom(raw: string | null | undefined): string {
  const key = String(raw || '').trim().toUpperCase();
  if (!key || key === '0') return '';
  return COMMERCIAL_TO_ISO_UOM[key] || key;
}

export function isServiceProduct(productType?: string | null): boolean {
  return String(productType || '').trim().toUpperCase() === 'ZSRV';
}

export function isSpareProduct(productType?: string | null): boolean {
  return String(productType || '').trim().toUpperCase() === 'ZSPT';
}

export function isConsumableProduct(productType?: string | null): boolean {
  return String(productType || '').trim().toUpperCase() === 'ZCON';
}

export function isFinishedProduct(productType?: string | null): boolean {
  const t = String(productType || '').trim().toUpperCase();
  return t === 'ZFGM' || t === 'ZSFG';
}

/** General / sales item category: SERV for Service, NORM for all other materials. */
export function itemCategoryForProductType(
  productType?: string | null,
): 'SERV' | 'NORM' {
  return isServiceProduct(productType) ? 'SERV' : 'NORM';
}

export const TRANSPORTATION_GROUP = '0001';

/**
 * KTGRM (Account Assignment Group):
 * Raw → 02, Finished goods → 03, Spare → blank, Service → 01 (required on Distribution Chain).
 */
export function accountAssignmentForProductType(
  productType?: string | null,
): string {
  const t = String(productType || '').trim().toUpperCase();
  if (t === 'ZSPT') return '';
  if (t === 'ZSRV') return '01';
  if (t === 'ZRAW' || t === 'ZROM') return '02';
  if (t === 'ZFGM' || t === 'ZSFG') return '03';
  return '01';
}

/** Kiswok manufacturing plants for stock / spare / consumable / FG. */
export const DEFAULT_KISWOK_PLANTS = [
  '2001',
  '2002',
  '2003',
  '2004',
  '2005',
  '2006',
] as const;

/** Service (ZSRV / SER*) is also extended to plant 1001. */
export const SERVICE_KISWOK_PLANTS = ['1001', ...DEFAULT_KISWOK_PLANTS] as const;

export function plantsForProductType(
  productType?: string | null,
  icsoftCode?: string | null,
): string[] {
  const service =
    isServiceProduct(productType) ||
    String(icsoftCode || '')
      .trim()
      .toUpperCase()
      .startsWith('SER');
  return service
    ? [...SERVICE_KISWOK_PLANTS]
    : [...DEFAULT_KISWOK_PLANTS];
}

/** Service is always distribution channel SS. Stock materials keep ST/DS (SS is removed). */
export function distributionChannelsForProductType(
  productType?: string | null,
  current?: string[],
): string[] {
  if (isServiceProduct(productType)) return ['SS'];
  const list = (current || [])
    .map((c) => String(c || '').trim().toUpperCase())
    .filter((c) => c && c !== 'SS');
  return list.length ? list : ['ST', 'DS'];
}

/**
 * Kiswok MM standards driven by product type (ZSRV vs stock).
 * Applied to wizard defaults, preview, commit, and gold-template export.
 */
export function applyProductTypeStandards(answers: WizardAnswers): WizardAnswers {
  const productType = String(answers.productType || 'ZRAW')
    .trim()
    .toUpperCase();
  const service = isServiceProduct(productType);
  const channels = distributionChannelsForProductType(
    productType,
    answers.distributionChannels,
  );
  const next: WizardAnswers = {
    ...answers,
    productType,
    itemCategoryGroup: itemCategoryForProductType(productType),
    accountAssignmentGroup: accountAssignmentForProductType(productType),
    distributionChannels: channels,
    distributionChannel: channels[0],
  };
  if (service) {
    next.viewStorage = false;
    next.viewQuality = false;
    next.viewSales = true;
    next.mrpType = '';
    next.mrpController = '';
    next.lotSizingProcedure = '';
    next.strategyGroup = '';
    next.storageLocations = [];
    next.grossWeight = '';
    next.netWeight = '';
    next.weightUom = '';
    next.loadingGroup = TRANSPORTATION_GROUP;
  } else {
    next.loadingGroup = TRANSPORTATION_GROUP;
    if (isConsumableProduct(productType)) next.viewStorage = true;
    if (!next.mrpType) next.mrpType = 'PD';
    if (!next.mrpController) next.mrpController = '0001';
    if (!next.lotSizingProcedure) next.lotSizingProcedure = 'EX';
    if (!next.strategyGroup) next.strategyGroup = '10';
    if (!next.weightUom) next.weightUom = WEIGHT_UOM_ISO;
  }
  return next;
}
