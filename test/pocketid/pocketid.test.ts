/**
 * Sign-in for real: a Pocket ID container, the whole app in front of it, a browser for the person
 * and a client that plays claude.ai's part (registers itself, asks for no scopes, sends the
 * `resource` parameter Pocket ID rejects, uses claude.ai's callback address).
 *
 * This is the test that says the OAuth proxy the MCP server depends on still works. Run it after
 * changing fastmcp, Pocket ID's version below, or anything in mcp.ts or auth.ts:
 *
 *   npm run test:pocketid        (needs Docker)
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freePort, testApp } from "../helpers.js";

const IMAGE = process.env.POCKET_ID_IMAGE ?? "ghcr.io/pocket-id/pocket-id:v2";
const API_KEY = "warren-test-static-api-key-0123456789";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CONTAINER = `warren-pocketid-${process.pid}`;

let pocketId: string;
let base: string;
let app: ReturnType<typeof testApp>;
let env: Record<string, string>;
let browser: Browser;
let page: BrowserContext;
let userId: string;

const admin = async (path: string, body?: unknown) => {
  const res = await fetch(`${pocketId}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-api-key": API_KEY, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Pocket ID ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
};

beforeAll(async () => {
  const idPort = await freePort();
  const appPort = await freePort();
  pocketId = `http://localhost:${idPort}`;
  base = `http://localhost:${appPort}`;
  execFileSync("docker", [
    "run", "-d", "--rm", "--name", CONTAINER, "--network", "host",
    "-e", `APP_URL=${pocketId}`, "-e", `PORT=${idPort}`,
    "-e", `ENCRYPTION_KEY=${crypto.randomBytes(32).toString("base64")}`,
    "-e", `STATIC_API_KEY=${API_KEY}`, "-e", "ANALYTICS_DISABLED=true",
    IMAGE,
  ]);
  for (let i = 0; ; i++) {
    const up = await fetch(`${pocketId}/.well-known/openid-configuration`).then((r) => r.ok, () => false);
    if (up) break;
    if (i > 60) throw new Error("Pocket ID didn't start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const user = await admin("/users", {
    username: "alice", email: "alice@example.com", firstName: "Alice", lastName: "Tan",
    displayName: "Alice Tan", isAdmin: false,
  });
  userId = user.id;
  // One Pocket ID client serves both flows; it needs both callback URLs.
  const client = await admin("/oidc/clients", {
    name: "notes", callbackURLs: [`${base}/auth/web/callback`, `${base}/oauth/callback`],
    logoutCallbackURLs: [], isPublic: false, pkceEnabled: false,
  });
  env = {
    PORT: String(appPort), HOST: "127.0.0.1", PUBLIC_URL: base, DEV_LOGIN: "false",
    OIDC_ISSUER: pocketId, OIDC_CLIENT_ID: client.id, OIDC_CLIENT_SECRET: client.createdSecret.secret,
    MCP_ALLOWED_REDIRECT_URIS: CALLBACK,
  };
  app = testApp({}, env);
  await app.start();

  // Anything outside this machine goes to a dead proxy: the redirect to claude.ai is read, never followed.
  browser = await chromium.launch({ proxy: { server: "http://127.0.0.1:1", bypass: "localhost,127.0.0.1" } });
  page = await browser.newContext();
  const { token } = await admin(`/users/${userId}/one-time-access-token`, { ttl: "1h" });
  const tab = await page.newPage();
  await tab.goto(`${pocketId}/lc/${token}`);
  await tab.waitForLoadState("networkidle");
  await tab.close();
});

afterAll(async () => {
  await browser?.close();
  await app?.stop().catch(() => {});
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    // already gone
  }
});

/** The first time a client is used, Pocket ID asks the person to agree. Click that once per screen. */
async function agreeAtPocketId(tab: Page, done: () => boolean): Promise<void> {
  const clicked = new Set<string>();
  for (let i = 0; i < 20 && !done(); i++) {
    await tab.waitForLoadState("networkidle").catch(() => {});
    if (done()) return;
    const url = tab.url();
    const button = url.startsWith(pocketId)
      ? tab.getByRole("button", { name: "Sign in", exact: true })
      : tab.getByRole("button", { name: /^(approve|allow)/i }).first(); // the proxy's own consent page
    if (!clicked.has(url) && (await button.count())) {
      clicked.add(url);
      await button.click().catch(() => {});
    }
    await tab.waitForTimeout(700);
  }
}

async function rpc(token: string | null, method: string, params: unknown) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") || text;
  let body: any = null;
  try {
    body = JSON.parse(data);
  } catch {
    // an auth failure has no JSON body
  }
  return { status: res.status, header: res.headers.get("www-authenticate") ?? "", body };
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

/** What claude.ai does when a connector is added, up to holding a code. */
async function connect() {
  const refused = await rpc(null, "tools/list", {});
  expect(refused.status).toBe(401);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(refused.header)?.[1];
  expect(metadataUrl).toBeTruthy();
  const resource = (await (await fetch(metadataUrl!)).json()) as any;
  const issuer = String(resource.authorization_servers[0]).replace(/\/$/, "");
  const meta = (await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json()) as any;

  const registered = (await (
    await fetch(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], token_endpoint_auth_method: "none",
      }),
    })
  ).json()) as any;
  expect(registered.client_id).toBeTruthy();

  const verifier = crypto.randomBytes(32).toString("base64url");
  const state = crypto.randomBytes(8).toString("hex");
  const authorize = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({
    response_type: "code", client_id: registered.client_id, redirect_uri: CALLBACK,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", state,
    // claude.ai sends this and requests no scope
    resource: `${base}/mcp`,
  })) authorize.searchParams.set(k, v);

  const tab = await page.newPage();
  let landed: URL | null = null;
  tab.on("response", (r) => {
    const to = r.headers()["location"];
    if (r.status() >= 300 && r.status() < 400 && to?.startsWith(CALLBACK)) landed = new URL(to);
  });
  await tab.goto(authorize.href).catch(() => {});
  await agreeAtPocketId(tab, () => landed !== null);
  await tab.close();
  expect(landed, "sign-in should end at claude.ai's callback").not.toBeNull();
  expect(landed!.searchParams.get("state")).toBe(state);
  return { meta, clientId: registered.client_id as string, verifier, code: landed!.searchParams.get("code")! };
}

async function exchange(c: Awaited<ReturnType<typeof connect>>) {
  const res = await fetch(
    c.meta.token_endpoint,
    form({
      grant_type: "authorization_code", code: c.code, redirect_uri: CALLBACK,
      client_id: c.clientId, code_verifier: c.verifier, resource: `${base}/mcp`,
    }),
  );
  return (await res.json()) as any;
}

let tokens: any;
let connection: Awaited<ReturnType<typeof connect>>;

test("an MCP client can't register a redirect address that isn't listed", async () => {
  const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as any;
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "x", redirect_uris: ["https://evil.example.com/cb"], token_endpoint_auth_method: "none" }),
  });
  expect(res.ok).toBe(false);
});

test("a code can't be redeemed without its PKCE verifier", async () => {
  const c = await connect();
  const stolen = await exchange({ ...c, verifier: "wrong-verifier-wrong-verifier-wrong-verifier-wrong" });
  expect(stolen.access_token).toBeUndefined();
});

test("claude.ai can connect, but a person who never signed in to the app has no account", async () => {
  connection = await connect();
  tokens = await exchange(connection);
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
  const out = await rpc(tokens.access_token, "tools/call", { name: "list_notes", arguments: { day: "2026-03-03" } });
  expect(JSON.stringify(out.body)).toContain("Sign in to notes in a browser once");
});

test("the person signs in to the web app through Pocket ID", async () => {
  const tab = await page.newPage();
  await tab.goto(`${base}/auth/login`);
  await agreeAtPocketId(tab, () => tab.url() === `${base}/`);
  expect(tab.url()).toBe(`${base}/`);
  const me = await tab.evaluate(() => fetch("/api/me").then((r) => r.json()));
  expect(me).toMatchObject({ name: "Alice Tan", email: "alice@example.com" });
  await tab.close();
});

test("the same MCP token now acts as that person", async () => {
  const out = await rpc(tokens.access_token, "tools/call", { name: "list_notes", arguments: { day: "2026-03-03" } });
  expect(out.body.result.content).toEqual([{ type: "text", text: "No notes" }]);
  const forged = await rpc(`${tokens.access_token.slice(0, -4)}AAAA`, "tools/list", {});
  expect(forged.status).toBe(401);
});

test("tokens refresh, and survive a restart of the app", async () => {
  const refresh = (token: string) =>
    fetch(connection.meta.token_endpoint, form({ grant_type: "refresh_token", refresh_token: token, client_id: connection.clientId }))
      .then((r) => r.json() as Promise<any>);
  const renewed = await refresh(tokens.refresh_token);
  expect(renewed.access_token).toBeTruthy();
  expect((await rpc(renewed.access_token, "tools/list", {})).status).toBe(200);

  const dataDir = app.config.dataDir;
  await app.stop();
  app = testApp({ config: { ...app.config, dataDir } }, env);
  await app.start();

  expect((await rpc(renewed.access_token, "tools/list", {})).status).toBe(200);
  const again = await refresh(renewed.refresh_token ?? tokens.refresh_token);
  expect(again.access_token).toBeTruthy();
  const out = await rpc(again.access_token, "tools/call", { name: "list_notes", arguments: { day: "2026-03-03" } });
  expect(out.body.result.content).toEqual([{ type: "text", text: "No notes" }]);
});
