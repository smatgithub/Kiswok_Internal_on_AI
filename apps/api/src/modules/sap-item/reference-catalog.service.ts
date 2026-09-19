import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { WizardAnswers } from '@kiswok/shared';

export type CatalogCode = { code: string; description?: string; kind?: string };

export type KiswokMasterCatalog = {
  hsn: Map<string, CatalogCode>;
  materialGroups: Map<string, CatalogCode>;
  hsnSource: string | null;
  groupSource: string | null;
};

@Injectable()
export class ReferenceCatalogService {
  private readonly log = new Logger(ReferenceCatalogService.name);
  private cache: KiswokMasterCatalog | null = null;

  private resolveFile(name: string): string | null {
    const candidates = [
      path.resolve(process.cwd(), 'data/masters', name),
      path.resolve(process.cwd(), '../../data/masters', name),
      path.resolve(__dirname, '../../../../../data/masters', name),
    ];
    return candidates.find((p) => fs.existsSync(p)) || null;
  }

  load(): KiswokMasterCatalog {
    if (this.cache) return this.cache;
    const hsnFile = this.resolveFile('hsn-codes.json');
    const groupFile = this.resolveFile('material-groups.json');
    const hsn = new Map<string, CatalogCode>();
    const materialGroups = new Map<string, CatalogCode>();

    if (hsnFile) {
      try {
        const raw = JSON.parse(fs.readFileSync(hsnFile, 'utf8')) as {
          sourceFile?: string;
          codes?: CatalogCode[];
        };
        for (const row of raw.codes || []) {
          const code = String(row.code || '').replace(/\D/g, '');
          if (code) hsn.set(code, { ...row, code });
        }
        this.log.log(`HSN master loaded: ${hsn.size} unique codes from ${raw.sourceFile || hsnFile}`);
      } catch (err) {
        this.log.error(`Failed to load HSN master: ${(err as Error).message}`);
      }
    } else {
      this.log.warn('HSN master not found (data/masters/hsn-codes.json). Run scripts/ingest-kiswok-masters.mjs');
    }

    if (groupFile) {
      try {
        const raw = JSON.parse(fs.readFileSync(groupFile, 'utf8')) as {
          sourceFile?: string;
          codes?: CatalogCode[];
        };
        for (const row of raw.codes || []) {
          const code = String(row.code || '')
            .trim()
            .toUpperCase()
            .slice(0, 9);
          if (code) materialGroups.set(code, { ...row, code });
        }
        this.log.log(
          `Material group master loaded: ${materialGroups.size} codes from ${raw.sourceFile || groupFile}`,
        );
      } catch (err) {
        this.log.error(`Failed to load material group master: ${(err as Error).message}`);
      }
    } else {
      this.log.warn(
        'Material group master not found (data/masters/material-groups.json). Run scripts/ingest-kiswok-masters.mjs',
      );
    }

    this.cache = {
      hsn,
      materialGroups,
      hsnSource: hsnFile,
      groupSource: groupFile,
    };
    return this.cache;
  }

  reload(): KiswokMasterCatalog {
    this.cache = null;
    return this.load();
  }

  normalizeHsn(value?: string | null): string {
    return String(value || '').replace(/\D/g, '');
  }

  hasHsn(value?: string | null): boolean {
    const code = this.normalizeHsn(value);
    if (!code) return false;
    const cat = this.load();
    if (!cat.hsn.size) return true;
    return cat.hsn.has(code);
  }

  hasMaterialGroup(value?: string | null): boolean {
    const code = String(value || '')
      .trim()
      .toUpperCase()
      .slice(0, 9);
    if (!code) return false;
    const cat = this.load();
    if (!cat.materialGroups.size) return true;
    return cat.materialGroups.has(code);
  }

  listHsn(kind?: 'HSN' | 'SAC'): CatalogCode[] {
    const rows = [...this.load().hsn.values()];
    if (!kind) return rows;
    return rows.filter((r) => (r.kind || 'HSN') === kind);
  }

  listMaterialGroups(): CatalogCode[] {
    return [...this.load().materialGroups.values()];
  }

  applyToAnswers(answers: WizardAnswers): WizardAnswers {
    const hsn = this.normalizeHsn(answers.hsnCode);
    const group = String(answers.productGroup || '')
      .trim()
      .toUpperCase()
      .slice(0, 9);
    return {
      ...answers,
      hsnCode: hsn,
      productGroup: group,
    };
  }

  validate(answers: WizardAnswers): string[] {
    const cat = this.load();
    const errors: string[] = [];
    const hsn = this.normalizeHsn(answers.hsnCode);
    const group = String(answers.productGroup || '')
      .trim()
      .toUpperCase()
      .slice(0, 9);

    if (cat.hsn.size) {
      if (!hsn) {
        errors.push('HSN / SAC is required and must come from the Kiswok HSN master');
      } else if (!cat.hsn.has(hsn)) {
        errors.push(`HSN / SAC ${hsn} is not in the Kiswok HSN master`);
      }
    }

    if (cat.materialGroups.size) {
      if (!group) {
        errors.push('Material Group must come from the Kiswok material group master');
      } else if (!cat.materialGroups.has(group)) {
        errors.push(`Material Group ${group} is not in the Kiswok material group master`);
      }
    }

    return errors;
  }

  summary() {
    const cat = this.load();
    return {
      hsnCodes: cat.hsn.size,
      materialGroups: cat.materialGroups.size,
      hsnSource: cat.hsnSource,
      groupSource: cat.groupSource,
    };
  }
}
