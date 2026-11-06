import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fakePg, decksOf, resetDecks, sessions } from "../helpers/fake-pg";
import { createFakeR2, type FakeR2 } from "../helpers/fake-r2";
import { AUTH_ENV, createFakeEmail, createTestAuth, signUpAndVerify, withTestAuth } from "../helpers/test-auth";
import { legacyCardId } from "../../src/lib/deck-format";

mock.module("pg", fakePg);

const { default: realApp } = await import("../../src/index");

const BASE = "http://localhost/api/v1";
let DECKS: FakeR2;
let env: Record<string, unknown>;
let app: ReturnType<typeof withTestAuth>;
let email: ReturnType<typeof createFakeEmail>;

type User = { cookie: string; userId: string };
// Ada is signed in for every test; Bob is the other user in the isolation tests.
let ada: User;
let USER: string;

const authRequest = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init, env as any);

/** A request to /api/v1 as `as` (Ada by default), or signed out with `as: null`. */
const request = (path: string, init: RequestInit = {}, as: User | null = ada) => {
  const headers = new Headers(init.headers);
  if (as) headers.set("cookie", as.cookie);
  return app.request(`${BASE}${path}`, { ...init, headers }, env as any);
};

/** The decks of a `GET /decks` page. */
const listed = async (res: Response) => ((await res.json()) as { decks: Array<Record<string, any>> }).decks;

const signUp = (address: string, name: string) => signUpAndVerify(authRequest, email, { address, name });

// Ada's R2 objects and deck rows, by the deck file names the API speaks.
const mine = {
  get: (key: string) => DECKS.objects.get(`${USER}/${key}`),
  has: (key: string) => DECKS.objects.has(`${USER}/${key}`),
};
const rows = {
  get: (name: string) => decksOf(USER).get(name),
  has: (name: string) => decksOf(USER).has(name),
  get size() {
    return decksOf(USER).size;
  },
};

beforeEach(async () => {
  resetDecks();
  DECKS = createFakeR2();
  email = createFakeEmail();
  env = {
    ...AUTH_ENV,
    PG: { connectionString: "postgres://fake" },
    DECKS,
    EMAIL: email,
  };
  app = withTestAuth(realApp, createTestAuth());
  ada = await signUp("ada@example.com", "Ada");
  USER = ada.userId;
});

describe("PUT /deck/:key", () => {
  it("stores the body in R2 and records metadata in Postgres", async () => {
    const res = await request("/deck/alpha.apkg", {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "deck-bytes",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Put alpha.apkg successfully!");
    expect(mine.get("alpha.apkg")?.bytes.byteLength).toBe(10);
    expect(rows.get("alpha.apkg")?.size).toBe(10);
    expect(rows.get("alpha.apkg")?.cardCount).toBeNull();
  });

  it("records the card count of a .json or .yaml deck", async () => {
    await request("/deck/cards.json", {
      method: "PUT",
      body: JSON.stringify([{ front: "Q1", back: "A1" }, { front: "Q2", back: "A2" }]),
    });
    await request("/deck/cards.yaml", { method: "PUT", body: "- front: Q\n  back: A\n" });

    expect(rows.get("cards.json")?.cardCount).toBe(2);
    expect(rows.get("cards.yaml")?.cardCount).toBe(1);
  });

  it("stores a legacy deck as v2, stamped as an upload, with deterministic card ids", async () => {
    const body = JSON.stringify([{ front: "Q1", back: "A1" }]);
    const res = await request("/deck/legacy.json", { method: "PUT", body });

    expect(res.status).toBe(200);
    const deck = JSON.parse(await (await request("/deck/legacy.json")).text());
    expect(deck).toEqual({
      version: 2,
      meta: { tool: { kind: "upload", generatedAt: expect.any(String) }, author: { id: USER, name: "Ada" } },
      cards: [{ id: expect.stringMatching(/^[0-9a-f]{8}$/), front: "Q1", back: "A1" }],
    });

    await request("/deck/legacy-again.json", { method: "PUT", body });
    const again = JSON.parse(await (await request("/deck/legacy-again.json")).text());
    expect(again.cards[0].id).toBe(deck.cards[0].id);
    expect(rows.get("legacy.json")?.size).toBe(mine.get("legacy.json")!.bytes.byteLength);
  });

  it("keeps the tool, author, ids and refs of an uploaded v2 deck", async () => {
    const deck = {
      version: 2,
      meta: {
        title: "Signals",
        author: { id: "u1", name: "Ada" },
        tool: { kind: "agent", model: "m", generatedAt: "2026-01-01T00:00:00.000Z" },
      },
      cards: [{ id: "c_1", front: "Q", back: "A", meta: { refs: [{ kind: "page", label: "1" }] } }],
    };
    await request("/deck/signals.json", { method: "PUT", body: JSON.stringify(deck) });

    expect(JSON.parse(await (await request("/deck/signals.json")).text())).toEqual(deck);
    expect(rows.get("signals.json")).toMatchObject({ title: "Signals", cardCount: 1, meta: deck.meta });
  });

  it("stores a YAML upload as YAML", async () => {
    await request("/deck/cards.yaml", { method: "PUT", body: "- front: Q\n  back: A\n" });

    const text = await (await request("/deck/cards.yaml")).text();
    expect(text).toStartWith("version: 2\n");
    expect(mine.get("cards.yaml")?.contentType).toBe("application/yaml");
  });

  it.each([
    ["not JSON", "cards.json", "{nope", "Not valid JSON"],
    ["not YAML", "cards.yaml", "a: [", "Not valid YAML"],
    ["a card without a back", "cards.json", JSON.stringify([{ front: "Q" }]), "0.back"],
    ["an unknown reference kind", "cards.json", JSON.stringify({ version: 2, meta: {}, cards: [{ front: "Q", back: "A", meta: { refs: [{ kind: "chapter", label: "1" }] } }] }), "cards.0.meta.refs.0.kind"],
  ])("rejects %s with 400 and a readable error, and stores nothing", async (_label, key, body, message) => {
    const res = await request(`/deck/${key}`, { method: "PUT", body });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain(message);
    expect(mine.has(key)).toBe(false);
    expect(rows.has(key)).toBe(false);
  });

  it("rejects an empty body with 400 and stores nothing", async () => {
    const res = await request("/deck/empty.apkg", { method: "PUT" });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Body is required");
    expect(mine.has("empty.apkg")).toBe(false);
    expect(rows.has("empty.apkg")).toBe(false);
  });

  it("overwrites an existing deck and updates its metadata", async () => {
    await request("/deck/alpha.apkg", { method: "PUT", body: "short" });
    const res = await request("/deck/alpha.apkg", {
      method: "PUT",
      body: "a much longer payload",
    });

    expect(res.status).toBe(200);
    expect(rows.size).toBe(1);
    expect(rows.get("alpha.apkg")?.size).toBe(21);
  });
});

describe("PUT /deck/:key with If-Match (editor saves)", () => {
  const stored = {
    version: 2,
    meta: {
      title: "Signals",
      author: { id: "u1", name: "Ada" },
      tool: { kind: "agent", model: "m", generatedAt: "2026-01-01T00:00:00.000Z" },
      sources: [{ name: "notes.pdf" }],
    },
    cards: [{ id: "c_1", front: "Q", back: "A" }],
  };

  const seed = async (key = "signals.json", body: unknown = stored) => {
    const res = await request(`/deck/${key}`, { method: "PUT", body: JSON.stringify(body) });
    return res.headers.get("etag")!;
  };

  const save = (key: string, etag: string, deck: unknown) =>
    request(`/deck/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": etag },
      body: JSON.stringify(deck),
    });

  it("saves when the etag matches and returns the new etag", async () => {
    const etag = await seed();
    const edited = { ...stored, cards: [{ id: "c_1", front: "Q edited", back: "A" }, { id: "c_2", front: "Q2", back: "A2" }] };

    const res = await save("signals.json", etag, edited);

    expect(res.status).toBe(200);
    const newEtag = res.headers.get("etag");
    expect(newEtag).toBe(mine.get("signals.json")!.httpEtag);
    expect(newEtag).not.toBe(etag);
    expect(rows.get("signals.json")).toMatchObject({ etag: newEtag, cardCount: 2 });
    expect(JSON.parse(await (await request("/deck/signals.json")).text())).toEqual(edited);
  });

  it("answers 412 and stores nothing when the deck changed since it was loaded", async () => {
    const etag = await seed();
    await seed(); // e.g. the agent refined it meanwhile
    const current = mine.get("signals.json")!.bytes;

    const res = await save("signals.json", etag, { ...stored, cards: [{ id: "c_1", front: "Mine", back: "A" }] });

    expect(res.status).toBe(412);
    expect(await res.text()).toContain("changed since it was loaded");
    expect(mine.get("signals.json")!.bytes).toBe(current);
  });

  it("answers 412 when the deck no longer exists", async () => {
    const res = await save("gone.json", '"some-etag"', stored);

    expect(res.status).toBe(412);
    expect(mine.has("gone.json")).toBe(false);
  });

  it("answers 412 when R2 rejects the conditional write", async () => {
    const etag = await seed();
    const put = DECKS.put.bind(DECKS);
    // Another write lands between the editor's check and its put.
    DECKS.put = async (key, value, options) => {
      DECKS.put = put;
      await put(key, "[]");
      return put(key, value, options);
    };

    const res = await save("signals.json", etag, stored);

    expect(res.status).toBe(412);
    expect(await (await request("/deck/signals.json")).text()).toBe("[]");
  });

  it("keeps the stored tool, author and sources whatever the editor sends", async () => {
    const etag = await seed();
    const { tool: _tool, sources: _sources, ...meta } = stored.meta;

    await save("signals.json", etag, {
      ...stored,
      meta: { ...meta, title: "Renamed", author: { id: "x", name: "Mallory" } },
    });

    const deck = JSON.parse(await (await request("/deck/signals.json")).text());
    expect(deck.meta).toEqual({ ...stored.meta, title: "Renamed" });
  });

  it("upgrades a legacy deck without stamping it as an upload and keeps its card ids", async () => {
    await DECKS.put(`${USER}/old.json`, JSON.stringify([{ front: "Q", back: "A" }]));
    const etag = mine.get("old.json")!.httpEtag;
    // The editor loads it with `normalizeDeck`, so it sends the id study answers already use.
    const id = legacyCardId({ front: "Q", back: "A" });

    const res = await save("old.json", etag, { version: 2, meta: { title: "Old" }, cards: [{ id, front: "Q edited", back: "A" }] });

    expect(res.status).toBe(200);
    expect(JSON.parse(await (await request("/deck/old.json")).text())).toEqual({
      version: 2,
      meta: { title: "Old" },
      cards: [{ id, front: "Q edited", back: "A" }],
    });
  });

  it("writes a JSON body to a .yaml deck as YAML", async () => {
    await request("/deck/cards.yaml", { method: "PUT", body: "- front: Q\n  back: A\n" });
    const etag = mine.get("cards.yaml")!.httpEtag;

    const res = await save("cards.yaml", etag, { version: 2, meta: {}, cards: [{ id: "c_1", front: "Q2", back: "A2" }] });

    expect(res.status).toBe(200);
    const text = await (await request("/deck/cards.yaml")).text();
    expect(text).toStartWith("version: 2\n");
    expect(text).toContain("front: Q2");
    expect(mine.get("cards.yaml")?.contentType).toBe("application/yaml");
  });

  it("accepts the weak etag Cloudflare sends for a compressed response", async () => {
    const etag = await seed();

    const res = await save("signals.json", `W/${etag}`, stored);

    expect(res.status).toBe(200);
  });

  it("still rejects an invalid deck with 400", async () => {
    const etag = await seed();

    const res = await save("signals.json", etag, { version: 2, meta: {}, cards: [{ id: "c_1", front: "", back: "A" }] });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("cards.0.front");
  });

  it("applies If-Match to other files too", async () => {
    await request("/deck/alpha.apkg", { method: "PUT", body: "v1" });

    const res = await request("/deck/alpha.apkg", { method: "PUT", headers: { "if-match": '"stale"' }, body: "v2" });

    expect(res.status).toBe(412);
    expect(await (await request("/deck/alpha.apkg")).text()).toBe("v1");
  });
});

describe("GET /deck/:key", () => {
  it("returns the stored bytes with content-type and etag", async () => {
    await request("/deck/alpha.txt", {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });

    const res = await request("/deck/alpha.txt");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(await res.text()).toBe("hello");
  });

  it("returns 404 for an unknown deck", async () => {
    const res = await request("/deck/missing.apkg");

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Object Not Found");
  });
});

describe("DELETE /deck/:key", () => {
  it("removes the object from R2 and the row from Postgres", async () => {
    await request("/deck/alpha.apkg", { method: "PUT", body: "bytes" });

    const res = await request("/deck/alpha.apkg", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Deleted alpha.apkg successfully!");
    expect(mine.has("alpha.apkg")).toBe(false);
    expect(rows.has("alpha.apkg")).toBe(false);
  });

  it("returns 404 when the deck does not exist", async () => {
    const res = await request("/deck/missing.apkg", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Object Not Found");
  });

  it("makes the deck unreachable via GET afterwards", async () => {
    await request("/deck/alpha.apkg", { method: "PUT", body: "bytes" });
    await request("/deck/alpha.apkg", { method: "DELETE" });

    const res = await request("/deck/alpha.apkg");
    expect(res.status).toBe(404);
  });

  it("leaves other decks untouched", async () => {
    await request("/deck/alpha.apkg", { method: "PUT", body: "a" });
    await request("/deck/beta.apkg", { method: "PUT", body: "b" });

    await request("/deck/alpha.apkg", { method: "DELETE" });

    expect(rows.has("beta.apkg")).toBe(true);
    expect(mine.has("beta.apkg")).toBe(true);
  });
});

describe("GET /decks", () => {
  it("returns an empty array when there are no decks", async () => {
    const res = await request("/decks");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ decks: [], total: 0, page: 1, pageSize: 10, sort: "name", order: "asc" });
  });

  it("lists decks with the expected shape, sorted by name", async () => {
    await request("/deck/b.apkg", { method: "PUT", body: "12345" });
    await request("/deck/a.apkg", { method: "PUT", body: "123" });

    const res = await request("/decks");
    const body = await listed(res);

    expect(body.map((d) => d.deckName)).toEqual(["a.apkg", "b.apkg"]);
    expect(body[0]).toMatchObject({ deckName: "a.apkg", size: 3 });
    expect(body[1]).toMatchObject({ deckName: "b.apkg", size: 5 });
    expect(typeof body[0].etag).toBe("string");
    expect(body[0].uploaded).toBeDefined();
    expect(body[0]).not.toHaveProperty("title");
    expect(body[0]).not.toHaveProperty("cardCount");
  });

  it("returns the title, card count, author and tool of a deck", async () => {
    await request("/deck/signals.json", {
      method: "PUT",
      body: JSON.stringify({
        version: 2,
        meta: { title: "Signals", author: { id: "u1", name: "Ada" }, tool: { kind: "agent", model: "m" } },
        cards: [{ front: "Q", back: "A" }, { front: "Q2", back: "A2" }],
      }),
    });

    const [deck] = await listed(await request("/decks"));
    expect(deck).toMatchObject({
      deckName: "signals.json",
      title: "Signals",
      cardCount: 2,
      author: { id: "u1", name: "Ada" },
      tool: { kind: "agent", model: "m" },
    });
  });

  it("matches the search term against the title too", async () => {
    await request("/deck/sig.json", {
      method: "PUT",
      body: JSON.stringify({ version: 2, meta: { title: "Linear modulation" }, cards: [] }),
    });

    const names = (await listed(await request("/decks?searchTerm=linear"))).map((d) => d.deckName);
    expect(names).toEqual(["sig.json"]);
  });

  it("filters by searchTerm as a case-insensitive substring", async () => {
    await request("/deck/Biology.apkg", { method: "PUT", body: "x" });
    await request("/deck/biochem.apkg", { method: "PUT", body: "x" });
    await request("/deck/history.apkg", { method: "PUT", body: "x" });

    const names = async (term: string) =>
      (await listed(await request(`/decks?searchTerm=${encodeURIComponent(term)}`))).map((d) => d.deckName).sort();

    expect(await names("BIO")).toEqual(["Biology.apkg", "biochem.apkg"]);
    expect(await names("OLOGY")).toEqual(["Biology.apkg"]);
    expect(await names("stor")).toEqual(["history.apkg"]);
    expect(await names("  chem ")).toEqual(["biochem.apkg"]);
    expect(await names("zoo")).toEqual([]);
  });

  it("matches the title in the middle too", async () => {
    await request("/deck/sig.json", {
      method: "PUT",
      body: JSON.stringify({ version: 2, meta: { title: "Linear modulation" }, cards: [] }),
    });

    const res = await request("/decks?searchTerm=modul");
    expect((await listed(res)).map((d) => d.deckName)).toEqual(["sig.json"]);
  });

  it("treats LIKE wildcards in the search term literally", async () => {
    await request("/deck/100%25 recall.apkg", { method: "PUT", body: "x" });
    await request("/deck/1000 words.apkg", { method: "PUT", body: "x" });
    await request("/deck/snake_case.apkg", { method: "PUT", body: "x" });
    await request("/deck/snakescase.apkg", { method: "PUT", body: "x" });

    const names = async (term: string) =>
      (await listed(await request(`/decks?searchTerm=${encodeURIComponent(term)}`))).map((d) => d.deckName).sort();

    expect(await names("%")).toEqual(["100% recall.apkg"]);
    expect(await names("0%")).toEqual(["100% recall.apkg"]);
    expect(await names("e_c")).toEqual(["snake_case.apkg"]);
  });
});

describe("GET /decks pages and sorting", () => {
  // Ada's decks d01.apkg .. d23.apkg, created a minute apart, d01 first.
  const seed = async (count = 23) => {
    for (let i = 1; i <= count; i++) {
      const name = `d${String(i).padStart(2, "0")}.apkg`;
      await request(`/deck/${name}`, { method: "PUT", body: "x" });
      rows.get(name)!.createdAt = new Date(Date.UTC(2026, 0, 1, 0, i));
    }
  };
  const page = async (query: string) => (await request(`/decks?${query}`)).json() as Promise<any>;
  const names = (body: { decks: { deckName: string }[] }) => body.decks.map((d) => d.deckName);

  it("returns 10 decks a page with the total", async () => {
    await seed();

    const first = await page("");
    expect(names(first)).toEqual(Array.from({ length: 10 }, (_, i) => `d${String(i + 1).padStart(2, "0")}.apkg`));
    expect(first).toMatchObject({ total: 23, page: 1, pageSize: 10 });

    const last = await page("page=3");
    expect(names(last)).toEqual(["d21.apkg", "d22.apkg", "d23.apkg"]);
    expect(last.total).toBe(23);
  });

  it("still reports the total on a page past the end", async () => {
    await seed(3);

    const body = await page("page=5");
    expect(body.decks).toEqual([]);
    expect(body.total).toBe(3);
  });

  it("pages the search results", async () => {
    await seed();
    await request("/deck/other.apkg", { method: "PUT", body: "x" });

    const body = await page("searchTerm=d1&page=2&pageSize=5");
    expect(names(body)).toEqual(["d15.apkg", "d16.apkg", "d17.apkg", "d18.apkg", "d19.apkg"]);
    expect(body.total).toBe(10);
  });

  it("sorts by name case-insensitively, in either order", async () => {
    for (const name of ["banana.apkg", "Apple.apkg", "cherry.apkg"]) {
      await request(`/deck/${name}`, { method: "PUT", body: "x" });
    }

    expect(names(await page("sort=name"))).toEqual(["Apple.apkg", "banana.apkg", "cherry.apkg"]);
    expect(names(await page("sort=name&order=desc"))).toEqual(["cherry.apkg", "banana.apkg", "Apple.apkg"]);
  });

  it("sorts by creation date, newest first by default", async () => {
    await seed(12);

    const newest = await page("sort=created");
    expect(newest).toMatchObject({ sort: "created", order: "desc" });
    expect(names(newest).slice(0, 3)).toEqual(["d12.apkg", "d11.apkg", "d10.apkg"]);
    expect(names(await page("sort=created&page=2"))).toEqual(["d02.apkg", "d01.apkg"]);
    expect(names(await page("sort=created&order=asc")).slice(0, 2)).toEqual(["d01.apkg", "d02.apkg"]);
  });

  it("sorts by success rate, with decks never studied last either way", async () => {
    await seed(4);
    // d01 50%, d02 100%, d03 0%, d04 never studied.
    for (const [deckName, correct] of [
      ["d01.apkg", [true, false]],
      ["d02.apkg", [true, true]],
      ["d03.apkg", [false, false]],
    ] as const) {
      const { id } = (await (
        await request("/study-sessions", { method: "POST", body: JSON.stringify({ deckName, cardTotal: 2 }) })
      ).json()) as { id: string };
      await request(`/study-sessions/${id}/answers`, {
        method: "POST",
        body: JSON.stringify({ answers: correct.map((c, position) => ({ position, cardId: `c${position}`, correct: c })) }),
      });
      await request(`/study-sessions/${id}/finish`, { method: "POST" });
    }

    const best = await page("sort=success");
    expect(best.order).toBe("desc");
    expect(names(best)).toEqual(["d02.apkg", "d01.apkg", "d03.apkg", "d04.apkg"]);
    expect(best.decks[0]).toMatchObject({ studyCount: 1, recentAccuracy: 1 });
    expect(best.decks[3]).not.toHaveProperty("studyCount");
    expect(names(await page("sort=success&order=asc"))).toEqual(["d03.apkg", "d01.apkg", "d02.apkg", "d04.apkg"]);
  });

  it.each(["sort=size", "order=up", "page=0", "page=abc", "pageSize=51"])("answers 400 for %s", async (query) => {
    expect((await request(`/decks?${query}`)).status).toBe(400);
  });
});

describe("unknown routes", () => {
  it("returns 404", async () => {
    const res = await request("/nope");
    expect(res.status).toBe(404);
  });
});

describe("POST /flashcards/:deckName", () => {
  let agentRequests: { url: string; contentType: string | null }[];

  const agentStub = (
    respond: (request: Request) => Response | Promise<Response>,
  ) => ({
    fetch: async (input: Request) => {
      agentRequests.push({
        url: input.url,
        contentType: input.headers.get("content-type"),
      });
      return respond(input);
    },
  });

  const generatedDeck = (deckName: string) => async (request: Request) => {
    const form = await request.formData();
    const key = `${deckName}.json`;
    await DECKS.put(
      `${USER}/${key}`,
      JSON.stringify([{ front: "Q?", back: String(form.get("cardCount")) }]),
    );
    return Response.json(
      { key, format: "json", cardCount: 1 },
      { status: 201 },
    );
  };

  const form = (fields: Record<string, string>) => {
    const body = new FormData();
    for (const [name, value] of Object.entries(fields))
      body.append(name, value);
    return { method: "POST", body };
  };

  beforeEach(() => {
    agentRequests = [];
  });

  it("forwards the multipart body to the agent and records the deck in Postgres", async () => {
    env.FLASHCARD_AGENT = agentStub(generatedDeck("my-deck"));

    const res = await request(
      "/flashcards/my-deck",
      form({ deckName: "my-deck", cardCount: "5", text: "hi" }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      key: "my-deck.json",
      format: "json",
      cardCount: 1,
    });
    expect(new URL(agentRequests[0]!.url).pathname).toBe(
      `/agents/flashcard-agent/${USER}:my-deck`,
    );
    expect(agentRequests[0]!.contentType).toMatch(/^multipart\/form-data/);
    expect(rows.get("my-deck.json")?.size).toBe(
      mine.get("my-deck.json")?.bytes.byteLength,
    );
    expect(rows.get("my-deck.json")?.etag).toBe(
      mine.get("my-deck.json")?.httpEtag,
    );
    expect(rows.get("my-deck.json")?.cardCount).toBe(1);
  });

  it("records the title and metadata of the generated deck file", async () => {
    const meta = { title: "Biology", author: null, tool: { kind: "agent", model: "m", generatedAt: "2026-10-24T00:00:00.000Z" } };
    env.FLASHCARD_AGENT = agentStub(async () => {
      await DECKS.put(`${USER}/bio.json`, JSON.stringify({ version: 2, meta, cards: [{ id: "c_1", front: "Q", back: "A" }] }));
      return Response.json({ key: "bio.json", format: "json", cardCount: 1 }, { status: 201 });
    });

    await request("/flashcards/bio", form({ deckName: "bio", text: "hi" }));

    expect(rows.get("bio.json")).toMatchObject({ title: "Biology", cardCount: 1, meta });
  });

  it("encodes the deck name when building the agent path", async () => {
    env.FLASHCARD_AGENT = agentStub(generatedDeck("a b"));

    await request("/flashcards/a%20b", form({ deckName: "a b", text: "hi" }));

    expect(new URL(agentRequests[0]!.url).pathname).toBe(
      `/agents/flashcard-agent/${USER}:a%20b`,
    );
  });

  it("returns the agent error and writes nothing when the agent rejects the request", async () => {
    env.FLASHCARD_AGENT = agentStub(() =>
      Response.json(
        { error: "Deck my-deck.json already exists" },
        { status: 409 },
      ),
    );

    const res = await request(
      "/flashcards/my-deck",
      form({ deckName: "my-deck", text: "hi" }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Deck my-deck.json already exists",
    });
    expect(rows.size).toBe(0);
  });

  it("passes refine through to the agent and updates the existing Postgres row", async () => {
    await request("/deck/my-deck.json", { method: "PUT", body: JSON.stringify([{ front: "Q?", back: "A" }]) });
    const oldSize = rows.get("my-deck.json")!.size;
    const refinedFlags: string[] = [];
    env.FLASHCARD_AGENT = agentStub(async (req) => {
      const fields = await req.clone().formData();
      refinedFlags.push(String(fields.get("refine")));
      return Response.json(
        { key: "my-deck.json", format: "json", cardCount: 1 },
        { status: 200 },
      );
    });
    await DECKS.put(
      `${USER}/my-deck.json`,
      JSON.stringify([{ front: "Q?", back: "A much longer answer" }]),
    );

    const res = await request(
      "/flashcards/my-deck",
      form({
        deckName: "my-deck",
        refine: "true",
        instructions: "make it longer",
      }),
    );

    expect(res.status).toBe(200);
    expect(refinedFlags).toEqual(["true"]);
    expect(rows.size).toBe(1);
    expect(rows.get("my-deck.json")?.size).toBe(
      mine.get("my-deck.json")?.bytes.byteLength,
    );
    expect(rows.get("my-deck.json")?.size).not.toBe(oldSize);
  });

  it("returns 500 when the agent reports a key that is not in R2", async () => {
    env.FLASHCARD_AGENT = agentStub(() =>
      Response.json(
        { key: "ghost.json", format: "json", cardCount: 1 },
        { status: 201 },
      ),
    );

    const res = await request(
      "/flashcards/ghost",
      form({ deckName: "ghost", text: "hi" }),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      "Generated deck ghost.json could not be found",
    );
    expect(rows.has("ghost.json")).toBe(false);
  });
});

describe("accounts", () => {
  const routes: [string, string][] = [
    ["GET", "/decks"],
    ["GET", "/deck/a.json"],
    ["PUT", "/deck/a.json"],
    ["DELETE", "/deck/a.json"],
    ["POST", "/flashcards/a"],
    ["GET", "/study-sessions"],
    ["POST", "/study-sessions"],
    ["GET", "/stats/overview"],
  ];

  it.each(routes)("%s %s answers 401 without a session", async (method, path) => {
    env.FLASHCARD_AGENT = { fetch: () => Promise.reject(new Error("must not be called")) };
    const res = await request(path, { method, body: method === "GET" || method === "DELETE" ? undefined : "x" }, null);
    expect(res.status).toBe(401);
    expect(DECKS.objects.size).toBe(0);
  });

  it("keeps two users' decks with the same name apart", async () => {
    const bob = await signUp("bob@example.com", "Bob");
    const deck = (back: string) => JSON.stringify([{ front: "Q", back }]);

    await request("/deck/spanish.json", { method: "PUT", body: deck("Ada's") });
    await request("/deck/spanish.json", { method: "PUT", body: deck("Bob's") }, bob);

    expect(DECKS.objects.has(`${ada.userId}/spanish.json`)).toBe(true);
    expect(DECKS.objects.has(`${bob.userId}/spanish.json`)).toBe(true);
    expect(JSON.parse(await (await request("/deck/spanish.json")).text()).cards[0].back).toBe("Ada's");
    expect(JSON.parse(await (await request("/deck/spanish.json", {}, bob)).text()).cards[0].back).toBe("Bob's");

    // Bob deleting his deck leaves Ada's alone.
    expect((await request("/deck/spanish.json", { method: "DELETE" }, bob)).status).toBe(200);
    expect(DECKS.objects.has(`${ada.userId}/spanish.json`)).toBe(true);
    expect(decksOf(ada.userId).has("spanish.json")).toBe(true);
  });

  it("never shows, reads, overwrites or deletes another user's deck", async () => {
    const bob = await signUp("bob@example.com", "Bob");
    await request("/deck/private.json", { method: "PUT", body: JSON.stringify([{ front: "Q", back: "A" }]) });
    const etag = mine.get("private.json")!.httpEtag;

    expect(await listed(await request("/decks", {}, bob))).toEqual([]);
    expect((await request("/deck/private.json", {}, bob)).status).toBe(404);
    // An edit against Ada's etag can't reach her deck: for Bob it doesn't exist.
    const edit = await request(
      "/deck/private.json",
      { method: "PUT", headers: { "if-match": etag, "content-type": "application/json" }, body: JSON.stringify({ version: 2, meta: {}, cards: [] }) },
      bob,
    );
    expect(edit.status).toBe(412);
    expect((await request("/deck/private.json", { method: "DELETE" }, bob)).status).toBe(404);
    // Keys can't climb out of the user's prefix.
    expect((await request(`/deck/${encodeURIComponent(`../${ada.userId}/private.json`)}`, {}, bob)).status).toBe(404);

    expect(mine.get("private.json")!.httpEtag).toBe(etag);
    expect(rows.has("private.json")).toBe(true);
  });

  it("stamps an uploaded deck with the uploader as author", async () => {
    await request("/deck/mine.json", { method: "PUT", body: JSON.stringify([{ front: "Q", back: "A" }]) });
    expect(rows.get("mine.json")?.meta).toMatchObject({ author: { id: USER, name: "Ada" } });
  });

  it("tells the agent who the request is for, whatever the client sends", async () => {
    let seen: Headers | undefined;
    env.FLASHCARD_AGENT = {
      fetch: async (req: Request) => {
        seen = req.headers;
        return Response.json({ error: "stop here" }, { status: 400 });
      },
    };
    const zoe = await signUp("zoe@example.com", "Zoë Ñ");
    const body = new FormData();
    body.append("deckName", "a");
    await request(
      "/flashcards/a",
      { method: "POST", body, headers: { "x-remain-user-id": ada.userId, "x-remain-user-name": "Mallory" } },
      zoe,
    );

    expect(seen?.get("x-remain-user-id")).toBe(zoe.userId);
    expect(decodeURIComponent(seen!.get("x-remain-user-name")!)).toBe("Zoë Ñ");
  });

  it("scopes study sessions to the user", async () => {
    const bob = await signUp("bob@example.com", "Bob");
    const created = await request("/study-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deckName: "a.json", cardTotal: 3 }),
    });
    const { id } = (await created.json()) as { id: string };

    expect(sessions.get(id)?.user_id).toBe(USER);
    expect((await request(`/study-sessions/${id}`, {}, bob)).status).toBe(404);
    expect(((await (await request("/study-sessions", {}, bob)).json()) as { sessions: unknown[] }).sessions).toEqual([]);
  });
});
