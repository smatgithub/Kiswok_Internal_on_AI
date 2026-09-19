/**
 * Enqueue IcSoft codes from a text file into pipeline stage "pending".
 * Usage: node scripts/enqueue-from-file.mjs data/pending-codes.txt
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import sql from 'mssql';

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'),
);
const jwt = require('jsonwebtoken');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith("'") && val.endsWith("'")) ||
      (val.startsWith('"') && val.endsWith('"'))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnv(path.join(root, '.env'));
loadEnv(path.join(root, 'apps/api/.env'));

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node scripts/enqueue-from-file.mjs <codes.txt>');
  process.exit(1);
}

function normalize(code) {
  return String(code).replace(/[,]/g, '').replace(/\s+/g, '').trim().toUpperCase();
}

const requested = [
  ...new Set(
    fs
      .readFileSync(path.resolve(fileArg), 'utf8')
      .split(/\r?\n/)
      .map(normalize)
      .filter((c) => c && c.length >= 6 && !/\s/.test(c)),
  ),
];

const aliases = {
  COMENB0734: ['COMENB0734', 'CONMENB0734'],
  CONFELPA1084: ['CONFELPA1084', 'CONELPA1084'],
  CGMEO515: ['CGMEO515', 'CGME0515', 'CGMEO0515'],
  CONMEW10343: ['CONMEW10343', 'CONMEWI0343', 'CONMEW0343'],
  CONMEV0607: ['CONMEV0607', 'CONMEVV0607'],
  CONELCA8300: ['CONELCA8300', 'CONELCA08300'],
  CONMEBE: ['CONMEBE'],
};

const lookupCodes = [...new Set(requested.flatMap((c) => aliases[c] || [c]))];

const cfg = {
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME || 'icsoft',
  options: { encrypt: true, trustServerCertificate: true },
  connectionTimeout: 30000,
  requestTimeout: 180000,
};

console.log(`Looking up ${lookupCodes.length} unique codes...`);
const pool = await sql.connect(cfg);

const CHUNK = 400;
const byUpper = new Map();
for (let i = 0; i < lookupCodes.length; i += CHUNK) {
  const slice = lookupCodes.slice(i, i + CHUNK);
  const req = pool.request();
  const inList = slice.map((_, j) => `@c${j}`).join(',');
  slice.forEach((c, j) => req.input(`c${j}`, sql.VarChar(50), c));
  const found = await req.query(`
    SELECT r.RawMatID, r.RAWMATCODE, r.Active
    FROM RAWMATERIAL r
    WHERE UPPER(LTRIM(RTRIM(r.RAWMATCODE))) IN (${inList})
  `);
  for (const row of found.recordset) {
    byUpper.set(String(row.RAWMATCODE).trim().toUpperCase(), row);
  }
}
await pool.close();

function resolveRow(code) {
  for (const v of aliases[code] || [code]) {
    if (byUpper.has(v)) return byUpper.get(v);
  }
  return null;
}

const missing = [];
const inactive = [];
const ids = [];
const idToCode = new Map();

for (const code of requested) {
  const row = resolveRow(code);
  if (!row) {
    missing.push(code);
    continue;
  }
  if (String(row.Active).toUpperCase() !== 'Y') {
    inactive.push(String(row.RAWMATCODE).trim());
    continue;
  }
  const id = Number(row.RawMatID);
  if (!idToCode.has(id)) {
    ids.push(id);
    idToCode.set(id, String(row.RAWMATCODE).trim());
  }
}

console.log(`Found ${ids.length} active materials. Enqueueing...`);

const token = jwt.sign(
  { username: 'somnathdas', userName: 'pipeline-enqueue', empId: 0 },
  process.env.JWT_SECRET,
  { expiresIn: '6h' },
);
const apiRaw = process.env.ENQUEUE_API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const api =
  /^https?:\/\//i.test(apiRaw) ? apiRaw.replace(/\/$/, '') : 'http://127.0.0.1:4010/api';

async function enqueueIds(rawMatIds) {
  const res = await fetch(`${api}/sap-items/pipeline/enqueue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rawMatIds }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return body;
}

const queued = [];
const failed = [];
let lastCounts = null;
const BATCH = 8;

for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  try {
    const body = await enqueueIds(batch);
    lastCounts = body.counts;
    for (const id of batch) {
      queued.push(idToCode.get(id));
      process.stdout.write(`ok ${idToCode.get(id)}\n`);
    }
  } catch (err) {
    for (const id of batch) {
      const code = idToCode.get(id);
      try {
        const body = await enqueueIds([id]);
        lastCounts = body.counts;
        queued.push(code);
        process.stdout.write(`ok ${code}\n`);
      } catch (e2) {
        failed.push({ code, error: e2.message });
        process.stdout.write(`fail ${code}: ${e2.message}\n`);
      }
    }
  }
}

const report = {
  requestedUnique: requested.length,
  foundActive: ids.length,
  queued: queued.length,
  failed,
  inactive,
  missing,
  counts: lastCounts,
};
fs.writeFileSync(
  path.join(root, 'data', 'pending-enqueue-report.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
