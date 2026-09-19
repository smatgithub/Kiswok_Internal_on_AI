/**
 * Enqueue IcSoft codes into SAP pipeline stage "pending".
 * Run from repo root: node scripts/enqueue-pending-codes.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import sql from 'mssql';

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'));
const jwt = require('jsonwebtoken');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

const RAW_CODES = `
BEARIG0443
SPARMS4796
EARING0827
CONELMR0354
CONMESG0198
SPR1309
RMTHS0711
RMTHS0712
RMTHS0713
CONMESK0386
CONMESK0387
RMINIST0652
CONMESTST0235
CONMESTST0236
CONMESTST0237
CONMESTST0240
CONMESTST0242
CONMESTST0243
CONMESTST0245
CONGEPT0220
CONGEPT0221
CONGEPT0222
CONGESO1812
CONELCA0876
CONELCA0877
CONELCA0878
CONELCA0879
CONELLF0114
SPARES3700
SPARES3701
SPARGM0441
SPARGM0446
SPARGM0543
SPARES3744
NIWI0032
RMINIOCM0021
SPARGM0346
CONMENU0602
CONMENU0603
CGTT0739
CONMESTPT0165
CONMESG0898
BEARING1083
CONGEPT0216
CONGEPT0217
CONGEPT0218
CONGEPT0219
RMFS1151
RMINIOCM0027
CONGESO0876
CONGESO2381
SPR1248
CONELSN0079
CONELSN0081
CONELFN0034
CONELMR0353
CONELMR0348
CONELPA0898
CONMENB1018
CONMESG0814
CONGESO2396
SERCV0060
CONGESO2399
CONMESH0878
CONMESK0411
cgddpn5345
RMTHS0724
rminist0706
SPR1066
SPR1068
SERGO0002
SERRP0082
CGMI0003
GFI0646
GFI0977
GFI0978
GFI1575
GFI0938
GFI1628
GFI1775
GFI1632
GFI1627
GFI0057
GFI1629
CONMEBR0017
CONGESO0171
CONGESO2342
CONGESO2397
CONGEPT0223
CONGEPT0212
CONGEPT0224
CONGEPT0225
CONGEPT0226
CONGEPT0227
CONGEPT0228
CONGEPT0229
CONGEGE0966
CONGEGE0967
CONGESO0938
CONGESO0959
CONGESO0960
CONGESO1200
CONGESO1201
CONGESO1202
CONGESO1203
CONGESO1379
CONGESO1766
CONGESO1920
CONGESO2121
CONGESO2128
CONGESO2398
CONGESO0210
CGCH0304
CGCH0305
CGCH0095
SERAM0034
CGJFI0730
CGADP0535
CGADP0536
CGADP0538
RMINIST0704
RMEM0058
CGMIC0509
CGMIC0510
CGMIC0519
CGMIC0520
CGTHL1Y1532
CGTHL1Y1534
CGTH1LY1534
CGTHL1Y1535
CGTHL1Y1536
CGTHL1Y1537
CGTHL1Y1541
CGTHL1Y1542
CGTHL1Y1543
CGTHL1Y1544
CGTH1LY1545
CGTHL1Y1546
CGMIC0508
CG,MIC0521
RMFS3139
RMFS3144
RMINIST0707
RMTHS0725
RMTHS0726
CGADP0537
CGTHL1Y1540
BEARING1059
BEARING1060
BEARING1064
CONMECR0351
CONMECR0352
CONMECR0357
CONMECW0146
CONMEFM0139
CONMEFM0140
CONMEFM0141
CONMEHS0589
SPARMS4231
SPR1111
SPR1113
SPR1115
SPR1150
SPR1151
SPR1152
SPR1154
SPR1155
SERCY0001
SERGO0008
SEREP0002
SERCH0011
SERRT0001
SERGO0001
SERSB0067
SERCN0008
SERAM0001
SERTV0005
SERRP0040
CGCS0077
CGCS0078
`;

function normalize(code) {
  return String(code).replace(/,/g, '').replace(/\s+/g, '').trim().toUpperCase();
}

const requested = [...new Set(RAW_CODES.split('\n').map(normalize).filter(Boolean))];

const aliases = {
  CGMIC0521: ['CGMIC0521'],
  BEARIG0443: ['BEARIG0443', 'BEARING0443'],
  EARING0827: ['EARING0827', 'BEARING0827'],
  CGTH1LY1534: ['CGTH1LY1534', 'CGTHL1Y1534'],
  CGTH1LY1545: ['CGTH1LY1545', 'CGTHL1Y1545'],
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
  requestTimeout: 120000,
};

const pool = await sql.connect(cfg);
const inList = lookupCodes.map((_, i) => `@c${i}`).join(',');
const req = pool.request();
lookupCodes.forEach((c, i) => req.input(`c${i}`, sql.VarChar(50), c));

const found = await req.query(`
  SELECT r.RawMatID, r.RAWMATCODE, r.Active
  FROM RAWMATERIAL r
  WHERE UPPER(LTRIM(RTRIM(r.RAWMATCODE))) IN (${inList})
`);
await pool.close();

const byUpper = new Map();
for (const row of found.recordset) {
  byUpper.set(String(row.RAWMATCODE).trim().toUpperCase(), row);
}

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
    inactive.push({ code: String(row.RAWMATCODE).trim(), rawMatId: row.RawMatID, active: row.Active });
    continue;
  }
  const id = Number(row.RawMatID);
  if (!idToCode.has(id)) {
    ids.push(id);
    idToCode.set(id, String(row.RAWMATCODE).trim());
  }
}

const token = jwt.sign(
  { username: 'somnathdas', userName: 'pipeline-enqueue', empId: 0 },
  process.env.JWT_SECRET,
  { expiresIn: '2h' },
);

const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010/api';

async function enqueueOne(rawMatId) {
  const res = await fetch(`${api}/sap-items/pipeline/enqueue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rawMatIds: [rawMatId] }),
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

for (const id of ids) {
  const code = idToCode.get(id);
  try {
    const body = await enqueueOne(id);
    lastCounts = body.counts;
    queued.push({ code, rawMatId: id, stage: body.data?.[0]?.stage || 'pending' });
    process.stdout.write(`ok ${code}\n`);
  } catch (err) {
    failed.push({ code, rawMatId: id, error: err.message });
    process.stdout.write(`fail ${code}: ${err.message}\n`);
  }
}

console.log(
  JSON.stringify(
    {
      requestedUnique: requested.length,
      foundActive: ids.length,
      queued: queued.length,
      failed,
      inactive,
      missing,
      counts: lastCounts,
    },
    null,
    2,
  ),
);
