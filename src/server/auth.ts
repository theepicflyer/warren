/** Browser sign-in: OIDC against Pocket ID, with a user picker for local development. */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as oidc from "openid-client";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { User } from "./schema.js";
import { devUser, upsertUser, userById } from "./users.js";

export type AppEnv = { Variables: { user: User } };

const SESSION_DAYS = 180;
/** Cross-site forms can't set custom headers, so requiring one blocks CSRF on state-changing calls. */
export const CSRF_HEADER = "x-warren";

export interface AuthDeps {
  db: Db;
  config: Config;
  /** Names the cookies, so two apps on one parent domain don't collide. */
  appName: string;
  /** Key for signing cookies, derived from the deployment's secret. */
  cookieKey: string;
}

export function requireCsrfHeader(): MiddlewareHandler {
  return async (c, next) => {
    const safe = ["GET", "HEAD", "OPTIONS"].includes(c.req.method);
    if (!safe && c.req.path.startsWith("/api/") && c.req.header(CSRF_HEADER) !== "1") {
      return c.json({ detail: `missing ${CSRF_HEADER} header` }, 403);
    }
    await next();
  };
}

export function createAuth(deps: AuthDeps) {
  const { db, config, appName, cookieKey } = deps;
  const sessionCookie = `${appName}_session`;
  const loginCookie = `${appName}_login`;
  const cookieOptions = { path: "/", httpOnly: true, sameSite: "Lax", secure: config.https } as const;
  const redirectUri = `${config.publicUrl}/auth/web/callback`;

  let discovered: Promise<oidc.Configuration> | null = null;
  const provider = (): Promise<oidc.Configuration> => {
    if (!config.oidc) throw new Error("OIDC is not configured");
    const { issuer, clientId, clientSecret } = config.oidc;
    discovered ??= oidc
      .discovery(new URL(issuer), clientId, clientSecret, undefined, {
        // http issuers are for local development and tests only
        execute: issuer.startsWith("http://") ? [oidc.allowInsecureRequests] : [],
      })
      .catch((err) => {
        discovered = null;
        throw err;
      });
    return discovered;
  };

  async function signIn(c: Context, user: User): Promise<void> {
    await setSignedCookie(c, sessionCookie, String(user.id), cookieKey, {
      ...cookieOptions,
      maxAge: SESSION_DAYS * 24 * 3600,
    });
  }

  async function currentUser(c: Context): Promise<User | undefined> {
    const value = await getSignedCookie(c, cookieKey, sessionCookie);
    const id = value ? Number(value) : NaN;
    return Number.isInteger(id) ? userById(db, id) : undefined;
  }

  /** Middleware: 401 unless signed in; sets `c.var.user`. */
  const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.json({ detail: "Not signed in" }, 401);
    c.set("user", user);
    await next();
  };

  const routes = new Hono();

  routes.get("/api/auth/config", (c) => c.json({ oidc: config.oidc !== null, dev: config.devLogin }));

  routes.get("/api/me", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ detail: "Not signed in" }, 401);
    return c.json({ id: user.id, name: user.name, email: user.email });
  });

  routes.get("/auth/login", async (c) => {
    if (!config.oidc) return c.redirect("/login");
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const url = oidc.buildAuthorizationUrl(await provider(), {
      redirect_uri: redirectUri,
      scope: "openid profile email",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
    });
    await setSignedCookie(c, loginCookie, JSON.stringify({ verifier, state }), cookieKey, {
      ...cookieOptions,
      maxAge: 600,
    });
    return c.redirect(url.href);
  });

  routes.get("/auth/web/callback", async (c) => {
    if (!config.oidc) return c.notFound();
    const pending = await getSignedCookie(c, cookieKey, loginCookie);
    deleteCookie(c, loginCookie, { path: "/" });
    if (!pending) return c.text("Login expired. Go back and try again.", 400);
    const { verifier, state } = JSON.parse(pending) as { verifier: string; state: string };
    let claims: oidc.IDToken | undefined;
    try {
      // The provider redirected to the public URL; behind a proxy the request's own URL differs.
      const current = new URL(redirectUri + new URL(c.req.url).search);
      const tokens = await oidc.authorizationCodeGrant(await provider(), current, {
        pkceCodeVerifier: verifier,
        expectedState: state,
      });
      claims = tokens.claims();
    } catch (err) {
      console.warn("warren: login failed", err);
      return c.text("Login failed. Go back and try again.", 400);
    }
    if (!claims?.sub) return c.text("Login failed: no identity returned.", 400);
    const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
    if (config.allowedEmails.size && (!email || !config.allowedEmails.has(email))) {
      return c.text("This account isn't allowed to use this app.", 403);
    }
    const name = [claims.name, claims.preferred_username].find((v) => typeof v === "string") as
      | string
      | undefined;
    await signIn(c, upsertUser(db, { sub: claims.sub, email, name }));
    return c.redirect("/");
  });

  routes.post("/api/auth/dev-login", async (c) => {
    if (!config.devLogin) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ detail: "name required" }, 400);
    await signIn(c, devUser(db, name));
    return c.json({ ok: true });
  });

  routes.post("/api/auth/logout", (c) => {
    deleteCookie(c, sessionCookie, { path: "/" });
    return c.json({ ok: true });
  });

  return { routes, requireUser, currentUser };
}
