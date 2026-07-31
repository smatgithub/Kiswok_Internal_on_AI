import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SapItemModule } from '../sap-item/sap-item.module';
import { IcsoftItemsController } from './icsoft-items.controller';
import { IcsoftItemsService } from './icsoft-items.service';

@Module({
  imports: [DatabaseModule, SapItemModule],
  controllers: [IcsoftItemsController],
  providers: [IcsoftItemsService],
})
export class IcsoftItemsModule {}
