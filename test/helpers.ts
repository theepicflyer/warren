/** A tiny app (notes by day) and a scripted Claude, for exercising Warren without the network. */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  type AgentClient,
  type AppOptions,
  configFromEnv,
  createApp,
  defineTool,
  DomainError,
  envSchema,
  type Tool,
} from "../src/server/index.js";

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  day: text("day").notNull(),
  body: text("body").notNull(),
});

export const NOTES_SQL = `create table if not exists notes (
  id integer primary key autoincrement, user_id integer not null references warren_users(id),
  day text not null, body text not null)`;

export const tools: Tool[] = [
  defineTool({
    name: "list_notes",
    description: "List the notes for a day.",
    input: z.strictObject({ day: z.string().describe("YYYY-MM-DD").optional() }),
    writes: false,
    expose: ["agent", "mcp"],
    run(ctx, { day }) {
      const rows = ctx.db
        .select()
        .from(notes)
        .where(and(eq(notes.userId, ctx.user.id), eq(notes.day, day ?? ctx.scope ?? "")))
        .all();
      return rows.map((n) => `#${n.id} ${n.body}`).join("\n") || "No notes";
    },
  }),
  defineTool({
    name: "add_note",
    description: "Add a note to the day.",
    input: z.strictObject({ body: z.string().min(1) }),
    writes: true,
    expose: ["agent"],
    run(ctx, { body }) {
      if (body === "forbidden") throw new DomainError("That note isn't allowed");
      const row = ctx.db
        .insert(notes)
        .values({ userId: ctx.user.id, day: ctx.scope!, body })
        .returning()
        .get();
      ctx.changes.created(notes, row.id);
      ctx.touched.add(row.day);
      if (body === "explode") throw new DomainError("Failed after writing");
      return `Added #${row.id} ${row.body}`;
    },
  }),
  defineTool({
    name: "edit_note",
    description: "Change or delete a note.",
    input: z.strictObject({ id: z.number().int(), body: z.string().nullable() }),
    writes: true,
    expose: ["agent"],
    run(ctx, { id, body }) {
      ctx.changes.track(notes, id, () => {
        if (body === null) ctx.db.delete(notes).where(eq(notes.id, id)).run();
        else ctx.db.update(notes).set({ body }).where(eq(notes.id, id)).run();
      });
      return body === null ? `Deleted #${id}` : `Changed #${id}`;
    },
  }),
];

export const SYSTEM_PROMPT = "You keep notes. Be brief.";

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "warren-test-"));
}

export function testConfig(overrides: Record<string, string> = {}) {
  const dir = tempDir();
  return configFromEnv(
    envSchema.parse({
      DATA_DIR: path.join(dir, "data"),
      STATIC_DIR: path.join(dir, "static"),
      PUBLIC_URL: "http://localhost:8000",
      DEV_LOGIN: "true",
      SCHEDULER: "false",
      AGENT_MODEL: "claude-haiku-5-5",
      ...overrides,
    }),
  );
}

export function testApp(options: Partial<AppOptions> = {}, env: Record<string, string> = {}) {
  const app = createApp({
    name: "notes",
    config: testConfig(env),
    tools,
    agent: {
      systemPrompt: SYSTEM_PROMPT,
      context: ({ scope, firstTurn, state }) => ({
        text: `Day: ${scope}${firstTurn ? " (first turn)" : ""}${state.seen ? " (seen)" : ""}`,
        state: { seen: true },
      }),
      describeChange: ({ row }) => ({ body: row.body }),
    },
    mcpInstructions: "Notes by day.",
    ...options,
  });
  app.database.sqlite.exec(NOTES_SQL);
  return app;
}

// --- a scripted Claude ----------------------------------------------------------------------------

type Block = Record<string, unknown>;

export function message(content: Block[], stop: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
    ...extra,
  };
}

export const say = (text: string): Block => ({ type: "text", text });
export const call = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
export const thinking = (): Block => ({ type: "thinking", thinking: "", signature: "sig" });

/** Replays scripted responses and records each request as it was sent. */
export class FakeClaude implements AgentClient {
  requests: Record<string, any>[] = [];
  constructor(private responses: (ReturnType<typeof message> | Error)[]) {}
  beta = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        this.requests.push(structuredClone(params));
        const next = this.responses.shift();
        if (!next) throw new Error("FakeClaude ran out of responses");
        return {
          async *[Symbol.asyncIterator]() {
            if (next instanceof Error) throw next;
            for (const block of next.content) {
              if (block.type === "text") {
                yield { type: "content_block_delta", delta: { type: "text_delta", text: block.text } };
              }
            }
          },
          finalMessage: async () => {
            if (next instanceof Error) throw next;
            return next as never;
          },
        };
      },
    },
  };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}
