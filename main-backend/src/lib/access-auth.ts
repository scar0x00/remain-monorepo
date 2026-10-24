import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";
import { type Env } from "../types";

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// Cloudflare Access (with Managed OAuth) authenticates MCP clients and forwards a signed JWT.
// Never trust the header without verifying its signature, issuer and audience.
export const accessAuth = createMiddleware<Env>(async (c, next) => {
  if (c.env.DEV_SKIP_ACCESS_AUTH === "true") {
    return next();
  }

  const token = c.req.header("cf-access-jwt-assertion");
  const issuer = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;

  // Fail closed when the worker is not configured.
  if (!token || !issuer || !audience) {
    return c.text("Unauthorized", 401);
  }

  let keys = jwks.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwks.set(issuer, keys);
  }

  try {
    await jwtVerify(token, keys, { issuer, audience });
  } catch {
    return c.text("Unauthorized", 401);
  }

  return next();
});
