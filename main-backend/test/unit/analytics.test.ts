import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fakePg, resetDecks, users } from "../helpers/fake-pg";
import { createFakeR2 } from "../helpers/fake-r2";
import { signedInAs } from "../helpers/test-auth";

type Captured = { distinctId: string; event: string; properties: Record<string, unknown> };
const captured: Captured[] = [];

mock.module("pg", fakePg);
mock.module("posthog-node", () => ({
  PostHog: class {
    async captureImmediate(message: Captured) {
      captured.push(message);
    }
  },
}));

const { default: realApp } = await import("../../src/index");
let app: Awaited<ReturnType<typeof signedInAs>>;
const { track } = await import("../../src/lib/analytics");

let env: Record<string, unknown>;
let pending: Promise<unknown>[];
const ctx = () => ({ waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException() {} });

const request = async (url: string, init?: RequestInit) => {
  const res = await app.request(url, init, ctx());
  // MCP answers as a stream, and the tool runs while it is read.
  await res.clone().text();
  await Promise.all(pending);
  return res;
};

const events = () => captured.map(({ event, properties }) => ({ event, ...properties }));

beforeEach(async () => {
  resetDecks();
  pending = [];
  env = {
    PG: { connectionString: "postgres://fake" },
    DECKS: createFakeR2(),
    DEV_SKIP_ACCESS_AUTH: "true",
    DEV_ACCESS_EMAIL: "ada@example.com",
    POSTHOG_KEY: "phc_test",
    POSTHOG_HOST: "https://us.i.posthog.com",
  };
  app = await signedInAs(realApp, env);
  // The account MCP calls resolve to, as fake-pg's "user" table.
  users.set(app.userId, { id: app.userId, name: "Ada", email: "ada@example.com", emailVerified: true });
  captured.length = 0;
});

describe("track", () => {
  it("sends nothing without a token", async () => {
    track({ POSTHOG_HOST: "https://us.i.posthog.com" }, ctx(), "u_1", "deck_deleted");
    await Promise.all(pending);
    expect(pending).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("sends an anonymous event under waitUntil", async () => {
    track(env as any, ctx(), "u_1", "deck_deleted", { deck: "a.json" });
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(captured).toEqual([
      { distinctId: "u_1", event: "deck_deleted", properties: { deck: "a.json", $process_person_profile: false } },
    ]);
  });
});

describe("REST events", () => {
  const deck = JSON.stringify([{ front: "Q", back: "A" }]);

  it("records an upload, an edit and a conflict", async () => {
    const upload = await request("http://localhost/api/v1/deck/alpha.json", { method: "PUT", body: deck });
    const etag = upload.headers.get("etag")!;
    await request("http://localhost/api/v1/deck/alpha.json", { method: "PUT", body: deck, headers: { "if-match": etag } });
    await request("http://localhost/api/v1/deck/alpha.json", { method: "PUT", body: deck, headers: { "if-match": '"stale"' } });

    expect(events()).toEqual([
      expect.objectContaining({ event: "deck_created", deck: "alpha.json", source: "upload", format: "json", card_count: 1 }),
      expect.objectContaining({ event: "deck_edited", deck: "alpha.json", via: "app", card_count: 1 }),
      expect.objectContaining({ event: "deck_edit_conflict", deck: "alpha.json", via: "app" }),
    ]);
  });

  it("never sends card text", async () => {
    await request("http://localhost/api/v1/deck/alpha.json", { method: "PUT", body: deck });
    expect(JSON.stringify(captured)).not.toContain('"Q"');
  });
});

describe("MCP events", () => {
  it("records the tool call and the deck it created", async () => {
    await request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", host: "localhost" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_deck", arguments: { name: "beta", cards: [{ front: "Q", back: "A" }] } },
      }),
    });

    expect(events()).toEqual([
      expect.objectContaining({ event: "mcp_tool_called", tool: "create_deck", ok: true }),
      expect.objectContaining({ event: "deck_created", deck: "beta.json", source: "mcp", format: "json", card_count: 1 }),
    ]);
  });
});
