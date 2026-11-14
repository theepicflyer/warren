import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { DB_FILE, daily, devUser, openDatabase, restore, runJobs, snapshot, snapshotPath } from "../src/server/index.js";
import { notes, testApp } from "./helpers.js";

test("a snapshot can be restored after the live database is lost or changed", async () => {
  const app = testApp();
  const { dataDir } = app.config;
  const user = devUser(app.db, "Alice");
  app.db.insert(notes).values({ userId: user.id, day: "d", body: "before" }).run();

  const file = snapshot(app.database, dataDir, new Date("2026-03-03T19:00:00Z"));
  expect(file).toBe(snapshotPath(dataDir));
  expect((await (await app.http.request("/api/health")).json()).last_snapshot_at).toBe("2026-03-03T19:00:00.000Z");
  snapshot(app.database, dataDir); // replaces the previous one

  app.db.insert(notes).values({ userId: user.id, day: "d", body: "after" }).run();
  app.database.sqlite.close();

  const { replaced } = restore(file, dataDir);
  expect(fs.existsSync(replaced!)).toBe(true);
  const restored = openDatabase(path.join(dataDir, DB_FILE));
  expect(restored.db.select().from(notes).all().map((n) => n.body)).toEqual(["before"]);
  restored.sqlite.close();

  fs.writeFileSync(path.join(dataDir, "junk.sqlite"), "not a database");
  expect(() => restore(path.join(dataDir, "junk.sqlite"), dataDir)).toThrow();
});

test("the daily snapshot runs once a day, and catches up after downtime", async () => {
  const app = testApp({}, { SNAPSHOT_HOUR: "3", TIMEZONE: "Asia/Singapore" });
  const at = (iso: string) => runJobs(app.jobs, new Date(iso));
  const taken = () => fs.existsSync(snapshotPath(app.config.dataDir));

  await at("2026-03-02T18:59:00Z"); // 02:59 in Singapore
  expect(taken()).toBe(false);
  await at("2026-03-02T19:00:00Z"); // 03:00
  expect(taken()).toBe(true);

  fs.rmSync(snapshotPath(app.config.dataDir));
  await at("2026-03-02T23:00:00Z"); // later the same day: already done
  expect(taken()).toBe(false);
  await at("2026-03-04T01:00:00Z"); // 09:00 two days on, after the app was down at 03:00
  expect(taken()).toBe(true);
});

test("a job that fails doesn't stop the others, and is tried again", async () => {
  const app = testApp();
  let attempts = 0;
  const ran: string[] = [];
  const flaky = daily({
    name: "flaky",
    db: app.db,
    timezone: "UTC",
    hour: 0,
    run: () => {
      if (++attempts === 1) throw new Error("first try fails");
    },
  });
  const jobs = [flaky, { name: "other", run: () => void ran.push("other") }];
  await runJobs(jobs, new Date("2026-03-03T10:00:00Z"));
  await runJobs(jobs, new Date("2026-03-03T10:01:00Z"));
  await runJobs(jobs, new Date("2026-03-03T10:02:00Z"));
  expect(attempts).toBe(2);
  expect(ran).toEqual(["other", "other", "other"]);
});
