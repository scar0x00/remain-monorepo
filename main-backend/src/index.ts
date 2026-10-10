import { Hono, MiddlewareHandler } from "hono";
import { Client } from "pg";
import { type Env } from "./types";

const app = new Hono<Env>();

const SYSTEM_USER_ID = "system";

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
  const body = c.req.raw.body;

  if (!body) {
    return c.text("Body is required", 400);
  }

  const object = await c.env.DECKS.put(key, body, {
    httpMetadata: { contentType: c.req.header("content-type") },
  });

  if (!object) {
    return c.text("Upload failed", 500);
  }

  const pg = c.get("pg");
  await pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag`,
    [key, SYSTEM_USER_ID, object.size, object.httpEtag],
  );

  return c.text(`Put ${key} successfully!`);
});

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
