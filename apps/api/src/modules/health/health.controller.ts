import { Controller, Get, Query } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  getHealth() {
    return {
      ok: true,
      service: 'kiswok-internal-v3-api',
      dbConfigured: this.db.isConfigured(),
      mockErp: process.env.USE_MOCK_ERP === 'true',
      defaultDatabase: this.db.defaultDatabase(),
      ts: new Date().toISOString(),
    };
  }

  @Get('db')
  async getDbHealth(@Query('database') database?: string) {
    if (!this.db.isConfigured()) {
      return {
        ok: false,
        error: 'DB credentials not configured',
        hint: 'Set DB_SERVER/DB_USER/DB_PASS (or Internal-Site INDBIP/DBUSER/DBPASS)',
      };
    }
    const result = await this.db.ping(database);
    return {
      success: result.ok,
      ...result,
      // never echo password; server hostname is operational metadata
    };
  }
}
