import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Client } from "pg";
import { SYSTEM_USER_ID, backfillDeckRows } from "../../src/lib/decks";
import {
  getActivity,
  getOverview,
  listDeckSessions,
  listDeckStats,
  listHardestCards,
  parseDays,
  parseTimeZone,
  streaks,
} from "../../src/lib/stats";
import { createFakeR2 } from "../helpers/fake-r2";
import { createTestDb } from "../helpers/pglite";

let pg: Client;
const utc30 = { days: 30, tz: "UTC" };

type SeedAnswer = {
  correct: boolean;
  /** When the answer was given, as a Postgres expression. Defaults to one hour ago. */
  at?: string;
  cardId?: string;
  durationMs?: number;
};

let positions = 0;

async function seedSession(
  deckName: string,
  answers: SeedAnswer[],
  { status = "completed", startedAt }: { status?: string; startedAt?: string } = {},
) {
  const first = answers[0]?.at ?? "now() - interval '1 hour'";
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO public.study_sessions (user_id, deck_name, card_total, status, started_at)
     VALUES ($1, $2, $3, $4, ${startedAt ?? first}) RETURNING id`,
    [SYSTEM_USER_ID, deckName, answers.length, status],
  );
  const id = rows[0]!.id;

  for (const [i, a] of answers.entries()) {
    await pg.query(
      `INSERT INTO public.study_answers (session_id, position, card_id, card_front, correct, duration_ms, answered_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${a.at ?? "now() - interval '1 hour'"})`,
      [id, i, a.cardId ?? `card-${positions++}`, `Front of ${a.cardId ?? "card"}`, a.correct, a.durationMs ?? 1000],
    );
  }
  return id;
}

const right = (n: number, extra: Partial<SeedAnswer> = {}) =>
  Array.from({ length: n }, () => ({ correct: true, ...extra }));
const wrong = (n: number, extra: Partial<SeedAnswer> = {}) =>
  Array.from({ length: n }, () => ({ correct: false, ...extra }));

beforeAll(async () => {
  pg = (await createTestDb()).client;
}, 60_000);

beforeEach(async () => {
  await pg.query("TRUNCATE public.study_answers, public.study_sessions, public.decks");
  positions = 0;
});

describe("parsing", () => {
  it("falls back to UTC for unknown time zones", () => {
    expect(parseTimeZone("America/New_York")).toBe("America/New_York");
    expect(parseTimeZone("Not/AZone")).toBe("UTC");
    expect(parseTimeZone(undefined)).toBe("UTC");
  });

  it("accepts positive integer day counts and clamps them", () => {
    expect(parseDays("7", 30)).toBe(7);
    expect(parseDays("0", 30)).toBe(30);
    expect(parseDays("abc", 30)).toBe(30);
    expect(parseDays("9999", 30)).toBe(366);
  });
});

describe("streaks", () => {
  it("finds the longest run and a current run ending today", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-10", "2026-10-11"];
    expect(streaks(days, "2026-10-11")).toEqual({ currentStreak: 2, longestStreak: 3 });
  });

  it("keeps the current streak until today is over", () => {
    expect(streaks(["2026-10-09", "2026-10-10"], "2026-10-11").currentStreak).toBe(2);
    expect(streaks(["2026-10-09", "2026-10-10"], "2026-10-12").currentStreak).toBe(0);
  });

  it("is zero without any days", () => {
    expect(streaks([], "2026-10-11")).toEqual({ currentStreak: 0, longestStreak: 0 });
  });

  it("counts across a month boundary", () => {
    expect(streaks(["2026-09-30", "2026-10-01"], "2026-10-01").currentStreak).toBe(2);
  });
});

describe("getOverview", () => {
  it("returns zeros for a user with no answers", async () => {
    expect(await getOverview(pg, SYSTEM_USER_ID, utc30)).toEqual({
      days: 30,
      answered: 0,
      correct: 0,
      accuracy: null,
      previousAccuracy: null,
      sessions: 0,
      studyMs: 0,
      currentStreak: 0,
      longestStreak: 0,
      studiedCards: 0,
      masteredCards: 0,
      weekdays: [0, 0, 0, 0, 0, 0, 0],
    });
  });

  it("counts every answer per answer, including abandoned and in-progress sessions", async () => {
    await seedSession("a.json", [...right(3), ...wrong(1)]);
    await seedSession("a.json", [...right(1), ...wrong(1)], { status: "abandoned" });
    await seedSession("b.json", right(2), { status: "in_progress" });

    const overview = await getOverview(pg, SYSTEM_USER_ID, utc30);
    expect(overview.answered).toBe(8);
    expect(overview.correct).toBe(6);
    expect(overview.accuracy).toBe(0.75);
    expect(overview.sessions).toBe(3);
    expect(overview.weekdays.reduce((a, b) => a + b)).toBe(8);
  });

  it("compares with the window just before", async () => {
    await seedSession("a.json", right(1));
    await seedSession("a.json", [...right(1, { at: "now() - interval '40 days'" }), ...wrong(1, { at: "now() - interval '40 days'" })]);
    await seedSession("a.json", wrong(5, { at: "now() - interval '100 days'" }));

    const overview = await getOverview(pg, SYSTEM_USER_ID, utc30);
    expect(overview.accuracy).toBe(1);
    expect(overview.previousAccuracy).toBe(0.5);
  });

  it("caps each answer's duration", async () => {
    await seedSession("a.json", [
      { correct: true, durationMs: 5_000 },
      { correct: true, durationMs: 10 * 60_000 },
    ]);

    expect((await getOverview(pg, SYSTEM_USER_ID, utc30)).studyMs).toBe(65_000);
  });

  it("computes the current streak from answers on consecutive days", async () => {
    await seedSession("a.json", right(1, { at: "now()" }));
    await seedSession("a.json", right(1, { at: "now() - interval '1 day'" }));
    await seedSession("a.json", right(1, { at: "now() - interval '2 days'" }));
    await seedSession("a.json", right(1, { at: "now() - interval '10 days'" }));

    const overview = await getOverview(pg, SYSTEM_USER_ID, utc30);
    expect(overview.currentStreak).toBe(3);
    expect(overview.longestStreak).toBe(3);
  });

  it("counts a card as mastered when its last 3 answers are correct", async () => {
    await seedSession("a.json", [
      { correct: false, cardId: "x", at: "now() - interval '4 hours'" },
      { correct: true, cardId: "x", at: "now() - interval '3 hours'" },
      { correct: true, cardId: "x", at: "now() - interval '2 hours'" },
      { correct: true, cardId: "x", at: "now() - interval '1 hour'" },
      // Only two answers so far.
      { correct: true, cardId: "y" },
      { correct: true, cardId: "y" },
      // Latest answer is wrong.
      { correct: true, cardId: "z", at: "now() - interval '3 hours'" },
      { correct: true, cardId: "z", at: "now() - interval '2 hours'" },
      { correct: false, cardId: "z", at: "now() - interval '1 hour'" },
    ]);

    const overview = await getOverview(pg, SYSTEM_USER_ID, utc30);
    expect(overview.studiedCards).toBe(3);
    expect(overview.masteredCards).toBe(1);
  });
});

describe("getActivity", () => {
  it("buckets days in the requested time zone", async () => {
    // 23:30 and 00:30 UTC on consecutive days are both the same evening in New York.
    const late = "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '2 days' + interval '23 hours 30 minutes'";
    const early = "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 day' + interval '30 minutes'";
    await seedSession("a.json", [{ correct: true, at: late }, { correct: false, at: early }]);

    const utc = await getActivity(pg, SYSTEM_USER_ID, { days: 84, tz: "UTC" });
    const ny = await getActivity(pg, SYSTEM_USER_ID, { days: 84, tz: "America/New_York" });

    expect(utc.map((d) => d.answered)).toEqual([1, 1]);
    expect(ny).toHaveLength(1);
    expect(ny[0]).toMatchObject({ answered: 2, correct: 1, sessions: 1 });
  });

  it("leaves out answers before the window", async () => {
    await seedSession("a.json", right(1, { at: "now() - interval '10 days'" }));
    await seedSession("a.json", right(2));

    const activity = await getActivity(pg, SYSTEM_USER_ID, { days: 7, tz: "UTC" });
    expect(activity).toHaveLength(1);
    expect(activity[0]!.answered).toBe(2);
  });
});

describe("listDeckStats", () => {
  it("lists unstudied decks, studied decks and deleted decks with history", async () => {
    await pg.query(
      `INSERT INTO public.decks (name, user_id, card_count) VALUES ('fresh.json', $1, 12), ('studied.json', $1, 4)`,
      [SYSTEM_USER_ID],
    );
    await seedSession("studied.json", [...right(3), ...wrong(1)]);
    await seedSession("gone.json", right(1));

    const stats = await listDeckStats(pg, SYSTEM_USER_ID, utc30);
    expect(stats.map((d) => d.deckName).sort()).toEqual(["fresh.json", "gone.json", "studied.json"]);

    const byName = Object.fromEntries(stats.map((d) => [d.deckName, d]));
    expect(byName["fresh.json"]).toMatchObject({ exists: true, cardCount: 12, answered: 0, accuracy: null, totalSessions: 0, trend: [] });
    expect(byName["studied.json"]).toMatchObject({ exists: true, cardCount: 4, answered: 4, accuracy: 0.75, sessions: 1, lastSessionAccuracy: 0.75 });
    expect(byName["gone.json"]).toMatchObject({ exists: false, cardCount: null, accuracy: 1 });
    // Unstudied decks sort last.
    expect(stats.at(-1)!.deckName).toBe("fresh.json");
  });

  it("returns the last 10 sessions' accuracy, oldest first, and the window's accuracy", async () => {
    for (let i = 12; i >= 1; i--) {
      // i days ago: i right out of 12 answers, so older sessions do better.
      await seedSession("a.json", [...right(i), ...wrong(12 - i)].map((a) => ({ ...a, at: `now() - interval '${i} days'` })));
    }

    const [deck] = await listDeckStats(pg, SYSTEM_USER_ID, { days: 7, tz: "UTC" }, "a.json");
    expect(deck!.totalSessions).toBe(12);
    expect(deck!.trend).toHaveLength(10);
    expect(deck!.trend[0]).toBeCloseTo(10 / 12);
    expect(deck!.trend[9]).toBeCloseTo(1 / 12);
    expect(deck!.lastSessionAccuracy).toBeCloseTo(1 / 12);
    // Sessions 1 to 6 days ago are inside a 7-day window.
    expect(deck!.sessions).toBe(6);
    expect(deck!.answered).toBe(72);
    expect(deck!.correct).toBe(21);
  });
});

describe("listHardestCards", () => {
  it("ranks cards with at least 3 attempts by accuracy and skips perfect ones", async () => {
    await seedSession("a.json", [
      ...[false, false, true].map((correct) => ({ correct, cardId: "hard" })),
      ...[false, true, true, true].map((correct) => ({ correct, cardId: "ok" })),
      ...[true, true, true].map((correct) => ({ correct, cardId: "easy" })),
      ...[false, false].map((correct) => ({ correct, cardId: "few" })),
    ]);

    const cards = await listHardestCards(pg, SYSTEM_USER_ID);
    expect(cards.map((c) => c.cardId)).toEqual(["hard", "ok"]);
    expect(cards[0]).toMatchObject({ deckName: "a.json", attempts: 3, correct: 1, cardFront: "Front of hard" });
  });

  it("filters by deck", async () => {
    await seedSession("a.json", wrong(3, { cardId: "x" }));
    await seedSession("b.json", wrong(3, { cardId: "y" }));

    expect((await listHardestCards(pg, SYSTEM_USER_ID, { deckName: "b.json" })).map((c) => c.cardId)).toEqual(["y"]);
  });
});

describe("listDeckSessions", () => {
  it("lists sessions newest first and reports stale in-progress ones as abandoned", async () => {
    await seedSession("a.json", right(2, { at: "now() - interval '2 days'" }));
    await seedSession("a.json", [...right(1), ...wrong(1)], { status: "in_progress" });
    // No answers: left out.
    await seedSession("a.json", [], { startedAt: "now()" });

    const sessions = await listDeckSessions(pg, SYSTEM_USER_ID, "a.json");
    expect(sessions.map((s) => [s.status, s.answered, s.accuracy])).toEqual([
      ["abandoned", 2, 0.5],
      ["completed", 2, 1],
    ]);
  });
});

describe("backfillDeckRows", () => {
  it("fills in missing card counts, titles and metadata from the deck files", async () => {
    const bucket = createFakeR2();
    await bucket.put("old.json", JSON.stringify([{ front: "a", back: "b" }, { front: "c", back: "d" }]));
    await bucket.put("broken.json", "not json");
    const meta = { title: "Signals", tool: { kind: "agent", model: "m" } };
    await bucket.put("v2.json", JSON.stringify({ version: 2, meta, cards: [{ id: "c_1", front: "a", back: "b" }] }));
    await pg.query(
      `INSERT INTO public.decks (name, user_id) VALUES ('old.json', $1), ('broken.json', $1), ('missing.json', $1), ('v2.json', $1)`,
      [SYSTEM_USER_ID],
    );

    await backfillDeckRows({ bucket: bucket as unknown as R2Bucket, pg });

    const { rows } = await pg.query<{ name: string; card_count: number | null }>(
      `SELECT name, card_count, title, meta FROM public.decks ORDER BY name`,
    );
    expect(rows).toEqual([
      { name: "broken.json", card_count: null, title: null, meta: null },
      { name: "missing.json", card_count: null, title: null, meta: null },
      { name: "old.json", card_count: 2, title: null, meta: {} },
      { name: "v2.json", card_count: 1, title: "Signals", meta },
    ]);
  });
});
