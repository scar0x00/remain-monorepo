import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Browser, BrowserContext } from "playwright-core";

// Accounts (#12): every API route and app page needs a session. Each test file signs up its own
// account and follows the verification link main-backend logs (DEV_LOG_EMAILS=true, see
// .github/workflows/tests.yml and main-backend/README.md). Set E2E_BACKEND_LOG to read another log.
const BACKEND_LOG =
  process.env.E2E_BACKEND_LOG ?? join(process.env.TMPDIR ?? join(tmpdir(), "opencode"), "dev-server", "main-backend.log");

/** The verification link main-backend logged for `email`. */
export async function verificationLink(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const log = await Bun.file(BACKEND_LOG).text().catch(() => "");
    const at = log.lastIndexOf(`[email] to=${email}`);
    const link = at >= 0 ? log.slice(at).match(/https?:\/\/\S+\/verify-email\?token=\S+/)?.[0] : undefined;
    if (link) return link;
    await Bun.sleep(250);
  }
  throw new Error(`no verification link for ${email} in ${BACKEND_LOG}`);
}

export type Session = { cookie: string; cookies: { name: string; value: string }[]; email: string; password: string };

export const PASSWORD = "e2e password 12345";

export async function signUp(base: string, label: string): Promise<Session> {
  const email = `e2e-${label}-${Date.now().toString(36)}@example.com`;
  const res = await fetch(`${base}/api/v1/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password: PASSWORD, name: "E2E", callbackURL: "/verify-email" }),
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);

  const link = await verificationLink(email);
  const verified = await fetch(link, { redirect: "manual" });
  const cookies = verified.headers.getSetCookie().map((header) => {
    const [pair] = header.split(";");
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at), value: pair.slice(at + 1) };
  });
  if (!cookies.some((c) => c.name.endsWith("session_token"))) throw new Error("verification didn't sign in");
  return { cookies, cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "), email, password: PASSWORD };
}

/** `fetch` with the session cookie. */
export const authedFetch = (session: Session) => (url: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cookie", session.cookie);
  return fetch(url, { ...init, headers });
};

/** A browser context that is signed in. */
export async function signedInContext(browser: Browser, base: string, session: Session): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies(session.cookies.map((c) => ({ ...c, url: base })));
  return context;
}

/**
 * The current code of an authenticator app set up with `key` (the base32 key the security page
 * shows, spaces allowed): RFC 6238, SHA-1, 6 digits, 30 seconds.
 */
export async function totp(key: string, at = Date.now()): Promise<string> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of key.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const secret = new Uint8Array(Math.floor(bits.length / 8)).map((_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));

  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(Math.floor(at / 1000 / 30)));
  const hmacKey = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, counter.buffer));
  const offset = mac[mac.length - 1] & 0x0f;
  const value = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}
