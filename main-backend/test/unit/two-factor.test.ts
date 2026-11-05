import { beforeEach, describe, expect, it, mock } from "bun:test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
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

mock.module("pg", fakePg);

const { default: realApp } = await import("../../src/index");

const PASSWORD = "correct horse battery";

let testAuth: ReturnType<typeof createTestAuth>;
let email: ReturnType<typeof createFakeEmail>;
let env: Record<string, unknown>;
let app: ReturnType<typeof withTestAuth>;

const request = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, env as any);
const post = (path: string, body: unknown, cookie?: string) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: AUTH_ENV.BETTER_AUTH_URL, ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });

/** The current code of the authenticator app set up from `totpURI`. */
async function totpCode(totpURI: string) {
  const secret = new TextDecoder().decode(base32.decode(new URL(totpURI).searchParams.get("secret")!));
  return createOTP(secret).totp();
}

const lastCode = (address: string) => email.sent.findLast((m) => m.to === address)?.text?.match(/^\d{6}$/m)?.[0];

const jarOf = (cookie: string) =>
  new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)] as [string, string]));

const security = async (cookie: string) => (await request("/api/v1/account/security", { headers: { cookie } })).json();

beforeEach(async () => {
  resetDecks();
  testAuth = createTestAuth();
  email = createFakeEmail();
  env = { ...AUTH_ENV, PG: { connectionString: "postgres://fake" }, DECKS: createFakeR2(), EMAIL: email };
  app = withTestAuth(realApp, testAuth);
});

async function signedUp(address = "ada@example.com") {
  return signUpAndVerify(request, email, { address, name: "Ada", password: PASSWORD });
}

/** Turns on the authenticator app and returns what the settings page would show once. */
async function enableAuthenticator(cookie: string) {
  const enabled = await post("/api/v1/auth/two-factor/enable", { password: PASSWORD }, cookie);
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  // Confirming the first code is what turns 2FA on; it also replaces the session cookie.
  const confirmed = await post("/api/v1/auth/two-factor/verify-totp", { code: await totpCode(totpURI) }, cookie);
  expect(confirmed.status).toBe(200);
  return { totpURI, backupCodes, cookie: cookieHeader(collectCookies(confirmed, jarOf(cookie))) };
}

const signIn = (address = "ada@example.com", init: { cookie?: string } = {}) =>
  post("/api/v1/auth/sign-in/email", { email: address, password: PASSWORD }, init.cookie);

describe("security status", () => {
  it("needs a session", async () => {
    expect((await request("/api/v1/account/security")).status).toBe(401);
  });

  it("starts with 2FA off for a password account", async () => {
    const { cookie } = await signedUp();
    expect(await security(cookie)).toEqual({ twoFactorEnabled: false, authenticatorApp: false, hasPassword: true });
  });
});

describe("authenticator app", () => {
  it("asks for the password, and stays off until the first code is confirmed", async () => {
    const { cookie } = await signedUp();
    expect((await post("/api/v1/auth/two-factor/enable", { password: "not my password" }, cookie)).status).toBe(400);
    expect((await post("/api/v1/auth/two-factor/enable", {}, cookie)).status).toBe(400);

    const res = await post("/api/v1/auth/two-factor/enable", { password: PASSWORD }, cookie);
    const { totpURI, backupCodes } = (await res.json()) as { totpURI: string; backupCodes: string[] };
    expect(new URL(totpURI).searchParams.get("issuer")).toBe("Remain");
    expect(totpURI).toContain("ada%40example.com");
    expect(backupCodes).toHaveLength(10);
    expect(await security(cookie)).toMatchObject({ twoFactorEnabled: false, authenticatorApp: false });

    expect((await post("/api/v1/auth/two-factor/verify-totp", { code: "000000" }, cookie)).status).toBe(401);
  });

  it("then asks for a code after the password, before any session exists", async () => {
    const { cookie } = await signedUp();
    const { totpURI } = await enableAuthenticator(cookie);
    expect(await security(cookie)).toMatchObject({ twoFactorEnabled: true, authenticatorApp: true });

    const challenge = await signIn();
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp", "otp"] });
    const pending = collectCookies(challenge);
    expect([...pending.keys()].some((name) => name.endsWith("session_token"))).toBe(false);
    expect((await request("/api/v1/decks", { headers: { cookie: cookieHeader(pending) } })).status).toBe(401);

    expect((await post("/api/v1/auth/two-factor/verify-totp", { code: "000000" }, cookieHeader(pending))).status).toBe(401);
    const verified = await post("/api/v1/auth/two-factor/verify-totp", { code: await totpCode(totpURI) }, cookieHeader(pending));
    expect(verified.status).toBe(200);
    const session = cookieHeader(collectCookies(verified, pending));
    expect((await request("/api/v1/decks", { headers: { cookie: session } })).status).toBe(200);
  });

  it("accepts each backup code once", async () => {
    const { cookie } = await signedUp();
    const { backupCodes } = await enableAuthenticator(cookie);

    const first = collectCookies(await signIn());
    const used = await post("/api/v1/auth/two-factor/verify-backup-code", { code: backupCodes[0] }, cookieHeader(first));
    expect(used.status).toBe(200);

    const second = collectCookies(await signIn());
    expect((await post("/api/v1/auth/two-factor/verify-backup-code", { code: backupCodes[0] }, cookieHeader(second))).status).toBe(401);
  });

  it("skips the code on a trusted device", async () => {
    const { cookie } = await signedUp();
    const { totpURI } = await enableAuthenticator(cookie);

    const pending = collectCookies(await signIn());
    const trusted = await post("/api/v1/auth/two-factor/verify-totp", { code: await totpCode(totpURI), trustDevice: true }, cookieHeader(pending));
    const jar = collectCookies(trusted, pending);
    expect([...jar.keys()].some((name) => name.endsWith("trust_device"))).toBe(true);

    const again = await signIn("ada@example.com", { cookie: cookieHeader(jar) });
    expect(((await again.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
  });

  it("turns off with the password", async () => {
    const { cookie: first } = await signedUp();
    const { cookie } = await enableAuthenticator(first);
    expect((await post("/api/v1/auth/two-factor/disable", { password: "not my password" }, cookie)).status).toBe(400);
    expect((await post("/api/v1/auth/two-factor/disable", { password: PASSWORD }, cookie)).status).toBe(200);

    const res = await signIn();
    expect(((await res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
  });
});

describe("email codes", () => {
  it("turn on once a code sent to the inbox is entered", async () => {
    const { cookie } = await signedUp();
    expect((await post("/api/v1/auth/two-factor/send-otp", {}, cookie)).status).toBe(200);
    const code = lastCode("ada@example.com");
    expect(code).toBeTruthy();
    expect(email.sent.at(-1)).toMatchObject({ subject: "Your Remain verification code" });

    const confirmed = await post("/api/v1/auth/two-factor/verify-otp", { code }, cookie);
    expect(confirmed.status).toBe(200);
    expect(await security(cookie)).toEqual({ twoFactorEnabled: true, authenticatorApp: false, hasPassword: true });
  });

  it("are the only method offered without an authenticator app, and sign in", async () => {
    const { cookie } = await signedUp();
    await post("/api/v1/auth/two-factor/send-otp", {}, cookie);
    await post("/api/v1/auth/two-factor/verify-otp", { code: lastCode("ada@example.com") }, cookie);

    const challenge = await signIn();
    expect(await challenge.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["otp"] });
    const pending = collectCookies(challenge);

    expect((await post("/api/v1/auth/two-factor/send-otp", {}, cookieHeader(pending))).status).toBe(200);
    const code = lastCode("ada@example.com")!;
    const verified = await post("/api/v1/auth/two-factor/verify-otp", { code }, cookieHeader(pending));
    expect(verified.status).toBe(200);
    expect((await request("/api/v1/decks", { headers: { cookie: cookieHeader(collectCookies(verified, pending)) } })).status).toBe(200);
  });

  it("are stored hashed, never as the code itself", async () => {
    const { cookie } = await signedUp();
    await post("/api/v1/auth/two-factor/send-otp", {}, cookie);
    const code = lastCode("ada@example.com")!;
    const stored = [...testAuth.redis.data.values()].map((entry) => entry.value).join("\n") + JSON.stringify(testAuth.db.verification);
    expect(stored).not.toContain(`"${code}`);
    expect(stored).not.toContain(`${code}:`);
  });
});

describe("passkeys", () => {
  it("are registered for this site only", async () => {
    const { cookie } = await signedUp();
    const res = await request("/api/v1/auth/passkey/generate-register-options", { headers: { cookie } });
    expect(res.status).toBe(200);
    const options = (await res.json()) as { rp: { id: string; name: string }; user: { name: string } };
    expect(options.rp).toEqual({ id: "localhost", name: "Remain" });
    expect(options.user.name).toBe("ada@example.com");
  });

  it("need a session to register", async () => {
    expect((await request("/api/v1/auth/passkey/generate-register-options")).status).toBe(401);
  });

  it("list empty for a new account", async () => {
    const { cookie } = await signedUp();
    const res = await request("/api/v1/auth/passkey/list-user-passkeys", { headers: { cookie } });
    expect(await res.json()).toEqual([]);
  });
});
