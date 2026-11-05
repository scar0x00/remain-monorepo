import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";
import { Client } from "pg";
import { type AuthUser, type Env } from "../types";

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * The Remain account an Access identity acts as: the account with that email, once the email is
 * verified (by sign-up or by GitHub). MCP clients have no app session, only the Access JWT.
 */
export async function findUserByEmail(pg: Pick<Client, "query">, email: string): Promise<AuthUser | null> {
  const { rows } = await pg.query<AuthUser>(
    `SELECT id, name, email FROM "user" WHERE lower(email) = lower($1) AND "emailVerified" = true LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

async function verifiedEmail(token: string | undefined, issuer: string, audience: string) {
  // Fail closed when the worker is not configured.
  if (!token || !issuer || !audience) return null;

  let keys = jwks.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwks.set(issuer, keys);
  }

  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience });
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

// Cloudflare Access (with Managed OAuth) authenticates MCP clients and forwards a signed JWT.
// Never trust the header without verifying its signature, issuer and audience. Sets `c.get("user")`.
export const accessAuth = createMiddleware<Env>(async (c, next) => {
  const email =
    c.env.DEV_SKIP_ACCESS_AUTH === "true"
      ? (c.env.DEV_ACCESS_EMAIL ?? null)
      : await verifiedEmail(c.req.header("cf-access-jwt-assertion"), c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);
  if (!email) {
    return c.text("Unauthorized", 401);
  }

  const pg = new Client({ connectionString: c.env.PG.connectionString });
  await pg.connect();
  let user: AuthUser | null;
  try {
    user = await findUserByEmail(pg, email);
  } finally {
    await pg.end();
  }

  if (!user) {
    return c.text(`No verified Remain account for ${email}. Sign up in the app first.`, 403);
  }

  c.set("user", user);
  return next();
});
