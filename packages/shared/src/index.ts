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

export interface SapPipelineEntry {
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
}

export interface SapSourceItem {
  IcsoftCode: string;
  sap_item_code: string | null;
  sap_mat_grp_text: string | null;
  grntype: string | null;
  ProductGroup: string | null;
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
  mrpType: 'PD' | 'ND';
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
