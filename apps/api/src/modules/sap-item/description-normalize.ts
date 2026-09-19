/**
 * Shared description normalization for SAP Material Master duplicate matching.
 * Keep in sync with scripts/ingest-sap-material-master.mjs.
 */

const SYNONYM_PHRASES: Array<[RegExp, string]> = [
  [/MILD\s+STEEL/g, 'MS'],
  [/M\s*\.\s*S\s*\.?/g, 'MS'],
  [/DIAMETER/g, 'DIA'],
  [/MILLIMET(?:ER|RE)S?/g, 'MM'],
];

const SYNONYM_TOKENS: Record<string, string> = {
  MILDSTEEL: 'MS',
  DIAMETER: 'DIA',
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

const STOPWORDS = new Set([
  'FOR',
  'AND',
  'THE',
  'WITH',
  'OF',
  'A',
  'AN',
  'TO',
  'FROM',
  'IN',
  'ON',
  'BY',
  'OR',
  'MAKE',
]);

export function normalizeDescription(raw: string | null | undefined): string {
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
  return s
    .split(/\s+/)
    .map((tok) => SYNONYM_TOKENS[tok] || tok)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalNumber(tok: string): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(tok)) return null;
  const n = Number(tok);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? String(n) : String(n);
}

export type DescriptionTokens = {
  all: string[];
  significant: string[];
  numeric: Set<string>;
};

export function tokenizeDescription(normalized: string): DescriptionTokens {
  const all = normalized.split(/\s+/).filter(Boolean);
  const significant: string[] = [];
  const numeric = new Set<string>();
  for (const tok of all) {
    const num = canonicalNumber(tok);
    if (num) {
      numeric.add(num);
      significant.push(num);
      continue;
    }
    if (STOPWORDS.has(tok) || tok.length < 2) continue;
    significant.push(tok);
  }
  return { all, significant, numeric };
}
