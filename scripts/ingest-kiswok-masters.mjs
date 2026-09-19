/**
 * Build compact Kiswok masters used by the SAP wizard / gold template.
 *
 * HSN: unique codes from the shared HSN list (CSV export of HSN.pdf).
 * Material group: unique MATKL from the SAP Material Master product index
 *   (the file used to decide material group).
 *
 * Usage:
 *   node scripts/ingest-kiswok-masters.mjs
 *   node scripts/ingest-kiswok-masters.mjs "/path/HSN Code.csv" "/path/products.json"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data/masters');

const defaultHsn = [
  path.join(root, 'data/masters/source/HSN Code.csv'),
  '/Users/som_home/Downloads/Material Master/HSN Code.csv',
  '/Users/som_home/Downloads/SAP Implementation Data/Material Master 2/HSN Code.csv',
].find((p) => fs.existsSync(p));

const defaultGroups = [
  path.join(root, 'data/masters/source/material-groups.csv'),
  path.join(root, 'data/sap-material-master-products.json'),
].find((p) => fs.existsSync(p));

const hsnPath = process.argv[2] || defaultHsn;
const groupPath = process.argv[3] || defaultGroups;

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function kindForHsn(code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.startsWith('99')) return 'SAC';
  return 'HSN';
}

if (!hsnPath) {
  console.error('HSN source not found. Pass path to HSN Code.csv / HSN.pdf export.');
  process.exit(1);
}

console.log('HSN source:', hsnPath);
const hsnText = fs.readFileSync(hsnPath, 'utf8');
const hsnMap = new Map();
for (const line of hsnText.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const cols = parseCsvLine(line);
  const code = String(cols[0] || '')
    .replace(/\D/g, '')
    .trim();
  if (!code || code.toLowerCase().includes('hsn')) continue;
  if (!hsnMap.has(code)) {
    hsnMap.set(code, {
      code,
      description: cols[1] || '',
      kind: kindForHsn(code),
    });
  }
}

const hsnCatalog = {
  sourceFile: hsnPath,
  generatedAt: new Date().toISOString(),
  uniqueCodes: hsnMap.size,
  codes: [...hsnMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
};

const groupMap = new Map();
if (groupPath && groupPath.endsWith('.csv')) {
  console.log('Material group source:', groupPath);
  const text = fs.readFileSync(groupPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const code = String(cols[0] || '')
      .trim()
      .toUpperCase();
    if (!code || code === 'MATERIALGROUP' || code === 'MATKL' || code === 'CODE') {
      continue;
    }
    if (!groupMap.has(code)) {
      groupMap.set(code, {
        code: code.slice(0, 9),
        description: cols[1] || '',
      });
    }
  }
} else if (groupPath && groupPath.endsWith('.json')) {
  console.log('Material group source (stream product index):', groupPath);
  const buf = fs.readFileSync(groupPath, 'utf8');
  const re = /"productGroup":"([^"]+)"/g;
  let m;
  while ((m = re.exec(buf)) !== null) {
    const code = String(m[1] || '')
      .trim()
      .toUpperCase()
      .slice(0, 9);
    if (code && !groupMap.has(code)) {
      groupMap.set(code, { code, description: '' });
    }
  }
} else {
  console.warn('No material-group source found — writing empty group catalog.');
}

const groupCatalog = {
  sourceFile: groupPath || null,
  generatedAt: new Date().toISOString(),
  uniqueCodes: groupMap.size,
  codes: [...groupMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'hsn-codes.json'),
  JSON.stringify(hsnCatalog, null, 2),
);
fs.writeFileSync(
  path.join(outDir, 'material-groups.json'),
  JSON.stringify(groupCatalog, null, 2),
);
console.log(
  JSON.stringify(
    {
      hsnUnique: hsnCatalog.uniqueCodes,
      materialGroupsUnique: groupCatalog.uniqueCodes,
      outDir,
    },
    null,
    2,
  ),
);
