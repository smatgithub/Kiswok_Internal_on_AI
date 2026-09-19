import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SapSourceItem, WizardAnswers } from '@kiswok/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { BatchStoreService } from './batch-store.service';
import { SapItemService } from './sap-item.service';

class WizardStartDto {
  @ValidateIf((o: WizardStartDto) => !o.pipelineEntryId)
  @Type(() => Number)
  @IsNumber()
  rawMatId?: number;

  @IsOptional()
  @IsString()
  pipelineEntryId?: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  plants?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  slocs?: string[];
}

class ManualRequesterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  empCode!: string;

  @IsString()
  @MinLength(1)
  loginId!: string;

  @IsString()
  @MinLength(3)
  email!: string;

  @Type(() => Number)
  @IsNumber()
  deptId!: number;

  @IsOptional()
  @IsString()
  deptName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  locationId?: number;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  locationIds?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locationNames?: string[];

  @IsString()
  @MinLength(8)
  justification!: string;
}

class ManualItemDto {
  @ValidateNested()
  @Type(() => ManualRequesterDto)
  requester!: ManualRequesterDto;

  @IsString()
  productType!: string;

  @IsString()
  @MinLength(8)
  description!: string;

  @IsString()
  productGroup!: string;

  @IsString()
  hsnCode!: string;

  @IsOptional()
  @IsBoolean()
  hsnOther?: boolean;

  @IsString()
  baseUom!: string;

  @IsArray()
  @IsString({ each: true })
  plants!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  storageLocations?: string[];

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  locationIds?: number[];

  @IsOptional()
  @IsString()
  plant?: string;

  @IsOptional()
  @IsString()
  storageLocation?: string;

  @IsOptional()
  @IsString()
  proposedCode?: string;

  @IsOptional()
  @IsString()
  duplicateOverrideReason?: string;
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

class DuplicateOverrideDto {
  @Type(() => Number)
  @IsNumber()
  rawMatId!: number;

  @IsString()
  reason!: string;
}

class ReviewDuplicatesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rawMatId?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  rawMatIds?: number[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  rawMatCode?: string;

  @IsOptional()
  @IsString()
  hsn?: string;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

class CommitPendingDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pipelineEntryIds?: string[];
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

  @IsOptional()
  @IsArray()
  overrides?: DuplicateOverrideDto[];
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
      pipelineEntryId: body.pipelineEntryId,
      plants: body.plants,
      slocs: body.slocs,
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

  @Post('duplicates')
  async reviewDuplicates(@Body() body: ReviewDuplicatesDto) {
    const data = await this.sapItems.reviewDuplicates(body);
    return { success: true, data };
  }

  @Post('pipeline/enqueue')
  async enqueuePipeline(@Body() body: EnqueuePipelineDto) {
    const data = await this.sapItems.enqueuePipeline(
      body.rawMatIds,
      body.hints,
      body.overrides,
    );
    return { success: true, data, counts: this.sapItems.pipelineCounts() };
  }

  @Post('pipeline/manual')
  async createManualItem(
    @Body() body: ManualItemDto,
    @CurrentUser() user?: AuthUser,
  ) {
    const requester = {
      ...body.requester,
      name: body.requester.name || user?.name || '',
      empCode: body.requester.empCode || user?.EmpCode || '',
      loginId: body.requester.loginId || user?.loginId || '',
      email: body.requester.email || user?.Email || '',
      deptId: body.requester.deptId ?? user?.DeptId ?? null,
      locationId: body.requester.locationId ?? user?.LocationId ?? null,
    };
    const data = await this.sapItems.createManualItem({
      requester,
      productType: body.productType,
      description: body.description,
      productGroup: body.productGroup,
      hsnCode: body.hsnCode,
      hsnOther: body.hsnOther,
      baseUom: body.baseUom,
      plants: body.plants?.length ? body.plants : body.plant ? [body.plant] : [],
      storageLocations: body.storageLocations?.length
        ? body.storageLocations
        : body.storageLocation
          ? [body.storageLocation]
          : [],
      locationIds: body.locationIds?.length
        ? body.locationIds
        : body.requester.locationIds?.length
          ? body.requester.locationIds
          : body.requester.locationId != null
            ? [body.requester.locationId]
            : [],
      proposedCode: body.proposedCode,
      duplicateOverrideReason: body.duplicateOverrideReason,
    });
    return { success: true, data, counts: this.sapItems.pipelineCounts() };
  }

  @Post('pipeline/commit-pending')
  async commitPending(@Body() body: CommitPendingDto) {
    const data = await this.sapItems.commitPipelinePending(
      body?.pipelineEntryIds,
    );
    return { success: true, data, counts: data.counts };
  }

  @Patch('pipeline/:id/sap-code')
  async updateSapCode(@Param('id') id: string, @Body() body: UpdateSapCodeDto) {
    const data = await this.sapItems.updatePipelineSapCode(id, body.sapItemCode);
    return { success: true, data, counts: this.sapItems.pipelineCounts() };
  }

  /** Download Excel template to bulk-fill SAP item codes (Template created). */
  @Get('pipeline/sap-code-template')
  async downloadSapCodeTemplate(@Res() res: Response) {
    const { filename, buffer } = await this.sapItems.buildSapCodeUploadTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * Bulk upload SAP item codes from the download template.
   * Blank existing → update; already set → skip; old≠new → mismatch in summary.
   */
  @Post('pipeline/sap-code-bulk')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async bulkUploadSapCodes(
    @UploadedFile()
    file?: { buffer: Buffer; originalname?: string; mimetype?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload an .xlsx file (field name: file)');
    }
    const name = (file.originalname || '').toLowerCase();
    if (name && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      throw new BadRequestException('Only Excel .xlsx files are supported');
    }
    const data = await this.sapItems.bulkUpdateSapCodesFromExcel(file.buffer);
    return { success: true, data, counts: this.sapItems.pipelineCounts() };
  }

  @Post('pipeline/export')
  async exportPipeline(@Body() body: ExportPipelineDto, @Res() res: Response) {
    const format = body.format === 'xlsx' ? 'xlsx' : 'xml';
    const { filename, buffer, regenerated, excluded } = await this.sapItems.exportPipelineEntries(
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
    res.setHeader('X-SAP-Excluded-Count', String(excluded.length));
    if (excluded.length) {
      res.setHeader(
        'X-SAP-Excluded-Sample',
        excluded
          .slice(0, 12)
          .map((e) => `${e.icsoftCode}=${e.sapCode}`)
          .join(','),
      );
    }
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

  @Get('master-patterns')
  masterPatterns() {
    return { success: true, data: this.sapItems.masterPatternSummary() };
  }

  @Post('run-migration')
  async runMigration() {
    const result = await this.sapItems.runMigration();
    return { success: true, ...result };
  }
}
