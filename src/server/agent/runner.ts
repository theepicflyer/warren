/**
 * The agent loop: one user message in, tool calls against the app's data, a short reply out.
 *
 * Rules that keep it cheap and correct (tests assert them):
 * - The system prompt is frozen text and tools are sorted by name, so the cached prefix is
 *   byte-identical across users and turns. Per-turn context goes in the user message.
 * - History is append-only. A turn's messages are stored exactly as sent and returned, and
 *   replayed unchanged; only "ok" turns are replayed.
 * - A thinking block is bound to the prompt, tools and messages it was made with. A release that
 *   changes the prompt or tools would fail every older thread, so stale blocks are dropped.
 * - Thinking is adaptive and effort is the only dial.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import { turnChanges, undoChanges } from "../changes.js";
import type { Db } from "../db.js";
import { readFile } from "../files.js";
import { changes, files, threads, turns, type Thread, type Turn, type User, users } from "../schema.js";
import { DomainError, runTool, type Tool, type ToolContext, toolSchemas } from "../tools.js";
import { addUsage, type ApiUsage, cost, emptyUsage } from "./pricing.js";

/** Models that take server-side refusal fallbacks (`fallbacks: "default"`). Haiku has none. */
export const FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-fable-5-2",
  "claude-fable-5-1",
]);
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const BINDING_BETA = "thinking-binding-controls-2026-08-01";

export interface AgentConfig {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  cache: boolean;
  cacheTtl: "5m" | "1h";
  maxIterations: number;
}

export const AGENT_DEFAULTS = { cache: true, cacheTtl: "5m", maxIterations: 8 } as const;

export interface ContextArgs {
  db: Db;
  user: User;
  scope: string;
  now: Date;
  /** True for the thread's first replayable turn. */
  firstTurn: boolean;
  /** What `context` returned as `state` the last time a turn in this thread succeeded. */
  state: Record<string, unknown>;
}

export interface AgentDefinition {
  /** Frozen text. Never interpolate dates, names or data into it. */
  systemPrompt: string;
  tools: readonly Tool[];
  /**
   * Per-turn context, put before the person's words in the user message. `state` is saved on the
   * thread when the turn succeeds, so the next turn can leave out what the model already has.
   */
  context?(args: ContextArgs): { text: string; state?: Record<string, unknown> };
  /** Extra fields for a change shown in the web app (a name, an amount). */
  describeChange?(change: { table: string; action: string; rowId: number; row: Record<string, unknown> }): Record<string, unknown>;
  replies?: Partial<typeof DEFAULT_REPLIES>;
}

export const DEFAULT_REPLIES = {
  refused: "Sorry, I couldn't process that one.",
  tooLong: "That was too long for me to finish. Try splitting it into smaller messages.",
  stopped: "I stopped before finishing. Check what was saved and tell me what's missing.",
  unavailable: "The assistant is unavailable right now",
  failed: "Something went wrong. Nothing after the last confirmed change was saved.",
  filesOnly: "(photo only, no message)",
};

/** The part of the Anthropic client the runner uses; tests pass a fake. */
export interface AgentClient {
  beta: {
    messages: {
      stream(params: Record<string, unknown>): AsyncIterable<unknown> & {
        finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
      };
    };
  };
}

export interface TurnInput {
  userId: number;
  scope: string;
  text: string;
  fileIds?: number[];
  threadId?: number | null;
  now?: Date;
}

export interface AgentDeps {
  db: Db;
  dataDir: string;
  agent: AgentDefinition;
  config: AgentConfig;
  client: AgentClient;
  appVersion?: string;
}

export type AgentEvent =
  | { type: "turn"; turn_id: number; thread_id: number }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "changed"; touched: string[] }
  | { type: "done"; turn: SerializedTurn; touched: string[] }
  | { type: "error"; message: string };

type Message = { role: "user" | "assistant"; content: unknown };
type Block = Record<string, any>;

function cacheControl(config: AgentConfig): Record<string, string> {
  return config.cacheTtl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

/** A stored reference to an uploaded file; swapped for the image data when a request is built. */
function fileRef(fileId: number): Block {
  return { type: "image", source: { type: "file_ref", file_id: fileId } };
}

function isFileRef(block: Block): boolean {
  return block?.type === "image" && block.source?.type === "file_ref";
}

function hasFileRef(blocks: unknown): boolean {
  return (
    Array.isArray(blocks) &&
    blocks.some((b: Block) => isFileRef(b) || (b?.type === "tool_result" && hasFileRef(b.content)))
  );
}

function hydrate(messages: Message[], db: Db, dataDir: string, cache: Map<number, Block>): Message[] {
  const swap = (blocks: Block[]): Block[] =>
    blocks.map((block) => {
      if (block?.type === "tool_result" && hasFileRef(block.content)) return { ...block, content: swap(block.content) };
      if (!isFileRef(block)) return block;
      const id = block.source.file_id as number;
      if (!cache.has(id)) {
        const file = db.select().from(files).where(eq(files.id, id)).get();
        const data = file ? readFile(dataDir, file) : null;
        cache.set(
          id,
          file && data
            ? { type: "image", source: { type: "base64", media_type: file.mediaType, data: data.toString("base64") } }
            : { type: "text", text: "(photo no longer available)" },
        );
      }
      return cache.get(id)!;
    });
  return messages.map((msg) => (hasFileRef(msg.content) ? { ...msg, content: swap(msg.content as Block[]) } : msg));
}

function getThread(db: Db, user: User, scope: string, model: string, threadId?: number | null): Thread {
  if (threadId != null) {
    const found = db
      .select()
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.userId, user.id), eq(threads.scope, scope)))
      .get();
    if (found) return found;
  }
  return db.insert(threads).values({ userId: user.id, scope, model }).returning().get();
}

export function describeError(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  return `${e.name}: ${e.message}`.slice(0, 500);
}

function markFailed(db: Db, turnId: number | undefined, err: unknown): void {
  if (turnId === undefined) return;
  try {
    const turn = db.select().from(turns).where(eq(turns.id, turnId)).get();
    if (!turn) return;
    db.update(turns)
      .set({ status: "error", error: describeError(err), replyText: turn.replyText || "Something went wrong." })
      .where(eq(turns.id, turnId))
      .run();
  } catch {
    // best effort while already handling a failure
  }
}

/** Run one agent turn, yielding events for the web app. The last event is `done` or `error`. */
export async function* runTurn(deps: AgentDeps, input: TurnInput): AsyncGenerator<AgentEvent> {
  const { db, agent, config, client } = deps;
  const replies = { ...DEFAULT_REPLIES, ...agent.replies };
  const now = input.now ?? new Date();
  const fileIds = input.fileIds ?? [];
  let turnId: number | undefined;
  try {
    const user = db.select().from(users).where(eq(users.id, input.userId)).get();
    if (!user) throw new Error(`no user ${input.userId}`);
    if (fileIds.length) {
      const owned = db
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, fileIds), eq(files.userId, user.id)))
        .all();
      if (owned.length !== new Set(fileIds).size) throw new Error("a file isn't this user's");
    }
    const thread = getThread(db, user, input.scope, config.model, input.threadId);
    const prior = db
      .select()
      .from(turns)
      .where(and(eq(turns.threadId, thread.id), eq(turns.status, "ok")))
      .orderBy(asc(turns.id))
      .all();
    const context = agent.context?.({
      db,
      user,
      scope: input.scope,
      now,
      firstTurn: prior.length === 0,
      state: thread.state,
    });

    const content: Block[] = [];
    fileIds.forEach((id, i) => {
      if (fileIds.length > 1) content.push({ type: "text", text: `Photo ${i + 1}:` });
      content.push(fileRef(id));
    });
    const words = input.text.trim() || replies.filesOnly;
    content.push({ type: "text", text: context?.text ? `${context.text}\n\n${words}` : words });

    const turnMessages: Message[] = [{ role: "user", content }];
    const turn = db
      .insert(turns)
      .values({
        threadId: thread.id,
        userText: input.text,
        messages: turnMessages,
        status: "running",
        appVersion: deps.appVersion || null,
      })
      .returning()
      .get();
    turnId = turn.id;
    yield { type: "turn", turn_id: turn.id, thread_id: thread.id };

    const history = prior.flatMap((t) => t.messages as Message[]);
    const fileCache = new Map<number, Block>();
    const usage = emptyUsage();
    const ctx: ToolContext = {
      db,
      user,
      now,
      via: "agent",
      scope: input.scope,
      changes: turnChanges(db, turn.id),
      touched: new Set(),
      fileIds,
    };
    let replyParts: string[] = [];
    let status: Turn["status"] = "ok";
    let error: string | null = null;
    let modelUsed = config.model;

    const system: Block[] = [{ type: "text", text: agent.systemPrompt }];
    const params: Record<string, unknown> = {
      model: config.model,
      max_tokens: config.maxTokens,
      tools: toolSchemas(agent.tools),
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: config.effort },
    };
    const betas = [BINDING_BETA];
    if (config.cache) {
      system[0]!.cache_control = cacheControl(config);
      params.cache_control = cacheControl(config);
    }
    if (FALLBACK_MODELS.has(config.model)) {
      params.fallbacks = "default";
      betas.push(FALLBACK_BETA);
    }
    params.system = system;

    let finished = false;
    for (let i = 0; i < config.maxIterations; i++) {
      const messages = hydrate([...history, ...turnMessages], db, deps.dataDir, fileCache);
      const stream = client.beta.messages.stream({ ...params, messages, betas });
      for await (const event of stream) {
        const ev = event as Block;
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          yield { type: "text", delta: ev.delta.text as string };
        }
      }
      const final = await stream.finalMessage();
      addUsage(usage, final.usage as ApiUsage);
      for (const t of (final as Block).input_transformations ?? []) {
        console.info(`warren: thread ${thread.id}: dropped ${t.path} (${t.reason})`);
      }
      modelUsed = final.model || config.model;
      turnMessages.push({ role: "assistant", content: final.content });
      const texts = final.content.flatMap((b) => (b.type === "text" ? [b.text] : []));

      if (final.stop_reason === "refusal") {
        replyParts = [replies.refused];
        status = "refused";
        finished = true;
        break;
      }
      const toolUses = final.content.filter((b) => b.type === "tool_use");
      if (final.stop_reason === "max_tokens" && toolUses.length) {
        // A tool input cut off at the limit can parse as a valid partial object; never run it.
        turnMessages.pop();
        replyParts = [replies.tooLong];
        status = "error";
        error = "max_tokens reached with tool calls pending";
        finished = true;
        break;
      }
      if (!toolUses.length) {
        replyParts = texts;
        finished = true;
        break;
      }
      if (texts.length) yield { type: "text", delta: "\n" };

      const results: Block[] = [];
      let wrote = false;
      for (const block of toolUses) {
        yield { type: "tool", name: block.name };
        const outcome = runTool(agent.tools, ctx, block.name, block.input);
        const tool = agent.tools.find((t) => t.name === block.name);
        if (tool?.writes && !outcome.isError) wrote = true;
        const content = outcome.images
          ? [
              { type: "text", text: outcome.text },
              ...outcome.images.flatMap((image) => [{ type: "text", text: image.label }, fileRef(image.fileId)]),
            ]
          : outcome.text;
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      // All results go back in one user message, or the model stops making parallel calls.
      turnMessages.push({ role: "user", content: results });
      db.update(turns).set({ messages: turnMessages }).where(eq(turns.id, turn.id)).run();
      if (wrote) yield { type: "changed", touched: [...ctx.touched].sort() };
    }
    if (!finished) {
      replyParts = [replies.stopped];
      status = "error";
      error = `stopped after ${config.maxIterations} model calls`;
    }

    db.transaction((tx) => {
      tx.update(turns)
        .set({
          messages: turnMessages,
          replyText: replyParts
            .map((p) => p.trim())
            .filter(Boolean)
            .join("\n"),
          usage: { ...usage, model: modelUsed },
          costUsd: cost(modelUsed, usage),
          // Only "ok" turns are replayed as history; the others may end mid tool call.
          status,
          error,
        })
        .where(eq(turns.id, turn.id))
        .run();
      if (status === "ok" && context?.state) {
        tx.update(threads).set({ state: context.state }).where(eq(threads.id, thread.id)).run();
      }
    });
    const saved = db.select().from(turns).where(eq(turns.id, turn.id)).get()!;
    yield { type: "done", turn: serializeTurn(db, agent, saved), touched: [...ctx.touched].sort() };
  } catch (err) {
    console.error("warren: agent turn failed", err);
    markFailed(db, turnId, err);
    yield {
      type: "error",
      message: err instanceof APIError ? `${replies.unavailable} (${err.name}).` : replies.failed,
    };
  }
}

// --- reading turns back -------------------------------------------------------------------------

export interface SerializedTurn {
  id: number;
  thread_id: number;
  user_text: string;
  file_ids: number[];
  reply_text: string;
  status: Turn["status"];
  undone: boolean;
  rating: number | null;
  rating_note: string | null;
  changes: Record<string, unknown>[];
  cost_usd: number;
  created_at: string;
}

/** The files sent with a turn, read from its stored user message. */
export function turnFileIds(turn: Turn): number[] {
  const first = (turn.messages as Message[])[0];
  if (!first || !Array.isArray(first.content)) return [];
  return (first.content as Block[]).filter(isFileRef).map((b) => b.source.file_id as number);
}

export function serializeTurn(db: Db, agent: AgentDefinition, turn: Turn): SerializedTurn {
  const rows = db.select().from(changes).where(eq(changes.turnId, turn.id)).orderBy(asc(changes.id)).all();
  return {
    id: turn.id,
    thread_id: turn.threadId,
    user_text: turn.userText,
    file_ids: turnFileIds(turn),
    reply_text: turn.replyText,
    status: turn.status,
    undone: turn.undoneAt !== null,
    rating: turn.rating,
    rating_note: turn.ratingNote,
    changes: rows.map((ch) => ({
      table: ch.table,
      action: ch.action,
      row_id: ch.rowId,
      ...agent.describeChange?.({
        table: ch.table,
        action: ch.action,
        rowId: ch.rowId,
        row: ch.after ?? ch.before ?? {},
      }),
    })),
    cost_usd: Math.round(turn.costUsd * 1e5) / 1e5,
    created_at: turn.createdAt.toISOString(),
  };
}

function ownTurn(db: Db, user: User, turnId: number): Turn {
  const row = db
    .select({ turn: turns })
    .from(turns)
    .innerJoin(threads, eq(turns.threadId, threads.id))
    .where(and(eq(turns.id, turnId), eq(threads.userId, user.id)))
    .get();
  if (!row) throw new DomainError(`No turn ${turnId}`);
  return row.turn;
}

export function undoTurn(db: Db, user: User, turnId: number, now = new Date()): Turn {
  return db.transaction((tx) => {
    const turn = ownTurn(tx as Db, user, turnId);
    if (turn.undoneAt === null) {
      undoChanges(tx as Db, turn.id);
      tx.update(turns).set({ undoneAt: now }).where(eq(turns.id, turn.id)).run();
    }
    return ownTurn(tx as Db, user, turnId);
  });
}

/**
 * Thumbs up (1), down (-1) or neither (null). Kept on the turn, outside the messages the agent
 * replays. Only a thumbs down keeps a note; `note === undefined` leaves the one it has.
 */
export function rateTurn(
  db: Db,
  user: User,
  turnId: number,
  rating: 1 | -1 | null,
  note?: string | null,
  now = new Date(),
): Turn {
  const turn = ownTurn(db, user, turnId);
  let ratingNote = turn.ratingNote;
  if (rating !== -1) ratingNote = null;
  else if (note !== undefined) ratingNote = note?.trim().slice(0, 1000) || null;
  db.update(turns)
    .set({ rating, ratingNote, ratedAt: rating === null ? null : now })
    .where(eq(turns.id, turn.id))
    .run();
  return ownTurn(db, user, turnId);
}

/** A turn still "running" after this long was cut off (a restart) and never finished. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

/** Every turn of the user's threads about `scope`, oldest first, for showing the conversation. */
export function scopeTurns(
  db: Db,
  agent: AgentDefinition,
  user: User,
  scope: string,
  now = new Date(),
): SerializedTurn[] {
  const rows = db
    .select({ turn: turns })
    .from(turns)
    .innerJoin(threads, eq(turns.threadId, threads.id))
    .where(and(eq(threads.userId, user.id), eq(threads.scope, scope)))
    .orderBy(asc(turns.id))
    .all();
  return rows.map(({ turn }) => {
    const item = serializeTurn(db, agent, turn);
    if (turn.status === "running" && now.getTime() - turn.createdAt.getTime() > STALE_RUNNING_MS) {
      item.status = "error";
    }
    return item;
  });
}
