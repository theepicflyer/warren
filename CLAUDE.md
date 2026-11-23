# CLAUDE.md

Guidance for working in this repository.

## Project

Warren is the framework under the household's apps (Bao, Cache): TypeScript end to end, one container, one Node process, one SQLite file, one origin. `src/server/` is the server package (`warren/server`); `src/web/` is the web package (`warren/web`), for the apps' SvelteKit clients. Burrow is the design system. Warren also hosts it (`burrow/`, `src/burrow/`, shipped as `warren/burrow`) so both apps draw it from one place, but Warren never decides how things look: the look (colours, type, art, component classes) is dictated by the Burrow artifact and only ever re-synced from it, never hand-edited here. Warren decides how things behave and move.

Apps install Warren from this repository at a tag. A change here reaches production only when an app bumps its pin and releases.

## Commands

```bash
npm run check          # tsc (server and tests)
npm run check:web      # svelte-check of src/web and src/burrow (tools/web-check pins TypeScript 6, which svelte-check needs)
npm test               # unit tests: no network, scripted Claude (test/helpers.ts)
npm run test:pocketid  # needs Docker: real Pocket ID, a browser, and a client playing claude.ai
npm run db:generate    # after editing src/server/schema.ts
npm run burrow         # after re-syncing burrow/export/ from the Burrow artifact (burrow/README.md)
npm run build          # dist/, what apps import
```

## Architecture

- `app.ts`: `createApp` wires everything. The MCP server (fastmcp, built on Hono) owns the listener and the app's Hono routes are mounted on it; that is how the API, the web app and MCP share one origin. `app.http` is everything except MCP, for tests. The static handler serves the built web app and falls back to its shell for page addresses, but leaves the paths in `RESERVED` to the MCP server and its OAuth proxy.
- `tools.ts`: a tool is defined once (`defineTool`) and says who gets it (`expose`). `runTool` validates the input, runs the tool in a transaction, and turns bad input and `DomainError` into an error result; any other exception is a bug and propagates. A tool can return `withImages(text, images)` to show the agent stored photos: the runner keeps them as file references in the tool result (like a message's photos) and sends image data; it throws if a photo isn't the person's. MCP clients get only the text. Tool handlers and all domain code are synchronous, because SQLite calls are.
- `agent/runner.ts`: the loop. `agent/routes.ts`: its HTTP API (a turn is a stream of server-sent events; it runs to the end even if the browser leaves).
- `changes.ts`: undo. A tool reports its writes with `ctx.changes.created(table, id)` or `ctx.changes.track(table, id, fn)`; snapshots are raw rows, so undo is generic.
- `mcp.ts`: the OAuth proxy in front of Pocket ID. `auth.ts`: browser sign-in and the CSRF header.
- `db.ts`, `schema.ts`: Drizzle over better-sqlite3. Warren's tables are prefixed `warren_`; its migrations run before the app's, each set with its own bookkeeping table.
- `push.ts`: Web Push. Warren keeps subscriptions and sends (`deliver` drops devices that are gone); the app decides what and when, in a job. Endpoints are limited to `PUSH_HOSTS`.
- `files.ts`: uploads. `saveImage` normalises a photo with sharp before it is stored.
- `scheduler.ts`, `backup.ts`, `secrets.ts`, `time.ts`: small and self-explanatory.

### The web package (`src/web/`)

Shipped as source (Svelte and TypeScript), compiled by the app's Vite; `package.json` exports it as `warren/web` and `warren/web/motion.css`. It imports only `svelte`, never `$app/*`: the app passes in what needs SvelteKit (`configureApi({ onUnauthorized: () => goto('/login') })`, `onNavigate((n) => pageTransition(n, { tabs }))`), so it type-checks on its own.

- `api.ts`, `state.svelte.ts` (`Session`, `Toasts`, `changes`), `data.svelte.ts` (`loaded` and its cache). Both apps make their `Toasts` with `max: 1, timed: false` and show them with warren/burrow's `Toast`, which takes the nav's place, times each one (5 s, stopped while held) and swipes away; the app positions it and hides its nav while `toasts.current` is set.
- `navigation.ts`: `direction()` decides forward, back or tab (tested in `test/web.test.ts`); `pageTransition` sets `html[data-nav]` for the transition and `html[data-wn-arrived]` for the life of the screen (`arrivedBy()`), and runs a view transition. `motion.css` animates on that attribute and keeps elements marked `data-wn-keep` still.
- `gestures.ts`: `dragToDismiss` (pointer events on a handle) and `swipeBack` (touch events, because Safari cancels pointer events when it might scroll).
- `motion.ts`: Svelte transitions that stand still under reduced motion, `slidingPill`, `haptic`. `Count.svelte`.
- Everything that moves respects `prefers-reduced-motion: reduce`. Keep it that way.

### Burrow (`burrow/`, `src/burrow/`)

`burrow/README.md` has the re-sync steps.

- `burrow/export/` is the Burrow artifact's export exactly as published (`README.md`, `tokens.json`, `components/bundle.{js,css}`, `components/index.d.ts`). Never edit it; copy it again from the artifact.
- `burrow/generate.cjs` (no dependencies) writes `src/burrow/generated/`: `tokens.css` (light, dark with the device or `html[data-theme]`), `type.css`, `burrow.css`, `art.js`/`art.d.ts` (the bundle's SVG string generators without its React components) and `scenes.ts` (stash and wreath per count). Never hand-edit those either; `test/burrow.test.ts` fails when they don't match the export. When the export changes shape, fix the generator.
- `package.json` exports `warren/burrow` (`src/burrow/index.ts`: the art and the components) and `warren/burrow/{tokens,type,burrow}.css`, as source like `warren/web`. `npm run check:web` checks `src/burrow` too.
- The Svelte components (`Mascot`, `Trace`, `Habitat`, `Peek`, `World`, `Breadcrumbs`, `TunnelRow`, `Loader`, `Toast`) are Warren's ports of Burrow's components, used by both apps or plainly app-neutral, and drawn only with Burrow's own `bh-*` classes (no Tailwind: Cache has none). An app's own components on Burrow (Bao's sunflower ring, Cache's wreath and stash, each app's meter and empty state) stay in the app.

## Rules that keep the agent cheap and correct

Tests in `test/agent.test.ts` assert these.

- **The system prompt is frozen text.** Per-turn context goes in the user message (`AgentDefinition.context`). Tools are sorted by name. Both keep the cached prefix byte-identical across users and turns.
- **History is append-only.** A turn's messages are stored exactly as sent and returned, and replayed unchanged. Only `status == "ok"` turns are replayed.
- **Stale thinking is dropped, not rejected.** Requests send `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`), so a release that changes the prompt or tools doesn't break older threads.
- **Thinking is adaptive and effort is the only dial.** Models in `FALLBACK_MODELS` send `fallbacks: "default"`; Haiku has no server-side fallback.
- A tool call cut off at `max_tokens` is never run.

## MCP and Pocket ID gotchas

`test/pocketid` covers all of these against a real Pocket ID.

- Never require scopes on the proxy: claude.ai requests none.
- Never forward a client's own scopes (Meta's Muse asks for `mcp:read mcp:write`): without `openid` Pocket ID returns no ID token, so the person can't be found. `PinnedScopeProvider` in `mcp.ts` drops them on sign-in and refresh.
- Never forward the `resource` parameter claude.ai sends: Pocket ID rejects it.
- The proxy's store (`DATA_DIR/mcp`) and the keys derived from `DATA_DIR/secret` must survive restarts, or connectors show as connected with no tools.
- One Pocket ID client serves both flows; it needs both callback URLs (`/auth/web/callback` and `/oauth/callback`).
- `fastmcp` is a community package on the sign-in path. It is pinned to an exact version; bump it deliberately and run `npm run test:pocketid`.

## Conventions

- Everything an app must not lose lives under `DATA_DIR`; uploaded files are written once and never changed. Backups depend on both.
- Code moves into Warren only when two apps need it. An app-specific idea stays in the app. Burrow is the exception: its export and everything generated from it live here and nowhere else, even what one app alone uses, so a Burrow update is one re-sync here and a pin bump in each app.
- The repo may be public: no real names, emails or hostnames; use `example.com` and made-up data.
- Keep README.md and this file current when behaviour changes.
