import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

export type DbAccessMode = 'read' | 'write';

/**
 * SQL Server pool manager aligned with:
 * - Internal-API (`DB_SERVER` / `DB_USER` / `DB_PASS` + mssql pools)
 * - Internal-Site (`INDBIP` / `DBUSER` / `DBPASS` / `ICSOFTDB` via Sequelize+mssql)
 *
 * Read replica: DB_SERVER / INDBIP (e.g. 10.1.3.199)
 * Write primary: DB_WRITE_SERVER / DB_REPORT_SERVER (e.g. 10.1.3.198)
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pools: Record<string, sql.ConnectionPool> = {};

  constructor(private readonly config: ConfigService) {}

  private pick(...keys: string[]): string {
    for (const key of keys) {
      const value = this.config.get<string>(key);
      if (value != null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return '';
  }

  /** Read replica / default query host */
  server(): string {
    return this.pick('DB_SERVER', 'INDBIP');
  }

  /**
   * Primary host for INSERT/UPDATE/DELETE.
   * Falls back to read server if write host is not configured.
   */
  writeServer(): string {
    return this.pick('DB_WRITE_SERVER', 'DB_REPORT_SERVER') || this.server();
  }

  user(): string {
    return this.pick('DB_USER', 'DBUSER');
  }

  password(): string {
    return this.pick('DB_PASS', 'DBPASS');
  }

  defaultDatabase(): string {
    return this.pick('DB_NAME', 'ICSOFTDB', 'IcsoftDb') || 'icsoft';
  }

  private baseConfig(mode: DbAccessMode = 'read'): sql.config {
    const portRaw = this.pick('DB_PORT');
    const port = portRaw ? Number(portRaw) : 1433;
    const host =
      mode === 'write' ? this.writeServer() || 'localhost' : this.server() || 'localhost';
    return {
      user: this.user(),
      password: this.password(),
      server: host,
      port: Number.isFinite(port) ? port : 1433,
      options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
      requestTimeout: 300000,
      connectionTimeout: 30000,
      pool: {
        max: 15,
        min: 0,
        idleTimeoutMillis: 20000,
      },
    };
  }

  private poolKey(databaseName: string, mode: DbAccessMode): string {
    const host = mode === 'write' ? this.writeServer() : this.server();
    return `${mode}:${host}:${databaseName}`;
  }

  async getPool(
    databaseName?: string,
    mode: DbAccessMode = 'read',
  ): Promise<sql.ConnectionPool> {
    const db = databaseName || this.defaultDatabase();
    const key = this.poolKey(db, mode);
    if (!this.pools[key]) {
      const pool = new sql.ConnectionPool({
        ...this.baseConfig(mode),
        database: db,
      });
      pool.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error(`SQL pool error [${key}]`, err);
      });
      this.pools[key] = pool;
    }
    const pool = this.pools[key];
    if (!pool.connected) {
      await pool.connect();
    }
    return pool;
  }

  /** Read queries — uses DB_SERVER (replica). */
  async run<T = Record<string, unknown>>(
    databaseName: string,
    build: (request: sql.Request) => Promise<sql.IResult<T>>,
  ): Promise<T[]> {
    const pool = await this.getPool(databaseName, 'read');
    const request = pool.request();
    const result = await build(request);
    return result.recordset;
  }

  /** Write queries — uses DB_WRITE_SERVER / DB_REPORT_SERVER (primary). */
  async runWrite<T = Record<string, unknown>>(
    databaseName: string,
    build: (request: sql.Request) => Promise<sql.IResult<T>>,
  ): Promise<T[]> {
    const pool = await this.getPool(databaseName, 'write');
    const request = pool.request();
    const result = await build(request);
    return result.recordset;
  }

  isConfigured(): boolean {
    const server = this.server();
    const user = this.user();
    const pass = this.password();
    if (!server || !user || !pass) return false;
    if (server.includes('your-') || user.includes('your-')) return false;
    return true;
  }

  async ping(databaseName?: string): Promise<{
    ok: boolean;
    database: string;
    server: string;
    writeServer: string;
    latencyMs: number;
    sample?: Record<string, unknown>;
    error?: string;
  }> {
    const database = databaseName || this.defaultDatabase();
    const started = Date.now();
    try {
      const rows = await this.run(database, (request) =>
        request.query(`
          SELECT
            DB_NAME() AS db_name,
            @@SERVERNAME AS server_name,
            SYSTEM_USER AS login_name,
            (SELECT COUNT(1) FROM invent_grntype WHERE active = 'Y') AS active_grntypes
        `),
      );
      return {
        ok: true,
        database,
        server: this.server(),
        writeServer: this.writeServer(),
        latencyMs: Date.now() - started,
        sample: (rows[0] as Record<string, unknown>) || {},
      };
    } catch (err) {
      return {
        ok: false,
        database,
        server: this.server(),
        writeServer: this.writeServer(),
        latencyMs: Date.now() - started,
        error: (err as Error).message,
      };
    }
  }

  async onModuleDestroy() {
    await Promise.all(
      Object.values(this.pools).map(async (pool) => {
        try {
          await pool.close();
        } catch {
          /* ignore */
        }
      }),
    );
  }
}
