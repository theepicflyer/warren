/**
 * Web Push: notifications to the devices that turned them on. Warren stores the subscriptions and
 * sends; what to send and when is the app's business (a job on the scheduler).
 *
 * The VAPID key is made on first use and kept in DATA_DIR. Subscriptions are tied to it, so
 * losing it means turning notifications on again on every device.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import * as webpush from "web-push";
import { z } from "zod";
import type { AppEnv } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { type PushSubscription, pushSubscriptions, type User } from "./schema.js";
import { DomainError } from "./tools.js";

/**
 * The push services browsers use: Google's for Chrome and other Chromium browsers, Mozilla's,
 * Apple's and Microsoft's. Subscriptions elsewhere are refused, so the server only posts to these.
 */
export const PUSH_HOSTS = [
  "googleapis.com",
  "google.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export interface Notification {
  title: string;
  body: string;
  /** Where a tap goes. */
  url?: string;
  /** A newer notification with the same topic replaces one still waiting for an offline phone. */
  topic?: string;
}

/** The push service no longer knows this device: it unsubscribed, or the subscription expired. */
export class Gone extends Error {}

export type Sender = (sub: PushSubscription, message: Notification) => Promise<void>;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function vapidKeys(dataDir: string): VapidKeys {
  const file = path.join(dataDir, "vapid.json");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(webpush.generateVAPIDKeys()), { mode: 0o600, flag: "wx" });
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as VapidKeys;
}

/** Who push services can contact about our messages: VAPID wants an https: URL or a mailto:. */
export function vapidSubject(config: Config): string {
  if (config.vapidSubject) return config.vapidSubject;
  return config.https
    ? `https://${new URL(config.publicUrl).hostname}`
    : "mailto:warren@localhost.invalid";
}

export function checkEndpoint(endpoint: string): void {
  let url: URL | null = null;
  try {
    url = new URL(endpoint);
  } catch {
    // handled below
  }
  const host = url?.hostname ?? "";
  if (url?.protocol !== "https:" || !PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new DomainError("That isn't a push service this server sends to");
  }
}

export function createSender(config: Config): Sender {
  const keys = vapidKeys(config.dataDir);
  const subject = vapidSubject(config);
  return async (sub, message) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(message),
        {
          vapidDetails: { subject, ...keys },
          // one that couldn't be delivered within a few hours isn't worth showing
          TTL: 4 * 3600,
          headers: { Urgency: "normal", ...(message.topic ? { Topic: message.topic } : {}) },
          timeout: 10_000,
        },
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new Gone();
      throw err;
    }
  };
}

export function subscriptionsOf(db: Db, userId: number): PushSubscription[] {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all();
}

/**
 * Send messages, then drop the subscriptions that are gone. Call it outside any transaction, so a
 * slow push service never holds the database. Returns how many were delivered.
 */
export async function deliver(
  db: Db,
  send: Sender,
  outbox: { sub: PushSubscription; message: Notification }[],
): Promise<number> {
  let sent = 0;
  const gone: number[] = [];
  for (const { sub, message } of outbox) {
    try {
      await send(sub, message);
      sent += 1;
    } catch (err) {
      if (err instanceof Gone) gone.push(sub.id);
      else console.warn(`warren: notification to subscription ${sub.id} failed`, err);
    }
  }
  if (gone.length) db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)).run();
  return sent;
}

const SubscriptionIn = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const EndpointIn = z.object({ endpoint: z.string() });

export interface PushHooks {
  /** After a person's first device is subscribed. */
  onFirstDevice?(user: User): void;
  /** What the "send a test" button delivers. */
  testMessage(user: User): Notification;
}

/** Routes under /api/push for signed-in users. A device belongs to whoever signed in on it last. */
export function pushRoutes(deps: {
  db: Db;
  config: Config;
  send: Sender;
  hooks: PushHooks;
}): Hono<AppEnv> {
  const { db, send, hooks } = deps;
  const app = new Hono<AppEnv>();
  const own = (user: User, endpoint: string) =>
    db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)))
      .get();

  app.get("/push/key", (c) => c.json({ key: vapidKeys(deps.config.dataDir).publicKey }));

  app.post("/push/subscriptions", async (c) => {
    const body = SubscriptionIn.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ detail: "subscription keys missing" }, 400);
    checkEndpoint(body.data.endpoint);
    const user = c.var.user;
    const first = subscriptionsOf(db, user.id).length === 0;
    const values = { userId: user.id, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth };
    db.insert(pushSubscriptions)
      .values({ endpoint: body.data.endpoint, ...values })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
      .run();
    if (first) hooks.onFirstDevice?.(user);
    return c.json({ ok: true });
  });

  app.post("/push/unsubscribe", async (c) => {
    const body = EndpointIn.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ detail: "endpoint required" }, 400);
    const sub = own(c.var.user, body.data.endpoint);
    if (sub) db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
    return c.json({ ok: true });
  });

  /** Send this device a notification now, to check they reach it. */
  app.post("/push/test", async (c) => {
    const body = EndpointIn.safeParse(await c.req.json().catch(() => null));
    const sub = body.success ? own(c.var.user, body.data.endpoint) : undefined;
    if (!sub) return c.json({ detail: "Notifications aren't on for this device" }, 404);
    try {
      await send(sub, hooks.testMessage(c.var.user));
    } catch (err) {
      if (err instanceof Gone) {
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
        return c.json(
          { detail: "This device stopped accepting notifications. Turn them on again." },
          410,
        );
      }
      return c.json(
        { detail: "Couldn't reach the notification service. Try again in a minute." },
        502,
      );
    }
    return c.json({ ok: true });
  });

  return app;
}
