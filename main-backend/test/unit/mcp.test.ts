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

    const created = await callTool("create_deck", { name: "spanish", cards });
    expect(created.isError).toBeFalsy();
    expect(decks.has("spanish.json")).toBe(true);

    expect((await callTool("create_deck", { name: "spanish", cards })).isError).toBe(true);

    const listed = await callTool("list_decks", {});
    expect(JSON.parse(listed.content[0].text)[0].deckName).toBe("spanish.json");

    const read = await callTool("read_deck", { key: "spanish.json" });
    expect(JSON.parse(read.content[0].text).cards).toEqual([{ index: 0, ...cards[0] }]);

    const more = [...cards, { front: "adiós", back: "bye" }];
    await callTool("update_deck", { key: "spanish.json", cards: more });
    const reread = await callTool("read_deck", { key: "spanish.json" });
    expect(JSON.parse(reread.content[0].text).cardCount).toBe(2);

    expect((await callTool("delete_deck", { key: "spanish.json" })).isError).toBeFalsy();
    expect(decks.has("spanish.json")).toBe(false);
  });
});

const stored = (key: string) =>
  JSON.parse(new TextDecoder().decode(DECKS.objects.get(key)!.bytes));

describe("/mcp add_cards", () => {
  beforeEach(async () => {
    await callTool("create_deck", { name: "d", cards: [{ front: "a", back: "1" }] });
  });

  it("appends cards after the existing ones", async () => {
    const res = await callTool("add_cards", {
      key: "d.json",
      cards: [{ front: "b", back: "2" }, { front: "c", back: "3" }],
    });

    expect(JSON.parse(res.content[0].text)).toMatchObject({ added: 2, cardCount: 3, firstNewIndex: 1 });
    expect(stored("d.json").map((c: any) => c.front)).toEqual(["a", "b", "c"]);
    expect(decks.get("d.json")?.size).toBe(DECKS.objects.get("d.json")!.bytes.byteLength);
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
        { front: "c", back: "3" },
      ],
    });
  });

  it("edits several cards and leaves omitted fields and other cards alone", async () => {
    const res = await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 0, back: "one" }, { index: 2, front: "C", back: "three" }],
    });

    expect(res.isError).toBeFalsy();
    expect(stored("d.json")).toEqual([
      { front: "a", back: "one" },
      { front: "b", back: "2" },
      { front: "C", back: "three" },
    ]);
  });

  it("applies nothing when an index is out of range", async () => {
    const res = await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 0, back: "changed" }, { index: 3, back: "oops" }],
    });

    expect(res.isError).toBe(true);
    expect(stored("d.json")[0].back).toBe("1");
  });

  it("rejects duplicate indexes", async () => {
    const res = await callTool("edit_cards", {
      key: "d.json",
      edits: [{ index: 1, back: "x" }, { index: 1, back: "y" }],
    });
    expect(res.isError).toBe(true);
  });

  it("rejects an edit with neither front nor back", async () => {
    const res = await callTool("edit_cards", { key: "d.json", edits: [{ index: 0 }] });
    expect(res.isError).toBe(true);
    expect(stored("d.json")[0]).toEqual({ front: "a", back: "1" });
  });
});
