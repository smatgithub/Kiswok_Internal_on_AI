import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { BatchStoreService } from './batch-store.service';
import { GoldTemplateExporter } from './gold-template.exporter';
import { MaterialMasterPatternService } from './material-master-pattern.service';
import { DuplicateCheckService } from './duplicate-check.service';
import { PipelineStoreService } from './pipeline-store.service';
import { ReferenceCatalogService } from './reference-catalog.service';
import { SapItemController } from './sap-item.controller';
import { SapItemService } from './sap-item.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SapItemController],
  providers: [
    SapItemService,
    BatchStoreService,
    PipelineStoreService,
    GoldTemplateExporter,
    MaterialMasterPatternService,
    ReferenceCatalogService,
    DuplicateCheckService,
  ],
  exports: [PipelineStoreService, SapItemService],
})
export class SapItemModule {}
