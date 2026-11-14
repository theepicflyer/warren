import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { meta } from "./schema.js";

/**
 * A database handle or a transaction on one. SQLite calls are synchronous, so domain code is plain
 * synchronous functions that take a `Db`.
 */
export type Db = BaseSQLiteDatabase<"sync", Database.RunResult, Record<string, never>>;

export interface Database_ {
  db: Db;
  /** The underlying connection, for pragmas, snapshots and closing. */
  sqlite: Database.Database;
  path: string;
}

export const DB_FILE = "app.sqlite";

/** Warren's own migrations, shipped with the package. */
export const WARREN_MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

export function openDatabase(file: string): Database_ {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite) as unknown as Db, sqlite, path: file };
}

export interface MigrationSet {
  /** Folder of drizzle-kit migrations. */
  folder: string;
  /** Table that records which of them have run; one per set. */
  table: string;
}

/**
 * Run Warren's migrations, then the app's. A migration that rebuilds a table can't drop the old
 * one while other rows reference it, so foreign keys are off for the run (the pragma is a no-op
 * inside a transaction) and checked afterwards.
 */
export function runMigrations(database: Database_, appSets: MigrationSet[] = []): void {
  const { sqlite } = database;
  sqlite.pragma("foreign_keys = OFF");
  try {
    const sets = [{ folder: WARREN_MIGRATIONS, table: "warren_migrations" }, ...appSets];
    for (const set of sets) {
      migrate(drizzle(sqlite), { migrationsFolder: set.folder, migrationsTable: set.table });
    }
    const broken = sqlite.pragma("foreign_key_check") as unknown[];
    if (broken.length) throw new Error(`migration broke foreign keys: ${JSON.stringify(broken)}`);
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

export function getMeta(db: Db, key: string): string | undefined {
  return db.select().from(meta).where(eq(meta.key, key)).get()?.value;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run();
}

/** A stored row as SQLite holds it: column name to raw value. */
export type RawRow = Record<string, unknown>;

export function rawRow(db: Db, table: string, id: number): RawRow | null {
  const row = db.get<RawRow | undefined>(
    sql`select * from ${sql.identifier(table)} where id = ${id}`,
  );
  return row ?? null;
}
