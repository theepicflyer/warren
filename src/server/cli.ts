#!/usr/bin/env node
/** `warren snapshot` and `warren restore <file>`, run inside the app's container. */
import path from "node:path";
import { restore, snapshot } from "./backup.js";
import { loadConfig } from "./config.js";
import { DB_FILE, openDatabase } from "./db.js";

const [command, arg] = process.argv.slice(2);
const { dataDir } = loadConfig();

if (command === "snapshot") {
  const database = openDatabase(path.join(dataDir, DB_FILE));
  console.log(`snapshot written to ${snapshot(database, dataDir)}`);
  database.sqlite.close();
} else if (command === "restore" && arg) {
  const { replaced } = restore(arg, dataDir);
  console.log(`restored ${arg} into ${dataDir}`);
  if (replaced) console.log(`the database it replaced is kept at ${replaced}`);
} else {
  console.error("usage: warren snapshot | warren restore <snapshot file>   (stop the app before a restore)");
  process.exit(2);
}
