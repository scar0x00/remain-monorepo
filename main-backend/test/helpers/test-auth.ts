import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Hono } from "hono";
import { type AuthEnv, type AuthOverrides, authOptions, createAuth } from "../../src/lib/auth";
import { redisSecondaryStorage, type RedisLike } from "../../src/lib/session-storage";
import { type Env } from "../../src/types";

export type SentMail = { to: string; subject: string; html?: string; text?: string; from: unknown };

/** A fake `send_email` binding that keeps every message. */
export function createFakeEmail() {
  const sent: SentMail[] = [];
  return {
    sent,
    async send(message: SentMail) {
      sent.push(message);
      return { messageId: `m${sent.length}` };
    },
  };
}

/** Enough of Upstash for the session store: strings with an optional TTL, plus the INCR script. */
export function createFakeRedis() {
  const data = new Map<string, { value: string; expiresAt?: number }>();
  let calls = 0;
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) data.delete(key);
    return data.get(key);
  };
  const redis = {
    async get(key: string) {
      calls++;
      return live(key)?.value ?? null;
    },
    async getdel(key: string) {
      calls++;
      const value = live(key)?.value ?? null;
      data.delete(key);
      return value;
    },
    async set(key: string, value: string, options?: { ex?: number }) {
      calls++;
      data.set(key, { value, expiresAt: options?.ex ? Date.now() + options.ex * 1000 : undefined });
      return "OK";
    },
    async del(key: string) {
      calls++;
      return data.delete(key) ? 1 : 0;
    },
    async eval(_script: string, [key]: string[], [ttl]: number[]) {
      calls++;
      const next = Number(live(key)?.value ?? 0) + 1;
      data.set(key, { value: String(next), expiresAt: live(key)?.expiresAt ?? Date.now() + ttl * 1000 });
      return next;
    },
  };
  return { data, redis: redis as unknown as RedisLike, calls: () => calls };
}

export const AUTH_ENV = {
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
  BETTER_AUTH_URL: "http://localhost",
};

/**
 * better-auth exactly as configured in src/lib/auth.ts, on an in-memory database and a fake Upstash.
 * `createAuth` has the same shape as the real one, to be set as the app's `createAuth` variable.
 */
export function createTestAuth() {
  const db: Record<string, unknown[]> = { user: [], session: [], account: [], verification: [] };
  const redis = createFakeRedis();
  const storage = redisSecondaryStorage(redis.redis);
  const factory: typeof createAuth = (env: AuthEnv, overrides: AuthOverrides = {}) => ({
    auth: betterAuth(
      authOptions(env, { ...overrides, database: memoryAdapter(db), secondaryStorage: storage }),
    ) as unknown as ReturnType<typeof createAuth>["auth"],
    close: async () => {},
  });
  return { db, redis, storage, createAuth: factory };
}

/** The app with better-auth swapped for `createTestAuth`'s. */
export function withTestAuth(app: Hono<Env>, testAuth: { createAuth: typeof createAuth }) {
  return new Hono<Env>()
    .use(async (c, next) => {
      c.set("createAuth", testAuth.createAuth);
      await next();
    })
    .route("/", app);
}

/** `name=value; ...` from a response's Set-Cookie headers, merged into `jar`. */
export function collectCookies(res: Response, jar = new Map<string, string>()) {
  for (const cookie of res.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value === "" || /max-age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

export const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Signs up with email and password, follows the verification link from the email, and returns the
 * signed-in cookie jar and user id. `request` takes paths under http://localhost.
 */
export async function signUpAndVerify(
  request: RequestFn,
  email: ReturnType<typeof createFakeEmail>,
  { address, name = "Test User", password = "correct horse battery" }: { address: string; name?: string; password?: string },
) {
  const signUp = await request("/api/v1/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: AUTH_ENV.BETTER_AUTH_URL },
    body: JSON.stringify({ email: address, password, name, callbackURL: "/verify-email" }),
  });
  if (!signUp.ok) throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);

  const mail = email.sent.findLast((m) => m.to === address);
  const link = mail?.text?.match(/https?:\/\/\S+verify-email\S+/)?.[0];
  if (!link) throw new Error(`no verification link sent to ${address}`);

  const url = new URL(link);
  const verified = await request(`${url.pathname}${url.search}`, { redirect: "manual" });
  if (verified.status >= 400) throw new Error(`verify failed: ${verified.status} ${await verified.text()}`);

  const jar = collectCookies(verified);
  const session = (await (
    await request("/api/v1/auth/get-session", { headers: { cookie: cookieHeader(jar) } })
  ).json()) as { user: { id: string } };
  return { jar, cookie: cookieHeader(jar), userId: session.user.id };
}

/**
 * `realApp` with test auth and Ada signed in. `request` is `app.request` with her session cookie
 * (unless the request sets its own `cookie`). Adds `AUTH_ENV` and a fake `EMAIL` to `env`.
 */
export async function signedInAs(
  realApp: Hono<Env>,
  env: Record<string, unknown>,
  { address = "ada@example.com", name = "Ada" } = {},
) {
  const email = createFakeEmail();
  Object.assign(env, AUTH_ENV, { EMAIL: email });
  const app = withTestAuth(realApp, createTestAuth());
  const raw = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, env as any);
  const { cookie, userId } = await signUpAndVerify(raw, email, { address, name });

  const request = (url: string, init: RequestInit = {}, ctx?: unknown) => {
    const headers = new Headers(init.headers);
    if (!headers.has("cookie")) headers.set("cookie", cookie);
    return app.request(url, { ...init, headers }, env as any, ctx as any);
  };
  return { app, request, cookie, userId };
}
