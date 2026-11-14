import { afterAll, beforeAll, expect, test } from "vitest";
import { devUser } from "../src/server/index.js";
import { freePort, notes, testApp } from "./helpers.js";

let app: ReturnType<typeof testApp>;
let base: string;

beforeAll(async () => {
  const port = await freePort();
  app = testApp({}, { PORT: String(port), HOST: "127.0.0.1", MCP_DEV_USER: "Alice" });
  base = `http://127.0.0.1:${port}`;
  await app.start();
});
afterAll(() => app.stop());

async function mcp(method: string, params: unknown) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") || text;
  return { status: res.status, body: JSON.parse(data) };
}

test("the API and MCP are served from one port", async () => {
  expect((await (await fetch(`${base}/api/health`)).json()).ok).toBe(true);
  const listed = await mcp("tools/list", {});
  expect(listed.status).toBe(200);
  // only the tools exposed to MCP, with read-only ones marked
  expect(listed.body.result.tools.map((t: { name: string }) => t.name)).toEqual(["list_notes"]);
  expect(listed.body.result.tools[0].annotations.readOnlyHint).toBe(true);
});

test("an MCP tool call runs the same tool as the agent, as the signed-in person", async () => {
  const alice = devUser(app.db, "Alice");
  app.db.insert(notes).values({ userId: alice.id, day: "2026-03-03", body: "milk" }).run();
  app.db.insert(notes).values({ userId: devUser(app.db, "Bob").id, day: "2026-03-03", body: "secret" }).run();
  const out = await mcp("tools/call", { name: "list_notes", arguments: { day: "2026-03-03" } });
  expect(out.body.result.content).toEqual([{ type: "text", text: "#1 milk" }]);

  const bad = await mcp("tools/call", { name: "list_notes", arguments: { day: 5 } });
  expect(JSON.stringify(bad.body)).toContain("day");
  expect(bad.body.result?.isError ?? !!bad.body.error).toBe(true);
});
