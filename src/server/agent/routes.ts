/** The agent's HTTP API: a turn as a stream of events, plus undo, rating, history and uploads. */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../auth.js";
import { ImageError, readFile, saveImage } from "../files.js";
import { files } from "../schema.js";
import { DomainError } from "../tools.js";
import { type AgentDeps, rateTurn, runTurn, scopeTurns, serializeTurn, undoTurn } from "./runner.js";

const Scope = z.string().min(1).max(64);
const TurnIn = z.object({
  scope: Scope,
  text: z.string().max(8000).default(""),
  file_ids: z.array(z.number().int()).default([]),
  thread_id: z.number().int().nullish(),
});
const RatingIn = z.object({
  rating: z.union([z.literal(1), z.literal(-1), z.null()]),
  note: z.string().nullish(),
});

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS = 6;

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

  /**
   * One message to the agent: JSON `{scope, text, file_ids, thread_id}`, or a form with `scope`,
   * `text`, `thread_id` and `photos`, so words and photos arrive together.
   */
  app.post("/agent/turns", async (c) => {
    if (!deps) return c.json({ detail: "The assistant isn't set up (no API key)." }, 503);
    const user = c.var.user;
    let raw: unknown;
    const uploads: File[] = [];
    if ((c.req.header("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await c.req.formData().catch(() => null);
      if (!form) return c.json({ detail: "Invalid request" }, 400);
      const threadId = form.get("thread_id");
      raw = {
        scope: form.get("scope"),
        text: form.get("text") ?? "",
        thread_id: typeof threadId === "string" && threadId ? Number(threadId) : null,
      };
      for (const item of form.getAll("photos")) {
        if (item instanceof File && item.size) uploads.push(item);
      }
    } else {
      raw = await c.req.json().catch(() => null);
    }
    const body = TurnIn.safeParse(raw);
    if (!body.success) return c.json({ detail: "Invalid request" }, 400);
    if (uploads.length + body.data.file_ids.length > MAX_PHOTOS) {
      return c.json({ detail: `Send at most ${MAX_PHOTOS} photos at a time` }, 400);
    }
    if (uploads.some((u) => u.size > MAX_UPLOAD_BYTES)) {
      return c.json({ detail: "Photo too large" }, 413);
    }
    const fileIds = [...body.data.file_ids];
    try {
      for (const upload of uploads) {
        const data = Buffer.from(await upload.arrayBuffer());
        fileIds.push((await saveImage(db, dataDir, { userId: user.id, data })).id);
      }
    } catch (err) {
      if (err instanceof ImageError) return c.json({ detail: err.message }, 400);
      throw err;
    }
    if (!body.data.text.trim() && !fileIds.length) {
      return c.json({ detail: "Say something or attach a photo" }, 400);
    }
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const events = runTurn(deps, {
        userId: user.id,
        scope: body.data.scope,
        text: body.data.text,
        fileIds,
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
    if (upload.size > MAX_UPLOAD_BYTES) return c.json({ detail: "Photo too large" }, 413);
    try {
      const data = Buffer.from(await upload.arrayBuffer());
      return c.json({ id: (await saveImage(db, dataDir, { userId: c.var.user.id, data })).id });
    } catch (err) {
      if (err instanceof ImageError) return c.json({ detail: err.message }, 400);
      throw err;
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
