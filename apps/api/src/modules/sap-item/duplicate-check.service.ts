import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import {
  DUPLICATE_BLOCK_SCORE,
  DUPLICATE_SHOW_SCORE,
  DuplicateCheckQuery,
  DuplicateCheckResult,
  DuplicateMatch,
  DuplicateVerdict,
} from '@kiswok/shared';
import {
  DescriptionTokens,
  normalizeDescription,
  tokenizeDescription,
} from './description-normalize';

type ProductRecord = {
  product: string;
  description: string;
  productType: string | null;
  productGroup: string | null;
  uom: string | null;
  hsn: string | null;
  plants: string[];
  normalized: string;
  tokens: DescriptionTokens;
};

type ProductCatalogFile = {
  sourceFile?: string;
  generatedAt?: string;
  rows?: number;
  uniqueProducts?: number;
  products: Array<{
    product: string;
    description?: string;
    productType?: string | null;
    productGroup?: string | null;
    uom?: string | null;
    hsn?: string | null;
    plants?: string[];
    normalized?: string;
  }>;
};

export type SimilarSearchInput = {
  description: string;
  rawMatId?: number | null;
  rawMatCode?: string | null;
  hsn?: string | null;
  uom?: string | null;
  limit?: number;
};

@Injectable()
export class DuplicateCheckService {
  private readonly log = new Logger(DuplicateCheckService.name);
  private products: ProductRecord[] = [];
  private exactIndex = new Map<string, number[]>();
  private tokenIndex = new Map<string, number[]>();
  private productIndex = new Map<string, number>();
  private sourceFile: string | null = null;
  private loaded = false;
  private loadAttempted = false;

  catalogPath(): string {
    const candidates = [
      path.resolve(process.cwd(), 'data/sap-material-master-products.json'),
      path.resolve(process.cwd(), '../../data/sap-material-master-products.json'),
      path.resolve(__dirname, '../../../../../data/sap-material-master-products.json'),
      path.resolve(__dirname, '../../../../../../data/sap-material-master-products.json'),
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  load(): boolean {
    if (this.loadAttempted) return this.loaded;
    this.loadAttempted = true;
    const file = this.catalogPath();
    if (!fs.existsSync(file)) {
      this.log.warn(`Material master product index not found: ${file}`);
      return false;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ProductCatalogFile;
      this.sourceFile = raw.sourceFile || path.basename(file);
      this.products = (raw.products || []).map((p) => {
        const description = String(p.description || '').trim();
        const normalized = normalizeDescription(description);
        return {
          product: String(p.product || '').trim(),
          description,
          productType: p.productType || null,
          productGroup: p.productGroup || null,
          uom: p.uom || null,
          hsn: p.hsn || null,
          plants: Array.isArray(p.plants) ? p.plants : [],
          normalized,
          tokens: tokenizeDescription(normalized),
        };
      });
      this.exactIndex.clear();
      this.tokenIndex.clear();
      this.productIndex.clear();
      this.products.forEach((p, idx) => {
        const sapKey = DuplicateCheckService.normalizeSapCode(p.product);
        if (sapKey && !this.productIndex.has(sapKey)) {
          this.productIndex.set(sapKey, idx);
        }
        if (p.normalized) {
          const list = this.exactIndex.get(p.normalized) || [];
          list.push(idx);
          this.exactIndex.set(p.normalized, list);
        }
        const seen = new Set<string>();
        for (const tok of p.tokens.significant) {
          if (seen.has(tok)) continue;
          seen.add(tok);
          const list = this.tokenIndex.get(tok) || [];
          list.push(idx);
          this.tokenIndex.set(tok, list);
        }
      });
      this.loaded = true;
      this.log.log(
        `Loaded material master products: ${this.products.length} from ${this.sourceFile}`,
      );
      return true;
    } catch (err) {
      this.log.error(`Failed to load product index: ${(err as Error).message}`);
      return false;
    }
  }

  catalogMeta() {
    this.load();
    return {
      loaded: this.loaded,
      products: this.products.length,
      sourceFile: this.sourceFile,
    };
  }

  static normalizeSapCode(value?: string | null): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d+$/.test(raw)) {
      try {
        return String(BigInt(raw));
      } catch {
        return raw;
      }
    }
    return raw.toUpperCase();
  }

  /**
   * Exact already-created SAP material:
   *  - PRODUCT number exists in live Material Master, or
   *  - normalized description is an exact match to a live material.
   */
  findExactExisting(input: {
    sapCode?: string | null;
    description?: string | null;
    icsoftCode?: string | null;
  }): { sapCode: string; reason: string } | null {
    this.load();
    if (!this.loaded) return null;

    const icsoft = DuplicateCheckService.normalizeSapCode(input.icsoftCode);
    const sapKey = DuplicateCheckService.normalizeSapCode(input.sapCode);
    if (sapKey && sapKey !== icsoft) {
      const idx = this.productIndex.get(sapKey);
      if (idx != null) {
        const p = this.products[idx];
        return {
          sapCode: p.product,
          reason: `Product number ${p.product} already exists in SAP Material Master`,
        };
      }
    }

    const qNorm = normalizeDescription(input.description || '');
    if (!qNorm) return null;
    const hits = this.exactIndex.get(qNorm) || [];
    if (!hits.length) return null;
    const p = this.products[hits[0]];
    return {
      sapCode: p.product,
      reason: `Exact same description as SAP material ${p.product}`,
    };
  }

  findSimilar(input: SimilarSearchInput): DuplicateCheckResult {
    this.load();
    const query: DuplicateCheckQuery = {
      rawMatId: input.rawMatId ?? null,
      description: String(input.description || '').trim(),
      rawMatCode: input.rawMatCode || null,
      hsn: input.hsn || null,
      uom: input.uom || null,
    };
    const catalog = this.catalogMeta();
    const empty = (verdict: DuplicateVerdict, matches: DuplicateMatch[]): DuplicateCheckResult => ({
      verdict,
      query,
      matches,
      catalog,
    });

    if (!this.loaded || !query.description) {
      return empty('none', []);
    }

    const qNorm = normalizeDescription(query.description);
    const qTokens = tokenizeDescription(qNorm);
    const limit = Math.min(Math.max(input.limit || 12, 1), 40);
    const scored = new Map<number, DuplicateMatch>();

    const exactHits = this.exactIndex.get(qNorm) || [];
    for (const idx of exactHits) {
      scored.set(idx, this.toMatch(this.products[idx], 100, 'exact description'));
    }

    const candidate = new Set<number>(exactHits);
    for (const tok of qTokens.significant) {
      const posting = this.tokenIndex.get(tok);
      if (!posting) continue;
      for (const idx of posting) candidate.add(idx);
    }

    const queryHsn = String(query.hsn || '').trim();
    const queryUom = String(query.uom || '').trim().toUpperCase();
    const shortQuery = qTokens.significant.filter((t) => !qTokens.numeric.has(t)).length <= 1;

    for (const idx of candidate) {
      if (scored.has(idx)) continue;
      const product = this.products[idx];
      const match = this.scorePair(qNorm, qTokens, product, {
        shortQuery,
        queryHsn,
        queryUom,
      });
      if (match) scored.set(idx, match);
    }

    const matches = [...scored.values()]
      .filter((m) => m.score >= DUPLICATE_SHOW_SCORE)
      .sort((a, b) => b.score - a.score || a.product.localeCompare(b.product))
      .slice(0, limit);

    let verdict: DuplicateVerdict = 'none';
    if (matches.some((m) => m.score >= DUPLICATE_BLOCK_SCORE)) verdict = 'duplicate';
    else if (matches.length) verdict = 'similar';

    return empty(verdict, matches);
  }

  private scorePair(
    qNorm: string,
    qTokens: DescriptionTokens,
    product: ProductRecord,
    opts: { shortQuery: boolean; queryHsn: string; queryUom: string },
  ): DuplicateMatch | null {
    const pNorm = product.normalized;
    if (!pNorm) return null;

    const pTokens = product.tokens;
    const qSet = new Set(qTokens.significant);
    const pSet = new Set(pTokens.significant);
    if (!qSet.size || !pSet.size) return null;

    let reason = 'name overlap';
    let score = 0;

    const qLen = qNorm.length;
    const pLen = pNorm.length;
    const shorter = qLen <= pLen ? qNorm : pNorm;
    const longer = qLen <= pLen ? pNorm : qNorm;
    const containsOk =
      shorter.length >= 12 ||
      (qTokens.significant.length >= 2 && pTokens.significant.length >= 2);
    if (containsOk && shorter.length >= 8 && longer.includes(shorter) && shorter !== longer) {
      score = 90;
      reason = 'description contains the other';
    } else {
      let inter = 0;
      for (const tok of qSet) if (pSet.has(tok)) inter += 1;
      const union = qSet.size + pSet.size - inter;
      const jaccard = union ? inter / union : 0;
      score = Math.round(jaccard * 100);

      const qNums = qTokens.numeric;
      const pNums = pTokens.numeric;
      const bothHaveNumbers = qNums.size > 0 && pNums.size > 0;
      const sameNumbers =
        bothHaveNumbers &&
        qNums.size === pNums.size &&
        [...qNums].every((n) => pNums.has(n));
      const differentNumbers =
        bothHaveNumbers && [...qNums].some((n) => !pNums.has(n));

      if (differentNumbers) {
        score = Math.min(55, score);
        reason = 'name overlap, different size';
      } else if (sameNumbers) {
        score = Math.min(100, score + 8);
        reason = 'same size tokens';
      }
    }

    if (opts.queryHsn && product.hsn && opts.queryHsn === String(product.hsn).trim()) {
      score = Math.min(100, score + 3);
    }
    if (
      opts.queryUom &&
      product.uom &&
      opts.queryUom === String(product.uom).trim().toUpperCase()
    ) {
      score = Math.min(100, score + 2);
    }

    if (opts.shortQuery && score < 90) {
      score = Math.min(score, 50);
    }

    if (score < DUPLICATE_SHOW_SCORE) return null;
    return this.toMatch(product, score, reason);
  }

  private toMatch(product: ProductRecord, score: number, reason: string): DuplicateMatch {
    return {
      product: product.product,
      description: product.description,
      productType: product.productType,
      productGroup: product.productGroup,
      uom: product.uom,
      hsn: product.hsn,
      plants: product.plants,
      score,
      reason,
    };
  }
}
