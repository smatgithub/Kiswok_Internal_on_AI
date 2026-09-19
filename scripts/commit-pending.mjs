/**
 * Commit all pipeline "pending" items to Ready for template.
 * Usage: node scripts/commit-pending.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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

const token = jwt.sign(
  { username: 'somnathdas', userName: 'pipeline-commit', empId: 0 },
  process.env.JWT_SECRET,
  { expiresIn: '6h' },
);
const apiRaw = process.env.ENQUEUE_API_URL || process.env.NEXT_PUBLIC_API_URL || '';
const api =
  /^https?:\/\//i.test(apiRaw)
    ? apiRaw.replace(/\/$/, '')
    : 'http://127.0.0.1:4010/api';

console.log(`POST ${api}/sap-items/pipeline/commit-pending`);

const res = await fetch(`${api}/sap-items/pipeline/commit-pending`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({}),
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { message: text };
}
if (!res.ok) {
  console.error(body.message || text || `HTTP ${res.status}`);
  process.exit(1);
}

const data = body.data || {};
console.log(
  JSON.stringify(
    {
      batchId: data.batchId,
      requested: data.requested,
      committed: data.committed,
      failedCount: (data.failed || []).length,
      failed: (data.failed || []).slice(0, 25),
      sample: data.sample,
      counts: data.counts || body.counts,
    },
    null,
    2,
  ),
);

const report = path.join(root, 'data/commit-pending-report.json');
fs.writeFileSync(report, JSON.stringify(data, null, 2));
console.log(`Wrote ${report}`);
