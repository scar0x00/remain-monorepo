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
    expect(JSON.parse(read.content[0].text).cards).toEqual(cards);

    const more = [...cards, { front: "adiós", back: "bye" }];
    await callTool("update_deck", { key: "spanish.json", cards: more });
    const reread = await callTool("read_deck", { key: "spanish.json" });
    expect(JSON.parse(reread.content[0].text).cardCount).toBe(2);

    expect((await callTool("delete_deck", { key: "spanish.json" })).isError).toBeFalsy();
    expect(decks.has("spanish.json")).toBe(false);
  });
});
