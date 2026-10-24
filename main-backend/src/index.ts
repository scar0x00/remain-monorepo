import { Hono, MiddlewareHandler } from "hono";
import { Client } from "pg";
import { createMcpHandler } from "agents/mcp/server";
import { accessAuth } from "./lib/access-auth";
import { SYSTEM_USER_ID, deleteDeck, listDecks, putDeck, upsertDeckRow } from "./lib/decks";
import {
  AnswersSchema,
  CreateSessionSchema,
  createSession,
  finishSession,
  getAnswers,
  getSession,
  listDeckStats,
  listSessions,
  saveAnswers,
} from "./lib/study-sessions";
import { createServer } from "./mcp";
import { type Env } from "./types";

const app = new Hono<Env>();

const FLASHCARD_AGENT_ORIGIN = "http://flashcard-agent";

const pgDbMiddleware: MiddlewareHandler = async (c, next) => {
  const client = new Client({
    connectionString: c.env.PG.connectionString,
  });

  await client.connect();
  c.set("pg", client);

  try {
    await next();
  } finally {
    await client.end();
  }
};

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

  const object = await putDeck(
    { bucket: c.env.DECKS, pg: c.get("pg") },
    key,
    body,
    c.req.header("content-type"),
  );

  if (!object) {
    return c.text("Upload failed", 500);
  }

  return c.text(`Put ${key} successfully!`);
});

// Generates a deck (or refines an existing one when `refine` is set) through the flashcard agent,
// then records the stored deck in Postgres so it shows up in the deck list.
app.post("/api/v1/flashcards/:deckName", pgDbMiddleware, async (c) => {
  const deckName = c.req.param("deckName");
  const agentUrl = new URL(
    `/agents/flashcard-agent/${encodeURIComponent(deckName)}`,
    FLASHCARD_AGENT_ORIGIN,
  );

  const upstream = await c.env.FLASHCARD_AGENT.fetch(
    new Request(agentUrl, c.req.raw),
  );
  if (!upstream.ok) {
    return upstream;
  }

  const text = await upstream.text();
  const { key } = JSON.parse(text) as { key: string };

  const object = await c.env.DECKS.head(key);
  if (!object) {
    return c.text(`Generated deck ${key} could not be found`, 500);
  }

  await upsertDeckRow(c.get("pg"), key, object);

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
});

app.delete("/api/v1/deck/:key", pgDbMiddleware, async (c) => {
  const key = c.req.param("key");
  const deleted = await deleteDeck({ bucket: c.env.DECKS, pg: c.get("pg") }, key);

  if (!deleted) {
    return c.text("Object Not Found", 404);
  }

  return c.text(`Deleted ${key} successfully!`);
});

app.get("/api/v1/decks", pgDbMiddleware, async (c) => {
  const pg = c.get("pg");
  const [decks, stats] = await Promise.all([
    listDecks({ bucket: c.env.DECKS, pg }, c.req.query("searchTerm")),
    listDeckStats(pg, SYSTEM_USER_ID),
  ]);

  return c.json(decks.map((deck) => ({ ...deck, ...stats.get(deck.deckName) })));
});

// Study sessions. Decks are all owned by SYSTEM_USER_ID until users land (#12), so sessions are too.
app.use("/api/v1/study-sessions/*", pgDbMiddleware);
app.use("/api/v1/study-sessions", pgDbMiddleware);

app.post("/api/v1/study-sessions", async (c) => {
  const parsed = CreateSessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const id = await createSession(c.get("pg"), SYSTEM_USER_ID, parsed.data);
  return c.json({ id }, 201);
});

app.get("/api/v1/study-sessions", async (c) => {
  const limit = c.req.query("limit");
  const result = await listSessions(c.get("pg"), SYSTEM_USER_ID, {
    deckName: c.req.query("deckName"),
    limit: limit ? Number(limit) : undefined,
    cursor: c.req.query("cursor"),
  });
  return c.json(result);
});

app.get("/api/v1/study-sessions/:id", async (c) => {
  const pg = c.get("pg");
  const session = await getSession(pg, SYSTEM_USER_ID, c.req.param("id"));
  if (!session) {
    return c.text("Session Not Found", 404);
  }

  return c.json({ ...session, answers: await getAnswers(pg, session.id) });
});

app.post("/api/v1/study-sessions/:id/answers", async (c) => {
  const parsed = AnswersSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const pg = c.get("pg");
  const session = await getSession(pg, SYSTEM_USER_ID, c.req.param("id"));
  if (!session) {
    return c.text("Session Not Found", 404);
  }
  if (session.status === "completed") {
    return c.text("Session is already finished", 409);
  }

  await saveAnswers(pg, session.id, parsed.data.answers);
  return c.body(null, 204);
});

app.post("/api/v1/study-sessions/:id/finish", async (c) => {
  const session = await finishSession(c.get("pg"), SYSTEM_USER_ID, c.req.param("id"));
  if (!session) {
    return c.text("Session Not Found", 404);
  }

  return c.json(session);
});

app.all("/mcp", accessAuth, (c) =>
  createMcpHandler(() => createServer(c.env))(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext),
);

export default app;
