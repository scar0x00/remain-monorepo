import { beforeEach, describe, expect, it, mock, setSystemTime, afterEach } from "bun:test";
import { fakePg, resetDecks } from "../helpers/fake-pg";
import { createFakeR2 } from "../helpers/fake-r2";
import {
  AUTH_ENV,
  collectCookies,
  cookieHeader,
  createFakeEmail,
  createTestAuth,
  signUpAndVerify,
  withTestAuth,
} from "../helpers/test-auth";
import { SESSION_COOKIE_CACHE_SECONDS } from "../../src/lib/auth";

mock.module("pg", fakePg);

const { default: realApp } = await import("../../src/index");

let testAuth: ReturnType<typeof createTestAuth>;
let email: ReturnType<typeof createFakeEmail>;
let env: Record<string, unknown>;
let app: ReturnType<typeof withTestAuth>;

const request = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, env as any);
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin: AUTH_ENV.BETTER_AUTH_URL },
  body: JSON.stringify(body),
});

beforeEach(() => {
  resetDecks();
  testAuth = createTestAuth();
  email = createFakeEmail();
  env = { ...AUTH_ENV, PG: { connectionString: "postgres://fake" }, DECKS: createFakeR2(), EMAIL: email };
  app = withTestAuth(realApp, testAuth);
});

afterEach(() => setSystemTime());

describe("sign-up and email verification", () => {
  it("sends a verification email from the Remain sender and doesn't sign in before it is used", async () => {
    const res = await request("/api/v1/auth/sign-up/email", json({ email: "ada@example.com", password: "correct horse battery", name: "Ada" }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);

    expect(email.sent).toHaveLength(1);
    const [mail] = email.sent;
    expect(mail).toMatchObject({
      to: "ada@example.com",
      from: { name: "Remain", email: "no-reply@remain.scar0x00.click" },
      subject: "Verify your email for Remain",
    });
    const link = mail.text!.match(/http:\/\/localhost\/api\/v1\/auth\/verify-email\?token=\S+/)?.[0];
    expect(link).toBeTruthy();
    expect(mail.html).toContain(link!.replaceAll("&", "&amp;"));

    const signIn = await request("/api/v1/auth/sign-in/email", json({ email: "ada@example.com", password: "correct horse battery" }));
    expect(signIn.status).toBe(403);
  });

  it("signs in once the email is verified and lets the user reach the API", async () => {
    const { cookie, userId } = await signUpAndVerify(request, email, { address: "ada@example.com", name: "Ada" });
    expect(userId).toBeTruthy();

    expect((await request("/api/v1/decks")).status).toBe(401);
    expect((await request("/api/v1/decks", { headers: { cookie } })).status).toBe(200);
  });

  it("rejects passwords shorter than 10 characters", async () => {
    const res = await request("/api/v1/auth/sign-up/email", json({ email: "ada@example.com", password: "short", name: "Ada" }));
    expect(res.status).toBe(400);
  });
});

describe("password reset", () => {
  it("emails a reset link", async () => {
    await signUpAndVerify(request, email, { address: "ada@example.com" });
    const res = await request("/api/v1/auth/request-password-reset", json({ email: "ada@example.com", redirectTo: "/reset-password" }));
    expect(res.status).toBe(200);
    const mail = email.sent.at(-1)!;
    expect(mail.subject).toBe("Reset your Remain password");
    expect(mail.text).toMatch(/http:\/\/localhost\/api\/v1\/auth\/reset-password\/\S+callbackURL=%2Freset-password/);
  });
});

describe("session validation", () => {
  it("answers from the signed cookie cache without asking the session store", async () => {
    const { cookie } = await signUpAndVerify(request, email, { address: "ada@example.com" });
    const before = testAuth.redis.calls();

    for (let i = 0; i < 5; i++) {
      expect((await request("/api/v1/deck/missing.json", { headers: { cookie } })).status).toBe(404);
    }

    expect(testAuth.redis.calls()).toBe(before);
  });

  it("answers get-session from the cookie cache without a rate-limit write", async () => {
    const { cookie } = await signUpAndVerify(request, email, { address: "ada@example.com" });
    const before = testAuth.redis.calls();

    for (let i = 0; i < 5; i++) {
      const res = await request("/api/v1/auth/get-session", { headers: { cookie } });
      expect(((await res.json()) as { user: { email: string } }).user.email).toBe("ada@example.com");
    }

    expect(testAuth.redis.calls()).toBe(before);
  });

  it("keeps sessions in Upstash, not only in the database", async () => {
    await signUpAndVerify(request, email, { address: "ada@example.com" });
    const keys = [...testAuth.redis.data.keys()];
    expect(keys.some((key) => key.startsWith("active-sessions-"))).toBe(true);
    // storeSessionInDatabase keeps an audit row.
    expect(testAuth.db.session).toHaveLength(1);
  });

  it("re-checks the store once the cache expires, and passes the refreshed cookie on", async () => {
    const { jar } = await signUpAndVerify(request, email, { address: "ada@example.com" });
    setSystemTime(new Date(Date.now() + (SESSION_COOKIE_CACHE_SECONDS + 5) * 1000));
    const before = testAuth.redis.calls();

    const res = await request("/api/v1/deck/missing.json", { headers: { cookie: cookieHeader(jar) } });
    expect(res.status).toBe(404);
    expect(testAuth.redis.calls()).toBeGreaterThan(before);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_data"))).toBe(true);
  });

  it("rejects a revoked session once the cache expires, without falling back to the database", async () => {
    const { jar } = await signUpAndVerify(request, email, { address: "ada@example.com" });
    // A sign-out on another device: the session is gone from the store.
    for (const key of testAuth.redis.data.keys()) if (!key.startsWith("active-sessions-")) testAuth.redis.data.delete(key);

    expect((await request("/api/v1/decks", { headers: { cookie: cookieHeader(jar) } })).status).toBe(200);
    setSystemTime(new Date(Date.now() + (SESSION_COOKIE_CACHE_SECONDS + 5) * 1000));
    expect((await request("/api/v1/decks", { headers: { cookie: cookieHeader(jar) } })).status).toBe(401);
  });

  it("rejects a tampered session cookie", async () => {
    const { jar } = await signUpAndVerify(request, email, { address: "ada@example.com" });
    const tampered = new Map(
      [...jar].map(([name, value]) => [name, name.endsWith("session_token") ? `x${value.slice(1)}` : value]),
    );
    tampered.delete([...jar.keys()].find((name) => name.endsWith("session_data"))!);
    expect((await request("/api/v1/decks", { headers: { cookie: cookieHeader(tampered) } })).status).toBe(401);
  });

  it("signs out", async () => {
    const { jar } = await signUpAndVerify(request, email, { address: "ada@example.com" });
    const res = await request("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie: cookieHeader(jar), origin: AUTH_ENV.BETTER_AUTH_URL },
    });
    expect(res.status).toBe(200);
    collectCookies(res, jar);
    expect((await request("/api/v1/decks", { headers: { cookie: cookieHeader(jar) } })).status).toBe(401);
  });
});

describe("rate limiting", () => {
  it("limits sign-ups per IP, since each one sends an email", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request("/api/v1/auth/sign-up/email", {
        ...json({ email: `u${i}@example.com`, password: "correct horse battery", name: "U" }),
        headers: { "content-type": "application/json", origin: AUTH_ENV.BETTER_AUTH_URL, "cf-connecting-ip": "203.0.113.7" },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("GitHub", () => {
  it("is offered only when configured", async () => {
    const body = json({ provider: "github", callbackURL: "/" });
    expect((await request("/api/v1/auth/sign-in/social", body)).status).toBe(404);

    env.GITHUB_CLIENT_ID = "id";
    env.GITHUB_CLIENT_SECRET = "secret";
    const res = await request("/api/v1/auth/sign-in/social", body);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain("https://github.com/login/oauth/authorize");
    expect(new URL(url).searchParams.get("redirect_uri")).toBe("http://localhost/api/v1/auth/callback/github");
  });
});
