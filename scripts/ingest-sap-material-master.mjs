/**
 * Stream-ingest SAP Material Master Excel (~6 lakh plant/SLoc rows)
 * into a compact pattern catalog (wizard defaults) and a unique-product
 * index used by duplicate description matching.
 *
 * Usage: node scripts/ingest-sap-material-master.mjs [xlsxPath] [outJson] [productsJson]
 *
 * Keep normalizeDescription() in sync with apps/api/src/modules/sap-item/description-normalize.ts
 */
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_XLSX = path.join(
  ROOT,
  'assets/templates/SAP Material Master List 07.09.2026.xlsx',
);
const DEFAULT_OUT = path.join(ROOT, 'data/sap-material-master-patterns.json');
const DEFAULT_PRODUCTS = path.join(
  ROOT,
  'data/sap-material-master-products.json',
);

const xlsxPath = process.argv[2] || DEFAULT_XLSX;
const outPath = process.argv[3] || DEFAULT_OUT;
const productsOutPath = process.argv[4] || DEFAULT_PRODUCTS;

const SYNONYM_PHRASES = [
  [/MILD\s+STEEL/g, 'MS'],
  [/M\s*\.\s*S\s*\.?/g, 'MS'],
  [/DIAMETER/g, 'DIA'],
  [/MILLIMET(?:ER|RE)S?/g, 'MM'],
];
const SYNONYM_TOKENS = {
  MILDSTEEL: 'MS',
  DIAMETER: 'DIA',
  Ø: 'DIA',
  PCS: 'EA',
  NOS: 'EA',
  NO: 'EA',
  EACH: 'EA',
  KGS: 'KG',
  KGM: 'KG',
  KILO: 'KG',
  LTR: 'L',
  LIT: 'L',
};

function normalizeDescription(raw) {
  let s = String(raw || '')
    .toUpperCase()
    .replace(/Ø/g, ' DIA ');
  s = s.replace(/(\d)\.(\d)/g, '$1§$2');
  s = s.replace(/(\d)[X×](\d)/g, '$1 $2');
  s = s.replace(/([A-Z])(\d)/g, '$1 $2');
  s = s.replace(/(\d)([A-Z])/g, '$1 $2');
  s = s.replace(/[^A-Z0-9§]+/g, ' ');
  s = s.replace(/(\d)§(\d)/g, '$1.$2');
  s = s.replace(/\bM S\b/g, 'MS');
  for (const [re, repl] of SYNONYM_PHRASES) s = s.replace(re, repl);
  s = s
    .split(/\s+/)
    .map((tok) => SYNONYM_TOKENS[tok] || tok)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text) return String(v.text).trim();
  if (typeof v === 'object' && v.result != null) return String(v.result).trim();
  return String(v).trim();
}

function bump(map, key, n = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + n;
}

function topN(map, n = 12) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function majority(map) {
  const top = topN(map, 1)[0];
  return top ? top.value : null;
}

function ensureType(types, code) {
  if (!types[code]) {
    types[code] = {
      rows: 0,
      products: new Set(),
      uoms: {},
      weightUoms: {},
      mrpTypes: {},
      availChecks: {},
      procurementTypes: {},
      plants: {},
      slocs: {},
      hsn: {},
      groups: {},
      itemCategoryGroups: {},
      mrpControllers: {},
      batchManaged: { yes: 0, no: 0 },
    };
  }
  return types[code];
}

function ensureGroup(groups, code) {
  if (!groups[code]) {
    groups[code] = {
      rows: 0,
      products: new Set(),
      productTypes: {},
      uoms: {},
      hsn: {},
      plants: {},
      slocs: {},
      mrpTypes: {},
      availChecks: {},
      procurementTypes: {},
    };
  }
  return groups[code];
}

const started = Date.now();
console.log('Ingesting', xlsxPath);

const plants = {};
const slocs = {};
const slocsByPlant = {};
const profitCenterByPlant = {};
const profitCenterFormats = {};
const productTypes = {};
const productGroups = {};
const allHsn = {};
const allUom = {};
const uniqueProducts = new Set();
const uniqueOldCodes = new Set();
/** @type {Map<string, { product: string, description: string, productType: string, productGroup: string, uom: string, hsn: string, plants: Set<string> }>} */
const productIndex = new Map();
let rows = 0;
let skipped = 0;
let headers = null;
let col = {};

const wb = new ExcelJS.stream.xlsx.WorkbookReader(xlsxPath, {
  entries: 'emit',
  sharedStrings: 'cache',
  styles: 'ignore',
});

for await (const worksheetReader of wb) {
  for await (const row of worksheetReader) {
    const vals = Array.isArray(row.values) ? row.values : [];
    if (row.number === 1) {
      headers = vals.map((v) => cell(v));
      const idx = (name) => {
        const i = headers.findIndex(
          (h) => String(h || '').toLowerCase() === name.toLowerCase(),
        );
        return i > 0 ? i : -1;
      };
      col = {
        product: idx('Product'),
        plant: idx('Plant'),
        sloc: idx('Storage Location'),
        type: idx('Product Type'),
        itemCat: idx('General item category group'),
        old: idx('Old Product Number'),
        group: idx('Product Group'),
        weightUom: idx('Unit of Weight'),
        avail: idx('Avail. check'),
        prctr: idx('Profit Center'),
        mrp: idx('MRP Type'),
        dispo: idx('MRP Controller'),
        hsn: idx('Control Code'),
        batch: idx('Batch Mgmt Rqt(Plnt)'),
        proc: idx('Procurement Type'),
        uom: idx('Base Unit of Measure'),
        description: idx('PRODUCTDESCRIPTION'),
      };
      console.log('columns', col);
      continue;
    }

    const plant = cell(vals[col.plant]);
    const type = cell(vals[col.type]).toUpperCase();
    const sloc = cell(vals[col.sloc]).toUpperCase();
    if (!plant && !type) {
      skipped += 1;
      continue;
    }
    rows += 1;
    if (rows % 50000 === 0) {
      console.log(`… ${rows.toLocaleString()} rows (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    }

    const product = cell(vals[col.product]);
    const group = cell(vals[col.group]).toUpperCase();
    const uom = cell(vals[col.uom]).toUpperCase();
    const weightUom = cell(vals[col.weightUom]).toUpperCase();
    const hsn = cell(vals[col.hsn]);
    const prctr = cell(vals[col.prctr]);
    const mrp = cell(vals[col.mrp]).toUpperCase();
    const avail = cell(vals[col.avail]).toUpperCase();
    const proc = cell(vals[col.proc]).toUpperCase();
    const dispo = cell(vals[col.dispo]);
    const itemCat = cell(vals[col.itemCat]).toUpperCase();
    const old = cell(vals[col.old]).toUpperCase();
    const batch = cell(vals[col.batch]);
    const description = cell(vals[col.description]);

    if (product) {
      uniqueProducts.add(product);
      let rec = productIndex.get(product);
      if (!rec) {
        rec = {
          product,
          description,
          productType: type,
          productGroup: group,
          uom,
          hsn,
          plants: new Set(),
        };
        productIndex.set(product, rec);
      } else {
        if (!rec.description && description) rec.description = description;
        if (!rec.productType && type) rec.productType = type;
        if (!rec.productGroup && group) rec.productGroup = group;
        if (!rec.uom && uom) rec.uom = uom;
        if (!rec.hsn && hsn) rec.hsn = hsn;
      }
      if (plant) rec.plants.add(plant);
    }
    if (old) uniqueOldCodes.add(old);

    bump(plants, plant);
    bump(slocs, sloc);
    bump(allUom, uom);
    bump(allHsn, hsn);
    if (plant) {
      if (!slocsByPlant[plant]) slocsByPlant[plant] = {};
      bump(slocsByPlant[plant], sloc);
      if (prctr) {
        if (!profitCenterByPlant[plant]) profitCenterByPlant[plant] = {};
        bump(profitCenterByPlant[plant], prctr);
        // format fingerprint
        const expectedUnpadded = `${plant}01`;
        const expectedPadded = `0000${plant}01`;
        const fmt =
          prctr === expectedPadded
            ? '0000{plant}01'
            : prctr === expectedUnpadded
              ? '{plant}01'
              : 'other';
        bump(profitCenterFormats, fmt);
      }
    }

    if (type) {
      const t = ensureType(productTypes, type);
      t.rows += 1;
      if (product) t.products.add(product);
      bump(t.uoms, uom);
      bump(t.weightUoms, weightUom);
      bump(t.mrpTypes, mrp);
      bump(t.availChecks, avail);
      bump(t.procurementTypes, proc);
      bump(t.plants, plant);
      bump(t.slocs, sloc);
      bump(t.hsn, hsn);
      bump(t.groups, group);
      bump(t.itemCategoryGroups, itemCat);
      bump(t.mrpControllers, dispo);
      if (batch === 'X' || batch === '1' || batch.toUpperCase() === 'YES') t.batchManaged.yes += 1;
      else t.batchManaged.no += 1;
    }

    if (group) {
      const g = ensureGroup(productGroups, group);
      g.rows += 1;
      if (product) g.products.add(product);
      bump(g.productTypes, type);
      bump(g.uoms, uom);
      bump(g.hsn, hsn);
      bump(g.plants, plant);
      bump(g.slocs, sloc);
      bump(g.mrpTypes, mrp);
      bump(g.availChecks, avail);
      bump(g.procurementTypes, proc);
    }
  }
  break;
}

function serializeType(t) {
  return {
    rows: t.rows,
    products: t.products.size,
    defaultUom: majority(t.uoms),
    defaultMrpType: majority(t.mrpTypes),
    defaultAvailCheck: majority(t.availChecks),
    defaultProcurementType: majority(t.procurementTypes),
    defaultMrpController: majority(t.mrpControllers),
    defaultItemCategoryGroup: majority(t.itemCategoryGroups),
    batchManaged: t.batchManaged.yes > t.batchManaged.no,
    uoms: topN(t.uoms, 15),
    weightUoms: topN(t.weightUoms, 8),
    mrpTypes: topN(t.mrpTypes, 6),
    availChecks: topN(t.availChecks, 8),
    procurementTypes: topN(t.procurementTypes, 6),
    plants: topN(t.plants, 20),
    slocs: topN(t.slocs, 20),
    hsn: topN(t.hsn, 20),
    groups: topN(t.groups, 25),
    itemCategoryGroups: topN(t.itemCategoryGroups, 6),
    mrpControllers: topN(t.mrpControllers, 8),
  };
}

function serializeGroup(g) {
  return {
    rows: g.rows,
    products: g.products.size,
    productType: majority(g.productTypes),
    defaultUom: majority(g.uoms),
    defaultHsn: majority(g.hsn),
    defaultMrpType: majority(g.mrpTypes),
    defaultAvailCheck: majority(g.availChecks),
    defaultProcurementType: majority(g.procurementTypes),
    typicalPlants: topN(g.plants, 12).map((x) => x.value),
    typicalSlocs: topN(g.slocs, 12).map((x) => x.value),
    uoms: topN(g.uoms, 8),
    hsn: topN(g.hsn, 8),
    plants: topN(g.plants, 12),
  };
}

const slocMatrix = {};
for (const [plant, map] of Object.entries(slocsByPlant)) {
  slocMatrix[plant] = Object.keys(map).sort();
}

const prctrResolved = {};
for (const [plant, map] of Object.entries(profitCenterByPlant)) {
  prctrResolved[plant] = majority(map);
}

const catalog = {
  sourceFile: path.basename(xlsxPath),
  generatedAt: new Date().toISOString(),
  elapsedMs: Date.now() - started,
  rows,
  skipped,
  uniqueProducts: uniqueProducts.size,
  uniqueOldProductNumbers: uniqueOldCodes.size,
  profitCenterFormat: majority(profitCenterFormats) || '{plant}01',
  profitCenterFormats: topN(profitCenterFormats, 5),
  plants: Object.keys(plants).sort(),
  plantCounts: topN(plants, 30),
  storageLocations: Object.keys(slocs).sort(),
  storageLocationsByPlant: slocMatrix,
  profitCenterByPlant: prctrResolved,
  uoms: topN(allUom, 40),
  byProductType: Object.fromEntries(
    Object.entries(productTypes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, serializeType(v)]),
  ),
  byProductGroup: Object.fromEntries(
    Object.entries(productGroups)
      .sort((a, b) => b[1].rows - a[1].rows)
      .map(([k, v]) => [k, serializeGroup(v)]),
  ),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(catalog));
const kb = Math.round(fs.statSync(outPath).size / 1024);
console.log(
  `Done rows=${rows} products=${catalog.uniqueProducts} types=${Object.keys(productTypes).length} groups=${Object.keys(productGroups).length} → ${outPath} (${kb} KB) in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

const products = [...productIndex.values()]
  .sort((a, b) => a.product.localeCompare(b.product))
  .map((p) => ({
    product: p.product,
    description: p.description,
    productType: p.productType || null,
    productGroup: p.productGroup || null,
    uom: p.uom || null,
    hsn: p.hsn || null,
    plants: [...p.plants].sort(),
    normalized: normalizeDescription(p.description),
  }));

const productCatalog = {
  sourceFile: path.basename(xlsxPath),
  generatedAt: new Date().toISOString(),
  rows,
  uniqueProducts: products.length,
  products,
};

fs.mkdirSync(path.dirname(productsOutPath), { recursive: true });
fs.writeFileSync(productsOutPath, JSON.stringify(productCatalog));
const pkb = Math.round(fs.statSync(productsOutPath).size / 1024);
console.log(
  `Products index ${products.length} → ${productsOutPath} (${pkb} KB)`,
);
console.log('profitCenterFormat', catalog.profitCenterFormat, catalog.profitCenterFormats);
console.log('plants', catalog.plants);
console.log('types', Object.keys(catalog.byProductType));
