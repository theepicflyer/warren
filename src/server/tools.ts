/**
 * Tools: the operations an app offers to Claude, defined once. The in-app agent and the MCP
 * server both run them through `runTool`, so validation, transactions and errors behave the same.
 */
import { z } from "zod";
import type { ChangeLog } from "./changes.js";
import type { Db } from "./db.js";
import type { User } from "./schema.js";

/** Something the person (or the model) can fix: bad input, a rule broken. Its message is shown. */
export class DomainError extends Error {
  override name = "DomainError";
}

export interface ToolContext {
  db: Db;
  user: User;
  now: Date;
  /** Who is calling: the in-app agent or an MCP client. */
  via: "agent" | "mcp";
  /** What the agent's conversation is about (the app's own notion: a date, "ledger"); null over MCP. */
  scope: string | null;
  /** Records writes so an agent turn can be undone. */
  changes: ChangeLog;
  /** Keys of what a write touched (dates, months), so the web app knows what to reload. */
  touched: Set<string>;
  /** Ids of the files sent with the message, in order. */
  fileIds: number[];
}

export type ToolResult = string | Record<string, unknown> | unknown[];

export interface Tool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: Schema;
  /** True if it changes data. Read-only tools are marked so for MCP clients. */
  writes: boolean;
  /** Where it is offered. Most tools suit one audience: the agent wants compact text, MCP wants data. */
  expose: readonly ("agent" | "mcp")[];
  /** Runs inside a transaction that is rolled back if it throws. Synchronous, like all domain code. */
  run(ctx: ToolContext, input: z.infer<Schema>): ToolResult;
}

export function defineTool<Schema extends z.ZodType>(tool: Tool<Schema>): Tool<Schema> {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) throw new Error(`bad tool name ${tool.name}`);
  return tool;
}

export function toolsFor(tools: readonly Tool[], audience: "agent" | "mcp"): Tool[] {
  const out = tools.filter((t) => t.expose.includes(audience));
  const names = new Set(out.map((t) => t.name));
  if (names.size !== out.length) throw new Error(`duplicate tool names for ${audience}`);
  // Sorted by name so the request prefix is byte-identical however the app lists them.
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
}

/** The tool list as the Messages API takes it. */
export function toolSchemas(tools: readonly Tool[]): ToolSchema[] {
  return toolsFor(tools, "agent").map((t) => {
    const { $schema: _, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    if (schema.type !== "object") throw new Error(`tool ${t.name}: input must be an object`);
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as ToolSchema["input_schema"],
    };
  });
}

export function resultText(result: ToolResult): string {
  return typeof result === "string" ? result : JSON.stringify(result);
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

/**
 * Run one tool call. Bad input and `DomainError`s come back as an error result the model can read
 * and correct; anything else is a bug and propagates.
 */
export function runTool(
  tools: readonly Tool[],
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
): ToolOutcome {
  const tool = tools.find((t) => t.name === name && t.expose.includes(ctx.via));
  if (!tool) return { text: `Unknown tool ${name}`, isError: true };
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return { text: `Invalid input: ${problems}`, isError: true };
  }
  try {
    const result = ctx.db.transaction((tx) => tool.run({ ...ctx, db: tx as Db }, parsed.data));
    return { text: resultText(result), isError: false };
  } catch (err) {
    if (err instanceof DomainError) return { text: `Error: ${err.message}`, isError: true };
    throw err;
  }
}
