import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommittedItem,
  ExportRecord,
  SapPipelineEntry,
  SapPipelineStage,
  SapSourceItem,
  WizardAnswers,
  WIZARD_STEPS,
} from '@kiswok/shared';
import { v4 as uuid } from 'uuid';
import * as sql from 'mssql';
import { DatabaseService } from '../../database/database.service';
import { BatchStoreService } from './batch-store.service';
import { GoldTemplateExporter } from './gold-template.exporter';
import { PipelineStoreService } from './pipeline-store.service';
import {
  buildDefaultAnswers,
  buildSheetRows,
  validateAnswers,
} from './mapping.service';
import { mapSourceRow, SAP_CANDIDATE_SEARCH_SQL, SAP_EXTEND_BY_ID_SQL } from './queries';

const MOCK_ITEMS: SapSourceItem[] = [
  {
    IcsoftCode: 'CONGEDB0032',
    sap_item_code: null,
    sap_mat_grp_text: 'Consumable',
    grntype: 'Consumable',
    ProductGroup: 'Consumable',
    Rawmatname: 'DRILL BIT 10MM X 116 FLUTE LENGTH (T/S)',
    lang: 'EN',
    baseuom: 'EA',
    PurchaseUom: 'EA',
    LONG_TEXT: '',
    WeightUom: '',
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
        Rawmatname: `Extended item ${rawMatId}`,
        lang: 'EN',
        baseuom: 'EA',
        PurchaseUom: 'EA',
        LONG_TEXT: '',
        WeightUom: '',
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
    rawMatId: number,
    overrides?: {
      plant?: string;
      storageLocation?: string;
      locationId?: number;
    },
  ) {
    const source = await this.getItem(rawMatId);
    if (overrides?.plant) {
      source.sap_plantcode = overrides.plant;
      source.profitcentercode = `${overrides.plant}01`;
    }
    if (overrides?.storageLocation) {
      source.storage_location = overrides.storageLocation;
    }
    if (overrides?.locationId != null && Number.isFinite(overrides.locationId)) {
      source.LocationID = overrides.locationId;
    }
    const defaults = buildDefaultAnswers(source);
    if (overrides?.plant) {
      defaults.plant = overrides.plant;
      defaults.valuationAreas = [overrides.plant];
      defaults.profitCenter = `${overrides.plant}01`;
    }
    if (overrides?.storageLocation) {
      defaults.storageLocations = [overrides.storageLocation];
    }
    return {
      source,
      defaults,
      steps: WIZARD_STEPS,
    };
  }

  preview(source: SapSourceItem, answers: WizardAnswers) {
    const errors = validateAnswers(answers);
    const sheetRows = buildSheetRows(answers);
    return {
      valid: errors.length === 0,
      errors,
      source,
      answers,
      sheetRows,
      preview: {
        productNumber: answers.productNumber,
        description: answers.description,
        plant: answers.plant,
        productGroup: answers.productGroup,
        baseUom: answers.baseUom,
        storageLocations: answers.storageLocations,
        valuationAreas: answers.valuationAreas,
      },
    };
  }

  commitItem(
    batchId: string,
    source: SapSourceItem,
    answers: WizardAnswers,
    copyFromItemId?: string,
    pipelineEntryId?: string,
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

    const errors = validateAnswers(finalAnswers);
    if (errors.length) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }

    const now = new Date().toISOString();
    const sheetRowsMap = buildSheetRows(finalAnswers);
    const flat: Record<string, Record<string, string>> = {};
    for (const [sheet, rows] of Object.entries(sheetRowsMap)) {
      flat[sheet] = rows[0] || {};
    }

    const item: CommittedItem = {
      id: uuid(),
      status: 'committed',
      source,
      answers: finalAnswers,
      sheetRows: flat,
      pipelineEntryId: pipelineEntryId || null,
      createdAt: now,
      updatedAt: now,
    };

    const batch = this.batches.addItem(batchId, item);

    this.pipeline.markCommitted(source.RawMatID, {
      batchId,
      batchItemId: item.id,
      source,
      answers: finalAnswers,
      sheetRows: flat,
    });

    return { item, batch };
  }

  async enqueuePipeline(
    rawMatIds: number[],
    hints?: Array<{
      rawMatId: number;
      plant?: string;
      storageLocation?: string;
      locationId?: number;
    }>,
  ): Promise<SapPipelineEntry[]> {
    const hintMap = new Map((hints || []).map((h) => [h.rawMatId, h]));
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
      results.push(
        this.pipeline.create({
          rawMatId,
          icsoftCode: source.IcsoftCode,
          rawMatName: source.Rawmatname,
          productGroup: source.ProductGroup,
          baseUom: source.baseuom,
          plant: source.sap_plantcode,
          storageLocation: source.storage_location,
          locationId: source.LocationID,
          source,
          stage: 'pending',
        }),
      );
    }
    return results;
  }

  listPipeline(stage?: SapPipelineStage): SapPipelineEntry[] {
    return this.pipeline.list(stage);
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
    const uom = (entry.baseUom || entry.answers?.baseUom || '').slice(0, 3);
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

    const items: CommittedItem[] = entries.map((entry) => {
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
          baseuom: entry.baseUom,
          PurchaseUom: entry.baseUom,
          LONG_TEXT: null,
          WeightUom: null,
          weight: null,
          hsncode: null,
          LocationID: entry.locationId,
          sap_plantcode: entry.plant,
          storage_location: entry.storageLocation,
          GrnTypeId: null,
          RawMatID: entry.rawMatId,
          profitcentercode: null,
        } as SapSourceItem);
      const answers: WizardAnswers = {
        ...buildDefaultAnswers(source),
        ...(entry.answers || {}),
      };
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

    for (const entry of entries) {
      entry.stage = 'exported';
      entry.exportedAt = exportRecord.at;
      entry.exportHistory = [...(entry.exportHistory || []), exportRecord];
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
    const buffer = this.exporter.exportBatch(batch.items);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `SAP_Product_ZRAW_${batch.id.slice(0, 8)}_${stamp}.xml`;

    const exportRecord: ExportRecord = {
      at: new Date().toISOString(),
      filename,
      batchId,
      itemCount: batch.items.length,
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

  async lookups() {
    const db = this.db.isConfigured() ? this.db.defaultDatabase() : null;

    let productTypes: { value: string; label: string }[] = [];
    let distributionChannels: { value: string; label: string }[] = [];

    if (db) {
      try {
        const ptRows = await this.db.run<any>(db, (r) =>
          r.query(`SELECT MaterialTypeCode, Description FROM SAP_Product_Type_MMKDS WHERE Active = 'Y' ORDER BY Id`),
        );
        productTypes = ptRows.map((r) => ({
          value: r.MaterialTypeCode,
          label: `${r.MaterialTypeCode} - ${r.Description}`,
        }));
      } catch { /* table may not exist yet */ }

      try {
        const dcRows = await this.db.run<any>(db, (r) =>
          r.query(`SELECT DistributionChannelCode, Description FROM SAP_Distribution_Channel_SDKDS WHERE Active = 'Y' ORDER BY Id`),
        );
        distributionChannels = dcRows.map((r) => ({
          value: r.DistributionChannelCode,
          label: `${r.DistributionChannelCode} - ${r.Description}`,
        }));
      } catch { /* table may not exist yet */ }
    }

    if (!productTypes.length) {
      productTypes = [
        { value: 'ZRAW', label: 'ZRAW - RAW MATERIAL' },
        { value: 'ZFGM', label: 'ZFGM - FINISHED GOODS' },
        { value: 'ZSFG', label: 'ZSFG - SEMI FINISHED GOODS' },
      ];
    }
    if (!distributionChannels.length) {
      distributionChannels = [
        { value: 'ST', label: 'ST - Stock Transfer Order/Subcon' },
        { value: 'DS', label: 'DS - Domestic Sales' },
      ];
    }

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
      plants: [
        { value: '2001', label: '2001' },
        { value: '20AA', label: '20AA' },
        { value: '3001', label: '3001' },
      ],
      storageLocations: [
        'MXST','SH01','SH02','SH03','VNRT','RGOL','RGNW','NMST','SUBC','WUNM',
        'RWDP','FCDP','GRDP','CNCD','DN2D','CSPN','CSHT','MLTG','DISA','HFMM',
        'JOLT','SNTM','SNDP','DSND','SSND','SBDP','LBDP','WUN6',
      ],
    };
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
    const errors = validateAnswers(answers);
    if (errors.length) {
      throw new BadRequestException({ message: 'Validation failed', errors });
    }
    const sheetRowsMap = buildSheetRows(answers);
    const flat: Record<string, Record<string, string>> = {};
    for (const [sheet, rows] of Object.entries(sheetRowsMap)) {
      flat[sheet] = rows[0] || {};
    }
    return this.batches.updateItem(batchId, itemId, {
      answers,
      sheetRows: flat,
    });
  }
}
