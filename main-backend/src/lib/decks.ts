import type { Client } from "pg";
import { formatOfKey, parseDeck, serializeDeck, type Deck, type DeckFormat, type DeckMeta } from "./deck-format";

export const SYSTEM_USER_ID = "system";

export type DeckStore = { bucket: R2Bucket; pg: Client };

const CONTENT_TYPES: Record<DeckFormat, string> = {
  json: "application/json",
  yaml: "application/yaml",
};

type DeckRow = {
  name: string;
  size: string;
  createdAt: Date;
  etag: string;
  card_count: number | null;
  title: string | null;
  meta: DeckMeta | null;
};

export type DeckEntry = {
  deckName: string;
  size: number;
  uploaded: Date;
  etag: string;
  // From the deck file; absent for files that are not .json/.yaml decks.
  title?: string;
  cardCount?: number;
  author?: NonNullable<DeckMeta["author"]>;
  tool?: NonNullable<DeckMeta["tool"]>;
};

/** What the decks row keeps from a deck file. */
export type DeckSummary = { cardCount: number; title: string | null; meta: DeckMeta };

export async function listDecks(
  { pg }: DeckStore,
  searchTerm = "",
): Promise<DeckEntry[]> {
  const { rows } = await pg.query<DeckRow>(
    `SELECT name, size, "createdAt", etag, card_count, title, meta
     FROM public.decks
     WHERE name ILIKE $1 OR title ILIKE $1
     ORDER BY name`,
    [`${searchTerm}%`],
  );

  return rows.map((row) => ({
    deckName: row.name,
    size: Number(row.size),
    uploaded: row.createdAt,
    etag: row.etag,
    ...(row.title ? { title: row.title } : {}),
    ...(row.card_count !== null ? { cardCount: row.card_count } : {}),
    ...(row.meta?.author ? { author: row.meta.author } : {}),
    ...(row.meta?.tool ? { tool: row.meta.tool } : {}),
  }));
}

export function summarizeDeck(deck: Deck): DeckSummary {
  return { cardCount: deck.cards.length, title: deck.meta.title ?? null, meta: deck.meta };
}

/** Summary of a deck file, or null when it is not a valid .json/.yaml deck. */
export function summarizeDeckFile(key: string, body: ArrayBuffer | string): DeckSummary | null {
  const format = formatOfKey(key);
  if (!format) return null;

  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  const deck = parseDeck(text, format);
  return deck ? summarizeDeck(deck) : null;
}

export async function upsertDeckRow(
  pg: Client,
  key: string,
  object: Pick<R2Object, "size" | "httpEtag">,
  summary: DeckSummary | null,
) {
  await pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag, card_count, title, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (name) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag,
       card_count = EXCLUDED.card_count, title = EXCLUDED.title, meta = EXCLUDED.meta`,
    [
      key,
      SYSTEM_USER_ID,
      object.size,
      object.httpEtag,
      summary?.cardCount ?? null,
      summary?.title ?? null,
      summary ? JSON.stringify(summary.meta) : null,
    ],
  );
}

/** Only write when the stored object still matches, e.g. the request's `If-Match` header. */
export type WriteCondition = { onlyIf?: R2Conditional | Headers };

/**
 * Writes a file to R2 as is and records it in Postgres. Returns null when R2 rejects the write,
 * which includes a failed `onlyIf` condition.
 */
export async function putDeck(
  { bucket, pg }: DeckStore,
  key: string,
  body: ArrayBuffer | string,
  contentType?: string,
  { onlyIf }: WriteCondition = {},
) {
  const object = await bucket.put(key, body, {
    httpMetadata: { contentType },
    onlyIf,
  });

  if (!object) return null;

  await upsertDeckRow(pg, key, object, summarizeDeckFile(key, body));
  return object;
}

/**
 * Writes a deck in the v2 format of its key's extension. Returns null when R2 rejects the write,
 * which includes a failed `onlyIf` condition.
 */
export async function saveDeck(
  { bucket, pg }: DeckStore,
  key: string,
  format: DeckFormat,
  deck: Deck,
  { onlyIf }: WriteCondition = {},
) {
  const object = await bucket.put(key, serializeDeck(deck, format), {
    httpMetadata: { contentType: CONTENT_TYPES[format] },
    onlyIf,
  });

  if (!object) return null;

  await upsertDeckRow(pg, key, object, summarizeDeck(deck));
  return object;
}

/** Returns false when the deck does not exist. */
export async function deleteDeck({ bucket, pg }: DeckStore, key: string) {
  const existing = await bucket.head(key);
  if (!existing) return false;

  await bucket.delete(key);
  await pg.query(`DELETE FROM public.decks WHERE name = $1`, [key]);
  return true;
}

/**
 * Fills in `card_count`, `title` and `meta` for decks stored before the columns existed, by reading
 * their files from R2. Bounded per call so a request never reads many files; the rest are filled on
 * later calls.
 */
export async function backfillDeckRows({ bucket, pg }: DeckStore, limit = 10) {
  const { rows } = await pg.query<{ name: string }>(
    `SELECT name FROM public.decks WHERE (card_count IS NULL OR meta IS NULL) AND name ~* '\\.(json|ya?ml)$' LIMIT $1`,
    [limit],
  );

  for (const { name } of rows) {
    const object = await bucket.get(name);
    if (!object) continue;
    const summary = summarizeDeckFile(name, await object.text());
    if (summary) {
      await pg.query(`UPDATE public.decks SET card_count = $2, title = $3, meta = $4 WHERE name = $1`, [
        name,
        summary.cardCount,
        summary.title,
        JSON.stringify(summary.meta),
      ]);
    }
  }
}
