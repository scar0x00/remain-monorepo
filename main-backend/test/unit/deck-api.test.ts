import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeClient, decks, resetDecks } from "../helpers/fake-pg";
import { createFakeR2, type FakeR2 } from "../helpers/fake-r2";
import { legacyCardId } from "../../src/lib/deck-format";

mock.module("pg", () => ({ Client: FakeClient }));

const { default: app } = await import("../../src/index");

const BASE = "http://localhost/api/v1";
let DECKS: FakeR2;
let env: Record<string, unknown>;

const request = (path: string, init?: RequestInit) =>
  app.request(`${BASE}${path}`, init, env as any);

beforeEach(() => {
  resetDecks();
  DECKS = createFakeR2();
  env = {
    PG: { connectionString: "postgres://fake" },
    DECKS,
  };
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
    expect(DECKS.objects.get("alpha.apkg")?.bytes.byteLength).toBe(10);
    expect(decks.get("alpha.apkg")?.size).toBe(10);
    expect(decks.get("alpha.apkg")?.cardCount).toBeNull();
  });

  it("records the card count of a .json or .yaml deck", async () => {
    await request("/deck/cards.json", {
      method: "PUT",
      body: JSON.stringify([{ front: "Q1", back: "A1" }, { front: "Q2", back: "A2" }]),
    });
    await request("/deck/cards.yaml", { method: "PUT", body: "- front: Q\n  back: A\n" });

    expect(decks.get("cards.json")?.cardCount).toBe(2);
    expect(decks.get("cards.yaml")?.cardCount).toBe(1);
  });

  it("stores a legacy deck as v2, stamped as an upload, with deterministic card ids", async () => {
    const body = JSON.stringify([{ front: "Q1", back: "A1" }]);
    const res = await request("/deck/legacy.json", { method: "PUT", body });

    expect(res.status).toBe(200);
    const deck = JSON.parse(await (await request("/deck/legacy.json")).text());
    expect(deck).toEqual({
      version: 2,
      meta: { tool: { kind: "upload", generatedAt: expect.any(String) }, author: null },
      cards: [{ id: expect.stringMatching(/^[0-9a-f]{8}$/), front: "Q1", back: "A1" }],
    });

    await request("/deck/legacy-again.json", { method: "PUT", body });
    const again = JSON.parse(await (await request("/deck/legacy-again.json")).text());
    expect(again.cards[0].id).toBe(deck.cards[0].id);
    expect(decks.get("legacy.json")?.size).toBe(DECKS.objects.get("legacy.json")!.bytes.byteLength);
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
    expect(decks.get("signals.json")).toMatchObject({ title: "Signals", cardCount: 1, meta: deck.meta });
  });

  it("stores a YAML upload as YAML", async () => {
    await request("/deck/cards.yaml", { method: "PUT", body: "- front: Q\n  back: A\n" });

    const text = await (await request("/deck/cards.yaml")).text();
    expect(text).toStartWith("version: 2\n");
    expect(DECKS.objects.get("cards.yaml")?.contentType).toBe("application/yaml");
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
    expect(DECKS.objects.has(key)).toBe(false);
    expect(decks.has(key)).toBe(false);
  });

  it("rejects an empty body with 400 and stores nothing", async () => {
    const res = await request("/deck/empty.apkg", { method: "PUT" });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Body is required");
    expect(DECKS.objects.has("empty.apkg")).toBe(false);
    expect(decks.has("empty.apkg")).toBe(false);
  });

  it("overwrites an existing deck and updates its metadata", async () => {
    await request("/deck/alpha.apkg", { method: "PUT", body: "short" });
    const res = await request("/deck/alpha.apkg", {
      method: "PUT",
      body: "a much longer payload",
    });

    expect(res.status).toBe(200);
    expect(decks.size).toBe(1);
    expect(decks.get("alpha.apkg")?.size).toBe(21);
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
    expect(newEtag).toBe(DECKS.objects.get("signals.json")!.httpEtag);
    expect(newEtag).not.toBe(etag);
    expect(decks.get("signals.json")).toMatchObject({ etag: newEtag, cardCount: 2 });
    expect(JSON.parse(await (await request("/deck/signals.json")).text())).toEqual(edited);
  });

  it("answers 412 and stores nothing when the deck changed since it was loaded", async () => {
    const etag = await seed();
    await seed(); // e.g. the agent refined it meanwhile
    const current = DECKS.objects.get("signals.json")!.bytes;

    const res = await save("signals.json", etag, { ...stored, cards: [{ id: "c_1", front: "Mine", back: "A" }] });

    expect(res.status).toBe(412);
    expect(await res.text()).toContain("changed since it was loaded");
    expect(DECKS.objects.get("signals.json")!.bytes).toBe(current);
  });

  it("answers 412 when the deck no longer exists", async () => {
    const res = await save("gone.json", '"some-etag"', stored);

    expect(res.status).toBe(412);
    expect(DECKS.objects.has("gone.json")).toBe(false);
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
    await DECKS.put("old.json", JSON.stringify([{ front: "Q", back: "A" }]));
    const etag = DECKS.objects.get("old.json")!.httpEtag;
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
    const etag = DECKS.objects.get("cards.yaml")!.httpEtag;

    const res = await save("cards.yaml", etag, { version: 2, meta: {}, cards: [{ id: "c_1", front: "Q2", back: "A2" }] });

    expect(res.status).toBe(200);
    const text = await (await request("/deck/cards.yaml")).text();
    expect(text).toStartWith("version: 2\n");
    expect(text).toContain("front: Q2");
    expect(DECKS.objects.get("cards.yaml")?.contentType).toBe("application/yaml");
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
    expect(DECKS.objects.has("alpha.apkg")).toBe(false);
    expect(decks.has("alpha.apkg")).toBe(false);
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

    expect(decks.has("beta.apkg")).toBe(true);
    expect(DECKS.objects.has("beta.apkg")).toBe(true);
  });
});

describe("GET /decks", () => {
  it("returns an empty array when there are no decks", async () => {
    const res = await request("/decks");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("lists decks with the expected shape, sorted by name", async () => {
    await request("/deck/b.apkg", { method: "PUT", body: "12345" });
    await request("/deck/a.apkg", { method: "PUT", body: "123" });

    const res = await request("/decks");
    const body = (await res.json()) as Array<Record<string, unknown>>;

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

    const [deck] = (await (await request("/decks")).json()) as Array<Record<string, unknown>>;
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

    const names = ((await (await request("/decks?searchTerm=linear")).json()) as Array<{ deckName: string }>).map(
      (d) => d.deckName,
    );
    expect(names).toEqual(["sig.json"]);
  });

  it("filters by searchTerm as a case-insensitive prefix", async () => {
    await request("/deck/Biology.apkg", { method: "PUT", body: "x" });
    await request("/deck/biochem.apkg", { method: "PUT", body: "x" });
    await request("/deck/history.apkg", { method: "PUT", body: "x" });

    const names = async (term: string) =>
      (
        (await (await request(`/decks?searchTerm=${term}`)).json()) as Array<{
          deckName: string;
        }>
      )
        .map((d) => d.deckName)
        .sort();

    expect(await names("BIO")).toEqual(["Biology.apkg", "biochem.apkg"]);
    expect(await names("ology")).toEqual([]);
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
      key,
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
      "/agents/flashcard-agent/my-deck",
    );
    expect(agentRequests[0]!.contentType).toMatch(/^multipart\/form-data/);
    expect(decks.get("my-deck.json")?.size).toBe(
      DECKS.objects.get("my-deck.json")?.bytes.byteLength,
    );
    expect(decks.get("my-deck.json")?.etag).toBe(
      DECKS.objects.get("my-deck.json")?.httpEtag,
    );
    expect(decks.get("my-deck.json")?.cardCount).toBe(1);
  });

  it("records the title and metadata of the generated deck file", async () => {
    const meta = { title: "Biology", author: null, tool: { kind: "agent", model: "m", generatedAt: "2026-10-24T00:00:00.000Z" } };
    env.FLASHCARD_AGENT = agentStub(async () => {
      await DECKS.put("bio.json", JSON.stringify({ version: 2, meta, cards: [{ id: "c_1", front: "Q", back: "A" }] }));
      return Response.json({ key: "bio.json", format: "json", cardCount: 1 }, { status: 201 });
    });

    await request("/flashcards/bio", form({ deckName: "bio", text: "hi" }));

    expect(decks.get("bio.json")).toMatchObject({ title: "Biology", cardCount: 1, meta });
  });

  it("encodes the deck name when building the agent path", async () => {
    env.FLASHCARD_AGENT = agentStub(generatedDeck("a b"));

    await request("/flashcards/a%20b", form({ deckName: "a b", text: "hi" }));

    expect(new URL(agentRequests[0]!.url).pathname).toBe(
      "/agents/flashcard-agent/a%20b",
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
    expect(decks.size).toBe(0);
  });

  it("passes refine through to the agent and updates the existing Postgres row", async () => {
    await request("/deck/my-deck.json", { method: "PUT", body: JSON.stringify([{ front: "Q?", back: "A" }]) });
    const oldSize = decks.get("my-deck.json")!.size;
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
      "my-deck.json",
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
    expect(decks.size).toBe(1);
    expect(decks.get("my-deck.json")?.size).toBe(
      DECKS.objects.get("my-deck.json")?.bytes.byteLength,
    );
    expect(decks.get("my-deck.json")?.size).not.toBe(oldSize);
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
    expect(decks.has("ghost.json")).toBe(false);
  });
});
