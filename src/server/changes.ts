/**
 * What one agent turn changed, row by row, so the whole turn can be undone.
 *
 * Snapshots are the row as SQLite stores it, so undo needs no per-table code: a created row is
 * deleted, an updated row gets its old values back, a deleted row is inserted again.
 */
import { desc, eq, getTableName, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { type Db, type RawRow, rawRow } from "./db.js";
import { changes } from "./schema.js";

export interface ChangeLog {
  /** Run `fn`, which may create, change or delete the row `id` of `table`, and record what it did. */
  track<T>(table: SQLiteTable, id: number, fn: () => T): T;
  /** Record a row that was just inserted. */
  created(table: SQLiteTable, id: number): void;
}

/** For callers with nothing to undo (the web app's own edits, MCP). */
export const noChanges: ChangeLog = {
  track: (_table, _id, fn) => fn(),
  created: () => {},
};

function same(a: RawRow | null, b: RawRow | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function turnChanges(db: Db, turnId: number): ChangeLog {
  const record = (table: string, id: number, before: RawRow | null, after: RawRow | null) => {
    if (same(before, after)) return;
    const action = before === null ? "create" : after === null ? "delete" : "update";
    db.insert(changes).values({ turnId, table, action, rowId: id, before, after }).run();
  };
  return {
    track(table, id, fn) {
      const name = getTableName(table);
      const before = rawRow(db, name, id);
      const result = fn();
      record(name, id, before, rawRow(db, name, id));
      return result;
    },
    created(table, id) {
      const name = getTableName(table);
      record(name, id, null, rawRow(db, name, id));
    },
  };
}

/** A snapshot value as SQLite takes it. Raw rows only hold these already; imported snapshots may not. */
function bindable(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

function restore(db: Db, table: string, id: number, snapshot: RawRow): void {
  const row = Object.fromEntries(Object.entries(snapshot).map(([k, v]) => [k, bindable(v)]));
  const t = sql.identifier(table);
  const columns = Object.keys(row).filter((c) => c !== "id");
  if (rawRow(db, table, id)) {
    const sets = sql.join(
      columns.map((c) => sql`${sql.identifier(c)} = ${row[c]}`),
      sql`, `,
    );
    db.run(sql`update ${t} set ${sets} where id = ${id}`);
  } else {
    const names = sql.join(
      ["id", ...columns].map((c) => sql.identifier(c)),
      sql`, `,
    );
    const values = sql.join(
      [id, ...columns.map((c) => row[c])].map((v) => sql`${v}`),
      sql`, `,
    );
    db.run(sql`insert into ${t} (${names}) values (${values})`);
  }
}

/** Reverse a turn's changes, newest first. Returns how many there were. */
export function undoChanges(db: Db, turnId: number): number {
  const rows = db.select().from(changes).where(eq(changes.turnId, turnId)).orderBy(desc(changes.id)).all();
  for (const ch of rows) {
    if (ch.action === "create") {
      db.run(sql`delete from ${sql.identifier(ch.table)} where id = ${ch.rowId}`);
    } else if (ch.before) {
      restore(db, ch.table, ch.rowId, ch.before);
    }
  }
  return rows.length;
}
