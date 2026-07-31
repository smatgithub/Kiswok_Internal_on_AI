import { SapSourceItem, WizardAnswers } from '@kiswok/shared';

export function buildDefaultAnswers(source: SapSourceItem): WizardAnswers {
  const plant = source.sap_plantcode || '2001';
  const productNumber =
    source.sap_item_code ||
    source.IcsoftCode ||
    `TEMP${source.RawMatID}`;

  const weight =
    source.weight != null && Number(source.weight) > 0
      ? String(source.weight)
      : '';

  return {
    productNumber,
    productType: 'ZRAW',
    productGroup: source.ProductGroup || '',
    description: (source.Rawmatname || '').slice(0, 40),
    languageKey: source.lang || 'EN',
    baseUom: source.baseuom || '',
    oldProductNumber: source.IcsoftCode || '',
    batchManaged: false,
    grossWeight: weight,
    netWeight: weight,
    weightUom: source.WeightUom || source.baseuom || '',
    viewQuality: true,
    viewSales: true,
    viewStorage: true,
    viewPurchasing: true,
    salesOrganization: 'KIPL',
    distributionChannels: ['ST', 'DS'],
    distributionChannel: 'ST',
    itemCategoryGroup: 'NORM',
    accountAssignmentGroup: '01',
    country: 'IN',
    plant,
    mrpType: 'PD',
    mrpController: '0001',
    availabilityCheck: 'NC',
    profitCenter: source.profitcentercode || `${plant}01`,
    loadingGroup: '0001',
    coProduct: false,
    hsnCode: source.hsncode || '',
    taxIndicator: '0',
    strategyGroup: '10',
    lotSizingProcedure: 'EX',
    procurementType: 'F',
    storageLocations: source.storage_location ? [source.storage_location] : [],
    valuationAreas: [plant],
    priceControlDetermination: '2',
    valuationClass: '3000',
    priceControl: 'V',
    currency: 'INR',
  };
}

export function flag(v: boolean): string {
  return v ? 'X' : '';
}

function channelsOf(answers: WizardAnswers): string[] {
  if (answers.distributionChannels?.length) return answers.distributionChannels;
  if (answers.distributionChannel) return [answers.distributionChannel];
  return ['ST'];
}

/** Build SAP technical-field maps per sheet for gold-template export */
export function buildSheetRows(answers: WizardAnswers): Record<string, Record<string, string>[]> {
  const product = answers.productNumber;
  const basic: Record<string, string> = {
    PRODUCT: product,
    MTART: answers.productType,
    MATKL: answers.productGroup,
    MAKTX: answers.description.slice(0, 40),
    SPRAS: answers.languageKey,
    MEINS: answers.baseUom,
    BISMT: answers.oldProductNumber,
    XCHPF: flag(answers.batchManaged),
    BRGEW: answers.grossWeight,
    NTGEW: answers.netWeight,
    GEWEI: answers.weightUom,
    MTPOS_MARA: answers.itemCategoryGroup,
    TRAGR: answers.loadingGroup,
    PSTATQ: flag(answers.viewQuality),
    PSTATV: flag(answers.viewSales),
    PSTATL: flag(answers.viewStorage),
    PSTATE: flag(answers.viewPurchasing),
  };

  const distribution = channelsOf(answers).map((vtweg) => ({
    PRODUCT: product,
    VKORG: answers.salesOrganization,
    VTWEG: vtweg,
    MTPOS: answers.itemCategoryGroup,
    KTGRM: answers.accountAssignmentGroup || '01',
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

  const plant: Record<string, string> = {
    PRODUCT: product,
    WERKS: answers.plant,
    DISMM: answers.mrpType,
    DISPO: answers.mrpController || '0001',
    MTVFP: answers.availabilityCheck,
    PRCTR: answers.profitCenter,
    XCHPF: flag(answers.batchManaged),
    LADGR: answers.loadingGroup,
    KZKUP: flag(answers.coProduct),
    STEUC: answers.hsnCode,
    TAXIM: answers.taxIndicator || '0',
    STRGR: answers.strategyGroup || '10',
    DISLS: answers.lotSizingProcedure,
    BESKZ: answers.procurementType,
    PSTATL: flag(answers.viewStorage),
    PSTATA: flag(answers.viewPurchasing),
    PSTATE: flag(answers.viewSales),
    PSTATQ: flag(answers.viewQuality),
    PSTATV: flag(answers.viewSales),
  };

  const storage = (answers.storageLocations.length
    ? answers.storageLocations
    : ['']
  ).map((lgort) => ({
    PRODUCT: product,
    WERKS: answers.plant,
    LGORT: lgort,
  }));

  const valuation = (answers.valuationAreas.length
    ? answers.valuationAreas
    : [answers.plant]
  ).map((bwkey) => ({
    PRODUCT: product,
    BWKEY: bwkey,
    MLAST: answers.priceControlDetermination,
    BKLAS: answers.valuationClass,
    VPRSV: answers.priceControl,
    WAERS: answers.currency,
    PSTATB: 'X',
    PSTATG: 'X',
  }));

  return {
    'Basic Data': [basic],
    'Distribution Chains': distribution,
    'Tax Classification': [tax],
    'Plant Data': [plant],
    'Storage Locations': storage,
    'Valuation Data': valuation,
  };
}

export function validateAnswers(answers: WizardAnswers): string[] {
  const errors: string[] = [];
  const required: Array<[keyof WizardAnswers, string]> = [
    ['productNumber', 'Product Number'],
    ['productType', 'Product Type'],
    ['productGroup', 'Product Group'],
    ['description', 'Description'],
    ['languageKey', 'Language Key'],
    ['baseUom', 'Base UoM'],
    ['salesOrganization', 'Sales Organization'],
    ['itemCategoryGroup', 'Item Category Group'],
    ['country', 'Country'],
    ['plant', 'Plant'],
    ['mrpType', 'MRP Type'],
    ['availabilityCheck', 'Availability Check'],
    ['profitCenter', 'Profit Center'],
    ['lotSizingProcedure', 'Lot Sizing Procedure'],
    ['procurementType', 'Procurement Type'],
    ['valuationClass', 'Valuation Class'],
    ['priceControl', 'Price Control'],
    ['currency', 'Currency'],
  ];

  for (const [key, label] of required) {
    const value = answers[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      errors.push(`${label} is required`);
    }
  }

  if (!channelsOf(answers).length) {
    errors.push('At least one Distribution Channel is required');
  }
  if (!answers.storageLocations?.length) {
    errors.push('At least one Storage Location is required');
  }
  if (!answers.valuationAreas?.length) {
    errors.push('At least one Valuation Area is required');
  }
  if (answers.description && answers.description.length > 40) {
    errors.push('Description must be max 40 characters');
  }

  return errors;
}
