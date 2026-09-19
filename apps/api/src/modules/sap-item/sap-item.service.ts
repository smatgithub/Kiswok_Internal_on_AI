import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommittedItem,
  DuplicateCheckResult,
  DuplicateOverride,
  DUPLICATE_OVERRIDE_MIN_REASON,
  ExistingSapMaterial,
  ExportRecord,
  isServiceProduct,
  plantsForProductType,
  SapItemRequester,
  SapPipelineEntry,
  SapPipelineStage,
  SapSourceItem,
  WizardAnswers,
  WIZARD_STEPS,
} from '@kiswok/shared';
import { v4 as uuid } from 'uuid';
import * as sql from 'mssql';
import ExcelJS from 'exceljs';
import { DatabaseService } from '../../database/database.service';
import { BatchStoreService } from './batch-store.service';
import { GoldTemplateExporter } from './gold-template.exporter';
import { MaterialMasterPatternService } from './material-master-pattern.service';
import { DuplicateCheckService } from './duplicate-check.service';
import { PipelineStoreService } from './pipeline-store.service';
import { ReferenceCatalogService } from './reference-catalog.service';
import {
  applyKiswokExtensionPolicy,
  buildDefaultAnswers,
  buildSheetRows,
  validateAnswers,
  withSyncedProfitCenter,
  toIsoUom,
  withMxst,
} from './mapping.service';
import { mapSourceRow, SAP_CANDIDATE_SEARCH_SQL, SAP_EXTEND_BY_ID_SQL } from './queries';

const MOCK_ITEMS: SapSourceItem[] = [
  {
    IcsoftCode: 'CONGEDB0032',
    sap_item_code: null,
    sap_mat_grp_text: 'Consumable',
    grntype: 'Consumable',
    ProductGroup: 'Consumable',
    productType: 'ZCON',
    Rawmatname: 'DRILL BIT 10MM X 116 FLUTE LENGTH (T/S)',
    lang: 'EN',
    baseuom: 'EA',
    PurchaseUom: 'EA',
    LONG_TEXT: '',
    WeightUom: 'KGM',
    weight: 0,
    hsncode: '82075000',
    LocationID: 14,
    sap_plantcode: '2001',
    storage_location: 'WUNM',
    GrnTypeId: 1,
    RawMatID: 10001,
    profitcentercode: '200101',
  },
  {
    IcsoftCode: 'IRON0003',
    sap_item_code: null,
    sap_mat_grp_text: 'Iron',
    grntype: 'Rawmaterial',
    ProductGroup: 'IRON',
    productType: 'ZRAW',
    Rawmatname: 'STEEL SCRAP-C.I. (HIGH SULPHUR)',
    lang: 'EN',
    baseuom: 'KGM',
    PurchaseUom: 'KGM',
    LONG_TEXT: '',
    WeightUom: 'KGM',
    weight: 1,
    hsncode: '72044900',
    LocationID: 1,
    sap_plantcode: '20AA',
    storage_location: 'MXST',
    GrnTypeId: 2,
    RawMatID: 10002,
    profitcentercode: '20AA01',
  },
];

@Injectable()
export class SapItemService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly batches: BatchStoreService,
    private readonly pipeline: PipelineStoreService,
    private readonly exporter: GoldTemplateExporter,
    private readonly masterPatterns: MaterialMasterPatternService,
    private readonly referenceCatalog: ReferenceCatalogService,
    private readonly duplicates: DuplicateCheckService,
  ) {}

  private dbName(): string {
    return this.config.get<string>('DB_NAME') || 'icsoft';
  }

  private useMock(): boolean {
    return (
      this.config.get('USE_MOCK_ERP') === 'true' || !this.db.isConfigured()
    );
  }

  async searchItems(q = '', limit = 50): Promise<SapSourceItem[]> {
    if (this.useMock()) {
      const query = q.trim().toLowerCase();
      return MOCK_ITEMS.filter(
        (i) =>
          !query ||
          i.IcsoftCode.toLowerCase().includes(query) ||
          (i.Rawmatname || '').toLowerCase().includes(query) ||
          (i.ProductGroup || '').toLowerCase().includes(query),
      ).slice(0, limit);
    }

    try {
      const rows = await this.db.run(this.dbName(), async (request) => {
        request.input('q', sql.NVarChar(200), q.trim());
        request.input('limit', sql.Int, Math.min(Math.max(limit, 1), 200));
        return request.query(SAP_CANDIDATE_SEARCH_SQL);
      });
      return rows.map((r) => mapSourceRow(r as Record<string, unknown>));
    } catch (err) {
      throw new ServiceUnavailableException(
        `ERP query failed: ${(err as Error).message}`,
      );
    }
  }

  async getItem(rawMatId: number): Promise<SapSourceItem> {
    if (this.useMock()) {
      const m = MOCK_ITEMS.find((i) => i.RawMatID === rawMatId);
      if (m) return m;
      // Allow extend from IcSoft Items mock-style ids
      return {
        IcsoftCode: `EXT${rawMatId}`,
        sap_item_code: null,
        sap_mat_grp_text: null,
        grntype: null,
        ProductGroup: 'ZRAW',
        productType: 'ZRAW',
        Rawmatname: `Extended item ${rawMatId}`,
        lang: 'EN',
        baseuom: 'EA',
        PurchaseUom: 'EA',
        LONG_TEXT: '',
        WeightUom: 'KGM',
        weight: 0,
        hsncode: '',
        LocationID: 14,
        sap_plantcode: '2001',
        storage_location: 'WUNM',
        GrnTypeId: null,
        RawMatID: rawMatId,
        profitcentercode: '200101',
      };
    }

    try {
      const rows = await this.db.run(this.dbName(), async (request) => {
        request.input('rawMatId', sql.Int, rawMatId);
        return request.query(SAP_EXTEND_BY_ID_SQL);
      });
      if (rows.length) {
        return mapSourceRow(rows[0] as Record<string, unknown>);
      }
    } catch (err) {
      throw new ServiceUnavailableException(
        `Extend lookup failed: ${(err as Error).message}`,
      );
    }

    // Fallback: candidate search by id
    const items = await this.searchItems(String(rawMatId), 50);
    const found = items.find((i) => i.RawMatID === rawMatId);
    if (found) return found;

    throw new BadRequestException(`Item RawMatID ${rawMatId} not found`);
  }

  async startWizard(
    rawMatId?: number,
    overrides?: {
      plant?: string;
      storageLocation?: string;
      locationId?: number;
      pipelineEntryId?: string;
      plants?: string[];
      slocs?: string[];
    },
  ) {
    let source: SapSourceItem | null = null;
    let pipelineEntry = overrides?.pipelineEntryId
      ? this.pipeline.get(overrides.pipelineEntryId)
      : null;
    if (pipelineEntry) {
      source = pipelineEntry.source;
      if (rawMatId == null || !Number.isFinite(rawMatId)) {
        rawMatId = pipelineEntry.rawMatId;
      }
    }
    if (!source && rawMatId != null && Number.isFinite(rawMatId) && rawMatId < 0) {
      pipelineEntry = this.pipeline.getByRawMatId(rawMatId);
      source = pipelineEntry?.source ?? null;
    }
    if (!source) {
      if (rawMatId == null || !Number.isFinite(rawMatId)) {
        throw new BadRequestException('rawMatId or pipelineEntryId is required');
      }
      source = await this.getItem(rawMatId);
    }
    const selectedPlants = (overrides?.plants?.length
      ? overrides.plants
      : pipelineEntry?.plants || [])
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    const selectedSlocs = (overrides?.slocs?.length
      ? overrides.slocs
      : pipelineEntry?.slocs || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean);
    if (selectedPlants[0]) {
      source.sap_plantcode = selectedPlants[0];
      source.profitcentercode = `${selectedPlants[0]}01`;
    } else if (overrides?.plant) {
      source.sap_plantcode = overrides.plant;
      source.profitcentercode = `${overrides.plant}01`;
    }
    if (selectedSlocs[0]) {
      source.storage_location = selectedSlocs[0];
    } else if (overrides?.storageLocation) {
      source.storage_location = overrides.storageLocation;
    }
    if (overrides?.locationId != null && Number.isFinite(overrides.locationId)) {
      source.LocationID = overrides.locationId;
    } else if (pipelineEntry?.locationIds?.[0] != null) {
      source.LocationID = pipelineEntry.locationIds[0];
    }
    let defaults = applyKiswokExtensionPolicy(
      this.masterPatterns.applyToDefaults(
        withSyncedProfitCenter(buildDefaultAnswers(source)),
      ),
      source.IcsoftCode,
    );
    defaults = this.referenceCatalog.applyToAnswers(defaults);
    if (selectedPlants.length) {
      defaults = {
        ...defaults,
        plant: selectedPlants[0],
        valuationAreas: selectedPlants,
        profitCenter: `${selectedPlants[0]}01`,
      };
    }
    if (selectedSlocs.length && !isServiceProduct(defaults.productType)) {
      defaults = {
        ...defaults,
        storageLocations: withMxst(selectedSlocs),
      };
    }
    return {
      source,
      defaults,
      steps: WIZARD_STEPS,
      masterPattern: this.masterPatterns.patternFor(
        defaults.productType,
        defaults.productGroup,
      ),
    };
  }

  preview(source: SapSourceItem, answers: WizardAnswers) {
    const synced = this.referenceCatalog.applyToAnswers(
      applyKiswokExtensionPolicy(
        this.masterPatterns.applyToDefaults(withSyncedProfitCenter(answers)),
        source.IcsoftCode,
      ),
    );
    const patternCheck = this.masterPatterns.validate(synced);
    const errors = [
      ...validateAnswers(synced),
      ...patternCheck.errors,
      ...this.referenceCatalog.validate(synced),
    ];
    const sheetRows = buildSheetRows(synced);
    const already = this.detectAlreadyCreated({
      icsoftCode: source.IcsoftCode,
      rawMatName: source.Rawmatname,
      source,
      answers: synced,
    });
    const warnings = [...patternCheck.warnings];
    if (already) {
      warnings.unshift(
        `Already created in SAP as ${already.sapCode} — this item will be excluded from the create template. ${already.reason}`,
      );
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      source,
      answers: synced,
      sheetRows,
      preview: {
        productNumber: synced.productNumber,
        description: synced.description,
        plant: synced.plant,
        productGroup: synced.productGroup,
        baseUom: synced.baseUom,
        storageLocations: synced.storageLocations,
        valuationAreas: synced.valuationAreas,
      },
    };
  }

  commitItem(
    batchId: string,
    source: SapSourceItem,
    answers: WizardAnswers,
    copyFromItemId?: string,
    pipelineEntryId?: string,
    persistToBatch = true,
  ) {
    let finalAnswers = answers;
    if (copyFromItemId) {
      const batch = this.batches.get(batchId);
      const prev = batch.items.find((i) => i.id === copyFromItemId);
      if (prev) {
        finalAnswers = {
          ...prev.answers,
          ...answers,
          productNumber: answers.productNumber || prev.answers.productNumber,
          oldProductNumber: source.IcsoftCode,
          description: answers.description || source.Rawmatname || prev.answers.description,
        };
      }
    }
    finalAnswers = this.fillCommitAnswers(source, finalAnswers);
    finalAnswers = this.referenceCatalog.applyToAnswers(
      applyKiswokExtensionPolicy(
        this.masterPatterns.applyToDefaults(
          withSyncedProfitCenter(finalAnswers),
        ),
        source.IcsoftCode,
      ),
    );

    const patternCheck = this.masterPatterns.validate(finalAnswers);
    const errors = [
      ...validateAnswers(finalAnswers),
      ...patternCheck.errors,
      ...this.referenceCatalog.validate(finalAnswers),
    ];
    if (errors.length) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }

    const now = new Date().toISOString();
    const item: CommittedItem = {
      id: uuid(),
      status: 'committed',
      source,
      answers: finalAnswers,
      sheetRows: {},
      pipelineEntryId: pipelineEntryId || null,
      createdAt: now,
      updatedAt: now,
    };

    const batch = persistToBatch
      ? this.batches.addItem(batchId, item)
      : this.batches.get(batchId);

    this.pipeline.markCommitted(
      source.RawMatID,
      {
        batchId,
        batchItemId: item.id,
        source,
        answers: finalAnswers,
        sheetRows: {},
      },
      pipelineEntryId,
    );

    return { item, batch };
  }

  private fillCommitAnswers(
    source: SapSourceItem,
    answers: WizardAnswers,
  ): WizardAnswers {
    const description = String(
      answers.description || source.Rawmatname || '',
    )
      .trim()
      .slice(0, 40);
    const productGroup = String(
      answers.productGroup || source.ProductGroup || '',
    )
      .trim()
      .slice(0, 9);
    const baseUom =
      answers.baseUom ||
      toIsoUom(source.baseuom) ||
      source.baseuom ||
      'EA';
    return {
      ...answers,
      description,
      productGroup,
      productNumber:
        answers.productNumber ||
        source.sap_item_code ||
        source.IcsoftCode,
      oldProductNumber: answers.oldProductNumber || source.IcsoftCode,
      baseUom,
    };
  }

  async reviewDuplicates(input: {
    rawMatId?: number;
    rawMatIds?: number[];
    description?: string;
    rawMatCode?: string;
    hsn?: string;
    uom?: string;
    limit?: number;
  }): Promise<DuplicateCheckResult[]> {
    const ids = [
      ...new Set(
        [
          ...(input.rawMatIds || []),
          ...(input.rawMatId != null ? [input.rawMatId] : []),
        ].filter((id) => Number.isFinite(id)),
      ),
    ];

    if (ids.length) {
      const results: DuplicateCheckResult[] = [];
      for (const rawMatId of ids) {
        const source = await this.getItem(rawMatId);
        const description =
          String(source.Rawmatname || '').trim() ||
          String(source.LONG_TEXT || '').trim();
        results.push(
          this.duplicates.findSimilar({
            description,
            rawMatId,
            rawMatCode: source.IcsoftCode,
            hsn: source.hsncode,
            uom: source.baseuom,
            limit: input.limit,
          }),
        );
      }
      return results;
    }

    const description = String(input.description || '').trim();
    if (!description) {
      throw new BadRequestException('rawMatId or description is required');
    }
    return [
      this.duplicates.findSimilar({
        description,
        rawMatCode: input.rawMatCode,
        hsn: input.hsn,
        uom: input.uom,
        limit: input.limit,
      }),
    ];
  }

  async enqueuePipeline(
    rawMatIds: number[],
    hints?: Array<{
      rawMatId: number;
      plant?: string;
      storageLocation?: string;
      locationId?: number;
    }>,
    overrides?: Array<{ rawMatId: number; reason: string }>,
  ): Promise<SapPipelineEntry[]> {
    const hintMap = new Map((hints || []).map((h) => [h.rawMatId, h]));
    const overrideMap = new Map(
      (overrides || []).map((o) => [o.rawMatId, String(o.reason || '').trim()]),
    );
    const checks = await this.reviewDuplicates({ rawMatIds });
    const blocked = checks.filter((c) => c.verdict === 'duplicate');
    const unresolved = blocked.filter((c) => {
      const reason = overrideMap.get(c.query.rawMatId || -1) || '';
      return reason.length < DUPLICATE_OVERRIDE_MIN_REASON;
    });
    if (unresolved.length) {
      throw new ConflictException({
        message:
          'Possible duplicate SAP materials found. Confirm this is not a duplicate to continue.',
        code: 'DUPLICATE_MATERIAL',
        blocked: unresolved,
      });
    }

    const results: SapPipelineEntry[] = [];

    for (const rawMatId of rawMatIds) {
      const hint = hintMap.get(rawMatId);
      const source = await this.getItem(rawMatId);
      if (hint?.plant) {
        source.sap_plantcode = hint.plant;
        source.profitcentercode = `${hint.plant}01`;
      }
      if (hint?.storageLocation) {
        source.storage_location = hint.storageLocation;
      }
      if (hint?.locationId != null) {
        source.LocationID = hint.locationId;
      }
      const check = checks.find((c) => c.query.rawMatId === rawMatId);
      const reason = overrideMap.get(rawMatId) || '';
      const duplicateReview: DuplicateOverride | null =
        check?.verdict === 'duplicate'
          ? {
              rawMatId,
              reason,
              reviewedAt: new Date().toISOString(),
              matches: check.matches,
            }
          : null;
      results.push(
        this.pipeline.create({
          rawMatId,
          icsoftCode: source.IcsoftCode,
          rawMatName: source.Rawmatname,
          productType: source.productType,
          productGroup: source.ProductGroup,
          baseUom: toIsoUom(source.baseuom) || source.baseuom,
          plant: source.sap_plantcode,
          storageLocation: source.storage_location,
          locationId: source.LocationID,
          source,
          stage: 'pending',
          duplicateReview,
        }),
      );
    }
    return results;
  }

  async createManualItem(input: {
    requester: SapItemRequester;
    productType: string;
    description: string;
    productGroup: string;
    hsnCode: string;
    hsnOther?: boolean;
    baseUom: string;
    plants: string[];
    storageLocations?: string[] | null;
    locationIds?: number[] | null;
    proposedCode?: string | null;
    duplicateOverrideReason?: string | null;
  }): Promise<SapPipelineEntry> {
    const productType = String(input.productType || '')
      .trim()
      .toUpperCase();
    const description = String(input.description || '').trim();
    const productGroup = String(input.productGroup || '')
      .trim()
      .toUpperCase()
      .slice(0, 9);
    const hsnCode = String(input.hsnCode || '').replace(/\D/g, '');
    const hsnOther = Boolean(input.hsnOther);
    const baseUom = toIsoUom(input.baseUom) || String(input.baseUom || '').trim().toUpperCase();
    const service = isServiceProduct(productType);
    const allowedPlants = plantsForProductType(productType);
    const plants = [...new Set((input.plants || []).map((p) => String(p || '').trim()).filter(Boolean))];
    const slocs = service
      ? []
      : withMxst(input.storageLocations || ['MXST']);
    const locationIds = [...new Set((input.locationIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
    const requesterName = String(input.requester?.name || '').trim();
    const empCode = String(input.requester?.empCode || '').trim();
    const loginId = String(input.requester?.loginId || '').trim();
    const email = String(input.requester?.email || '').trim();
    const justification = String(input.requester?.justification || '').trim();
    const deptId =
      input.requester?.deptId != null && Number.isFinite(input.requester.deptId)
        ? Number(input.requester.deptId)
        : null;
    const locationId = locationIds[0] ?? (
      input.requester?.locationId != null && Number.isFinite(input.requester.locationId)
        ? Number(input.requester.locationId)
        : null
    );
    const plant = plants[0] || '';
    const storageLocation = slocs[0] || '';

    const missing: string[] = [];
    if (!requesterName) missing.push('Requester name');
    if (!empCode) missing.push('Employee code');
    if (!loginId) missing.push('Login ID');
    if (!email) missing.push('Email');
    if (deptId == null) missing.push('Department');
    if (!locationIds.length) missing.push('Location');
    if (justification.length < 8) missing.push('Business justification (min 8 characters)');
    if (!productType) missing.push('Material type');
    if (description.length < 8) missing.push('Item description (min 8 characters)');
    if (!productGroup) missing.push('Material group');
    if (!hsnCode) missing.push(service ? 'SAC' : 'HSN');
    if (!baseUom) missing.push('Base unit of measure');
    if (!plants.length) missing.push('Plant');
    if (!service && !slocs.length) missing.push('Storage location');
    if (missing.length) {
      throw new BadRequestException(`Mandatory fields missing: ${missing.join(', ')}`);
    }

    const invalidPlants = plants.filter((p) => !allowedPlants.includes(p));
    if (invalidPlants.length) {
      throw new BadRequestException(
        `Plant ${invalidPlants.join(', ')} is not valid for ${productType}. Allowed: ${allowedPlants.join(', ')}`,
      );
    }

    if (this.referenceCatalog.load().materialGroups.size && !this.referenceCatalog.hasMaterialGroup(productGroup)) {
      throw new BadRequestException(`Material group ${productGroup} is not in the shared master list`);
    }
    if (
      !hsnOther &&
      this.referenceCatalog.load().hsn.size &&
      !this.referenceCatalog.hasHsn(hsnCode)
    ) {
      throw new BadRequestException(`${service ? 'SAC' : 'HSN'} ${hsnCode} is not in the shared master list`);
    }

    const checks = await this.reviewDuplicates({
      description,
      hsn: hsnCode,
      uom: baseUom,
    });
    const blocked = checks.filter((c) => c.verdict === 'duplicate');
    const overrideReason = String(input.duplicateOverrideReason || justification).trim();
    if (blocked.length && overrideReason.length < DUPLICATE_OVERRIDE_MIN_REASON) {
      throw new ConflictException({
        message:
          'Possible duplicate SAP materials found. Confirm this is not a duplicate to continue.',
        code: 'DUPLICATE_MATERIAL',
        blocked,
      });
    }

    let rawMatId = -Date.now();
    while (this.pipeline.getByRawMatId(rawMatId)) {
      rawMatId -= 1;
    }

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const proposed = String(input.proposedCode || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 18);
    const icsoftCode = proposed || `NEW${day}${String(Math.abs(rawMatId)).slice(-4)}`.slice(0, 18);

    const source: SapSourceItem = {
      IcsoftCode: icsoftCode,
      sap_item_code: null,
      sap_mat_grp_text: productGroup,
      grntype: productType,
      ProductGroup: productGroup,
      productType,
      Rawmatname: description,
      lang: 'EN',
      baseuom: baseUom,
      PurchaseUom: baseUom,
      LONG_TEXT: justification,
      WeightUom: service ? '' : 'KGM',
      weight: null,
      hsncode: hsnCode,
      LocationID: locationId,
      sap_plantcode: plant,
      storage_location: storageLocation || null,
      GrnTypeId: null,
      RawMatID: rawMatId,
      profitcentercode: `${plant}01`,
    };

    const requestedBy: SapItemRequester = {
      name: requesterName,
      empCode,
      loginId,
      email,
      deptId,
      deptName: input.requester?.deptName || null,
      locationId,
      locationName: input.requester?.locationName || null,
      locationIds,
      locationNames: input.requester?.locationNames || [],
      justification,
    };

    return this.pipeline.create({
      rawMatId,
      icsoftCode,
      rawMatName: description,
      productType,
      productGroup,
      baseUom,
      plant,
      storageLocation: storageLocation || null,
      locationId,
      source,
      stage: 'pending',
      origin: 'manual',
      requestedBy,
      plants,
      slocs,
      locationIds,
      duplicateReview:
        blocked.length > 0
          ? {
              rawMatId,
              reason: overrideReason,
              reviewedAt: new Date().toISOString(),
              matches: blocked[0].matches,
            }
          : null,
    });
  }

  /**
   * Move pending pipeline entries to Ready for template (committed)
   * with Kiswok plant extension + MXST.
   */
  async commitPipelinePending(entryIds?: string[]) {
    this.masterPatterns.load();
    const wanted = new Set((entryIds || []).filter(Boolean));
    const all = this.pipeline.list();
    const pending = all
      .filter((e) => e.stage === 'pending')
      .filter((e) => !wanted.size || wanted.has(e.id));
    const before = {
      pending: all.filter((e) => e.stage === 'pending').length,
      committed: all.filter((e) => e.stage === 'committed').length,
      exported: all.filter((e) => e.stage === 'exported').length,
    };

    const batch = this.batches.create(
      `Ready for template ${new Date().toISOString().slice(0, 16)}`,
    );

    const committed: Array<{
      id: string;
      icsoftCode: string;
      productType: string;
      plants: string[];
      storageLocations: string[];
    }> = [];
    const failed: Array<{ id: string; icsoftCode: string; error: string }> = [];
    const batchItems: CommittedItem[] = [];

    for (let i = 0; i < pending.length; i += 1) {
      const entry = pending[i];
      try {
        let source = entry.source;
        if (!source) {
          source = await this.getItem(entry.rawMatId);
        }
        const answers = applyKiswokExtensionPolicy(
          this.masterPatterns.applyToDefaults(
            withSyncedProfitCenter(buildDefaultAnswers(source)),
          ),
          source.IcsoftCode,
        );
        const result = this.commitItem(
          batch.id,
          source,
          answers,
          undefined,
          entry.id,
          false,
        );
        batchItems.push(result.item);
        committed.push({
          id: entry.id,
          icsoftCode: entry.icsoftCode,
          productType: result.item.answers.productType,
          plants: result.item.answers.valuationAreas || [],
          storageLocations: result.item.answers.storageLocations || [],
        });
        if ((i + 1) % 25 === 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[commit-pending] ${i + 1}/${pending.length} (${committed.length} ok, ${failed.length} failed)`,
          );
        }
      } catch (err) {
        failed.push({
          id: entry.id,
          icsoftCode: entry.icsoftCode,
          error: this.commitErrorText(err),
        });
      }
    }

    this.batches.addItems(batch.id, batchItems);

    return {
      batchId: batch.id,
      requested: pending.length,
      committed: committed.length,
      failed,
      sample: committed.slice(0, 8),
      counts: {
        pending: before.pending - committed.length,
        committed: before.committed + committed.length,
        exported: before.exported,
      },
    };
  }

  private commitErrorText(err: unknown): string {
    if (err instanceof BadRequestException) {
      const response = err.getResponse();
      if (typeof response === 'object' && response && 'errors' in response) {
        const errors = (response as { errors?: unknown }).errors;
        if (Array.isArray(errors)) return errors.map(String).join('; ');
      }
      if (typeof response === 'string') return response;
      if (typeof response === 'object' && response && 'message' in response) {
        return String((response as { message: unknown }).message);
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  listPipeline(stage?: SapPipelineStage): SapPipelineEntry[] {
    return this.pipeline.list(stage).map((e) => {
      const alreadyInSap = this.detectAlreadyCreated(e);
      return {
        ...e,
        productType:
          e.productType ||
          e.answers?.productType ||
          e.source?.productType ||
          null,
        alreadyInSap,
      };
    });
  }

  /**
   * Exact already-created SAP material — must not appear in a create template.
   * Live sapcode on the IcSoft row, or exact product-number / description match
   * against the Material Master catalog.
   */
  detectAlreadyCreated(entry: {
    icsoftCode?: string | null;
    rawMatName?: string | null;
    source?: SapSourceItem | null;
    answers?: WizardAnswers | null;
    sapItemCode?: string | null;
  }): ExistingSapMaterial | null {
    const icsoft = String(
      entry.icsoftCode || entry.source?.IcsoftCode || '',
    ).trim();
    const liveCode = String(entry.source?.sap_item_code || '').trim();
    if (liveCode) {
      return {
        sapCode: liveCode,
        reason: `SAP material ${liveCode} is already created for ${icsoft || 'this IcSoft item'}`,
      };
    }

    const productNumber = String(entry.answers?.productNumber || '').trim();
    const description =
      entry.answers?.description ||
      entry.source?.Rawmatname ||
      entry.rawMatName ||
      '';

    const catalogHit = this.duplicates.findExactExisting({
      sapCode: productNumber,
      description,
      icsoftCode: icsoft,
    });
    if (catalogHit) return catalogHit;

    return null;
  }

  pipelineCounts(): Record<SapPipelineStage, number> {
    return this.pipeline.counts();
  }

  async updatePipelineSapCode(id: string, sapItemCode: string): Promise<SapPipelineEntry> {
    const entry = this.pipeline.updateSapItemCode(id, sapItemCode);
    if (entry.batchId && entry.batchItemId) {
      try {
        this.batches.updateItem(entry.batchId, entry.batchItemId, {
          sapItemCode,
        });
      } catch {
        /* batch item may have been removed */
      }
    }
    await this.upsertSapNewItemMaster(entry, sapItemCode);
    return entry;
  }

  /**
   * Persist SAP material into sap_new_item_master.
   * processid / deptid intentionally left NULL.
   */
  private async upsertSapNewItemMaster(
    entry: SapPipelineEntry,
    sapItemCode: string,
  ): Promise<void> {
    if (!this.db.isConfigured()) return;
    const db = this.db.defaultDatabase();
    const rawmatcode = (entry.icsoftCode || '').slice(0, 32);
    const name = (
      entry.rawMatName ||
      entry.answers?.description ||
      entry.icsoftCode ||
      ''
    ).slice(0, 50);
    const uom = (toIsoUom(entry.baseUom || entry.answers?.baseUom) || '').slice(
      0,
      3,
    );
    const matgroup = (entry.productGroup || entry.answers?.productGroup || '').slice(0, 9);
    const mattype = (entry.answers?.productType || 'ZRAW').slice(0, 4);
    const rawmatid = entry.rawMatId;

    try {
      await this.db.runWrite(db, async (request) => {
        request.input('rawmatid', sql.Int, rawmatid);
        request.input('rawmatcode', sql.VarChar(32), rawmatcode);
        request.input('sap_item_code', sql.VarChar(20), sapItemCode.slice(0, 20));
        request.input('sap_item_name', sql.VarChar(50), name);
        request.input('uom', sql.VarChar(3), uom || null);
        request.input('matgroup', sql.VarChar(9), matgroup || null);
        request.input('mattype', sql.VarChar(4), mattype || null);
        return request.query(`
          IF EXISTS (SELECT 1 FROM sap_new_item_master WHERE rawmatid = @rawmatid)
          BEGIN
            UPDATE sap_new_item_master
            SET
              rawmatcode = @rawmatcode,
              sap_item_code = @sap_item_code,
              sap_item_name = @sap_item_name,
              uom = @uom,
              matgroup = @matgroup,
              mattype = @mattype,
              processid = NULL,
              deptid = NULL
            WHERE rawmatid = @rawmatid;
          END
          ELSE
          BEGIN
            INSERT INTO sap_new_item_master
              (rawmatcode, sap_item_code, processid, deptid, rawmatid, sap_item_name, uom, matgroup, mattype)
            VALUES
              (@rawmatcode, @sap_item_code, NULL, NULL, @rawmatid, @sap_item_name, @uom, @matgroup, @mattype);
          END
        `);
      });
    } catch (err) {
      throw new BadRequestException(
        `SAP code saved in pipeline but sap_new_item_master write failed on ${this.db.writeServer()}: ${(err as Error).message}`,
      );
    }
  }

  removePipelineEntry(id: string): void {
    this.pipeline.remove(id);
  }

  /**
   * Export gold template for selected pipeline entries only (clean template + those rows).
   * format=xml → SAP Migration Cockpit SpreadsheetML
   * format=xlsx → Excel workbook with the same primary sheets/columns
   */
  async exportPipelineEntries(
    pipelineEntryIds: string[],
    regenerate = false,
    format: 'xml' | 'xlsx' = 'xml',
  ): Promise<{
    filename: string;
    buffer: Buffer;
    regenerated: boolean;
    exportRecord: ExportRecord;
    excluded: Array<{ icsoftCode: string; sapCode: string; reason: string }>;
  }> {
    const ids = [...new Set(pipelineEntryIds.filter(Boolean))];
    if (!ids.length) {
      throw new BadRequestException('Select at least one item to include in the template');
    }

    const entries = ids.map((id) => {
      let entry: SapPipelineEntry;
      try {
        entry = this.pipeline.get(id);
      } catch {
        throw new BadRequestException(`Pipeline entry not found: ${id}`);
      }
      if (!entry.answers && !entry.source) {
        throw new BadRequestException(
          `${entry.icsoftCode} has no saved wizard answers — process & commit before export`,
        );
      }
      return entry;
    });

    const classified = entries.map((entry) => ({
      entry,
      alreadyInSap: this.detectAlreadyCreated(entry),
    }));
    const excluded = classified.filter((c) => c.alreadyInSap);
    const includedEntries = classified.filter((c) => !c.alreadyInSap).map((c) => c.entry);

    if (!includedEntries.length) {
      const sample = excluded
        .slice(0, 8)
        .map(
          (c) =>
            `${c.entry.icsoftCode} → ${c.alreadyInSap?.sapCode}`,
        )
        .join('; ');
      throw new BadRequestException(
        `None of the selected items can go into the create template — they already exist in SAP. ${sample}`,
      );
    }

    const items: CommittedItem[] = includedEntries.map((entry) => {
      const source =
        entry.source ||
        ({
          IcsoftCode: entry.icsoftCode,
          sap_item_code: entry.sapItemCode,
          sap_mat_grp_text: null,
          grntype: null,
          ProductGroup: entry.productGroup,
          Rawmatname: entry.rawMatName,
          lang: 'EN',
          baseuom: toIsoUom(entry.baseUom) || entry.baseUom,
          PurchaseUom: toIsoUom(entry.baseUom) || entry.baseUom,
          LONG_TEXT: null,
          WeightUom: 'KGM',
          weight: null,
          hsncode: null,
          LocationID: entry.locationId,
          sap_plantcode: entry.plant,
          storage_location: entry.storageLocation,
          GrnTypeId: null,
          RawMatID: entry.rawMatId,
          profitcentercode: null,
        } as SapSourceItem);
      const answers: WizardAnswers = withSyncedProfitCenter({
        ...buildDefaultAnswers(source),
        ...(entry.answers || {}),
      });
      if (
        source.sap_item_code &&
        DuplicateCheckService.normalizeSapCode(answers.productNumber) ===
          DuplicateCheckService.normalizeSapCode(source.sap_item_code)
      ) {
        answers.productNumber = source.IcsoftCode || answers.productNumber;
      }
      // SAP MATKL max length 9 — trim long IcSoft group text
      if (answers.productGroup && answers.productGroup.length > 9) {
        answers.productGroup = answers.productGroup.slice(0, 9);
      }
      const sheetRowsMap = buildSheetRows(answers);
      const flat: Record<string, Record<string, string>> = {};
      for (const [sheet, rows] of Object.entries(sheetRowsMap)) {
        flat[sheet] = rows[0] || {};
      }
      return {
        id: entry.batchItemId || entry.id,
        status: 'committed' as const,
        source,
        answers,
        sheetRows: flat,
        pipelineEntryId: entry.id,
        sapItemCode: entry.sapItemCode,
        createdAt: entry.queuedAt,
        updatedAt: entry.updatedAt,
      };
    });

    const buffer =
      format === 'xlsx'
        ? await this.exporter.exportBatchXlsx(items)
        : this.exporter.exportBatch(items);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = format === 'xlsx' ? 'xlsx' : 'xml';
    const filename = `SAP_Product_ZRAW_sel${items.length}_${stamp}.${ext}`;
    const batchId = entries.find((e) => e.batchId)?.batchId || 'pipeline';

    const exportRecord: ExportRecord = {
      at: new Date().toISOString(),
      filename,
      batchId,
      itemCount: items.length,
      regenerated: regenerate,
    };

    for (const row of excluded) {
      row.entry.alreadyInSap = row.alreadyInSap || null;
      this.pipeline.save(row.entry);
    }

    for (const entry of includedEntries) {
      entry.stage = 'exported';
      entry.exportedAt = exportRecord.at;
      entry.exportHistory = [...(entry.exportHistory || []), exportRecord];
      entry.alreadyInSap = null;
      this.pipeline.save(entry);
      if (entry.batchId && entry.batchItemId) {
        try {
          const batch = this.batches.get(entry.batchId);
          const item = batch.items.find((i) => i.id === entry.batchItemId);
          this.batches.updateItem(entry.batchId, entry.batchItemId, {
            exportedAt: exportRecord.at,
            exportHistory: [...(item?.exportHistory || []), exportRecord],
            sapItemCode: entry.sapItemCode,
          });
        } catch {
          /* ignore */
        }
      }
    }

    return {
      filename,
      buffer,
      regenerated: regenerate,
      exportRecord,
      excluded: excluded.map((c) => ({
        icsoftCode: c.entry.icsoftCode,
        sapCode: c.alreadyInSap!.sapCode,
        reason: c.alreadyInSap!.reason,
      })),
    };
  }

  exportBatch(
    batchId: string,
    regenerate = false,
  ): { filename: string; buffer: Buffer; regenerated: boolean; exportRecord: ExportRecord } {
    const batch = this.batches.get(batchId);
    if (!batch.items.length) {
      throw new BadRequestException('Batch has no committed items');
    }

    const alreadyExported = Boolean(batch.exportedAt);
    const creatable = batch.items.filter(
      (item) =>
        !this.detectAlreadyCreated({
          icsoftCode: item.source?.IcsoftCode,
          rawMatName: item.source?.Rawmatname,
          source: item.source,
          answers: item.answers,
        }),
    );
    if (!creatable.length) {
      throw new BadRequestException(
        'None of the batch items can go into the create template — they already exist in SAP',
      );
    }
    const buffer = this.exporter.exportBatch(creatable);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `SAP_Product_ZRAW_${batch.id.slice(0, 8)}_${stamp}.xml`;

    const exportRecord: ExportRecord = {
      at: new Date().toISOString(),
      filename,
      batchId,
      itemCount: creatable.length,
      regenerated: regenerate || alreadyExported,
    };

    batch.exportedAt = exportRecord.at;
    batch.exportHistory = [...(batch.exportHistory || []), exportRecord];
    this.batches.save(batch);

    for (const item of batch.items) {
      this.batches.updateItem(batchId, item.id, {
        exportedAt: exportRecord.at,
        exportHistory: [...(item.exportHistory || []), exportRecord],
      });
    }

    this.pipeline.markExportedForBatch(batchId, exportRecord);

    return {
      filename,
      buffer,
      regenerated: exportRecord.regenerated ?? false,
      exportRecord,
    };
  }

  private async tryLookupRows(
    db: string,
    sqlText: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      return await this.db.run<Record<string, unknown>>(db, (r) => r.query(sqlText));
    } catch {
      return [];
    }
  }

  async lookups() {
    const db = this.db.isConfigured() ? this.db.defaultDatabase() : null;

    /** Full SAP material-type catalog (Migration Cockpit / MMKDS seed). */
    const PRODUCT_TYPE_CATALOG: Array<{ value: string; label: string }> = [
      { value: 'ZFGM', label: 'ZFGM - FINISHED GOODS' },
      { value: 'ZSFG', label: 'ZSFG - SEMI FINISHED GOODS' },
      { value: 'ZRAW', label: 'ZRAW - RAW MATERIAL' },
      { value: 'ZPKG', label: 'ZPKG - PACKAGING MATERIAL' },
      { value: 'ZSPT', label: 'ZSPT - SPARES' },
      { value: 'ZCON', label: 'ZCON - CONSUMABLES' },
      { value: 'ZSRV', label: 'ZSRV - SERVICES' },
      { value: 'ZSCP', label: 'ZSCP - SCRAP' },
      { value: 'ZCAP', label: 'ZCAP - FIXED ASSETS' },
      { value: 'ZPAT', label: 'ZPAT - PATTERN & COREBOX (PRODUCT)' },
      { value: 'ZEMP', label: 'ZEMP - EMPTIES (RETURNABLES)' },
      { value: 'ZBYP', label: 'ZBYP - BY-PRODUCT' },
      { value: 'ZCOP', label: 'ZCOP - CO-PRODUCTS (GENERAL)' },
      { value: 'ZFRT', label: 'ZFRT - FOUNDRY RETURN (CO-PROD)' },
      { value: 'ZBRG', label: 'ZBRG - BORING SCRAP (CO-PROD)' },
      { value: 'ZPRT', label: 'ZPRT - PRT ASSETS' },
      { value: 'ZPRA', label: 'ZPRA - PRT REGULAR' },
      { value: 'ZCMP', label: 'ZCMP - COMBINED PRODUCT' },
      { value: 'ZINP', label: 'ZINP - INTERNAL PRODUCT' },
    ];

    const byCode = new Map(PRODUCT_TYPE_CATALOG.map((p) => [p.value, p]));
    let distributionChannels: { value: string; label: string }[] = [];
    let plantsFromDb: { value: string; label: string }[] = [];
    let departments: Array<{ value: string; label: string }> = [];
    let locations: Array<{ value: string; label: string; plant?: string }> = [];
    let storageLocationRows: Array<{ value: string; label: string; plant?: string }> = [];
    let hsnFromDb: Array<{ value: string; label: string; kind?: string }> = [];
    let groupsFromDb: Array<{ value: string; label: string }> = [];

    if (db) {
      // Prefer MMKDS labels when the reference table exists
      try {
        const ptRows = await this.db.run<any>(db, (r) =>
          r.query(
            `SELECT MaterialTypeCode, Description FROM SAP_Product_Type_MMKDS WHERE Active = 'Y' ORDER BY Id`,
          ),
        );
        for (const row of ptRows) {
          const code = String(row.MaterialTypeCode || '')
            .trim()
            .toUpperCase();
          if (!code) continue;
          byCode.set(code, {
            value: code,
            label: `${code} - ${row.Description}`,
          });
        }
      } catch {
        /* table may not exist yet — catalog fallback remains */
      }

      // Ensure every mat_type used in live mapping is selectable
      try {
        const liveTypes = await this.db.run<any>(db, (r) =>
          r.query(`
            SELECT DISTINCT LTRIM(RTRIM(mat_type)) AS mat_type
            FROM sap_live_item_master
            WHERE NULLIF(LTRIM(RTRIM(mat_type)), '') IS NOT NULL
            ORDER BY LTRIM(RTRIM(mat_type))
          `),
        );
        for (const row of liveTypes) {
          const code = String(row.mat_type || '')
            .trim()
            .toUpperCase();
          if (!code || byCode.has(code)) continue;
          byCode.set(code, { value: code, label: code });
        }
      } catch {
        /* ignore */
      }

      try {
        const plantRows = await this.db.run<any>(db, (r) =>
          r.query(`
            SELECT DISTINCT LTRIM(RTRIM(sap_plantcode)) AS plant
            FROM sap_plant_location_mapping
            WHERE NULLIF(LTRIM(RTRIM(sap_plantcode)), '') IS NOT NULL
            ORDER BY LTRIM(RTRIM(sap_plantcode))
          `),
        );
        plantsFromDb = plantRows
          .map((r) => String(r.plant || '').trim())
          .filter(Boolean)
          .map((p) => ({ value: p, label: p }));
      } catch {
        /* ignore */
      }

      try {
        const dcRows = await this.db.run<any>(db, (r) =>
          r.query(
            `SELECT DistributionChannelCode, Description FROM SAP_Distribution_Channel_SDKDS WHERE Active = 'Y' ORDER BY Id`,
          ),
        );
        distributionChannels = dcRows.map((r) => ({
          value: r.DistributionChannelCode,
          label: `${r.DistributionChannelCode} - ${r.Description}`,
        }));
      } catch {
        /* table may not exist yet */
      }

      const deptSqls = [
        `SELECT DeptId AS id, LTRIM(RTRIM(DeptName)) AS name FROM Department WHERE NULLIF(LTRIM(RTRIM(DeptName)), '') IS NOT NULL ORDER BY DeptName`,
        `SELECT Dept_Id AS id, LTRIM(RTRIM(Dept_Name)) AS name FROM Department WHERE NULLIF(LTRIM(RTRIM(Dept_Name)), '') IS NOT NULL ORDER BY Dept_Name`,
        `SELECT DId AS id, LTRIM(RTRIM(Department)) AS name FROM M_Department WHERE NULLIF(LTRIM(RTRIM(Department)), '') IS NOT NULL ORDER BY Department`,
        `SELECT DeptId AS id, LTRIM(RTRIM(DeptName)) AS name FROM indb.dbo.Department WHERE NULLIF(LTRIM(RTRIM(DeptName)), '') IS NOT NULL ORDER BY DeptName`,
      ];
      for (const sqlText of deptSqls) {
        const rows = await this.tryLookupRows(db, sqlText);
        if (!rows.length) continue;
        departments = rows
          .map((r) => ({
            value: String(r.id ?? '').trim(),
            label: String(r.name || '').trim(),
          }))
          .filter((r) => r.value && r.label);
        const seen = new Set<string>();
        departments = departments.filter((d) => {
          const key = d.label.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (departments.length) break;
      }

      const locRows = await this.tryLookupRows(
        db,
        `SELECT
            c.CompanyID AS id,
            LTRIM(RTRIM(c.Location)) AS name,
            MAX(LTRIM(RTRIM(spl.sap_plantcode))) AS plant
          FROM Company c
          LEFT JOIN sap_plant_location_mapping spl ON spl.companyid = c.CompanyID
          WHERE NULLIF(LTRIM(RTRIM(c.Location)), '') IS NOT NULL
          GROUP BY c.CompanyID, LTRIM(RTRIM(c.Location))
          ORDER BY name`,
      );
      locations = locRows
        .map((r) => ({
          value: String(r.id ?? '').trim(),
          label: String(r.name || '').trim(),
          plant: String(r.plant || '').trim() || undefined,
        }))
        .filter((r) => r.value && r.label);

      const slocRows = await this.tryLookupRows(
        db,
        `SELECT DISTINCT
            LTRIM(RTRIM(plant_code)) AS plant,
            LTRIM(RTRIM(location_code)) AS code,
            LTRIM(RTRIM(location_name)) AS name
          FROM sap_storage_location
          WHERE NULLIF(LTRIM(RTRIM(location_code)), '') IS NOT NULL
          ORDER BY plant, code`,
      );
      storageLocationRows = slocRows
        .map((r) => {
          const code = String(r.code || '').trim().toUpperCase();
          const plant = String(r.plant || '').trim();
          const name = String(r.name || '').trim();
          return {
            value: code,
            label: name ? `${code} — ${name}` : code,
            plant: plant || undefined,
          };
        })
        .filter((r) => r.value);
      const seenSloc = new Set<string>();
      storageLocationRows = storageLocationRows.filter((s) => {
        if (seenSloc.has(s.value)) return false;
        seenSloc.add(s.value);
        return true;
      });

      const hsnRows = await this.tryLookupRows(
        db,
        `SELECT DISTINCT TOP 8000
            LTRIM(RTRIM(hsncode)) AS code
          FROM gst_hsn_sac_no
          WHERE NULLIF(LTRIM(RTRIM(hsncode)), '') IS NOT NULL
          ORDER BY code`,
      );
      hsnFromDb = hsnRows
        .map((r) => {
          const code = String(r.code || '').replace(/\D/g, '');
          return code
            ? { value: code, label: code, kind: code.length <= 6 ? 'SAC' : 'HSN' }
            : null;
        })
        .filter((r): r is { value: string; label: string; kind: string } => Boolean(r));
      const seenHsn = new Set<string>();
      hsnFromDb = hsnFromDb.filter((h) => {
        if (seenHsn.has(h.value)) return false;
        seenHsn.add(h.value);
        return true;
      });

      if (!hsnFromDb.length) {
        const liveHsn = await this.tryLookupRows(
          db,
          `SELECT DISTINCT TOP 8000 LTRIM(RTRIM(hsn)) AS code
           FROM sap_live_item_master
           WHERE NULLIF(LTRIM(RTRIM(hsn)), '') IS NOT NULL
           ORDER BY code`,
        );
        hsnFromDb = liveHsn
          .map((r) => {
            const code = String(r.code || '').replace(/\D/g, '');
            return code ? { value: code, label: code, kind: 'HSN' } : null;
          })
          .filter((r): r is { value: string; label: string; kind: string } => Boolean(r));
      }

      const grpRows = await this.tryLookupRows(
        db,
        `SELECT DISTINCT
            LTRIM(RTRIM(sap_mat_grp_code)) AS code,
            LTRIM(RTRIM(sap_mat_grp_text)) AS description
          FROM sap_material_group
          WHERE NULLIF(LTRIM(RTRIM(sap_mat_grp_code)), '') IS NOT NULL
          ORDER BY code`,
      );
      groupsFromDb = grpRows
        .map((r) => {
          const code = String(r.code || '').trim().toUpperCase();
          const description = String(r.description || '').trim();
          return code
            ? { value: code, label: description ? `${code} — ${description}` : code }
            : null;
        })
        .filter((r): r is { value: string; label: string } => Boolean(r));
      const seenGroup = new Set<string>();
      groupsFromDb = groupsFromDb.filter((g) => {
        if (seenGroup.has(g.value)) return false;
        seenGroup.add(g.value);
        return true;
      });
    }

    // Catalog order first, then any extra live-only codes
    const productTypes = [
      ...PRODUCT_TYPE_CATALOG.map((p) => byCode.get(p.value)!),
      ...[...byCode.values()].filter(
        (p) => !PRODUCT_TYPE_CATALOG.some((c) => c.value === p.value),
      ),
    ];

    if (!distributionChannels.length) {
      distributionChannels = [
        { value: 'ST', label: 'ST - Stock Transfer Order/Subcon' },
        { value: 'DS', label: 'DS - Domestic Sales' },
        { value: 'ES', label: 'ES - Export Sales' },
        { value: 'SS', label: 'SS - Service Sale' },
        { value: 'FC', label: 'FC - Domestic FOC' },
        { value: 'EF', label: 'EF - Export FOC' },
        { value: 'TP', label: 'TP - Third-Party Sales' },
        { value: 'JW', label: 'JW - Job Work Sales' },
        { value: 'AS', label: 'AS - Asset Sales' },
        { value: 'SR', label: 'SR - Scrap Sales' },
      ];
    }

    const plants = plantsFromDb.length
      ? plantsFromDb
      : [
          { value: '1001', label: '1001' },
          { value: '2001', label: '2001' },
          { value: '2002', label: '2002' },
          { value: '2003', label: '2003' },
          { value: '2004', label: '2004' },
          { value: '2005', label: '2005' },
          { value: '2006', label: '2006' },
          { value: '3001', label: '3001' },
          { value: '3002', label: '3002' },
          { value: '3003', label: '3003' },
        ];
    const defaultSlocs = [
      'MXST','SH01','SH02','SH03','VNRT','RGOL','RGNW','NMST','SUBC','WUNM',
      'RWDP','FCDP','GRDP','CNCD','DN2D','CSPN','CSHT','MLTG','DISA','HFMM',
      'JOLT','SNTM','SNDP','DSND','SSND','SBDP','LBDP','WUN6',
    ];
    const ref = this.referenceCatalog.summary();
    const catalogGroups = this.referenceCatalog.listMaterialGroups().map((g) => ({
      value: g.code,
      label: g.description ? `${g.code} — ${g.description}` : g.code,
    }));
    const catalogHsn = this.referenceCatalog.listHsn().map((h) => ({
      value: h.code,
      label: h.description ? `${h.code} — ${h.description}` : h.code,
      kind: h.kind || 'HSN',
    }));
    const materialGroups = catalogGroups.length ? catalogGroups : groupsFromDb;
    const hsnCodes = catalogHsn.length ? catalogHsn : hsnFromDb;
    const slocCodes = storageLocationRows.length
      ? [...new Set(storageLocationRows.map((s) => s.value))]
      : defaultSlocs;

    return {
      productTypes,
      distributionChannels,
      mrpTypes: [
        { value: 'PD', label: 'PD - MRP' },
        { value: 'ND', label: 'ND - No MRP' },
      ],
      procurementTypes: [
        { value: 'E', label: 'E - In-house' },
        { value: 'F', label: 'F - External' },
        { value: 'X', label: 'X - Both' },
      ],
      plants,
      storageLocations: slocCodes,
      storageLocationOptions: storageLocationRows.length
        ? storageLocationRows
        : defaultSlocs.map((s) => ({ value: s, label: s })),
      storageLocationsByPlant: {},
      materialGroups,
      hsnCodes,
      departments,
      locations,
      masters: {
        ...ref,
        hsnCodes: hsnCodes.length,
        materialGroups: materialGroups.length,
      },
      masterPattern: { loaded: false },
      uoms: [
        { value: 'EA', label: 'EA — Each' },
        { value: 'KGM', label: 'KGM — Kilogram' },
        { value: 'MTR', label: 'MTR — Metre' },
        { value: 'LTR', label: 'LTR — Litre' },
        { value: 'SET', label: 'SET — Set' },
        { value: 'BOX', label: 'BOX — Box' },
        { value: 'MTK', label: 'MTK — Square metre' },
        { value: 'MMT', label: 'MMT — Millimetre' },
        { value: 'TON', label: 'TON — Tonne' },
        { value: 'HR', label: 'HR — Hour' },
        { value: 'DAY', label: 'DAY — Day' },
        { value: 'MON', label: 'MON — Month' },
        { value: 'AU', label: 'AU — Activity unit' },
      ],
    };
  }

  masterPatternSummary() {
    return this.masterPatterns.summary();
  }

  async runMigration() {
    if (!this.db.isConfigured()) {
      throw new ServiceUnavailableException('Database not configured');
    }
    const db = this.db.defaultDatabase();
    const fs = await import('fs/promises');
    const path = await import('path');
    const sqlFile = path.join(__dirname, '..', '..', '..', 'migrations', '001_sap_product_type_and_dist_channel.sql');
    const script = await fs.readFile(sqlFile, 'utf-8');
    const pool = await this.db.getPool(db);
    const result = await pool.request().batch(script);
    return { message: 'Migration executed', rowsAffected: result.rowsAffected };
  }

  updateCommittedAnswers(
    batchId: string,
    itemId: string,
    answers: WizardAnswers,
  ) {
    const synced = this.referenceCatalog.applyToAnswers(
      applyKiswokExtensionPolicy(
        this.masterPatterns.applyToDefaults(withSyncedProfitCenter(answers)),
      ),
    );
    const patternCheck = this.masterPatterns.validate(synced);
    const errors = [
      ...validateAnswers(synced),
      ...patternCheck.errors,
      ...this.referenceCatalog.validate(synced),
    ];
    if (errors.length) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors,
        warnings: patternCheck.warnings,
      });
    }
    const sheetRowsMap = buildSheetRows(synced);
    const flat: Record<string, Record<string, string>> = {};
    for (const [sheet, rows] of Object.entries(sheetRowsMap)) {
      flat[sheet] = rows[0] || {};
    }
    return this.batches.updateItem(batchId, itemId, {
      answers: synced,
      sheetRows: flat,
    });
  }

  /**
   * Excel template for bulk SAP item code entry (Template created bucket).
   * Fill column "SAP Item Code"; leave blank to skip that row on upload.
   */
  async buildSapCodeUploadTemplate(): Promise<{ filename: string; buffer: Buffer }> {
    const entries = this.pipeline
      .list('exported')
      .sort((a, b) => a.icsoftCode.localeCompare(b.icsoftCode));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Kiswok SAP Item Studio';
    const sheet = workbook.addWorksheet('SAP Item Codes');
    sheet.columns = [
      { header: 'IcSoft Code', key: 'icsoftCode', width: 18 },
      { header: 'RawMatID', key: 'rawMatId', width: 12 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Plant', key: 'plant', width: 10 },
      { header: 'Current SAP Item Code', key: 'currentSapItemCode', width: 22 },
      { header: 'SAP Item Code', key: 'sapItemCode', width: 18 },
    ];
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.commit();

    for (const entry of entries) {
      sheet.addRow({
        icsoftCode: entry.icsoftCode,
        rawMatId: entry.rawMatId,
        description: entry.rawMatName || '',
        plant: entry.plant || '',
        currentSapItemCode: entry.sapItemCode || '',
        sapItemCode: '',
      });
    }

    const instructions = workbook.addWorksheet('Instructions');
    instructions.getColumn(1).width = 90;
    const lines = [
      'Bulk SAP Item Code upload',
      '',
      '1. Fill "SAP Item Code" for rows that do not yet have a code.',
      '2. Leave "SAP Item Code" blank to skip that row.',
      '3. Rows that already have a Current SAP Item Code are skipped on upload (use Update in the UI to correct).',
      '4. If the upload provides a different code than Current, it is reported as a mismatch in the summary (not overwritten).',
      '5. Match key: RawMatID first, then IcSoft Code. Only Template created (exported) items are updated.',
      '6. Upload this workbook via Template created → Upload SAP codes.',
    ];
    lines.forEach((text, i) => {
      instructions.getCell(i + 1, 1).value = text;
    });

    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `SAP_Item_Codes_Upload_${stamp}.xlsx`,
      buffer: buf,
    };
  }

  /**
   * Bulk apply SAP codes from upload template.
   * - Blank existing + filled upload → update
   * - Existing code present → skip (mismatches listed when upload differs)
   * - Blank upload cell → skip
   */
  async bulkUpdateSapCodesFromExcel(buffer: Buffer): Promise<BulkSapCodeResult> {
    const workbook = new ExcelJS.Workbook();
    // exceljs Buffer typing conflicts with Node 22 Buffer generics
    await workbook.xlsx.load(buffer as never);

    const sheet =
      workbook.getWorksheet('SAP Item Codes') ||
      workbook.worksheets.find((ws) => ws.name.toLowerCase() !== 'instructions') ||
      workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Workbook has no worksheets');
    }

    const headerRow = sheet.getRow(1);
    const colIndex: Record<string, number> = {};
    headerRow.eachCell((cell, colNumber) => {
      const key = String(cell.value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (key) colIndex[key] = colNumber;
    });

    const colIcsoft =
      colIndex['icsoft code'] || colIndex['icsoftcode'] || colIndex['icsoft'];
    const colRawMat =
      colIndex['rawmatid'] || colIndex['raw mat id'] || colIndex['rawmat id'];
    const colSap =
      colIndex['sap item code'] ||
      colIndex['sapitemcode'] ||
      colIndex['new sap item code'];

    if (!colSap || (!colIcsoft && !colRawMat)) {
      throw new BadRequestException(
        'Template must include "SAP Item Code" and either "IcSoft Code" or "RawMatID"',
      );
    }

    const exported = this.pipeline.list('exported');
    const byRawMat = new Map(exported.map((e) => [e.rawMatId, e]));
    const byIcsoft = new Map(
      exported.map((e) => [e.icsoftCode.trim().toUpperCase(), e]),
    );

    const result: BulkSapCodeResult = {
      updated: [],
      skippedExisting: [],
      mismatches: [],
      skippedBlank: [],
      skippedUnchanged: [],
      notFound: [],
      totals: {
        rowsRead: 0,
        updated: 0,
        skippedExisting: 0,
        mismatches: 0,
        skippedBlank: 0,
        skippedUnchanged: 0,
        notFound: 0,
      },
    };

    const cellText = (row: ExcelJS.Row, col?: number): string => {
      if (!col) return '';
      const v = row.getCell(col).value;
      if (v == null) return '';
      if (typeof v === 'object' && 'text' in v && typeof (v as { text: unknown }).text === 'string') {
        return String((v as { text: string }).text).trim();
      }
      if (typeof v === 'object' && 'result' in v) {
        return String((v as { result: unknown }).result ?? '').trim();
      }
      return String(v).trim();
    };

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const icsoftCode = cellText(row, colIcsoft);
      const rawMatRaw = cellText(row, colRawMat);
      const sapItemCode = cellText(row, colSap);
      if (!icsoftCode && !rawMatRaw && !sapItemCode) continue;

      result.totals.rowsRead += 1;

      let entry: SapPipelineEntry | undefined;
      const rawMatId = rawMatRaw ? Number(rawMatRaw) : NaN;
      if (Number.isFinite(rawMatId)) {
        entry = byRawMat.get(rawMatId);
      }
      if (!entry && icsoftCode) {
        entry = byIcsoft.get(icsoftCode.toUpperCase());
      }

      if (!entry) {
        result.notFound.push({
          icsoftCode: icsoftCode || null,
          rawMatId: Number.isFinite(rawMatId) ? rawMatId : null,
          sapItemCode: sapItemCode || null,
        });
        result.totals.notFound += 1;
        continue;
      }

      if (!sapItemCode) {
        result.skippedBlank.push({
          icsoftCode: entry.icsoftCode,
          rawMatId: entry.rawMatId,
        });
        result.totals.skippedBlank += 1;
        continue;
      }

      const existing = (entry.sapItemCode || '').trim();
      if (existing) {
        if (existing === sapItemCode) {
          result.skippedUnchanged.push({
            icsoftCode: entry.icsoftCode,
            rawMatId: entry.rawMatId,
            sapItemCode: existing,
          });
          result.totals.skippedUnchanged += 1;
        } else {
          result.mismatches.push({
            icsoftCode: entry.icsoftCode,
            rawMatId: entry.rawMatId,
            oldSapItemCode: existing,
            newSapItemCode: sapItemCode,
          });
          result.totals.mismatches += 1;
          result.skippedExisting.push({
            icsoftCode: entry.icsoftCode,
            rawMatId: entry.rawMatId,
            existingSapItemCode: existing,
            uploadedSapItemCode: sapItemCode,
          });
          result.totals.skippedExisting += 1;
        }
        continue;
      }

      await this.updatePipelineSapCode(entry.id, sapItemCode);
      result.updated.push({
        icsoftCode: entry.icsoftCode,
        rawMatId: entry.rawMatId,
        sapItemCode,
      });
      result.totals.updated += 1;
    }

    return result;
  }
}

export type BulkSapCodeResult = {
  updated: Array<{ icsoftCode: string; rawMatId: number; sapItemCode: string }>;
  skippedExisting: Array<{
    icsoftCode: string;
    rawMatId: number;
    existingSapItemCode: string;
    uploadedSapItemCode: string;
  }>;
  mismatches: Array<{
    icsoftCode: string;
    rawMatId: number;
    oldSapItemCode: string;
    newSapItemCode: string;
  }>;
  skippedBlank: Array<{ icsoftCode: string; rawMatId: number }>;
  skippedUnchanged: Array<{
    icsoftCode: string;
    rawMatId: number;
    sapItemCode: string;
  }>;
  notFound: Array<{
    icsoftCode: string | null;
    rawMatId: number | null;
    sapItemCode: string | null;
  }>;
  totals: {
    rowsRead: number;
    updated: number;
    skippedExisting: number;
    mismatches: number;
    skippedBlank: number;
    skippedUnchanged: number;
    notFound: number;
  };
};
