import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { SapSourceItem, WizardAnswers } from '@kiswok/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BatchStoreService } from './batch-store.service';
import { SapItemService } from './sap-item.service';

class WizardStartDto {
  @Type(() => Number)
  @IsNumber()
  rawMatId!: number;

  @IsOptional()
  @IsString()
  plant?: string;

  @IsOptional()
  @IsString()
  storageLocation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  locationId?: number;
}

class PreviewDto {
  @IsObject()
  source!: SapSourceItem;

  @IsObject()
  answers!: WizardAnswers;
}

class CommitDto {
  @IsString()
  batchId!: string;

  @IsObject()
  source!: SapSourceItem;

  @IsObject()
  answers!: WizardAnswers;

  @IsOptional()
  @IsString()
  copyFromItemId?: string;

  @IsOptional()
  @IsString()
  pipelineEntryId?: string;
}

class EnqueuePipelineDto {
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  rawMatIds!: number[];

  @IsOptional()
  @IsArray()
  hints?: Array<{
    rawMatId: number;
    plant?: string;
    storageLocation?: string;
    locationId?: number;
  }>;
}

class UpdateSapCodeDto {
  @IsString()
  sapItemCode!: string;
}

class ExportPipelineDto {
  @IsArray()
  @IsString({ each: true })
  pipelineEntryIds!: string[];

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  /** xml = SAP Migration Cockpit SpreadsheetML; xlsx = Excel workbook */
  @IsOptional()
  @IsIn(['xml', 'xlsx'])
  format?: 'xml' | 'xlsx';
}

class UpdateItemDto {
  @IsObject()
  answers!: WizardAnswers;
}

class CreateBatchDto {
  @IsOptional()
  @IsString()
  name?: string;
}

class GridPatchDto {
  @IsArray()
  items!: Array<{ id: string; answers: WizardAnswers }>;
}

@Controller('sap-items')
@UseGuards(JwtAuthGuard)
export class SapItemController {
  constructor(
    private readonly sapItems: SapItemService,
    private readonly batches: BatchStoreService,
  ) {}

  @Get('candidates')
  async candidates(@Query('q') q?: string, @Query('limit') limit?: string) {
    const items = await this.sapItems.searchItems(
      q || '',
      limit ? Number(limit) : 50,
    );
    return { success: true, data: items };
  }

  @Post('wizard/start')
  async startWizard(@Body() body: WizardStartDto) {
    const data = await this.sapItems.startWizard(body.rawMatId, {
      plant: body.plant,
      storageLocation: body.storageLocation,
      locationId: body.locationId,
    });
    return { success: true, data };
  }

  @Post('wizard/preview')
  preview(@Body() body: PreviewDto) {
    return { success: true, data: this.sapItems.preview(body.source, body.answers) };
  }

  @Get('batches')
  listBatches() {
    return { success: true, data: this.batches.list() };
  }

  @Post('batches')
  createBatch(@Body() body: CreateBatchDto) {
    return { success: true, data: this.batches.create(body.name) };
  }

  @Get('batches/:id')
  getBatch(@Param('id') id: string) {
    return { success: true, data: this.batches.get(id) };
  }

  @Delete('batches/:id')
  deleteBatch(@Param('id') id: string) {
    this.batches.delete(id);
    return { success: true };
  }

  @Post('commit')
  commit(@Body() body: CommitDto) {
    const data = this.sapItems.commitItem(
      body.batchId,
      body.source,
      body.answers,
      body.copyFromItemId,
      body.pipelineEntryId,
    );
    return { success: true, data };
  }

  @Get('pipeline')
  listPipeline(@Query('stage') stage?: string) {
    const valid = ['pending', 'committed', 'exported'] as const;
    const s = valid.includes(stage as (typeof valid)[number])
      ? (stage as (typeof valid)[number])
      : undefined;
    return {
      success: true,
      data: this.sapItems.listPipeline(s),
      counts: this.sapItems.pipelineCounts(),
    };
  }

  @Post('pipeline/enqueue')
  async enqueuePipeline(@Body() body: EnqueuePipelineDto) {
    const data = await this.sapItems.enqueuePipeline(
      body.rawMatIds,
      body.hints,
    );
    return { success: true, data, counts: this.sapItems.pipelineCounts() };
  }

  @Patch('pipeline/:id/sap-code')
  async updateSapCode(@Param('id') id: string, @Body() body: UpdateSapCodeDto) {
    const data = await this.sapItems.updatePipelineSapCode(id, body.sapItemCode);
    return { success: true, data, counts: this.sapItems.pipelineCounts() };
  }

  @Post('pipeline/export')
  async exportPipeline(@Body() body: ExportPipelineDto, @Res() res: Response) {
    const format = body.format === 'xlsx' ? 'xlsx' : 'xml';
    const { filename, buffer, regenerated } = await this.sapItems.exportPipelineEntries(
      body.pipelineEntryIds || [],
      Boolean(body.regenerate),
      format,
    );
    res.setHeader(
      'Content-Type',
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/xml',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('X-SAP-Regenerated', regenerated ? 'true' : 'false');
    res.setHeader('X-SAP-Export-Format', format);
    res.send(buffer);
  }

  @Delete('pipeline/:id')
  removePipeline(@Param('id') id: string) {
    this.sapItems.removePipelineEntry(id);
    return { success: true, counts: this.sapItems.pipelineCounts() };
  }

  @Patch('batches/:batchId/items/:itemId')
  updateItem(
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateItemDto,
  ) {
    return {
      success: true,
      data: this.sapItems.updateCommittedAnswers(batchId, itemId, body.answers),
    };
  }

  @Post('batches/:batchId/grid')
  gridPatch(@Param('batchId') batchId: string, @Body() body: GridPatchDto) {
    let batch = this.batches.get(batchId);
    for (const row of body.items) {
      batch = this.sapItems.updateCommittedAnswers(batchId, row.id, row.answers);
    }
    return { success: true, data: batch };
  }

  @Delete('batches/:batchId/items/:itemId')
  removeItem(
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
  ) {
    return { success: true, data: this.batches.removeItem(batchId, itemId) };
  }

  @Get('batches/:id/export')
  exportBatch(
    @Param('id') id: string,
    @Query('regenerate') regenerate: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, buffer, regenerated } = this.sapItems.exportBatch(
      id,
      regenerate === 'true' || regenerate === '1',
    );
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('X-SAP-Regenerated', regenerated ? 'true' : 'false');
    res.send(buffer);
  }

  @Get('lookups')
  async lookups() {
    const data = await this.sapItems.lookups();
    return { success: true, data };
  }

  @Post('run-migration')
  async runMigration() {
    const result = await this.sapItems.runMigration();
    return { success: true, ...result };
  }
}
