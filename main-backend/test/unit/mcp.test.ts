import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeClient, decks, resetDecks } from "../helpers/fake-pg";
import { createFakeR2, type FakeR2 } from "../helpers/fake-r2";

mock.module("pg", () => ({ Client: FakeClient }));

const { default: app } = await import("../../src/index");

let DECKS: FakeR2;
let env: Record<string, unknown>;

const rpc = (method: string, params: unknown, id = 1) =>
  app.request(
    "http://localhost/mcp",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        host: "localhost",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    },
    env as any,
    { waitUntil() {}, passThroughOnException() {} } as any,
  );

const callTool = async (name: string, args: unknown) => {
  const res = await rpc("tools/call", { name, arguments: args });
  const raw = await res.text();
  const data = raw.split("\n").find((line) => line.startsWith("data: "));
  const body = JSON.parse(data ? data.slice(6) : raw);
  return body.result;
};

beforeEach(() => {
  resetDecks();
  DECKS = createFakeR2();
  env = {
    PG: { connectionString: "postgres://fake" },
    DECKS,
    DEV_SKIP_ACCESS_AUTH: "true",
  };
});

describe("/mcp auth", () => {
  it("rejects requests without an Access JWT when not in dev mode", async () => {
    env.DEV_SKIP_ACCESS_AUTH = undefined;
    const res = await rpc("tools/list", {});
    expect(res.status).toBe(401);
  });

  it("rejects requests when Access is not configured, even with a header", async () => {
    env.DEV_SKIP_ACCESS_AUTH = undefined;
    const res = await app.request(
      "http://localhost/mcp",
      { method: "POST", headers: { "cf-access-jwt-assertion": "x.y.z" }, body: "{}" },
      env as any,
    );
    expect(res.status).toBe(401);
  });
});

describe("/mcp tools", () => {
  it("creates, lists, reads, updates and deletes a deck", async () => {
    const cards = [{ front: "hola", back: "hello" }];

    const created = await callTool("create_deck", { name: "spanish", cards, title: "Spanish" });
    expect(created.isError).toBeFalsy();
    expect(decks.has("spanish.json")).toBe(true);

    expect((await callTool("create_deck", { name: "spanish", cards })).isError).toBe(true);

    const listed = await callTool("list_decks", {});
    expect(JSON.parse(listed.content[0].text)[0]).toMatchObject({
      deckName: "spanish.json",
      title: "Spanish",
      cardCount: 1,
      tool: { kind: "mcp" },
    });

    const read = JSON.parse((await callTool("read_deck", { key: "spanish.json" })).content[0].text);
    expect(read.cards).toEqual([{ index: 0, id: expect.stringMatching(/^c_/), ...cards[0] }]);
    expect(read.meta.title).toBe("Spanish");

    const more = [{ id: read.cards[0].id, ...cards[0] }, { front: "adiós", back: "bye" }];
    await callTool("update_deck", { key: "spanish.json", cards: more });
    const reread = await callTool("read_deck", { key: "spanish.json" });
    expect(JSON.parse(reread.content[0].text).cardCount).toBe(2);

    expect((await callTool("delete_deck", { key: "spanish.json" })).isError).toBeFalsy();
    expect(decks.has("spanish.json")).toBe(false);
  });
});

const stored = (key: string) =>
  JSON.parse(new TextDecoder().decode(DECKS.objects.get(key)!.bytes));

describe("/mcp create_deck", () => {
  it("writes a v2 deck with server-assigned ids, tool and timestamp", async () => {
    const before = Date.now();
    await callTool("create_deck", {
      name: "d",
      cards: [
        { front: "a", back: "1", refs: [{ kind: "page", label: "4", source: "notes.pdf" }] },
        { front: "b", back: "2" },
      ],
    });

    const deck = stored("d.json");
    expect(deck.version).toBe(2);
    expect(deck.meta).toEqual({ author: null, tool: { kind: "mcp", generatedAt: expect.any(String) } });
    expect(Date.parse(deck.meta.tool.generatedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(deck.cards).toEqual([
      { id: expect.stringMatching(/^c_[0-9a-f]{12}$/), front: "a", back: "1", meta: { refs: [{ kind: "page", label: "4", source: "notes.pdf" }] } },
      { id: expect.stringMatching(/^c_[0-9a-f]{12}$/), front: "b", back: "2" },
    ]);
    expect(deck.cards[0].id).not.toBe(deck.cards[1].id);
  });

  it("does not accept ids, a tool or a timestamp from the client", async () => {
    await callTool("create_deck", {
      name: "d",
      cards: [{ id: "mine", front: "a", back: "1" }],
      tool: { kind: "manual" },
      generatedAt: "2000-01-01T00:00:00.000Z",
    });

    const deck = stored("d.json");
    expect(deck.cards[0].id).not.toBe("mine");
    expect(deck.meta.tool.kind).toBe("mcp");
    expect(deck.meta.tool.generatedAt).not.toBe("2000-01-01T00:00:00.000Z");
  });
});

describe("/mcp update_deck", () => {
  let ids: string[];

  beforeEach(async () => {
    await callTool("create_deck", {
      name: "d",
      cards: [
        { front: "a", back: "1", refs: [{ kind: "equation", label: "2.1" }] },
        { front: "b", back: "2" },
      ],
    });
    ids = stored("d.json").cards.map((c: any) => c.id);
  });

  it("keeps the ids and refs of cards sent with their id and gives new cards new ids", async () => {
    const tool = stored("d.json").meta.tool;
    const res = await callTool("update_deck", {
      key: "d.json",
      cards: [{ id: ids[0], front: "a", back: "one" }, { front: "c", back: "3" }],
    });

    expect(res.isError).toBeFalsy();
    const deck = stored("d.json");
    expect(deck.meta.tool).toEqual(tool);
    expect(deck.cards).toEqual([
      { id: ids[0], front: "a", back: "one", meta: { refs: [{ kind: "equation", label: "2.1" }] } },
      { id: expect.stringMatching(/^c_/), front: "c", back: "3" },
    ]);
    expect(deck.cards[1].id).not.toBe(ids[1]);
  });

  it("rejects ids that are not in the deck or appear twice, and writes nothing", async () => {
    const before = stored("d.json");

    expect((await callTool("update_deck", { key: "d.json", cards: [{ id: "c_madeup", front: "x", back: "y" }] })).isError).toBe(true);
    expect(
      (await callTool("update_deck", {
        key: "d.json",
        cards: [{ id: ids[0], front: "x", back: "y" }, { id: ids[0], front: "z", back: "w" }],
      })).isError,
    ).toBe(true);
    expect(stored("d.json")).toEqual(before);
  });
});

describe("/mcp add_cards", () => {
  beforeEach(async () => {
    await callTool("create_deck", { name: "d", cards: [{ front: "a", back: "1" }] });
  });

  it("appends cards after the existing ones", async () => {
    const res = await callTool("add_cards", {
      key: "d.json",
      cards: [{ front: "b", back: "2" }, { front: "c", back: "3" }],
    });

    const body = JSON.parse(res.content[0].text);
    expect(body).toMatchObject({ added: 2, cardCount: 3, firstNewIndex: 1 });
    expect(stored("d.json").cards.map((c: any) => c.front)).toEqual(["a", "b", "c"]);
    expect(stored("d.json").cards.slice(1).map((c: any) => c.id)).toEqual(body.ids);
    expect(decks.get("d.json")?.size).toBe(DECKS.objects.get("d.json")!.bytes.byteLength);
    expect(decks.get("d.json")?.cardCount).toBe(3);
  });

  it("upgrades a legacy deck, keeping deterministic ids for its existing cards", async () => {
    await DECKS.put("old.json", JSON.stringify([{ front: "a", back: "1" }]));
    const legacyId = JSON.parse((await callTool("read_deck", { key: "old.json" })).content[0].text).cards[0].id;

    await callTool("add_cards", { key: "old.json", cards: [{ front: "b", back: "2" }] });

    const deck = stored("old.json");
    expect(deck.version).toBe(2);
    expect(deck.cards[0]).toEqual({ id: legacyId, front: "a", back: "1" });
  });

  it("fails for a deck that does not exist", async () => {
    const res = await callTool("add_cards", { key: "nope.json", cards: [{ front: "x", back: "y" }] });
    expect(res.isError).toBe(true);
  });
});

describe("/mcp edit_cards", () => {
  beforeEach(async () => {
    await callTool("create_deck", {
      name: "d",
      cards: [
        { front: "a", back: "1" },
        { front: "b", back: "2" },
        { front: "c", back: "3", refs: [{ kind: "page", label: "9" }] },
      ],
    });
  });

  const fronts = () => stored("d.json").cards.map(({ front, back, meta }: any) => ({ front, back, meta }));

  it("edits several cards and leaves omitted fields, ids and other cards alone", async () => {
    const ids = stored("d.json").cards.map((c: any) => c.id);
    const res = await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 0, back: "one" }, { index: 2, front: "C", back: "three" }],
    });

    expect(res.isError).toBeFalsy();
    expect(fronts()).toEqual([
      { front: "a", back: "one", meta: undefined },
      { front: "b", back: "2", meta: undefined },
      { front: "C", back: "three", meta: { refs: [{ kind: "page", label: "9" }] } },
    ]);
    expect(stored("d.json").cards.map((c: any) => c.id)).toEqual(ids);
  });

  it("replaces or removes refs", async () => {
    await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 0, refs: [{ kind: "theorem", label: "1.2" }] }, { index: 2, refs: [] }],
    });

    expect(fronts()[0].meta).toEqual({ refs: [{ kind: "theorem", label: "1.2" }] });
    expect(fronts()[2].meta).toBeUndefined();
  });

  it("applies nothing when an index is out of range", async () => {
    const res = await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 0, back: "changed" }, { index: 3, back: "oops" }],
    });

    expect(res.isError).toBe(true);
    expect(fronts()[0].back).toBe("1");
  });

  it("rejects duplicate indexes", async () => {
    const res = await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 1, back: "x" }, { index: 1, back: "y" }],
    });
    expect(res.isError).toBe(true);
  });

  it("rejects an edit with no field to change", async () => {
    const res = await callTool("edit_cards", { key: "d.json", edits: [{ index: 0 }] });
    expect(res.isError).toBe(true);
    expect(fronts()[0]).toEqual({ front: "a", back: "1", meta: undefined });
  });
});
