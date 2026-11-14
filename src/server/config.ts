import { z } from "zod";

const flag = z
  .string()
  .optional()
  .transform((v) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase()));
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

/** MCP clients that may complete sign-in. A proxy that accepts any redirect URI is an open redirector. */
export const DEFAULT_MCP_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

/** Every Warren app reads these from the environment. Apps add their own with `loadConfig(extra)`. */
export const envSchema = z.object({
  DATA_DIR: z.string().default("./data"),
  STATIC_DIR: z.string().default("./web/build"),
  /** Public URL the app is served on, e.g. https://bao.example.com */
  PUBLIC_URL: z.string().default("http://localhost:8000"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(8000),

  /** Pocket ID (or any OIDC provider): the issuer URL, without /.well-known. Unset = dev login only. */
  OIDC_ISSUER: optional,
  OIDC_CLIENT_ID: optional,
  OIDC_CLIENT_SECRET: optional,
  /** Comma-separated allowlist on top of the provider's own restrictions. */
  ALLOWED_EMAILS: z.string().default(""),
  /** Space-separated redirect URI patterns MCP clients may use. Empty = DEFAULT_MCP_REDIRECT_URIS. */
  MCP_ALLOWED_REDIRECT_URIS: z.string().default(""),

  /** Local development only: a user picker instead of OIDC. Refused on an https site. */
  DEV_LOGIN: flag,
  /** MCP without OAuth acts as this user. Local development and tests only. */
  MCP_DEV_USER: optional,

  TIMEZONE: z.string().default("Asia/Singapore"),
  /** The release this build is, set by the image build; empty when run from source. */
  APP_VERSION: z.string().default(""),

  ANTHROPIC_API_KEY: optional,
  AGENT_MODEL: z.string().default("claude-opus-5-5"),
  AGENT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  AGENT_MAX_TOKENS: z.coerce.number().int().default(16000),

  /** Local hour at which the daily snapshot is written to DATA_DIR/backup. */
  SNAPSHOT_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  /** Tests turn the once-a-minute scheduler off and call jobs themselves. */
  SCHEDULER: z
    .string()
    .optional()
    .transform((v) => !["0", "false", "no", "off"].includes((v ?? "").trim().toLowerCase())),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  dataDir: string;
  staticDir: string;
  publicUrl: string;
  host: string;
  port: number;
  oidc: { issuer: string; clientId: string; clientSecret: string } | null;
  allowedEmails: Set<string>;
  mcpRedirectUris: string[];
  devLogin: boolean;
  mcpDevUser: string | undefined;
  timezone: string;
  appVersion: string;
  anthropicApiKey: string | undefined;
  agent: { model: string; effort: Env["AGENT_EFFORT"]; maxTokens: number };
  snapshotHour: number;
  scheduler: boolean;
  https: boolean;
}

export function configFromEnv(env: Env): Config {
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, "");
  const https = publicUrl.startsWith("https://");
  if (env.DEV_LOGIN && https) {
    throw new Error("DEV_LOGIN lets anyone sign in as anyone; it can't be used on an https site");
  }
  if (env.MCP_DEV_USER && (https || env.OIDC_ISSUER)) {
    throw new Error("MCP_DEV_USER serves MCP without sign-in; it can't be used on an https site or with OIDC");
  }
  const oidcParts = [env.OIDC_ISSUER, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET];
  if (oidcParts.some(Boolean) && !oidcParts.every(Boolean)) {
    throw new Error("Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together, or none of them");
  }
  return {
    dataDir: env.DATA_DIR,
    staticDir: env.STATIC_DIR,
    publicUrl,
    host: env.HOST,
    port: env.PORT,
    oidc: env.OIDC_ISSUER
      ? {
          issuer: env.OIDC_ISSUER.replace(/\/+$/, ""),
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET!,
        }
      : null,
    allowedEmails: new Set(
      env.ALLOWED_EMAILS.split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
    mcpRedirectUris: env.MCP_ALLOWED_REDIRECT_URIS.trim()
      ? env.MCP_ALLOWED_REDIRECT_URIS.trim().split(/\s+/)
      : DEFAULT_MCP_REDIRECT_URIS,
    devLogin: env.DEV_LOGIN,
    mcpDevUser: env.MCP_DEV_USER,
    timezone: env.TIMEZONE,
    appVersion: env.APP_VERSION,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    agent: { model: env.AGENT_MODEL, effort: env.AGENT_EFFORT, maxTokens: env.AGENT_MAX_TOKENS },
    snapshotHour: env.SNAPSHOT_HOUR,
    scheduler: env.SCHEDULER,
    https,
  };
}

/** Read Warren's settings from the environment. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  return configFromEnv(envSchema.parse(source));
}
