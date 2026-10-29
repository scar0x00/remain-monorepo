import { Hono, MiddlewareHandler } from "hono";
import { Client } from "pg";
import { createMcpHandler } from "agents/mcp/server";
import { accessAuth } from "./lib/access-auth";
import { formatOfKey, readDeck } from "./lib/deck-format";
import {
  SYSTEM_USER_ID,
  backfillDeckRows,
  deleteDeck,
  listDecks,
  putDeck,
  saveDeck,
  summarizeDeckFile,
  upsertDeckRow,
} from "./lib/decks";
import {
  type StatsRange,
  getActivity,
  getOverview,
  listDeckSessions,
  listDeckStats as listDeckStatsInRange,
  listHardestCards,
  parseDays,
  parseTimeZone,
} from "./lib/stats";
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

  const store = { bucket: c.env.DECKS, pg: c.get("pg") };
  const format = formatOfKey(key);
  let object;
  if (format) {
    // .json/.yaml files must be decks. They are stored as v2, stamped as an upload unless the file
    // already says how it was produced.
    const result = readDeck(new TextDecoder().decode(body), format);
    if ("error" in result) {
      return c.text(result.error, 400);
    }
    const { deck } = result;
    deck.meta.tool ??= { kind: "upload", generatedAt: new Date().toISOString() };
    // No accounts yet (#12), so the uploader is unknown.
    if (deck.meta.author === undefined) deck.meta.author = null;
    object = await saveDeck(store, key, format, deck);
  } else {
    // Other files (e.g. .apkg) are stored as they are.
    object = await putDeck(store, key, body, c.req.header("content-type"));
  }

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

  const object = await c.env.DECKS.get(key);
  if (!object) {
    return c.text(`Generated deck ${key} could not be found`, 500);
  }

  await upsertDeckRow(c.get("pg"), key, object, summarizeDeckFile(key, await object.text()));

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

// Dashboard stats. Every answered card counts, whatever the session status. `days` is the window in
// local days (today included) and `tz` the IANA zone the days are bucketed in.
app.use("/api/v1/stats/*", pgDbMiddleware);

const statsRange = (c: { req: { query: (key: string) => string | undefined } }, fallbackDays = 30): StatsRange => ({
  days: parseDays(c.req.query("days"), fallbackDays),
  tz: parseTimeZone(c.req.query("tz")),
});

app.get("/api/v1/stats/overview", async (c) => {
  return c.json(await getOverview(c.get("pg"), SYSTEM_USER_ID, statsRange(c)));
});

app.get("/api/v1/stats/activity", async (c) => {
  return c.json(await getActivity(c.get("pg"), SYSTEM_USER_ID, statsRange(c, 84)));
});

app.get("/api/v1/stats/decks", async (c) => {
  const pg = c.get("pg");
  // Best effort: a deck file that can't be read must not take the stats down with it.
  await backfillDeckRows({ bucket: c.env.DECKS, pg }).catch((error) =>
    console.error("card_count backfill failed", error),
  );
  return c.json(await listDeckStatsInRange(pg, SYSTEM_USER_ID, statsRange(c)));
});

app.get("/api/v1/stats/decks/:name", async (c) => {
  const pg = c.get("pg");
  const name = c.req.param("name");
  const [deck] = await listDeckStatsInRange(pg, SYSTEM_USER_ID, statsRange(c), name);
  if (!deck) {
    return c.text("Deck Not Found", 404);
  }

  return c.json({
    ...deck,
    recentSessions: await listDeckSessions(pg, SYSTEM_USER_ID, name),
    hardestCards: await listHardestCards(pg, SYSTEM_USER_ID, { deckName: name }),
  });
});

app.get("/api/v1/stats/hardest-cards", async (c) => {
  const limit = parseDays(c.req.query("limit"), 5, 50);
  return c.json(await listHardestCards(c.get("pg"), SYSTEM_USER_ID, { limit }));
});

app.all("/mcp", accessAuth, (c) =>
  createMcpHandler(() => createServer(c.env))(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext),
);

export default app;
