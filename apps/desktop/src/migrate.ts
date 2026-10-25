import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Minimal subset of pg.Client used by the runner (keeps it testable). */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationPlan {
  applied: string[];
  pending: Migration[];
  /** Applied in the database but unknown to this build: the data was written by a newer Explorix. */
  unknown: string[];
  /** Started but never finished (an interrupted migration from another tool). */
  failed: string[];
  /** True when the database has no Explorix tables yet. */
  fresh: boolean;
}

export class MigrationError extends Error {
  constructor(
    public code: 'data_too_new' | 'failed_migration' | 'migration_failed',
    message: string,
    public migration?: string,
  ) {
    super(message);
  }
}

/**
 * Reads prisma/migrations/<name>/migration.sql in name order. The checksum matches the one
 * Prisma Migrate records, so databases stay compatible with `prisma migrate deploy`.
 */
export function readMigrations(dir: string): Migration[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

export async function planMigrations(client: SqlClient, migrations: Migration[]): Promise<MigrationPlan> {
  const exists = await client.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`);
  const tables = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`);
  const rows: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[] = exists.rows[0]?.ok
    ? (await client.query(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`)).rows
    : [];
  const live = rows.filter((r) => !r.rolled_back_at);
  const applied = new Set(live.filter((r) => r.finished_at).map((r) => r.migration_name));
  const known = new Set(migrations.map((m) => m.name));
  return {
    applied: migrations.filter((m) => applied.has(m.name)).map((m) => m.name),
    pending: migrations.filter((m) => !applied.has(m.name)),
    unknown: [...applied].filter((n) => !known.has(n)).sort(),
    failed: live.filter((r) => !r.finished_at).map((r) => r.migration_name),
    fresh: applied.size === 0 && (tables.rows[0]?.n ?? 0) === 0,
  };
}

/** Refuses to touch databases written by a newer version or left half-migrated. */
export function assertMigratable(plan: MigrationPlan) {
  if (plan.unknown.length) {
    throw new MigrationError(
      'data_too_new',
      `This data was created by a newer version of Explorix (data version ${plan.unknown.at(-1)}). Install that version or newer to open it.`,
      plan.unknown.at(-1),
    );
  }
  if (plan.failed.length) {
    throw new MigrationError('failed_migration', `A previous database upgrade (${plan.failed[0]}) did not finish. Restore a backup to continue.`, plan.failed[0]);
  }
}

/**
 * Applies pending migrations, each in its own transaction together with its bookkeeping row,
 * so a failure leaves the database exactly at the previous version.
 */
export async function applyMigrations(client: SqlClient, pending: Migration[], onProgress?: (name: string, index: number, total: number) => void) {
  await client.query(TABLE_DDL);
  for (const [i, m] of pending.entries()) {
    onProgress?.(m.name, i, pending.length);
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, now(), 1)`,
        [crypto.randomUUID(), m.checksum, m.name],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new MigrationError('migration_failed', `Upgrading the database failed at ${m.name}: ${(err as Error).message}`, m.name);
    }
  }
  return pending.map((m) => m.name);
}

/** The application-data version: the newest applied migration (independent of the app version). */
export const dataVersionOf = (plan: Pick<MigrationPlan, 'applied'>, justApplied: string[] = []) => [...plan.applied, ...justApplied].sort().at(-1) ?? null;
