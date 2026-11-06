import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Client } from "pg";
import { listDeckPage, type DeckStore } from "../../src/lib/decks";
import { createFakeR2 } from "../helpers/fake-r2";
import { createTestDb } from "../helpers/pglite";

// listDeckPage's SQL on a real Postgres. Seeded by migrations/0001_decks_metadata.sql.
const USER = "system";
let pg: Client;
let store: DeckStore;

const names = (page: { decks: { deckName: string }[] }) => page.decks.map((d) => d.deckName);

/** A deck created `minutesAgo` minutes ago. */
const addDeck = (name: string, minutesAgo: number, title: string | null = null) =>
  pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag, title, "createdAt")
     VALUES ($1, $2, 1, 'e', $3, now() - make_interval(mins => $4))`,
    [name, USER, title, minutesAgo],
  );

/** A completed run of `deckName` with the given answers. */
async function study(deckName: string, answers: boolean[], minutesAgo = 10) {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO public.study_sessions (user_id, deck_name, card_total, status, started_at)
     VALUES ($1, $2, $3, 'completed', now() - make_interval(mins => $4)) RETURNING id`,
    [USER, deckName, answers.length, minutesAgo],
  );
  for (const [position, correct] of answers.entries()) {
    await pg.query(
      `INSERT INTO public.study_answers (session_id, position, card_id, correct) VALUES ($1, $2, $3, $4)`,
      [rows[0]!.id, position, `c${position}`, correct],
    );
  }
}

beforeAll(async () => {
  pg = (await createTestDb()).client;
  store = { bucket: createFakeR2() as any, pg, userId: USER };
}, 60_000);

beforeEach(async () => {
  await pg.query("TRUNCATE public.study_answers, public.study_sessions, public.decks");
});

describe("listDeckPage", () => {
  it("returns pages of 10 with the total", async () => {
    for (let i = 1; i <= 23; i++) await addDeck(`d${String(i).padStart(2, "0")}.json`, i);

    const first = await listDeckPage(store);
    expect(first).toMatchObject({ total: 23, page: 1, pageSize: 10, sort: "name", order: "asc" });
    expect(names(first)[0]).toBe("d01.json");
    expect(first.decks).toHaveLength(10);

    expect(names(await listDeckPage(store, { page: 3 }))).toEqual(["d21.json", "d22.json", "d23.json"]);

    const past = await listDeckPage(store, { page: 9 });
    expect(past.decks).toEqual([]);
    expect(past.total).toBe(23);
  });

  it("sorts names case-insensitively", async () => {
    await addDeck("banana.json", 1);
    await addDeck("Apple.json", 2);
    await addDeck("cherry.json", 3);

    expect(names(await listDeckPage(store))).toEqual(["Apple.json", "banana.json", "cherry.json"]);
    expect(names(await listDeckPage(store, { order: "desc" }))).toEqual(["cherry.json", "banana.json", "Apple.json"]);
  });

  it("sorts by creation date, newest first by default", async () => {
    await addDeck("old.json", 30);
    await addDeck("new.json", 1);
    await addDeck("mid.json", 10);

    expect(names(await listDeckPage(store, { sort: "created" }))).toEqual(["new.json", "mid.json", "old.json"]);
    expect(names(await listDeckPage(store, { sort: "created", order: "asc" }))).toEqual([
      "old.json",
      "mid.json",
      "new.json",
    ]);
  });

  it("sorts by recent success rate, never-studied decks last", async () => {
    for (const name of ["half.json", "full.json", "none.json", "fresh.json"]) await addDeck(name, 1);
    await study("half.json", [true, false]);
    await study("full.json", [true, true]);
    await study("none.json", [false, false]);

    const best = await listDeckPage(store, { sort: "success" });
    expect(names(best)).toEqual(["full.json", "half.json", "none.json", "fresh.json"]);
    expect(best.decks[0]).toMatchObject({ studyCount: 1, recentAccuracy: 1 });
    expect(best.decks[3]).not.toHaveProperty("studyCount");

    expect(names(await listDeckPage(store, { sort: "success", order: "asc" }))).toEqual([
      "none.json",
      "half.json",
      "full.json",
      "fresh.json",
    ]);
  });

  it("pages the decks matching the search, by name or title", async () => {
    await addDeck("alpha.json", 1);
    await addDeck("beta.json", 2, "Alphabet");
    await addDeck("gamma.json", 3);

    const page = await listDeckPage(store, { searchTerm: "alp", pageSize: 1, page: 2 });
    expect(names(page)).toEqual(["beta.json"]);
    expect(page.total).toBe(2);
  });

  it("only lists the user's own decks", async () => {
    await pg.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('bob', 'Bob', 'bob@example.com', true, now(), now()) ON CONFLICT DO NOTHING`,
    );
    await pg.query(`INSERT INTO public.decks (name, user_id, size, etag) VALUES ('bobs.json', 'bob', 1, 'e')`);
    await addDeck("mine.json", 1);

    const page = await listDeckPage(store);
    expect(names(page)).toEqual(["mine.json"]);
    expect(page.total).toBe(1);
  });
});
