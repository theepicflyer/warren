import { afterEach, expect, test, vi } from "vitest";
import { ApiError, api, configureApi, query } from "../src/web/api.ts";
import { direction, type NavigationLike } from "../src/web/navigation.ts";

const nav = (from: string, to: string, extra: Partial<NavigationLike> = {}, routes: [string, string] = [from, to]): NavigationLike => ({
  type: "link",
  from: { url: new URL(from, "http://x"), route: { id: routes[0] } },
  to: { url: new URL(to, "http://x"), route: { id: routes[1] } },
  complete: Promise.resolve(),
  ...extra,
});

const tabs = ["/", "/history", "/settings"];

test("screens deeper are forward, shallower back, and the nav's own screens cross-fade", () => {
  expect(direction(nav("/history", "/history/42", {}, ["/history", "/history/[id]"]), tabs)).toBe("forward");
  expect(direction(nav("/history/42", "/history", {}, ["/history/[id]", "/history"]), tabs)).toBe("back");
  expect(direction(nav("/", "/settings"), tabs)).toBe("tab");
  // the browser's back button between two tabs is still a tab change
  expect(direction(nav("/settings", "/", { type: "popstate", delta: -1 }), tabs)).toBe("tab");
  // a tab to a deeper screen under another tab is forward
  expect(direction(nav("/", "/settings/budgets"), tabs)).toBe("forward");
});

test("a tab can be a test, for top-level screens with a date or id in the address", () => {
  const dayTabs = [(p: string) => p.startsWith("/day/"), "/foods"];
  expect(direction(nav("/day/2026-11-15", "/foods", {}, ["/day/[date]", "/foods"]), dayTabs)).toBe("tab");
  expect(direction(nav("/foods", "/foods/12", {}, ["/foods", "/foods/[id]"]), dayTabs)).toBe("forward");
});

test("the back and forward buttons decide outside the tabs", () => {
  expect(direction(nav("/foods/1", "/settings/budgets", { type: "popstate", delta: -1 }), tabs)).toBe("back");
  expect(direction(nav("/settings/budgets", "/foods/1", { type: "popstate", delta: 1 }), tabs)).toBe("forward");
});

test("the same screen with other data, or leaving the app, has no transition", () => {
  expect(direction(nav("/trends?months=6", "/trends?months=12", {}, ["/trends", "/trends"]), tabs)).toBeNull();
  expect(direction(nav("/day/2026-11-14", "/day/2026-11-15", {}, ["/day/[date]", "/day/[date]"]), tabs)).toBeNull();
  expect(direction(nav("/", "/history", { willUnload: true }), tabs)).toBeNull();
  expect(direction({ ...nav("/", "/history"), to: null }, tabs)).toBeNull();
  // different screens at the same depth cross-fade
  expect(direction(nav("/foods", "/trends", {}, ["/foods", "/trends"]), [])).toBe("tab");
});

test("query keeps only the values that are set", () => {
  expect(query({ q: "rice", page: 2, type: "", month: null, all: false, open: true })).toBe("?q=rice&page=2&open=true");
  expect(query({ q: undefined })).toBe("");
});

afterEach(() => vi.unstubAllGlobals());

test("errors carry the server's field messages, and a 401 hands over to the app", async () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("location", { pathname: "/" });

  vi.stubGlobal("fetch", respond(400, { ok: false, errors: { amount: "Enter an amount.", title: "Add a title." } }));
  const err = (await api("/api/x").catch((e: unknown) => e)) as ApiError;
  expect(err).toBeInstanceOf(ApiError);
  expect([err.status, err.message, err.errors.amount]).toEqual([400, "Enter an amount. Add a title.", "Enter an amount."]);

  const fetch = respond(200, { ok: true });
  vi.stubGlobal("fetch", fetch);
  await api("/api/x", { method: "POST" });
  expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("x-warren")).toBe("1");

  const signIn = vi.fn();
  configureApi({ onUnauthorized: signIn });
  vi.stubGlobal("fetch", respond(401, { detail: "no" }));
  expect(((await api("/api/x").catch((e: unknown) => e)) as ApiError).status).toBe(401);
  expect(signIn).toHaveBeenCalledOnce();
});
