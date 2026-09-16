import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, Migrator, PostgresDialect, SqliteDialect } from "kysely";
import type { Schema } from "./schema.js";
import { InMemoryMigrationProvider } from "./migrations/index.js";
import { toKyselySqliteDatabase } from "./node-sqlite-dialect.js";

export interface OpenDatabaseOptions {
  /** SQLite file path or ":memory:". Ignored when `url` is a postgres:// URL. */
  path: string | ":memory:";
  /** Optional Postgres connection string (postgres:// or postgresql://). Needs the optional `pg` dependency. */
  url?: string;
  /** Postgres pool size (default 10). */
  poolMax?: number;
}

export interface OpenedDatabase {
  db: Kysely<Schema>;
  close(): void;
  /** Which underlying SQLite driver ended up being used. Mostly useful for diagnostics/tests. */
  driver: "better-sqlite3" | "node:sqlite" | "postgres";
}

/**
 * Opens the database and runs pending migrations. SQLite (file or :memory:) by
 * default; when `url` is a Postgres connection string the same Kysely schema and
 * migrations run on Postgres through the optional `pg` driver. Migrations only use
 * portable column types (text/integer/real) so both dialects share one migration set.
 */
export async function openDatabase(opts: OpenDatabaseOptions): Promise<OpenedDatabase> {
  if (opts.url && /^postgres(ql)?:\/\//.test(opts.url)) return openPostgres(opts.url, opts.poolMax ?? 10);
  const { path } = opts;
  const isFile = path !== ":memory:";
  if (isFile) {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const { database, close, driver } = await createSqliteDatabase(path, { wal: isFile });

  const db = new Kysely<Schema>({ dialect: new SqliteDialect({ database }) });

  const migrator = new Migrator({ db, provider: new InMemoryMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    throw new Error(`storage: migration failed: ${(results ?? []).map((r) => `${r.migrationName}:${r.status}`).join(",")}, ${String(error)}`, {
      cause: error,
    });
  }

  return { db, close, driver };
}

async function openPostgres(url: string, max: number): Promise<OpenedDatabase> {
  let pgMod: any;
  try {
    const optional = "pg"; // optional dependency: resolved at runtime only
    pgMod = await import(optional);
  } catch {
    throw new Error("storage: DATABASE_URL points at Postgres but the optional dependency \"pg\" is not installed (pnpm add pg -w).");
  }
  const Pool = pgMod.Pool ?? pgMod.default?.Pool;
  const pool = new Pool({ connectionString: url, max });
  const db = new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
  const migrator = new Migrator({ db, provider: new InMemoryMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    await pool.end().catch(() => undefined);
    throw new Error(`storage: postgres migration failed: ${(results ?? []).map((r) => `${r.migrationName}:${r.status}`).join(",")}, ${String(error)}`, { cause: error });
  }
  return { db, close: () => { void pool.end(); }, driver: "postgres" };
}

async function createSqliteDatabase(
  path: string,
  opts: { wal: boolean },
): Promise<{
  database: import("kysely").SqliteDatabase;
  close: () => void;
  driver: "better-sqlite3" | "node:sqlite";
}> {
  try {
    const mod: any = await import("better-sqlite3");
    const Database = mod.default ?? mod;
    const raw = new Database(path);
    if (opts.wal) raw.pragma("journal_mode = WAL");
    raw.pragma("foreign_keys = ON");
    return { database: raw as import("kysely").SqliteDatabase, close: () => raw.close(), driver: "better-sqlite3" };
  } catch {
    const nodeSqlite: any = await import("node:sqlite");
    const raw = new nodeSqlite.DatabaseSync(path === ":memory:" ? ":memory:" : path);
    if (opts.wal) raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("PRAGMA foreign_keys = ON;");
    const database = toKyselySqliteDatabase(raw);
    return { database, close: () => raw.close(), driver: "node:sqlite" };
  }
}
