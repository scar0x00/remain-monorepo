import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { signUp, signedInContext, totp, type Session } from "./auth";

// Two-step verification and passkeys (#12) through the UI, against the local stack. Passkeys use
// Chromium's virtual authenticator (DevTools WebAuthn domain), so no hardware is needed; WebAuthn
// needs a secure context, which `localhost` is.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4200";

let browser: Browser;
// One account for the whole file: sign-ups are limited to 5 an hour per IP, and every e2e file signs
// up from the same one. The passkey tests run on the account with 2FA on, which also shows that a
// passkey sign-in isn't asked for a code.
let session: Session;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  const executablePath = process.env.E2E_BROWSER_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome", headless: true });
  session = await signUp(BASE, "security");
  context = await signedInContext(browser, BASE, session);
  page = await context.newPage();
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
});

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${BASE}/`);
}

async function signInWithPassword(page: Page, session: Session) {
  await page.goto(`${BASE}/login?returnTo=%2Fdeck-browse`);
  await page.getByLabel("Email").fill(session.email);
  await page.getByLabel("Password").fill(session.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

describe("two-step verification with an authenticator app", () => {
  let key: string;

  it("sets up the app from the security page and shows the backup codes once", async () => {
    await page.goto(`${BASE}/deck-browse`);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Security" }).click();
    await page.waitForURL(`${BASE}/settings/security`);
    await page.getByRole("heading", { name: "Two-step verification" }).waitFor();

    await page.getByRole("button", { name: "Set up" }).click();
    await page.getByLabel("Your password").fill(session.password);
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("img", { name: "QR code for your authenticator app" }).waitFor();
    key = (await page.getByTestId("totp-key").textContent())!;
    await page.getByLabel("6-digit code").fill(await totp(key));
    await page.getByRole("button", { name: "Turn on" }).click();

    const codes = page.getByRole("list", { name: "Backup codes" });
    await codes.waitFor();
    expect(await codes.getByRole("listitem").count()).toBe(10);
    await page.getByRole("button", { name: "I’ve saved them" }).click();
    await page.getByText("Set up. Comes with backup codes.").waitFor();
  });

  it("asks for a code after the password, and signs in with it", async () => {
    await signOut(page);
    await signInWithPassword(page, session);
    await page.waitForURL(/\/login\/two-factor\?/);
    await page.getByText("Enter the code from your authenticator app.").waitFor();

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByRole("alert").filter({ hasText: "That code isn’t right" }).waitFor();

    await page.getByLabel("6-digit code").fill(await totp(key));
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL(`${BASE}/deck-browse`);
  });
});

describe("passkeys", () => {
  // Still signed in from the tests above.
  beforeAll(async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
  });

  it("adds a named passkey from the security page", async () => {
    await page.goto(`${BASE}/settings/security`);
    await page.getByText("No passkeys yet.").waitFor();
    await page.getByLabel("Name it, so you can tell your passkeys apart").fill("E2E authenticator");
    await page.getByRole("button", { name: "Add a passkey" }).click();

    const list = page.getByRole("list", { name: "Your passkeys" });
    await list.getByText("E2E authenticator").waitFor();
  });

  it("signs in with it, without a password or a code", async () => {
    await signOut(page);
    await page.goto(`${BASE}/login?returnTo=%2Fdeck-browse`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.waitForURL(`${BASE}/deck-browse`);
  });

  it("removes it", async () => {
    await page.goto(`${BASE}/settings/security`);
    const list = page.getByRole("list", { name: "Your passkeys" });
    await list.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await page.getByText("No passkeys yet.").waitFor();
  });
});
