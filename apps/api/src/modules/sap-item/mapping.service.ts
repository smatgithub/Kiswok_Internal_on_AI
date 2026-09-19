import {
  SapSourceItem,
  WizardAnswers,
  WEIGHT_UOM_ISO,
  toIsoUom,
  applyProductTypeStandards,
  isServiceProduct,
  isFinishedProduct,
  isSpareProduct,
  isConsumableProduct,
  DEFAULT_KISWOK_PLANTS,
  plantsForProductType,
  TRANSPORTATION_GROUP,
  accountAssignmentForProductType,
} from '@kiswok/shared';

export {
  WEIGHT_UOM_ISO,
  toIsoUom,
  applyProductTypeStandards,
  isServiceProduct,
};

/** Default BKLAS on Valuation Data by material type. */
const VALUATION_CLASS_BY_PRODUCT_TYPE: Record<string, string> = {
  ZFGM: '7920',
  ZSFG: '7900',
  ZRAW: '3000',
  ZROM: '3000',
  ZPKG: '3050',
  ZSPT: '3040',
  ZCON: '3060',
};

export function valuationClassForProductType(productType: string): string {
  const code = (productType || 'ZRAW').trim().toUpperCase();
  if (isServiceProduct(code)) return '';
  return VALUATION_CLASS_BY_PRODUCT_TYPE[code] || '3000';
}

export function buildDefaultAnswers(source: SapSourceItem): WizardAnswers {
  const plants = plantsForProductType(source.productType, source.IcsoftCode);
  const sourcePlant = String(source.sap_plantcode || '').trim();
  const plant = plants.includes(sourcePlant) ? sourcePlant : plants[0];
  const productNumber =
    source.IcsoftCode ||
    `TEMP${source.RawMatID}`;
  const productType = (source.productType || 'ZRAW').trim().toUpperCase() || 'ZRAW';
  const service = isServiceProduct(productType);

  const weight =
    source.weight != null && Number(source.weight) > 0
      ? String(source.weight)
      : '';

  const slocs = service
    ? []
    : withMxst(
        source.storage_location ? [source.storage_location] : ['MXST'],
      );

  return applyProductTypeStandards({
    productNumber,
    productType,
    productGroup: source.ProductGroup || '',
    description: (source.Rawmatname || '').slice(0, 40),
    languageKey: source.lang || 'EN',
    baseUom: toIsoUom(source.baseuom) || '',
    oldProductNumber: source.IcsoftCode || '',
    batchManaged: false,
    grossWeight: weight,
    netWeight: weight,
    weightUom: WEIGHT_UOM_ISO,
    viewQuality: !service,
    viewSales: true,
    viewStorage: !service,
    viewPurchasing: true,
    salesOrganization: 'KIPL',
    distributionChannels: service ? ['SS'] : ['ST', 'DS'],
    distributionChannel: service ? 'SS' : 'ST',
    itemCategoryGroup: service ? 'SERV' : 'NORM',
    accountAssignmentGroup: '01',
    country: 'IN',
    plant,
    mrpType: service ? '' : 'PD',
    mrpController: service ? '' : '0001',
    availabilityCheck: 'NC',
    profitCenter: profitCenterForPlant(plant),
    loadingGroup: TRANSPORTATION_GROUP,
    coProduct: false,
    hsnCode: source.hsncode || '',
    taxIndicator: '0',
    strategyGroup: service ? '' : '10',
    lotSizingProcedure: service ? '' : 'EX',
    procurementType: 'F',
    storageLocations: slocs,
    valuationAreas: plants,
    priceControlDetermination: service ? '' : '2',
    valuationClass: service ? '' : valuationClassForProductType(productType),
    priceControl: service ? '' : 'V',
    currency: 'INR',
  });
}

export function flag(v: boolean): string {
  return v ? 'X' : '';
}

export function withMxst(slocs: string[] | null | undefined): string[] {
  const list = (slocs || [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean);
  if (!list.includes('MXST')) list.unshift('MXST');
  return [...new Set(list)];
}

/**
 * Force Kiswok plant extension + MXST for stock items.
 * Service → 1001 + 2001–2006, no storage.
 * Other → 2001–2006, at least MXST.
 */
export function applyKiswokExtensionPolicy(
  answers: WizardAnswers,
  icsoftCode?: string | null,
): WizardAnswers {
  const plants = plantsForProductType(answers.productType, icsoftCode);
  const service = isServiceProduct(answers.productType);
  return applyProductTypeStandards({
    ...answers,
    plant: plants[0],
    valuationAreas: [...plants],
    profitCenter: profitCenterForPlant(plants[0]),
    storageLocations: service ? [] : withMxst(answers.storageLocations),
  });
}
export function profitCenterForPlant(plant: string): string {
  const code = String(plant || '2001')
    .split(/[,;]/)[0]
    ?.trim() || '2001';
  return `${code}01`;
}

/**
 * Resolve selected plants for export.
 * Supports valuationAreas multi-select and legacy comma-separated `plant`.
 */
export function plantsOf(answers: WizardAnswers): string[] {
  const split = (v: unknown): string[] =>
    String(v ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const fromAreas = (answers.valuationAreas || []).flatMap(split);
  const fromPlant = split(answers.plant);
  const list = fromAreas.length ? fromAreas : fromPlant;
  return Array.from(new Set(list.length ? list : [...DEFAULT_KISWOK_PLANTS]));
}

export function withSyncedProfitCenter(answers: WizardAnswers): WizardAnswers {
  const plants = plantsOf(answers);
  const primary = plants[0] || '2001';
  const service = isServiceProduct(answers.productType);
  return applyProductTypeStandards({
    ...answers,
    plant: primary,
    profitCenter: profitCenterForPlant(primary),
    valuationAreas: plants,
    baseUom: toIsoUom(answers.baseUom) || answers.baseUom,
    weightUom: service ? '' : WEIGHT_UOM_ISO,
    storageLocations: service ? [] : withMxst(answers.storageLocations),
    valuationClass: service
      ? ''
      : valuationClassForProductType(answers.productType) || answers.valuationClass,
  });
}

function channelsOf(answers: WizardAnswers): string[] {
  if (isServiceProduct(answers.productType)) return ['SS'];
  if (answers.distributionChannels?.length) return answers.distributionChannels;
  if (answers.distributionChannel) return [answers.distributionChannel];
  return ['ST', 'DS'];
}

/** Build SAP technical-field maps per sheet for gold-template export */
export function buildSheetRows(answers: WizardAnswers): Record<string, Record<string, string>[]> {
  const product = answers.productNumber;
  const plants = plantsOf(answers);
  const service = isServiceProduct(answers.productType);
  const spare = isSpareProduct(answers.productType);
  const consumable = isConsumableProduct(answers.productType);
  const finished = isFinishedProduct(answers.productType);
  const valuated = !service;
  const storageLocs = service
    ? []
    : answers.storageLocations?.length
      ? answers.storageLocations
      : [''];
  const itemCat =
    answers.itemCategoryGroup || (service ? 'SERV' : 'NORM');
  const acctAssign = spare
    ? ''
    : answers.accountAssignmentGroup || accountAssignmentForProductType(answers.productType);
  const bklas = valuated
    ? valuationClassForProductType(answers.productType) || answers.valuationClass
    : '';

  const basic: Record<string, string> = {
    PRODUCT: product,
    MTART: answers.productType,
    MATKL: answers.productGroup,
    MAKTX: answers.description.slice(0, 40),
    SPRAS: answers.languageKey,
    MEINS: toIsoUom(answers.baseUom) || answers.baseUom,
    BISMT: answers.oldProductNumber,
    XCHPF: flag(answers.batchManaged),
    BRGEW: service ? '' : answers.grossWeight,
    NTGEW: service ? '' : answers.netWeight,
    GEWEI: service ? '' : WEIGHT_UOM_ISO,
    MTPOS_MARA: itemCat,
    TRAGR: TRANSPORTATION_GROUP,
    PSTATQ: flag(!service && answers.viewQuality),
    PSTATV: flag(answers.viewSales),
    PSTATL: flag(!service && (answers.viewStorage || consumable)),
    PSTATE: flag(answers.viewPurchasing),
  };

  const distribution = channelsOf(answers).map((vtweg) => ({
    PRODUCT: product,
    VKORG: answers.salesOrganization,
    VTWEG: vtweg,
    MTPOS: itemCat,
    KTGRM: acctAssign,
    KONDM: '',
  }));

  const tax: Record<string, string> = {
    PRODUCT: product,
    ALAND: answers.country,
    TATYP1: 'JOIG',
    TAXM1: '0',
    TATYP2: 'JOSG',
    TAXM2: '0',
    TATYP3: 'JOCG',
    TAXM3: '0',
    TATYP4: 'JOUG',
    TAXM4: '0',
    TATYP5: 'JCOS',
    TAXM5: '1',
    TATYP6: 'JTC1',
    TAXM6: '1',
  };

  // One Plant Data row per selected plant — PRCTR = {plant}01
  // Service: MRP Type, MRP Group, Lot Size blank; Storage indicator blank.
  const plantRows = plants.map((werks) => ({
    PRODUCT: product,
    WERKS: werks,
    DISMM: service ? '' : answers.mrpType,
    DISPO: service ? '' : answers.mrpController || '0001',
    MTVFP: answers.availabilityCheck,
    PRCTR: profitCenterForPlant(werks),
    XCHPF: flag(answers.batchManaged),
    LADGR: TRANSPORTATION_GROUP,
    KZKUP: flag(answers.coProduct),
    STEUC: answers.hsnCode,
    TAXIM: answers.taxIndicator || '0',
    STRGR: service ? '' : answers.strategyGroup || '10',
    DISGR: service || answers.mrpType === 'ND' ? '' : '0001',
    DISLS: service ? '' : answers.lotSizingProcedure,
    BESKZ: answers.procurementType,
    AWSLS: valuated ? '000001' : '',
    LOSGR: valuated ? '1' : '',
    PSTATL: flag(!service && (answers.viewStorage || consumable)),
    PSTATA: flag(finished),
    PSTATE: flag(answers.viewPurchasing),
    PSTATQ: flag(!service && answers.viewQuality),
    PSTATV: flag(answers.viewSales),
  }));

  // Storage Locations: blank for Service (no inventory).
  const storage = service
    ? []
    : plants.flatMap((werks) =>
        storageLocs
          .filter((lgort) => String(lgort || '').trim())
          .map((lgort) => ({
            PRODUCT: product,
            WERKS: werks,
            LGORT: lgort,
          })),
      );

  // Valuation Data: blank for Service (no stock valuation).
  const valuation = service
    ? []
    : plants.map((werks) => ({
        PRODUCT: product,
        BWKEY: werks,
        MLAST: answers.priceControlDetermination,
        BKLAS: bklas,
        VPRSV: answers.priceControl,
        WAERS: answers.currency,
        PEINH: '1',
        PSTATB: 'X',
        PSTATG: 'X',
      }));

  return {
    'Basic Data': [basic],
    'Distribution Chains': distribution,
    'Tax Classification': [tax],
    'Plant Data': plantRows,
    'Storage Locations': storage,
    'Valuation Data': valuation,
  };
}

export function validateAnswers(answers: WizardAnswers): string[] {
  const errors: string[] = [];
  const service = isServiceProduct(answers.productType);
  const required: Array<[keyof WizardAnswers, string]> = [
    ['productNumber', 'Product Number'],
    ['productType', 'Product Type'],
    ['productGroup', 'Product Group'],
    ['description', 'Description'],
    ['languageKey', 'Language Key'],
    ['baseUom', 'Base UoM (ISO)'],
    ['salesOrganization', 'Sales Organization'],
    ['itemCategoryGroup', 'Item Category Group'],
    ['country', 'Country'],
    ['plant', 'Plant'],
    ['availabilityCheck', 'Availability Check'],
    ['profitCenter', 'Profit Center'],
    ['procurementType', 'Procurement Type'],
  ];
  if (!service) {
    required.push(
      ['mrpType', 'MRP Type'],
      ['lotSizingProcedure', 'Lot Sizing Procedure'],
      ['valuationClass', 'Valuation Class'],
      ['priceControl', 'Price Control'],
      ['currency', 'Currency'],
    );
  } else {
    required.push(['accountAssignmentGroup', 'Account Assignment Group']);
  }

  for (const [key, label] of required) {
    const value = answers[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      errors.push(`${label} is required`);
    }
  }

  if (!channelsOf(answers).length) {
    errors.push('At least one Distribution Channel is required');
  }
  if (!plantsOf(answers).length) {
    errors.push('At least one Plant is required');
  }
  if (!service && !answers.storageLocations?.length) {
    errors.push('At least one Storage Location is required');
  }
  if (answers.description && answers.description.length > 40) {
    errors.push('Description must be max 40 characters');
  }

  return errors;
}
