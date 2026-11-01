import { type Client } from "pg";
import type { createAuth } from "./lib/auth";

export type Bindings = {
  PG: Hyperdrive;
  DECKS: R2Bucket;
  FLASHCARD_AGENT: Fetcher;
  // Cloudflare Email Service. Optional so code paths without it (bun tests, scripts) log instead.
  EMAIL?: SendEmail;
  // e.g. https://<team>.cloudflareaccess.com
  ACCESS_TEAM_DOMAIN: string;
  // Application Audience (AUD) tag of the Access application protecting /mcp.
  ACCESS_AUD: string;
  // Local dev only (.dev.vars): skip Access JWT verification because there is no Access in front.
  DEV_SKIP_ACCESS_AUTH?: string;
  // Local dev only: the account MCP calls act as when DEV_SKIP_ACCESS_AUTH is on.
  DEV_ACCESS_EMAIL?: string;
  // Local dev and e2e only: log verification and reset emails instead of sending them.
  DEV_LOG_EMAILS?: string;
  // PostHog project token. A Worker secret in production only, so analytics are off everywhere else.
  POSTHOG_KEY?: string;
  POSTHOG_HOST: string;
  // better-auth. The secret signs and encrypts session cookies (at least 32 random bytes).
  BETTER_AUTH_SECRET: string;
  // The origin the browser sees, e.g. https://remain.scar0x00.click or http://localhost:4200.
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  // Session store. Without both, sessions are validated against Postgres.
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

/** The signed-in user every /api/v1 route and MCP tool acts for. */
export type AuthUser = { id: string; name: string; email: string };

export type Env = {
  Bindings: Bindings;
  Variables: {
    pg: Client;
    user: AuthUser;
    // Tests set this (from a wrapping app) to swap the Postgres-backed better-auth for one on an
    // in-memory adapter. Unset in the worker, which uses `createAuth`.
    createAuth?: typeof createAuth;
  };
};
