# CLAUDE.md

Guidance for working in this repository.

## Project

Warren is the framework under the household's apps (Bao, Cache): TypeScript end to end, one container, one Node process, one SQLite file, one origin. `src/server/` is the server package (`warren/server`). The web package and Web Push are still to come. Burrow is the design system and is separate: Warren never decides how things look.

Apps install Warren from this repository at a tag. A change here reaches production only when an app bumps its pin and releases.

## Commands

```bash
npm run check          # tsc
npm test               # unit tests: no network, scripted Claude (test/helpers.ts)
npm run test:pocketid  # needs Docker: real Pocket ID, a browser, and a client playing claude.ai
npm run db:generate    # after editing src/server/schema.ts
npm run build          # dist/, what apps import
```

## Architecture

- `app.ts`: `createApp` wires everything. The MCP server (fastmcp, built on Hono) owns the listener and the app's Hono routes are mounted on it; that is how the API, the web app and MCP share one origin. `app.http` is everything except MCP, for tests. The static handler serves the built web app and falls back to its shell for page addresses, but leaves the paths in `RESERVED` to the MCP server and its OAuth proxy.
- `tools.ts`: a tool is defined once (`defineTool`) and says who gets it (`expose`). `runTool` validates the input, runs the tool in a transaction, and turns bad input and `DomainError` into an error result; any other exception is a bug and propagates. Tool handlers and all domain code are synchronous, because SQLite calls are.
- `agent/runner.ts`: the loop. `agent/routes.ts`: its HTTP API (a turn is a stream of server-sent events; it runs to the end even if the browser leaves).
- `changes.ts`: undo. A tool reports its writes with `ctx.changes.created(table, id)` or `ctx.changes.track(table, id, fn)`; snapshots are raw rows, so undo is generic.
- `mcp.ts`: the OAuth proxy in front of Pocket ID. `auth.ts`: browser sign-in and the CSRF header.
- `db.ts`, `schema.ts`: Drizzle over better-sqlite3. Warren's tables are prefixed `warren_`; its migrations run before the app's, each set with its own bookkeeping table.
- `scheduler.ts`, `backup.ts`, `files.ts`, `secrets.ts`, `time.ts`: small and self-explanatory.

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
- Never forward the `resource` parameter claude.ai sends: Pocket ID rejects it.
- The proxy's store (`DATA_DIR/mcp`) and the keys derived from `DATA_DIR/secret` must survive restarts, or connectors show as connected with no tools.
- One Pocket ID client serves both flows; it needs both callback URLs (`/auth/web/callback` and `/oauth/callback`).
- `fastmcp` is a community package on the sign-in path. It is pinned to an exact version; bump it deliberately and run `npm run test:pocketid`.

## Conventions

- Everything an app must not lose lives under `DATA_DIR`; uploaded files are written once and never changed. Backups depend on both.
- Code moves into Warren only when two apps need it. An app-specific idea stays in the app.
- The repo may be public: no real names, emails or hostnames; use `example.com` and made-up data.
- Keep README.md and this file current when behaviour changes.
