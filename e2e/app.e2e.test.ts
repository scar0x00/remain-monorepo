import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chromium, type Browser, type Page } from "playwright-core";

// Browser-driven checks against the running stack: frontend (4200) -> main-backend (8787)
// -> flashcard-generator-agent (8788). Start the stack first with `./dev-server start`.
// Uses the system Chrome; set E2E_BASE_URL to point at a different frontend.
// main-backend reads back the decks flashcard-generator-agent writes, so both workers must share
// local R2 state (wrangler dev --persist-to <same dir>). Without that, generation returns 500.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4200";
const API = `${BASE}/api/v1`;
const DECK = `e2e-ui-${Date.now().toString(36)}`;
const DECK_KEY = `${DECK}.json`;

const SOURCE = [
  "Photosynthesis is the process by which green plants, algae and some bacteria convert light energy into chemical energy.",
  "It takes place mainly in the chloroplasts, using the pigment chlorophyll.",
  "The light-dependent reactions happen in the thylakoid membranes and split water, releasing oxygen and producing ATP and NADPH.",
  "The Calvin cycle in the stroma uses ATP and NADPH to fix carbon dioxide into sugars such as G3P.",
].join(" ");

const GENERATE_TIMEOUT = 240_000;
const STUDY_TIMEOUT = 180_000;

let browser: Browser;
let page: Page;
let cardCount = 0;

type Card = { front: string; back: string };

async function fetchDeck(): Promise<Card[]> {
  const res = await fetch(`${API}/deck/${encodeURIComponent(DECK_KEY)}`);
  expect(res.status).toBe(200);
  // v2 decks are { version, meta, cards }; legacy decks are a bare array.
  const body = (await res.json()) as Card[] | { cards: Card[] };
  return Array.isArray(body) ? body : body.cards;
}

// Polls until the callback returns a truthy value, so DOM-driven checks don't race rendering.
async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!ok(value) && Date.now() < deadline) {
    await Bun.sleep(250);
    value = await read();
  }
  return value;
}

beforeAll(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  // Remove the deck this run created so repeated runs don't pile up in the deck list.
  await fetch(`${API}/deck/${encodeURIComponent(DECK_KEY)}`, { method: "DELETE" });
});

describe("deck browsing", () => {
  it("lists stored decks without the .json suffix", async () => {
    await page.goto(`${BASE}/deck-browse`);
    const res = await fetch(`${API}/decks`);
    const stored = (await res.json()) as { deckName: string }[];

    for (const { deckName } of stored) {
      const name = deckName.replace(/\.json$/i, "");
      await page.getByRole("link", { name, exact: true }).waitFor();
    }
    expect(await page.getByRole("link", { name: /\.json$/ }).count()).toBe(0);
  });
});

describe("AI deck generation and refinement", () => {
  it("generates a deck from pasted text", async () => {
    await page.goto(`${BASE}/flashcard-chat`);

    await page.getByRole("textbox", { name: "Message" }).fill(SOURCE);
    await page.getByRole("textbox", { name: "Deck name" }).fill(DECK);
    await page.getByRole("spinbutton", { name: "Cards" }).fill("6");
    await page.getByRole("button", { name: "Generate", exact: true }).click();

    const reply = page.getByText(new RegExp(`^Created \\d+ flashcards in ${DECK}\\.$`));
    await reply.waitFor({ timeout: GENERATE_TIMEOUT });
    const match = (await reply.textContent())?.match(/Created (\d+) flashcards/);
    cardCount = Number(match?.[1]);

    expect(cardCount).toBeGreaterThan(0);
    const deck = await fetchDeck();
    expect(deck.length).toBe(cardCount);
    for (const card of deck) {
      expect(card.front.trim()).not.toBe("");
      expect(card.back.trim()).not.toBe("");
    }
  }, GENERATE_TIMEOUT);

  it("refines the generated deck with a change request", async () => {
    // The composer switches to "Update deck" once a deck is active in this conversation.
    await page.getByText(`Editing ${DECK}.`).waitFor();

    await page.getByRole("textbox", { name: "Message" }).fill("Make the answers shorter and add a card about what chlorophyll does.");
    await page.getByRole("button", { name: "Update deck" }).click();

    const reply = page.getByText(new RegExp(`^Updated ${DECK}\\. It now has \\d+ flashcards\\.$`));
    await reply.waitFor({ timeout: GENERATE_TIMEOUT });
    const updated = Number((await reply.textContent())?.match(/now has (\d+)/)?.[1]);

    const deck = await fetchDeck();
    expect(deck.length).toBe(updated);
    expect(deck.length).toBeGreaterThan(0);
    cardCount = deck.length;
  }, GENERATE_TIMEOUT);
});

describe("study session", () => {
  it("finds the deck through search and renders every card", async () => {
    const deck = await fetchDeck();
    const byFront = new Map(deck.map((card) => [card.front.trim(), card.back.trim()]));

    await page.goto(`${BASE}/deck-browse`);
    await page.getByRole("textbox").first().fill(DECK);
    await page.getByRole("link", { name: DECK, exact: true }).click();
    await page.waitForURL(`**/deck-study/${DECK}`);

    const card = page.locator("app-flashcard");
    const doneMarker = page.getByText("You're done!");
    let right = 0;
    let wrong = 0;

    for (let i = 0; i < cardCount; i++) {
      // A blank front means the markdown never rendered, which is the bug this test guards against.
      const front = await waitFor(
        async () => (await card.innerText()).trim(),
        (text) => text.length > 0,
      );
      expect(front.length).toBeGreaterThan(0);
      const expectedFront = [...byFront.keys()].find((known) => front.startsWith(known.slice(0, 40)));
      expect(expectedFront).toBeDefined();

      await page.getByRole("button", { name: "Show back" }).click();
      // Once flipped, the back is a second rendered markdown block that must contain text.
      const back = await waitFor(
        async () => (await card.locator("markdown").nth(1).innerText()).trim(),
        (text) => text.length > 0,
      );
      expect(back.length).toBeGreaterThan(0);

      if (i % 2 === 0) {
        await page.getByRole("button", { name: "Right" }).click();
        right++;
      } else {
        await page.getByRole("button", { name: "Wrong" }).click();
        wrong++;
      }
    }

    await doneMarker.waitFor();
    await page.getByText(new RegExp(`^${right} right · ${wrong} wrong · \\d+s$`)).waitFor();
  }, STUDY_TIMEOUT);
});
