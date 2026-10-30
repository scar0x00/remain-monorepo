import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chromium, type Browser, type Page } from "playwright-core";

// Deck editor (#14) against the running stack: frontend (4200) -> main-backend (8787). Unlike
// app.e2e.test.ts it needs no model calls, so the flashcard agent doesn't have to run.
// Uses the system Chrome; set E2E_BROWSER_PATH to use another Chromium, E2E_BASE_URL for another frontend.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4200";
const API = `${BASE}/api/v1`;
const RUN = Date.now().toString(36);

type Card = { id: string; front: string; back: string };
type Deck = { version: 2; meta: Record<string, unknown>; cards: Card[] };

const SEED: Deck = {
  version: 2,
  meta: { title: "Editor e2e", tool: { kind: "agent", model: "test-model", generatedAt: "2026-10-01T00:00:00.000Z" } },
  cards: [
    { id: "c_aaaaaaaaaaaa", front: "What is $2 + 2$?", back: "4" },
    { id: "c_bbbbbbbbbbbb", front: "Capital of France?", back: "Paris" },
  ],
};

let browser: Browser;
let page: Page;
let name: string;
const created: string[] = [];

const deckUrl = (key: string) => `${API}/deck/${encodeURIComponent(key)}`;

async function putDeck(key: string, deck: Deck) {
  const res = await fetch(deckUrl(key), { method: "PUT", body: JSON.stringify(deck) });
  expect(res.status).toBe(200);
}

async function readDeck(key: string): Promise<Deck> {
  const res = await fetch(deckUrl(key), { headers: { "cache-control": "no-cache" } });
  expect(res.status).toBe(200);
  return (await res.json()) as Deck;
}

beforeAll(async () => {
  const executablePath = process.env.E2E_BROWSER_PATH;
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome", headless: true });
});

beforeEach(async () => {
  name = `e2e-editor-${RUN}-${created.length}`;
  created.push(`${name}.json`);
  await putDeck(`${name}.json`, SEED);
  await page?.close();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  // Remove the decks this run created so repeated runs don't pile up in the deck list.
  await Promise.all(created.map((key) => fetch(deckUrl(key), { method: "DELETE" })));
});

describe("deck editor", () => {
  it("opens from the deck list, edits and adds cards, and saves them to the deck", async () => {
    await page.goto(`${BASE}/deck-browse`);
    await page.getByRole("link", { name: `Edit ${name}`, exact: true }).click();
    await page.waitForURL(`${BASE}/deck-edit/${name}`);

    const back = page.locator("#back-c_aaaaaaaaaaaa");
    await back.fill("Four ($4$)");
    await page.getByRole("button", { name: "Add card" }).click();
    const newFront = page.locator('textarea[id^="front-c_"]:focus');
    await newFront.fill("Largest planet?");
    const newId = (await newFront.getAttribute("id"))!.replace("front-", "");
    await page.locator(`#back-${newId}`).fill("Jupiter");

    await page.keyboard.press("Control+s");
    await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();

    const saved = await readDeck(`${name}.json`);
    expect(saved.cards).toEqual([
      { id: "c_aaaaaaaaaaaa", front: "What is $2 + 2$?", back: "Four ($4$)" },
      { id: newId, front: "Largest planet?", back: "Jupiter" },
      SEED.cards[1],
    ]);
    expect(newId).toMatch(/^c_[0-9a-f]{12}$/);
    // How the deck was produced never changes on an edit.
    expect(saved.meta.tool).toEqual(SEED.meta.tool);
  });

  it("refuses to save over a deck that changed elsewhere, then overwrites on request", async () => {
    await page.goto(`${BASE}/deck-edit/${name}`);
    await page.locator("#back-c_aaaaaaaaaaaa").fill("Mine");

    // Someone else (e.g. a chat refine) writes the deck in the meantime.
    await putDeck(`${name}.json`, { ...SEED, cards: [{ ...SEED.cards[0], back: "Theirs" }, SEED.cards[1]] });

    await page.keyboard.press("Control+s");
    const dialog = page.getByRole("alertdialog");
    await dialog.getByText("This deck changed while you were editing").waitFor();
    expect((await readDeck(`${name}.json`)).cards[0].back).toBe("Theirs");

    await dialog.getByRole("button", { name: "Overwrite with mine" }).click();
    await page.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
    expect((await readDeck(`${name}.json`)).cards[0].back).toBe("Mine");
  });

  it("reloads the other version from the conflict dialog", async () => {
    await page.goto(`${BASE}/deck-edit/${name}`);
    await page.locator("#back-c_aaaaaaaaaaaa").fill("Mine");
    await putDeck(`${name}.json`, { ...SEED, cards: [{ ...SEED.cards[0], back: "Theirs" }, SEED.cards[1]] });

    await page.keyboard.press("Control+s");
    await page.getByRole("alertdialog").getByRole("button", { name: "Reload deck" }).click();

    await page.getByRole("alertdialog").waitFor({ state: "hidden" });
    expect(await page.locator("#back-c_aaaaaaaaaaaa").inputValue()).toBe("Theirs");
    expect((await readDeck(`${name}.json`)).cards[0].back).toBe("Theirs");
  });
});

describe("study quick edit", () => {
  it("fixes the current card mid-run, saves it to the deck and keeps studying", async () => {
    await page.goto(`${BASE}/deck-study/${name}`);
    await page.getByRole("button", { name: "Show back" }).click();
    await page.getByRole("button", { name: "Right" }).click();

    // Second card of the run: fix its back from the dialog.
    await page.getByRole("button", { name: "Edit card" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit card" });
    const back = dialog.locator('textarea[id^="back-"]');
    const id = (await back.getAttribute("id"))!.replace("back-", "");
    const before = SEED.cards.find((card) => card.id === id)!;
    await back.fill(`${before.back} (fixed)`);
    await dialog.getByRole("button", { name: "Save card" }).click();
    await dialog.waitFor({ state: "hidden" });

    // The run continues on the same card, showing the fixed text.
    await page.getByRole("button", { name: "Show back" }).click();
    await page.getByText(`${before.back} (fixed)`).waitFor();
    await page.getByRole("button", { name: "Right" }).click();
    await page.getByText("You're done!").waitFor();

    const saved = await readDeck(`${name}.json`);
    expect(saved.cards.find((card) => card.id === id)!.back).toBe(`${before.back} (fixed)`);
  });
});
