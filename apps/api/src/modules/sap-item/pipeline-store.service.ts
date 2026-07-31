import * as fs from 'fs';
import * as path from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ExportRecord,
  SapPipelineEntry,
  SapPipelineStage,
  SapSourceItem,
  WizardAnswers,
} from '@kiswok/shared';
import { v4 as uuid } from 'uuid';

@Injectable()
export class PipelineStoreService {
  private dir(): string {
    const dir = path.resolve(process.cwd(), 'data', 'pipeline');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private file(id: string): string {
    return path.join(this.dir(), `${id}.json`);
  }

  list(stage?: SapPipelineStage): SapPipelineEntry[] {
    const dir = this.dir();
    const entries = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(dir, f);
        try {
          const raw = fs.readFileSync(full, 'utf8');
          return JSON.parse(raw) as SapPipelineEntry;
        } catch (err) {
          const ts = Date.now();
          const bad = `${full}.bad-${ts}`;
          try {
            fs.renameSync(full, bad);
          } catch {
            /* ignore */
          }
          // eslint-disable-next-line no-console
          console.warn(`[PipelineStoreService] Skipping corrupt JSON: ${f}`, err);
          return null;
        }
      })
      .filter((x): x is SapPipelineEntry => Boolean(x))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return stage ? entries.filter((e) => e.stage === stage) : entries;
  }

  get(id: string): SapPipelineEntry {
    const file = this.file(id);
    if (!fs.existsSync(file)) {
      throw new NotFoundException(`Pipeline entry ${id} not found`);
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as SapPipelineEntry;
    } catch (err) {
      const ts = Date.now();
      const bad = `${file}.bad-${ts}`;
      try {
        fs.renameSync(file, bad);
      } catch {
        /* ignore */
      }
      throw new NotFoundException(`Pipeline entry ${id} not found (corrupt JSON)`);
    }
  }

  getByRawMatId(rawMatId: number): SapPipelineEntry | null {
    return this.list().find((e) => e.rawMatId === rawMatId) || null;
  }

  save(entry: SapPipelineEntry): SapPipelineEntry {
    entry.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.file(entry.id), JSON.stringify(entry, null, 2));
    return entry;
  }

  create(input: {
    rawMatId: number;
    icsoftCode: string;
    rawMatName?: string | null;
    productGroup?: string | null;
    baseUom?: string | null;
    plant?: string | null;
    storageLocation?: string | null;
    locationId?: number | null;
    source?: SapSourceItem | null;
    stage?: SapPipelineStage;
  }): SapPipelineEntry {
    const existing = this.getByRawMatId(input.rawMatId);
    if (existing && existing.stage !== 'exported') {
      existing.icsoftCode = input.icsoftCode;
      existing.rawMatName = input.rawMatName ?? existing.rawMatName;
      existing.productGroup = input.productGroup ?? existing.productGroup;
      existing.baseUom = input.baseUom ?? existing.baseUom;
      existing.plant = input.plant ?? existing.plant;
      existing.storageLocation =
        input.storageLocation ?? existing.storageLocation;
      existing.locationId = input.locationId ?? existing.locationId;
      if (input.source) existing.source = input.source;
      if (existing.stage === 'pending') {
        return this.save(existing);
      }
      return existing;
    }

    const now = new Date().toISOString();
    const entry: SapPipelineEntry = {
      id: uuid(),
      rawMatId: input.rawMatId,
      icsoftCode: input.icsoftCode,
      rawMatName: input.rawMatName ?? null,
      productGroup: input.productGroup ?? null,
      baseUom: input.baseUom ?? null,
      plant: input.plant ?? null,
      storageLocation: input.storageLocation ?? null,
      locationId: input.locationId ?? null,
      stage: input.stage ?? 'pending',
      source: input.source ?? null,
      batchId: null,
      batchItemId: null,
      answers: null,
      sheetRows: null,
      sapItemCode: null,
      exportHistory: [],
      queuedAt: now,
      processedAt: null,
      exportedAt: null,
      updatedAt: now,
    };
    return this.save(entry);
  }

  markCommitted(
    rawMatId: number,
    payload: {
      batchId: string;
      batchItemId: string;
      source: SapSourceItem;
      answers: WizardAnswers;
      sheetRows: Record<string, Record<string, string>>;
    },
  ): SapPipelineEntry {
    let entry = this.getByRawMatId(rawMatId);
    const now = new Date().toISOString();
    if (!entry) {
      entry = this.create({
        rawMatId,
        icsoftCode: payload.source.IcsoftCode,
        rawMatName: payload.source.Rawmatname,
        productGroup: payload.source.ProductGroup,
        baseUom: payload.source.baseuom,
        plant: payload.source.sap_plantcode,
        storageLocation: payload.source.storage_location,
        locationId: payload.source.LocationID,
        source: payload.source,
        stage: 'committed',
      });
    }
    entry.stage = 'committed';
    entry.batchId = payload.batchId;
    entry.batchItemId = payload.batchItemId;
    entry.source = payload.source;
    entry.answers = payload.answers;
    entry.sheetRows = payload.sheetRows;
    entry.processedAt = now;
    return this.save(entry);
  }

  markExportedForBatch(
    batchId: string,
    record: ExportRecord,
  ): SapPipelineEntry[] {
    const updated: SapPipelineEntry[] = [];
    for (const entry of this.list()) {
      if (entry.batchId !== batchId || entry.stage === 'exported') continue;
      entry.stage = 'exported';
      entry.exportedAt = record.at;
      entry.exportHistory = [...(entry.exportHistory || []), record];
      updated.push(this.save(entry));
    }
    return updated;
  }

  updateSapItemCode(id: string, sapItemCode: string): SapPipelineEntry {
    const entry = this.get(id);
    entry.sapItemCode = sapItemCode.trim();
    return this.save(entry);
  }

  remove(id: string): void {
    const file = this.file(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  counts(): Record<SapPipelineStage, number> {
    const all = this.list();
    return {
      pending: all.filter((e) => e.stage === 'pending').length,
      committed: all.filter((e) => e.stage === 'committed').length,
      exported: all.filter((e) => e.stage === 'exported').length,
    };
  }
}
