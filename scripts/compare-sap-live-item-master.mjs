/**
 * Compare SAP Material Master Excel vs icsoft.dbo.sap_live_item_master
 * and emit INSERT / UPDATE SQL.
 *
 * Usage (from repo root, with apps/api/.env loaded by the runner):
 *   node scripts/compare-sap-live-item-master.mjs
 */
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import sql from 'mssql';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(ROOT, 'apps/api/.env') });
dotenv.config({ path: path.join(ROOT, '.env') });

const XLSX = path.join(ROOT, 'assets/templates/SAP Material Master List 07.09.2026.xlsx');
const OUT_DIR = path.join(ROOT, 'data');
const OUT_INSERT = path.join(OUT_DIR, 'sap_live_item_master_insert.sql');
const OUT_UPDATE = path.join(OUT_DIR, 'sap_live_item_master_update.sql');
const OUT_UPDATE_RAWMAT = path.join(OUT_DIR, 'sap_live_item_master_update_rawmat.sql');
const OUT_REPORT = path.join(OUT_DIR, 'sap_live_item_master_gap_report.json');
const OUT_MISSING_CSV = path.join(OUT_DIR, 'sap_live_item_master_missing.csv');
const OUT_SKIPPED_CSV = path.join(OUT_DIR, 'sap_live_item_master_skipped_no_icsoft.csv');
const OUT_UPDATES_CSV = path.join(OUT_DIR, 'sap_live_item_master_updates.csv');

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text) return String(v.text).trim();
  if (typeof v === 'object' && v.result != null) return String(v.result).trim();
  return String(v).trim();
}

function isNumericCode(s) {
  return /^\d+$/.test(s);
}

/** Match key: strip leading zeros from numeric MATNR; keep alpha as-is. */
function normKey(code) {
  const s = String(code || '').trim().toUpperCase();
  if (!s) return '';
  if (isNumericCode(s)) return s.replace(/^0+/, '') || '0';
  return s;
}

/** Storage form used in sap_live_item_master for numeric codes. */
function toLiveSapcode(code) {
  const s = String(code || '').trim();
  if (!s) return '';
  if (isNumericCode(s)) return s.replace(/^0+/, '').padStart(18, '0') || '000000000000000000';
  return s;
}

function clip(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, n);
}

function cleanDesc(s) {
  let t = String(s || '').trim();
  if (t.startsWith('"') && (t.match(/"/g) || []).length === 1) t = t.slice(1).trim();
  if (t.startsWith("'") && (t.match(/'/g) || []).length === 1) t = t.slice(1).trim();
  return clip(t, 64);
}

/** Drop Excel parse junk; keep real SAP description refreshes (inch marks, etc.). */
function isSafeDescriptionUpdate(dbDesc, excelDesc) {
  const db = String(dbDesc || '').trim();
  const ex = String(excelDesc || '').trim();
  if (!ex) return false;
  if (ex.length < 8 && db.length > ex.length + 4) return false;
  if (ex.length <= 3) return false;
  return true;
}

function sqlStr(s) {
  if (s == null || s === '') return 'NULL';
  return `'${String(s).replace(/'/g, "''")}'`;
}

function sqlInt(v) {
  if (v == null || v === '') return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : 'NULL';
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function majority(map) {
  let best = '';
  let n = -1;
  for (const [k, c] of Object.entries(map)) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function idxOf(headers, name) {
  return headers.findIndex((h) => String(h || '').toLowerCase() === name.toLowerCase());
}

async function loadExcel() {
  console.log('Streaming Excel', XLSX);
  const started = Date.now();
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(XLSX, {
    entries: 'emit',
    sharedStrings: 'cache',
    styles: 'ignore',
  });
  let headers = null;
  let col = {};
  const byKey = new Map();
  let rows = 0;
  let skipped = 0;

  for await (const worksheetReader of wb) {
    for await (const row of worksheetReader) {
      const vals = Array.isArray(row.values) ? row.values : [];
      if (row.number === 1) {
        headers = vals.map((v) => cell(v));
        col = {
          product: idxOf(headers, 'Product'),
          type: idxOf(headers, 'Product Type'),
          old: idxOf(headers, 'Old Product Number'),
          group: idxOf(headers, 'Product Group'),
          desc: idxOf(headers, 'PRODUCTDESCRIPTION'),
          uom: idxOf(headers, 'Base Unit of Measure'),
        };
        console.log('columns', col);
        continue;
      }
      const product = cell(vals[col.product]);
      if (!product) {
        skipped += 1;
        continue;
      }
      rows += 1;
      if (rows % 100000 === 0) {
        console.log(`… excel ${rows.toLocaleString()} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      }
      const key = normKey(product);
      const type = cell(vals[col.type]).toUpperCase();
      const group = cell(vals[col.group]).toUpperCase();
      const desc = cell(vals[col.desc]);
      const uom = cell(vals[col.uom]).toUpperCase();
      const old = cell(vals[col.old]).toUpperCase();
      let rec = byKey.get(key);
      if (!rec) {
        rec = {
          excelProduct: product,
          sapcode: toLiveSapcode(product),
          types: {},
          groups: {},
          descs: {},
          uoms: {},
          olds: {},
          plants: 0,
        };
        byKey.set(key, rec);
      }
      rec.plants += 1;
      bump(rec.types, type);
      bump(rec.groups, group);
      bump(rec.descs, desc);
      bump(rec.uoms, uom);
      bump(rec.olds, old);
    }
    break;
  }

  const materials = [];
  for (const [key, rec] of byKey) {
    materials.push({
      key,
      excelProduct: rec.excelProduct,
      sapcode: rec.sapcode,
      mat_type: clip(majority(rec.types), 8),
      mat_group: clip(majority(rec.groups), 16),
      sapdescription: cleanDesc(majority(rec.descs)),
      uom: clip(majority(rec.uoms), 8),
      oldProductNumber: majority(rec.olds),
      plantRows: rec.plants,
    });
  }
  console.log(
    `Excel unique products=${materials.length} rows=${rows} skipped=${skipped} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return { materials, rows, skipped };
}

async function loadDb() {
  const cfg = {
    server: process.env.DB_SERVER || process.env.INDBIP,
    user: process.env.DB_USER || process.env.DBUSER,
    password: process.env.DB_PASS || process.env.DBPASS,
    database: process.env.DB_NAME || process.env.ICSOFTDB || 'icsoft',
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 20000,
    requestTimeout: 180000,
  };
  console.log('Connecting', cfg.server, cfg.database);
  const pool = await sql.connect(cfg);
  const live = (
    await pool.request().query(`
      SELECT id, rawmatid, rawmatcode, sapcode, sapdescription, mat_type, mat_group, uom
      FROM sap_live_item_master
    `)
  ).recordset;
  const snim = (
    await pool.request().query(`
      SELECT rawmatid, rawmatcode, sap_item_code, sap_item_name, uom, matgroup, mattype
      FROM sap_new_item_master
      WHERE NULLIF(LTRIM(RTRIM(sap_item_code)), '') IS NOT NULL
    `)
  ).recordset;
  const rm = (
    await pool.request().query(`
      SELECT RawMatID, RawMatCode, RawMatName
      FROM RAWMATERIAL
      WHERE NULLIF(LTRIM(RTRIM(RawMatCode)), '') IS NOT NULL
    `)
  ).recordset;
  await pool.close();
  console.log(`DB live=${live.length} sap_new_item_master=${snim.length} rawmaterial=${rm.length}`);
  return { live, snim, rm };
}

function eq(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

function normName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INVALID_OLD_CODES = new Set(['', '0', 'CRPM0020']);

function buildRawmaterialIndexes(rmRows) {
  const byCode = new Map();
  const byNormName = new Map();
  const list = [];
  for (const row of rmRows) {
    const rec = {
      RawMatID: row.RawMatID,
      RawMatCode: String(row.RawMatCode || '').trim(),
      RawMatName: String(row.RawMatName || '').trim(),
      norm: normName(row.RawMatName),
    };
    if (!rec.RawMatCode) continue;
    list.push(rec);
    const codeKey = rec.RawMatCode.toUpperCase();
    if (!byCode.has(codeKey)) byCode.set(codeKey, rec);
    if (rec.norm) {
      if (!byNormName.has(rec.norm)) byNormName.set(rec.norm, []);
      byNormName.get(rec.norm).push(rec);
    }
  }
  return { byCode, byNormName, list };
}

/**
 * Resolve IcSoft item for a SAP material.
 * 1) Excel Old Product Number = RAWMATERIAL.RawMatCode (ignored when dump artifact CRPM0020)
 * 2) Unique RawMatName equal to SAP description
 * 3) Unique RawMatName that starts with the (often 40-char truncated) SAP description
 */
function resolveRawmaterial(material, indexes, liveByRawmatid) {
  const old = String(material.oldProductNumber || '').trim().toUpperCase();
  if (old && !INVALID_OLD_CODES.has(old)) {
    const hit = indexes.byCode.get(old);
    if (hit && !liveByRawmatid.has(hit.RawMatID)) {
      return { hit, how: 'Old Product Number = RawMatCode' };
    }
    if (hit && liveByRawmatid.has(hit.RawMatID)) {
      return {
        hit: null,
        how: null,
        reason: `Old Product Number ${old} already mapped to ${liveByRawmatid.get(hit.RawMatID).sapcode}`,
      };
    }
    return { hit: null, how: null, reason: `Old Product Number ${old} not in RAWMATERIAL` };
  }

  const desc = normName(material.sapdescription);
  if (desc.length < 8) {
    return {
      hit: null,
      how: null,
      reason: 'Old Product Number is CRPM0020 dump artifact; SAP description too short to match',
    };
  }

  const exact = indexes.byNormName.get(desc) || [];
  const exactUnused = exact.filter((r) => !liveByRawmatid.has(r.RawMatID));
  if (exactUnused.length === 1) {
    return { hit: exactUnused[0], how: 'unique RawMatName = SAP description' };
  }
  if (exact.length > 1 || exactUnused.length > 1) {
    return { hit: null, how: null, reason: `ambiguous RawMatName (${exact.length} rows)` };
  }

  if (desc.length < 20) {
    return {
      hit: null,
      how: null,
      reason: 'Old Product Number is CRPM0020 dump artifact; no unique RawMatName match',
    };
  }

  const prefix = [];
  for (const r of indexes.list) {
    if (!r.norm) continue;
    if (r.norm.startsWith(desc) || (r.norm.length >= 20 && desc.startsWith(r.norm))) {
      prefix.push(r);
    }
  }
  const prefixUnused = prefix.filter((r) => !liveByRawmatid.has(r.RawMatID));
  if (prefixUnused.length === 1) {
    return { hit: prefixUnused[0], how: 'unique RawMatName prefix (SAP 40-char description)' };
  }
  if (prefix.length > 1) {
    return { hit: null, how: null, reason: `ambiguous RawMatName prefix (${prefix.length} rows)` };
  }
  return {
    hit: null,
    how: null,
    reason: 'Old Product Number is CRPM0020 dump artifact; no RAWMATERIAL name match',
  };
}

function emitInsertBatches(rows, batchSize = 200) {
  const mapped = rows.filter((r) => r.rawmatid && r.rawmatcode);
  if (!mapped.length) return '-- No rows with a unique IcSoft RawMatCode to insert.\n';
  const lines = [];
  for (let i = 0; i < mapped.length; i += batchSize) {
    const chunk = mapped.slice(i, i + batchSize);
    lines.push(
      `INSERT INTO icsoft.dbo.sap_live_item_master (rawmatid, rawmatcode, sapcode, sapdescription, mat_type, mat_group, uom)`,
    );
    lines.push(`SELECT rm.RawMatID, rm.RawMatCode, v.sapcode, v.sapdescription, v.mat_type, v.mat_group, v.uom`);
    lines.push(`FROM (VALUES`);
    chunk.forEach((r, idx) => {
      const comma = idx === chunk.length - 1 ? '' : ',';
      lines.push(
        `  (${sqlInt(r.rawmatid)}, ${sqlStr(r.sapcode)}, ${sqlStr(r.sapdescription)}, ${sqlStr(r.mat_type)}, ${sqlStr(r.mat_group)}, ${sqlStr(r.uom)})${comma}`,
      );
    });
    lines.push(`) AS v(rawmatid, sapcode, sapdescription, mat_type, mat_group, uom)`);
    lines.push(`INNER JOIN icsoft.dbo.RAWMATERIAL AS rm`);
    lines.push(`  ON rm.RawMatID = v.rawmatid;`);
    lines.push('GO');
    lines.push('');
  }
  return lines.join('\n');
}

function emitIcsoftUpdateBatches(rows, batchSize = 200) {
  const mapped = rows.filter((r) => r.rawmatcode);
  if (!mapped.length) return '-- No unique RAWMATERIAL matches to apply.\n';
  const lines = [];
  for (let i = 0; i < mapped.length; i += batchSize) {
    const chunk = mapped.slice(i, i + batchSize);
    lines.push('UPDATE t');
    lines.push('SET t.rawmatid = rm.RawMatID,');
    lines.push('    t.rawmatcode = v.rawmatcode');
    lines.push('FROM icsoft.dbo.sap_live_item_master AS t');
    lines.push('INNER JOIN (VALUES');
    chunk.forEach((r, idx) => {
      const comma = idx === chunk.length - 1 ? '' : ',';
      lines.push(`  (${sqlStr(r.sapcode)}, ${sqlStr(r.rawmatcode)})${comma}`);
    });
    lines.push(') AS v(sapcode, rawmatcode)');
    lines.push('  ON v.sapcode = t.sapcode');
    lines.push('INNER JOIN icsoft.dbo.RAWMATERIAL AS rm');
    lines.push(`  ON UPPER(LTRIM(RTRIM(rm.RawMatCode))) = UPPER(LTRIM(RTRIM(v.rawmatcode)))`);
    lines.push('WHERE t.rawmatid IS NULL OR NULLIF(LTRIM(RTRIM(t.rawmatcode)), \'\') IS NULL;');
    lines.push('GO');
    lines.push('');
  }
  return lines.join('\n');
}

function emitUpdateStatements(rows) {
  const descOnly = rows.filter(
    (r) => r.change.sapdescription && !r.change.mat_type && !r.change.mat_group && !r.change.uom,
  );
  const mixed = rows.filter(
    (r) => r.change.mat_type || r.change.mat_group || r.change.uom,
  );
  const lines = [];
  if (descOnly.length) {
    lines.push('-- Description-only refresh from SAP (inch marks / punctuation).');
    lines.push('-- mat_type, mat_group, uom are unchanged for these rows.');
    lines.push('UPDATE t');
    lines.push('SET t.sapdescription = v.sapdescription');
    lines.push('FROM icsoft.dbo.sap_live_item_master AS t');
    lines.push('INNER JOIN (VALUES');
    descOnly.forEach((r, idx) => {
      const comma = idx === descOnly.length - 1 ? '' : ',';
      lines.push(
        `  (${sqlStr(r.db.sapcode)}, ${sqlStr(r.excel.sapdescription)})${comma}  -- was: ${String(r.db.sapdescription || '').replace(/'/g, "''")}`,
      );
    });
    lines.push(') AS v(sapcode, sapdescription)');
    lines.push('  ON v.sapcode = t.sapcode;');
    lines.push('GO');
    lines.push('');
  }
  for (const r of mixed) {
    const sets = [];
    if (r.change.sapdescription) sets.push(`    sapdescription = ${sqlStr(r.excel.sapdescription)}`);
    if (r.change.mat_type) sets.push(`    mat_type = ${sqlStr(r.excel.mat_type)}`);
    if (r.change.mat_group) sets.push(`    mat_group = ${sqlStr(r.excel.mat_group)}`);
    if (r.change.uom) sets.push(`    uom = ${sqlStr(r.excel.uom)}`);
    lines.push(`UPDATE icsoft.dbo.sap_live_item_master`);
    lines.push(`SET`);
    lines.push(sets.join(',\n'));
    lines.push(`WHERE sapcode = ${sqlStr(r.db.sapcode)};`);
    lines.push(`-- id=${r.db.id} excel=${r.excel.excelProduct} rawmatcode=${r.db.rawmatcode || ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(file, headers, rows) {
  const out = [headers.join(',')];
  for (const row of rows) {
    out.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(file, out.join('\n'));
}

const { materials, rows: excelRows, skipped } = await loadExcel();
const { live, snim, rm } = await loadDb();

const liveByKey = new Map();
const liveDupKeys = [];
for (const row of live) {
  const key = normKey(row.sapcode);
  if (!key) continue;
  if (liveByKey.has(key)) liveDupKeys.push(key);
  else liveByKey.set(key, row);
}

const snimByKey = new Map();
for (const row of snim) {
  const key = normKey(row.sap_item_code);
  if (key && !snimByKey.has(key)) snimByKey.set(key, row);
}

const rmIndexes = buildRawmaterialIndexes(rm);

const liveByRawmatid = new Map();
for (const row of live) {
  if (row.rawmatid == null) continue;
  if (!liveByRawmatid.has(row.rawmatid)) liveByRawmatid.set(row.rawmatid, row);
}

const missing = [];
const updates = [];
const unchanged = [];
const insertNoIcsoft = [];
let skippedUnsafeUpdates = 0;
const assignedRawmatids = new Map();

for (const m of materials) {
  const db = liveByKey.get(m.key);
  if (!db) {
    const resolved = resolveRawmaterial(m, rmIndexes, liveByRawmatid);
    const rec = {
      ...m,
      rawmatid: resolved.hit ? resolved.hit.RawMatID : null,
      rawmatcode: resolved.hit ? resolved.hit.RawMatCode : null,
      icsoftSource: resolved.how,
      mappingBlockedReason: resolved.reason || null,
    };
    if (resolved.hit) {
      const prev = assignedRawmatids.get(resolved.hit.RawMatID);
      if (prev) {
        rec.rawmatid = null;
        rec.rawmatcode = null;
        rec.icsoftSource = null;
        rec.mappingBlockedReason = `same RawMatID ${resolved.hit.RawMatID} also matched ${prev}`;
        assignedRawmatids.set(resolved.hit.RawMatID, `${prev} + ${m.excelProduct}`);
      } else {
        assignedRawmatids.set(resolved.hit.RawMatID, m.excelProduct);
      }
    }
    missing.push(rec);
    if (!rec.rawmatid) insertNoIcsoft.push(rec);
    continue;
  }

  const descDiff = !eq(db.sapdescription, m.sapdescription);
  const change = {
    sapdescription: descDiff && isSafeDescriptionUpdate(db.sapdescription, m.sapdescription),
    mat_type: !eq(db.mat_type, m.mat_type),
    mat_group: !eq(db.mat_group, m.mat_group),
    uom: !eq(String(db.uom || '').toUpperCase(), m.uom),
  };
  if (descDiff && !change.sapdescription) skippedUnsafeUpdates += 1;
  if (change.sapdescription || change.mat_type || change.mat_group || change.uom) {
    updates.push({
      excel: m,
      db: {
        id: db.id,
        sapcode: db.sapcode,
        rawmatid: db.rawmatid,
        rawmatcode: db.rawmatcode,
        sapdescription: db.sapdescription,
        mat_type: db.mat_type,
        mat_group: db.mat_group,
        uom: db.uom,
      },
      change,
    });
  } else {
    unchanged.push(m.key);
  }
}

const rawmatidUseCount = new Map();
for (const rec of missing) {
  if (rec.rawmatid == null) continue;
  rawmatidUseCount.set(rec.rawmatid, (rawmatidUseCount.get(rec.rawmatid) || 0) + 1);
}
for (const rec of missing) {
  if (rec.rawmatid != null && rawmatidUseCount.get(rec.rawmatid) > 1) {
    rec.mappingBlockedReason = `same RawMatID ${rec.rawmatid} matched multiple SAP codes`;
    rec.rawmatid = null;
    rec.rawmatcode = null;
    rec.icsoftSource = null;
  }
}
insertNoIcsoft.length = 0;
for (const rec of missing) {
  if (!rec.rawmatid) insertNoIcsoft.push(rec);
}

const excelKeys = new Set(materials.map((m) => m.key));
const inDbNotExcel = [];
for (const [key, row] of liveByKey) {
  if (!excelKeys.has(key)) {
    inDbNotExcel.push({
      key,
      sapcode: row.sapcode,
      rawmatcode: row.rawmatcode,
      mat_type: row.mat_type,
      sapdescription: row.sapdescription,
    });
  }
}

const changeCounts = {
  sapdescription: updates.filter((u) => u.change.sapdescription).length,
  mat_type: updates.filter((u) => u.change.mat_type).length,
  mat_group: updates.filter((u) => u.change.mat_group).length,
  uom: updates.filter((u) => u.change.uom).length,
};

const typeBreakdown = {};
const mappingHow = {};
for (const m of missing) {
  bump(typeBreakdown, m.mat_type || '(blank)');
  bump(mappingHow, m.icsoftSource || 'unmapped');
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(XLSX),
  excelPlantSlocRows: excelRows,
  excelSkipped: skipped,
  excelUniqueProducts: materials.length,
  liveTableRows: live.length,
  liveUniqueNormalized: liveByKey.size,
  liveDuplicateNormalizedKeys: liveDupKeys.length,
  missingInLiveTable: missing.length,
  missingWithIcsoftMap: missing.filter((m) => m.rawmatid).length,
  missingWithoutIcsoftMap: insertNoIcsoft.length,
  skippedUnsafeDescriptionUpdates: skippedUnsafeUpdates,
  updatesRequired: updates.length,
  unchanged: unchanged.length,
  inLiveTableNotInExcel: inDbNotExcel.length,
  updateFieldCounts: changeCounts,
  missingByMatType: typeBreakdown,
  icsoftMappingHow: mappingHow,
  note:
    'Excel Old Product Number is CRPM0020 on every row (dump artifact) so it cannot be used as RawMatCode. IcSoft keys are resolved from RAWMATERIAL by unique name match; rawmatid is selected from RAWMATERIAL in the INSERT via JOIN.',
  sampleMissing: missing.slice(0, 25).map((m) => ({
    excelProduct: m.excelProduct,
    sapcode: m.sapcode,
    mat_type: m.mat_type,
    mat_group: m.mat_group,
    sapdescription: m.sapdescription,
    uom: m.uom,
    rawmatid: m.rawmatid,
    rawmatcode: m.rawmatcode,
    icsoftSource: m.icsoftSource,
    mappingBlockedReason: m.mappingBlockedReason,
  })),
  sampleUpdates: updates.slice(0, 15).map((u) => ({
    sapcode: u.db.sapcode,
    excelProduct: u.excel.excelProduct,
    change: u.change,
    db: { mat_type: u.db.mat_type, mat_group: u.db.mat_group, uom: u.db.uom, sapdescription: u.db.sapdescription },
    excel: { mat_type: u.excel.mat_type, mat_group: u.excel.mat_group, uom: u.excel.uom, sapdescription: u.excel.sapdescription },
  })),
  sampleInDbNotExcel: inDbNotExcel.slice(0, 15),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

writeCsv(
  OUT_MISSING_CSV,
  ['excelProduct', 'sapcode', 'mat_type', 'mat_group', 'sapdescription', 'uom', 'rawmatid', 'rawmatcode', 'icsoftSource', 'plantRows', 'mappingBlockedReason'],
  missing.filter((m) => m.rawmatid && m.rawmatcode),
);
writeCsv(
  OUT_SKIPPED_CSV,
  ['excelProduct', 'sapcode', 'mat_type', 'mat_group', 'sapdescription', 'uom', 'plantRows', 'mappingBlockedReason'],
  missing.filter((m) => !m.rawmatid || !m.rawmatcode),
);
writeCsv(
  OUT_UPDATES_CSV,
  [
    'id',
    'sapcode',
    'excelProduct',
    'db_mat_type',
    'excel_mat_type',
    'db_mat_group',
    'excel_mat_group',
    'db_uom',
    'excel_uom',
    'db_sapdescription',
    'excel_sapdescription',
  ],
  updates.map((u) => ({
    id: u.db.id,
    sapcode: u.db.sapcode,
    excelProduct: u.excel.excelProduct,
    db_mat_type: u.db.mat_type,
    excel_mat_type: u.excel.mat_type,
    db_mat_group: u.db.mat_group,
    excel_mat_group: u.excel.mat_group,
    db_uom: u.db.uom,
    excel_uom: u.excel.uom,
    db_sapdescription: u.db.sapdescription,
    excel_sapdescription: u.excel.sapdescription,
  })),
);

const insertHeader = `-- sap_live_item_master INSERT
-- Source: ${path.basename(XLSX)}
-- Generated: ${report.generatedAt}
-- Rows inserted: ${report.missingWithIcsoftMap}
-- Rows excluded (no unique IcSoft RawMatCode): ${report.missingWithoutIcsoftMap}
--
-- Only materials that join to RAWMATERIAL.RawMatID are inserted.
-- rawmatid and rawmatcode are taken from RAWMATERIAL (INNER JOIN).
-- Rows with no unique IcSoft code are excluded from this script.
-- Unique index: UQ_sap_live_item_master_sapcode
-- Review, then run on WRITE primary (10.1.3.198). Take a backup / wrap in a transaction.

USE icsoft;
GO

`;

const updateHeader = `-- sap_live_item_master UPDATE
-- Source: ${path.basename(XLSX)}
-- Generated: ${report.generatedAt}
-- Rows: ${updates.length}
-- Fields updated only when they differ: sapdescription, mat_type, mat_group, uom
-- rawmatid / rawmatcode are left unchanged (Excel Old Product Number is not trustworthy).
-- WHERE sapcode = existing live-table sapcode (already padded).

USE icsoft;
GO

`;

fs.writeFileSync(OUT_INSERT, insertHeader + emitInsertBatches(missing));
fs.writeFileSync(
  OUT_UPDATE,
  updateHeader +
    (updates.length
      ? emitUpdateStatements(updates)
      : '-- No attribute differences found.\n'),
);
const rawmatUpdateHeader = `-- sap_live_item_master UPDATE rawmatid / rawmatcode
-- Source: ${path.basename(XLSX)}
-- Generated: ${report.generatedAt}
-- Rows: ${missing.filter((m) => m.rawmatcode).length}
-- Use this if the 634 SAP codes were already inserted with NULL IcSoft keys.
-- rawmatid is taken from RAWMATERIAL: JOIN RawMatCode = mapped IcSoft code.
-- Excel Old Product Number is NOT used (it is CRPM0020 on every row).

USE icsoft;
GO

`;
fs.writeFileSync(OUT_UPDATE_RAWMAT, rawmatUpdateHeader + emitIcsoftUpdateBatches(missing));

console.log(JSON.stringify({
  excelUniqueProducts: materials.length,
  liveTableRows: live.length,
  missingInLiveTable: missing.length,
  missingWithIcsoftMap: report.missingWithIcsoftMap,
  missingWithoutIcsoftMap: insertNoIcsoft.length,
  icsoftMappingHow: mappingHow,
  skippedUnsafeDescriptionUpdates: skippedUnsafeUpdates,
  updatesRequired: updates.length,
  updateFieldCounts: changeCounts,
  unchanged: unchanged.length,
  inLiveTableNotInExcel: inDbNotExcel.length,
  files: { OUT_INSERT, OUT_UPDATE, OUT_UPDATE_RAWMAT, OUT_REPORT, OUT_MISSING_CSV, OUT_SKIPPED_CSV, OUT_UPDATES_CSV },
}, null, 2));
