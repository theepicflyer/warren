/**
 * One secret per deployment, made on first start and kept in DATA_DIR. Every key the app needs
 * (login cookies, MCP tokens) is derived from it, so it is the one file that must be backed up
 * with the data: losing it signs everyone out and disconnects MCP clients.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function masterSecret(dataDir: string): string {
  const file = path.join(dataDir, "secret");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  return fs.readFileSync(file, "utf8").trim();
}

/** A key for one purpose, so no two uses share key material. */
export function deriveKey(master: string, purpose: string): string {
  return crypto.createHmac("sha256", master).update(purpose).digest("hex");
}
