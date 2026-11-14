import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { devUser, schema, turnChanges, undoChanges } from "../src/server/index.js";
import { notes, testApp } from "./helpers.js";

test("a turn's creates, updates and deletes are all undone", () => {
  const { db } = testApp();
  const user = devUser(db, "Alice");
  const thread = db.insert(schema.threads).values({ userId: user.id, scope: "d", model: "m" }).returning().get();
  const turn = db.insert(schema.turns).values({ threadId: thread.id }).returning().get();
  const keep = db.insert(notes).values({ userId: user.id, day: "d", body: "keep" }).returning().get();
  const gone = db.insert(notes).values({ userId: user.id, day: "d", body: "gone" }).returning().get();

  const log = turnChanges(db, turn.id);
  const made = db.insert(notes).values({ userId: user.id, day: "d", body: "new" }).returning().get();
  log.created(notes, made.id);
  log.track(notes, keep.id, () => db.update(notes).set({ body: "changed" }).where(eq(notes.id, keep.id)).run());
  log.track(notes, gone.id, () => db.delete(notes).where(eq(notes.id, gone.id)).run());
  log.track(notes, keep.id, () => {}); // nothing changed, nothing recorded

  const recorded = db.select().from(schema.changes).all();
  expect(recorded.map((c) => c.action)).toEqual(["create", "update", "delete"]);
  expect(db.select().from(notes).all().map((n) => n.body)).toEqual(["changed", "new"]);

  expect(undoChanges(db, turn.id)).toBe(3);
  expect(db.select().from(notes).all()).toEqual([keep, gone]);
});
