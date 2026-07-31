import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { BatchStoreService } from './batch-store.service';
import { GoldTemplateExporter } from './gold-template.exporter';
import { PipelineStoreService } from './pipeline-store.service';
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
  ],
  exports: [PipelineStoreService, SapItemService],
})
export class SapItemModule {}
