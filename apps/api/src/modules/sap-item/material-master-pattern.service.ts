import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { applyProductTypeStandards, toIsoUom, WEIGHT_UOM_ISO, WizardAnswers, isServiceProduct } from '@kiswok/shared';

function splitCodes(v: unknown): string[] {
  return String(v ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function plantsOf(answers: WizardAnswers): string[] {
  const fromAreas = (answers.valuationAreas || []).flatMap(splitCodes);
  const fromPlant = splitCodes(answers.plant);
  const list = fromAreas.length ? fromAreas : fromPlant;
  return Array.from(new Set(list.length ? list : []));
}

export type CountedValue = { value: string; count: number };

export type ProductTypePattern = {
  rows: number;
  products: number;
  defaultUom: string | null;
  defaultMrpType: string | null;
  defaultAvailCheck: string | null;
  defaultProcurementType: string | null;
  defaultMrpController: string | null;
  defaultItemCategoryGroup: string | null;
  batchManaged: boolean;
  uoms: CountedValue[];
  plants: CountedValue[];
  slocs: CountedValue[];
  hsn: CountedValue[];
  groups: CountedValue[];
};

export type ProductGroupPattern = {
  rows: number;
  products: number;
  productType: string | null;
  defaultUom: string | null;
  defaultHsn: string | null;
  defaultMrpType: string | null;
  defaultAvailCheck: string | null;
  defaultProcurementType: string | null;
  typicalPlants: string[];
  typicalSlocs: string[];
  uoms: CountedValue[];
  hsn: CountedValue[];
  plants: CountedValue[];
};

export type MaterialMasterCatalog = {
  sourceFile: string;
  generatedAt: string;
  rows: number;
  uniqueProducts: number;
  profitCenterFormat: string;
  plants: string[];
  storageLocations: string[];
  storageLocationsByPlant: Record<string, string[]>;
  profitCenterByPlant: Record<string, string | null>;
  uoms: CountedValue[];
  byProductType: Record<string, ProductTypePattern>;
  byProductGroup: Record<string, ProductGroupPattern>;
};

@Injectable()
export class MaterialMasterPatternService {
  private readonly log = new Logger(MaterialMasterPatternService.name);
  private catalog: MaterialMasterCatalog | null = null;

  catalogPath(): string {
    const candidates = [
      path.resolve(process.cwd(), 'data/sap-material-master-patterns.json'),
      path.resolve(process.cwd(), '../../data/sap-material-master-patterns.json'),
      path.resolve(__dirname, '../../../../../data/sap-material-master-patterns.json'),
      path.resolve(__dirname, '../../../../../../data/sap-material-master-patterns.json'),
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  load(): MaterialMasterCatalog | null {
    if (this.catalog) return this.catalog;
    const file = this.catalogPath();
    if (!fs.existsSync(file)) {
      this.log.warn(`Material master pattern catalog not found: ${file}`);
      return null;
    }
    try {
      this.catalog = JSON.parse(
        fs.readFileSync(file, 'utf8'),
      ) as MaterialMasterCatalog;
      this.log.log(
        `Loaded material master patterns: ${this.catalog.rows} rows, ${this.catalog.uniqueProducts} products, ${Object.keys(this.catalog.byProductType || {}).length} types`,
      );
      return this.catalog;
    } catch (err) {
      this.log.error(`Failed to load pattern catalog: ${(err as Error).message}`);
      return null;
    }
  }

  reload(): MaterialMasterCatalog | null {
    this.catalog = null;
    return this.load();
  }

  summary() {
    const c = this.load();
    if (!c) return { loaded: false };
    return {
      loaded: true,
      sourceFile: c.sourceFile,
      generatedAt: c.generatedAt,
      rows: c.rows,
      uniqueProducts: c.uniqueProducts,
      profitCenterFormat: c.profitCenterFormat,
      plants: c.plants,
      productTypes: Object.keys(c.byProductType || {}),
      productGroups: Object.keys(c.byProductGroup || {}).length,
    };
  }

  patternFor(productType?: string | null, productGroup?: string | null) {
    const c = this.load();
    if (!c) return null;
    const type = (productType || '').trim().toUpperCase();
    const group = (productGroup || '').trim().toUpperCase();
    return {
      type: type ? c.byProductType[type] || null : null,
      group: group ? c.byProductGroup[group] || null : null,
      plants: c.plants,
      storageLocationsByPlant: c.storageLocationsByPlant,
      profitCenterByPlant: c.profitCenterByPlant,
      profitCenterFormat: c.profitCenterFormat,
    };
  }

  allowedUoms(productType?: string | null, productGroup?: string | null): string[] {
    const p = this.patternFor(productType, productGroup);
    const fromGroup = p?.group?.uoms?.map((x) => toIsoUom(x.value) || x.value) || [];
    const fromType = p?.type?.uoms?.map((x) => toIsoUom(x.value) || x.value) || [];
    return Array.from(
      new Set(
        [...fromGroup, ...fromType]
          .map((u) => String(u || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }

  allowedPlants(): string[] {
    return this.load()?.plants || [];
  }

  allowedSlocsForPlant(plant: string): string[] {
    const c = this.load();
    if (!c) return [];
    return c.storageLocationsByPlant[plant] || [];
  }

  /**
   * Apply live-master patterns onto wizard defaults.
   * Group-level majority wins over type-level; source ERP values still win when valid.
   */
  applyToDefaults(answers: WizardAnswers): WizardAnswers {
    const c = this.load();
    if (!c) {
      return applyProductTypeStandards({
        ...answers,
        baseUom: toIsoUom(answers.baseUom) || answers.baseUom,
        weightUom: isServiceProduct(answers.productType) ? '' : WEIGHT_UOM_ISO,
      });
    }
    const type = (answers.productType || '').toUpperCase();
    const group = (answers.productGroup || '').toUpperCase();
    const t = c.byProductType[type];
    const g = c.byProductGroup[group];

    const next = { ...answers };
    const service = isServiceProduct(type);

    if (!next.baseUom) {
      next.baseUom =
        toIsoUom(g?.defaultUom || t?.defaultUom) || next.baseUom;
    } else {
      next.baseUom = toIsoUom(next.baseUom) || next.baseUom;
    }
    next.weightUom = service ? '' : WEIGHT_UOM_ISO;
    if (!next.hsnCode || next.hsnCode === '0000' || next.hsnCode === '0') {
      next.hsnCode = g?.defaultHsn || t?.hsn?.[0]?.value || next.hsnCode;
    }
    if (!service) {
      if (g?.defaultMrpType) next.mrpType = g.defaultMrpType as WizardAnswers['mrpType'];
      else if (t?.defaultMrpType && (t.defaultMrpType === 'PD' || t.defaultMrpType === 'ND')) {
        next.mrpType = t.defaultMrpType;
      }
      if (g?.defaultAvailCheck) next.availabilityCheck = g.defaultAvailCheck;
      else if (t?.defaultAvailCheck) next.availabilityCheck = t.defaultAvailCheck;
      if (g?.defaultProcurementType && ['E', 'F', 'X'].includes(g.defaultProcurementType)) {
        next.procurementType = g.defaultProcurementType as WizardAnswers['procurementType'];
      } else if (t?.defaultProcurementType && ['E', 'F', 'X'].includes(t.defaultProcurementType)) {
        next.procurementType = t.defaultProcurementType as WizardAnswers['procurementType'];
      }
      if (t?.defaultMrpController) next.mrpController = t.defaultMrpController;
      if (typeof t?.batchManaged === 'boolean') next.batchManaged = t.batchManaged;
    }

    const plants = plantsOf(next).filter((p) => c.plants.includes(p));
    const resolvedPlants = plants.length
      ? plants
      : [next.plant].filter((p) => c.plants.includes(String(p)));
    if (resolvedPlants.length) {
      next.plant = resolvedPlants[0];
      next.valuationAreas = resolvedPlants;
      // Wizard/export use {plant}01; SAP GUI stores 0000{plant}01 — both validate.
      next.profitCenter = `${resolvedPlants[0]}01`;
    }

    const slocs = (next.storageLocations || []).filter((s) => {
      const code = String(s || '').trim().toUpperCase();
      if (code === 'MXST') return true;
      return resolvedPlants.some((p) =>
        (c.storageLocationsByPlant[p] || []).includes(s),
      );
    });
    if (!service) {
      if (!slocs.length && resolvedPlants.length) {
        const typical =
          g?.typicalSlocs?.find((s) =>
            resolvedPlants.some((p) => (c.storageLocationsByPlant[p] || []).includes(s)),
          ) ||
          (c.storageLocationsByPlant[resolvedPlants[0]] || [])[0];
        next.storageLocations = typical ? [typical] : next.storageLocations;
      } else if (slocs.length) {
        next.storageLocations = slocs;
      }
    }

    return applyProductTypeStandards(next);
  }

  formatProfitCenter(plant: string, format?: string): string {
    const code = String(plant || '').trim();
    if (!code) return '';
    if ((format || this.load()?.profitCenterFormat) === '0000{plant}01') {
      return `0000${code}01`;
    }
    return `${code}01`;
  }

  validate(answers: WizardAnswers): { errors: string[]; warnings: string[] } {
    const c = this.load();
    if (!c) return { errors: [], warnings: [] };
    const errors: string[] = [];
    const warnings: string[] = [];
    const type = (answers.productType || '').toUpperCase();
    const group = (answers.productGroup || '').toUpperCase();
    const t = c.byProductType[type];
    const g = c.byProductGroup[group];
    const plants = plantsOf(answers);

    for (const plant of plants) {
      if (c.plants.length && !c.plants.includes(plant)) {
        errors.push(`Plant ${plant} is not used in the live Material Master`);
        continue;
      }
      const expected =
        `${plant}01`;
      const compact = (v: string) => v.replace(/^0+/, '') || '0';
      if (
        plants.length === 1 &&
        answers.profitCenter &&
        compact(answers.profitCenter) !== compact(expected) &&
        compact(answers.profitCenter) !== compact(`0000${plant}01`)
      ) {
        errors.push(
          `Profit Center for plant ${plant} should be ${expected} (Material Master uses ${c.profitCenterByPlant[plant] || expected})`,
        );
      }
      const allowedSlocs = c.storageLocationsByPlant[plant] || [];
      if (!isServiceProduct(type)) {
        for (const sloc of answers.storageLocations || []) {
          const code = String(sloc || '').trim().toUpperCase();
          if (code === 'MXST') continue;
          if (allowedSlocs.length && !allowedSlocs.includes(sloc)) {
            errors.push(
              `Storage Location ${sloc} is not valid for plant ${plant} in Material Master`,
            );
          }
        }
      }
    }

    const allowedUoms = this.allowedUoms(type, group);
    const baseIso = toIsoUom(answers.baseUom) || answers.baseUom?.toUpperCase();
    if (baseIso && allowedUoms.length && !allowedUoms.includes(baseIso)) {
      warnings.push(
        `Base UoM ${baseIso} is unusual for ${type || group || 'this material'} (typical: ${allowedUoms.slice(0, 5).join(', ')})`,
      );
    }

    if (g?.productType && type && g.productType !== type) {
      warnings.push(
        `Product Group ${group} is typically ${g.productType} in Material Master (selected ${type})`,
      );
    }

    if (g?.defaultHsn && answers.hsnCode && answers.hsnCode !== g.defaultHsn) {
      const groupHsns = (g.hsn || []).map((x) => x.value);
      if (groupHsns.length && !groupHsns.includes(answers.hsnCode)) {
        warnings.push(
          `HSN/Control Code ${answers.hsnCode} is not used with Product Group ${group} (typical: ${g.defaultHsn})`,
        );
      }
    }

    void t;
    return { errors, warnings };
  }
}
