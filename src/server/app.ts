/**
 * One app: a JSON API, browser sign-in, the built web app, the in-app agent and the MCP server,
 * on one origin, in one process, over one SQLite file.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { FastMCP } from "fastmcp";
import { type Context, Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import { agentRoutes } from "./agent/routes.js";
import { AGENT_DEFAULTS, type AgentClient, type AgentDefinition } from "./agent/runner.js";
import { type AppEnv, createAuth, requireCsrfHeader } from "./auth.js";
import { lastSnapshotAt, snapshot } from "./backup.js";
import { type Config, loadConfig } from "./config.js";
import { DB_FILE, type Database_, type Db, openDatabase, runMigrations } from "./db.js";
import { createMcp } from "./mcp.js";
import { createSender, type PushHooks, pushRoutes, type Sender } from "./push.js";
import { daily, type Job, startScheduler } from "./scheduler.js";
import type { User } from "./schema.js";
import { deriveKey, masterSecret } from "./secrets.js";
import { DomainError, type Tool } from "./tools.js";

export interface AppContext {
  db: Db;
  config: Config;
  /** Sends a notification to one device; null unless the app turned push on. */
  push: Sender | null;
}

export interface AppOptions {
  /** Short lowercase name: cookie names, the MCP server's name. */
  name: string;
  config?: Config;
  /** The app's drizzle-kit migrations folder. */
  migrations?: string;
  /** Every tool the app offers; each says whether the agent, MCP or both get it. */
  tools?: readonly Tool[];
  /** The in-app agent. Its tools are the ones in `tools` exposed to "agent". */
  agent?: Omit<AgentDefinition, "tools">;
  /** What the MCP server is for, shown to the model that connects. */
  mcpInstructions?: string;
  /** The app's own API, mounted under /api for signed-in users. */
  routes?(api: Hono<AppEnv>, ctx: AppContext): void;
  /** Background jobs, checked once a minute. */
  jobs?(ctx: AppContext): Job[];
  /** Runs after migrations, before serving (loading reference data). */
  onStart?(ctx: AppContext): void | Promise<void>;
  /** Extra fields for GET /api/me (the person's settings in this app). */
  me?(user: User, ctx: AppContext): Record<string, unknown>;
  /** Turn on Web Push: the routes under /api/push, and `ctx.push` for jobs to send with. */
  push?: PushHooks;
  /** Tests pass scripted stand-ins for Claude and for the push services. */
  anthropic?: AgentClient;
  pushSender?: Sender;
}

export interface WarrenApp {
  config: Config;
  db: Db;
  database: Database_;
  /** Everything except MCP, for tests: `app.http.request("/api/health")`. */
  http: Hono;
  jobs: Job[];
  /** Sends a notification to one device; null unless the app turned push on. */
  push: Sender | null;
  /** Listen on config.host:config.port, with MCP mounted. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Paths the MCP server and its OAuth proxy own; the web app's catch-all leaves them alone. */
const RESERVED = ["/api/", "/auth/", "/oauth/", "/mcp", "/sse", "/.well-known/", "/health"];

function staticFiles(root: string): Hono {
  const app = new Hono();
  const index = path.join(root, "index.html");
  const noCache = new Set(["index.html", "service-worker.js", "manifest.webmanifest"]);
  app.get("*", async (c, next) => {
    const url = c.req.path;
    if (RESERVED.some((p) => url === p || url.startsWith(p.endsWith("/") ? p : `${p}/`))) return next();
    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      return next();
    }
    const file = path.resolve(root, `.${decoded}`);
    const inside = file === root || file.startsWith(root + path.sep);
    if (inside && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const name = path.basename(file);
      return c.body(new Uint8Array(fs.readFileSync(file)), 200, {
        "Content-Type": getMimeType(name) ?? "application/octet-stream",
        "Cache-Control": noCache.has(name)
          ? "no-cache"
          : url.includes("/immutable/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
      });
    }
    // Any other page address is a client-side route of the web app.
    if (path.extname(url) || !(c.req.header("accept") ?? "").includes("text/html")) return next();
    if (!fs.existsSync(index)) return c.json({ detail: "web app not built" }, 503);
    return c.body(new Uint8Array(fs.readFileSync(index)), 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  });
  return app;
}

export function createApp(options: AppOptions): WarrenApp {
  const config = options.config ?? loadConfig();
  const database = openDatabase(path.join(config.dataDir, DB_FILE));
  runMigrations(
    database,
    options.migrations ? [{ folder: options.migrations, table: `${options.name}_migrations` }] : [],
  );
  const { db } = database;
  const push = options.push ? (options.pushSender ?? createSender(config)) : null;
  const ctx: AppContext = { db, config, push };
  const secret = masterSecret(config.dataDir);
  const tools = options.tools ?? [];

  const auth = createAuth({
    db,
    config,
    appName: options.name,
    me: options.me ? (user) => options.me!(user, ctx) : undefined,
    cookieKey: deriveKey(secret, "session-cookie"),
  });

  // A DomainError from the app's own routes is the person's to fix; anything else is a bug.
  const onError = (err: Error, c: Context) => {
    if (err instanceof DomainError) return c.json({ detail: err.message }, 400);
    console.error(`warren: ${c.req.method} ${c.req.path} failed`, err);
    return c.json({ detail: "Something went wrong" }, 500);
  };

  const http = new Hono();
  http.onError(onError);
  http.use(requireCsrfHeader());
  http.get("/api/health", (c) =>
    c.json({
      ok: true,
      app: options.name,
      version: config.appVersion || null,
      last_snapshot_at: lastSnapshotAt(database),
    }),
  );
  http.route("/", auth.routes);

  const api = new Hono<AppEnv>();
  api.onError(onError);
  api.use(auth.requireUser);
  if (options.agent) {
    const agent: AgentDefinition = { ...options.agent, tools };
    const client =
      options.anthropic ??
      (config.anthropicApiKey
        ? (new Anthropic({ apiKey: config.anthropicApiKey }) as unknown as AgentClient)
        : null);
    const base = { db, dataDir: config.dataDir, agent, appVersion: config.appVersion };
    api.route(
      "/",
      agentRoutes(
        client ? { ...base, client, config: { ...AGENT_DEFAULTS, ...config.agent } } : null,
        base,
      ),
    );
  }
  if (options.push && push) {
    api.route("/", pushRoutes({ db, config, send: push, hooks: options.push }));
  }
  options.routes?.(api, ctx);
  http.route("/api", api);
  http.all("/api/*", (c) => c.json({ detail: "Not found" }, 404));
  http.route("/", staticFiles(path.resolve(config.staticDir)));

  const jobs: Job[] = [
    daily({
      name: "snapshot",
      db,
      timezone: config.timezone,
      hour: config.snapshotHour,
      run: (now) => void snapshot(database, config.dataDir, now),
    }),
    ...(options.jobs?.(ctx) ?? []),
  ];

  let mcp: FastMCP<Record<string, unknown>> | null = null;
  let stopScheduler: (() => void) | null = null;

  return {
    config,
    db,
    database,
    http,
    jobs,
    push,
    async start() {
      await options.onStart?.(ctx);
      mcp = await createMcp({
        db,
        config,
        name: options.name,
        version: /^\d+\.\d+\.\d+$/.test(config.appVersion) ? config.appVersion : "0.0.0",
        instructions: options.mcpInstructions,
        tools,
        secret,
      });
      // The MCP server owns the listener; the app's routes are mounted on it, so there is one origin.
      mcp.getApp().route("/", http);
      await mcp.start({
        transportType: "httpStream",
        // Stateless: a redeploy doesn't strand MCP clients holding a session id.
        httpStream: { port: config.port, host: config.host, stateless: true },
      });
      if (config.scheduler) stopScheduler = startScheduler(jobs);
    },
    async stop() {
      stopScheduler?.();
      await mcp?.stop();
      database.sqlite.close();
    },
  };
}
