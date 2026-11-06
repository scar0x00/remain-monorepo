import { type Context, Hono, MiddlewareHandler } from "hono";
import { Client } from "pg";
import { createMcpHandler } from "agents/mcp/server";
import { accessAuth } from "./lib/access-auth";
import { securityStatus } from "./lib/account-security";
import { type AnalyticsProperties, track } from "./lib/analytics";
import { AUTH_BASE_PATH } from "./lib/auth";
import { formatOfKey, parseDeck, readDeck } from "./lib/deck-format";
import {
  type DeckStore,
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
import { requireUser, withAuth } from "./lib/require-user";
import { userBucket } from "./lib/user-bucket";
import { createServer } from "./mcp";
import { type Env } from "./types";

const app = new Hono<Env>();

const FLASHCARD_AGENT_ORIGIN = "http://flashcard-agent";
// Who the agent acts for. Keep in sync with flashcard-generator-agent/src/agent.ts.
const AGENT_USER_ID_HEADER = "x-remain-user-id";
// URI-encoded, since a display name can be any Unicode and header values can't.
const AGENT_USER_NAME_HEADER = "x-remain-user-name";

// Hono throws when a request has no execution context, which is the case in unit tests.
const executionCtx = (c: Context<Env>) => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
};

const trackRequest = (c: Context<Env>, event: string, properties?: AnalyticsProperties) =>
  track(c.env, executionCtx(c), c.get("user").id, event, properties);

// The signed-in user's decks. Needs pgDbMiddleware.
const deckStore = (c: Context<Env>): DeckStore => ({
  bucket: userBucket(c.env.DECKS, c.get("user").id),
  pg: c.get("pg"),
  userId: c.get("user").id,
});

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

// better-auth: sign-up, sign-in, GitHub OAuth, email verification, password reset, sessions, 2FA,
// passkeys.
app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => withAuth(c, (auth) => auth.handler(c.req.raw)));

// Every other /api/v1 route needs a signed-in user, and only ever sees that user's data.
app.use("/api/v1/*", async (c, next) =>
  c.req.path.startsWith(`${AUTH_BASE_PATH}/`) ? next() : requireUser(c, next),
);

// The security settings page: 2FA and password state better-auth's client doesn't expose.
app.get("/api/v1/account/security", (c) => withAuth(c, async (auth) => c.json(await securityStatus(auth, c.get("user").id))));

// Doesn't use Postgres: the R2 key is under the user's prefix, so the key itself enforces ownership.
app.get("/api/v1/deck/:key", async (c) => {
  const key = c.req.param("key");

  const deck = await userBucket(c.env.DECKS, c.get("user").id).get(key, {
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

// Uploads a file, or saves an edited deck when the request has `If-Match` (the editor, #14).
// With `If-Match` the write only happens if the stored object still has that etag, otherwise 412,
// e.g. when the agent refined the deck meanwhile. The response's `ETag` is the new object's.
app.put("/api/v1/deck/:key", pgDbMiddleware, async (c) => {
  const key = c.req.param("key");
  const body = await c.req.arrayBuffer();
  const ifMatch = c.req.header("if-match");

  if (body.byteLength === 0) {
    return c.text("Body is required", 400);
  }

  const store = deckStore(c);
  let stored: R2ObjectBody | null = null;
  if (ifMatch) {
    stored = await store.bucket.get(key);
    if (!stored || !etagsMatch(ifMatch, stored.etag)) {
      trackRequest(c, "deck_edit_conflict", { deck: key, via: "app" });
      return deckChanged(c);
    }
  }
  // Checked again by R2 at write time, in case another write lands between our read and put.
  const condition = stored ? { onlyIf: { etagMatches: stored.etag } } : {};

  const format = formatOfKey(key);
  let cardCount: number | null = null;
  let object;
  if (format) {
    // .json/.yaml files must be decks, stored as v2 in the key's format. The editor sends JSON for
    // any deck key, so a JSON content type wins over the extension.
    const bodyFormat = c.req.header("content-type")?.startsWith("application/json") ? "json" : format;
    const result = readDeck(new TextDecoder().decode(body), bodyFormat);
    if ("error" in result) {
      return c.text(result.error, 400);
    }
    const { deck } = result;
    cardCount = deck.cards.length;
    if (stored) {
      // An edit: how the deck was produced, by whom and from what never changes (#13).
      const { tool, author, sources } = parseDeck(await stored.text(), format)?.meta ?? {};
      const { tool: _t, author: _a, sources: _s, ...edited } = deck.meta;
      deck.meta = {
        ...edited,
        ...(tool !== undefined && { tool }),
        ...(author !== undefined && { author }),
        ...(sources !== undefined && { sources }),
      };
    } else {
      // An upload is stamped as one unless the file already says how it was produced.
      deck.meta.tool ??= { kind: "upload", generatedAt: new Date().toISOString() };
      // The uploader, unless the file already names its author.
      if (deck.meta.author === undefined) {
        const user = c.get("user");
        deck.meta.author = { id: user.id, name: user.name };
      }
    }
    object = await saveDeck(store, key, format, deck, condition);
  } else {
    // Other files (e.g. .apkg) are stored as they are.
    object = await putDeck(store, key, body, c.req.header("content-type"), condition);
  }

  if (!object) {
    // R2 also returns null when the `onlyIf` condition fails.
    if (stored) trackRequest(c, "deck_edit_conflict", { deck: key, via: "app" });
    return stored ? deckChanged(c) : c.text("Upload failed", 500);
  }

  trackRequest(
    c,
    stored ? "deck_edited" : "deck_created",
    stored
      ? { deck: key, via: "app", card_count: cardCount }
      : { deck: key, source: "upload", format: format ?? key.split(".").pop() ?? null, card_count: cardCount },
  );
  c.header("etag", object.httpEtag);
  return c.text(`Put ${key} successfully!`);
});

const deckChanged = (c: Context<Env>) =>
  c.text("The deck changed since it was loaded. Reload it, or overwrite it with your version.", 412);

// `If-Match` may list several etags or `*`. Weak etags (`W/"..."`) count as a match: Cloudflare
// weakens the etag of a response it compresses, so that is what the browser sends back.
function etagsMatch(ifMatch: string, etag: string) {
  return ifMatch
    .split(",")
    .map((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
    .some((value) => value === "*" || value === etag);
}

// Generates a deck (or refines an existing one when `refine` is set) through the flashcard agent,
// then records the stored deck in Postgres so it shows up in the deck list.
app.post("/api/v1/flashcards/:deckName", pgDbMiddleware, async (c) => {
  const deckName = c.req.param("deckName");
  const user = c.get("user");
  // One agent instance per user and deck (`<userId>:<deckName>`), so two users' decks with the same
  // name never share state. The colon stays literal: the agent checks the prefix of the raw name.
  const agentUrl = new URL(
    `/agents/flashcard-agent/${encodeURIComponent(user.id)}:${encodeURIComponent(deckName)}`,
    FLASHCARD_AGENT_ORIGIN,
  );

  // Read on a copy: the original body is forwarded to the agent as it is.
  const form = await c.req.raw.clone().formData().catch(() => null);
  const refine = form?.get("refine") === "true";
  const sourceFiles = form ? [...form.values()].filter((value) => typeof value !== "string").length : 0;
  const startedAt = Date.now();

  // The agent is only reachable through this service binding, so it trusts these headers. `set`
  // replaces anything the client sent under the same names.
  const agentRequest = new Request(agentUrl, c.req.raw);
  agentRequest.headers.set(AGENT_USER_ID_HEADER, user.id);
  agentRequest.headers.set(AGENT_USER_NAME_HEADER, encodeURIComponent(user.name));
  const upstream = await c.env.FLASHCARD_AGENT.fetch(agentRequest);
  if (!upstream.ok) {
    trackRequest(c, "deck_generation_failed", { deck: deckName, refine, status: upstream.status });
    return upstream;
  }

  const text = await upstream.text();
  const { key } = JSON.parse(text) as { key: string };

  const object = await userBucket(c.env.DECKS, user.id).get(key);
  if (!object) {
    return c.text(`Generated deck ${key} could not be found`, 500);
  }

  const summary = summarizeDeckFile(key, await object.text());
  await upsertDeckRow(c.get("pg"), user.id, key, object, summary);
  trackRequest(c, refine ? "deck_refined" : "deck_created", {
    deck: key,
    ...(refine ? {} : { source: "agent", format: formatOfKey(key) }),
    card_count: summary?.cardCount ?? null,
    language: summary?.meta.language ?? null,
    source_files: sourceFiles,
    duration_ms: Date.now() - startedAt,
  });

  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
});

app.delete("/api/v1/deck/:key", pgDbMiddleware, async (c) => {
  const key = c.req.param("key");
  const deleted = await deleteDeck(deckStore(c), key);

  if (!deleted) {
    return c.text("Object Not Found", 404);
  }

  trackRequest(c, "deck_deleted", { deck: key, via: "app" });
  return c.text(`Deleted ${key} successfully!`);
});

app.get("/api/v1/decks", pgDbMiddleware, async (c) => {
  const store = deckStore(c);
  const [decks, stats] = await Promise.all([
    listDecks(store, c.req.query("searchTerm")),
    listDeckStats(store.pg, store.userId),
  ]);

  return c.json(decks.map((deck) => ({ ...deck, ...stats.get(deck.deckName) })));
});

// Study sessions, always the signed-in user's.
app.use("/api/v1/study-sessions/*", pgDbMiddleware);
app.use("/api/v1/study-sessions", pgDbMiddleware);

app.post("/api/v1/study-sessions", async (c) => {
  const parsed = CreateSessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const id = await createSession(c.get("pg"), c.get("user").id, parsed.data);
  trackRequest(c, "study_session_started", {
    deck: parsed.data.deckName,
    card_total: parsed.data.cardTotal,
    mode: parsed.data.mode ?? "full",
  });
  return c.json({ id }, 201);
});

app.get("/api/v1/study-sessions", async (c) => {
  const limit = c.req.query("limit");
  const result = await listSessions(c.get("pg"), c.get("user").id, {
    deckName: c.req.query("deckName"),
    limit: limit ? Number(limit) : undefined,
    cursor: c.req.query("cursor"),
  });
  return c.json(result);
});

app.get("/api/v1/study-sessions/:id", async (c) => {
  const pg = c.get("pg");
  const session = await getSession(pg, c.get("user").id, c.req.param("id"));
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
  const session = await getSession(pg, c.get("user").id, c.req.param("id"));
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
  const pg = c.get("pg");
  const before = await getSession(pg, c.get("user").id, c.req.param("id"));
  const session = await finishSession(pg, c.get("user").id, c.req.param("id"));
  if (!session) {
    return c.text("Session Not Found", 404);
  }

  // Only the first finish counts; finishing again is a no-op.
  if (before?.status !== "completed" && session.status === "completed") {
    trackRequest(c, "study_session_finished", {
      deck: session.deckName,
      card_total: session.cardTotal,
      answered: session.right + session.wrong,
      right: session.right,
      wrong: session.wrong,
      accuracy: session.accuracy,
      duration_s: session.finishedAt
        ? Math.round((new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
        : null,
    });
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
  return c.json(await getOverview(c.get("pg"), c.get("user").id, statsRange(c)));
});

app.get("/api/v1/stats/activity", async (c) => {
  return c.json(await getActivity(c.get("pg"), c.get("user").id, statsRange(c, 84)));
});

app.get("/api/v1/stats/decks", async (c) => {
  const pg = c.get("pg");
  // Best effort: a deck file that can't be read must not take the stats down with it.
  await backfillDeckRows(deckStore(c)).catch((error) =>
    console.error("card_count backfill failed", error),
  );
  return c.json(await listDeckStatsInRange(pg, c.get("user").id, statsRange(c)));
});

app.get("/api/v1/stats/decks/:name", async (c) => {
  const pg = c.get("pg");
  const name = c.req.param("name");
  const [deck] = await listDeckStatsInRange(pg, c.get("user").id, statsRange(c), name);
  if (!deck) {
    return c.text("Deck Not Found", 404);
  }

  return c.json({
    ...deck,
    recentSessions: await listDeckSessions(pg, c.get("user").id, name),
    hardestCards: await listHardestCards(pg, c.get("user").id, { deckName: name }),
  });
});

app.get("/api/v1/stats/hardest-cards", async (c) => {
  const limit = parseDays(c.req.query("limit"), 5, 50);
  return c.json(await listHardestCards(c.get("pg"), c.get("user").id, { limit }));
});

app.all("/mcp", accessAuth, (c) =>
  createMcpHandler(() => createServer(c.env, c.get("user"), executionCtx(c)))(c.req.raw, c.env, c.executionCtx as unknown as ExecutionContext),
);

export default app;
