/**
 * Warren's own tables, all prefixed `warren_`. Apps define theirs separately and may reference
 * `users.id`; app-specific settings for a person live in an app table keyed by user id.
 */
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable("warren_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  oidcSub: text("oidc_sub").notNull().unique(),
  email: text("email"),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/** A file a person uploaded (a photo for the agent). Written once under DATA_DIR/files, never changed. */
export const files = sqliteTable(
  "warren_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    path: text("path").notNull(),
    mediaType: text("media_type").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("warren_files_user").on(t.userId)],
);

/** One conversation with the agent. `scope` is the app's name for what it is about (a date, "ledger"). */
export const threads = sqliteTable(
  "warren_threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    scope: text("scope").notNull(),
    model: text("model").notNull(),
    /** What the app's context builder last told the model in this thread, so it isn't repeated. */
    state: text("state", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("warren_threads_user_scope").on(t.userId, t.scope)],
);

export type TurnStatus = "running" | "ok" | "error" | "refused";

/** One user message and everything the agent did in response. */
export const turns = sqliteTable(
  "warren_turns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    userText: text("user_text").notNull().default(""),
    replyText: text("reply_text").notNull().default(""),
    /** API-format messages appended during this turn (user message first), exactly as sent and returned. */
    messages: text("messages", { mode: "json" }).$type<unknown[]>().notNull().default([]),
    usage: text("usage", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    costUsd: real("cost_usd").notNull().default(0),
    status: text("status").$type<TurnStatus>().notNull().default("ok"),
    /** Why a turn ended "error", for audits. Never shown or replayed. */
    error: text("error"),
    appVersion: text("app_version"),
    undoneAt: integer("undone_at", { mode: "timestamp_ms" }),
    /** Thumbs up (1) or down (-1). Feedback for us, never sent to the model. */
    rating: integer("rating"),
    ratingNote: text("rating_note"),
    ratedAt: integer("rated_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("warren_turns_thread").on(t.threadId)],
);

/** A row the agent created, updated or deleted, kept so a whole turn can be undone. */
export const changes = sqliteTable(
  "warren_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    turnId: integer("turn_id")
      .notNull()
      .references(() => turns.id),
    table: text("table_name").notNull(),
    action: text("action").$type<"create" | "update" | "delete">().notNull(),
    rowId: integer("row_id").notNull(),
    /** The row as stored, column name to raw value, before and after. */
    before: text("before", { mode: "json" }).$type<Record<string, unknown> | null>(),
    after: text("after", { mode: "json" }).$type<Record<string, unknown> | null>(),
  },
  (t) => [index("warren_changes_turn").on(t.turnId)],
);

export const meta = sqliteTable("warren_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type User = typeof users.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Turn = typeof turns.$inferSelect;
export type Change = typeof changes.$inferSelect;
export type StoredFile = typeof files.$inferSelect;
