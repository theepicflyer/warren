import fs from "node:fs";
import { APIError } from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  type AgentConfig,
  type AgentDefinition,
  type AgentEvent,
  devUser,
  rateTurn,
  runTurn,
  saveFile,
  schema,
  scopeTurns,
  undoTurn,
} from "../src/server/index.js";
import { call, FakeClaude, message, notes, say, SYSTEM_PROMPT, testApp, thinking, tools } from "./helpers.js";

const DAY = "2026-03-03";
const HAIKU: AgentConfig = {
  model: "claude-haiku-5-5",
  effort: "low",
  maxTokens: 16000,
  cache: true,
  cacheTtl: "5m",
  maxIterations: 8,
};

const agent: AgentDefinition = {
  systemPrompt: SYSTEM_PROMPT,
  tools,
  context: ({ scope, firstTurn, state }) => ({
    text: `Day: ${scope}${firstTurn ? " (first turn)" : ""}${state.seen ? " (seen)" : ""}`,
    state: { seen: true },
  }),
  describeChange: ({ row }) => ({ body: row.body }),
};

function setup() {
  const app = testApp();
  const user = devUser(app.db, "Alice");
  const run = async (
    client: FakeClaude,
    text: string,
    extra: { threadId?: number; fileIds?: number[]; config?: AgentConfig } = {},
  ) => {
    const events: AgentEvent[] = [];
    const deps = { db: app.db, dataDir: app.config.dataDir, agent, config: extra.config ?? HAIKU, client, appVersion: "1.2.3" };
    for await (const e of runTurn(deps, { userId: user.id, scope: DAY, text, ...extra })) events.push(e);
    return events;
  };
  const turn = (id: number) => app.db.select().from(schema.turns).where(eq(schema.turns.id, id)).get()!;
  return { app, user, run, turn };
}

const done = (events: AgentEvent[]) => {
  const last = events.at(-1)!;
  if (last.type !== "done") throw new Error(`turn ended with ${JSON.stringify(last)}`);
  return last;
};

test("a turn calls tools, replies, and its history is replayed byte for byte", async () => {
  const { app, run, turn } = setup();
  const first = new FakeClaude([
    message([thinking(), call("tu_1", "add_note", { body: "milk" })], "tool_use"),
    message([say("Added milk.")], "end_turn"),
  ]);
  const events = await run(first, "add milk");
  expect(events.map((e) => e.type)).toEqual(["turn", "tool", "changed", "text", "done"]);
  const end = done(events);
  expect(end.touched).toEqual([DAY]);
  expect(end.turn).toMatchObject({
    reply_text: "Added milk.",
    status: "ok",
    changes: [{ table: "notes", action: "create", row_id: 1, body: "milk" }],
  });
  expect(end.turn.cost_usd).toBeGreaterThan(0);
  expect(app.db.select().from(notes).all().map((n) => n.body)).toEqual(["milk"]);
  expect(turn(end.turn.id).appVersion).toBe("1.2.3");

  // The second call of the turn sends the first call's messages plus the tool result.
  expect(first.requests[1]!.messages.slice(0, 1)).toEqual(first.requests[0]!.messages);
  expect(first.requests[1]!.messages[2].content).toEqual([
    { type: "tool_result", tool_use_id: "tu_1", content: "Added #1 milk" },
  ]);

  const second = new FakeClaude([message([say("One note.")], "end_turn")]);
  await run(second, "how many?", { threadId: end.turn.thread_id });
  const replayed = second.requests[0]!.messages;
  const stored = turn(end.turn.id).messages;
  expect(JSON.stringify(replayed.slice(0, stored.length))).toBe(JSON.stringify(stored));
  // thinking blocks go back exactly as they came
  expect(replayed[1].content[0]).toEqual(thinking());
  expect(replayed.at(-1).content.at(-1).text).toBe(`Day: ${DAY} (seen)\n\nhow many?`);
});

test("the cached prefix is frozen: system prompt, sorted tools, context in the user message", async () => {
  const { run } = setup();
  const client = new FakeClaude([message([say("Hi.")], "end_turn")]);
  await run(client, "hello");
  const req = client.requests[0]!;
  expect(req.system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  expect(req.cache_control).toEqual({ type: "ephemeral" });
  expect(req.tools.map((t: { name: string }) => t.name)).toEqual(["add_note", "edit_note", "list_notes"]);
  expect(req.messages[0].content).toEqual([{ type: "text", text: `Day: ${DAY} (first turn)\n\nhello` }]);
  expect(req.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
  expect(req.output_config).toEqual({ effort: "low" });
  // Haiku has no server-side fallback
  expect(req.fallbacks).toBeUndefined();
  expect(req.betas).toEqual(["thinking-binding-controls-2026-08-01"]);
});

test("Opus requests ask for server-side fallbacks and an hour-long cache when configured", async () => {
  const { run } = setup();
  const client = new FakeClaude([message([say("Hi.")], "end_turn")]);
  await run(client, "hello", { config: { ...HAIKU, model: "claude-opus-5-5", cacheTtl: "1h" } });
  const req = client.requests[0]!;
  expect(req.fallbacks).toBe("default");
  expect(req.betas).toEqual(["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"]);
  expect(req.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
});

test("a tool error goes back to the model, which can recover", async () => {
  const { app, run } = setup();
  const client = new FakeClaude([
    message([call("tu_1", "add_note", { body: "forbidden" }), call("tu_2", "add_note", { body: "eggs" })], "tool_use"),
    message([say("Added eggs only.")], "end_turn"),
  ]);
  done(await run(client, "add both"));
  expect(client.requests[1]!.messages[2].content).toEqual([
    { type: "tool_result", tool_use_id: "tu_1", content: "Error: That note isn't allowed", is_error: true },
    { type: "tool_result", tool_use_id: "tu_2", content: "Added #1 eggs" },
  ]);
  expect(app.db.select().from(notes).all().map((n) => n.body)).toEqual(["eggs"]);
});

test("a refused turn is kept but never replayed, and leaves thread state alone", async () => {
  const { app, run } = setup();
  const refused = done(await run(new FakeClaude([message([], "refusal")]), "bad"));
  expect(refused.turn).toMatchObject({ status: "refused", reply_text: "Sorry, I couldn't process that one." });
  const next = new FakeClaude([message([say("Hi.")], "end_turn")]);
  await run(next, "hello", { threadId: refused.turn.thread_id });
  expect(next.requests[0]!.messages).toHaveLength(1);
  expect(next.requests[0]!.messages[0].content[0].text).toBe(`Day: ${DAY} (first turn)\n\nhello`);
  expect(app.db.select().from(schema.threads).all()[0]!.state).toEqual({ seen: true });
});

test("a tool call cut off at max_tokens is never run", async () => {
  const { app, run, turn } = setup();
  const end = done(await run(new FakeClaude([message([call("tu_1", "add_note", { body: "half" })], "max_tokens")]), "long"));
  expect(end.turn.status).toBe("error");
  expect(turn(end.turn.id).error).toBe("max_tokens reached with tool calls pending");
  expect(turn(end.turn.id).messages).toHaveLength(1);
  expect(app.db.select().from(notes).all()).toEqual([]);
});

test("a turn that keeps calling tools is stopped", async () => {
  const { run, turn } = setup();
  const responses = Array.from({ length: 2 }, (_, i) => message([call(`tu_${i}`, "list_notes", {})], "tool_use"));
  const end = done(await run(new FakeClaude(responses), "loop", { config: { ...HAIKU, maxIterations: 2 } }));
  expect(end.turn.status).toBe("error");
  expect(turn(end.turn.id).error).toBe("stopped after 2 model calls");
});

test("an API failure ends the turn with an error and keeps what was written", async () => {
  const { app, run, turn } = setup();
  const boom = new APIError(529, { type: "error" }, "Overloaded", new Headers());
  const events = await run(
    new FakeClaude([message([call("tu_1", "add_note", { body: "milk" })], "tool_use"), boom]),
    "add milk",
  );
  expect(events.at(-1)!.type).toBe("error");
  const failed = turn((events[0] as { turn_id: number }).turn_id);
  expect(failed.status).toBe("error");
  expect(failed.error).toContain("529");
  expect(app.db.select().from(notes).all()).toHaveLength(1);
});

test("undo reverses the whole turn once; ratings stay off the replayed messages", async () => {
  const { app, user, run, turn } = setup();
  const end = done(
    await run(
      new FakeClaude([
        message([call("tu_1", "add_note", { body: "a" }), call("tu_2", "add_note", { body: "b" })], "tool_use"),
        message([call("tu_3", "edit_note", { id: 1, body: "A" })], "tool_use"),
        message([say("Done.")], "end_turn"),
      ]),
      "add two",
    ),
  );
  expect(app.db.select().from(notes).all().map((n) => n.body)).toEqual(["A", "b"]);
  expect(undoTurn(app.db, user, end.turn.id).undoneAt).not.toBeNull();
  expect(app.db.select().from(notes).all()).toEqual([]);
  undoTurn(app.db, user, end.turn.id); // a second undo does nothing

  const before = JSON.stringify(turn(end.turn.id).messages);
  expect(rateTurn(app.db, user, end.turn.id, -1, " wrong item ")).toMatchObject({ rating: -1, ratingNote: "wrong item" });
  expect(rateTurn(app.db, user, end.turn.id, 1)).toMatchObject({ rating: 1, ratingNote: null });
  expect(JSON.stringify(turn(end.turn.id).messages)).toBe(before);
  expect(() => undoTurn(app.db, devUser(app.db, "Bob"), end.turn.id)).toThrow("No turn");
});

test("a turn left running for too long reads as an error", async () => {
  const { app, user } = setup();
  const thread = app.db.insert(schema.threads).values({ userId: user.id, scope: DAY, model: "m" }).returning().get();
  app.db.insert(schema.turns).values({ threadId: thread.id, status: "running", createdAt: new Date(Date.now() - 11 * 60_000) }).run();
  app.db.insert(schema.turns).values({ threadId: thread.id, status: "running" }).run();
  expect(scopeTurns(app.db, agent, user, DAY).map((t) => t.status)).toEqual(["error", "running"]);
});

test("photos are stored as references and sent as image data", async () => {
  const { app, user, run, turn } = setup();
  const png = Buffer.from("not really a png");
  const one = saveFile(app.db, app.config.dataDir, { userId: user.id, mediaType: "image/png", data: png });
  const two = saveFile(app.db, app.config.dataDir, { userId: user.id, mediaType: "image/png", data: png });
  const client = new FakeClaude([message([say("Two photos.")], "end_turn")]);
  const end = done(await run(client, "", { fileIds: [one.id, two.id] }));
  expect(end.turn.file_ids).toEqual([one.id, two.id]);
  expect(turn(end.turn.id).messages[0]).toEqual({
    role: "user",
    content: [
      { type: "text", text: "Photo 1:" },
      { type: "image", source: { type: "file_ref", file_id: one.id } },
      { type: "text", text: "Photo 2:" },
      { type: "image", source: { type: "file_ref", file_id: two.id } },
      { type: "text", text: `Day: ${DAY} (first turn)\n\n(photo only, no message)` },
    ],
  });
  expect(client.requests[0]!.messages[0].content[1]).toEqual({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
  });

  // a photo that is gone from disk doesn't break the thread
  fs.rmSync(`${app.config.dataDir}/files`, { recursive: true });
  const later = new FakeClaude([message([say("Ok.")], "end_turn")]);
  await run(later, "and now?", { threadId: end.turn.thread_id });
  expect(later.requests[0]!.messages[0].content[1]).toEqual({ type: "text", text: "(photo no longer available)" });

  // someone else's photo can't be attached
  const bob = devUser(app.db, "Bob");
  const theirs = saveFile(app.db, app.config.dataDir, { userId: bob.id, mediaType: "image/png", data: png });
  const events = await run(new FakeClaude([]), "look", { fileIds: [theirs.id] });
  expect(events).toEqual([{ type: "error", message: expect.stringContaining("Something went wrong") }]);
});
