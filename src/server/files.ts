/**
 * Uploaded files (photos for the agent). Each is written once under DATA_DIR/files with a name
 * that is never reused and never edited, so a backup tool can copy the folder incrementally.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.js";
import { files, type StoredFile } from "./schema.js";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function filesDir(dataDir: string): string {
  return path.join(dataDir, "files");
}

export function saveFile(
  db: Db,
  dataDir: string,
  input: { userId: number; mediaType: string; data: Buffer },
): StoredFile {
  const ext = EXTENSIONS[input.mediaType];
  if (!ext) throw new Error(`unsupported file type ${input.mediaType}`);
  const month = new Date().toISOString().slice(0, 7);
  const relative = path.join(month, `${crypto.randomUUID()}.${ext}`);
  const absolute = path.join(filesDir(dataDir), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, input.data, { flag: "wx" });
  return db
    .insert(files)
    .values({ userId: input.userId, path: relative, mediaType: input.mediaType, bytes: input.data.length })
    .returning()
    .get();
}

/** The file's contents, or null if it is gone from disk. */
export function readFile(dataDir: string, file: StoredFile): Buffer | null {
  try {
    return fs.readFileSync(path.join(filesDir(dataDir), file.path));
  } catch {
    return null;
  }
}
