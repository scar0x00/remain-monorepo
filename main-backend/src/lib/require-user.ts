import { createMiddleware } from "hono/factory";
import { type Context } from "hono";
import { type Auth, createAuth } from "./auth";
import { type Env } from "../types";

// Hono throws when a request has no execution context, which is the case in unit tests.
export const waitUntilOf = (c: Context<Env>) => {
  try {
    const ctx = c.executionCtx;
    return (promise: Promise<unknown>) => ctx.waitUntil(promise);
  } catch {
    return undefined;
  }
};

/** Runs `run` with this request's better-auth instance, then releases its database pool. */
export async function withAuth<T>(c: Context<Env>, run: (auth: Auth) => Promise<T>): Promise<T> {
  const waitUntil = waitUntilOf(c);
  const { auth, close } = (c.get("createAuth") ?? createAuth)(c.env, { waitUntil });
  try {
    return await run(auth);
  } finally {
    const closing = close().catch((error) => console.error("auth: closing the pool failed", error));
    if (waitUntil) waitUntil(closing);
    else await closing;
  }
}

/**
 * Lets the request through only with a valid session and sets `c.get("user")`, otherwise 401.
 *
 * Most requests are answered from the signed session cookie cache with no I/O at all. Every
 * `SESSION_COOKIE_CACHE_SECONDS` the session is checked against the store (Upstash, or Postgres
 * without it), and the refreshed cookie is passed on to the response so the next requests are
 * served from the cache again.
 */
export const requireUser = createMiddleware<Env>(async (c, next) => {
  const result = await withAuth(c, (auth) =>
    auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true }),
  );

  const session = result?.response;
  if (!session?.user) {
    return c.json({ error: "Sign in to continue" }, 401);
  }

  c.set("user", { id: session.user.id, name: session.user.name, email: session.user.email });
  await next();

  const cookies = result.headers?.getSetCookie() ?? [];
  if (cookies.length === 0) return;
  // A response passed through from a fetch (e.g. the agent's) has immutable headers: copy it. The
  // copy replaces `c.res` from scratch, because Hono's setter would put back the old cookies only.
  let res = c.res;
  try {
    for (const cookie of cookies) res.headers.append("set-cookie", cookie);
  } catch {
    res = new Response(c.res.body, c.res);
    for (const cookie of cookies) res.headers.append("set-cookie", cookie);
    c.res = undefined as unknown as Response;
    c.res = res;
  }
});
