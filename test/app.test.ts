import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { DomainError } from "../src/server/index.js";
import { call, FakeClaude, message, notes, say, testApp, testConfig } from "./helpers.js";

const json = { "content-type": "application/json", "x-warren": "1" };

async function signedIn(app: ReturnType<typeof testApp>, name = "Alice") {
  const res = await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name }) });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return (url: string, init: RequestInit = {}) =>
    app.http.request(url, { ...init, headers: { ...json, cookie, ...(init.headers as object) } });
}

test("health reports the app and when it was last snapshotted", async () => {
  const app = testApp();
  const res = await app.http.request("/api/health");
  expect(await res.json()).toEqual({ ok: true, app: "notes", version: null, last_snapshot_at: null });
});

test("writes need the app header, and the API needs a signed-in user", async () => {
  const app = testApp();
  const bare = await app.http.request("/api/auth/dev-login", { method: "POST", body: "{}" });
  expect(bare.status).toBe(403);
  expect((await app.http.request("/api/me")).status).toBe(401);
  expect((await app.http.request("/api/agent/turns?scope=x")).status).toBe(401);

  const get = await signedIn(app);
  expect(await (await get("/api/me")).json()).toMatchObject({ name: "Alice", email: "alice@dev.local" });
  expect((await get("/api/nope")).status).toBe(404);

  const out = await get("/api/auth/logout", { method: "POST" });
  expect(out.headers.get("set-cookie")).toContain("notes_session=;");
  const forged = await app.http.request("/api/me", { headers: { cookie: "notes_session=1.bad" } });
  expect(forged.status).toBe(401);
});

test("dev login is off unless asked for", async () => {
  const app = testApp({}, { DEV_LOGIN: "false" });
  const res = await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name: "A" }) });
  expect(res.status).toBe(404);
  expect(await (await app.http.request("/api/auth/config")).json()).toEqual({ oidc: false, dev: false });
});

test("a turn streams events to the browser and can be undone and rated", async () => {
  const claude = new FakeClaude([
    message([call("tu_1", "add_note", { body: "milk" })], "tool_use"),
    message([say("Added milk.")], "end_turn"),
  ]);
  const app = testApp({ anthropic: claude });
  const req = await signedIn(app);

  const res = await req("/api/agent/turns", { method: "POST", body: JSON.stringify({ scope: "2026-03-03", text: "add milk" }) });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const events = (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
  expect(events.map((e) => e.type)).toEqual(["turn", "tool", "changed", "text", "done"]);
  const id = events.at(-1).turn.id;

  const listed = await (await req("/api/agent/turns?scope=2026-03-03")).json();
  expect(listed.turns).toHaveLength(1);

  const rated = await (await req(`/api/agent/turns/${id}/rating`, { method: "PUT", body: JSON.stringify({ rating: -1, note: "no" }) })).json();
  expect(rated).toMatchObject({ rating: -1, rating_note: "no" });

  const undone = await (await req(`/api/agent/turns/${id}/undo`, { method: "POST" })).json();
  expect(undone.undone).toBe(true);
  expect(app.db.select().from(notes).all()).toEqual([]);

  const bob = await signedIn(app, "Bob");
  expect((await bob(`/api/agent/turns/${id}/undo`, { method: "POST" })).status).toBe(404);
  expect((await req("/api/agent/turns", { method: "POST", body: JSON.stringify({ scope: "x", text: " " }) })).status).toBe(400);
});

test("without an API key the assistant says so", async () => {
  const app = testApp();
  const req = await signedIn(app);
  const res = await req("/api/agent/turns", { method: "POST", body: JSON.stringify({ scope: "x", text: "hi" }) });
  expect(res.status).toBe(503);
});

async function photo(width: number, height: number): Promise<File> {
  const data = await sharp({ create: { width, height, channels: 3, background: "#c94f3d" } }).png().toBuffer();
  return new File([new Uint8Array(data)], "meal.png", { type: "image/png" });
}

test("an uploaded photo is shrunk, stored as JPEG, and only its owner can read it", async () => {
  const app = testApp();
  const req = await signedIn(app);
  const cookie = (await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name: "Alice" }) })).headers.get("set-cookie")!.split(";")[0]!;
  const send = (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return app.http.request("/api/files", { method: "POST", headers: { "x-warren": "1", cookie }, body: form });
  };
  const { id } = await (await send(await photo(4000, 2000))).json();
  const back = await req(`/api/files/${id}`);
  expect(back.headers.get("content-type")).toBe("image/jpeg");
  const stored = await sharp(Buffer.from(await back.arrayBuffer())).metadata();
  expect([stored.format, stored.width, stored.height]).toEqual(["jpeg", 1568, 784]);
  expect((await (await signedIn(app, "Bob"))(`/api/files/${id}`)).status).toBe(404);

  const bad = await send(new File(["not an image"], "a.txt", { type: "text/plain" }));
  expect([bad.status, (await bad.json()).detail]).toEqual([400, expect.stringContaining("isn't an image")]);
});

test("words and photos can be sent to the agent in one request", async () => {
  const claude = new FakeClaude([message([say("A red plate.")], "end_turn")]);
  const app = testApp({ anthropic: claude });
  const cookie = (await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name: "Alice" }) })).headers.get("set-cookie")!.split(";")[0]!;
  const post = (form: FormData) =>
    app.http.request("/api/agent/turns", { method: "POST", headers: { "x-warren": "1", cookie }, body: form });

  const form = new FormData();
  form.set("scope", "2026-03-03");
  form.set("text", "lunch");
  form.append("photos", await photo(300, 200));
  form.append("photos", await photo(200, 300));
  const events = (await (await post(form)).text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  expect(events.at(-1).turn.file_ids).toHaveLength(2);
  const sent = claude.requests[0]!.messages[0].content;
  expect(sent.map((b: { type: string }) => b.type)).toEqual(["text", "image", "text", "image", "text"]);
  expect(sent[1].source.media_type).toBe("image/jpeg");

  const many = new FormData();
  many.set("scope", "2026-03-03");
  for (let i = 0; i < 7; i++) many.append("photos", await photo(10, 10));
  expect((await post(many)).status).toBe(400);
  const junk = new FormData();
  junk.set("scope", "2026-03-03");
  junk.append("photos", new File(["nope"], "x.jpg", { type: "image/jpeg" }));
  expect((await post(junk)).status).toBe(400);
});

test("the built web app is served, with page addresses falling back to its shell", async () => {
  const app = testApp();
  const root = app.config.staticDir;
  fs.mkdirSync(path.join(root, "_app/immutable"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<html>shell</html>");
  fs.writeFileSync(path.join(root, "_app/immutable/a.js"), "console.log(1)");
  fs.writeFileSync(path.join(root, "service-worker.js"), "//sw");
  const html = { accept: "text/html" };

  const shell = await app.http.request("/day/2026-03-03", { headers: html });
  expect(await shell.text()).toBe("<html>shell</html>");
  expect(shell.headers.get("cache-control")).toBe("no-cache");

  const asset = await app.http.request("/_app/immutable/a.js");
  expect(asset.headers.get("content-type")).toContain("javascript");
  expect(asset.headers.get("cache-control")).toContain("immutable");
  expect((await app.http.request("/service-worker.js")).headers.get("cache-control")).toBe("no-cache");

  // not the web app's: missing assets, the MCP and OAuth paths, anything outside the folder
  expect((await app.http.request("/missing.js", { headers: html })).status).toBe(404);
  expect((await app.http.request("/mcp", { headers: html })).status).toBe(404);
  expect((await app.http.request("/oauth/authorize", { headers: html })).status).toBe(404);
  expect((await app.http.request("/..%2Fdata%2Fsecret")).status).toBe(404);
});

test("the app's own routes sit under /api, and a DomainError is a 400 with its message", async () => {
  const app = testApp({
    routes(api, { db }) {
      api.get("/notes/count", (c) => c.json({ count: db.select().from(notes).all().length, user: c.var.user.name }));
      api.post("/notes/fail", () => {
        throw new DomainError("Pick a day first");
      });
      api.post("/notes/bug", () => {
        throw new Error("secret detail");
      });
    },
  });
  expect((await app.http.request("/api/notes/count")).status).toBe(401);
  const req = await signedIn(app);
  expect(await (await req("/api/notes/count")).json()).toEqual({ count: 0, user: "Alice" });
  const failed = await req("/api/notes/fail", { method: "POST" });
  expect([failed.status, await failed.json()]).toEqual([400, { detail: "Pick a day first" }]);
  const bug = await req("/api/notes/bug", { method: "POST" });
  expect([bug.status, await bug.json()]).toEqual([500, { detail: "Something went wrong" }]);
});

test("settings that would open the app up are refused", () => {
  expect(() => testConfig({ PUBLIC_URL: "https://notes.example.com", DEV_LOGIN: "true" })).toThrow("DEV_LOGIN");
  expect(() => testConfig({ PUBLIC_URL: "https://notes.example.com", DEV_LOGIN: "false", MCP_DEV_USER: "Alice" })).toThrow("MCP_DEV_USER");
  expect(() => testConfig({ OIDC_ISSUER: "https://id.example.com" })).toThrow("together");
});
