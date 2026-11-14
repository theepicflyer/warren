import { expect, test } from "vitest";
import { noChanges, runTool, toolSchemas, toolsFor, type ToolContext, devUser } from "../src/server/index.js";
import { notes, testApp, tools } from "./helpers.js";

function context(via: "agent" | "mcp" = "agent"): ToolContext & { app: ReturnType<typeof testApp> } {
  const app = testApp();
  return {
    app,
    db: app.db,
    user: devUser(app.db, "Alice"),
    now: new Date(),
    via,
    scope: "2026-03-03",
    changes: noChanges,
    touched: new Set(),
    fileIds: [],
  };
}

test("tool schemas are sorted by name and identical on every build", () => {
  const first = toolSchemas(tools);
  expect(first.map((t) => t.name)).toEqual(["add_note", "edit_note", "list_notes"]);
  expect(JSON.stringify(toolSchemas([...tools].reverse()))).toBe(JSON.stringify(first));
  expect(first[0]!.input_schema).toEqual({
    type: "object",
    properties: { body: { type: "string", minLength: 1 } },
    required: ["body"],
    additionalProperties: false,
  });
});

test("each audience sees only its tools", () => {
  expect(toolsFor(tools, "mcp").map((t) => t.name)).toEqual(["list_notes"]);
  const out = runTool(tools, context("mcp"), "add_note", { body: "x" });
  expect(out).toEqual({ text: "Unknown tool add_note", isError: true });
});

test("bad input comes back as an error the model can read", () => {
  const out = runTool(tools, context(), "add_note", { body: "", extra: 1 });
  expect(out.isError).toBe(true);
  expect(out.text).toMatch(/^Invalid input: /);
  expect(out.text).toContain("body");
});

test("a tool that fails leaves nothing behind", () => {
  const ctx = context();
  expect(runTool(tools, ctx, "add_note", { body: "explode" })).toEqual({
    text: "Error: Failed after writing",
    isError: true,
  });
  expect(ctx.app.db.select().from(notes).all()).toEqual([]);
  expect(runTool(tools, ctx, "add_note", { body: "milk" }).text).toBe("Added #1 milk");
});
