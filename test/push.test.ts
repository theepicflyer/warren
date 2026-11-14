import { expect, test } from "vitest";
import { deliver, devUser, Gone, type Notification, type PushSubscription, schema, subscriptionsOf } from "../src/server/index.js";
import { testApp } from "./helpers.js";

const json = { "content-type": "application/json", "x-warren": "1" };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const device = (endpoint = ENDPOINT) => ({ endpoint, keys: { p256dh: "p", auth: "a" } });

function setup() {
  const sent: { endpoint: string; message: Notification }[] = [];
  const gone = new Set<string>();
  const firsts: string[] = [];
  const app = testApp({
    push: {
      onFirstDevice: (user) => void firsts.push(user.name),
      testMessage: (user) => ({ title: "Reminders are on", body: `Hello ${user.name}` }),
    },
    pushSender: async (sub: PushSubscription, message: Notification) => {
      if (gone.has(sub.endpoint)) throw new Gone();
      if (sub.endpoint.includes("down")) throw new Error("service unavailable");
      sent.push({ endpoint: sub.endpoint, message });
    },
  });
  const as = async (name: string) => {
    const res = await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name }) });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return (url: string, body?: unknown) =>
      app.http.request(url, { method: body === undefined ? "GET" : "POST", headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  return { app, sent, gone, firsts, as };
}

test("a device subscribes, gets a test notification, and unsubscribes", async () => {
  const { app, sent, firsts, as } = setup();
  const alice = await as("Alice");
  expect((await (await alice("/api/push/key")).json()).key).toMatch(/^[A-Za-z0-9_-]{80,}$/);

  expect((await alice("/api/push/subscriptions", device())).status).toBe(200);
  expect((await alice("/api/push/subscriptions", device())).status).toBe(200); // refreshing is fine
  expect(firsts).toEqual(["Alice"]);
  expect(subscriptionsOf(app.db, devUser(app.db, "Alice").id)).toHaveLength(1);

  expect((await alice("/api/push/test", { endpoint: ENDPOINT })).status).toBe(200);
  expect(sent).toEqual([{ endpoint: ENDPOINT, message: { title: "Reminders are on", body: "Hello Alice" } }]);

  // someone else's device can't be tested or removed
  const bob = await as("Bob");
  expect((await bob("/api/push/test", { endpoint: ENDPOINT })).status).toBe(404);
  await bob("/api/push/unsubscribe", { endpoint: ENDPOINT });
  expect(app.db.select().from(schema.pushSubscriptions).all()).toHaveLength(1);

  await alice("/api/push/unsubscribe", { endpoint: ENDPOINT });
  expect(app.db.select().from(schema.pushSubscriptions).all()).toEqual([]);
});

test("a device belongs to whoever signed in on it last", async () => {
  const { app, as } = setup();
  await (await as("Alice"))("/api/push/subscriptions", device());
  await (await as("Bob"))("/api/push/subscriptions", device());
  const rows = app.db.select().from(schema.pushSubscriptions).all();
  expect(rows.map((r) => r.userId)).toEqual([devUser(app.db, "Bob").id]);
});

test("only the browsers' push services are accepted", async () => {
  const { as } = setup();
  const alice = await as("Alice");
  for (const endpoint of ["https://evil.example.com/push", "http://fcm.googleapis.com/x", "https://notgoogleapis.com/x", "nonsense"]) {
    const res = await alice("/api/push/subscriptions", device(endpoint));
    expect([endpoint, res.status]).toEqual([endpoint, 400]);
  }
  expect((await alice("/api/push/subscriptions", device("https://updates.push.services.mozilla.com/wpush/v2/x"))).status).toBe(200);
});

test("a device that is gone is dropped; one that fails for now is kept", async () => {
  const { app, sent, gone, as } = setup();
  const alice = await as("Alice");
  const endpoints = [ENDPOINT, "https://fcm.googleapis.com/fcm/send/gone", "https://fcm.googleapis.com/fcm/send/down"];
  for (const e of endpoints) await alice("/api/push/subscriptions", device(e));
  gone.add(endpoints[1]!);

  const subs = subscriptionsOf(app.db, devUser(app.db, "Alice").id);
  const delivered = await deliver(app.db, app.push!, subs.map((sub) => ({ sub, message: { title: "t", body: "b" } })));
  expect(delivered).toBe(1);
  expect(sent.map((s) => s.endpoint)).toEqual([ENDPOINT]);
  expect(app.db.select().from(schema.pushSubscriptions).all().map((s) => s.endpoint)).toEqual([endpoints[0], endpoints[2]]);

  gone.add(ENDPOINT);
  expect((await alice("/api/push/test", { endpoint: ENDPOINT })).status).toBe(410);
  expect((await alice("/api/push/test", { endpoint: endpoints[2] })).status).toBe(502);
});
