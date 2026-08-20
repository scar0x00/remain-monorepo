import { Hono } from "hono";

type Bindings = {
  DECKS: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});


app.put("/deck", async (c) => {
  const body = await c.req.parseBody();
  const file = body["deck"];

  if (!(file instanceof File)) {
    return c.text("File is required", 400);
  }

  return c.json({
    name: file.name,
    size: file.size,
    type: file.type,
  });
});

app.get("/api/v1/deck/:key", async (c) => {
  const key = c.req.param('key');

  const deck = await c.env.DECKS.get(key, {
    onlyIf: c.req.raw.headers,
    range: c.req.raw.headers,
  });

  if (!deck) {
    return c.text('Object Not Found', 404);
  }

  const headers = new Headers();
  deck.writeHttpMetadata(headers);
  headers.set('etag', deck.httpEtag);

  if (!('body' in deck)) {
    return new Response(null, {
      status: 304,
      headers,
    });
  }

  // 5. Stream the response directly to the client
  return new Response(deck.body, {
    headers,
    status: c.req.header('range') ? 206 : 200, // 206 Partial Content for range requests
  });
})

export default app;
