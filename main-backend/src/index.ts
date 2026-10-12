import { Hono, MiddlewareHandler } from "hono";
import { Client } from "pg";
import { type Env } from "./types";

const app = new Hono<Env>();

const SYSTEM_USER_ID = "system";
const FLASHCARD_AGENT_ORIGIN = "http://flashcard-agent";

type DeckRow = {
  name: string;
  size: string;
  createdAt: Date;
  etag: string;
};

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
