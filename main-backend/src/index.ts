import { Hono } from "hono";
import { Client } from "pg";
import { chatRoutes } from "./chat-routes";
import { finalizeAssistantMessage, isUuid, type Outcome } from "./lib/chat-store";
import { currentUserMiddleware, SYSTEM_USER_ID } from "./lib/current-user";
import { pgDbMiddleware } from "./lib/pg";
import { type Env } from "./types";

const app = new Hono<Env>();

const FLASHCARD_AGENT_ORIGIN = "http://flashcard-agent";

type DeckRow = {
  name: string;
  size: string;
  createdAt: Date;
  etag: string;
};

app.route("/api/v1/chats", chatRoutes);

app.get("/api/v1/deck/:key", async (c) => {
  const key = c.req.param("key");

  const deck = await c.env.DECKS.get(key, {
    onlyIf: c.req.raw.headers,
    range: c.req.raw.headers,
  });

  if (!deck) {
    return c.text("Object Not Found", 404);
  }

  const headers = new Headers();
  deck.writeHttpMetadata(headers);
  headers.set("etag", deck.httpEtag);

  if (!("body" in deck)) {
    return new Response(null, {
      status: 304,
      headers,
    });
  }

  return new Response(deck.body, {
    headers,
    status: c.req.header("range") ? 206 : 200, // 206 Partial Content for range requests
  });
});

app.put("/api/v1/deck/:key", pgDbMiddleware, async (c) => {
  const key = c.req.param("key");
  const body = await c.req.arrayBuffer();

  if (body.byteLength === 0) {
    return c.text("Body is required", 400);
  }

  const object = await c.env.DECKS.put(key, body, {
    httpMetadata: { contentType: c.req.header("content-type") },
  });

  if (!object) {
    return c.text("Upload failed", 500);
  }

  await upsertDeckRow(c.get("pg"), key, object);

  return c.text(`Put ${key} successfully!`);
});

// Generates a deck (or refines an existing one when `refine` is set) through the flashcard agent,
// then records the stored deck in Postgres so it shows up in the deck list.
//
// When the request carries `x-chat-session-id` and `x-chat-message-id` (the pending assistant
// message created by the chat UI), the outcome is also written to that message, so the saved
// conversation is complete even if the tab was closed while the deck was generating.
// `x-chat-refine: true` tells which wording to use. The form body is never parsed here.
app.post("/api/v1/flashcards/:deckName", pgDbMiddleware, currentUserMiddleware, async (c) => {
  const deckName = c.req.param("deckName");
  const chat = readChatHeaders(c.req.raw.headers);
  const settle = async (outcome: Outcome) => {
    if (!chat) return;
    try {
      await finalizeAssistantMessage(
        c.get("pg"),
        c.get("userId"),
        chat.sessionId,
        chat.messageId,
        outcome,
      );
    } catch (error) {
      console.error("Could not save the chat outcome", error);
    }
  };

  const agentUrl = new URL(
    `/agents/flashcard-agent/${encodeURIComponent(deckName)}`,
    FLASHCARD_AGENT_ORIGIN,
  );

  let upstream: Response;
  try {
    upstream = await c.env.FLASHCARD_AGENT.fetch(new Request(agentUrl, c.req.raw));
  } catch (error) {
    await settle({ ok: false, text: "Could not reach the flashcard agent." });
    throw error;
  }

  if (!upstream.ok) {
    await settle({ ok: false, text: await describeAgentFailure(upstream.clone()) });
    return upstream;
  }

  const text = await upstream.text();
  const { key, cardCount } = JSON.parse(text) as { key: string; cardCount: number };

  const object = await c.env.DECKS.head(key);
  if (!object) {
    await settle({ ok: false, text: `Generated deck ${key} could not be found` });
    return c.text(`Generated deck ${key} could not be found`, 500);
  }

  await upsertDeckRow(c.get("pg"), key, object);
  await settle({
    ok: true,
    text: chat?.refine
      ? `Updated ${deckName}. It now has ${cardCount} flashcards.`
      : `Created ${cardCount} flashcards in ${deckName}.`,
    deckName,
    deckKey: key,
    cardCount,
    etag: object.httpEtag,
  });

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
});

function readChatHeaders(headers: Headers) {
  const sessionId = headers.get("x-chat-session-id");
  const messageId = headers.get("x-chat-message-id");
  if (!isUuid(sessionId) || !isUuid(messageId)) return null;

  return { sessionId, messageId, refine: headers.get("x-chat-refine") === "true" };
}

async function describeAgentFailure(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return `The flashcard agent failed with status ${response.status}`;
}

app.delete("/api/v1/deck/:key", pgDbMiddleware, async (c) => {
  const key = c.req.param("key");
  const existing = await c.env.DECKS.head(key);

  if (!existing) {
    return c.text("Object Not Found", 404);
  }

  await c.env.DECKS.delete(key);

  const pg = c.get("pg");
  await pg.query(`DELETE FROM public.decks WHERE name = $1`, [key]);

  return c.text(`Deleted ${key} successfully!`);
});

async function upsertDeckRow(
  pg: Client,
  key: string,
  object: Pick<R2Object, "size" | "httpEtag">,
) {
  await pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag`,
    [key, SYSTEM_USER_ID, object.size, object.httpEtag],
  );
}

app.get("/api/v1/decks", pgDbMiddleware, async (c) => {
  const searchTerm = c.req.query("searchTerm") ?? "";
  const pg = c.get("pg");

  const { rows } = await pg.query<DeckRow>(
    `SELECT name, size, "createdAt", etag
     FROM public.decks
     WHERE name ILIKE $1
     ORDER BY name`,
    [`${searchTerm}%`],
  );

  const decks = rows.map((row) => ({
    deckName: row.name,
    size: Number(row.size),
    uploaded: row.createdAt,
    etag: row.etag,
  }));

  return c.json(decks);
});

export default app;
