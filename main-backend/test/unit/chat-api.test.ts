import { beforeEach, describe, expect, it } from "bun:test";
import { Client } from "pg";
import { app, realPgUrl } from "../helpers/app";
import { chatMessages, resetDecks } from "../helpers/fake-pg";
import { createFakeR2, type FakeR2 } from "../helpers/fake-r2";

const BASE = "http://localhost/api/v1";
const USERS = ["system", "alice", "bob"];

let DECKS: FakeR2;
let agentResponder: (request: Request) => Response | Promise<Response>;
let env: Record<string, unknown>;

const request = (path: string, init: RequestInit & { user?: string } = {}) => {
  const { user, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (user) headers.set("x-test-user", user);
  return app.request(`${BASE}${path}`, { ...rest, headers }, env as any);
};

const json = (body: unknown, method = "POST", user?: string) => ({
  method,
  user,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function newChat(user?: string, title?: string) {
  const res = await request("/chats", json(title ? { title } : {}, "POST", user));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; title: string };
}

async function addMessages(id: string, messages: unknown[], user?: string) {
  const res = await request(`/chats/${id}/messages`, json({ messages }, "POST", user));
  expect(res.status).toBe(201);
  return ((await res.json()) as { messages: any[] }).messages;
}

async function getChat(id: string, user?: string) {
  const res = await request(`/chats/${id}`, { user });
  return { status: res.status, body: (await res.json()) as any };
}

// Opens a chat with a user message and a pending assistant message, like the chat UI does.
async function startTurn(user?: string, text = "Make a deck about cells") {
  const chat = await newChat(user);
  const [, pending] = await addMessages(
    chat.id,
    [
      { role: "user", text, attachments: [] },
      { role: "assistant", state: "pending", text: "Generating flashcards…" },
    ],
    user,
  );
  return { chatId: chat.id, messageId: pending.id as string };
}

function generate(
  deckName: string,
  chat: { chatId: string; messageId: string } | null,
  extra: Record<string, string> = {},
  user?: string,
) {
  const body = new FormData();
  body.set("deckName", deckName);
  const headers: Record<string, string> = { ...extra };
  if (chat) {
    headers["x-chat-session-id"] = chat.chatId;
    headers["x-chat-message-id"] = chat.messageId;
  }
  return request(`/flashcards/${deckName}`, { method: "POST", body, headers, user });
}

const createsDeck = (cardCount: number) => async (request: Request) => {
  const name = new URL(request.url).pathname.split("/").pop()!;
  const key = `${decodeURIComponent(name)}.json`;
  await DECKS.put(key, JSON.stringify([{ front: "Q?", back: "A" }]));
  return Response.json({ key, format: "json", cardCount }, { status: 201 });
};

async function ageMessage(id: string, ms: number) {
  if (realPgUrl) {
    const client = new Client({ connectionString: realPgUrl });
    await client.connect();
    await client.query(
      `UPDATE public.chat_messages SET created_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [id, ms / 1000],
    );
    await client.end();
  } else {
    chatMessages.find((m) => m.id === id)!.created_at = new Date(Date.now() - ms);
  }
}

beforeEach(async () => {
  if (realPgUrl) {
    const client = new Client({ connectionString: realPgUrl });
    await client.connect();
    await client.query(`TRUNCATE public.chat_sessions CASCADE`);
    await client.query(`DELETE FROM public.decks`);
    for (const id of USERS) {
      await client.query(
        `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $1, $1 || '@test.local', true)
         ON CONFLICT (id) DO NOTHING`,
        [id],
      );
    }
    await client.end();
  } else {
    resetDecks();
  }

  DECKS = createFakeR2();
  agentResponder = createsDeck(5);
  env = {
    PG: { connectionString: realPgUrl ?? "postgres://fake" },
    DECKS,
    FLASHCARD_AGENT: { fetch: async (input: Request) => agentResponder(input) },
  };
});

describe("POST /chats", () => {
  it("creates a session with the default title", async () => {
    const res = await request("/chats", json({}));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      title: "New deck",
      deckName: null,
      deckKey: null,
    });
  });

  it("accepts a title and rejects an empty or oversized one", async () => {
    expect((await newChat(undefined, "  Biology  ")).title).toBe("Biology");

    const empty = await request("/chats", json({ title: "   " }));
    const long = await request("/chats", json({ title: "x".repeat(121) }));
    expect(empty.status).toBe(400);
    expect(long.status).toBe(400);
  });
});

describe("GET /chats", () => {
  it("lists only the caller's sessions, most recently updated first", async () => {
    const first = await newChat("alice");
    const second = await newChat("alice");
    await newChat("bob");
    await addMessages(first.id, [{ role: "user", text: "later" }], "alice");

    const res = await request("/chats", { user: "alice" });
    const body = (await res.json()) as { sessions: { id: string }[]; nextCursor: string | null };

    expect(body.sessions.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages with limit and the returned cursor", async () => {
    const ids = [] as string[];
    for (let i = 0; i < 3; i++) ids.push((await newChat()).id);

    const page1 = (await (await request("/chats?limit=2")).json()) as any;
    expect(page1.sessions.map((s: any) => s.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).toBeString();

    const page2 = (await (
      await request(`/chats?limit=2&before=${encodeURIComponent(page1.nextCursor)}`)
    ).json()) as any;
    expect(page2.sessions.map((s: any) => s.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects a bad limit or cursor", async () => {
    expect((await request("/chats?limit=0")).status).toBe(400);
    expect((await request("/chats?limit=1000")).status).toBe(400);
    expect((await request("/chats?before=yesterday-ish")).status).toBe(400);
  });
});

describe("POST /chats/:id/messages", () => {
  it("stores messages in order and titles the session from the first user message", async () => {
    const chat = await newChat();

    const created = await addMessages(chat.id, [
      {
        role: "user",
        text: "Cells are the unit of life.",
        attachments: [{ name: "notes.pdf", size: 1234 }],
      },
      { role: "assistant", state: "pending", text: "Generating flashcards…" },
    ]);

    expect(created.map((m) => [m.role, m.state])).toEqual([
      ["user", "done"],
      ["assistant", "pending"],
    ]);
    const { body } = await getChat(chat.id);
    expect(body.title).toBe("Cells are the unit of life.");
    expect(body.messages[0].attachments).toEqual([{ name: "notes.pdf", size: 1234 }]);
  });

  it("falls back to the first attachment name and truncates long titles", async () => {
    const withFile = await newChat();
    await addMessages(withFile.id, [
      { role: "user", text: "", attachments: [{ name: "chapter-3.pdf", size: 1 }] },
    ]);
    expect((await getChat(withFile.id)).body.title).toBe("chapter-3.pdf");

    const long = await newChat();
    await addMessages(long.id, [{ role: "user", text: "word ".repeat(40) }]);
    const title = (await getChat(long.id)).body.title as string;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
  });

  it("keeps a renamed or already titled session's title", async () => {
    const chat = await newChat(undefined, "My title");
    await addMessages(chat.id, [{ role: "user", text: "something else" }]);

    expect((await getChat(chat.id)).body.title).toBe("My title");
  });

  it("rejects invalid payloads", async () => {
    const chat = await newChat();
    const post = (body: unknown) => request(`/chats/${chat.id}/messages`, json(body));

    expect((await post({})).status).toBe(400);
    expect((await post({ messages: [] })).status).toBe(400);
    expect((await post({ messages: [{ role: "system", text: "x" }] })).status).toBe(400);
    expect((await post({ messages: [{ role: "user", state: "pending" }] })).status).toBe(400);
    expect(
      (await post({ messages: [{ role: "user", attachments: [{ name: "a" }] }] })).status,
    ).toBe(400);
    expect((await getChat(chat.id)).body.messages).toEqual([]);
  });
});

describe("GET /chats/:id", () => {
  it("returns the session with its messages", async () => {
    const { chatId } = await startTurn();

    const { status, body } = await getChat(chatId);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: chatId, deckExists: false });
    expect(body.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
  });

  it("returns 404 for unknown and malformed ids", async () => {
    expect((await request(`/chats/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await request("/chats/not-a-uuid")).status).toBe(404);
  });

  it("reports a pending message that is too old as interrupted", async () => {
    const { chatId, messageId } = await startTurn();
    await ageMessage(messageId, 6 * 60 * 1000);

    const { body } = await getChat(chatId);
    const message = body.messages.find((m: any) => m.id === messageId);

    expect(message.state).toBe("error");
    expect(message.text).toContain("interrupted");
  });

  it("keeps a recent pending message pending", async () => {
    const { chatId } = await startTurn();

    expect((await getChat(chatId)).body.messages[1].state).toBe("pending");
  });
});

describe("PATCH /chats/:id", () => {
  it("renames the session", async () => {
    const chat = await newChat();

    const res = await request(`/chats/${chat.id}`, json({ title: "Renamed" }, "PATCH"));

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).title).toBe("Renamed");
    expect((await getChat(chat.id)).body.title).toBe("Renamed");
  });

  it("rejects an empty title and unknown sessions", async () => {
    const chat = await newChat();

    expect((await request(`/chats/${chat.id}`, json({ title: "" }, "PATCH"))).status).toBe(400);
    expect(
      (await request(`/chats/${crypto.randomUUID()}`, json({ title: "x" }, "PATCH"))).status,
    ).toBe(404);
  });
});

describe("DELETE /chats/:id", () => {
  it("removes the session and its messages", async () => {
    const { chatId } = await startTurn();

    const res = await request(`/chats/${chatId}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect((await getChat(chatId)).status).toBe(404);
    const list = (await (await request("/chats")).json()) as any;
    expect(list.sessions).toEqual([]);
  });

  it("returns 404 the second time", async () => {
    const chat = await newChat();
    await request(`/chats/${chat.id}`, { method: "DELETE" });

    expect((await request(`/chats/${chat.id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("leaves the deck the chat produced in place", async () => {
    const turn = await startTurn();
    await generate("biology", turn);

    await request(`/chats/${turn.chatId}`, { method: "DELETE" });

    expect(DECKS.objects.has("biology.json")).toBe(true);
    const decks = (await (await request("/decks")).json()) as { deckName: string }[];
    expect(decks.map((d) => d.deckName)).toEqual(["biology.json"]);
  });
});

describe("user isolation", () => {
  it("hides one user's sessions from another on every route", async () => {
    const { chatId } = await startTurn("alice");

    expect((await getChat(chatId, "bob")).status).toBe(404);
    expect(
      (await request(`/chats/${chatId}`, json({ title: "stolen" }, "PATCH", "bob"))).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/chats/${chatId}/messages`,
          json({ messages: [{ role: "user", text: "hi" }] }, "POST", "bob"),
        )
      ).status,
    ).toBe(404);
    expect((await request(`/chats/${chatId}`, { method: "DELETE", user: "bob" })).status).toBe(404);

    const bobsList = (await (await request("/chats", { user: "bob" })).json()) as any;
    expect(bobsList.sessions).toEqual([]);

    const mine = await getChat(chatId, "alice");
    expect(mine.status).toBe(200);
    expect(mine.body.title).not.toBe("stolen");
    expect(mine.body.messages).toHaveLength(2);
  });

  it("does not let another user settle a pending message", async () => {
    const turn = await startTurn("alice");

    await generate("biology", turn, {}, "bob");

    const { body } = await getChat(turn.chatId, "alice");
    expect(body.messages[1].state).toBe("pending");
    expect(body.deckName).toBeNull();
  });
});

describe("POST /flashcards/:deckName with chat headers", () => {
  it("finalizes the pending message and links the deck on success", async () => {
    const turn = await startTurn();

    const res = await generate("biology", turn);

    expect(res.status).toBe(201);
    const { body } = await getChat(turn.chatId);
    expect(body.messages[1]).toMatchObject({
      id: turn.messageId,
      state: "done",
      text: "Created 5 flashcards in biology.",
      deckName: "biology",
      cardCount: 5,
    });
    expect(body.messages[1].deckEtag).toBeString();
    expect(body).toMatchObject({ deckName: "biology", deckKey: "biology.json", deckExists: true });
  });

  it("uses the refine wording when x-chat-refine is true", async () => {
    const turn = await startTurn();
    agentResponder = createsDeck(7);

    await generate("biology", turn, { "x-chat-refine": "true" });

    expect((await getChat(turn.chatId)).body.messages[1].text).toBe(
      "Updated biology. It now has 7 flashcards.",
    );
  });

  it("reports deckExists false once the deck is deleted", async () => {
    const turn = await startTurn();
    await generate("biology", turn);

    await request("/deck/biology.json", { method: "DELETE" });

    const { body } = await getChat(turn.chatId);
    expect(body).toMatchObject({ deckName: "biology", deckExists: false });
  });

  it("records the agent's error message when generation fails", async () => {
    const turn = await startTurn();
    agentResponder = () => Response.json({ error: "Too many sources" }, { status: 413 });

    const res = await generate("biology", turn);

    expect(res.status).toBe(413);
    const { body } = await getChat(turn.chatId);
    expect(body.messages[1]).toMatchObject({ state: "error", text: "Too many sources" });
    expect(body.deckName).toBeNull();
  });

  it("falls back to a generic message for a non-JSON agent failure", async () => {
    const turn = await startTurn();
    agentResponder = () => new Response("boom", { status: 500 });

    await generate("biology", turn);

    expect((await getChat(turn.chatId)).body.messages[1]).toMatchObject({
      state: "error",
      text: "The flashcard agent failed with status 500",
    });
  });

  it("records an error when the agent cannot be reached", async () => {
    const turn = await startTurn();
    agentResponder = () => {
      throw new Error("unreachable");
    };

    const res = await generate("biology", turn);

    expect(res.status).toBe(500);
    expect((await getChat(turn.chatId)).body.messages[1].state).toBe("error");
  });

  it("only settles a message once", async () => {
    const turn = await startTurn();
    await generate("biology", turn);
    agentResponder = () => Response.json({ error: "later failure" }, { status: 500 });

    await generate("biology", turn);

    expect((await getChat(turn.chatId)).body.messages[1].state).toBe("done");
  });

  it("works without chat headers and ignores malformed ones", async () => {
    const turn = await startTurn();

    expect((await generate("plain", null)).status).toBe(201);
    expect((await generate("plain", null, { "x-chat-session-id": "nope" })).status).toBe(201);
    expect(DECKS.objects.has("plain.json")).toBe(true);
    expect((await getChat(turn.chatId)).body.messages[1].state).toBe("pending");
  });
});
