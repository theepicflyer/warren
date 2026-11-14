/**
 * Snapshots for backup. Copying a live SQLite file can produce a corrupt copy, so the app writes
 * a consistent one to DATA_DIR/backup/app.sqlite each day. A backup tool on the server copies
 * DATA_DIR (everything except the live database files) off the machine; nothing here uploads.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_FILE, type Database_, getMeta, setMeta } from "./db.js";

export const SNAPSHOT_META = "backup:last_snapshot_at";

export function snapshotPath(dataDir: string): string {
  return path.join(dataDir, "backup", DB_FILE);
}

/** Write a consistent copy of the database, replacing the previous one atomically. */
export function snapshot(database: Database_, dataDir: string, now = new Date()): string {
  const target = snapshotPath(dataDir);
  const tmp = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(tmp, { force: true });
  setMeta(database.db, SNAPSHOT_META, now.toISOString());
  database.sqlite.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  fs.renameSync(tmp, target);
  return target;
}

export function lastSnapshotAt(database: Database_): string | null {
  return getMeta(database.db, SNAPSHOT_META) ?? null;
}

/**
 * Put a snapshot back as the live database. The app must be stopped. The database it replaces is
 * kept beside it, and migrations run as usual on the next start.
 */
export function restore(snapshotFile: string, dataDir: string, now = new Date()): { replaced: string | null } {
  const check = new Database(snapshotFile, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma("integrity_check", { simple: true });
    if (result !== "ok") throw new Error(`snapshot failed its integrity check: ${result}`);
  } finally {
    check.close();
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const live = path.join(dataDir, DB_FILE);
  const incoming = `${live}.restoring`;
  fs.copyFileSync(snapshotFile, incoming);
  let replaced: string | null = null;
  if (fs.existsSync(live)) {
    replaced = `${live}.before-restore-${now.toISOString().replace(/[:.]/g, "-")}`;
    fs.renameSync(live, replaced);
  }
  // Leftover journal files belong to the database that was just moved away.
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(live + suffix, { force: true });
  fs.renameSync(incoming, live);
  return { replaced };
}
