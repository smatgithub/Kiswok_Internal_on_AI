import * as fs from 'fs';
import * as path from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BatchState, CommittedItem } from '@kiswok/shared';
import { v4 as uuid } from 'uuid';

@Injectable()
export class BatchStoreService {
  private dir(): string {
    const dir = path.resolve(process.cwd(), 'data', 'batches');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private file(id: string): string {
    return path.join(this.dir(), `${id}.json`);
  }

  create(name = 'SAP Item Batch'): BatchState {
    const now = new Date().toISOString();
    const batch: BatchState = {
      id: uuid(),
      name,
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    this.save(batch);
    return batch;
  }

  list(): BatchState[] {
    const dir = this.dir();
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(dir, f);
        try {
          const raw = fs.readFileSync(full, 'utf8');
          return JSON.parse(raw) as BatchState;
        } catch (err) {
          // Avoid crashing list endpoints due to a single corrupted file.
          const ts = Date.now();
          const bad = `${full}.bad-${ts}`;
          try {
            fs.renameSync(full, bad);
          } catch {
            /* ignore */
          }
          // eslint-disable-next-line no-console
          console.warn(`[BatchStoreService] Skipping corrupt JSON: ${f}`, err);
          return null;
        }
      })
      .filter((x): x is BatchState => Boolean(x))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): BatchState {
    const file = this.file(id);
    if (!fs.existsSync(file)) throw new NotFoundException(`Batch ${id} not found`);
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as BatchState;
    } catch (err) {
      // If a file is corrupted, make sure the error doesn't keep recurring.
      const ts = Date.now();
      const bad = `${file}.bad-${ts}`;
      try {
        fs.renameSync(file, bad);
      } catch {
        /* ignore */
      }
      throw new NotFoundException(`Batch ${id} not found (corrupt JSON)`);
    }
  }

  save(batch: BatchState): BatchState {
    batch.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.file(batch.id), JSON.stringify(batch, null, 2));
    return batch;
  }

  addItem(batchId: string, item: CommittedItem): BatchState {
    const batch = this.get(batchId);
    batch.items.push(item);
    return this.save(batch);
  }

  updateItem(batchId: string, itemId: string, patch: Partial<CommittedItem>): BatchState {
    const batch = this.get(batchId);
    const idx = batch.items.findIndex((i) => i.id === itemId);
    if (idx < 0) throw new NotFoundException(`Item ${itemId} not found`);
    batch.items[idx] = {
      ...batch.items[idx],
      ...patch,
      id: itemId,
      updatedAt: new Date().toISOString(),
    };
    return this.save(batch);
  }

  removeItem(batchId: string, itemId: string): BatchState {
    const batch = this.get(batchId);
    batch.items = batch.items.filter((i) => i.id !== itemId);
    return this.save(batch);
  }

  delete(batchId: string): void {
    const file = this.file(batchId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
