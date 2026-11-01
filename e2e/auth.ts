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

export type Session = { cookie: string; cookies: { name: string; value: string }[] };

export async function signUp(base: string, label: string): Promise<Session> {
  const email = `e2e-${label}-${Date.now().toString(36)}@example.com`;
  const res = await fetch(`${base}/api/v1/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password: "e2e password 12345", name: "E2E", callbackURL: "/verify-email" }),
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
  return { cookies, cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
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
