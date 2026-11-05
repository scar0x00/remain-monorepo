// Only for the better-auth CLI, never imported by the worker:
//   bunx auth@latest generate --config src/lib/auth.cli.ts --output better-auth_migrations/<timestamp>.sql
// Reads the local Postgres from CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG (.env).
import { createAuth } from "./auth";

export const auth = createAuth({
  PG: { connectionString: process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG } as Hyperdrive,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "cli-only-secret-cli-only-secret-00",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:4200",
  // Enables every provider so the generated schema covers them.
  GITHUB_CLIENT_ID: "cli",
  GITHUB_CLIENT_SECRET: "cli",
}).auth;
