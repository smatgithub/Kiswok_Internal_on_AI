import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { IcsoftItemsModule } from './modules/icsoft-items/icsoft-items.module';
import { SapItemModule } from './modules/sap-item/sap-item.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    SapItemModule,
    IcsoftItemsModule,
  ],
})
export class AppModule {}
