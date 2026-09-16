/**
 * Fallback path when the `better-sqlite3` native addon cannot be built (e.g. no
 * node-gyp toolchain available). Adapts Node 24's built-in `node:sqlite`
 * (`DatabaseSync`) to the tiny `SqliteDatabase`/`SqliteStatement` interface that
 * Kysely's own `SqliteDialect` expects, so we still get Kysely's SQL compiler,
 * adapter, and introspector for free, only the low-level statement execution is
 * hand-adapted.
 */
import type { SqliteDatabase, SqliteStatement } from "kysely";

// `node:sqlite` types aren't in @types/node yet at the pinned TS/node-types version;
// this narrow local shape is all we use.
interface NodeStatementSync {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(...params: unknown[]): IterableIterator<unknown>;
}
interface NodeDatabaseSync {
  close(): void;
  prepare(sql: string): NodeStatementSync;
}

const READER_RE = /^\s*(select|pragma|with|explain|values)\b/i;

/** Wraps a `node:sqlite` `DatabaseSync` instance so it satisfies Kysely's `SqliteDatabase` interface. */
export function toKyselySqliteDatabase(db: NodeDatabaseSync): SqliteDatabase {
  return {
    close(): void {
      db.close();
    },
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      const reader = READER_RE.test(sql);
      return {
        reader,
        all(parameters: ReadonlyArray<unknown>): unknown[] {
          return stmt.all(...parameters);
        },
        run(parameters: ReadonlyArray<unknown>) {
          const r = stmt.run(...parameters);
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown> {
          return stmt.iterate(...parameters) as IterableIterator<unknown>;
        },
      };
    },
  };
}
