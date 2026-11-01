import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { verificationLink } from "./auth";

// Accounts (#12) through the UI: sign up, verify the email, sign out, sign in again. Needs only
// main-backend (with DEV_LOG_EMAILS=true) and the frontend.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4200";
const EMAIL = `e2e-ui-${Date.now().toString(36)}@example.com`;
const PASSWORD = "e2e password 12345";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const executablePath = process.env.E2E_BROWSER_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome", headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

describe("accounts", () => {
  it("sends a signed-out visitor to the login page and back", async () => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL(`${BASE}/login?returnTo=%2Fdashboard`);
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
  });

  it("signs up, verifies the email from the link and lands signed in", async () => {
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.getByLabel("Name").fill("E2E Person");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("heading", { name: "Check your inbox" }).waitFor();

    await page.goto(await verificationLink(EMAIL));
    await page.waitForURL(`${BASE}/verify-email`);
    await page.getByRole("heading", { name: "Email verified" }).waitFor();

    await page.getByRole("link", { name: "Go to your decks" }).click();
    await page.waitForURL(`${BASE}/deck-browse`);
  });

  it("signs out from the menu", async () => {
    await page.getByRole("button", { name: "Open menu" }).click();
    expect(await page.locator("#nav-menu").textContent()).toContain(EMAIL);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(`${BASE}/`);

    await page.goto(`${BASE}/deck-browse`);
    await page.waitForURL(/\/login\?returnTo=%2Fdeck-browse$/);
  });

  it("rejects a wrong password and signs in with the right one", async () => {
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill("not the password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "don’t match" }).waitFor();

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${BASE}/deck-browse`);
  });
});
