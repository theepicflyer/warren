/** The agent's HTTP API: a turn as a stream of events, plus undo, rating, history and uploads. */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../auth.js";
import { readFile, saveFile } from "../files.js";
import { files } from "../schema.js";
import { DomainError } from "../tools.js";
import { type AgentDeps, rateTurn, runTurn, scopeTurns, serializeTurn, undoTurn } from "./runner.js";

const Scope = z.string().min(1).max(64);
const TurnIn = z.object({
  scope: Scope,
  text: z.string().max(8000).default(""),
  file_ids: z.array(z.number().int()).max(8).default([]),
  thread_id: z.number().int().nullish(),
});
const RatingIn = z.object({
  rating: z.union([z.literal(1), z.literal(-1), z.null()]),
  note: z.string().nullish(),
});

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Routes under /api, for signed-in users. `deps` is null when no API key is configured. */
export function agentRoutes(deps: AgentDeps | null, base: Omit<AgentDeps, "client" | "config"> ): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const { db, agent, dataDir } = base;

  const guarded = <T>(fn: () => T): T | Response => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DomainError) return Response.json({ detail: err.message }, { status: 404 });
      throw err;
    }
  };

  app.post("/agent/turns", async (c) => {
    if (!deps) return c.json({ detail: "The assistant isn't set up (no API key)." }, 503);
    const body = TurnIn.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ detail: "Invalid request" }, 400);
    if (!body.data.text.trim() && !body.data.file_ids.length) {
      return c.json({ detail: "Say something or attach a photo" }, 400);
    }
    const user = c.var.user;
    return streamSSE(c, async (stream) => {
      const events = runTurn(deps, {
        userId: user.id,
        scope: body.data.scope,
        text: body.data.text,
        fileIds: body.data.file_ids,
        threadId: body.data.thread_id,
      });
      // The turn runs to the end even if the browser goes away, so it is never left half done.
      for await (const event of events) {
        if (stream.aborted) continue;
        await stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {});
      }
    });
  });

  app.get("/agent/turns", (c) => {
    const scope = Scope.safeParse(c.req.query("scope"));
    if (!scope.success) return c.json({ detail: "scope required" }, 400);
    return c.json({ turns: scopeTurns(db, agent, c.var.user, scope.data) });
  });

  app.post("/agent/turns/:id/undo", (c) => {
    const out = guarded(() => serializeTurn(db, agent, undoTurn(db, c.var.user, Number(c.req.param("id")))));
    return out instanceof Response ? out : c.json(out);
  });

  app.put("/agent/turns/:id/rating", async (c) => {
    const body = RatingIn.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ detail: "rating must be 1, -1 or null" }, 400);
    const out = guarded(() =>
      serializeTurn(
        db,
        agent,
        rateTurn(db, c.var.user, Number(c.req.param("id")), body.data.rating, body.data.note ?? undefined),
      ),
    );
    return out instanceof Response ? out : c.json(out);
  });

  app.post("/files", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const upload = form?.get("file");
    if (!(upload instanceof File)) return c.json({ detail: "file required" }, 400);
    if (upload.size > MAX_UPLOAD_BYTES) return c.json({ detail: "File is too large" }, 413);
    try {
      const stored = saveFile(db, dataDir, {
        userId: c.var.user.id,
        mediaType: upload.type,
        data: Buffer.from(await upload.arrayBuffer()),
      });
      return c.json({ id: stored.id });
    } catch {
      return c.json({ detail: "Unsupported file type" }, 415);
    }
  });

  app.get("/files/:id", (c) => {
    const file = db
      .select()
      .from(files)
      .where(and(eq(files.id, Number(c.req.param("id"))), eq(files.userId, c.var.user.id)))
      .get();
    const data = file ? readFile(dataDir, file) : null;
    if (!file || !data) return c.notFound();
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": file.mediaType,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  });

  return app;
}
