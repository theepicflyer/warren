# Warren

The shared framework under the household's apps. Burrow is how they look; Warren is how they are built.

Every app has the same shape: one container, one Node process, one SQLite file, one origin. Inside it:

- a **domain layer**: plain synchronous TypeScript functions over the database, where all the rules live;
- **three thin skins** over it: a JSON API for the web app, tools for the in-app Claude agent, and tools for MCP clients such as claude.ai;
- a static web app the server also serves.

Warren provides everything around the domain layer, so an app is its tables, its rules, a tool list, a system prompt and its screens.

## What is in it

`warren/server`:

| Part | What it does |
| --- | --- |
| `createApp` | Wires everything below into one server on one port. |
| Tools (`defineTool`) | One definition per operation, with a zod schema. The agent and MCP both run it through the same validation and transaction. |
| Agent (`runTurn`) | The streaming tool loop against the Messages API: frozen cached prefix, append-only history, undo of a whole turn, thumbs up/down, cost per turn. |
| MCP | An MCP server with an OAuth proxy in front of Pocket ID, so claude.ai can connect. |
| Sign-in | OIDC against Pocket ID for the browser, signed session cookies, a dev login for local work. |
| Database | SQLite (WAL) through Drizzle, with Warren's migrations and then the app's. |
| Scheduler | Jobs checked once a minute in the same process; `daily` runs once per local day and catches up after downtime. |
| Backup | A consistent snapshot each day, and `warren restore`. |
| Files | Uploaded photos: turned upright, shrunk to what Claude can use, written once and never changed. |
| Web Push | Device subscriptions and sending, limited to the browsers' own push services. What to send and when is the app's job. |

`warren/web`, for the apps' SvelteKit clients (Svelte 5). Behaviour only; how things look stays with Burrow and the app:

| Part | What it does |
| --- | --- |
| API client (`get`, `post`, ..., `ApiError`) | Same-origin requests with Warren's CSRF header; form errors come back per field; a 401 calls the app's `onUnauthorized`. |
| `Session`, `Toasts`, `changes` | Who is signed in, toasts with an optional action (Undo), and "the data changed" so screens reload. |
| `loaded` | A screen's data by address, cached: a screen opened before shows its last data at once and refreshes underneath, so going back is instant. |
| `pageTransition` | Screen changes like a native app's: deeper screens slide in from the right, back slides them away, the nav's own screens cross-fade, the nav stays put. View Transitions API; `motion.css` holds the animations. |
| `dragToDismiss`, `swipeBack` | Pull a sheet down to close it; swipe in from the left edge to go back (for iPhone home-screen apps, which have no back gesture). |
| Motion (`fade`, `fly`, `rise`, `row`, `sheet`, `flip`, `slidingPill`, `Count`, `haptic`) | Transitions that stand still under reduced motion, a nav highlight that slides between items, numbers that count, and a short buzz on Android. |

The app's web client depends on Warren too, at the same commit as its server, with `ignore-scripts=true` in `web/.npmrc` so npm doesn't build Warren's server half there. It imports source: `import { get, loaded } from 'warren/web'` and `import 'warren/web/motion.css'`.

## An app

```ts
import { createApp, defineTool, DomainError } from "warren/server";
import { z } from "zod";
import { addEntry } from "./log.js"; // the domain layer

const logEntry = defineTool({
  name: "log_entry",
  description: "Add an item to the log.",
  input: z.strictObject({ name: z.string(), kcal: z.number().min(0) }),
  writes: true,
  expose: ["agent"],
  run(ctx, input) {
    const entry = addEntry(ctx.db, ctx.user, ctx.scope!, input); // throws DomainError on a broken rule
    ctx.changes.created(entries, entry.id); // so the turn can be undone
    ctx.touched.add(entry.date); // so the web app reloads that day
    return `Logged #${entry.id} ${entry.name}`;
  },
});

const app = createApp({
  name: "bao",
  migrations: new URL("../migrations", import.meta.url).pathname,
  tools: [logEntry /* ... */],
  agent: {
    systemPrompt: SYSTEM_PROMPT, // frozen text
    context: ({ db, user, scope, now }) => ({ text: describeDay(db, user, scope, now) }),
  },
  mcpInstructions: "Read-only access to one person's food log.",
  routes(api, { db }) {
    api.get("/days/:date", (c) => c.json(day(db, c.var.user, c.req.param("date"))));
  },
});
await app.start();
```

Install it from this repository at a tag:

```bash
npm install github:theepicflyer/warren#<tag or commit>
```

App tables go in the app's own Drizzle schema and may reference `schema.users.id`. Warren's tables are all named `warren_*`; filter them out of the app's `drizzle.config.ts` with `tablesFilter: ["!warren_*"]`.

## Settings

All from the environment (`src/server/config.ts` has the full list):

| Variable | Meaning |
| --- | --- |
| `DATA_DIR` | Everything the app must not lose. Default `./data`. |
| `STATIC_DIR` | The built web app. |
| `PUBLIC_URL` | The address the app is served on, e.g. `https://bao.example.com`. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Pocket ID. The client needs two callback URLs: `PUBLIC_URL/auth/web/callback` (browser) and `PUBLIC_URL/oauth/callback` (MCP). |
| `ALLOWED_EMAILS` | Optional comma-separated allowlist. |
| `ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_EFFORT` | The in-app agent. |
| `TIMEZONE` | The household's clock, for days and daily jobs. Default `Asia/Singapore`. |
| `SNAPSHOT_HOUR` | Local hour of the daily snapshot. Default `3`. |
| `VAPID_SUBJECT` | Who push services can contact about notifications. Default: the host of `PUBLIC_URL`. |
| `DEV_LOGIN`, `MCP_DEV_USER` | Local development only; both are refused on an https site. |

## Backup

Everything an app must keep is under `DATA_DIR`, and nothing else is:

| Path | What |
| --- | --- |
| `app.sqlite` (and `-wal`, `-shm`) | The live database. **Do not copy these**; a copy taken while the app runs can be corrupt. |
| `backup/app.sqlite` | A consistent snapshot, rewritten each day at `SNAPSHOT_HOUR`. |
| `files/` | Uploads. Written once, never changed. |
| `secret` | The deployment's key. Without it everyone is signed out and MCP clients are disconnected. |
| `vapid.json` | The Web Push key. Without it every device has to turn notifications on again. |
| `mcp/` | The OAuth proxy's store: which MCP clients are connected. |

Point the backup tool at `DATA_DIR` and exclude `app.sqlite*` at its top level. `/api/health` reports `last_snapshot_at`.

To restore, stop the app, then:

```bash
npx warren restore /path/to/backup/app.sqlite
```

The database it replaces is kept beside it. `npx warren snapshot` writes a snapshot now.

## Working on Warren

```bash
npm install
```

```bash
npm run check
```

```bash
npm test
```

```bash
npm run test:pocketid
```

The last one needs Docker. It starts a real Pocket ID, puts the whole app in front of it, signs in with a browser and plays claude.ai's part as an MCP client. Run it after changing `fastmcp`, `mcp.ts` or `auth.ts`.

After changing `src/server/schema.ts`:

```bash
npm run db:generate
```

## Licence

MIT. See [LICENSE](LICENSE).
