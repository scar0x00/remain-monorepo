import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeClient, answers, resetDecks, sessions } from "../helpers/fake-pg";
import { createFakeR2 } from "../helpers/fake-r2";

mock.module("pg", () => ({ Client: FakeClient }));

const { default: app } = await import("../../src/index");

let env: Record<string, unknown>;

const request = (path: string, init?: RequestInit) =>
  app.request(`http://localhost/api/v1/study-sessions${path}`, init, env as any);

const post = (path: string, body: unknown) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const start = async (deckName = "alpha.json") => {
  const res = await post("", { deckName, deckEtag: '"abc"', cardTotal: 3 });
  return ((await res.json()) as { id: string }).id;
};

beforeEach(() => {
  resetDecks();
  env = { PG: { connectionString: "postgres://fake" }, DECKS: createFakeR2() };
});

describe("POST /study-sessions", () => {
  it("creates an in-progress session", async () => {
    const res = await post("", { deckName: "alpha.json", deckEtag: '"abc"', cardTotal: 3 });

    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(sessions.get(id)).toMatchObject({ deck_name: "alpha.json", card_total: 3, status: "in_progress" });
  });

  it("rejects an invalid body", async () => {
    expect((await post("", { deckName: "", cardTotal: -1 })).status).toBe(400);
  });
});

describe("POST /study-sessions/:id/answers", () => {
  it("is idempotent per position", async () => {
    const id = await start();
    const batch = { answers: [{ position: 0, cardId: "a", cardFront: "Q", correct: true, durationMs: 1200 }] };

    expect((await post(`/${id}/answers`, batch)).status).toBe(204);
    expect((await post(`/${id}/answers`, batch)).status).toBe(204);
    await post(`/${id}/answers`, { answers: [{ position: 0, cardId: "a", correct: false }] });

    expect(answers).toHaveLength(1);
    expect(answers[0].correct).toBe(false);
  });

  it("404s for an unknown session", async () => {
    const res = await post("/00000000-0000-0000-0000-999999999999/answers", {
      answers: [{ position: 0, cardId: "a", correct: true }],
    });
    expect(res.status).toBe(404);
  });

  it("rejects answers once the session is finished", async () => {
    const id = await start();
    await post(`/${id}/finish`, {});

    const res = await post(`/${id}/answers`, { answers: [{ position: 0, cardId: "a", correct: true }] });
    expect(res.status).toBe(409);
  });
});

describe("finish, get and list", () => {
  it("finishes with totals and accuracy", async () => {
    const id = await start();
    await post(`/${id}/answers`, {
      answers: [
        { position: 0, cardId: "a", correct: true },
        { position: 1, cardId: "b", correct: false },
        { position: 2, cardId: "c", correct: true },
      ],
    });

    const res = await post(`/${id}/finish`, {});
    const body = (await res.json()) as any;

    expect(body).toMatchObject({ status: "completed", right: 2, wrong: 1 });
    expect(body.accuracy).toBeCloseTo(2 / 3);
  });

  it("returns a session with its answers", async () => {
    const id = await start();
    await post(`/${id}/answers`, { answers: [{ position: 0, cardId: "a", cardFront: "Q", correct: true }] });

    const body = (await (await request(`/${id}`)).json()) as any;
    expect(body.answers).toMatchObject([{ position: 0, cardId: "a", cardFront: "Q", correct: true }]);
  });

  it("reports idle sessions as abandoned but keeps their answers", async () => {
    const id = await start();
    await post(`/${id}/answers`, { answers: [{ position: 0, cardId: "a", correct: true }] });
    answers[0].answered_at = new Date(Date.now() - 60 * 60 * 1000);
    sessions.get(id)!.started_at = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const body = (await (await request(`/${id}`)).json()) as any;
    expect(body).toMatchObject({ status: "abandoned", right: 1 });
  });

  it("does not expose other users' sessions", async () => {
    const id = await start();
    sessions.get(id)!.user_id = "someone-else";

    expect((await request(`/${id}`)).status).toBe(404);
    expect((await post(`/${id}/finish`, {})).status).toBe(404);
    const list = (await (await request("")).json()) as any;
    expect(list.sessions).toHaveLength(0);
  });

  it("lists sessions newest first, filtered by deck, with a cursor", async () => {
    for (const name of ["alpha.json", "alpha.json", "beta.json"]) {
      const id = await start(name);
      sessions.get(id)!.started_at = new Date(Date.now() - (sessions.size - 1) * 1000);
    }

    const filtered = (await (await request("?deckName=alpha.json")).json()) as any;
    expect(filtered.sessions).toHaveLength(2);

    const page = (await (await request("?limit=2")).json()) as any;
    expect(page.sessions).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
    const next = (await (await request(`?limit=2&cursor=${page.nextCursor}`)).json()) as any;
    expect(next.sessions).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
  });
});

describe("GET /decks study stats", () => {
  it("adds run count and the average of the last three completed runs", async () => {
    await app.request(
      "http://localhost/api/v1/deck/alpha.json",
      { method: "PUT", body: "[]" },
      env as any,
    );
    await app.request("http://localhost/api/v1/deck/beta.json", { method: "PUT", body: "[]" }, env as any);

    // accuracies, oldest to newest: 0, 1, 0.5, 0.5 -> last three average 2/3
    for (const [i, right] of [0, 2, 1, 1].entries()) {
      const id = await start("alpha.json");
      sessions.get(id)!.started_at = new Date(Date.now() - (10 - i) * 1000);
      await post(`/${id}/answers`, {
        answers: [
          { position: 0, cardId: "a", correct: right >= 1 },
          { position: 1, cardId: "b", correct: right === 2 },
        ],
      });
      await post(`/${id}/finish`, {});
    }
    await start("alpha.json"); // in progress, not counted

    const res = await app.request("http://localhost/api/v1/decks", {}, env as any);
    const [alpha, beta] = (await res.json()) as any[];

    expect(alpha.studyCount).toBe(4);
    expect(alpha.recentAccuracy).toBeCloseTo(2 / 3);
    expect(beta.studyCount).toBeUndefined();
  });
});
