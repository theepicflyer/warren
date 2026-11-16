/**
 * The MCP server: the app's tools for Claude on claude.ai and other MCP clients.
 *
 * claude.ai connectors need an OAuth server that accepts clients it has never seen, and Pocket ID
 * has one pre-registered client. So an OAuth proxy sits in front: dynamic registration on the
 * outside, the app's own Pocket ID client on the inside. The caller acts as the person who signed
 * in, who must already have signed in to the web app once.
 *
 * Things that break this, all covered by test/pocketid:
 * - Never require scopes: claude.ai requests none.
 * - Never forward the `resource` parameter claude.ai sends: Pocket ID rejects it.
 * - Never forward a client's own scopes. Pocket ID returns an ID token, and with it the person's
 *   `sub`, only for `openid`; a client asking for `mcp:read` would sign in as nobody.
 * - The proxy's store (DATA_DIR/mcp) and signing keys must survive restarts, or connectors show
 *   as connected with no tools.
 */
import path from "node:path";
import { FastMCP, OAuthProvider, UserError } from "fastmcp";
import { DiskStore, type OAuthProxy } from "fastmcp/auth";
import { noChanges } from "./changes.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { User } from "./schema.js";
import { deriveKey } from "./secrets.js";
import { runTool, type Tool, toolsFor } from "./tools.js";
import { devUser, userBySub } from "./users.js";

export interface McpDeps {
  db: Db;
  config: Config;
  name: string;
  /** Shown to the client as the server's version. */
  version: string;
  /** What the server is for and how to use it, shown to the model that connects. */
  instructions?: string;
  tools: readonly Tool[];
  /** The deployment's secret; token signing and encryption keys are derived from it. */
  secret: string;
}

type Session = Record<string, unknown>;

async function providerEndpoints(issuer: string): Promise<{ authorization: string; token: string }> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} from ${issuer}`);
  const doc = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error(`OIDC discovery at ${issuer} has no authorization or token endpoint`);
  }
  return { authorization: doc.authorization_endpoint, token: doc.token_endpoint };
}

function subOf(session: Session | undefined): string | undefined {
  const claims = session?.claims as { sub?: unknown } | undefined;
  if (typeof claims?.sub === "string") return claims.sub;
  const idToken = session?.idToken;
  if (typeof idToken === "string") {
    try {
      // Came from the provider's token endpoint over the proxy's own connection, so it is trusted.
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString());
      if (typeof payload.sub === "string") return payload.sub;
    } catch {
      // fall through
    }
  }
  return undefined;
}

/**
 * fastmcp uses `scopes` only when the client asks for none; a client's own scope goes upstream
 * as is, on sign-in and on refresh. Drop it, so Pocket ID always gets the pinned scopes.
 */
class PinnedScopeProvider extends OAuthProvider {
  protected override createProxy(): OAuthProxy {
    const proxy = super.createProxy();
    const authorize = proxy.authorize.bind(proxy);
    const refresh = proxy.exchangeRefreshToken.bind(proxy);
    proxy.authorize = ({ scope: _, ...params }, request) => authorize(params, request);
    proxy.exchangeRefreshToken = ({ scope: _, ...request }) => refresh(request);
    return proxy;
  }
}

export async function createMcp(deps: McpDeps): Promise<FastMCP<Session>> {
  const { db, config } = deps;
  let options: Record<string, unknown>;
  if (config.oidc) {
    const endpoints = await providerEndpoints(config.oidc.issuer);
    options = {
      auth: new PinnedScopeProvider({
        authorizationEndpoint: endpoints.authorization,
        tokenEndpoint: endpoints.token,
        baseUrl: config.publicUrl,
        clientId: config.oidc.clientId,
        clientSecret: config.oidc.clientSecret,
        // Pinned here rather than taken from the client: claude.ai asks for none, Pocket ID needs openid.
        scopes: ["openid", "profile", "email"],
        allowedRedirectUriPatterns: config.mcpRedirectUris,
        tokenStorage: new DiskStore({ directory: path.join(config.dataDir, "mcp") }),
        jwtSigningKey: deriveKey(deps.secret, "mcp-jwt"),
        encryptionKey: deriveKey(deps.secret, "mcp-store"),
      }),
    };
  } else {
    options = {
      // No OIDC: local development and tests only, acting as MCP_DEV_USER.
      authenticate: async (): Promise<Session> => {
        if (!config.mcpDevUser) throw new Response(null, { status: 401 });
        return { devUser: config.mcpDevUser };
      },
    };
  }

  const mcp = new FastMCP<Session>({
    name: deps.name,
    version: deps.version as `${number}.${number}.${number}`,
    instructions: deps.instructions,
    ...options,
  });

  const resolveUser = (session: Session | undefined): User => {
    if (typeof session?.devUser === "string" && !config.oidc) return devUser(db, session.devUser);
    const sub = subOf(session);
    const user = sub ? userBySub(db, sub) : undefined;
    if (!user) {
      throw new UserError(
        `No ${deps.name} account for this login. Sign in to ${deps.name} in a browser once, then retry.`,
      );
    }
    return user;
  };

  const tools = toolsFor(deps.tools, "mcp");
  for (const tool of tools) {
    mcp.addTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.input,
      annotations: { readOnlyHint: !tool.writes },
      execute: async (args, { session }) => {
        const outcome = runTool(
          tools,
          {
            db,
            user: resolveUser(session),
            now: new Date(),
            via: "mcp",
            scope: null,
            changes: noChanges,
            touched: new Set(),
            fileIds: [],
          },
          tool.name,
          args,
        );
        if (outcome.isError) throw new UserError(outcome.text);
        return outcome.text;
      },
    });
  }
  return mcp;
}
