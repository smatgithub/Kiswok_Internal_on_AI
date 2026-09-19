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
  /** Single-flight connect so /categories and /options do not race pool.connect(). */
  private connecting: Partial<Record<string, Promise<sql.ConnectionPool>>> = {};

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
      // Must stay below tarn createTimeoutMillis so a real TDS error surfaces
      // instead of Tarn's "operation timed out for an unknown reason".
      connectionTimeout: 30000,
      pool: {
        max: 15,
        min: 0,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,
        createTimeoutMillis: 60000,
        destroyTimeoutMillis: 5000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200,
      } as sql.config['pool'],
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
    const existing = this.pools[key] as
      | (sql.ConnectionPool & { healthy?: boolean })
      | undefined;
    if (existing?.connected && existing.healthy !== false) {
      return existing;
    }
    if (this.connecting[key]) {
      return this.connecting[key];
    }
    this.connecting[key] = this.openPool(db, mode, key).finally(() => {
      delete this.connecting[key];
    });
    return this.connecting[key];
  }

  private async openPool(
    db: string,
    mode: DbAccessMode,
    key: string,
  ): Promise<sql.ConnectionPool> {
    await this.dropPool(key);
    const pool = new sql.ConnectionPool({
      ...this.baseConfig(mode),
      database: db,
    });
    pool.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`SQL pool error [${key}]`, err);
      void this.dropPool(key);
    });
    try {
      await pool.connect();
    } catch (err) {
      try {
        await pool.close();
      } catch {
        /* ignore */
      }
      throw this.wrapSqlError(err, db, mode);
    }
    this.pools[key] = pool;
    return pool;
  }

  private async dropPool(key: string): Promise<void> {
    const pool = this.pools[key];
    delete this.pools[key];
    if (!pool) return;
    try {
      await pool.close();
    } catch {
      /* ignore */
    }
  }

  private wrapSqlError(err: unknown, databaseName: string, mode: DbAccessMode): Error {
    const raw = err as { message?: string; name?: string; code?: string };
    const message = String(raw?.message || err);
    if (
      message.startsWith('SQL pool timed out') ||
      message.startsWith('SQL read ') ||
      message.startsWith('SQL write ')
    ) {
      return err instanceof Error ? err : new Error(message);
    }
    const host = mode === 'write' ? this.writeServer() : this.server();
    if (/timed out for an unknown reason/i.test(message) || raw?.name === 'TimeoutError') {
      return new Error(
        `SQL pool timed out opening a connection to ${host}:1433 database ${databaseName}. ` +
          `This is usually office VPN, a stale pool after a network drop, or the replica not accepting logins — not a slow invent_grntype query. ` +
          `(${message})`,
      );
    }
    return new Error(
      `SQL ${mode} ${host}/${databaseName} failed: ${message}${raw?.code ? ` [${raw.code}]` : ''}`,
    );
  }

  private async exec<T>(
    databaseName: string,
    mode: DbAccessMode,
    build: (request: sql.Request) => Promise<sql.IResult<T>>,
  ): Promise<T[]> {
    const pool = await this.getPool(databaseName, mode);
    const request = pool.request();
    const result = await build(request);
    return result.recordset;
  }

  /** Read queries — uses DB_SERVER (replica), retries once, then write host. */
  async run<T = Record<string, unknown>>(
    databaseName: string,
    build: (request: sql.Request) => Promise<sql.IResult<T>>,
  ): Promise<T[]> {
    try {
      return await this.exec(databaseName, 'read', build);
    } catch (err) {
      await this.dropPool(this.poolKey(databaseName, 'read'));
      try {
        return await this.exec(databaseName, 'read', build);
      } catch (retryErr) {
        if (this.writeServer() && this.writeServer() !== this.server()) {
          try {
            return await this.exec(databaseName, 'write', build);
          } catch (writeErr) {
            throw this.wrapSqlError(writeErr, databaseName, 'write');
          }
        }
        throw this.wrapSqlError(retryErr, databaseName, 'read');
      }
    }
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
