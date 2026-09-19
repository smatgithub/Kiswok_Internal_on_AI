/**
 * Commit pending pipeline JSON to Ready for template without the HTTP API.
 * Writes apps/api/data/pipeline (Nest cwd) so the UI picks it up.
 *
 * Policy:
 *   Service (ZSRV / SER*) → plants 1001, 2001–2006, no storage
 *   Other items           → plants 2001–2006, at least MXST
 *
 * Usage: node scripts/commit-pending-local.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/api/package.json'),
);
const shared = require('@kiswok/shared');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pipelineDir = path.join(root, 'apps/api/data/pipeline');
const batchDir = path.join(root, 'apps/api/data/batches');

const VALUATION_CLASS = {
  ZFGM: '7920',
  ZSFG: '7900',
  ZRAW: '3000',
  ZROM: '3000',
  ZPKG: '3050',
  ZSPT: '3040',
  ZCON: '3060',
};

function withMxst(slocs) {
  const list = (slocs || [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean);
  if (!list.includes('MXST')) list.unshift('MXST');
  return [...new Set(list)];
}

function valuationClassForProductType(productType) {
  const code = String(productType || 'ZRAW').trim().toUpperCase();
  if (shared.isServiceProduct(code)) return '';
  return VALUATION_CLASS[code] || '3000';
}

function buildAnswers(source) {
  const plants = shared.plantsForProductType(source.productType, source.IcsoftCode);
  const productType =
    String(source.productType || 'ZRAW').trim().toUpperCase() || 'ZRAW';
  const service = shared.isServiceProduct(productType);
  const weight =
    source.weight != null && Number(source.weight) > 0
      ? String(source.weight)
      : '';
  const slocs = service
    ? []
    : withMxst(source.storage_location ? [source.storage_location] : ['MXST']);
  const productNumber =
    source.sap_item_code || source.IcsoftCode || `TEMP${source.RawMatID}`;
  const productGroup = String(source.ProductGroup || '')
    .trim()
    .slice(0, 9);
  const description = String(source.Rawmatname || '')
    .trim()
    .slice(0, 40);
  const baseUom =
    shared.toIsoUom(source.baseuom) || source.baseuom || 'EA';

  return shared.applyProductTypeStandards({
    productNumber,
    productType,
    productGroup,
    description,
    languageKey: source.lang || 'EN',
    baseUom,
    oldProductNumber: source.IcsoftCode || '',
    batchManaged: false,
    grossWeight: weight,
    netWeight: weight,
    weightUom: shared.WEIGHT_UOM_ISO,
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
    plant: plants[0],
    mrpType: service ? '' : 'PD',
    mrpController: service ? '' : '0001',
    availabilityCheck: 'NC',
    profitCenter: `${plants[0]}01`,
    loadingGroup: service ? '' : '0001',
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

function missingFields(answers) {
  const service = shared.isServiceProduct(answers.productType);
  const required = [
    ['productNumber', 'Product Number'],
    ['productType', 'Product Type'],
    ['productGroup', 'Product Group'],
    ['description', 'Description'],
    ['baseUom', 'Base UoM'],
  ];
  const errors = [];
  for (const [key, label] of required) {
    if (!String(answers[key] || '').trim()) errors.push(`${label} is required`);
  }
  if (!service && !(answers.storageLocations || []).length) {
    errors.push('Storage Location is required');
  }
  return errors;
}

if (!fs.existsSync(pipelineDir)) {
  console.error(`Pipeline folder not found: ${pipelineDir}`);
  process.exit(1);
}

fs.mkdirSync(batchDir, { recursive: true });

const names = fs
  .readdirSync(pipelineDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('._') && !f.includes('.bad'));

const batchId = randomUUID();
const now = new Date().toISOString();
const batchItems = [];
const committed = [];
const failed = [];
const skipped = [];
let pendingSeen = 0;
const stageCounts = { pending: 0, committed: 0, exported: 0, other: 0 };

for (const name of names) {
  const full = path.join(pipelineDir, name);
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    failed.push({ file: name, icsoftCode: '', error: 'corrupt JSON' });
    continue;
  }
  const stage = entry.stage || 'other';
  if (stageCounts[stage] != null) stageCounts[stage] += 1;
  else stageCounts.other += 1;
  if (entry.stage !== 'pending') continue;
  pendingSeen += 1;

  const source = entry.source;
  if (!source) {
    failed.push({
      id: entry.id,
      icsoftCode: entry.icsoftCode,
      error: 'No source snapshot on pipeline entry',
    });
    continue;
  }

  const answers = buildAnswers(source);
  const errors = missingFields(answers);
  if (errors.length) {
    failed.push({
      id: entry.id,
      icsoftCode: entry.icsoftCode,
      error: errors.join('; '),
    });
    continue;
  }

  const itemId = randomUUID();
  entry.stage = 'committed';
  entry.batchId = batchId;
  entry.batchItemId = itemId;
  entry.answers = answers;
  entry.sheetRows = {};
  entry.processedAt = now;
  entry.updatedAt = now;
  entry.plant = answers.plant;
  entry.storageLocation = (answers.storageLocations || [])[0] || null;

  fs.writeFileSync(full, JSON.stringify(entry, null, 2));
  batchItems.push({
    id: itemId,
    status: 'committed',
    source,
    answers,
    sheetRows: {},
    pipelineEntryId: entry.id,
    createdAt: now,
    updatedAt: now,
  });
  committed.push({
    id: entry.id,
    icsoftCode: entry.icsoftCode,
    productType: answers.productType,
    plants: answers.valuationAreas,
    storageLocations: answers.storageLocations,
  });
  if (committed.length % 50 === 0) {
    console.log(`committed ${committed.length} / ${pendingSeen} pending scanned`);
  }
}

const batch = {
  id: batchId,
  name: `Ready for template ${now.slice(0, 16)}`,
  items: batchItems,
  createdAt: now,
  updatedAt: now,
};
fs.writeFileSync(
  path.join(batchDir, `${batchId}.json`),
  JSON.stringify(batch, null, 2),
);

const report = {
  batchId,
  pendingSeen,
  committed: committed.length,
  failed,
  skipped,
  sample: committed.slice(0, 10),
  serviceSample: committed.filter((c) => c.productType === 'ZSRV').slice(0, 5),
  stockSample: committed.filter((c) => c.productType !== 'ZSRV').slice(0, 5),
  stageCountsBefore: stageCounts,
  countsAfter: {
    pending: pendingSeen - committed.length,
    committed: stageCounts.committed + committed.length,
    exported: stageCounts.exported,
  },
};

const reportPath = path.join(root, 'data/commit-pending-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  batchId,
  pendingSeen,
  committed: committed.length,
  failed: failed.length,
  failedPreview: failed.slice(0, 15),
  sample: report.sample,
  serviceSample: report.serviceSample,
  stockSample: report.stockSample,
  reportPath,
}, null, 2));
