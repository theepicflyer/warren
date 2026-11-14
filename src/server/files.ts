/**
 * Uploaded files (photos for the agent). Each is written once under DATA_DIR/files with a name
 * that is never reused and never edited, so a backup tool can copy the folder incrementally.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
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

/** Claude downsizes anything larger, so storing more only costs disk and upload time. */
export const MAX_IMAGE_EDGE = 1568;

export class ImageError extends Error {}

/**
 * Store a photo for the agent: turned upright, shrunk to what Claude can use, and saved as JPEG.
 * Throws `ImageError` if the data isn't an image.
 */
export async function saveImage(
  db: Db,
  dataDir: string,
  input: { userId: number; data: Buffer },
): Promise<StoredFile> {
  let jpeg: Buffer;
  try {
    jpeg = await sharp(input.data)
      .rotate() // apply the camera's orientation
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ImageError("That file isn't an image I can read (JPEG, PNG or WebP).");
  }
  return saveFile(db, dataDir, { userId: input.userId, mediaType: "image/jpeg", data: jpeg });
}
